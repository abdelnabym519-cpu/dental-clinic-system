/**
 * Phase 6 — multimodal attachments API.
 *
 * POST /api/ai/attachments  (multipart/form-data)
 *   file:         the attachment (JPEG/PNG/WebP, OBJ/STL/VTK/PLY, PDF, TXT, DICOM)
 *   patientId:    optional, client-SUGGESTED (server re-resolves; PATIENT
 *                 actors may only attach to their own record)
 *   caseId:       optional
 *   conversationId: optional — the chat conversation this belongs to
 *   modality:     optional UPLOADER DECLARATION (staff roles only; a patient
 *                 declaration is recorded as ignored, never trusted)
 *   studyId:      optional LINK to an existing imaging study (server
 *                 re-resolves; the study's modality is the trusted one)
 *
 * The response is the safe AttachmentRef (never the raw storage key) plus
 * the honest capability record (ingestion/preprocessing/AI levels, §18).
 *
 * GET /api/ai/attachments?conversationId=… — list a conversation's
 * attachments (tenant-guarded).
 */

import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { createAttachmentService } from '@/lib/ai/multimodal/attachments'
import { MultimodalError } from '@/lib/ai/multimodal/types'
import type { AttachmentRecord, MultimodalErrorCode } from '@/lib/ai/multimodal/types'
import { MULTIMODAL_LIMITS } from '@/lib/ai/multimodal/limits'
import { capabilityForAttachment } from '@/lib/ai/multimodal/modality'
import { createOrchestratorCapabilitySource } from '@/lib/ai/engines/orchestrator-source'

export const dynamic = 'force-dynamic'

const service = createAttachmentService(prisma)

async function liveEngineNames(): Promise<string[] | null> {
  try {
    const source = createOrchestratorCapabilitySource()
    const health = await source.getHealth()
    return health.filter((h) => h.reachable && h.modelLoaded && !h.isStandin && h.lifecycleStatus === 'AVAILABLE').map((h) => h.name)
  } catch {
    return null // live view unknown — the capability record says so honestly
  }
}

function capRecord(r: AttachmentRecord, live: string[] | null) {
  return capabilityForAttachment({
    fileClass: r.fileClass,
    dentalModality: r.dentalModality,
    liveEngines: live,
  })
}

/**
 * §35 typed errors — the response contract is { error, code }:
 *   error — translatable user-facing sentence (i18n dictionary, Arabic-first)
 *   code  — stable machine code (the §35 typed identifier; no infra leaks)
 * Every MultimodalErrorCode maps to a safe sentence (the code never leaks
 * raw paths, tenants, or stack material into `error`).
 */
const CODE_PROSE: Record<MultimodalErrorCode, string> = {
  UNSUPPORTED_MODALITY: 'Unsupported file type for AI analysis',
  INVALID_FILE: 'Invalid file',
  INVALID_FORMAT: 'Invalid file',
  OVERSIZED_INPUT: 'File is too large',
  PATH_TRAVERSAL_REJECTED: 'The file name is not allowed',
  MIME_MISMATCH: 'File type does not match its contents',
  PATIENT_SCOPE_MISMATCH: 'This attachment belongs to a different patient',
  TENANT_SCOPE_MISMATCH: 'This attachment does not belong to your clinic',
  FORGED_ATTACHMENT_ID: 'Attachment not found',
  CAPABILITY_UNAVAILABLE: 'This feature is not available',
  ENGINE_UNAVAILABLE: 'No AI engine is available for this file type',
  WEIGHTS_UNAVAILABLE: 'No AI engine is available for this file type',
  ORCHESTRATOR_UNREACHABLE: 'The AI service is temporarily unavailable',
  PREPROCESSING_FAILED: 'The file could not be prepared for analysis',
  INFERENCE_FAILED: 'Analysis could not be completed',
  INFERENCE_TIMEOUT: 'Analysis could not be completed',
  OUTPUT_INVALID: 'Analysis could not be completed',
  REVIEW_REQUIRED: 'A clinician must review this result',
  DOCUMENT_EXTRACTION_FAILED: 'The document text could not be extracted',
}

function typedError(err: unknown) {
  if (err instanceof MultimodalError) {
    const status =
      err.code === 'PATH_TRAVERSAL_REJECTED' ||
      err.code === 'PATIENT_SCOPE_MISMATCH' ||
      err.code === 'TENANT_SCOPE_MISMATCH' ||
      err.code === 'FORGED_ATTACHMENT_ID'
        ? 403
        : err.code === 'OVERSIZED_INPUT'
          ? 413
          : 422
    return NextResponse.json({ error: CODE_PROSE[err.code], code: err.code }, { status })
  }
  return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL' }, { status: 500 })
}

export async function POST(req: NextRequest) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid file', code: 'INVALID_FILE' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided', code: 'INVALID_FILE' }, { status: 400 })
  }

  // §32 — reject before buffering: the declared size is checked against the
  // global maximum (largest per-class limit) so a hostile 500MB+ upload is
  // answered without being held in memory.
  if (file.size > MULTIMODAL_LIMITS.maxBytes.VOLUME_DICOM) {
    return NextResponse.json({ error: 'File is too large', code: 'OVERSIZED_INPUT' }, { status: 413 })
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'Invalid file', code: 'INVALID_FILE' }, { status: 400 })
  }

  const str = (v: FormDataEntryValue | null) => (typeof v === 'string' && v ? v : null)

  try {
    const record = await service.create({
      hospitalId,
      actor: { id: user.id, role: user.role },
      file: { originalName: file.name || 'attachment', buffer, declaredSize: file.size },
      patientId: str(form.get('patientId')),
      caseId: str(form.get('caseId')),
      conversationId: str(form.get('conversationId')),
      declaredModality: str(form.get('modality')),
      linkedStudyId: str(form.get('studyId')),
      source: 'CHAT_UPLOAD',
    })
    const live = await liveEngineNames()
    return NextResponse.json({ attachment: service.toRef(record), capability: capRecord(record, live) }, { status: 201 })
  } catch (err) {
    return typedError(err)
  }
}

export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const conversationId = req.nextUrl.searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required', code: 'INVALID_REQUEST' }, { status: 400 })
  }
  const records = await service.listForConversation(conversationId, hospitalId)
  return NextResponse.json({ attachments: records.map((r) => service.toRef(r)) })
}

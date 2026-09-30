/**
 * Phase 6 — Attachment service (§8 security-first pipeline, §7 contract).
 *
 * Receive → Authenticate/Authorize (caller) → Tenant Scope → Size Validation
 * → Filename Sanitization → MIME Detection (magic bytes) → Signature
 * Validation → Checksum → Storage → Parse → Normalize → Modality
 * Classification → (later) AI Routing.
 *
 * Nothing here trusts the client: MIME is detected from bytes, the checksum
 * is computed over stored bytes, the patient is re-resolved server-side, the
 * linked study is re-resolved server-side, and a PATIENT actor can only ever
 * attribute an attachment to THEMSELVES (their portal-linked patient).
 *
 * Failure policy: typed MultimodalError, row marked FAILED with the code,
 * stored artifacts removed (best effort). Never a partial "maybe".
 */

import { randomUUID } from 'crypto'
import { getStorage, buildStorageKey } from '@/lib/storage'
import { detectSignature } from './file-signature'
import { assertNameNotTraversing, buildStorageFileName, sanitizeOriginalName } from './filename'
import { classifyDentalModality, STAFF_ROLES } from './modality'
import { estimateMeshCells, persistPreprocessed, preprocessImage, sha256Hex } from './preprocess'
import { extractDocument, persistExtractedText } from './document-extract'
import { MULTIMODAL_LIMITS, maxBytesFor } from './limits'
import { MultimodalError, PREPROCESS_VERSION } from './types'
import type {
  AttachmentProvenance,
  AttachmentRecord,
  AttachmentRef,
  AttachmentSource,
  MultimodalFileClass,
} from './types'

export interface AttachmentInput {
  hospitalId: string
  actor: { id: string; role: string }
  /** Raw uploaded file (the bytes decide everything). */
  file: { originalName: string; buffer: Buffer; declaredSize: number }
  /** Client-SUGGESTED — re-validated server-side. */
  patientId: string | null
  caseId: string | null
  conversationId: string | null
  declaredModality: string | null
  linkedStudyId: string | null
  source?: AttachmentSource
}

export interface AttachmentService {
  create(input: AttachmentInput): Promise<AttachmentRecord>
  get(id: string, hospitalId: string): Promise<AttachmentRecord | null>
  listForConversation(conversationId: string, hospitalId: string): Promise<AttachmentRecord[]>
  toRef(r: AttachmentRecord): AttachmentRef
}

export function createAttachmentService(client: any): AttachmentService {
  async function create(input: AttachmentInput): Promise<AttachmentRecord> {
    const { hospitalId, actor, file } = input
    const buf = file.buffer
    const receivedAt = new Date().toISOString()
    const isStaff = (STAFF_ROLES as readonly string[]).includes(actor.role)

    // ── Filename boundary (before anything is stored) ────────────────────
    assertNameNotTraversing(file.originalName)
    const originalName = sanitizeOriginalName(file.originalName)

    // ── Size validation (declared first, then exact) ─────────────────────
    if (file.declaredSize > MULTIMODAL_LIMITS.maxBytes.VOLUME_DICOM) {
      throw new MultimodalError('OVERSIZED_INPUT', 'file exceeds the maximum attachment size')
    }
    if (buf.length !== file.declaredSize) {
      throw new MultimodalError('INVALID_FILE', 'declared size does not match received bytes')
    }

    // ── MIME detection + signature (the bytes decide) ────────────────────
    const sig = detectSignature(buf)
    if (buf.length > maxBytesFor(sig.fileClass)) {
      throw new MultimodalError('OVERSIZED_INPUT', `file exceeds the ${sig.fileClass} size limit`)
    }

    // ── Patient / study re-resolution (server-side, tenant-guarded) ──────
    let patientId: string | null = null
    let linkedStudy: { id: string; patientId: string; modality: string } | null = null

    if (input.linkedStudyId) {
      const study = await client.imagingStudy.findFirst({
        where: { id: input.linkedStudyId, hospitalId },
        select: { id: true, patientId: true, modality: true },
      })
      if (!study) throw new MultimodalError('FORGED_ATTACHMENT_ID', 'linked study not found in this tenant')
      if (input.patientId && input.patientId !== study.patientId) {
        throw new MultimodalError('PATIENT_SCOPE_MISMATCH', 'linked study belongs to a different patient')
      }
      linkedStudy = study
      patientId = study.patientId // the study's patient is the trusted attribution
    } else if (input.patientId) {
      // PATIENT actors may only attribute to their own portal patient.
      if (actor.role === 'PATIENT') {
        const own = await client.patient.findFirst({
          where: { hospitalId, portalUserId: actor.id },
          select: { id: true },
        })
        if (!own || own.id !== input.patientId) {
          throw new MultimodalError('PATIENT_SCOPE_MISMATCH', 'patients may only attach to their own record')
        }
      } else {
        const p = await client.patient.findFirst({
          where: { id: input.patientId, hospitalId },
          select: { id: true },
        })
        if (!p) throw new MultimodalError('PATIENT_SCOPE_MISMATCH', 'patient not found in this tenant')
      }
      patientId = input.patientId
    }

    const modality = classifyDentalModality({
      fileClass: sig.fileClass,
      linkedStudyModality: linkedStudy?.modality ?? null,
      declaredModality: input.declaredModality?.toUpperCase() ?? null,
      actorIsStaff: isStaff,
    })

    // ── Storage (tenant-prefixed key; server-generated name) ─────────────
    const storage = getStorage()
    const uuid = randomUUID()
    const clientExt = extOf(file.originalName)
    const fileName = buildStorageFileName(sig.fileClass, sig.mediaType, clientExt, uuid)
    const baseKey = buildStorageKey(hospitalId, 'ai', 'attachments', uuid)
    const storageKey = `${baseKey}/${fileName}`

    const provenance: AttachmentProvenance = {
      preprocessVersion: null,
      derivatives: [],
      pipelineVersion: 'p6-v1',
      receivedAt,
      validatedAt: null,
      processedAt: null,
    }

    // ── Persist + per-class processing (failure → FAILED row + cleanup) ──
    let row: any = null
    try {
      row = await client.multimodalAttachment.create({
        data: {
          hospitalId,
          patientId,
          caseId: input.caseId,
          conversationId: input.conversationId,
          originalName,
          fileName,
          mediaType: sig.mediaType,
          fileClass: sig.fileClass,
          dentalModality: modality.dentalModality,
          modalityOrigin: modality.modalityOrigin,
          dentalImageState: modality.dentalImageState,
          size: buf.length,
          sha256: sha256Hex(buf),
          storageKey,
          source: input.source ?? 'CHAT_UPLOAD',
          status: 'RECEIVED',
        },
      })

      provenance.validatedAt = new Date().toISOString()
      await client.multimodalAttachment.update({
        where: { id: row.id },
        data: { status: 'VALIDATED' },
      })

      const processed = await processByClass(buf, sig.fileClass, baseKey, fileName, provenance)

      // Patient-attributed attachment with an established modality → the
      // EXISTING imaging graph (study row reused; no duplicate models).
      let studyId: string | null = null
      if (patientId && modality.dentalModality && sig.fileClass !== 'VOLUME_DICOM') {
        const study = await client.imagingStudy.create({
          data: {
            hospitalId,
            patientId,
            appointmentId: null,
            studyType: 'CHAT_UPLOAD',
            modality: modality.dentalModality,
            originalKey: `${baseKey}/${fileName}`,
            originalSize: buf.length,
            originalHash: row.sha256,
            mimeType: sig.mediaType,
            uploadedById: actor.id,
            status: 'UPLOADED',
          },
        })
        studyId = study.id
      }

      const data: Record<string, unknown> = {
        status: 'PROCESSED',
        studyId,
        provenance: provenance as unknown as object,
      }
      if (processed) {
        if (processed.width !== undefined) { data.width = processed.width; data.height = processed.height; data.pixelCount = processed.pixelCount }
        if (processed.pageCount !== undefined) { data.pageCount = processed.pageCount; data.extractedTextKey = processed.extractedTextKey ?? null }
      }
      row = await client.multimodalAttachment.update({
        where: { id: row.id },
        data,
      })
      provenance.processedAt = new Date().toISOString()

      return rowToRecord(row)
    } catch (err) {
      const code = err instanceof MultimodalError ? err.code : 'INVALID_FILE'
      // Best-effort cleanup of any partially stored artifact.
      try { await storage.delete(storageKey) } catch { /* already gone */ }
      if (row) {
        await client.multimodalAttachment.update({
          where: { id: row.id },
          data: { status: 'FAILED', failureCode: code, provenance: provenance as unknown as object },
        }).catch(() => { /* row already gone */ })
      }
      if (err instanceof MultimodalError) throw err
      throw new MultimodalError('INVALID_FILE', 'attachment processing failed')
    }
  }

  async function get(id: string, hospitalId: string): Promise<AttachmentRecord | null> {
    const row = await client.multimodalAttachment.findFirst({ where: { id, hospitalId } })
    return row ? rowToRecord(row) : null
  }

  async function listForConversation(conversationId: string, hospitalId: string): Promise<AttachmentRecord[]> {
    const rows = await client.multimodalAttachment.findMany({
      where: { conversationId, hospitalId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })
    return rows.map(rowToRecord)
  }

  function toRef(r: AttachmentRecord): AttachmentRef {
    return {
      id: r.id,
      originalName: r.originalName,
      mediaType: r.mediaType,
      fileClass: r.fileClass,
      size: r.size,
      dentalModality: r.dentalModality,
      modalityOrigin: r.modalityOrigin,
      dentalImageState: r.dentalImageState,
      status: r.status,
      patientId: r.patientId,
      studyId: r.studyId,
      createdAt: r.createdAt.toISOString(),
    }
  }

  return { create, get, listForConversation, toRef }
}

// ---------------------------------------------------------------------------

function rowStorageKeyFor(baseKey: string, fileName: string): string {
  return `${baseKey}/${fileName}`
}

async function processByClass(
  buf: Buffer,
  fileClass: MultimodalFileClass,
  baseKey: string,
  fileName: string,
  provenance: AttachmentProvenance,
): Promise<{ width?: number; height?: number; pixelCount?: number; pageCount?: number; extractedTextKey?: string | null } | null> {
  switch (fileClass) {
    case 'IMAGE_2D': {
      const image = await preprocessImage(buf)
      // Original is written ONCE, at the row's canonical key.
      const res = await persistPreprocessed(image, {
        originalKey: rowStorageKeyFor(baseKey, fileName),
        derivativeKey: `${baseKey}/grayscale`,
      })
      provenance.preprocessVersion = res.version
      provenance.derivatives = res.derivatives
      return { width: res.width, height: res.height, pixelCount: res.pixelCount }
    }
    case 'MESH_3D': {
      const cells = estimateMeshCells(buf)
      if (cells > MULTIMODAL_LIMITS.maxMeshCells) {
        throw new MultimodalError('OVERSIZED_INPUT', `mesh exceeds max cell estimate (${cells})`)
      }
      return null
    }
    case 'DOCUMENT_PDF':
    case 'DOCUMENT_TEXT': {
      const doc = await extractDocument(buf, fileClass)
      const persisted = await persistExtractedText(doc, (name) => `${baseKey}/${name}`)
      provenance.derivatives.push({ key: persisted.key, kind: 'extracted_text', sha256: persisted.sha256 })
      return { pageCount: doc.pageCount, extractedTextKey: persisted.key }
    }
    case 'VOLUME_DICOM':
    case 'UNKNOWN':
      return null
  }
}

function extOf(name: string): string | null {
  const i = name.lastIndexOf('.')
  if (i < 0 || i === name.length - 1) return null
  const e = name.slice(i + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(e) ? e : null
}

function rowToRecord(row: any): AttachmentRecord {
  const prov = (row.provenance ?? null) as AttachmentProvenance | null
  return {
    id: row.id,
    hospitalId: row.hospitalId,
    patientId: row.patientId,
    caseId: row.caseId,
    conversationId: row.conversationId,
    originalName: row.originalName,
    fileName: row.fileName,
    mediaType: row.mediaType,
    fileClass: row.fileClass,
    dentalModality: row.dentalModality,
    modalityOrigin: row.modalityOrigin,
    dentalImageState: row.dentalImageState,
    size: row.size,
    sha256: row.sha256,
    storageKey: row.storageKey,
    source: row.source,
    status: row.status,
    failureCode: row.failureCode,
    width: row.width,
    height: row.height,
    pixelCount: row.pixelCount,
    pageCount: row.pageCount,
    extractedTextKey: row.extractedTextKey,
    studyId: row.studyId,
    provenance: prov,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }
}

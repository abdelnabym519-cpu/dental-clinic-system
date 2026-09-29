import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { getStorage, buildStorageKey, uploadUrl } from '@/lib/storage'
import {
  OrchestratorError,
  requestOrchestratorAnalyze,
} from '@/lib/ai-orchestrator'

// Phase 19A (D10) — imaging study upload + AI trigger.
// Phase 19B (D14) — modality → engine map:
//   PANORAMIC     → liodon          (19A rule, unchanged)
//   PERIAPICAL    → implant-ai      (19B spec D14: 2D non-panoramic radiographs)
//   BITEWING      → implant-ai
//   CEPHALOMETRIC → orthodontic-ai  (19B engine 3: 38 cephalometric landmarks)
// Phase 20B — the 3D modalities accept surface-mesh uploads (.obj/.stl/.vtk/.ply,
//   <= 200MB) routed to the MeshSegNet engines:
//   THREE_D_SCAN, CBCT → meshsegnet-max by default; the optional `jaw` form
//   field ('max' | 'man', default 'max') selects meshsegnet-man for mandibular
//   scans. The orchestrator re-validates modality↔engine and the engine parser
//   is the final authority on mesh format.
//   PHOTO still has no engine.
//
// POST /api/imaging/studies  (multipart/form-data)
//   file:         JPEG/PNG/WebP image (<= 50MB) for image modalities, or
//                 .obj/.stl/.vtk/.ply mesh (<= 200MB) for THREE_D_SCAN/CBCT
//   patientId:    existing patient (must belong to the caller's hospital)
//   modality:     PANORAMIC | PERIAPICAL | BITEWING | CBCT | THREE_D_SCAN | PHOTO | CEPHALOMETRIC
//   studyType:    optional label (default 'IMAGING')
//   appointmentId: optional
//   studyDate:    optional ISO date
//   description:  optional
//   jaw:          optional 'max' | 'man' — THREE_D_SCAN/CBCT only (Phase 20B)
//   analyze:      'true' to trigger AI analysis (engine chosen by modality,
//                 above; the orchestrator re-validates modality↔engine)
//
// Tenant + identity come from the authenticated session — client-supplied
// hospital/user ids are never trusted (D10 / D11.1).

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

// Phase 20B — surface-mesh uploads for the 3D modalities (MeshSegNet).
// The engine parsers are the final authority (obj/stl/vtk/ply — see
// ai/engines/meshsegnet-*/app/pipeline.py). .npy point clouds are NOT
// triangular meshes and the engines refuse them, so they are refused here at
// upload time instead of after a guaranteed-FAILED job.
const MESH_MODALITIES = ['THREE_D_SCAN', 'CBCT'] as const
const ALLOWED_MESH_EXTENSIONS = ['obj', 'stl', 'vtk', 'ply'] as const
// Browsers report mesh files with no reliable MIME (almost always
// application/octet-stream); the extension is the practical gate, the engine
// parser is the final one.
const MESH_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/stl',
  'application/ply',
  'model/obj',
  'model/stl',
  'model/vtk',
  'model/ply',
  'text/plain',
])
const MAX_MESH_SIZE = 200 * 1024 * 1024 // 200 MB

const MODALITIES = [
  'PANORAMIC',
  'PERIAPICAL',
  'BITEWING',
  'CBCT',
  'THREE_D_SCAN',
  'PHOTO',
  'CEPHALOMETRIC',
] as const

// Phase 19B (D14) + Phase 20B — the ONLY place a modality is mapped to an
// engine. Mirrors the orchestrator registry's supported_modalities
// (extend-only): every value here is a modality the named engine declares it
// supports. THREE_D_SCAN/CBCT default to the maxilla model (Phase 20B jaw
// selector overrides to meshsegnet-man below). PHOTO intentionally has no
// entry (no model exists for clinical photos).
const ENGINE_BY_MODALITY: Record<string, string> = {
  PANORAMIC: 'liodon',
  PERIAPICAL: 'implant-ai',
  BITEWING: 'implant-ai',
  CEPHALOMETRIC: 'orthodontic-ai',
  THREE_D_SCAN: 'meshsegnet-max',
  CBCT: 'meshsegnet-max',
}

const FORM_SCHEMA = z.object({
  patientId: z.string().min(1),
  modality: z.enum(MODALITIES).default('PANORAMIC'),
  studyType: z.string().max(64).optional(),
  appointmentId: z.string().min(1).optional(),
  studyDate: z.string().max(32).optional(),
  description: z.string().max(2000).optional(),
  // Phase 20B — jaw of a 3D scan: 'max' (maxilla) | 'man' (mandible).
  jaw: z.enum(['max', 'man']).optional(),
  analyze: z.string().optional(),
})

// Phase 19A (D11) — list the caller's studies, newest first, tenant-guarded.
// Phase 20 (D7/D8) — optional ?patientId= and ?appointmentId= filters.
// Both narrow within the caller's own hospital (the tenant guard stays the
// hospitalId scope), so a foreign id simply returns an empty list — no
// existence oracle for other tenants.
export async function GET(req: NextRequest) {
  // Explicit view roles — imaging is not an ACCOUNTANT surface (Phase 20 spec).
  const { error, hospitalId } = await requireAuthAndRole(['DOCTOR', 'ADMIN', 'RECEPTIONIST'])

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = new URL(req.url).searchParams
  const patientId = searchParams.get('patientId')?.trim()
  const appointmentId = searchParams.get('appointmentId')?.trim()

  const studies = await prisma.imagingStudy.findMany({
    where: {
      hospitalId,
      ...(patientId ? { patientId } : {}),
      ...(appointmentId ? { appointmentId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      patient: { select: { patientId: true, firstName: true, lastName: true } },
      aiJobs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          engine: true,
          reviewedAt: true,
          findings: true,
          reviewedBy: { select: { name: true } },
        },
      },
    },
  })

  interface StudyListItem {
    id: string
    patient: { patientId: string; firstName: string; lastName: string } | null
    modality: string
    studyType: string
    status: string
    createdAt: Date
    originalKey: string
    aiJobs: Array<{
      id: string
      status: string
      engine: string
      reviewedAt: Date | null
      findings: unknown
      reviewedBy: { name: string } | null
    }>
  }

  return NextResponse.json({
    studies: (studies as unknown as StudyListItem[]).map((s) => ({
      id: s.id,
      patientId: s.patient?.patientId ?? null,
      patientName: s.patient
        ? `${s.patient.firstName} ${s.patient.lastName}`.trim()
        : null,
      modality: s.modality,
      studyType: s.studyType,
      status: s.status,
      createdAt: s.createdAt,
      // Served by the tenant-guarded /api/uploads route.
      originalUrl: uploadUrl(s.originalKey),
      latestJob: s.aiJobs[0]
        ? {
            id: s.aiJobs[0].id,
            status: s.aiJobs[0].status,
            engine: s.aiJobs[0].engine,
            reviewedAt: s.aiJobs[0].reviewedAt,
            findingsCount: Array.isArray(s.aiJobs[0].findings) ? s.aiJobs[0].findings.length : 0,
            reviewedByName: s.aiJobs[0].reviewedBy?.name ?? null,
          }
        : null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const { error, user, hospitalId } = await requireAuthAndRole(['DOCTOR', 'ADMIN'])

  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const parsed = FORM_SCHEMA.safeParse({
    patientId: form.get('patientId'),
    modality: form.get('modality') || undefined,
    studyType: form.get('studyType') || undefined,
    appointmentId: form.get('appointmentId') || undefined,
    studyDate: form.get('studyDate') || undefined,
    description: form.get('description') || undefined,
    jaw: form.get('jaw') || undefined,
    analyze: form.get('analyze') || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }
  const body = parsed.data

  // Phase 20B — modality-dependent file gate: images for the 2D modalities,
  // surface meshes for the 3D modalities. The extension drives the storage
  // key, which is how the orchestrator tells the engines the container
  // format (ai/orchestrator/app/main.py::_engine_payload).
  const isMesh = (MESH_MODALITIES as readonly string[]).includes(body.modality)
  let ext: string
  if (isMesh) {
    const fileExt = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!ALLOWED_MESH_EXTENSIONS.includes(fileExt as (typeof ALLOWED_MESH_EXTENSIONS)[number])) {
      return NextResponse.json(
        { error: 'Unsupported 3D mesh format. Accepted: OBJ, STL, VTK, PLY' },
        { status: 400 }
      )
    }
    if (!MESH_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported 3D mesh format. Accepted: OBJ, STL, VTK, PLY' },
        { status: 400 }
      )
    }
    if (file.size > MAX_MESH_SIZE) {
      return NextResponse.json({ error: '3D mesh exceeds 200MB limit' }, { status: 400 })
    }
    ext = fileExt
  } else {
    // File type by MIME (extension is cosmetic; the content type is the gate).
    const imageExt = ALLOWED_TYPES[file.type]
    if (!imageExt) {
      return NextResponse.json(
        { error: 'Unsupported image type. Accepted: JPEG, PNG, WebP' },
        { status: 400 }
      )
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Image exceeds 50MB limit' }, { status: 400 })
    }
    ext = imageExt
  }

  // Patient must exist AND belong to this hospital (tenant guard, D11.1).
  const patient = await prisma.patient.findFirst({
    where: { id: body.patientId, hospitalId },
    select: { id: true },
  })
  if (!patient) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }

  // Optional appointment link must also be this tenant's.
  if (body.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: body.appointmentId, hospitalId },
      select: { id: true },
    })
    if (!appt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const originalHash = createHash('sha256').update(bytes).digest('hex')
  const studyId = randomUUID()

  // Unique, tenant-scoped object key. Originals are IMMUTABLE after this
  // put: nothing in the AI stack writes to this key (spec section 14).
  const originalKey = buildStorageKey(hospitalId, 'imaging', body.patientId, studyId, `original.${ext}`)

  await getStorage().put(originalKey, bytes, { contentType: file.type })

  const study = await prisma.imagingStudy.create({
    data: {
      id: studyId,
      hospitalId,
      patientId: body.patientId,
      appointmentId: body.appointmentId,
      studyType: body.studyType ?? 'IMAGING',
      modality: body.modality,
      originalKey,
      originalSize: bytes.length,
      originalHash,
      mimeType: file.type,
      studyDate: body.studyDate ? new Date(body.studyDate) : undefined,
      description: body.description,
      uploadedById: user.id,
      status: 'UPLOADED',
    },
  })

  await prisma.auditLog.create({
    data: {
      hospitalId,
      userId: user.id,
      action: 'IMAGING_STUDY_UPLOADED',
      entityType: 'ImagingStudy',
      entityId: study.id,
      newValues: JSON.stringify({
        patientId: body.patientId,
        modality: study.modality,
        originalKey,
        originalHash,
        originalSize: study.originalSize,
        // Phase 20B — which jaw a 3D scan belongs to (null for 2D modalities).
        jaw: isMesh ? body.jaw ?? 'max' : null,
      }),
    },
  })

  // ---- AI trigger (19A D10.1 / 19B D14: engine chosen by modality) ------
  if (body.analyze !== 'true') {
    return NextResponse.json({ study, job: null }, { status: 201 })
  }

  let engine = ENGINE_BY_MODALITY[study.modality]
  if (!engine) {
    // Prose stays a dictionary key (i18n audit); the modality travels as data.
    return NextResponse.json(
      {
        study,
        error: 'AI analysis is not supported for this modality',
        modality: study.modality,
      },
      { status: 422 }
    )
  }

  // Phase 20B — jaw selector: mandibular scans go to the mandible model.
  // 'max' (or absent) keeps the map default (meshsegnet-max).
  if (isMesh && body.jaw === 'man') {
    engine = 'meshsegnet-man'
  }

  const job = await prisma.aIAnalysisJob.create({
    data: {
      hospitalId,
      studyId: study.id,
      engine,
      status: 'PENDING',
      requestedById: user.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      hospitalId,
      userId: user.id,
      action: 'AI_JOB_REQUESTED',
      entityType: 'AIAnalysisJob',
      entityId: job.id,
      newValues: JSON.stringify({ engine, studyId: study.id, modality: study.modality }),
    },
  })

  try {
    const result = await requestOrchestratorAnalyze({
      jobId: job.id,
      studyId: study.id,
      hospitalId,
      imageKey: originalKey,
      imageSha256: originalHash,
      engine,
      modality: study.modality,
      requestedBy: user.id,
    })
    // The orchestrator already persisted COMPLETED + provenance + audit and
    // moved the study to ANALYZED.
    const freshStudy = await prisma.imagingStudy.findUnique({
      where: { id: study.id },
      select: { id: true, status: true },
    })
    return NextResponse.json(
      {
        study: { ...study, status: freshStudy?.status ?? 'ANALYZED' },
        // The orchestrator's wire object carries the identifier as `job_id`;
        // the API contract is `id` (see the 502 branch and /jobs/[id]/review).
        job: { id: job.id, ...result },
      },
      { status: 201 }
    )
  } catch (err) {
    // If the orchestrator did not get far enough to record the failure
    // itself (unreachable, or a non-domain error), this route is the
    // fallback owner of the FAILED state + audit.
    const current = await prisma.aIAnalysisJob.findUnique({
      where: { id: job.id },
      select: { id: true, status: true },
    })
    if (current && (current.status === 'PENDING' || current.status === 'PROCESSING')) {
      // DB-diagnostic text (not user-facing prose): concatenation keeps the
      // i18n template audit honest.
      const detail = err instanceof Error ? err.name : 'unknown error'
      const fallbackMessage = 'AI analysis failed: ' + detail
      const message = err instanceof OrchestratorError ? err.message : fallbackMessage
      await prisma.aIAnalysisJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      })
      await prisma.auditLog.create({
        data: {
          hospitalId,
          userId: user.id,
          action: 'AI_JOB_FAILED',
          entityType: 'AIAnalysisJob',
          entityId: job.id,
          newValues: JSON.stringify({ engine, error: message.slice(0, 500) }),
        },
      })
    }
    return NextResponse.json(
      {
        study,
        job: { id: job.id, status: 'FAILED' },
        error: err instanceof OrchestratorError ? err.message : 'AI analysis failed',
      },
      { status: 502 }
    )
  }
}

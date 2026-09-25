import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { getStorage, buildStorageKey } from '@/lib/storage'
import {
  OrchestratorError,
  requestOrchestratorAnalyze,
} from '@/lib/ai-orchestrator'

// Phase 19A (D10) — imaging study upload + Liodon AI trigger.
//
// POST /api/imaging/studies  (multipart/form-data)
//   file:         JPEG/PNG/WebP image, <= 50MB
//   patientId:    existing patient (must belong to the caller's hospital)
//   modality:     PANORAMIC | PERIAPICAL | BITEWING | CBCT | THREE_D_SCAN | PHOTO
//   studyType:    optional label (default 'IMAGING')
//   appointmentId: optional
//   studyDate:    optional ISO date
//   description:  optional
//   analyze:      'true' to trigger AI analysis (Liodon, PANORAMIC only)
//
// Tenant + identity come from the authenticated session — client-supplied
// hospital/user ids are never trusted (D10 / D11.1).

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

const MODALITIES = ['PANORAMIC', 'PERIAPICAL', 'BITEWING', 'CBCT', 'THREE_D_SCAN', 'PHOTO'] as const

const FORM_SCHEMA = z.object({
  patientId: z.string().min(1),
  modality: z.enum(MODALITIES).default('PANORAMIC'),
  studyType: z.string().max(64).optional(),
  appointmentId: z.string().min(1).optional(),
  studyDate: z.string().max(32).optional(),
  description: z.string().max(2000).optional(),
  analyze: z.string().optional(),
})

// Phase 19A (D11) — list the caller's studies, newest first, tenant-guarded.
export async function GET() {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const studies = await prisma.imagingStudy.findMany({
    where: { hospitalId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      patient: { select: { patientId: true, firstName: true, lastName: true } },
      aiJobs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, engine: true, reviewedAt: true },
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
    aiJobs: Array<{ id: string; status: string; engine: string; reviewedAt: Date | null }>
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
      latestJob: s.aiJobs[0] ?? null,
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

  // File type by MIME (extension is cosmetic; the content type is the gate).
  const ext = ALLOWED_TYPES[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: 'Unsupported image type. Accepted: JPEG, PNG, WebP' },
      { status: 400 }
    )
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Image exceeds 50MB limit' }, { status: 400 })
  }

  const parsed = FORM_SCHEMA.safeParse({
    patientId: form.get('patientId'),
    modality: form.get('modality') || undefined,
    studyType: form.get('studyType') || undefined,
    appointmentId: form.get('appointmentId') || undefined,
    studyDate: form.get('studyDate') || undefined,
    description: form.get('description') || undefined,
    analyze: form.get('analyze') || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }
  const body = parsed.data

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
      }),
    },
  })

  // ---- AI trigger (D10.1: Liodon runs on PANORAMIC only) ----------------
  if (body.analyze !== 'true') {
    return NextResponse.json({ study, job: null }, { status: 201 })
  }

  if (study.modality !== 'PANORAMIC') {
    // Prose stays a dictionary key (i18n audit); the modality travels as data.
    return NextResponse.json(
      {
        study,
        error: 'AI analysis is only supported for PANORAMIC studies',
        modality: study.modality,
      },
      { status: 422 }
    )
  }

  const job = await prisma.aiAnalysisJob.create({
    data: {
      hospitalId,
      studyId: study.id,
      engine: 'liodon',
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
      newValues: JSON.stringify({ engine: 'liodon', studyId: study.id, modality: 'PANORAMIC' }),
    },
  })

  try {
    const result = await requestOrchestratorAnalyze({
      jobId: job.id,
      studyId: study.id,
      hospitalId,
      imageKey: originalKey,
      imageSha256: originalHash,
      engine: 'liodon',
      modality: 'PANORAMIC',
      requestedBy: user.id,
    })
    // The orchestrator already persisted COMPLETED + provenance + audit and
    // moved the study to ANALYZED.
    const freshStudy = await prisma.imagingStudy.findUnique({
      where: { id: study.id },
      select: { id: true, status: true },
    })
    return NextResponse.json(
      { study: { ...study, status: freshStudy?.status ?? 'ANALYZED' }, job: result },
      { status: 201 }
    )
  } catch (err) {
    // If the orchestrator did not get far enough to record the failure
    // itself (unreachable, or a non-domain error), this route is the
    // fallback owner of the FAILED state + audit.
    const current = await prisma.aiAnalysisJob.findUnique({
      where: { id: job.id },
      select: { id: true, status: true },
    })
    if (current && (current.status === 'PENDING' || current.status === 'PROCESSING')) {
      // DB-diagnostic text (not user-facing prose): concatenation keeps the
      // i18n template audit honest.
      const detail = err instanceof Error ? err.name : 'unknown error'
      const fallbackMessage = 'AI analysis failed: ' + detail
      const message = err instanceof OrchestratorError ? err.message : fallbackMessage
      await prisma.aiAnalysisJob.update({
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
          newValues: JSON.stringify({ engine: 'liodon', error: message.slice(0, 500) }),
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

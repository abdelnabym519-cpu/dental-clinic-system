import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

// Phase 19A (D11) — doctor review of AI findings.
//
// POST /api/imaging/jobs/:id/review
//   decision:         ACCEPTED | MODIFIED | REJECTED
//   acceptedFindings: (MODIFIED only) the doctor-corrected findings JSON
//   reviewNotes:      optional free text
//
// AI findings are SUGGESTIONS: this endpoint is the mandatory human gate
// before anything reaches the clinical record. Every decision is audited
// (D12) and the study progresses to REVIEWED.

// Phase 19A — Liodon/Implant AI findings: bounding boxes in original-image
// pixels (the 19A wire contract).
const BOX_FINDING_SCHEMA = z.object({
  condition: z.string().min(1),
  tooth_number: z.null(),
  confidence: z.number().min(0).max(1),
  bounding_box: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(0),
    height: z.number().finite().min(0),
    x2: z.number().finite(),
    y2: z.number().finite(),
    coordinate_space: z.string().optional(),
    units: z.string().optional(),
  }),
})

// Phase 19B (D14) — Orthodontic AI findings: the 38 cephalometric landmarks
// in the cropped-original image's pixel space (the repository's own
// zero-padding crop; top-left origin unchanged, so coordinates place
// directly on the original).
const LANDMARK_FINDING_SCHEMA = z.object({
  landmark_id: z.number().int().min(0).max(37),
  landmark_name: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  score: z.number().min(0).max(1).nullable(),
  coordinate_space: z.string().optional(),
})

// Phase 19B (D14) — MeshSegNet findings: the 15-class per-cell segment
// histogram (3D input — no boxes, no image).
const SEGMENT_FINDING_SCHEMA = z.object({
  class_id: z.number().int().min(0),
  class_name: z.string().min(1),
  point_count: z.number().int().positive(),
})

// A doctor-corrected finding must be one of the engines' shapes. The union
// is permissive across engines by design: this endpoint validates STRUCTURE
// (finite numbers, bounded ids, non-negative counts), and the per-engine
// validation already ran when the job completed.
const FINDING_SCHEMA = z.union([BOX_FINDING_SCHEMA, LANDMARK_FINDING_SCHEMA, SEGMENT_FINDING_SCHEMA])

const REVIEW_SCHEMA = z.object({
  decision: z.enum(['ACCEPTED', 'MODIFIED', 'REJECTED']),
  acceptedFindings: z.array(FINDING_SCHEMA).max(100).optional(),
  reviewNotes: z.string().max(2000).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user, hospitalId } = await requireAuthAndRole(['DOCTOR', 'ADMIN'])

  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const body = REVIEW_SCHEMA.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      { error: body.error.issues.map((i) => i.message).join('; ') },
      { status: 400 }
    )
  }
  const { decision, reviewNotes } = body.data

  // Tenant guard: job must belong to the caller's hospital (D11.1).
  const job = await prisma.aiAnalysisJob.findFirst({
    where: { id, hospitalId },
    include: { study: { select: { id: true, status: true } } },
  })
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: 'Only completed jobs can be reviewed', status: job.status },
      { status: 409 }
    )
  }

  // What the doctor accepted:
  //   ACCEPTED -> the AI findings as-is
  //   MODIFIED -> the doctor-corrected findings (validated above)
  //   REJECTED -> nothing
  const jobFindings = (job.findings ?? []) as unknown[]
  let acceptedFindings: unknown = null
  if (decision === 'ACCEPTED') {
    acceptedFindings = jobFindings
  } else if (decision === 'MODIFIED') {
    if (!body.data.acceptedFindings) {
      return NextResponse.json(
        { error: 'acceptedFindings is required when decision is MODIFIED' },
        { status: 400 }
      )
    }
    acceptedFindings = body.data.acceptedFindings
  }

  const updated = await prisma.aiAnalysisJob.update({
    where: { id: job.id },
    data: {
      reviewedById: user.id,
      reviewedAt: new Date(),
      reviewDecision: decision,
      reviewNotes,
      acceptedFindings,
    },
  })

  await prisma.imagingStudy.update({
    where: { id: job.studyId },
    data: { status: 'REVIEWED' },
  })

  const auditAction =
    decision === 'ACCEPTED'
      ? 'AI_FINDING_ACCEPTED'
      : decision === 'MODIFIED'
        ? 'AI_FINDING_MODIFIED'
        : 'AI_FINDING_REJECTED'

  await prisma.auditLog.create({
    data: {
      hospitalId,
      userId: user.id,
      action: auditAction,
      entityType: 'AIAnalysisJob',
      entityId: job.id,
      newValues: JSON.stringify({
        studyId: job.studyId,
        engine: job.engine,
        decision,
        acceptedFindingCount: Array.isArray(acceptedFindings) ? acceptedFindings.length : 0,
        reviewNotes: reviewNotes ?? null,
      }),
    },
  })

  return NextResponse.json({
    job: {
      id: updated.id,
      status: updated.status,
      reviewDecision: updated.reviewDecision,
      reviewedAt: updated.reviewedAt,
      reviewedById: updated.reviewedById,
      acceptedFindings: updated.acceptedFindings,
    },
    study: { id: job.studyId, status: 'REVIEWED' },
  })
}

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

const FINDING_SCHEMA = z.object({
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

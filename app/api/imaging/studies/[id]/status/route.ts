import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { uploadUrl } from '@/lib/storage'

// Phase 20 (D4) — poll endpoint for the imaging UI.
//
// GET /api/imaging/studies/:id/status
//
// Returns the study, its latest AI job (findings included) and a *derived*
// display status:
//
//   REVIEWED / ANALYZED — straight from the study record
//   PROCESSING          — study still UPLOADED while the latest job is
//                         PENDING or PROCESSING
//   UPLOADED            — everything else (no job yet, or terminal job)
//
// The study enum itself has no PROCESSING state (19A schema — DO NOT TOUCH),
// so the derivation is the UI's source of truth and is computed here, in one
// place, instead of every client guessing.
//
// RBAC: any staff role that may VIEW imaging. ACCOUNTANT has no imaging
// access (spec), so the allow-list is explicit rather than open.

const VIEW_ROLES = ['DOCTOR', 'ADMIN', 'RECEPTIONIST']

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole(VIEW_ROLES)

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const study = await prisma.imagingStudy.findFirst({
    where: { id, hospitalId },
    include: {
      patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
      aiJobs: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          engine: true,
          status: true,
          modelVersion: true,
          modelChecksum: true,
          processingTimeMs: true,
          findings: true,
          confidence: true,
          errorMessage: true,
          rawOutputKey: true,
          provenance: true,
          reviewedById: true,
          reviewedAt: true,
          reviewDecision: true,
          reviewNotes: true,
          acceptedFindings: true,
          createdAt: true,
          completedAt: true,
          reviewedBy: { select: { name: true } },
        },
      },
    },
  })

  if (!study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  interface LatestJob {
    status: string
    provenance: { annotated_image_key?: string } | null
    [key: string]: unknown
  }

  const latestJob = (study.aiJobs as unknown as LatestJob[])[0] ?? null

  let status: 'UPLOADED' | 'PROCESSING' | 'ANALYZED' | 'REVIEWED'
  if (study.status === 'ANALYZED' || study.status === 'REVIEWED') {
    status = study.status
  } else if (
    latestJob &&
    (latestJob.status === 'PENDING' || latestJob.status === 'PROCESSING')
  ) {
    status = 'PROCESSING'
  } else {
    status = 'UPLOADED'
  }

  const annotatedKey = latestJob?.provenance?.annotated_image_key ?? null

  return NextResponse.json({
    study: {
      ...study,
      originalUrl: uploadUrl(study.originalKey),
      annotatedUrl: annotatedKey ? uploadUrl(annotatedKey) : null,
    },
    latestJob,
    status,
  })
}

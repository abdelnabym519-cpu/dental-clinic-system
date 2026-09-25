import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { uploadUrl } from '@/lib/storage'

// Phase 19A (D11) — read a study + its AI jobs, tenant-guarded.
//
// GET /api/imaging/studies/:id
//
// The study must belong to the caller's hospital; a foreign or missing id is
// a plain 404 (no existence oracle for other tenants).

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole()

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

  // Storage URLs: originals and AI outputs are served by the existing
  // tenant-guarded /api/uploads route (keyBelongsToHospital).
  const annotatedKey =
    (study.aiJobs as Array<{ provenance: { annotated_image_key?: string } | null }>)
      .map((j) => j.provenance?.annotated_image_key)
      .find(Boolean) ?? null

  return NextResponse.json({
    study: {
      ...study,
      originalUrl: uploadUrl(study.originalKey),
      annotatedUrl: annotatedKey ? uploadUrl(annotatedKey) : null,
    },
  })
}

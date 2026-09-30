/**
 * Phase 9 — Dental Brain: case understanding (§10–§13).
 *
 * GET /api/ai/intelligence/case?patientId=...&caseId=...
 *
 * Returns the bounded, trust-classed understanding of one case:
 * teeth, AI vs clinician-confirmed findings, symptoms, imaging, treatments
 * (done/pending/cancelled), follow-ups (due/overdue) and EXPLICIT missing
 * information. AI interpretation never silently becomes a fact; unknowns
 * are reported as unknowns (never fabricated).
 *
 * Security: session actor + tenant; patient scope re-validated server-side
 * (a PATIENT is pinned to their own linked patient); case scope re-validated
 * against tenant + patient. Typed INT_* errors with flat i18n messageKeys.
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { runDentalBrain } from '@/lib/ai/intelligence/dental-brain'
import { IntelligenceError } from '@/lib/ai/intelligence/types'
import {
  STAFF_ROLES,
  asString,
  intErr,
  resolveCaseScope,
  resolvePatientScope,
  writeAudit,
} from '@/lib/ai/intelligence/route-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireAuthAndRole([...STAFF_ROLES, 'PATIENT'])
  if (auth.error || !auth.user || !auth.hospitalId) {
    return intErr('INT_UNAUTHORIZED', 'unauthorized', auth.error ? (auth.error as { status?: number }).status ?? 401 : 401)
  }
  const { hospitalId, user } = auth
  const url = new URL(req.url)
  const patientId = asString(url.searchParams.get('patientId'))
  const caseId = asString(url.searchParams.get('caseId'))

  const patient = await resolvePatientScope(prisma, hospitalId, user, patientId)
  if (!patient) return intErr('INT_PATIENT_NOT_FOUND', 'patient not found in this tenant', 404)
  let caseScope: string | null = null
  if (caseId) {
    caseScope = await resolveCaseScope(prisma, hospitalId, patient.id, caseId)
    if (!caseScope) return intErr('INT_CASE_NOT_FOUND', 'case not found for this patient', 404)
  }

  try {
    const now = new Date()
    const { understanding } = await runDentalBrain(prisma as unknown as GraphPrisma, {
      hospitalId,
      patientId: patient.id,
      caseId: caseScope,
      actor: { id: user.id, role: user.role },
      procedureCategories: [],
      now,
      patientName: `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || patient.id,
    })
    writeAudit(prisma, {
      hospitalId,
      userId: user.id,
      action: 'AI_INTELLIGENCE_CASE_READ',
      entityType: 'TreatmentPlan',
      entityId: caseScope ?? patient.id,
      newValues: { missing: understanding.missingInformation.length, role: user.role },
    })
    return NextResponse.json({ hospitalId, patientId: patient.id, caseId: caseScope, understanding })
  } catch (e) {
    if (e instanceof IntelligenceError) return intErr(e.code, e.message, 400)
    console.error('AI intelligence case error:', e)
    return intErr('INT_GRAPH_BUILD_FAILED', 'internal error', 500)
  }
}

/**
 * Phase 9 — Dental Brain: structured clinical summary (§12–§13).
 *
 * GET /api/ai/intelligence/summary?patientId=...&caseId=...
 *
 * Returns the FIXED-SHAPE clinical summary (every section present as
 * AVAILABLE or NOT_AVAILABLE — nothing fabricated, nothing silently
 * omitted) plus the differential-SUPPORT structure, which is explicitly
 * clinical-decision-support: candidates with supporting/contradicting/
 * missing evidence. It is NEVER a confirmed diagnosis. A disclaimer key is
 * always attached for UI rendering.
 *
 * Security: same model as /intelligence/case (session actor + tenant,
 * server-side scope re-validation, typed INT_* errors, flat i18n keys).
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
    const { summary, differential } = await runDentalBrain(prisma as unknown as GraphPrisma, {
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
      action: 'AI_INTELLIGENCE_SUMMARY_READ',
      entityType: 'TreatmentPlan',
      entityId: caseScope ?? patient.id,
      newValues: { candidates: differential.candidates.length, role: user.role },
    })
    return NextResponse.json({
      hospitalId,
      patientId: patient.id,
      caseId: caseScope,
      summary,
      differential,
    })
  } catch (e) {
    if (e instanceof IntelligenceError) return intErr(e.code, e.message, 400)
    console.error('AI intelligence summary error:', e)
    return intErr('INT_GRAPH_BUILD_FAILED', 'internal error', 500)
  }
}

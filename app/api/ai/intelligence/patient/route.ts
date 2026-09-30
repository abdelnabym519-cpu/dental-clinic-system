/**
 * Phase 9 — Patient AI: longitudinal + current state (§15–§16).
 *
 * GET /api/ai/intelligence/patient?patientId=...
 *
 * Returns a bounded, trust-preserved patient intelligence bundle:
 *  - timeline (structured events with original trust classes; UNCONFIRMED
 *    AI findings stay AI_INTERPRETATION — they never become facts);
 *  - current state (active cases, current treatments, pending items,
 *    follow-ups due, recent findings, unresolved issues, memory refs);
 *  - unknownAreas — EXPLICIT list of what the record does not show
 *    (unknown stays unknown; nothing is invented).
 *
 * Security: session actor + tenant; patient scope re-validated
 * server-side (PATIENT pinned to their own linked patient).
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { buildCaseGraph, type GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { buildPatientIntelligence } from '@/lib/ai/intelligence/patient-ai'
import { IntelligenceError } from '@/lib/ai/intelligence/types'
import {
  STAFF_ROLES,
  asString,
  intErr,
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

  const patient = await resolvePatientScope(prisma, hospitalId, user, patientId)
  if (!patient) return intErr('INT_PATIENT_NOT_FOUND', 'patient not found in this tenant', 404)

  try {
    const now = new Date()
    const graph = await buildCaseGraph(prisma as unknown as GraphPrisma, {
      hospitalId,
      patientId: patient.id,
      caseId: null,
      actor: { id: user.id, role: user.role },
      now,
    })
    const intelligence = buildPatientIntelligence(graph, now)
    writeAudit(prisma, {
      hospitalId,
      userId: user.id,
      action: 'AI_INTELLIGENCE_PATIENT_READ',
      entityType: 'Patient',
      entityId: patient.id,
      newValues: { timeline: intelligence.timeline.length, unknownAreas: intelligence.unknownAreas.length, role: user.role },
    })
    return NextResponse.json({ hospitalId, patientId: patient.id, intelligence })
  } catch (e) {
    if (e instanceof IntelligenceError) return intErr(e.code, e.message, 400)
    console.error('AI intelligence patient error:', e)
    return intErr('INT_GRAPH_BUILD_FAILED', 'internal error', 500)
  }
}

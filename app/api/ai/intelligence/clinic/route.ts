/**
 * Phase 9 — Clinic Brain + Daily Command Center (§17–§21).
 *
 * GET /api/ai/intelligence/clinic
 *
 * Returns deterministic operational intelligence for the tenant's day:
 * appointments (by status / no-shows / utilization), queue, OVERDUE
 * follow-ups, pending treatments, doctor workload, AI findings awaiting
 * clinician review, unresolved tasks and bounded bottleneck signals.
 *
 * Honesty rules (§19): every section is AVAILABLE, NOT_AVAILABLE or
 * NOT_MEASURED — missing data is NEVER faked. Financial items are gated to
 * SUPER_ADMIN/ADMIN/ACCOUNTANT (the session role decides — a RECEPTIONIST
 * gets NOT_AVAILABLE, not a 403 leak of the data shape).
 *
 * Security: staff roles only; tenant from the session; typed INT_* errors.
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { buildClinicMetrics, buildCommandCenter, type ClinicPrisma } from '@/lib/ai/intelligence/clinic-brain'
import { IntelligenceError } from '@/lib/ai/intelligence/types'
import { intErr, writeAudit } from '@/lib/ai/intelligence/route-utils'

export const dynamic = 'force-dynamic'

const CLINIC_ROLES = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT']

export async function GET() {
  const auth = await requireAuthAndRole(CLINIC_ROLES)
  if (auth.error || !auth.user || !auth.hospitalId) {
    return intErr('INT_UNAUTHORIZED', 'unauthorized', auth.error ? (auth.error as { status?: number }).status ?? 401 : 401)
  }
  const { hospitalId, user } = auth

  try {
    const now = new Date()
    const db = prisma as unknown as ClinicPrisma
    const [metrics, commandCenter] = await Promise.all([
      buildClinicMetrics(db, { hospitalId, now, actorRole: user.role }),
      buildCommandCenter(db, { hospitalId, now, actorRole: user.role }),
    ])
    writeAudit(prisma, {
      hospitalId,
      userId: user.id,
      action: 'AI_INTELLIGENCE_CLINIC_READ',
      entityType: 'Hospital',
      entityId: hospitalId,
      newValues: { bottlenecks: metrics.bottlenecks.rows.length, role: user.role },
    })
    return NextResponse.json({ hospitalId, date: metrics.date, metrics, commandCenter })
  } catch (e) {
    if (e instanceof IntelligenceError) return intErr(e.code, e.message, 400)
    console.error('AI intelligence clinic error:', e)
    return intErr('INT_GRAPH_BUILD_FAILED', 'internal error', 500)
  }
}

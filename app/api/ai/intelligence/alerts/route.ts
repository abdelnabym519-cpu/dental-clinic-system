/**
 * Phase 9 — Bounded proactive intelligence (§17–§21, §34).
 *
 * GET /api/ai/intelligence/alerts
 *   → active (non-dismissed, unexpired) proactive alerts for the tenant.
 *
 * POST /api/ai/intelligence/alerts
 *   body: { op: 'run' }        → run the deterministic detection sweep
 *   body: { op: 'dismiss', alertId: string }
 *                                  → dismiss ONE alert (a STATE change — the
 *                                     audit row is never deleted)
 *
 * Safety model:
 *  - The sweep is PURE RULES over structured data (no LLM, no fabrication).
 *  - An alert is a SIGNAL only. It NEVER triggers an autonomous action —
 *    executing anything (contact, booking) is a separate ACTION through the
 *    Phase-1 approval pipeline (§34).
 *  - Deduplicated by a stable key per (tenant, alertType, scope); idempotent.
 *  - Tenant comes from the session; dismissal is tenant-pinned.
 *  - Typed INT_* errors with flat i18n messageKeys (ar/en).
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { runProactiveIntelligence, dismissAlert, type AlertPrisma } from '@/lib/ai/intelligence/proactive'
import { IntelligenceError } from '@/lib/ai/intelligence/types'
import { STAFF_ROLES, asString, intErr, writeAudit } from '@/lib/ai/intelligence/route-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAuthAndRole(STAFF_ROLES)
  if (auth.error || !auth.user || !auth.hospitalId) {
    return intErr('INT_UNAUTHORIZED', 'unauthorized', auth.error ? (auth.error as { status?: number }).status ?? 401 : 401)
  }
  const { hospitalId } = auth
  const now = new Date()
  const rows = (await prisma.aIInsight.findMany({
    where: {
      hospitalId,
      category: { in: ['CLINICAL', 'OPERATIONAL', 'PATIENT'] },
      dismissed: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })) as Record<string, unknown>[]
  const alerts = rows
    .filter((r) => (r.data as Record<string, unknown> | null)?.kind === 'PROACTIVE_ALERT')
    .map((r) => ({
      id: r.id,
      category: r.category,
      severity: r.severity,
      titleKey: r.title,
      description: r.description,
      data: r.data,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }))
  return NextResponse.json({ hospitalId, count: alerts.length, alerts })
}

export async function POST(req: Request) {
  const auth = await requireAuthAndRole(STAFF_ROLES)
  if (auth.error || !auth.user || !auth.hospitalId) {
    return intErr('INT_UNAUTHORIZED', 'unauthorized', auth.error ? (auth.error as { status?: number }).status ?? 401 : 401)
  }
  const { hospitalId, user } = auth
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return intErr('INT_INVALID_PARAMS', 'invalid body', 400)
  }
  const op = asString(body.op)

  try {
    if (op === 'run') {
      const now = new Date()
      const result = await runProactiveIntelligence(prisma as unknown as AlertPrisma, { hospitalId, now, actorId: user.id })
      writeAudit(prisma, {
        hospitalId,
        userId: user.id,
        action: 'AI_INTELLIGENCE_ALERTS_RUN',
        entityType: 'Hospital',
        entityId: hospitalId,
        newValues: { created: result.created, deduplicated: result.deduplicated },
      })
      return NextResponse.json({
        hospitalId,
        result: { detected: result.detected.length, created: result.created, deduplicated: result.deduplicated },
      })
    }

    if (op === 'dismiss') {
      const alertId = asString(body.alertId)
      if (!alertId) return intErr('INT_INVALID_PARAMS', 'alertId required', 400)
      const res = await dismissAlert(prisma as unknown as AlertPrisma, { hospitalId, alertId, actorId: user.id })
      if (!res.ok) return intErr('INT_ALERT_NOT_FOUND', 'alert not found', 404)
      writeAudit(prisma, {
        hospitalId,
        userId: user.id,
        action: 'AI_INTELLIGENCE_ALERT_DISMISS',
        entityType: 'AIInsight',
        entityId: alertId,
        newValues: { state: res.state },
      })
      return NextResponse.json({ hospitalId, ok: true, state: res.state })
    }

    return intErr('INT_INVALID_PARAMS', 'unknown op', 400)
  } catch (e) {
    if (e instanceof IntelligenceError) return intErr(e.code, e.message, 400)
    console.error('AI intelligence alerts error:', e)
    return intErr('INT_PROACTIVE_FAILED', 'internal error', 500)
  }
}

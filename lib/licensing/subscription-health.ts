/**
 * Phase 9 licensing — daily subscription health check (the transition
 * authority).
 *
 * Moves tenants through the lifecycle and records every move in the license
 * audit log (performedBy = null means "system"):
 *
 *   ACTIVE / TRIAL  with periodEnd < now            -> GRACE_PERIOD (GRACE_STARTED)
 *   GRACE_PERIOD    with grace (periodEnd + N days) -> EXPIRED      (EXPIRED)
 *
 * Suspended/cancelled tenants are manual states — the cron never touches them.
 * The core is a pure function of (db, now) so the cron route and the unit
 * tests drive the exact same code.
 */
import type { LicensingPrisma, SubscriptionRow } from './types'

export interface HealthCheckResult {
  transitioned: number
  warnings: number
  errors: number
}

export async function runSubscriptionHealthCheck(
  db: LicensingPrisma,
  now: Date = new Date()
): Promise<HealthCheckResult> {
  const results: HealthCheckResult = { transitioned: 0, warnings: 0, errors: 0 }

  // 1. ACTIVE/TRIAL past their period end -> GRACE_PERIOD
  const expiredActive = await db.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'TRIAL'] },
      currentPeriodEnd: { lt: now },
    },
  })

  for (const sub of expiredActive) {
    try {
      await db.$transaction([
        db.subscription.update({
          where: { id: sub.id },
          data: { status: 'GRACE_PERIOD', updatedAt: now },
        }),
        db.licenseAuditLog.create({
          data: {
            subscriptionId: sub.id,
            action: 'GRACE_STARTED',
            previousStatus: sub.status,
            newStatus: 'GRACE_PERIOD',
            performedBy: null,
            notes: `Auto-transitioned to GRACE_PERIOD by cron at ${now.toISOString()}`,
          },
        }),
      ])
      results.transitioned += 1
    } catch {
      results.errors += 1
    }
  }

  // 2. GRACE_PERIOD whose grace window has also ended -> EXPIRED (hard block)
  const inGrace = await db.subscription.findMany({
    where: { status: 'GRACE_PERIOD' },
  })

  for (const sub of inGrace) {
    const graceEnd = new Date(sub.currentPeriodEnd)
    graceEnd.setDate(graceEnd.getDate() + sub.gracePeriodDays)
    if (now > graceEnd) {
      try {
        await db.$transaction([
          db.subscription.update({
            where: { id: sub.id },
            data: { status: 'EXPIRED', updatedAt: now },
          }),
          db.licenseAuditLog.create({
            data: {
              subscriptionId: sub.id,
              action: 'EXPIRED',
              previousStatus: 'GRACE_PERIOD',
              newStatus: 'EXPIRED',
              performedBy: null,
              notes: `Hard-expired by cron at ${now.toISOString()}`,
            },
          }),
        ])
        results.transitioned += 1
      } catch {
        results.errors += 1
      }
    }
  }

  // 3. Monitoring counters: how many healthy tenants expire within the
  //    warning windows (7 / 3 / 1 days).
  for (const days of [7, 3, 1]) {
    const target = new Date(now)
    target.setDate(target.getDate() + days)
    const count = await db.subscription.count({
      where: {
        status: { in: ['ACTIVE', 'TRIAL'] },
        currentPeriodEnd: { gte: now, lte: target },
      },
    })
    results.warnings += count
  }

  return results
}

export type { SubscriptionRow }

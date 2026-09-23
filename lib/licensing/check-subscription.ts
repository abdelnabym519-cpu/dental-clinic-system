/**
 * Phase 9 licensing — tenant-level subscription check.
 *
 * Answers one question: "may this hospital use the system right now?"
 *
 * Semantics (the cron job is the transition authority — it moves
 * ACTIVE/TRIAL -> GRACE_PERIOD -> EXPIRED):
 *   - no subscription row          -> denied (NOT_FOUND)
 *   - ACTIVE / TRIAL               -> allowed; daysRemaining until period end
 *   - GRACE_PERIOD                 -> allowed; daysRemaining is NEGATIVE
 *                                     (how many grace days are left)
 *   - EXPIRED / SUSPENDED / CANCELLED -> denied
 *
 * The check trusts the stored status and never mutates anything. It is safe
 * to call from server components, API routes and the dashboard layout gate.
 */
import { prisma as defaultPrisma } from '@/lib/prisma'
import type { LicensingPrisma, SubscriptionCheckResult, SubscriptionStatus } from './types'

const DAY_MS = 1000 * 60 * 60 * 24

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS)
}

export async function checkHospitalSubscription(
  hospitalId: string,
  db: LicensingPrisma = defaultPrisma as unknown as LicensingPrisma,
  now: Date = new Date()
): Promise<SubscriptionCheckResult> {
  const subscription = await db.subscription.findUnique({
    where: { hospitalId },
  })

  if (!subscription) {
    return { allowed: false, reason: 'NOT_FOUND', status: null }
  }

  switch (subscription.status) {
    case 'ACTIVE':
    case 'TRIAL': {
      const daysRemaining = daysUntil(subscription.currentPeriodEnd, now)
      return { allowed: true, daysRemaining, status: subscription.status }
    }

    case 'GRACE_PERIOD': {
      const graceEnd = new Date(subscription.currentPeriodEnd)
      graceEnd.setDate(graceEnd.getDate() + subscription.gracePeriodDays)
      const graceRemaining = daysUntil(graceEnd, now)
      // Still usable during grace, but the UI must warn: negative remaining.
      return { allowed: true, daysRemaining: -Math.max(graceRemaining, 0), status: 'GRACE_PERIOD' }
    }

    case 'EXPIRED':
    case 'SUSPENDED':
    case 'CANCELLED':
      return { allowed: false, reason: subscription.status, status: subscription.status }

    // Legacy pre-Phase 9 statuses: treat unknown state as blocked (fail
    // closed) rather than guessing a tenant is fine.
    default:
      return {
        allowed: false,
        reason: 'EXPIRED',
        status: subscription.status as SubscriptionStatus,
      }
  }
}

/** Statuses that must never be used by a user facing the system. */
export const BLOCKING_STATUSES: SubscriptionStatus[] = ['EXPIRED', 'SUSPENDED', 'CANCELLED']

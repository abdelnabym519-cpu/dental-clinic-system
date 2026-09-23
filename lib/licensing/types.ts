/**
 * Phase 9 licensing — structural types.
 *
 * The Prisma client is deliberately NOT statically imported here (same
 * convention as lib/prisma.ts and scripts/seed-check.ts): this module must
 * stay importable in every environment, including sandboxes where the
 * generated client is missing, and trivially testable with fakes.
 */

// Mirrors prisma/schema.prisma `enum SubscriptionStatus` (Phase 9 values
// included). Kept as a string union so rows can be compared without the
// generated client's types.
export type SubscriptionStatus =
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'TRIALING'
  | 'TRIAL'
  | 'GRACE_PERIOD'
  | 'SUSPENDED'

export interface SubscriptionRow {
  id: string
  hospitalId: string
  status: SubscriptionStatus
  currentPeriodEnd: Date
  gracePeriodDays: number
}

/** The minimal client surface the licensing checks need. */
export interface LicensingPrisma {
  subscription: {
    findUnique(args: { where: { hospitalId: string } }): Promise<SubscriptionRow | null>
    findMany(args?: { where?: Record<string, unknown> }): Promise<SubscriptionRow[]>
    update(args: {
      where: { id?: string; hospitalId?: string }
      data: Record<string, unknown>
    }): Promise<unknown>
    count(args?: { where?: Record<string, unknown> }): Promise<number>
  }
  licenseAuditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
    findMany(args?: {
      where?: Record<string, unknown>
      orderBy?: unknown
      take?: number
      skip?: number
    }): Promise<Record<string, unknown>[]>
  }
  $transaction<T>(operations: unknown[]): Promise<T>
}

export type DenyReason = 'EXPIRED' | 'SUSPENDED' | 'CANCELLED' | 'NOT_FOUND'

export type SubscriptionCheckResult =
  | { allowed: true; daysRemaining: number | null; status: SubscriptionStatus }
  | { allowed: false; reason: DenyReason; status: SubscriptionStatus | null }

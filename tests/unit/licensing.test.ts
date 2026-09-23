// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { checkHospitalSubscription } from '@/lib/licensing/check-subscription'
import { runSubscriptionHealthCheck } from '@/lib/licensing/subscription-health'
import type { LicensingPrisma, SubscriptionRow } from '@/lib/licensing/types'

// ---------------------------------------------------------------------------
// Phase 9 licensing — check semantics and the cron transition authority.
// All persistence is a structural fake (no Prisma client, no DB needed):
// the assertions pin the lifecycle contract, not any storage detail.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-23T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function daysFromNow(days: number, base: Date = NOW): Date {
  return new Date(base.getTime() + days * DAY)
}

interface DbFixture {
  row: (SubscriptionRow & Record<string, unknown>) | null
  update: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  findMany: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
  $transaction: ReturnType<typeof vi.fn>
}

function makeDb(row: DbFixture['row'], fixture: Partial<DbFixture> = {}): LicensingPrisma {
  // update/create are called when the caller BUILDS the operations array
  // (db.subscription.update({...}) runs immediately), so plain recording
  // mocks are enough; $transaction just awaits them.
  const update = fixture.update ?? vi.fn().mockResolvedValue({})
  const create = fixture.create ?? vi.fn().mockResolvedValue({})
  const findMany = fixture.findMany ?? vi.fn().mockResolvedValue([])
  const count = fixture.count ?? vi.fn().mockResolvedValue(0)
  const $transaction =
    fixture.$transaction ??
    vi.fn(async (ops: Promise<unknown>[]) => {
      await Promise.all(ops)
      return ops
    })

  return {
    subscription: {
      findUnique: vi.fn().mockResolvedValue(row),
      findMany,
      update,
      count,
    },
    licenseAuditLog: {
      create,
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction,
  } as unknown as LicensingPrisma
}

function sub(partial: Partial<SubscriptionRow> & { hospitalId?: string }): SubscriptionRow {
  return {
    id: 'sub-1',
    hospitalId: partial.hospitalId ?? 'h-1',
    status: 'ACTIVE',
    currentPeriodEnd: daysFromNow(15),
    gracePeriodDays: 3,
    ...partial,
  }
}

describe('checkHospitalSubscription', () => {
  it('allows ACTIVE with days remaining and reports the count', async () => {
    const db = makeDb(sub({ status: 'ACTIVE', currentPeriodEnd: daysFromNow(15) }))
    const result = await checkHospitalSubscription('h-1', db, NOW)
    expect(result).toEqual({ allowed: true, daysRemaining: 15, status: 'ACTIVE' })
  })

  it('allows TRIAL the same way (trial is a usable status)', async () => {
    const db = makeDb(sub({ status: 'TRIAL', currentPeriodEnd: daysFromNow(10) }))
    const result = await checkHospitalSubscription('h-1', db, NOW)
    expect(result).toEqual({ allowed: true, daysRemaining: 10, status: 'TRIAL' })
  })

  it('trusts the stored status even past the period end (cron is the transition authority)', async () => {
    const db = makeDb(sub({ status: 'ACTIVE', currentPeriodEnd: daysFromNow(-2) }))
    const result = await checkHospitalSubscription('h-1', db, NOW)
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.daysRemaining).toBe(-2)
  })

  it('allows GRACE_PERIOD with NEGATIVE daysRemaining (grace days left)', async () => {
    // Expired 1 day ago, 3-day grace -> 2 grace days remain.
    const db = makeDb(
      sub({ status: 'GRACE_PERIOD', currentPeriodEnd: daysFromNow(-1), gracePeriodDays: 3 })
    )
    const result = await checkHospitalSubscription('h-1', db, NOW)
    expect(result).toEqual({ allowed: true, daysRemaining: -2, status: 'GRACE_PERIOD' })
  })

  it.each(['EXPIRED', 'SUSPENDED', 'CANCELLED'] as const)(
    'denies %s with the matching reason',
    async (status) => {
      const db = makeDb(sub({ status, currentPeriodEnd: daysFromNow(-10) }))
      const result = await checkHospitalSubscription('h-1', db, NOW)
      expect(result).toEqual({ allowed: false, reason: status, status })
    }
  )

  it('denies a hospital with no subscription row (NOT_FOUND, fail closed)', async () => {
    const db = makeDb(null)
    const result = await checkHospitalSubscription('missing-hospital', db, NOW)
    expect(result).toEqual({ allowed: false, reason: 'NOT_FOUND', status: null })
  })

  it('fails closed on legacy pre-Phase-9 statuses', async () => {
    const db = makeDb(sub({ status: 'PAST_DUE' as never, currentPeriodEnd: daysFromNow(-10) }))
    const result = await checkHospitalSubscription('h-1', db, NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('EXPIRED')
  })
})

describe('runSubscriptionHealthCheck (cron transition authority)', () => {
  it('moves ACTIVE past its period end into GRACE_PERIOD with an audit entry', async () => {
    const expired = sub({ status: 'ACTIVE', currentPeriodEnd: daysFromNow(-1) })
    const db = makeDb(null, {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([expired]) // expiredActive
        .mockResolvedValueOnce([]), // inGrace
      count: vi.fn().mockResolvedValue(0),
    })

    const results = await runSubscriptionHealthCheck(db, NOW)

    expect(results).toEqual({ transitioned: 1, warnings: 0, errors: 0 })
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'GRACE_PERIOD' }) })
    )
    const audit = (db.licenseAuditLog.create as any).mock.calls[0][0].data
    expect(audit.action).toBe('GRACE_STARTED')
    expect(audit.previousStatus).toBe('ACTIVE')
    expect(audit.newStatus).toBe('GRACE_PERIOD')
    expect(audit.performedBy).toBeNull()
  })

  it('moves GRACE_PERIOD into EXPIRED only after the grace window ends', async () => {
    const graceOver = sub({
      status: 'GRACE_PERIOD',
      currentPeriodEnd: daysFromNow(-4),
      gracePeriodDays: 3, // grace ended 1 day ago
    })
    const db = makeDb(null, {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([]) // no expired active
        .mockResolvedValueOnce([graceOver]),
      count: vi.fn().mockResolvedValue(0),
    })

    const results = await runSubscriptionHealthCheck(db, NOW)

    expect(results.transitioned).toBe(1)
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
    )
  })

  it('leaves a GRACE_PERIOD tenant untouched while grace remains', async () => {
    const stillGrace = sub({
      status: 'GRACE_PERIOD',
      currentPeriodEnd: daysFromNow(-1),
      gracePeriodDays: 3,
    })
    const db = makeDb(null, {
      findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([stillGrace]),
      count: vi.fn().mockResolvedValue(0),
    })

    const results = await runSubscriptionHealthCheck(db, NOW)
    expect(results).toEqual({ transitioned: 0, warnings: 0, errors: 0 })
    expect(db.subscription.update).not.toHaveBeenCalled()
    expect(db.licenseAuditLog.create).not.toHaveBeenCalled()
  })

  it('counts a transition failure as an error and keeps going', async () => {
    const expired = sub({ status: 'ACTIVE', currentPeriodEnd: daysFromNow(-1) })
    const db = makeDb(null, {
      findMany: vi.fn().mockResolvedValueOnce([expired]).mockResolvedValueOnce([]),
      count: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn().mockRejectedValue(new Error('db down')),
    })

    const results = await runSubscriptionHealthCheck(db, NOW)
    expect(results).toEqual({ transitioned: 0, warnings: 0, errors: 1 })
  })

  it('reports tenants expiring within the warning windows', async () => {
    const db = makeDb(null, {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi
        .fn()
        .mockResolvedValueOnce(2) // within 7 days
        .mockResolvedValueOnce(1) // within 3 days
        .mockResolvedValueOnce(0), // within 1 day
    })

    const results = await runSubscriptionHealthCheck(db, NOW)
    expect(results.warnings).toBe(3)
  })
})

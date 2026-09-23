// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 9 licensing — API surface: /api/licensing/status (tenant self-check)
// and the SUPER_ADMIN-only management endpoints. Auth + persistence mocked;
// the real check logic is covered in tests/unit/licensing.test.ts.

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

vi.mock('@/lib/licensing/check-subscription', () => ({
  checkHospitalSubscription: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { auth } from '@/lib/auth'
import { checkHospitalSubscription } from '@/lib/licensing/check-subscription'
import { prisma } from '@/lib/prisma'
import { GET as statusGET } from '@/app/api/licensing/status/route'
import { GET as hospitalsGET } from '@/app/api/super-admin/hospitals/route'
import { GET as auditGET } from '@/app/api/super-admin/audit-logs/route'
import {
  POST as subPOST,
  PATCH as subPATCH,
} from '@/app/api/super-admin/hospitals/[id]/subscription/route'

const SUPER_ADMIN = {
  user: {
    id: 'u-super',
    email: 'superadmin@dentora.com',
    role: 'SUPER_ADMIN',
    hospitalId: null,
    isSuperAdmin: true,
  },
}
const ADMIN = {
  user: {
    id: 'u-admin',
    email: 'admin@dentora-dental.com',
    role: 'ADMIN',
    hospitalId: 'h-1',
    isSuperAdmin: false,
  },
}

// One shared structural fake; each test resets the surface it cares about.
// $transaction supports both forms the routes use: an operations array and
// an interactive callback (tx receives the fake itself).
beforeEach(() => {
  vi.clearAllMocks()
  prisma.hospital = {
    findUnique: vi.fn().mockResolvedValue({ id: 'h-1', name: 'Demo' }),
    findMany: vi.fn().mockResolvedValue([]),
  }
  prisma.subscription = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'sub-new' }),
    update: vi.fn().mockResolvedValue({ id: 'sub-1' }),
  }
  prisma.licenseAuditLog = {
    create: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  }
  prisma.$transaction = vi.fn(async (fnOrOps) =>
    typeof fnOrOps === 'function' ? fnOrOps(prisma) : Promise.all(fnOrOps)
  )
})

describe('GET /api/licensing/status', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    const res = await statusGET()
    expect(res.status).toBe(401)
  })

  it('returns 401 for SUPER_ADMIN (no hospital to check)', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    const res = await statusGET()
    expect(res.status).toBe(401)
    expect(checkHospitalSubscription).not.toHaveBeenCalled()
  })

  it('returns the check result for an authenticated hospital user', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN)
    vi.mocked(checkHospitalSubscription).mockResolvedValue({
      allowed: true,
      daysRemaining: 5,
      status: 'ACTIVE',
    })
    const res = await statusGET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      allowed: true,
      daysRemaining: 5,
      status: 'ACTIVE',
    })
    expect(checkHospitalSubscription).toHaveBeenCalledWith('h-1')
  })
})

describe('GET /api/super-admin/hospitals', () => {
  it('returns 403 for a hospital ADMIN', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN)
    const res = await hospitalsGET(new Request('http://localhost/api/super-admin/hospitals'))
    expect(res.status).toBe(403)
  })

  it('returns every hospital with subscription for SUPER_ADMIN', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    prisma.hospital.findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'h-1', name: 'Demo', subscription: { status: 'ACTIVE' } }])
    const res = await hospitalsGET(new Request('http://localhost/api/super-admin/hospitals'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].subscription.status).toBe('ACTIVE')
  })
})

describe('GET /api/super-admin/audit-logs', () => {
  it('returns 403 for non-super-admin', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN)
    const res = await auditGET(new Request('http://localhost/api/super-admin/audit-logs'))
    expect(res.status).toBe(403)
  })

  it('returns the audit trail for SUPER_ADMIN (newest first)', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    prisma.licenseAuditLog.findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'log-1', action: 'CREATED', newStatus: 'ACTIVE' }])
    const res = await auditGET(new Request('http://localhost/api/super-admin/audit-logs?take=50'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].action).toBe('CREATED')
    expect(prisma.licenseAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 50 })
    )
  })
})

describe('POST/PATCH /api/super-admin/hospitals/:id/subscription', () => {
  const params = Promise.resolve({ id: 'h-1' })

  it('PATCH: 403 for non-super-admin', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN)
    const res = await subPATCH(
      new Request('http://localhost/api/super-admin/hospitals/h-1/subscription', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'SUSPENDED' }),
      }),
      { params }
    )
    expect(res.status).toBe(403)
  })

  it('PATCH: 422 on an invalid body', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    const res = await subPATCH(
      new Request('http://localhost/api/super-admin/hospitals/h-1/subscription', {
        method: 'PATCH',
        body: JSON.stringify({ gracePeriodDays: 99 }),
      }),
      { params }
    )
    expect(res.status).toBe(422)
  })

  it('PATCH: 404 when the hospital has no subscription', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    prisma.subscription.findUnique = vi.fn().mockResolvedValue(null)
    const res = await subPATCH(
      new Request('http://localhost/api/super-admin/hospitals/h-1/subscription', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'SUSPENDED' }),
      }),
      { params }
    )
    expect(res.status).toBe(404)
  })

  it('PATCH: updates the subscription and records an audit entry with the acting user', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    prisma.subscription.findUnique = vi.fn().mockResolvedValue({
      id: 'sub-1',
      hospitalId: 'h-1',
      status: 'ACTIVE',
    })
    const res = await subPATCH(
      new Request('http://localhost/api/super-admin/hospitals/h-1/subscription', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'SUSPENDED', notes: 'billing dispute' }),
      }),
      { params }
    )
    expect(res.status).toBe(200)

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hospitalId: 'h-1' },
        data: expect.objectContaining({
          status: 'SUSPENDED',
          notes: 'billing dispute',
          managedBy: 'u-super',
        }),
      })
    )
    expect(prisma.licenseAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'sub-1',
        action: 'STATUS_CHANGED_TO_SUSPENDED',
        previousStatus: 'ACTIVE',
        newStatus: 'SUSPENDED',
        performedBy: 'u-super',
      }),
    })
  })

  it('POST: 409 when a subscription already exists', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    prisma.subscription.findUnique = vi.fn().mockResolvedValue({ id: 'sub-1' })
    const res = await subPOST(
      new Request('http://localhost/api/super-admin/hospitals/h-1/subscription', {
        method: 'POST',
        body: JSON.stringify({
          currentPeriodStart: '2026-09-01T00:00:00.000Z',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        }),
      }),
      { params }
    )
    expect(res.status).toBe(409)
  })

  it('POST: 404 for an unknown hospital', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    prisma.hospital.findUnique = vi.fn().mockResolvedValue(null)
    const res = await subPOST(
      new Request('http://localhost/api/super-admin/hospitals/missing/subscription', {
        method: 'POST',
        body: JSON.stringify({
          currentPeriodStart: '2026-09-01T00:00:00.000Z',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        }),
      }),
      { params }
    )
    expect(res.status).toBe(404)
  })

  it('POST: creates the subscription and writes a CREATED audit entry (201)', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN)
    prisma.hospital.findUnique = vi.fn().mockResolvedValue({ id: 'h-1', name: 'Demo' })
    prisma.subscription.findUnique = vi.fn().mockResolvedValue(null)
    const createdSub = { id: 'sub-new', hospitalId: 'h-1', status: 'ACTIVE' }
    prisma.subscription.create = vi.fn().mockResolvedValue(createdSub)

    const res = await subPOST(
      new Request('http://localhost/api/super-admin/hospitals/h-1/subscription', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'PROFESSIONAL',
          currentPeriodStart: '2026-09-01T00:00:00.000Z',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        }),
      }),
      { params }
    )
    expect(res.status).toBe(201)
    expect(prisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hospitalId: 'h-1',
          managedBy: 'u-super',
        }),
      })
    )
    expect(prisma.licenseAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'sub-new',
        action: 'CREATED',
        newStatus: 'ACTIVE',
        performedBy: 'u-super',
      }),
    })
  })
})

// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

// ---------------------------------------------------------------------------
// Phase 9 licensing — the SERVER-SIDE GATES (the security core of the phase):
//
//   app/(dashboard)/layout.tsx     tenant gate (Node runtime — the Edge
//                                  middleware is intentionally Prisma-free)
//   app/super-admin/layout.tsx     SUPER_ADMIN-only guard
//   app/subscription-expired/      never shown to SUPER_ADMIN / logged-out
//
// Next's redirect() throws (NEXT_REDIRECT digest), so a gate is proven by
// invoking the server component directly and asserting where it throws — or
// that it renders at all when the tenant is allowed. The REAL
// checkHospitalSubscription runs against a mocked prisma, so these tests
// pin the full gate contract, not just the redirect lines.
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

// The global setup mock of next/navigation only carries the client hooks;
// server components under test need `redirect` too. This file-level mock
// supersedes it for this file and reproduces Next's redirect contract:
// throw an error whose digest encodes the target (NEXT_REDIRECT;<method>;<url>;).
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useParams: () => ({}),
  redirect: (url: string) => {
    const err: any = new Error(`NEXT_REDIRECT;replace;${url};`)
    err.digest = `NEXT_REDIRECT;replace;${url};`
    throw err
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    hospital: { findUnique: vi.fn() },
    subscription: { findUnique: vi.fn() },
    licenseAuditLog: { findMany: vi.fn() },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const DashboardLayout = (await import('@/app/(dashboard)/layout')).default
const SuperAdminLayout = (await import('@/app/super-admin/layout')).default
const SubscriptionExpiredPage = (await import('@/app/subscription-expired/page')).default

const CHILD = React.createElement('div', null, 'page')

const SUPER_ADMIN_SESSION = {
  user: {
    id: 'u-super',
    email: 'superadmin@dentora.com',
    role: 'SUPER_ADMIN',
    hospitalId: null,
    isSuperAdmin: true,
  },
}
const ADMIN_SESSION = {
  user: {
    id: 'u-admin',
    email: 'admin@dentora-dental.com',
    role: 'ADMIN',
    hospitalId: 'h-1',
    isSuperAdmin: false,
  },
}

/** Call a server component and return the redirect target if it threw one. */
async function redirectOf(component) {
  try {
    await component({ children: CHILD })
    return null
  } catch (err) {
    const digest = err?.digest ?? ''
    if (digest.startsWith('NEXT_REDIRECT')) {
      const url = digest.split(';')[2]
      expect(url).toBeTruthy()
      return url
    }
    throw err
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default tenant fixture: an ONBOARDED hospital with an ACTIVE subscription
  // — each test overrides exactly what it is testing.
  prisma.hospital.findUnique.mockResolvedValue({
    id: 'h-1',
    name: 'Demo',
    plan: 'PROFESSIONAL',
    logo: null,
    onboardingCompleted: true,
  })
  prisma.subscription.findUnique.mockResolvedValue({
    id: 'sub-1',
    hospitalId: 'h-1',
    status: 'ACTIVE',
    currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    gracePeriodDays: 3,
  })
})

describe('dashboard layout — tenant subscription gate', () => {
  it('sends anonymous visitors to /login', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    await expect(redirectOf(DashboardLayout)).resolves.toBe('/login')
  })

  it('sends SUPER_ADMIN to /super-admin and never touches the tenant DB', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN_SESSION)
    await expect(redirectOf(DashboardLayout)).resolves.toBe('/super-admin')
    // Bypass proof: the gate runs before any hospital/subscription read.
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled()
    expect(prisma.hospital.findUnique).not.toHaveBeenCalled()
  })

  it('sends a hospital user with EXPIRED subscription to /subscription-expired', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN_SESSION)
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      hospitalId: 'h-1',
      status: 'EXPIRED',
      currentPeriodEnd: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      gracePeriodDays: 3,
    })
    await expect(redirectOf(DashboardLayout)).resolves.toBe('/subscription-expired')
  })

  it('sends SUSPENDED tenants to /subscription-expired (manual block by SUPER_ADMIN)', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN_SESSION)
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      hospitalId: 'h-1',
      status: 'SUSPENDED',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      gracePeriodDays: 3,
    })
    await expect(redirectOf(DashboardLayout)).resolves.toBe('/subscription-expired')
  })

  it('FAILS CLOSED: a hospital with no subscription row is blocked', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN_SESSION)
    prisma.subscription.findUnique.mockResolvedValue(null)
    await expect(redirectOf(DashboardLayout)).resolves.toBe('/subscription-expired')
  })

  it('lets an ACTIVE tenant through (renders the shell)', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN_SESSION)
    // default fixture = ACTIVE + 15 days -> must NOT redirect
    const url = await redirectOf(DashboardLayout)
    expect(url).toBeNull()
  })

  it('lets a GRACE_PERIOD tenant through (still usable, banner warns)', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN_SESSION)
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      hospitalId: 'h-1',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      gracePeriodDays: 3,
    })
    const url = await redirectOf(DashboardLayout)
    expect(url).toBeNull()
  })

  it('sends a logged-in user without a hospital (invalid state) to /login', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: 'u-x',
        email: 'x@dentora.com',
        role: 'RECEPTIONIST',
        hospitalId: null,
        isSuperAdmin: false,
      },
    })
    await expect(redirectOf(DashboardLayout)).resolves.toBe('/login')
  })
})

describe('super-admin layout — SUPER_ADMIN-only guard', () => {
  it('sends anonymous visitors to /login', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    await expect(redirectOf(SuperAdminLayout)).resolves.toBe('/login')
  })

  it('sends a hospital ADMIN to /login (not their workspace — this area is not theirs)', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN_SESSION)
    await expect(redirectOf(SuperAdminLayout)).resolves.toBe('/login')
  })

  it('renders for SUPER_ADMIN', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN_SESSION)
    const url = await redirectOf(SuperAdminLayout)
    expect(url).toBeNull()
  })
})

describe('subscription-expired page — reachability rules', () => {
  it('never shows SUPER_ADMIN this page: redirects to /super-admin', async () => {
    vi.mocked(auth).mockResolvedValue(SUPER_ADMIN_SESSION)
    await expect(redirectOf(SubscriptionExpiredPage)).resolves.toBe('/super-admin')
  })

  it('sends logged-out visitors to /login', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    await expect(redirectOf(SubscriptionExpiredPage)).resolves.toBe('/login')
  })

  it('renders for a blocked hospital user (the page is the intended landing)', async () => {
    vi.mocked(auth).mockResolvedValue(ADMIN_SESSION)
    const url = await redirectOf(SubscriptionExpiredPage)
    expect(url).toBeNull()
  })
})

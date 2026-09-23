// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Phase 9 licensing — the in-app expiry warning banner (ADMIN role).
// Session + fetch are mocked; t() resolves through the REAL en dictionary so
// the asserted text is the actual shipped copy.
// ---------------------------------------------------------------------------

vi.mock('@/components/providers/language-provider', async () => {
  const en = (await import('../../locales/en.json')).default
  return {
    useLanguage: () => ({
      locale: 'en-EG',
      dir: 'ltr',
      t: (key: string, vars?: Record<string, string | number>) => {
        let template: string = en[key] ?? key
        if (vars)
          template = template.replace(/\{(\w+)\}/g, (m, name) =>
            name in vars ? String(vars[name]) : m
          )
        return template
      },
      setLocale: vi.fn(),
    }),
    LOCALE_COOKIE: 'dentora-locale',
  }
})

const sessionState: { data: any } = { data: null }
vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  global.fetch = fetchMock
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
})

afterEach(() => {
  vi.restoreAllMocks()
  sessionState.data = null
})

function renderBanner() {
  return render(
    <React.Fragment>
      // Lazy import so the mocked useSession is picked up.
      <BannerLazy />
    </React.Fragment>
  )
}

// Indirection keeps the mock boundary explicit and the render helper tiny.
import { SubscriptionWarningBanner as BannerLazy } from '@/components/licensing/SubscriptionWarningBanner'

function setSession(role: string, hospitalId = 'h-1') {
  sessionState.data = { user: { role, hospitalId } }
}

function statusResponse(daysRemaining: number | null, status: string) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ allowed: true, daysRemaining, status }),
  })
}

describe('SubscriptionWarningBanner', () => {
  it('shows the expiry warning for ADMIN with 7 or fewer days left', async () => {
    setSession('ADMIN')
    statusResponse(5, 'ACTIVE')
    renderBanner()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('5')
    expect(alert.textContent).toContain('Contact support')
  })

  it('shows nothing when more than 7 days remain', async () => {
    setSession('ADMIN')
    statusResponse(20, 'ACTIVE')
    renderBanner()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows the grace-period warning (negative daysRemaining) after expiry', async () => {
    setSession('ADMIN')
    statusResponse(-2, 'GRACE_PERIOD')
    renderBanner()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('2')
    // Grace copy says the subscription HAS expired — not "expires in".
    expect(alert.textContent).toContain('has expired')
  })

  it('is silent for non-ADMIN roles and never fetches', async () => {
    setSession('DOCTOR')
    renderBanner()

    expect(fetchMock).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('is silent for SUPER_ADMIN (no hospital subscription)', async () => {
    sessionState.data = { user: { role: 'SUPER_ADMIN', hospitalId: null } }
    renderBanner()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails silently on a fetch error — never blocks the UI', async () => {
    setSession('ADMIN')
    fetchMock.mockRejectedValue(new Error('network down'))
    renderBanner()

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('is silent on a 401 (e.g. session expired mid-page)', async () => {
    setSession('ADMIN')
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    renderBanner()

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

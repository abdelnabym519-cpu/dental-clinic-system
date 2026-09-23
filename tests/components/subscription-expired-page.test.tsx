// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Phase 9 licensing — the /subscription-expired page renders in BOTH
// locales with the real dictionaries (evidence: the page is the landing
// surface for every blocked tenant, so its copy is load-bearing).
// signOut is mocked; t() resolves through the actual ar/en JSON.
// ---------------------------------------------------------------------------

let activeLocale = 'en-EG'
vi.mock('@/components/providers/language-provider', async () => {
  const ar = (await import('../../locales/ar.json')).default
  const en = (await import('../../locales/en.json')).default
  return {
    useLanguage: () => {
      const dict = activeLocale.startsWith('ar') ? ar : en
      return {
        locale: activeLocale,
        dir: activeLocale.startsWith('ar') ? 'rtl' : 'ltr',
        t: (key: string, vars?: Record<string, string | number>) => {
          let template: string = dict[key] ?? key
          if (vars)
            template = template.replace(/\{(\w+)\}/g, (m, name) =>
              name in vars ? String(vars[name]) : m
            )
          return template
        },
        setLocale: vi.fn(),
      }
    },
    LOCALE_COOKIE: 'dentora-locale',
  }
})

const signOutMock = vi.fn()
vi.mock('next-auth/react', () => ({
  signOut: (opts?: unknown) => signOutMock(opts),
}))

import { SubscriptionExpiredClient } from '@/app/subscription-expired/SubscriptionExpiredClient'

const EMAIL = 'admin@dentora-dental.com'

beforeEach(() => {
  signOutMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SubscriptionExpiredClient — English', () => {
  it('renders the full blocked-state copy and actions', () => {
    activeLocale = 'en-EG'
    render(<SubscriptionExpiredClient userEmail={EMAIL} />)

    expect(screen.getByRole('heading', { name: 'Subscription expired' })).toBeTruthy()
    expect(screen.getByText(/Access to the system is suspended/i)).toBeTruthy()
    expect(screen.getByText(new RegExp(`Logged in as ${EMAIL}`))).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('links to support by mail and signs out back to /login', () => {
    activeLocale = 'en-EG'
    render(<SubscriptionExpiredClient userEmail={EMAIL} />)

    const mail = screen.getByRole('link', { name: 'Contact to renew' })
    expect(mail.getAttribute('href')).toMatch(/^mailto:support@dentora\.com/)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })

  it('omits the "logged in as" line when no email is available', () => {
    activeLocale = 'en-EG'
    render(<SubscriptionExpiredClient userEmail="" />)
    expect(screen.queryByText(/Logged in as/i)).toBeNull()
  })
})

describe('SubscriptionExpiredClient — Arabic (RTL locale)', () => {
  it('renders the mandated Arabic copy verbatim from ar.json', () => {
    activeLocale = 'ar-EG'
    render(<SubscriptionExpiredClient userEmail={EMAIL} />)

    expect(screen.getByRole('heading', { name: 'اشتراكك منتهٍ' })).toBeTruthy()
    expect(screen.getByText(/تجديد اشتراكك/)).toBeTruthy()
    expect(screen.getByText(new RegExp(`مسجل الدخول بـ ${EMAIL}`))).toBeTruthy()
    expect(screen.getByRole('link', { name: 'تواصل لتجديد الاشتراك' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeTruthy()
  })

  it('signs out back to /login in Arabic mode as well', () => {
    activeLocale = 'ar-EG'
    render(<SubscriptionExpiredClient userEmail={EMAIL} />)
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }))
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })
})

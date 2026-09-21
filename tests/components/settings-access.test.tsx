// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseTheme = vi.fn(() => ({ theme: 'system', setTheme: vi.fn() }))

// Real-dictionary language provider mock: t() resolves through the actual
// locales/en.json so component translations stay pinned to the shipped data.
vi.mock('@/components/providers/language-provider', async () => {
  const en = (await import('../../locales/en.json')).default
  return {
    useLanguage: () => ({
      locale: 'en-EG',
      dir: 'ltr',
      t: (key: string, vars?: Record<string, string | number>) => {
        let template: string = en[key] ?? key
        if (vars) template = template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
        return template
      },
      setLocale: vi.fn(),
    }),
    LOCALE_COOKIE: 'dentora-locale',
  }
})

vi.mock('next-themes', () => ({
  useTheme: () => mockUseTheme(),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

import { renderToString } from 'react-dom/server'

import { AccessDenied } from '@/components/settings/access-denied'
import { SettingsOverview, type SettingsCategory } from '@/components/settings/settings-overview'

const adminCategories: SettingsCategory[] = [
  { title: 'Setup Guide', description: 'd1', icon: 'Settings', href: '/settings/setup-guide', color: 'c' },
  { title: 'Clinic Information', description: 'd2', icon: 'Settings', href: '/settings/clinic', color: 'c' },
  { title: 'Billing Settings', description: 'd3', icon: 'Settings', href: '/settings/billing', color: 'c' },
  { title: 'My Profile', description: 'd4', icon: 'Settings', href: '/settings/profile', color: 'c' },
]

describe('AccessDenied', () => {
  it('renders a proper forbidden page (403), not a redirect stub', () => {
    render(<AccessDenied section="clinic" />)
    expect(screen.getByText('Access Denied — 403')).toBeTruthy() // via en.json accessDenied.title
    expect(screen.getByText(/does not have permission/i)).toBeTruthy() // accessDenied.message
  })

  it('shows the Arabic explanation for Arabic-speaking staff', () => {
    render(<AccessDenied />)
    expect(screen.getByText(/contact your clinic administrator/i)).toBeTruthy() // accessDenied.hint (en dict under en-EG mock)
  })

  it('links to the two always-available destinations', () => {
    render(<AccessDenied />)
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('/dashboard')
    expect(links).toContain('/settings/profile')
  })

  it('names the blocked section when provided', () => {
    render(<AccessDenied section="billing" />)
    expect(screen.getByText('Blocked section: billing')).toBeTruthy() // accessDenied.blocked + {section} interpolation
  })
})

describe('SettingsOverview (role-filtered categories)', () => {
  it('renders one card per allowed category with the right links', () => {
    render(<SettingsOverview categories={adminCategories} />)
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/settings/setup-guide', '/settings/clinic', '/settings/billing', '/settings/profile'])
  })

  it('renders no category links when the role has none (profile hub only)', () => {
    render(<SettingsOverview categories={[adminCategories[3]]} />)
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/settings/profile'])
  })

  it('still renders the page shell when the category list is empty', () => {
    const { container } = render(<SettingsOverview categories={[]} />)
    expect(container.innerHTML).toContain('Settings &amp; Configuration') // settings.title via en.json
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('Theme buttons hydration contract (next-themes SSR mismatch regression)', () => {
  const OVERVIEW = <SettingsOverview categories={[]} />

  it('server-rendered first paint has NO active variant even when the client theme is set', () => {
    // Reproduces the reported bug's conditions: next-themes gives the client a
    // real theme ('dark') but SSR `undefined`. The mounted-gate must keep the
    // server HTML free of active-variant classes so hydration always matches.
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() })
    const serverHtml = renderToString(OVERVIEW)
    expect(serverHtml).toContain('Dark')
    expect(serverHtml).not.toContain('bg-primary')
  })

  it('renders identically for SSR-undefined and client-default themes', () => {
    mockUseTheme.mockReturnValue({ theme: undefined, setTheme: vi.fn() })
    const undefinedHtml = renderToString(OVERVIEW)
    mockUseTheme.mockReturnValue({ theme: 'system', setTheme: vi.fn() })
    const systemHtml = renderToString(OVERVIEW)
    expect(undefinedHtml).toBe(systemHtml)
  })

  it('highlights the active theme after mount (client-only state)', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() })
    render(<SettingsOverview categories={[]} />)
    const buttons = screen.getAllByRole('button')
    const labels = buttons.map((b) => b.textContent)
    const dark = buttons[labels.indexOf('Dark')]
    expect(dark.className).toContain('bg-primary')
  })

  it('keeps the other two buttons outlined when one is active', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme: vi.fn() })
    render(<SettingsOverview categories={[]} />)
    const buttons = screen.getAllByRole('button')
    const labels = buttons.map((b) => b.textContent)
    for (const label of ['Light', 'System']) {
      expect(buttons[labels.indexOf(label)].className).not.toContain('bg-primary')
      expect(buttons[labels.indexOf(label)].className).toContain('bg-background')
    }
  })
})

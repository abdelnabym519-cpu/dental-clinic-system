// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

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
    expect(screen.getByText('Access Denied — 403')).toBeTruthy()
    expect(screen.getByText(/does not have permission/i)).toBeTruthy()
  })

  it('shows the Arabic explanation for Arabic-speaking staff', () => {
    render(<AccessDenied />)
    expect(screen.getByText(/ليس لديك صلاحية الوصول/)).toBeTruthy()
  })

  it('links to the two always-available destinations', () => {
    render(<AccessDenied />)
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('/dashboard')
    expect(links).toContain('/settings/profile')
  })

  it('names the blocked section when provided', () => {
    render(<AccessDenied section="billing" />)
    expect(screen.getByText(/Blocked section: billing/)).toBeTruthy()
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
    expect(container.innerHTML).toContain('Settings &amp; Configuration')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

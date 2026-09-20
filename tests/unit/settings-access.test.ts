import { describe, it, expect } from 'vitest'

import {
  canAccessSettingsSection,
  rolesForSettingsSection,
  settingsSectionFromPath,
  SETTINGS_SECTION_ROLES,
} from '@/lib/settings-access'

describe('settingsSectionFromPath', () => {
  it('returns index for the settings hub', () => {
    expect(settingsSectionFromPath('/settings')).toBe('index')
  })

  it('returns index for a bare /settings/ slash form too', () => {
    expect(settingsSectionFromPath('/settings/')).toBe('index')
  })

  it('returns the first path segment for section pages', () => {
    expect(settingsSectionFromPath('/settings/profile')).toBe('profile')
    expect(settingsSectionFromPath('/settings/billing')).toBe('billing')
    expect(settingsSectionFromPath('/settings/forms')).toBe('forms')
  })

  it('uses the same section for nested resources (forms/[id])', () => {
    expect(settingsSectionFromPath('/settings/forms/abc123')).toBe('forms')
  })

  it('returns null outside the settings area', () => {
    expect(settingsSectionFromPath('/dashboard')).toBeNull()
    expect(settingsSectionFromPath('/settings-club')).toBeNull()
    expect(settingsSectionFromPath('/')).toBeNull()
  })
})

describe('canAccessSettingsSection — product RBAC matrix', () => {
  const HUB = '/settings'

  it('ADMIN can access every settings route', () => {
    const routes = [
      HUB,
      '/settings/profile',
      '/settings/clinic',
      '/settings/billing',
      '/settings/communications',
      '/settings/appointments',
      '/settings/ai',
      '/settings/forms',
      '/settings/forms/new',
      '/settings/import',
      '/settings/integrations',
      '/settings/pricing',
      '/settings/procedures',
      '/settings/security',
      '/settings/setup-guide',
      '/settings/subscription',
      '/settings/system',
    ]
    for (const route of routes) {
      expect(canAccessSettingsSection(route, 'ADMIN')).toBe(true)
    }
  })

  it('DOCTOR can access only /settings/profile', () => {
    expect(canAccessSettingsSection('/settings/profile', 'DOCTOR')).toBe(true)
    expect(canAccessSettingsSection(HUB, 'DOCTOR')).toBe(true)
    for (const route of [
      '/settings/clinic',
      '/settings/billing',
      '/settings/communications',
      '/settings/system',
    ]) {
      expect(canAccessSettingsSection(route, 'DOCTOR')).toBe(false)
    }
  })

  it('RECEPTIONIST can access only /settings/profile', () => {
    expect(canAccessSettingsSection('/settings/profile', 'RECEPTIONIST')).toBe(true)
    expect(canAccessSettingsSection(HUB, 'RECEPTIONIST')).toBe(true)
    expect(canAccessSettingsSection('/settings/billing', 'RECEPTIONIST')).toBe(false)
    expect(canAccessSettingsSection('/settings/clinic', 'RECEPTIONIST')).toBe(false)
  })

  it('ACCOUNTANT can access /settings/profile and /settings/billing', () => {
    expect(canAccessSettingsSection('/settings/profile', 'ACCOUNTANT')).toBe(true)
    expect(canAccessSettingsSection('/settings/billing', 'ACCOUNTANT')).toBe(true)
    expect(canAccessSettingsSection(HUB, 'ACCOUNTANT')).toBe(true)
    expect(canAccessSettingsSection('/settings/communications', 'ACCOUNTANT')).toBe(false)
    expect(canAccessSettingsSection('/settings/clinic', 'ACCOUNTANT')).toBe(false)
  })

  it('LAB_TECH can access only /settings/profile', () => {
    expect(canAccessSettingsSection('/settings/profile', 'LAB_TECH')).toBe(true)
    expect(canAccessSettingsSection(HUB, 'LAB_TECH')).toBe(true)
    expect(canAccessSettingsSection('/settings/billing', 'LAB_TECH')).toBe(false)
    expect(canAccessSettingsSection('/settings/clinic', 'LAB_TECH')).toBe(false)
  })

  it('denies unknown or missing roles (secure default)', () => {
    expect(canAccessSettingsSection('/settings/profile', undefined)).toBe(false)
    expect(canAccessSettingsSection('/settings/profile', null)).toBe(false)
    expect(canAccessSettingsSection('/settings/profile', '')).toBe(false)
    expect(canAccessSettingsSection('/settings/profile', 'SUPERUSER')).toBe(false)
  })

  it('allows the access-denied page for every role so it can always render', () => {
    for (const role of ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECH']) {
      expect(canAccessSettingsSection('/settings/access-denied', role)).toBe(true)
    }
  })

  it('answers false for paths outside the settings area', () => {
    expect(canAccessSettingsSection('/dashboard', 'ADMIN')).toBe(false)
    expect(canAccessSettingsSection('/staff', 'ADMIN')).toBe(false)
  })
})

describe('rolesForSettingsSection', () => {
  it('falls back to ADMIN-only for unlisted sections', () => {
    expect(rolesForSettingsSection('clinic')).toEqual(['ADMIN'])
    expect(rolesForSettingsSection('communications')).toEqual(['ADMIN'])
  })

  it('exposes the explicit widenings', () => {
    expect(rolesForSettingsSection('profile')).toContain('LAB_TECH')
    expect(rolesForSettingsSection('billing')).toEqual(['ADMIN', 'ACCOUNTANT'])
  })

  it('keeps the declared matrix consistent with the fallback rules', () => {
    // every explicitly listed section must include ADMIN
    for (const [section, roles] of Object.entries(SETTINGS_SECTION_ROLES)) {
      expect(roles, `section ${section}`).toContain('ADMIN')
    }
  })
})

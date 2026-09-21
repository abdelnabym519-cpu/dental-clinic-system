/**
 * Pass-3 i18n surfaces.
 *
 * These render the real components — the actual profile server page, the real
 * language selector, the real toaster and the real breadcrumb — through the
 * real dictionary, rather than asserting on locale JSON alone. They exist
 * because the Arabic-mode requirement is "no English on screen", which is a
 * rendering property, not a file-content property.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'

import ar from '../../locales/ar.json'
import en from '../../locales/en.json'

const hoisted = vi.hoisted(() => ({ path: '/settings/profile', locale: 'ar-EG' as string | undefined }))

vi.mock('next/navigation', () => ({
  usePathname: () => hoisted.path,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  redirect: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', role: 'ADMIN', name: 'Dr. Test' } })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        name: 'Dr. Test',
        email: 'test@clinic.eg',
        locale: null,
        hospital: { locale: 'ar-EG', currency: 'EGP' },
      })),
    },
  },
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (_n: string) => (hoisted.locale ? { value: hoisted.locale } : undefined),
  }),
  headers: async () => new Headers(),
}))

import { LanguageProvider } from '@/components/providers/language-provider'
import { LanguagePreferenceCard } from '@/components/i18n/language-preference-card'
import { LanguageToggle } from '@/components/i18n/language-toggle'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { Toaster } from '@/components/ui/toaster'
import { toast } from '@/hooks/use-toast'
import ProfileSettingsPage from '@/app/(dashboard)/settings/profile/page'

/** Words that are legitimately not Arabic even in Arabic mode. */
const ALLOWED = /Dr\. Test|test@clinic\.eg|clinic\.eg|EGP|Dentora|ADMIN|http/i

beforeEach(() => {
  hoisted.path = '/settings/profile'
  hoisted.locale = 'ar-EG'
})

describe('profile settings page (Arabic mode)', () => {
  it('renders with no English left on screen', async () => {
    const element = await ProfileSettingsPage()
    // Same tree as the app: the root layout wraps the page in the provider
    // that carries the cookie's locale.
    const { container } = render(
      <LanguageProvider initialLocale="ar-EG">{element}</LanguageProvider>
    )
    const text = container.textContent ?? ''

    // The sentences that were reported as still-English in the browser.
    expect(text).toContain(ar['profile.title'])
    expect(text).toContain(ar['profile.subtitle'])
    expect(text).toContain(ar['profile.languageFormatting'])
    expect(text).toContain(ar['profile.languageLabel'])
    expect(text).toContain(ar['profile.save'])

    for (const english of [
      'My Profile',
      'Preferences that apply to your account only',
      'Language & Formatting',
      'Choose how dates, numbers',
      'Leaving this on the clinic default',
      'Save',
      'Language',
      'Use clinic default',
    ]) {
      expect(text, `English on screen: ${english}`).not.toContain(english)
    }

    // No Latin words other than the user's own details / brand.
    const latin = (text.match(/[A-Za-z][A-Za-z '&.,()/-]{3,}/g) ?? []).filter(
      (chunk) => !ALLOWED.test(chunk)
    )
    expect(latin).toEqual([])
  })

  it('renders the same page in English when the cookie says English', async () => {
    hoisted.locale = 'en-EG'
    const element = await ProfileSettingsPage()
    const { container } = render(
      <LanguageProvider initialLocale="en-EG">{element}</LanguageProvider>
    )
    const text = container.textContent ?? ''
    expect(text).toContain(en['profile.title'])
    expect(text).toContain(en['profile.languageFormatting'])
    expect(text).toContain(en['profile.save'])
    expect(text).toContain('Dr. Test')
    // Grep the labels, not the formatted preview: the preview deliberately
    // follows the *inherited* clinic locale (Arabic here), which is the point
    // of the cascade — so Arabic-Indic digits are expected on this line.
    expect(text).not.toContain(ar['profile.languageFormatting'])
    expect(text).not.toContain(ar['profile.subtitle'])
    expect(text).not.toContain(ar['profile.save'])
  })
})

describe('language selector (names in the selected language)', () => {
  const cardProps = {
    hospitalLocale: 'ar-EG',
    currency: 'EGP',
    supportedLocales: ['ar-EG', 'en-EG', 'en-US'] as const,
    endpoint: '/api/settings/profile',
  }

  it('shows Arabic names while the UI is Arabic', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <LanguagePreferenceCard locale={null} {...cardProps} />
      </LanguageProvider>
    )
    const trigger = document.getElementById('locale')
    expect(trigger?.textContent).toContain('العربية (مصر)')
    expect(screen.getByText(ar['profile.languageFormatting'])).toBeTruthy()
    expect(screen.getByText(ar['profile.languageLabel'])).toBeTruthy()
    expect(screen.getByRole('button', { name: ar['profile.save'] })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Arabic (Egypt)')
    expect(document.body.textContent).not.toContain('Use clinic default')
  })

  it('shows English names while the UI is English', () => {
    render(
      <LanguageProvider initialLocale="en-EG">
        <LanguagePreferenceCard locale={null} {...cardProps} />
      </LanguageProvider>
    )
    const trigger = document.getElementById('locale')
    expect(trigger?.textContent).toContain('Arabic (Egypt)')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('renders the stored preference in Arabic too', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <LanguagePreferenceCard locale="en-EG" {...cardProps} />
      </LanguageProvider>
    )
    expect(document.getElementById('locale')?.textContent).toContain(ar['language.english'])
  })

  it('translates the toggle labels in both directions', () => {
    const { unmount } = render(
      <LanguageProvider initialLocale="ar-EG">
        <LanguageToggle />
      </LanguageProvider>
    )
    expect(document.querySelector('button[lang="ar"]')?.textContent).toBe(ar['language.arabic'])
    expect(document.querySelector('button[lang="en"]')?.textContent).toBe(ar['language.english'])
    unmount()

    render(
      <LanguageProvider initialLocale="en-EG">
        <LanguageToggle />
      </LanguageProvider>
    )
    expect(document.querySelector('button[lang="ar"]')?.textContent).toBe('Arabic')
    expect(document.querySelector('button[lang="en"]')?.textContent).toBe('English')
  })
})

describe('toast notifications', () => {
  it('renders toast copy in Arabic', async () => {
    function Raise() {
      React.useEffect(() => {
        toast({ title: 'Language updated', description: 'Saved successfully' })
      }, [])
      return null
    }
    await act(async () => {
      render(
        <LanguageProvider initialLocale="ar-EG">
          <Toaster />
          <Raise />
        </LanguageProvider>
      )
    })
    expect(await screen.findByText(ar['toast.languageUpdated'])).toBeTruthy()
    expect(document.body.textContent).toContain(ar['toast.savedSuccessfully'])
    expect(document.body.textContent).not.toContain('Language updated')
  })

  it('keeps toast copy English in English mode', async () => {
    function Raise() {
      React.useEffect(() => {
        toast({ title: 'Deleted successfully' })
      }, [])
      return null
    }
    await act(async () => {
      render(
        <LanguageProvider initialLocale="en-EG">
          <Toaster />
          <Raise />
        </LanguageProvider>
      )
    })
    expect(await screen.findByText('Deleted successfully')).toBeTruthy()
  })
})

describe('breadcrumbs', () => {
  it('translates every segment in Arabic mode', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <Breadcrumb />
      </LanguageProvider>
    )
    const nav = screen.getByRole('navigation')
    expect(nav.getAttribute('aria-label')).toBe(ar['breadcrumb.aria'])
    expect(nav.textContent).toContain(ar['breadcrumb.settings'])
    expect(nav.textContent).toContain(ar['breadcrumb.profile'])
    expect(nav.textContent).not.toContain('Settings')
    expect(nav.textContent).not.toContain('Profile')
  })

  it('shows "Details" translated for id segments', () => {
    hoisted.path = '/patients/3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    render(
      <LanguageProvider initialLocale="ar-EG">
        <Breadcrumb />
      </LanguageProvider>
    )
    expect(screen.getByRole('navigation').textContent).toContain(ar['breadcrumb.details'])
  })

  it('falls back to English labels in English mode', () => {
    render(
      <LanguageProvider initialLocale="en-EG">
        <Breadcrumb />
      </LanguageProvider>
    )
    const nav = screen.getByRole('navigation')
    expect(nav.textContent).toContain('Settings')
    expect(nav.textContent).toContain('Profile')
  })
})

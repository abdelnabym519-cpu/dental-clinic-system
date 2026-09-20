// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// § Egyptianization — bilingual UI (Gates H, I, J):
//   - ar-EG is the default locale and is right-to-left
//   - the language toggle switches AR ⇄ EN, persists (cookie + <html lang/dir>)
//   - sidebar navigation and auth strings translate per locale
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  return new Proxy(actual, { get: (_: any, p: string) => actual[p] || icon(p) })
})

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}))

import { LanguageProvider, LOCALE_COOKIE } from '@/components/providers/language-provider'
import { LanguageToggle } from '@/components/i18n/language-toggle'
import { useLanguage } from '@/components/providers/language-provider'
import { directionFor, translate, translateLabel } from '@/lib/i18n/dictionary'
import { isRTL } from '@/lib/i18n/config'

function Probe() {
  const { locale, dir, t } = useLanguage()
  return (
    <div>
      <span data-testid="probe-locale">{locale}</span>
      <span data-testid="probe-dir">{dir}</span>
      <span data-testid="probe-agenda">{t('nav.agenda')}</span>
      <span data-testid="probe-status">{t('status.SCHEDULED')}</span>
    </div>
  )
}

describe('RTL / LTR direction', () => {
  it('marks ar-EG as RTL and English locales as LTR', () => {
    expect(directionFor('ar-EG')).toBe('rtl')
    expect(directionFor('en-EG')).toBe('ltr')
    expect(directionFor('en-US')).toBe('ltr')
    expect(directionFor(undefined)).toBe('rtl') // Egyptian default
    expect(isRTL('ar-EG')).toBe(true)
  })
})

describe('dictionary translations', () => {
  it('translates sidebar navigation into Arabic', () => {
    expect(translateLabel('ar-EG', 'Agenda')).toBe('الأجندة')
    expect(translateLabel('ar-EG', 'Patients')).toBe('المرضى')
    expect(translateLabel('ar-EG', 'Billing')).toBe('الفواتير')
    expect(translateLabel('ar-EG', 'Patient Care')).toBe('رعاية المرضى')
    expect(translateLabel('ar-EG', 'CRM')).toBe('إدارة العلاقات')
    // English stays identity
    expect(translateLabel('en-EG', 'Agenda')).toBe('Agenda')
    // Unknown labels pass through untouched
    expect(translateLabel('ar-EG', 'Not A Nav Item')).toBe('Not A Nav Item')
  })

  it('translates statuses, appointment types and common actions', () => {
    expect(translate('ar-EG', 'status.CONFIRMED')).toBe('مؤكد')
    expect(translate('ar-EG', 'status.COMPLETED')).toBe('مكتمل')
    expect(translate('ar-EG', 'type.CONSULTATION')).toBe('استشارة')
    expect(translate('ar-EG', 'common.save')).toBe('حفظ')
    expect(translate('ar-EG', 'paymentMethod.FAWRY')).toBe('فوري')
    expect(translate('en-US', 'status.CONFIRMED')).toBe('Confirmed')
  })
})

describe('LanguageProvider switching + persistence', () => {
  let cookieWrite: string | null = null

  beforeEach(() => {
    cookieWrite = null
    Object.defineProperty(document, 'cookie', {
      get: () => '',
      set: (v: string) => {
        cookieWrite = v
      },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('boots in Arabic (Egyptian default) with RTL applied to <html>', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    )
    expect(screen.getByTestId('probe-locale').textContent).toBe('ar-EG')
    expect(screen.getByTestId('probe-dir').textContent).toBe('rtl')
    expect(screen.getByTestId('probe-agenda').textContent).toBe('الأجندة')
    expect(screen.getByTestId('probe-status').textContent).toBe('مجدول')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar-EG')
  })

  it('switches to English and persists the choice in the locale cookie', async () => {
    render(
      <LanguageProvider>
        <Probe />
        <LanguageToggle />
      </LanguageProvider>
    )

    fireEvent.click(screen.getByText('English'))

    await waitFor(() => {
      expect(screen.getByTestId('probe-locale').textContent).toBe('en-EG')
    })
    expect(screen.getByTestId('probe-agenda').textContent).toBe('Agenda')
    expect(screen.getByTestId('probe-dir').textContent).toBe('ltr')
    expect(document.documentElement.dir).toBe('ltr')
    expect(document.documentElement.lang).toBe('en-EG')
    expect(cookieWrite).toContain(`${LOCALE_COOKIE}=en-EG`)

    // …and back to Arabic
    fireEvent.click(screen.getByText('العربية'))
    await waitFor(() => {
      expect(screen.getByTestId('probe-locale').textContent).toBe('ar-EG')
    })
    expect(cookieWrite).toContain(encodeURIComponent('ar-EG'))
  })
})

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
import { readFileSync } from 'node:fs'

import { translate, translateText } from '@/lib/i18n/dictionary'
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

/**
 * Phase-9 browser-audit regressions.
 *
 * The final gate drove a real Chromium over the app and found three strings
 * that rendered as English in Arabic mode:
 *   - the `/settings/setup-guide` breadcrumb, because the segment had no
 *     ROUTE_LABELS entry and the slug fallback produced "Setup guide";
 *   - the "~5 min per staff" style durations on the setup-guide cards, which
 *     were interpolated without `t()`;
 *   - the selected payment-terms label on the new-invoice form, which used the
 *     raw `option.label` from lib/billing-utils.
 */
describe('phase-9 audit regressions (English leaked into Arabic mode)', () => {
  it('translates the setup-guide breadcrumb instead of slug-rendering it', () => {
    hoisted.path = '/settings/setup-guide'
    render(
      <LanguageProvider initialLocale="ar-EG">
        <Breadcrumb />
      </LanguageProvider>
    )
    const text = screen.getByRole('navigation').textContent || ''
    expect(text).toContain(ar['nav.setupGuide'])
    expect(text).not.toContain('Setup guide')
  })

  it('renders the breadcrumb in English for en-EG', () => {
    hoisted.path = '/settings/setup-guide'
    render(
      <LanguageProvider initialLocale="en-EG">
        <Breadcrumb />
      </LanguageProvider>
    )
    expect(screen.getByRole('navigation').textContent).toContain('Setup Guide')
  })

  it('has Arabic for every setup-guide duration label', () => {
    const durations = ['2 min', '5 min', '10 min', '15 min', '5 min per staff', '10 min per device', '15-30 min', '20-60 min']
    for (const d of durations) {
      expect(ar[d], `ar:${d}`).toBeTruthy()
      expect(ar[d]).toMatch(/[\u0600-\u06FF]/)
      expect(en[d]).toBe(d)
    }
  })

  it('localizes every payment-terms label offered on the new-invoice form', () => {
    const terms = ['Due on Receipt', 'Net 7 Days', 'Net 15 Days', 'Net 30 Days', 'Net 45 Days', 'Net 60 Days']
    for (const term of terms) {
      expect(ar[term], `ar:${term}`).toMatch(/[\u0600-\u06FF]/)
      expect(translate('ar-EG', term)).toBe(ar[term])
    }
  })

  it('keeps the three fixed call sites wrapped in t()', () => {
    const setupGuide = readFileSync('app/(dashboard)/settings/setup-guide/page.tsx', 'utf8')
    expect(setupGuide).toContain('~{t(section.estimatedTime)}')
    const invoiceForm = readFileSync('app/(dashboard)/billing/invoices/new/page.tsx', 'utf8')
    expect(invoiceForm).toContain('{t(option.label)}')
    const breadcrumb = readFileSync('components/ui/breadcrumb.tsx', 'utf8')
    expect(breadcrumb).toContain("'setup-guide': 'Setup Guide'")
  })

  it('localizes the discount-type, plan-price and plan-note labels', () => {
    const newKeys: Record<string, string> = {
      'Fixed Amount (EGP)': 'مبلغ ثابت (ج.م)',
      Custom: 'حسب الطلب',
      'one-time': 'دفعة واحدة',
    }
    for (const [key, arabic] of Object.entries(newKeys)) {
      expect(ar[key], `ar:${key}`).toBe(arabic)
      expect(ar[key]).toMatch(/[\u0600-\u06FF]/)
      expect(en[key], `en:${key}`).toBe(key)
      expect(translate('ar-EG', key)).toBe(arabic)
    }
    const invoiceForm = readFileSync('app/(dashboard)/billing/invoices/new/page.tsx', 'utf8')
    expect(invoiceForm).toContain("t('Fixed Amount (EGP)')")
    expect(invoiceForm).not.toContain("t('EGP  Fixed')")
    for (const f of ['app/(auth)/pricing/page.tsx', 'app/(dashboard)/settings/subscription/page.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).toContain('{t(plan.price)}')
      expect(src, f).not.toContain('{plan.price}\n')
    }
    expect(readFileSync('app/(dashboard)/settings/subscription/page.tsx', 'utf8')).toContain('{t(plan.priceNote)}')
  })

  it('resolves every audited breadcrumb crumb to Arabic (no slug fallback leaks)', () => {
    // Mirrors <Breadcrumb/>'s own lookup: ROUTE_LABELS entry, else the
    // title-cased slug, then translate() (exact key, else English-value reverse index).
    const crumbs: Record<string, string> = {
      'setup-guide': 'Setup Guide',
      'audit-log': 'Audit Log',
      orders: 'Lab Orders',
      portal: 'Patient Portal',
      'access-denied': 'Access denied',
    }
    for (const [segment, label] of Object.entries(crumbs)) {
      // <Breadcrumb/> goes through the provider's t(), i.e. translateText():
      // exact key, else the English-value reverse index, else raw text.
      const out = translateText('ar-EG', label)
      expect(out, `crumb ${segment}`).toMatch(/[\u0600-\u06FF]/)
      expect(out).not.toBe(label)
    }
    const src = readFileSync('components/ui/breadcrumb.tsx', 'utf8')
    for (const segment of Object.keys(crumbs)) {
      // keys may be written quoted or bare in the map literal
      expect(new RegExp(`^\\s*'?${segment}'?:`, 'm').test(src), `ROUTE_LABELS:${segment}`).toBe(true)
    }
  })

  it('localizes weekday labels on the clinic schedule and staff shift screens', () => {
    const days: Record<string, string> = {
      Sunday: 'الأحد',
      Monday: 'الاثنين',
      Tuesday: 'الثلاثاء',
      Wednesday: 'الأربعاء',
      Thursday: 'الخميس',
      Friday: 'الجمعة',
      Saturday: 'السبت',
    }
    for (const [en_, ar_] of Object.entries(days)) {
      expect(ar[en_ as keyof typeof ar], `ar:${en_}`).toBe(ar_)
      expect(translateText('ar-EG', en_)).toBe(ar_)
      expect(translateText('en-EG', en_)).toBe(en_)
    }
    // every render site must go through t(); the raw arrays leaked English
    // weekday names into the Arabic schedule pickers.
    for (const f of [
      'app/(dashboard)/settings/clinic/page.tsx',
      'app/(dashboard)/staff/[id]/page.tsx',
      'app/(dashboard)/staff/[id]/edit/page.tsx',
    ]) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).toMatch(/t\((DAY_LABELS\[day\]|day|dayNames\[index\])\)/)
    }
  })

  it('translates the AI feature toggles and the email-verification messages', () => {
    // These five labels were already dictionary values; /settings/ai simply
    // rendered the raw English next to a translated description.
    const ai: Record<string, string> = {
      'AI Chat Widget': 'أداة محادثة الذكاء الاصطناعي',
      'Command Bar (Ctrl+K)': 'شريط الأوامر (Ctrl+K)',
      'Auto Appointment Reminders': 'تذكيرات المواعيد التلقائية',
      'Morning Briefing': 'الملخص الصباحي',
      'Patient Risk Scoring': 'تقييم مخاطر المرضى',
    }
    for (const [label, arabic] of Object.entries(ai)) {
      expect(translateText('ar-EG', label), label).toBe(arabic)
      expect(translateText('en-EG', label), label).toBe(label)
    }
    const aiPage = readFileSync('app/(dashboard)/settings/ai/page.tsx', 'utf8')
    expect(aiPage).toContain('{t(label)}')
    expect(aiPage).toContain('label={t(label)}')
    expect(aiPage).not.toMatch(/<p className="text-sm font-medium">\{label\}<\/p>/)

    const verify: Record<string, string> = {
      'No verification token or email provided.': 'لم يتم توفير رمز تحقق أو بريد إلكتروني.',
      'Your email has been verified successfully!': 'تم التحقق من بريدك الإلكتروني بنجاح!',
      'Verification failed. Please try again.': 'فشل التحقق. يرجى المحاولة مرة أخرى.',
      'An error occurred during verification. Please try again.':
        'حدث خطأ أثناء التحقق. يرجى المحاولة مرة أخرى.',
    }
    for (const [key, arabic] of Object.entries(verify)) {
      expect(ar[key as keyof typeof ar], key).toBe(arabic)
      expect(en[key as keyof typeof en], key).toBe(key)
    }
    expect(ar['We\'ve sent a verification email to {v1}. Please check your inbox and click the verification link.'])
      .toContain('{v1}')
    const page = readFileSync('app/(auth)/verify-email/page.tsx', 'utf8')
    // no user-visible message may be assigned as a raw literal any more
    expect(page).not.toMatch(/setMessage\(\s*['"`][^'"`]*['"`]\s*\)/)
    expect(page.match(/setMessage\(\s*t\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    // the success/resend toasts render through t() too (their wording already
    // exists as dictionary values, e.g. "Email verified!" -> تم تأكيد البريد)
    expect(page).not.toMatch(/title:\s*['"`]/)
    expect(page).not.toMatch(/description:\s*['"`]/)
    for (const label of ['Email verified!', 'You can now log in to your account.', 'Verification email sent', 'Please check your inbox for the verification link.']) {
      expect(translateText('ar-EG', label), label).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('translates the data-import entity descriptions', () => {
    const descs: Record<string, string> = {
      'Demographics, contact info': 'البيانات الأساسية ومعلومات التواصل',
      'Doctors, nurses, admin': 'الأطباء والممرضون والموظفون الإداريون',
      'Scheduled visits': 'الزيارات المجدولة',
      'Procedures & records': 'الإجراءات والسجلات',
      'Bills & amounts': 'الفواتير والمبالغ',
      'Payment transactions': 'عمليات الدفع',
      'Stock items & levels': 'أصناف المخزون ومستوياته',
    }
    for (const [key, arabic] of Object.entries(descs)) {
      expect(ar[key as keyof typeof ar], key).toBe(arabic)
      expect(en[key as keyof typeof en], key).toBe(key)
      expect(translateText('ar-EG', key), key).toBe(arabic)
    }
    const page = readFileSync('app/(dashboard)/settings/import/page.tsx', 'utf8')
    expect(page).toContain('{t(opt.desc)}')
    expect(page).not.toMatch(/text-muted-foreground">\{opt\.desc\}/)
  })

  it('translates config-array labels rendered outside the dictionary', () => {
    // The recurring defect: a component renders {obj.label} straight from a
    // config array, so the dictionary is bypassed even though the Arabic
    // wording already exists as a value. Wrapping is key-free and safe.
    const labels = ['Dental Chair', 'Pulse Oximeter', 'BP Monitor', 'Autoclave', 'Patients', 'Invoices']
    for (const label of labels) {
      expect(translateText('ar-EG', label), label).toMatch(/[\u0600-\u06FF]/)
      expect(translateText('en-EG', label), label).toBe(label)
    }
    const sites: Array<[string, RegExp]> = [
      ['app/(dashboard)/devices/page.tsx', /\{t\(cfg\.label\)\}/],
      ['components/layout/global-search.tsx', /\{t\(cat\.label\)\}/],
      ['app/(dashboard)/settings/subscription/page.tsx', /\{t\(plan\.name\)\}/],
    ]
    for (const [file, re] of sites) {
      expect(re.test(readFileSync(file, 'utf8')), file).toBe(true)
    }
    // plan names must not be rendered raw anywhere on the subscription screen
    expect(readFileSync('app/(dashboard)/settings/subscription/page.tsx', 'utf8')).not.toMatch(
      />\{plan\.name\}</
    )
  })

  it('covers the keys that t() was being called on without a dictionary entry', () => {
    // These call sites looked translated but had no entry, so they rendered
    // English; the fixes added the keys (or retargeted the literal).
    expect(ar['No invite token provided.']).toBe('لم يتم توفير رمز دعوة.')
    expect(translateText('ar-EG', 'No invite token provided.')).toBe('لم يتم توفير رمز دعوة.')
    expect(translateText('ar-EG', 'Account created!')).toBe('تم إنشاء الحساب!')
    expect(translateText('ar-EG', 'Something went wrong. Please try again.')).toBe('حدث خطأ ما. حاول مرة أخرى.')
    expect(ar['Critical (stockout \u22647d)'.replace(/\u2264/, '\u2264')]).toBeDefined()
    expect(translateText('ar-EG', 'WhatsApp contact number override')).toMatch(/[\u0600-\u06FF]/)
    // templated search-empty key: {q} must survive substitution
    const templated = translateText('ar-EG', 'No results found for {q}', { q: 'سارة' })
    expect(templated).toContain('سارة')
    expect(templated).toMatch(/[\u0600-\u06FF]/)
    expect(templated).not.toContain('No results')
    // the new-invoice terms default is localized the same way settings/billing is
    const termsKey =
      '1. Payment is due within the specified payment terms.\n2. Please bring this invoice for reference during your next visit.'
    expect(ar[termsKey as keyof typeof ar]).toMatch(/[\u0600-\u06FF]/)
    expect(en[termsKey as keyof typeof en]).toBe(termsKey)

    const invite = readFileSync('app/(auth)/invite/accept/page.tsx', 'utf8')
    // the invite page stores the message and translates it at render, because the
    // provider's t() is English until its mount effect applies the locale cookie
    expect(invite).toContain("setErrorMessage('No invite token provided.')")
    expect(invite).toContain('<CardDescription>{t(errorMessage)}</CardDescription>')
    expect(invite).not.toContain('setErrorMessage(t(')
    expect(ar['Invalid invite link.']).toBe('رابط الدعوة غير صالح.')
    expect(translateText('ar-EG', 'Invalid invite link.')).toBe('رابط الدعوة غير صالح.')
    expect(translateText('ar-EG', 'An error occurred. Please try again.')).toBe('حدث خطأ ما. حاول مرة أخرى.')
    expect(invite).not.toMatch(/title: 'Account created!'/)
    expect(readFileSync('components/layout/global-search.tsx', 'utf8')).toContain(
      "t('No results found for {q}', { q: query })"
    )
  })
  it('wraps labels that come from a config array declared in another module', () => {
    // dateRangePresets lives in reports/page.tsx but is rendered by
    // billing/reports/page.tsx, so a per-file scan misses it; both of these
    // resolved through the reverse index and needed no new keys.
    const billingReports = readFileSync('app/(dashboard)/billing/reports/page.tsx', 'utf8')
    expect(billingReports).toContain('{t(preset.label)}')
    expect(billingReports).not.toMatch(/>\s*\{preset\.label\}\s*</)
    const memberships = readFileSync('app/(dashboard)/crm/memberships/page.tsx', 'utf8')
    expect(memberships).toContain('{t(plan.name)}')
    expect(memberships).not.toMatch(/>\s*\{plan\.name\}\s*</)
    for (const label of ['Today', 'This Month', 'Last Quarter', 'Custom Range']) {
      expect(translateText('ar-EG', label)).toMatch(/[\u0600-\u06FF]/)
    }
  })
  it('localises the example-prefix placeholders without touching format samples', () => {
    // "e.g., D3310" is English copy glued to a Latin format sample; the prefix now
    // comes from the dictionary while the sample itself stays as typed data.
    expect(translateText('ar-EG', 'e.g.')).toBe('مثال:')
    expect(translateText('en-EG', 'e.g.')).toBe('e.g.')
    expect(translateText('ar-EG', 'e.g.,')).toBe('مثال:')
    expect(translateText('en-EG', 'e.g.,')).toBe('e.g.,')
    const referrals = readFileSync('app/(dashboard)/crm/referrals/page.tsx', 'utf8')
    expect(referrals).toContain("placeholder={`${t('e.g.')} 100`}")
    const preAuth = readFileSync('app/(dashboard)/billing/insurance/pre-auth/new/page.tsx', 'utf8')
    expect(preAuth).toContain("placeholder={`${t('e.g.,')} D3310`}")
    // brand / host / id-format samples stay Latin on purpose
    const medications = readFileSync('app/(dashboard)/medications/page.tsx', 'utf8')
    expect(medications).toContain('placeholder="Cipla"')
    const staffNew = readFileSync('app/(dashboard)/staff/new/page.tsx', 'utf8')
    expect(staffNew).toContain('placeholder="TN/12345"')
  })
  it('translates every setup-guide step and tip line, and keeps it that way', () => {
    // The guide stores its instructions as plain string arrays, which is why 263
    // lines used to render English in Arabic mode. Rather than pinning a sample,
    // re-extract the arrays from the source with the same rules the runtime uses
    // (leading whitespace stripped for steps only) and require Arabic for each.
    const src = readFileSync('app/(dashboard)/settings/setup-guide/page.tsx', 'utf8')
    const decode = (raw: string) =>
      raw
        .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\`/g, '`')
    const literalsOf = (body: string) => {
      const out: string[] = []
      for (let i = 0; i < body.length; i++) {
        const q = body[i]
        if (q !== "'" && q !== '"' && q !== '`') continue
        let j = i + 1
        let buf = ''
        while (j < body.length) {
          if (body[j] === '\\') { buf += body[j] + body[j + 1]; j += 2; continue }
          if (body[j] === q) break
          buf += body[j++]
        }
        if (j < body.length) { out.push(decode(buf)); i = j }
      }
      return out
    }
    const blocksOf = (prop: string) => {
      const blocks: string[] = []
      const re = new RegExp(`\\b${prop}\\s*:\\s*\\[`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const start = src.indexOf('[', m.index + m[0].length - 1)
        let depth = 0
        for (let j = start; j < src.length; j++) {
          const c = src[j]
          if ('[{('.includes(c)) depth++
          else if (']})'.includes(c)) { depth--; if (depth === 0) { blocks.push(src.slice(start + 1, j)); break } }
        }
      }
      return blocks
    }
    const steps = blocksOf('steps').flatMap(literalsOf).map((s) => s.replace(/^\s+/, ''))
    const tips = blocksOf('tips').flatMap(literalsOf)
    const lines = [...steps, ...tips]
    expect(lines.length).toBeGreaterThan(250)

    const untranslated = lines.filter((line) => {
      const v = translateText('ar-EG', line)
      return line.length > 3 && !/[\u0600-\u06FF]/.test(v)
    })
    expect(untranslated).toEqual([])
    // the render sites must go through t(), otherwise the keys above are dead weight
    expect(src).toContain("{t(step.replace(/^\\s+/, ''))}")
    expect(src).toContain('<span>{t(tip)}</span>')
    // the same must hold for every other guide field: titles, descriptions, labels
    for (const prop of ['title', 'description', 'label', 'estimatedTime']) {
      const re = new RegExp(`\\b${prop}\\s*:\\s*\\n?\\s*(['"])((?:\\\\.|((?!\\1)[^\\s])){4,400})\\1`, 'g')
      const fieldRe = new RegExp(`\\b${prop}\\s*:\\s*\\n?\\s*(["'])([\\s\\S]{4,400}?)\\1`, 'g')
      let mm
      const unresolved: string[] = []
      while ((mm = fieldRe.exec(src))) {
        const raw = mm[2]
        if (raw.includes('\n')) continue
        const val = raw.replace(/\\'/g, "'").replace(/\\"/g, '"')
        if (/[A-Za-z]{3}/.test(val) && !/[\u0600-\u06FF]/.test(translateText('ar-EG', val))) unresolved.push(val)
      }
      expect(unresolved).toEqual([])
    }
    // English mode still shows the English instruction, not a missing-key artefact
    expect(translateText('en-EG', steps[0])).toBe(steps[0])
  })
})

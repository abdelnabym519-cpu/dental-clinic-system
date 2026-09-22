// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import ar from '../../locales/ar.json'
import en from '../../locales/en.json'
import { translate, translateText, directionFor } from '@/lib/i18n/dictionary'
import { dateFnsLocale } from '@/lib/i18n/dates'
import { format } from 'date-fns'

/**
 * Arabic-mode completeness gates (i18n master mandate):
 *  - ar.json and en.json expose the SAME key set (no missing translations)
 *  - the exact Arabic terms mandated for roles, statuses, types, priorities,
 *    payment methods and odontogram condition names are present verbatim
 *  - RTL direction for ar-EG, LTR for English locales
 *  - interpolation works (common.showing)
 *  - components wired to t() actually render Arabic under ar-EG
 */

const arKeys = Object.keys(ar).sort()
const enKeys = Object.keys(en).sort()

describe('dictionary parity', () => {
  it('ar.json and en.json expose the exact same key set', () => {
    expect(arKeys).toEqual(enKeys)
  })

  it('has no empty translations in either locale', () => {
    for (const [k, v] of Object.entries(ar)) expect(String(v).length, `ar:${k}`).toBeGreaterThan(0)
    for (const [k, v] of Object.entries(en)) expect(String(v).length, `en:${k}`).toBeGreaterThan(0)
  })

  it('exposes the mandated core vocabulary', () => {
    for (const key of [
      'common.save', 'common.cancel', 'common.edit', 'common.delete', 'common.search',
      'common.filter', 'common.export', 'common.import', 'common.print', 'common.close',
      'common.confirm', 'common.loading', 'common.noData', 'common.showing',
      'dashboard.title', 'agenda.title', 'patients.title', 'billing.title',
      'settings.title', 'nav.dashboard', 'nav.agenda', 'nav.patients', 'nav.billing',
    ]) {
      expect(ar[key], `ar:${key}`).toBeTruthy()
      expect(en[key], `en:${key}`).toBeTruthy()
    }
  })
})

describe('pass-2 coverage (ui.* namespace, 465 curated strings)', () => {
  const uiKeys = arKeys.filter((k) => k.startsWith('ui.'))
  it('has 400+ curated ui.* keys in perfect parity', () => {
    expect(uiKeys.length).toBeGreaterThanOrEqual(400)
  })

  it('covers the pass-2 module vocabularies with the mandated Arabic terms', () => {
    const expectAr = (key: string, arValue: string) => {
      expect(ar[key], `ar:${key}`).toBe(arValue)
      expect(en[key], `en:${key}`).toBeTruthy()
    }
    // prescriptions / treatments
    expectAr('ui.new_prescription', 'وصفة طبية جديدة')
    expectAr('ui.dosage', 'الجرعة')
    expectAr('ui.frequency', 'التكرار')
    expectAr('ui.diagnosis', 'التشخيص')
    // staff / HR
    expectAr('ui.admin', 'مدير')
    expectAr('ui.doctor', 'الطبيب')
    expectAr('ui.receptionist', 'موظف استقبال')
    expectAr('ui.accountant', 'محاسب')
    expectAr('ui.lab_technician', 'فني مختبر')
    expectAr('ui.attendance', 'الحضور')
    expectAr('ui.sick_leave', 'إجازة مرضية')
    // inventory / lab
    expectAr('ui.supplier', 'المورد')
    expectAr('ui.quantity', 'الكمية')
    expectAr('ui.minimum_stock', 'الحد الأدنى للمخزون')
    expectAr('ui.lab_orders', 'طلبات المختبر')
    expectAr('ui.sent_to_lab', 'أُرسل إلى المختبر')
    // CRM / communications / reports
    expectAr('ui.loyalty_points', 'نقاط الولاء')
    expectAr('ui.referrals', 'الإحالات')
    expectAr('ui.notifications', 'الإشعارات')
    expectAr('ui.reports', 'التقارير')
    expectAr('ui.export', 'تصدير')
    // portal / onboarding / settings sub-pages
    expectAr('ui.patient_portal', 'بوابة المريض')
    expectAr('ui.security_settings', 'إعدادات الأمان')
    expectAr('ui.working_hours', 'ساعات العمل')
    // AI
    expectAr('ui.ai_assistant', 'مساعد الذكاء الاصطناعي')
  })

  it('renders key pass-2 strings in Arabic through the real dictionary', () => {
    expect(translate('ar-EG', 'ui.new_prescription')).toBe('وصفة طبية جديدة')
    expect(translate('ar-EG', 'ui.lab_orders')).toBe('طلبات المختبر')
    expect(translate('en-EG', 'ui.new_prescription')).toBe('New Prescription')
  })
})

describe('pass-3 coverage (profile, language selector, toasts, breadcrumbs)', () => {
  it('ships the mandated profile keys in both locales', () => {
    const expected: [string, string, string][] = [
      ['profile.title', 'My Profile', 'ملفي الشخصي'],
      ['profile.subtitle', 'Preferences that apply to your account only', 'تفضيلات تنطبق على حسابك فقط'],
      ['profile.languageFormatting', 'Language & Formatting', 'اللغة والتنسيق'],
      ['profile.languageLabel', 'Language', 'اللغة'],
      ['profile.save', 'Save', 'حفظ'],
      ['language.arabic', 'Arabic', 'العربية'],
      ['language.english', 'English', 'الإنجليزية'],
      ['language.egypt', 'Egypt', 'مصر'],
      ['language.clinicDefault', 'Use clinic default', 'استخدام الافتراضي للعيادة'],
      ['toast.languageUpdated', 'Language updated', 'تم تحديث اللغة'],
      ['toast.savedSuccessfully', 'Saved successfully', 'تم الحفظ بنجاح'],
      ['toast.errorSaving', 'Error saving', 'خطأ في الحفظ'],
      ['toast.deletedSuccessfully', 'Deleted successfully', 'تم الحذف بنجاح'],
      ['toast.createdSuccessfully', 'Created successfully', 'تم الإنشاء بنجاح'],
      ['toast.updatedSuccessfully', 'Updated successfully', 'تم التحديث بنجاح'],
      ['breadcrumb.profile', 'Profile', 'الملف الشخصي'],
      ['breadcrumb.settings', 'Settings', 'الإعدادات'],
      ['breadcrumb.dashboard', 'Dashboard', 'لوحة المعلومات'],
      ['breadcrumb.details', 'Details', 'التفاصيل'],
    ]
    for (const [key, enValue, arValue] of expected) {
      expect(en[key], `en:${key}`).toBe(enValue)
      expect(ar[key], `ar:${key}`).toBe(arValue)
    }
    // No literal English left in the Arabic profile card copy.
    expect(ar['profile.languageDescription']).not.toMatch(/[A-Za-z]{4,}/)
    expect(ar['profile.languageNote']).not.toMatch(/[A-Za-z]{4,}/)
  })

  it('resolves every pass-3 string through the dictionary (key or English label)', () => {
    // Keys…
    expect(translateText('ar-EG', 'profile.title')).toBe('ملفي الشخصي')
    expect(translateText('ar-EG', 'toast.languageUpdated')).toBe('تم تحديث اللغة')
    // …and bare English labels, which is how the swept call sites reference them.
    expect(translateText('ar-EG', 'Language & Formatting')).toBe('اللغة والتنسيق')
    expect(translateText('ar-EG', 'Save')).toBe('حفظ')
    expect(translateText('ar-EG', 'Staff Management')).toBe('إدارة الموظفين')
    expect(translateText('en-EG', 'Staff Management')).toBe('Staff Management')
    // Unknown text is returned untouched, never as an empty string or a key.
    expect(translateText('ar-EG', 'Not a curated label at all')).toBe('Not a curated label at all')
  })

  it('translates the toast copy that the toaster layer localizes', () => {
    for (const label of [
      'Language updated',
      'Saved successfully',
      'Deleted successfully',
      'Created successfully',
      'Updated successfully',
      'Error',
      'Success',
      'Validation Error',
      'Something went wrong. Please try again.',
    ]) {
      const arabic = translateText('ar-EG', label)
      expect(arabic, label).not.toBe(label)
      expect(arabic).toMatch(/[\u0600-\u06FF]/)
      expect(translateText('en-EG', label)).toBe(label)
    }
  })

  it('covers the pass-3 namespaces with meaningful volume', () => {
    const p3 = arKeys.filter((k) => k.startsWith('p3.'))
    expect(p3.length).toBeGreaterThan(1200)
    // Arabic values must actually be Arabic, not copies of the English source.
    const nonArabic = p3.filter((k) => !/[\u0600-\u06FF]/.test(ar[k]) && !/^(Google|Microsoft|Dentora|Paymob|Twilio|Fawry|InstaPay|OpenRouter|SMTP|Webhook|API|HMRC|NPS|SLA|VIP|EGP|AB)/i.test(en[k]))
    expect(nonArabic).toEqual([])
  })
})

describe('mandated Arabic terminology (exact terms)', () => {
  const terms = {
    'role.ADMIN': 'مدير',
    'role.DOCTOR': 'طبيب',
    'role.RECEPTIONIST': 'موظف استقبال',
    'role.ACCOUNTANT': 'محاسب',
    'role.LAB_TECH': 'فني مختبر',
    'type.CONSULTATION': 'استشارة',
    'type.PROCEDURE': 'إجراء',
    'type.CHECK_UP': 'فحص دوري',
    'type.FOLLOW_UP': 'متابعة',
    'type.EMERGENCY': 'طارئ',
    'status.SCHEDULED': 'مجدول',
    'status.CONFIRMED': 'مؤكد',
    'status.CHECKED_IN': 'تم الوصول',
    'status.IN_PROGRESS': 'جاري',
    'status.COMPLETED': 'مكتمل',
    'status.CANCELLED': 'ملغي',
    'status.NO_SHOW': 'لم يحضر',
    'priority.LOW': 'منخفض',
    'priority.NORMAL': 'عادي',
    'priority.HIGH': 'عالي',
    'priority.URGENT': 'عاجل',
    'paymentMethod.CASH': 'نقداً',
    'paymentMethod.CARD': 'بطاقة بنكية',
    'paymentMethod.INSTAPAY': 'إنستا باي',
    'paymentMethod.FAWRY': 'فوري',
    'paymentMethod.WALLET': 'محفظة إلكترونية',
    'paymentMethod.BANK_TRANSFER': 'تحويل بنكي',
    'paymentMethod.CHEQUE': 'شيك',
    'toothCondition.CAVITY': 'تسوس',
    'toothCondition.CROWN': 'تاج',
    'toothCondition.IMPLANT': 'زراعة',
    'toothCondition.MISSING': 'مفقود',
    'toothCondition.ROOT_CANAL': 'علاج عصب',
    'toothCondition.EXTRACTION': 'قلع',
    'toothCondition.FILLING': 'حشو',
  }
  for (const [key, expected] of Object.entries(terms)) {
    it(`${key} = ${expected}`, () => {
      expect(ar[key]).toBe(expected)
    })
  }
})

describe('direction + interpolation', () => {
  it('ar-EG is RTL; English locales are LTR', () => {
    expect(directionFor('ar-EG')).toBe('rtl')
    expect(directionFor('en-EG')).toBe('ltr')
    expect(directionFor('en-US')).toBe('ltr')
  })

  it('interpolates variables (common.showing)', () => {
    expect(translate('en-EG', 'common.showing', { count: 5, total: 20 })).toBe('Showing 5 of 20')
    expect(translate('ar-EG', 'common.showing', { count: 5, total: 20 })).toBe('عرض 5 من 20')
  })

  it('falls back to the key itself for unknown keys (never renders empty)', () => {
    expect(translate('ar-EG', 'no.such.key')).toBe('no.such.key')
  })
})

// Module-mock based Arabic render tests (hook returns real ar-EG translations)
vi.mock('@/components/providers/language-provider', () => {
  const arDict = require('../../locales/ar.json')
  return {
    LOCALE_COOKIE: 'dentora-locale',
    useLanguage: () => ({
      locale: 'ar-EG',
      dir: 'rtl',
      t: (key: string, vars?: Record<string, string | number>) => {
        let template: string = arDict[key] ?? key
        if (vars) template = template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
        return template
      },
      setLocale: vi.fn(),
    }),
  }
})
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: vi.fn() }) }))
vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

describe('Arabic-mode rendering of wired components', () => {
  it('settings hub renders fully Arabic (title, subtitle, cards)', async () => {
    const { SettingsOverview } = await import('@/components/settings/settings-overview')
    render(
      <SettingsOverview
        categories={[
          { title: 'settings.cards.clinic.title', description: 'settings.cards.clinic.desc', icon: 'Building2', href: '/settings/clinic', color: 'c' },
          { title: 'settings.cards.profile.title', description: 'settings.cards.profile.desc', icon: 'Languages', href: '/settings/profile', color: 'c' },
        ]}
      />
    )
    expect(screen.getByText('الإعدادات والإعداد')).toBeTruthy()
    expect(screen.getByText('إدارة جميع إعدادات وتكوينات النظام')).toBeTruthy()
    expect(screen.getByText('معلومات العيادة')).toBeTruthy()
    expect(screen.getByText('ملفي الشخصي')).toBeTruthy()
    expect(screen.getByText('المظهر')).toBeTruthy()
    // the English source strings must NOT appear
    expect(screen.queryByText('Settings & Configuration')).toBeNull()
  })

  it('access denied page renders fully Arabic', async () => {
    const { AccessDenied } = await import('@/components/settings/access-denied')
    render(<AccessDenied section="billing" />)
    expect(screen.getByText('تم رفض الوصول — 403')).toBeTruthy()
    expect(screen.getByText(/لا تملك صلاحية|دورك لا يملك صلاحية/)).toBeTruthy()
    expect(screen.getByText('القسم المحجوب: billing')).toBeTruthy()
    expect(screen.getByText('الذهاب إلى لوحة المعلومات')).toBeTruthy()
    expect(screen.queryByText(/Access Denied/)).toBeNull()
  })
})

describe('pass-3 close-out sweep (JSX text nodes, JSX expressions, dates)', () => {
  it('translates the copy that lived in JSX text nodes and ternaries', () => {
    // These reached the browser as raw English before the sweep: text nodes that
    // sat after an icon, on their own line, or inside a ternary/template.
    const cases: [string, string][] = [
      ['Queue', 'قائمة الانتظار'],
      ['Waiting list', 'قائمة الانتظار'],
      ['Analytics', 'التحليلات'],
      ['Loading queue…', 'جارٍ تحميل قائمة الانتظار…'],
      ['Date *', 'التاريخ *'],
      ['Record Cycle', 'تسجيل دورة'],
      ['Map columns to', 'مطابقة الأعمدة مع'],
      ['Dental ERP v1.0', 'نظام إدارة العيادة v1.0'],
      ['Dental Clinic', 'عيادة أسنان'],
      ['Generate Forecast', 'إنشاء التوقع'],
      ['AI Risk', 'مخاطر الذكاء الاصطناعي'],
      ['Voice off', 'الصوت معطّل'],
      ['Notes (visible on invoice)', 'ملاحظات (تظهر على الفاتورة)'],
      ['EGP', 'ج.م'],
      ['Odontogram', 'مخطط الأسنان'],
      ['Fill Out', 'املأ النموذج'],
    ]
    for (const [en, ar] of cases) {
      expect(translateText('ar-EG', en), `AR translation for ${JSON.stringify(en)}`).toBe(ar)
      expect(translateText('en-EG', en), `EN round-trip for ${JSON.stringify(en)}`).toBe(en)
    }
  })

  it('translates interpolated templates through vars', () => {
    expect(translateText('ar-EG', 'Clinic holiday: {v1}', { v1: 'عيد الفطر' })).toBe('عطلة العيادة: عيد الفطر')
    expect(translateText('ar-EG', 'Appointment {v1} details', { v1: 'A-12' })).toBe('تفاصيل الموعد A-12')
    expect(translateText('ar-EG', '{v1} appointments loaded', { v1: 0 })).toBe('تم تحميل 0 موعد')
    expect(translateText('ar-EG', 'EGP {v1}', { v1: '120' })).toBe('ج.م 120')
    expect(translateText('en-EG', 'Appointment {v1} details', { v1: 'A-12' })).toBe('Appointment A-12 details')
  })

  it('date-fns formats in Arabic only when the UI locale is Arabic', () => {
    expect(dateFnsLocale('ar-EG')).toBeTruthy()
    expect(dateFnsLocale('en-EG')).toBeUndefined()
    expect(dateFnsLocale('en-US')).toBeUndefined()
    expect(dateFnsLocale(null)).toBeUndefined()
    // end-to-end: the same date renders with Arabic month names for ar-EG
    const d = new Date(2026, 8, 21)
    expect(format(d, 'PP', { locale: dateFnsLocale('ar-EG') })).not.toMatch(/[A-Za-z]/)
    expect(format(d, 'PP', { locale: dateFnsLocale('en-EG') })).toMatch(/Sep/)
  })

  it('clinic governorates and payment methods render in Arabic', () => {
    for (const [en, ar] of [
      ['Cairo', 'القاهرة'],
      ['Giza', 'الجيزة'],
      ['Sharqia', 'الشرقية'],
      ['Cash payment', 'سداد نقدي'],
      ['Fawry payment (POS, retail network)', 'سداد عبر فوري (نقاط البيع وشبكة التجزئة)'],
    ] as [string, string][]) {
      expect(translateText('ar-EG', en)).toBe(ar)
    }
  })
})

describe('dental-chart vocabulary (label-only wiring, no logic touched)', () => {
  it('renders the odontogram summary cards in Arabic', async () => {
    const { OdontogramStats } = await import(
      '@/components/dental-chart/odontogram/OdontogramStats'
    )
    render(
      <OdontogramStats
        stats={{
          presentTeeth: 28,
          cariesTeeth: 2,
          filledTeeth: 3,
          missingTeeth: 4,
          rootCanalTeeth: 1,
          implantTeeth: 2,
        } as never}
      />
    )
    for (const label of ['الأسنان الموجودة', 'التسوس', 'الترميمات', 'المفقودة / المخلوعة', 'علاج العصب', 'الزرعات'])
      expect(screen.getByText(label), label).toBeTruthy()
    expect(screen.queryByText('Present Teeth')).toBeNull()
  })

  it('ships Arabic for every dental condition, description, severity and tooth name', () => {
    for (const [key, expected] of Object.entries({
      Crown: 'تاج',
      Bridge: 'جسر',
      Implant: 'زرعة',
      'Root Canal': 'علاج العصب',
      Extracted: 'مخلوع',
      Missing: 'مفقود',
      Fractured: 'مكسور',
      Sensitive: 'حساس',
      Mobility: 'حركية السن',
      Abscess: 'خراج',
      Periodontal: 'دواعم السن',
      Veneer: 'فينير',
      Mild: 'بسيطة',
      Moderate: 'متوسطة',
      Severe: 'شديدة',
      'Upper Right Central Incisor': 'القاطع المركزي العلوي الأيمن',
      'Lower Left Third Molar (Wisdom)': 'ضرس العقل السفلي الأيسر',
      'Active carious lesion or enamel dedemineralization': 'تسوس نشط أو فقدان تمعدن المينا',
      'Clinical Condition': 'الحالة السريرية',
      'Surfaces Affected': 'الأسطح المتأثرة',
      'Condition Legend': 'دليل الحالات',
      'No prior historical records for this tooth.': 'لا توجد سجلات سابقة لهذا السن.',
      'Save Failed': 'فشل الحفظ',
    })) {
      expect((ar as Record<string, string>)[key], `ar:${key}`).toBe(expected)
      expect((en as Record<string, string>)[key], `en:${key}`).toBe(key)
    }
  })
})

describe('page titles and report-builder chips (live-probe findings)', () => {
  it('localizes page metadata titles instead of hardcoding English', () => {
    for (const [key, expected] of Object.entries({
      Settings: 'الإعدادات',
      'Access Denied — 403': 'تم رفض الوصول — 403',
      'Patient Portal': 'بوابة المريض',
    })) {
      expect((ar as Record<string, string>)[key], `ar:${key}`).toBe(expected)
      expect((en as Record<string, string>)[key], `en:${key}`).toBe(key)
    }
  })

  it('translates the report-builder example queries', () => {
    for (const [key, expected] of Object.entries({
      'Monthly revenue by procedure for last 3 months': 'إيرادات شهرية حسب الإجراء لآخر 3 أشهر',
      "Patients who haven't visited in 6 months": 'مرضى لم يزوروا العيادة خلال 6 أشهر',
      'Overdue invoices sorted by amount': 'الفواتير المتأخرة مرتبة حسب المبلغ',
      'Appointment no-show rate by day of week': 'معدل عدم حضور المواعيد حسب يوم الأسبوع',
      'Top 5 most performed procedures this quarter': 'أكثر 5 إجراءات تنفيذًا هذا الربع',
      'Inventory items running low on stock': 'أصناف المخزون على وشك النفاد',
      'Google Calendar': 'تقويم Google',
    })) {
      expect((ar as Record<string, string>)[key], `ar:${key}`).toBe(expected)
    }
  })
})

describe('data-dependent copy SSR sweeps cannot reach (feeds, durations, currency)', () => {
  it('formats relative timestamps in Arabic for the notification feed', async () => {
    const { formatRelativeTime } = await import('@/lib/i18n/format')
    const now = Date.now()
    // 30s / 5min / 3h / 2d ago — the tray renders these only when notifications exist
    expect(formatRelativeTime(new Date(now - 30_000), { locale: 'ar-EG' })).toBe('الآن')
    expect(formatRelativeTime(new Date(now - 5 * 60_000), { locale: 'ar-EG' })).toBe('قبل 5 دقيقة')
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000), { locale: 'ar-EG' })).toBe('قبل 3 ساعة')
    expect(formatRelativeTime(new Date(now - 2 * 86_400_000), { locale: 'ar-EG' })).toBe('قبل 2 يوم')
    // English mode keeps the original wording, and a null date uses the caller fallback
    expect(formatRelativeTime(new Date(now - 5 * 60_000), { locale: 'en-EG' })).toBe('5m ago')
    expect(formatRelativeTime(null, { locale: 'ar-EG', fallback: 'لم يتصل بعد' })).toBe('لم يتصل بعد')
    // a stale timestamp falls through to a locale-aware absolute date
    const stale = formatRelativeTime(new Date(now - 40 * 86_400_000), { locale: 'ar-EG' })
    expect(stale).not.toMatch(/[A-Za-z]{3}/)
  })

  it('renders the notification tray in Arabic when notifications are present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          notifications: [
            {
              id: 'n1',
              title: 'Appointment confirmed',
              message: 'Aisha Mahmoud confirmed her 10:00 visit',
              type: 'APPOINTMENT',
              isRead: false,
              createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
            },
          ],
          unreadCount: 1,
        }),
      })) as never
    )
    const { NotificationTray } = await import('@/components/layout/notification-tray')
    const { fireEvent } = await import('@testing-library/react')
    render(<NotificationTray />)
    // The feed lives in a Radix dropdown, so it only mounts once the tray is opened
    // (keyboard activation is the reliable path in jsdom).
    const trigger = await screen.findByRole('button', { name: /الإشعارات/ })
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
    const relative = await screen.findAllByText('قبل 5 دقيقة')
    expect(relative.length).toBeGreaterThan(0)
    expect(screen.getAllByText('Aisha Mahmoud confirmed her 10:00 visit').length).toBeGreaterThan(0)
    expect(screen.queryByText(/m ago/)).toBeNull()
    vi.unstubAllGlobals()
  })

  it('ships Arabic membership durations, plural forms and an EGP price label', () => {
    for (const [key, expected] of Object.entries({
      '1 month': 'شهر واحد',
      '1 year': 'سنة واحدة',
      '{v1} months': '{v1} أشهر',
      '{v1} years': '{v1} سنوات',
      '{v1} member': '{v1} عضو',
      '{v1} members': '{v1} أعضاء',
      'Price (EGP) *': 'السعر (ج.م) *',
    })) {
      expect((ar as Record<string, string>)[key], `ar:${key}`).toBe(expected)
    }
    // the rupee sign has no place in an EGP clinic build
    for (const [key, value] of Object.entries(ar)) {
      if (key === 'p4.currency_placeholder') continue
      expect(String(value), `ar:${key}`).not.toContain('₹')
    }
  })
})

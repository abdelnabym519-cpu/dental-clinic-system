// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import ar from '../../locales/ar.json'
import en from '../../locales/en.json'
import { translate, directionFor } from '@/lib/i18n/dictionary'

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

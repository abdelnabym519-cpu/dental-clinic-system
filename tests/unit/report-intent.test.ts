// @ts-nocheck
import { describe, it, expect } from 'vitest'
import {
  detectReportIntent,
  detectRange,
  normalizeArabic,
  cairoReportWindow,
} from '@/lib/ai/report-intent'

// ---------------------------------------------------------------------------
// Issue 4 — deterministic Arabic/Egyptian report intent routing.
// These are PHASE 7 (intent vocabulary) + PHASE 8 (date semantics) contracts.
// ---------------------------------------------------------------------------

describe('normalizeArabic', () => {
  it('strips tashkeel/tatweel and unifies alef/ya/ta-marbuta', () => {
    const out = normalizeArabic('أكثر الإجراءات شيوعًا')
    expect(out).not.toMatch(/[أإآ]/)
    expect(out).not.toMatch(/[\u064B-\u0652\u0640]/)
    expect(out.startsWith('اكثر')).toBe(true)
    expect(out.endsWith('شيوعا')).toBe(true)
    expect(normalizeArabic('مواعيد ملغاة')).toBe('مواعيد ملغاه')
    expect(normalizeArabic('مَلْغِيَّة')).toContain('ملغي')
  })
})

describe('detectReportIntent — new patients (Egyptian + MSA variants)', () => {
  const queries = [
    'وريني عدد المرضى الجدد',
    'المرضى اللي اتسجلوا جديد',
    'كام مريض جديد النهارده',
    'عدد المرضى الجدد',
    'المرضى الجدد النهارده',
    'اعمل تقرير عن المرضى الجدد',
    'مين السجلات الجديدة؟',
  ]
  for (const q of queries) {
    it(`"${q}" → new_patients`, () => {
      expect(detectReportIntent(q)?.kind).toBe('new_patients')
    })
  }
})

describe('detectReportIntent — revenue', () => {
  const queries = [
    'قولي إيرادات العيادة',
    'الإيرادات',
    'دخل العيادة',
    'الدخل',
    'الإيراد',
    'فلوس العيادة',
    'الإيرادات النهارده',
    'اعمل تقرير عن الإيرادات',
  ]
  for (const q of queries) {
    it(`"${q}" → revenue`, () => {
      expect(detectReportIntent(q)?.kind).toBe('revenue')
    })
  }
})

describe('detectReportIntent — cancelled appointments', () => {
  const queries = [
    'وريني المواعيد الملغية',
    'المواعيد اللي اتلغت',
    'الحجوزات الملغية',
    'المواعيد الملغاة',
    'كام ميعاد اتلغى',
  ]
  for (const q of queries) {
    it(`"${q}" → cancelled_appointments`, () => {
      expect(detectReportIntent(q)?.kind).toBe('cancelled_appointments')
    })
  }
})

describe('detectReportIntent — top procedures', () => {
  const queries = [
    'إيه أكتر الإجراءات اللي اتعملت؟',
    'أكثر الإجراءات',
    'أكتر علاج اتعمل',
    'أكثر علاج',
    'الإجراءات الأكثر تنفيذًا',
    'أكثر الإجراءات شيوعًا',
  ]
  for (const q of queries) {
    it(`"${q}" → top_procedures`, () => {
      expect(detectReportIntent(q)?.kind).toBe('top_procedures')
    })
  }
})

describe('detectReportIntent — honesty guards', () => {
  it('ambiguous multi-intent queries stay on the LLM path (null)', () => {
    expect(detectReportIntent('إيرادات العيادة والمواعيد الملغية')).toBeNull()
  })
  it('non-report queries stay on the LLM path', () => {
    expect(detectReportIntent('مين اللي حضر النهارده؟')).toBeNull()
    expect(detectReportIntent('اعرض الفواتير المتأخرة')).toBeNull()
    expect(detectReportIntent('hello')).toBeNull()
    expect(detectReportIntent('')).toBeNull()
  })
})

describe('detectRange — Arabic time words', () => {
  it('النهارده/اليوم → today', () => {
    expect(detectRange('المرضى الجدد النهارده')).toBe('today')
    expect(detectRange('إيرادات اليوم')).toBe('today')
  })
  it('امبارح/أمس → yesterday', () => {
    expect(detectRange('المواعيد الملغية امبارح')).toBe('yesterday')
    expect(detectRange('إيرادات أمس')).toBe('yesterday')
  })
  it('الأسبوع ده → week', () => {
    expect(detectRange('المرضى الجدد الأسبوع ده')).toBe('week')
    expect(detectRange('المرضى الجدد هذا الأسبوع')).toBe('week')
  })
  it('الشهر ده / no time word → month (preset semantics)', () => {
    expect(detectRange('المرضى الجدد الشهر ده')).toBe('month')
    expect(detectRange('وريني عدد المرضى الجدد')).toBe('month')
  })
})

describe('cairoReportWindow — Egypt-local day semantics (never raw UTC)', () => {
  // 2026-07-01 23:30 UTC = 2026-07-02 01:30 Cairo → "today" is July 2nd in Cairo.
  const lateUTC = new Date('2026-07-01T23:30:00Z')

  it('today window covers Cairo-local July 2nd, not the UTC day', () => {
    const w = cairoReportWindow('today', lateUTC)
    expect(w.gte.toISOString()).toBe('2026-07-01T21:00:00.000Z') // Cairo 00:00 (UTC+3 DST)
    expect(w.lt.toISOString()).toBe('2026-07-02T21:00:00.000Z')
    expect(w.label).toBe('اليوم')
  })

  it('yesterday ends exactly at today start', () => {
    const w = cairoReportWindow('yesterday', lateUTC)
    const today = cairoReportWindow('today', lateUTC)
    expect(w.lt.toISOString()).toBe(today.gte.toISOString())
    expect(w.label).toBe('أمس')
  })

  it('week starts on Cairo-local Sunday and spans 7 days', () => {
    // 2026-07-01 is a Wednesday → week started Sunday 2026-06-28.
    const w = cairoReportWindow('week', new Date('2026-07-01T12:00:00Z'))
    expect(w.gte.toISOString()).toBe('2026-06-27T21:00:00.000Z')
    expect(w.lt.getTime() - w.gte.getTime()).toBe(7 * 24 * 3600_000)
  })

  it('month window is the Cairo calendar month', () => {
    const w = cairoReportWindow('month', new Date('2026-07-01T12:00:00Z'))
    expect(w.gte.toISOString()).toBe('2026-06-30T21:00:00.000Z') // Cairo Jul 1 00:00 (+03)
    expect(w.lt.toISOString()).toBe('2026-07-31T21:00:00.000Z') // Cairo Aug 1 00:00 (+03)
  })
})

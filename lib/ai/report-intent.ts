/**
 * Issue 4 — deterministic Arabic/Egyptian report intent routing.
 *
 * The reports page must keep working when the local LLM runtime is not
 * configured/reachable — and the four canonical clinic reports must be
 * servable deterministically even when it is. This module recognizes the
 * natural-language intent + time range for those reports in Egyptian Arabic
 * (and MSA), so the fallback does not depend on English keywords or on the
 * exact preset chip wording.
 *
 * Pure functions only — no Prisma, no network. The route executes the
 * matched intent through whitelisted, hospitalId-scoped builders.
 */

export type ReportKind =
  | 'new_patients'
  | 'revenue'
  | 'cancelled_appointments'
  | 'top_procedures'

export type ReportRange = 'today' | 'yesterday' | 'week' | 'month'

export interface DetectedReport {
  kind: ReportKind
  range: ReportRange
}

// ── Intent vocabulary (Egyptian Arabic + MSA, semantic variants) ────────────
// Compact per intent — deliberately NOT an open keyword dump: every entry
// maps to one of the four whitelisted deterministic builders.

const NEW_PATIENTS = [
  'المرضى الجدد',
  'المرضى الجداد',
  'مريض جديد',
  'مرضى جدد',
  'كام مريض جديد',
  'عدد المرضى الجدد',
  'اتسجلوا جديد',
  'اللي اتسجلوا',
  'المرضى اللي اتسجلوا',
  'تسجيل جديد',
  'حالات جديدة',
  'السجلات الجديدة',
  'سجلات جديدة',
  'مرضى اليوم الجدد',
  'تقرير المرضى الجدد',
]

const REVENUE = [
  'الإيرادات',
  'الايرادات',
  'الإيراد',
  'الايراد',
  'إيرادات',
  'ايرادات',
  'الدخل',
  'دخل العيادة',
  'دخل',
  'الفلوس',
  'فلوس العيادة',
  'المحصل',
  'المحصّل',
  'تحصيل',
  'المبيعات',
  'تقرير الإيرادات',
]

const CANCELLED = [
  'المواعيد الملغية',
  'المواعيد الملغاة',
  'المواعيد اللي اتلغت',
  'الحجوزات الملغية',
  'الحجوزات الملغاة',
  'الحجوزات اللي اتلغت',
  'كام ميعاد اتلغى',
  'مواعيد ملغية',
  'الملغية',
  'الملغاة',
  'اتلغت',
  'الغاء موعد',
  'إلغاء موعد',
]

const TOP_PROCEDURES = [
  'أكتر الإجراءات',
  'اكتر الإجراءات',
  'أكثر الإجراءات',
  'اكتر علاج',
  'أكتر علاج',
  'أكثر علاج',
  'الإجراءات الأكثر',
  'الاجراءات اللي اتعملت',
  'الإجراءات اللي اتعملت',
  'الإجراءات الأكثر تنفيذًا',
  'أكثر الإجراءات شيوعًا',
  'الإجراءات المنتشرة',
  'أشهر الإجراءات',
  'أشهر علاج',
]

function matchesAny(text: string, vocabulary: string[]): boolean {
  return vocabulary.some((term) => text.includes(term))
}

/**
 * Normalize Egyptian/Arabic variants that change string matching:
 * أ/إ/آ → ا, ى → ي, ة → ه, tashkeel stripped, tatweel removed.
 */
export function normalizeArabic(text: string): string {
  return String(text ?? '')
    .replace(/[\u064B-\u0652\u0640]/g, '') // tashkeel + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
}

/**
 * Detect which canonical report the user is asking for, and its time range.
 * Returns null when the query does not clearly map to a deterministic report
 * (the caller then uses the real LLM path).
 */
export function detectReportIntent(rawQuery: string): DetectedReport | null {
  const q = normalizeArabic(rawQuery)
  if (!q.trim()) return null

  let kind: ReportKind | null = null

  if (matchesAny(q, NEW_PATIENTS.map(normalizeArabic))) kind = 'new_patients'
  if (matchesAny(q, TOP_PROCEDURES.map(normalizeArabic))) kind = 'top_procedures'
  if (matchesAny(q, CANCELLED.map(normalizeArabic))) kind = 'cancelled_appointments'
  // revenue last: generic 'دخل' must not steal a more specific match
  if (matchesAny(q, REVENUE.map(normalizeArabic))) kind = 'revenue'

  // A revenue word alone inside a procedures/cancellations sentence must not
  // flip the intent — but two different intents in one query is ambiguous and
  // stays on the LLM path.
  const hits = [
    matchesAny(q, NEW_PATIENTS.map(normalizeArabic)),
    matchesAny(q, TOP_PROCEDURES.map(normalizeArabic)),
    matchesAny(q, CANCELLED.map(normalizeArabic)),
    matchesAny(q, REVENUE.map(normalizeArabic)),
  ].filter(Boolean).length
  if (hits > 1) return null
  if (!kind) return null

  return { kind, range: detectRange(q) }
}

/** Time-range words: النهارده / امبارح / الأسبوع ده / الشهر ده (+ MSA).
 * No time word → 'month' (same semantics as the preset chips). */
export function detectRange(normalizedQuery: string): ReportRange {
  const q = normalizeArabic(normalizedQuery)
  if (
    q.includes('امبارح') ||
    q.includes('امس') ||
    q.includes('البارحه') ||
    q.includes('اليوم السابق')
  ) {
    return 'yesterday'
  }
  if (
    q.includes('النهارده') ||
    q.includes('النهاردة') ||
    q.includes('اليوم') ||
    q.includes('انهرده')
  ) {
    return 'today'
  }
  if (
    q.includes('الاسبوع') ||
    q.includes('هذا الاسبوع') ||
    q.includes('الاسبوع الحالي')
  ) {
    return 'week'
  }
  if (q.includes('الشهر') || q.includes('شهري')) return 'month'
  // default and explicit today
  return 'month'
}

// ── Cairo-local day windows ─────────────────────────────────────────────────
// Egyptian clinic semantics: a "day" runs 00:00–24:00 Africa/Cairo, never a
// UTC block. Same convention the SMS service uses for its time window.

const CAIRO_TZ = 'Africa/Cairo'

function cairoParts(d: Date): { y: number; m: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  })
  const [day, m, y] = fmt.format(d).split(/[\/,]/).map((v) => parseInt(v, 10))
  const hour = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO_TZ, hour: '2-digit', hour12: false }).format(d),
    10
  )
  return { y, m, day, hour }
}

/** Cairo's UTC offset (minutes) at the given instant. Noon probes are safe:
 * Egypt's DST transitions happen around midnight, never at noon. */
function cairoOffsetMinutes(instant: Date): number {
  const p = cairoParts(instant)
  const wallAsUTC = Date.UTC(p.y, p.m - 1, p.day) + (p.hour % 24) * 3600_000
  return (wallAsUTC - instant.getTime()) / 60_000
}

/** UTC instant of Cairo-local midnight for the given Y/M/D (+N days). */
function cairoMidnight(y: number, m: number, day: number, addDays = 0): Date {
  const probe = new Date(Date.UTC(y, m - 1, day + addDays, 12)) // noon guess
  const offsetMin = cairoOffsetMinutes(probe)
  return new Date(Date.UTC(y, m - 1, day + addDays) - offsetMin * 60_000)
}

export interface CairoWindow {
  gte: Date
  lt: Date
  label: string
}

/** Cairo-local [gte, lt) window for a report range, relative to `now`. */
export function cairoReportWindow(range: ReportRange, now: Date = new Date()): CairoWindow {
  const { y, m, day } = cairoParts(now)
  switch (range) {
    case 'today':
      return {
        gte: cairoMidnight(y, m, day),
        lt: cairoMidnight(y, m, day, 1),
        label: 'اليوم',
      }
    case 'yesterday':
      return {
        gte: cairoMidnight(y, m, day, -1),
        lt: cairoMidnight(y, m, day),
        label: 'أمس',
      }
    case 'week': {
      const weekday = cairoWeekday(now) // 0 = Cairo-local Sunday
      return {
        gte: cairoMidnight(y, m, day - weekday),
        lt: cairoMidnight(y, m, day - weekday + 7),
        label: 'هذا الأسبوع',
      }
    }
    case 'month':
    default:
      return {
        gte: cairoMidnight(y, m, 1),
        lt: cairoMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1),
        label: 'هذا الشهر',
      }
  }
}

function cairoWeekday(instant: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: CAIRO_TZ, weekday: 'short' }).format(
    instant
  )
  const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return order.indexOf(name)
}

/** Human Arabic label used in the deterministic summary line. */
export function rangeLabel(range: ReportRange): string {
  switch (range) {
    case 'today':
      return 'اليوم'
    case 'yesterday':
      return 'أمس'
    case 'week':
      return 'هذا الأسبوع'
    case 'month':
      return 'هذا الشهر'
  }
}

/** Canonical honesty notice — a deterministic report never claims AI. */
export const DETERMINISTIC_NOTICE =
  'تم إنشاء هذا التقرير بالطريقة المحلية المباشرة (بدون نموذج ذكاء اصطناعي).'
export const DETERMINISTIC_FALLBACK_NOTICE =
  'تعذر تشغيل محرك الذكاء الاصطناعي حاليًا، لذلك تم إنشاء التقرير بالطريقة المحلية المباشرة.'

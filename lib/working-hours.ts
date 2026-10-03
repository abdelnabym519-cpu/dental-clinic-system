/**
 * Canonical hospital working-hours resolution (Issue 2 — live defect).
 *
 * TWO shapes exist in production data:
 *  - canonical:  {"start":"09:00","end":"21:00","lunchStart":"13:00","lunchEnd":"14:00"}
 *                (written by seed variants and older onboarding)
 *  - per-day:    {"monday":{"open":"09:00","close":"18:00","closed":false}, ...}
 *                (written by the onboarding wizard — the common case)
 *
 * The slots API used to read `.start` directly and crashed (500) on the
 * per-day shape → the appointment form showed "لا توجد مواعيد متاحة في هذا
 * التاريخ" for EVERY date. This normalizer accepts BOTH, never throws, and
 * always returns a usable day window with safe defaults.
 */

export interface DayWorkingWindow {
  start: string
  end: string
  /** Lunch break only exists in the canonical shape (per-day data has none). */
  lunchStart: string | null
  lunchEnd: string | null
  closed: boolean
  /** Which shape the stored JSON turned out to be (for telemetry/tests). */
  source: 'canonical' | 'per_day' | 'default'
}

const DEFAULTS = {
  start: '09:00',
  end: '21:00',
  lunchStart: '13:00',
  lunchEnd: '14:00',
}

/** JS getDay() order (0 = Sunday) → the per-day JSON keys (lowercase). */
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

function safeTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value.trim()) ? value.trim() : fallback
}

export function resolveDayWorkingWindow(raw: string | null | undefined, dayOfWeek: number): DayWorkingWindow {
  // No stored value → hospital-level defaults (the pre-existing behavior).
  if (!raw || typeof raw !== 'string') {
    return { start: DEFAULTS.start, end: DEFAULTS.end, lunchStart: DEFAULTS.lunchStart, lunchEnd: DEFAULTS.lunchEnd, closed: false, source: 'default' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Garbage JSON behaves exactly like "no stored value" — NEVER a 500.
    return { start: DEFAULTS.start, end: DEFAULTS.end, lunchStart: DEFAULTS.lunchStart, lunchEnd: DEFAULTS.lunchEnd, closed: false, source: 'default' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { start: DEFAULTS.start, end: DEFAULTS.end, lunchStart: DEFAULTS.lunchStart, lunchEnd: DEFAULTS.lunchEnd, closed: false, source: 'default' }
  }
  const obj = parsed as Record<string, unknown>

  // Canonical flat shape.
  if (typeof obj.start === 'string') {
    const start = safeTime(obj.start, DEFAULTS.start)
    const end = safeTime(obj.end, DEFAULTS.end)
    return {
      start,
      end,
      lunchStart: safeTime(obj.lunchStart, DEFAULTS.lunchStart),
      lunchEnd: safeTime(obj.lunchEnd, DEFAULTS.lunchEnd),
      closed: false,
      source: 'canonical',
    }
  }

  // Per-day shape (onboarding wizard): {monday:{open,close,closed}, ...}.
  const key = DAY_KEYS[((dayOfWeek % 7) + 7) % 7]
  const day = obj[key]
  if (day && typeof day === 'object') {
    const d = day as Record<string, unknown>
    // Some rows store `closed` implicitly (null open/close).
    const closed = d.closed === true || (d.open == null && d.close == null)
    if (closed) {
      return { start: DEFAULTS.start, end: DEFAULTS.end, lunchStart: null, lunchEnd: null, closed: true, source: 'per_day' }
    }
    const open = safeTime(d.open, DEFAULTS.start)
    const close = safeTime(d.close ?? d.opens, DEFAULTS.end)
    return {
      start: open,
      end: close,
      lunchStart: null,
      lunchEnd: null,
      closed: false,
      source: 'per_day',
    }
  }

  // Day missing from the per-day object → clinic did not declare it: closed
  // is the honest reading of an onboarding wizard where the day was left out.
  return { start: DEFAULTS.start, end: DEFAULTS.end, lunchStart: null, lunchEnd: null, closed: true, source: 'per_day' }
}

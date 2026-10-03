/**
 * Canonical hospital working-hours resolution.
 *
 * Stored data may use either a flat schedule (`start`/`end`, or the legacy
 * `startTime`/`endTime`) or the clinic's per-day JSON (`monday: {open,
 * close, closed}`). Missing configuration uses the clinic's documented
 * weekly defaults: Monday–Thursday 09:00–17:00, Friday closed, Saturday
 * 09:00–14:00, and Sunday closed.
 */
import { isValidTime, timeToMinutes } from '@/lib/agenda-utils'

export interface DayWorkingWindow {
  start: string
  end: string
  lunchStart: string | null
  lunchEnd: string | null
  closed: boolean
  source: 'canonical' | 'per_day' | 'default'
}

export const DEFAULT_CLINIC_WEEK: Readonly<Record<string, { open: string | null; close: string | null; closed: boolean }>> = {
  monday: { open: '09:00', close: '17:00', closed: false },
  tuesday: { open: '09:00', close: '17:00', closed: false },
  wednesday: { open: '09:00', close: '17:00', closed: false },
  thursday: { open: '09:00', close: '17:00', closed: false },
  friday: { open: null, close: null, closed: true },
  saturday: { open: '09:00', close: '14:00', closed: false },
  sunday: { open: null, close: null, closed: true },
}

const DEFAULT_START = '09:00'
const DEFAULT_END = '17:00'
const DEFAULT_LUNCH_START = '13:00'
const DEFAULT_LUNCH_END = '14:00'

/** JS getDay() order (0 = Sunday) → lowercase per-day JSON keys. */
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

function normalizedDay(dayOfWeek: number): number {
  return Number.isFinite(dayOfWeek) ? ((Math.trunc(dayOfWeek) % 7) + 7) % 7 : 0
}

function closedWindow(source: DayWorkingWindow['source']): DayWorkingWindow {
  return {
    start: DEFAULT_START,
    end: DEFAULT_END,
    lunchStart: null,
    lunchEnd: null,
    closed: true,
    source,
  }
}

function defaultWindow(dayOfWeek: number): DayWorkingWindow {
  const key = DAY_KEYS[normalizedDay(dayOfWeek)]
  const day = DEFAULT_CLINIC_WEEK[key]
  if (day.closed || !day.open || !day.close) return closedWindow('default')
  return {
    start: day.open,
    end: day.close,
    lunchStart: null,
    lunchEnd: null,
    closed: false,
    source: 'default',
  }
}

function parseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return isValidTime(normalized) ? normalized : null
}

function validWindow(start: string | null, end: string | null): start is string {
  return !!start && !!end && timeToMinutes(start) < timeToMinutes(end)
}

function parseLunch(start: unknown, end: unknown, defaultWhenMissing = false) {
  const startValue = parseTime(start) ?? (defaultWhenMissing ? DEFAULT_LUNCH_START : null)
  const endValue = parseTime(end) ?? (defaultWhenMissing ? DEFAULT_LUNCH_END : null)
  if (!startValue || !endValue || timeToMinutes(startValue) >= timeToMinutes(endValue)) return null
  return { lunchStart: startValue, lunchEnd: endValue }
}

/**
 * Resolve one clinic day. Invalid JSON behaves like no configuration; a
 * malformed or explicitly closed day inside a per-day schedule is closed,
 * so incomplete settings never invent availability.
 */
export function resolveDayWorkingWindow(
  raw: string | null | undefined,
  dayOfWeek: number
): DayWorkingWindow {
  const fallback = defaultWindow(dayOfWeek)
  if (!raw || typeof raw !== 'string' || !raw.trim()) return fallback

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback

  const obj = parsed as Record<string, unknown>
  const hasFlatShape = ['start', 'end', 'startTime', 'endTime'].some((key) => key in obj)
  if (hasFlatShape) {
    const start = parseTime(obj.start ?? obj.startTime)
    const end = parseTime(obj.end ?? obj.endTime)
    if (!validWindow(start, end)) return fallback

    const lunch = parseLunch(obj.lunchStart, obj.lunchEnd, true)
    return {
      start,
      end: end!,
      lunchStart: lunch?.lunchStart ?? null,
      lunchEnd: lunch?.lunchEnd ?? null,
      closed: false,
      source: 'canonical',
    }
  }

  const dayKey = DAY_KEYS[normalizedDay(dayOfWeek)]
  const dayValue = obj[dayKey]
  if (dayValue === undefined) {
    // If any known day key exists, this is an intentionally partial weekly
    // schedule. Omitted days stay closed rather than being silently opened.
    if (DAY_KEYS.some((key) => key in obj)) return closedWindow('per_day')
    return fallback
  }
  if (!dayValue || typeof dayValue !== 'object' || Array.isArray(dayValue)) {
    return closedWindow('per_day')
  }

  const day = dayValue as Record<string, unknown>
  const start = parseTime(day.open ?? day.start ?? day.startTime)
  const end = parseTime(day.close ?? day.end ?? day.endTime ?? day.opens)
  if (day.closed === true || !validWindow(start, end)) return closedWindow('per_day')

  const lunch = parseLunch(day.lunchStart, day.lunchEnd)
  return {
    start,
    end: end!,
    lunchStart: lunch?.lunchStart ?? null,
    lunchEnd: lunch?.lunchEnd ?? null,
    closed: false,
    source: 'per_day',
  }
}

/**
 * Build explicit default shift rows for a newly created doctor, mirroring the
 * clinic's stored weekly hours where present and the shared clinic defaults
 * otherwise. Closed days are persisted as inactive rows so downstream
 * availability does not accidentally fall back to a broader schedule.
 */
export function buildDefaultDoctorShifts(
  hospitalId: string,
  staffId: string,
  workingHoursRaw: string | null | undefined
) {
  return DAY_KEYS.map((_, dayOfWeek) => {
    const window = resolveDayWorkingWindow(workingHoursRaw, dayOfWeek)
    return {
      hospitalId,
      staffId,
      dayOfWeek,
      startTime: window.start,
      endTime: window.end,
      isActive: !window.closed,
    }
  })
}

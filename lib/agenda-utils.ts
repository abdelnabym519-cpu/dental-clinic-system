/**
 * Agenda scheduling primitives.
 *
 * All date handling here is deliberately LOCAL and string-based:
 * - The canonical UI date key is `YYYY-MM-DD` built from local Y/M/D parts
 *   (never `toISOString()`, which shifts the key for UTC-negative/positive
 *   evenings and caused off-by-one-day bugs).
 * - The canonical time value is `HH:MM` (24h), matching `Appointment.scheduledTime`.
 */

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

/** True when `value` is a valid `HH:MM` 24-hour time string. */
export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_REGEX.test(value)
}

/** `HH:MM` → minutes since midnight. Caller must validate first. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Minutes since midnight → `HH:MM`. */
export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Two `[start, start+duration)` ranges (minutes since midnight) overlap
 * when each starts before the other ends. Touching ranges (09:00-09:30 and
 * 09:30-10:00) do NOT overlap.
 */
export function timeRangesOverlap(aStart: number, aDuration: number, bStart: number, bDuration: number): boolean {
  if (aDuration <= 0 || bDuration <= 0) return false
  return aStart < bStart + bDuration && bStart < aStart + aDuration
}

/** Local-calendar `YYYY-MM-DD` key for a Date (no UTC shifting). */
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Parse a `YYYY-MM-DD` key into a **local** Date at midnight.
 * Unlike `new Date('YYYY-MM-DD')` (UTC), this never shifts the calendar day.
 */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error(`Invalid date key: ${key}`)
  }
  return new Date(y, m - 1, d)
}

/** Day-by-day offset on the local calendar. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Sunday-based week start of the given date's week. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  start.setHours(0, 0, 0, 0)
  return start
}

/** First day of the month, local midnight. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/**
 * The Agenda working day, in minutes since midnight.
 * Continuous 07:00–21:00 so any appointment inside hospital working hours
 * renders regardless of the half-hour grid (unlike slot-index lookups).
 */
export const AGENDA_START_MINUTES = 7 * 60
export const AGENDA_END_MINUTES = 21 * 60
export const AGENDA_TOTAL_MINUTES = AGENDA_END_MINUTES - AGENDA_START_MINUTES

/** Y-position (%) of a `HH:MM` time inside the agenda timeline. */
export function agendaPositionPercent(time: string): number {
  const mins = timeToMinutes(time)
  const clamped = Math.min(Math.max(mins, AGENDA_START_MINUTES), AGENDA_END_MINUTES)
  return ((clamped - AGENDA_START_MINUTES) / AGENDA_TOTAL_MINUTES) * 100
}

/** Height (%) of a duration (minutes) inside the agenda timeline, minimum 2.5% so short blocks stay visible. */
export function agendaHeightPercent(duration: number): number {
  return Math.max((Math.min(duration, AGENDA_TOTAL_MINUTES) / AGENDA_TOTAL_MINUTES) * 100, 2.5)
}

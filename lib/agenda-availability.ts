/**
 * Agenda Phase-2 scheduling primitives: working hours, breaks, vacations,
 * holidays, room conflicts, recurrence expansion and analytics math.
 *
 * Pure functions only — the API routes own tenant scoping and persistence.
 * All times are `HH:MM` 24h strings; all dates are local `YYYY-MM-DD` keys
 * (see lib/agenda-utils.ts for the canonical conversion helpers).
 */
import { isValidTime, timeToMinutes, timeRangesOverlap, addDays, toDateKey, parseDateKey } from '@/lib/agenda-utils'

export interface WorkingWindow {
  startTime: string
  endTime: string
}

export interface ClinicWorkingHours extends WorkingWindow {
  lunchStart?: string
  lunchEnd?: string
}

export const DEFAULT_WORKING_HOURS: ClinicWorkingHours = {
  startTime: '09:00',
  endTime: '21:00',
  lunchStart: '13:00',
  lunchEnd: '14:00',
}

export const RECURRENCE_PATTERNS = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const
export type RecurrencePattern = (typeof RECURRENCE_PATTERNS)[number]

export const MAX_RECURRENCE_OCCURRENCES = 60

/** True when `[start, start + duration)` lies fully inside the working window. */
export function isWithinWorkingHours(time: string, duration: number, window: WorkingWindow): boolean {
  if (!isValidTime(time) || !isValidTime(window.startTime) || !isValidTime(window.endTime)) return false
  const start = timeToMinutes(time)
  const end = start + duration
  return start >= timeToMinutes(window.startTime) && end <= timeToMinutes(window.endTime)
}

/** True when the appointment range intersects the clinic's recurring lunch break. */
export function overlapsBreak(
  time: string,
  duration: number,
  workingHours: Pick<ClinicWorkingHours, 'lunchStart' | 'lunchEnd'>
): boolean {
  const { lunchStart, lunchEnd } = workingHours
  if (!lunchStart || !lunchEnd || !isValidTime(lunchStart) || !isValidTime(lunchEnd)) return false
  const lunchStartMin = timeToMinutes(lunchStart)
  const lunchEndMin = timeToMinutes(lunchEnd)
  if (lunchEndMin <= lunchStartMin) return false
  const start = timeToMinutes(time)
  return timeRangesOverlap(start, duration, lunchStartMin, lunchEndMin - lunchStartMin)
}

export interface LeaveWindow {
  leaveType?: string
  status?: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}

export interface HolidayEntry {
  date: string // YYYY-MM-DD
  isRecurring?: boolean
}

/** True when an APPROVED leave window covers the given local date key. */
export function isOnApprovedLeave(dateKey: string, leaves: LeaveWindow[]): boolean {
  return leaves.some(
    (l) => l.status === 'APPROVED' && l.startDate <= dateKey && dateKey <= l.endDate
  )
}

/** True when the clinic is closed on the given date (fixed or recurring annual holiday). */
export function isClinicHoliday(dateKey: string, holidays: HolidayEntry[]): boolean {
  return holidays.some((h) => {
    if (h.date === dateKey) return true
    // Recurring holidays match on month-day every year.
    if (h.isRecurring && h.date.length >= 10) {
      const md = h.date.slice(5)
      return dateKey.length >= 10 && dateKey.slice(5) === md
    }
    return false
  })
}

/** Room double-booking: same `[start, start+duration)` overlap math as doctors. */
export function roomOverlapExists(
  time: string,
  duration: number,
  existing: Array<{ scheduledTime: string; duration: number }>
): boolean {
  const start = timeToMinutes(time)
  return existing.some((r) => timeRangesOverlap(start, duration, timeToMinutes(r.scheduledTime), r.duration))
}

/**
 * Expand a recurrence pattern into concrete local date keys (inclusive of the
 * first occurrence). Monthly recurrence clamps to month end (Jan 31 → Feb 28).
 * Hard cap of MAX_RECURRENCE_OCCURRENCES; `endDate` (inclusive) wins over count.
 */
export function generateRecurrenceDateKeys(
  firstDateKey: string,
  pattern: RecurrencePattern,
  count: number,
  endDate?: string
): string[] {
  const [y, m, d] = firstDateKey.split('-').map(Number)
  if (!y || !m || !d) throw new Error('Invalid first occurrence date')
  const first = new Date(y, m - 1, d)
  const keys: string[] = [firstDateKey]

  const stepDays = pattern === 'DAILY' ? 1 : pattern === 'WEEKLY' ? 7 : pattern === 'BIWEEKLY' ? 14 : 0
  const effectiveCount = Math.max(1, Math.min(count || 1, MAX_RECURRENCE_OCCURRENCES))

  for (let i = 1; i < effectiveCount; i++) {
    let next: Date
    if (pattern === 'MONTHLY') {
      next = new Date(first.getFullYear(), first.getMonth() + i, 1)
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(d, lastDay))
    } else {
      next = addDays(first, stepDays * i)
    }
    const key = toDateKey(next)
    if (endDate && key > endDate) break
    keys.push(key)
  }
  return keys
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface AnalyticsAppointment {
  status: string
  duration: number
  doctorId: string
  scheduledDate: string
}

export interface SchedulingAnalytics {
  total: number
  completed: number
  cancelled: number
  noShow: number
  upcoming: number
  completedRate: number
  cancellationRate: number
  noShowRate: number
  bookedMinutes: number
}

const rate = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 1000) / 10)

/** Outcome counts and rates over a set of appointments (already period-filtered). */
export function computeSchedulingAnalytics(appointments: AnalyticsAppointment[]): SchedulingAnalytics {
  const total = appointments.length
  const completed = appointments.filter((a) => a.status === 'COMPLETED').length
  const cancelled = appointments.filter((a) => a.status === 'CANCELLED').length
  const noShow = appointments.filter((a) => a.status === 'NO_SHOW').length
  const upcoming = appointments.filter((a) =>
    ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(a.status)
  ).length
  const bookedMinutes = appointments
    .filter((a) => a.status !== 'CANCELLED' && a.status !== 'NO_SHOW')
    .reduce((sum, a) => sum + a.duration, 0)

  return {
    total,
    completed,
    cancelled,
    noShow,
    upcoming,
    completedRate: rate(completed, total),
    cancellationRate: rate(cancelled, total),
    noShowRate: rate(noShow, total),
    bookedMinutes,
  }
}

/**
 * Doctor utilization: booked active minutes / available minutes in the period.
 * Available minutes derive from the doctor's weekly shift minutes × weeks in
 * the period (fall back to a standard 8h day when no shift is recorded).
 */
export function computeDoctorUtilization(
  appointments: AnalyticsAppointment[],
  weeklyAvailableMinutes: Record<string, number>,
  periodDays: number
): Array<{ doctorId: string; bookedMinutes: number; availableMinutes: number; utilization: number }> {
  const weeks = Math.max(periodDays / 7, 1 / 7)
  const byDoctor = new Map<string, number>()
  for (const a of appointments) {
    if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') continue
    byDoctor.set(a.doctorId, (byDoctor.get(a.doctorId) ?? 0) + a.duration)
  }

  return [...byDoctor.entries()].map(([doctorId, bookedMinutes]) => {
    const availableMinutes = Math.round((weeklyAvailableMinutes[doctorId] ?? 8 * 60 * 5) * weeks)
    return {
      doctorId,
      bookedMinutes,
      availableMinutes,
      utilization: availableMinutes === 0 ? 0 : Math.round((bookedMinutes / availableMinutes) * 1000) / 10,
    }
  })
}

/** Weekly available minutes per doctor from their shift rows. */
export function weeklyMinutesFromShifts(
  shifts: Array<{ staffId: string; startTime: string; endTime: string; isActive: boolean }>
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of shifts) {
    if (!s.isActive) continue
    if (!isValidTime(s.startTime) || !isValidTime(s.endTime)) continue
    const mins = Math.max(timeToMinutes(s.endTime) - timeToMinutes(s.startTime), 0)
    out[s.staffId] = (out[s.staffId] ?? 0) + mins
  }
  return out
}

/**
 * Resolve the effective working window for one date, unifying the three
 * sources of truth in this repo:
 *  1. doctor StaffShift row (wins) — no clinic lunch is layered on top;
 *  2. hospital `workingHours` JSON in the app's real shape — a per-day week
 *     schedule `{ monday: { open, close, closed }, ... }` (lowercase keys,
 *     as written by onboarding + settings/clinic);
 *  3. legacy/alt `{ startTime, endTime, lunchStart?, lunchEnd? }`, or
 *     unconfigured → DEFAULT_WORKING_HOURS (with its 13:00–14:00 lunch).
 */
export interface ResolvedDayWindow {
  /** Null when the clinic (or its schedule) marks the day closed. */
  window: WorkingWindow | null
  /** Lunch/break band — only when sourced from defaults or the alt shape. */
  lunch: { start: string; end: string } | null
  /** True when resolved from a doctor shift rather than clinic config. */
  fromShift: boolean
}

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

export function resolveDayWindow(
  dateKey: string,
  workingHoursRaw: string | null | undefined,
  shift?: { startTime: string; endTime: string } | null
): ResolvedDayWindow {
  if (shift && isValidTime(shift.startTime) && isValidTime(shift.endTime)) {
    return { window: { startTime: shift.startTime, endTime: shift.endTime }, lunch: null, fromShift: true }
  }

  let parsed: Record<string, unknown> | null = null
  if (workingHoursRaw) {
    try {
      const value = JSON.parse(workingHoursRaw)
      if (value && typeof value === 'object') parsed = value as Record<string, unknown>
    } catch {
      parsed = null
    }
  }

  if (parsed) {
    const dayName = DAY_NAMES[parseDateKey(dateKey).getDay()]
    const dayConfig = parsed[dayName] as { open?: string | null; close?: string | null; closed?: boolean } | undefined
    if (dayConfig && typeof dayConfig === 'object') {
      if (dayConfig.closed || !dayConfig.open || !dayConfig.close) {
        return { window: null, lunch: null, fromShift: false }
      }
      if (isValidTime(dayConfig.open) && isValidTime(dayConfig.close)) {
        return { window: { startTime: dayConfig.open, endTime: dayConfig.close }, lunch: null, fromShift: false }
      }
      return { window: null, lunch: null, fromShift: false }
    }
    // Alt shape: flat start/end with optional lunch.
    const startTime = (parsed as { startTime?: string }).startTime
    const endTime = (parsed as { endTime?: string }).endTime
    if (isValidTime(startTime) && isValidTime(endTime)) {
      const lunchStart = (parsed as { lunchStart?: string }).lunchStart
      const lunchEnd = (parsed as { lunchEnd?: string }).lunchEnd
      const lunch =
        lunchStart && lunchEnd && isValidTime(lunchStart) && isValidTime(lunchEnd)
          ? { start: lunchStart, end: lunchEnd }
          : null
      return { window: { startTime, endTime }, lunch, fromShift: false }
    }
  }

  return {
    window: { startTime: DEFAULT_WORKING_HOURS.startTime, endTime: DEFAULT_WORKING_HOURS.endTime },
    lunch:
      DEFAULT_WORKING_HOURS.lunchStart && DEFAULT_WORKING_HOURS.lunchEnd
        ? { start: DEFAULT_WORKING_HOURS.lunchStart, end: DEFAULT_WORKING_HOURS.lunchEnd }
        : null,
    fromShift: false,
  }
}

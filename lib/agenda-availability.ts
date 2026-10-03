/**
 * Agenda Phase-2 scheduling primitives: working hours, breaks, vacations,
 * holidays, room conflicts, recurrence expansion and analytics math.
 *
 * Pure functions only — the API routes own tenant scoping and persistence.
 * All times are `HH:MM` 24h strings; all dates are local `YYYY-MM-DD` keys
 * (see lib/agenda-utils.ts for the canonical conversion helpers).
 */
import { isValidTime, timeToMinutes, timeRangesOverlap, addDays, toDateKey, parseDateKey } from '@/lib/agenda-utils'
import { resolveDayWorkingWindow } from '@/lib/working-hours'

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
  endTime: '17:00',
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
 * Resolve one date through the same clinic-hours parser used by the booking
 * slots API, optionally narrowing it to a doctor's shift. An explicitly
 * inactive or invalid shift closes the day. A doctor shift can override an
 * unconfigured fallback, but explicit clinic hours cap its effective window.
 */
export interface ResolvedDayWindow {
  /** Null when the clinic or doctor's shift marks the day closed. */
  window: WorkingWindow | null
  lunch: { start: string; end: string } | null
  fromShift: boolean
}

export function resolveDayWindow(
  dateKey: string,
  workingHoursRaw: string | null | undefined,
  shift?: { startTime: string; endTime: string; isActive?: boolean } | null
): ResolvedDayWindow {
  const clinic = resolveDayWorkingWindow(workingHoursRaw, parseDateKey(dateKey).getDay())
  if (!shift) {
    return {
      window: clinic.closed ? null : { startTime: clinic.start, endTime: clinic.end },
      lunch:
        clinic.lunchStart && clinic.lunchEnd
          ? { start: clinic.lunchStart, end: clinic.lunchEnd }
          : null,
      fromShift: false,
    }
  }

  if (
    shift.isActive === false ||
    !isValidTime(shift.startTime) ||
    !isValidTime(shift.endTime) ||
    timeToMinutes(shift.startTime) >= timeToMinutes(shift.endTime) ||
    (clinic.closed && clinic.source !== 'default')
  ) {
    return { window: null, lunch: null, fromShift: true }
  }

  // With no clinic schedule recorded, an explicit doctor shift is itself the
  // configured window. Persisted per-day/flat clinic hours still cap it.
  if (clinic.source === 'default') {
    return {
      window: { startTime: shift.startTime, endTime: shift.endTime },
      lunch: clinic.lunchStart && clinic.lunchEnd
        ? { start: clinic.lunchStart, end: clinic.lunchEnd }
        : null,
      fromShift: true,
    }
  }

  const startTime =
    timeToMinutes(shift.startTime) > timeToMinutes(clinic.start) ? shift.startTime : clinic.start
  const endTime = timeToMinutes(shift.endTime) < timeToMinutes(clinic.end) ? shift.endTime : clinic.end
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    return { window: null, lunch: null, fromShift: true }
  }

  return {
    window: { startTime, endTime },
    lunch:
      clinic.lunchStart && clinic.lunchEnd
        ? { start: clinic.lunchStart, end: clinic.lunchEnd }
        : null,
    fromShift: true,
  }
}

export interface AvailableSlot {
  time: string
  available: boolean
}

/**
 * Generate one consistent 30-minute grid for internal, public, and patient
 * portal booking. Every returned start fits the selected duration inside the
 * effective window; break and appointment overlaps use half-open intervals.
 */
export function generateAvailableSlots(
  dateKey: string,
  window: WorkingWindow,
  lunch: { start: string; end: string } | null,
  duration: number,
  existingAppointments: Array<{ scheduledTime: string; duration: number }>,
  now = new Date()
): AvailableSlot[] {
  if (
    !Number.isInteger(duration) ||
    duration < 1 ||
    !isValidTime(window.startTime) ||
    !isValidTime(window.endTime)
  ) {
    return []
  }

  const start = timeToMinutes(window.startTime)
  const end = timeToMinutes(window.endTime)
  if (start >= end) return []

  const todayKey = toDateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const slots: AvailableSlot[] = []

  for (let slotStart = start; slotStart + duration <= end; slotStart += 30) {
    const time = `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`
    const isPast = dateKey < todayKey || (dateKey === todayKey && slotStart <= nowMinutes)
    const overlapsAppointment = existingAppointments.some((appointment) => {
      if (!isValidTime(appointment.scheduledTime) || !Number.isFinite(appointment.duration)) return false
      return timeRangesOverlap(
        slotStart,
        duration,
        timeToMinutes(appointment.scheduledTime),
        appointment.duration
      )
    })
    const overlapsLunch = lunch
      ? overlapsBreak(time, duration, { lunchStart: lunch.start, lunchEnd: lunch.end })
      : false

    slots.push({ time, available: !isPast && !overlapsAppointment && !overlapsLunch })
  }

  return slots
}

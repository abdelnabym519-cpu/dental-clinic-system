import { prisma } from '@/lib/prisma'
import { isValidTime, parseDateKey, toDateKey, timeToMinutes, timeRangesOverlap } from '@/lib/agenda-utils'
import {
  isWithinWorkingHours,
  overlapsBreak,
  isOnApprovedLeave,
  isClinicHoliday,
  roomOverlapExists,
  resolveDayWindow,
  type LeaveWindow,
  type HolidayEntry,
} from '@/lib/agenda-availability'

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] as const

export interface ConflictCheckInput {
  hospitalId: string
  doctorId: string
  scheduledDate: Date
  scheduledTime: string
  duration: number
  /** Appointment id to exclude (reschedule case). */
  excludeId?: string
  /** Room to also check for double-booking. */
  roomId?: string | null
}

export interface AvailabilityViolation {
  code:
    | 'OUTSIDE_WORKING_HOURS'
    | 'DURING_BREAK'
    | 'DOCTOR_ON_LEAVE'
    | 'DOCTOR_ON_BREAK'
    | 'CLINIC_HOLIDAY'
    | 'SLOT_BLOCKED'
    | 'ROOM_CONFLICT'
  message: string
}

/**
 * Authoritative duration-aware conflict detection for a provider.
 * Two appointments conflict when their `[start, start + duration)` ranges
 * overlap on the same calendar day for the same doctor within the same
 * hospital. Cancelled / no-show / rescheduled appointments never block.
 */
export async function findConflictingAppointment(input: ConflictCheckInput) {
  const { hospitalId, doctorId, scheduledDate, scheduledTime, duration, excludeId } = input

  if (!isValidTime(scheduledTime)) {
    throw new Error('Invalid time format')
  }
  if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
    throw new Error('Invalid duration')
  }

  const sameDay = (await prisma.appointment.findMany({
    where: {
      hospitalId,
      doctorId,
      scheduledDate,
      status: { in: [...ACTIVE_STATUSES] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, appointmentNo: true, scheduledTime: true, duration: true },
  })) ?? []

  const start = timeToMinutes(scheduledTime)
  const conflict = sameDay.find(
    (apt: { scheduledTime: string; duration: number }) =>
      timeRangesOverlap(start, duration, timeToMinutes(apt.scheduledTime), apt.duration)
  )
  return conflict ?? null
}

/**
 * Room double-booking detection (tenant + day + active statuses scoped).
 */
export async function findConflictingRoomBooking(input: ConflictCheckInput) {
  const { hospitalId, scheduledDate, scheduledTime, duration, excludeId } = input
  if (!input.roomId) return null
  if (!isValidTime(scheduledTime)) throw new Error('Invalid time format')

  const sameDay = (await prisma.appointment.findMany({
    where: {
      hospitalId,
      roomId: input.roomId,
      scheduledDate,
      status: { in: [...ACTIVE_STATUSES] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, appointmentNo: true, scheduledTime: true, duration: true },
  })) ?? []

  return roomOverlapExists(scheduledTime, duration, sameDay) ? sameDay[0] ?? null : null
}

/**
 * Availability gate: verifies the appointment lands inside the provider's
 * working hours, outside the clinic lunch break, on a working day (no approved
 * leave, no clinic holiday). Every rule is tenant-scoped; hours come from the
 * doctor's StaffShift for that weekday with the hospital's workingHours JSON
 * as fallback (same precedence the slots endpoint uses).
 */
export async function findAvailabilityViolation(
  input: ConflictCheckInput
): Promise<AvailabilityViolation | null> {
  const { hospitalId, doctorId, scheduledDate, scheduledTime, duration } = input

  if (!isValidTime(scheduledTime)) throw new Error('Invalid time format')
  const dateKey = toDateKey(scheduledDate)

  // 1. Clinic-wide holiday
  const holidays = (await prisma.holiday.findMany({ where: { hospitalId } })) ?? []
  const holidayEntries: HolidayEntry[] = holidays.map((h: { date: Date; isRecurring: boolean }) => ({
    date: toDateKey(h.date),
    isRecurring: h.isRecurring,
  }))
  if (isClinicHoliday(dateKey, holidayEntries)) {
    const hit = holidays.find(
      (h: { date: Date; isRecurring: boolean }) =>
        toDateKey(h.date) === dateKey ||
        (h.isRecurring && toDateKey(h.date).slice(5) === dateKey.slice(5))
    )
    return { code: 'CLINIC_HOLIDAY', message: `Clinic closed on this date (${hit?.name ?? 'holiday'})` }
  }

  // 2. Approved doctor leave (vacation / blocked period)
  const leaves = (await prisma.leave.findMany({
    where: { hospitalId, staffId: doctorId, status: 'APPROVED' },
    select: { startDate: true, endDate: true, leaveType: true, status: true },
  })) ?? []
  const leaveWindows: LeaveWindow[] = leaves.map((l: { startDate: Date; endDate: Date; leaveType: string; status: string }) => ({
    startDate: toDateKey(l.startDate),
    endDate: toDateKey(l.endDate),
    leaveType: l.leaveType,
    status: l.status,
  }))
  if (isOnApprovedLeave(dateKey, leaveWindows)) {
    return { code: 'DOCTOR_ON_LEAVE', message: 'Doctor is unavailable on this date (approved leave)' }
  }

  // 2b. Recurring per-doctor break (Agenda Phase 2b) — same overlap math.
  const dayOfWeek0 = parseDateKey(dateKey).getDay()
  const breaks = (await prisma.doctorBreak.findMany({
    where: { hospitalId, staffId: doctorId, dayOfWeek: dayOfWeek0, isActive: true },
    select: { startTime: true, endTime: true, label: true },
  })) ?? []
  const startMin0 = timeToMinutes(scheduledTime)
  const hittingBreak = breaks.find(
    (b: { startTime: string; endTime: string }) =>
      isValidTime(b.startTime) &&
      isValidTime(b.endTime) &&
      timeRangesOverlap(startMin0, duration, timeToMinutes(b.startTime), Math.max(timeToMinutes(b.endTime) - timeToMinutes(b.startTime), 0))
  )
  if (hittingBreak) {
    return {
      code: 'DOCTOR_ON_BREAK',
      message: `Overlaps the doctor's break${hittingBreak.label ? ` (${hittingBreak.label})` : ''} (${hittingBreak.startTime}–${hittingBreak.endTime})`,
    }
  }

  // 2d. Arbitrary blocked slots (meetings/maintenance) — clinic-wide or for
  // this doctor, overlapping the requested [start, start+duration) window.
  const [hours, minutes] = scheduledTime.split(':').map(Number)
  const slotStart = new Date(scheduledDate)
  slotStart.setHours(hours || 0, minutes || 0, 0, 0)
  const slotEnd = new Date(slotStart.getTime() + duration * 60000)
  const blocked = (await prisma.blockedSlot.findMany({
    where: {
      hospitalId,
      isActive: true,
      OR: [{ staffId: doctorId }, { staffId: null }],
      startAt: { lt: slotEnd },
      endAt: { gt: slotStart },
    },
    select: { id: true, reason: true },
  })) ?? []
  if (blocked.length > 0) {
    const reason = blocked[0]?.reason ? ` (${blocked[0].reason})` : ''
    return { code: 'SLOT_BLOCKED', message: `The requested time is blocked${reason}` }
  }

  // 3. Working window: doctor shift → hospital week schedule / flat config →
  //    built-in defaults. resolveDayWindow unifies the app's real per-day
  //    `workingHours` JSON with the legacy flat shape.
  const dayOfWeek = parseDateKey(dateKey).getDay()
  const [hospital, shift] = await Promise.all([
    prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { workingHours: true },
    }),
    prisma.staffShift.findUnique({
      where: { staffId_dayOfWeek: { staffId: doctorId, dayOfWeek } },
    }),
  ])

  const resolved = resolveDayWindow(
    dateKey,
    hospital?.workingHours ?? null,
    shift?.isActive && shift.startTime && shift.endTime
      ? { startTime: shift.startTime, endTime: shift.endTime }
      : null
  )

  if (!resolved.window) {
    return {
      code: 'OUTSIDE_WORKING_HOURS',
      message: 'The clinic is closed on this day',
    }
  }

  if (!isWithinWorkingHours(scheduledTime, duration, resolved.window)) {
    return {
      code: 'OUTSIDE_WORKING_HOURS',
      message: `Outside working hours (${resolved.window.startTime}–${resolved.window.endTime})`,
    }
  }

  // 4. Lunch break (clinic-level, when the resolved config defines one)
  if (
    resolved.lunch &&
    overlapsBreak(scheduledTime, duration, {
      lunchStart: resolved.lunch.start,
      lunchEnd: resolved.lunch.end,
    })
  ) {
    return {
      code: 'DURING_BREAK',
      message: `Overlaps the clinic break (${resolved.lunch.start}–${resolved.lunch.end})`,
    }
  }

  return null
}

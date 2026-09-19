import { prisma } from '@/lib/prisma'
import { isValidTime, timeRangesOverlap, timeToMinutes } from '@/lib/agenda-utils'

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] as const

export interface ConflictCheckInput {
  hospitalId: string
  doctorId: string
  scheduledDate: Date
  scheduledTime: string
  duration: number
  /** Appointment id to exclude (reschedule case). */
  excludeId?: string
}

/**
 * Authoritative duration-aware conflict detection for a provider.
 *
 * Two appointments conflict when their `[start, start + duration)` ranges
 * overlap on the same calendar day for the same doctor within the same
 * hospital. Cancelled / no-show / rescheduled appointments never block.
 *
 * The lookup is tenant-scoped by `hospitalId`; the overlap math runs on the
 * fetched same-day rows so it cannot be bypassed by client-side checks.
 */
export async function findConflictingAppointment(input: ConflictCheckInput) {
  const { hospitalId, doctorId, scheduledDate, scheduledTime, duration, excludeId } = input

  if (!isValidTime(scheduledTime)) {
    throw new Error('Invalid time format')
  }
  if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
    throw new Error('Invalid duration')
  }

  // Same-day active appointments for this provider (day is scoped by the
  // caller's already-validated `scheduledDate` at midnight granularity).
  const sameDay = await prisma.appointment.findMany({
    where: {
      hospitalId,
      doctorId,
      scheduledDate,
      status: { in: [...ACTIVE_STATUSES] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, appointmentNo: true, scheduledTime: true, duration: true },
  })

  const start = timeToMinutes(scheduledTime)
  const conflict = sameDay.find(
    (apt: { scheduledTime: string; duration: number }) =>
      timeRangesOverlap(start, duration, timeToMinutes(apt.scheduledTime), apt.duration)
  )
  return conflict ?? null
}

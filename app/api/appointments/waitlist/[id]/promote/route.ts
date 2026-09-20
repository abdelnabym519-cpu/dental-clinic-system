import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { generateAppointmentNo } from '@/lib/appointment-number'
import {
  isClinicHoliday,
  isOnApprovedLeave,
  isWithinWorkingHours,
  overlapsBreak,
  resolveDayWindow,
} from '@/lib/agenda-availability'
import { toDateKey, parseDateKey, timeToMinutes } from '@/lib/agenda-utils'
import { findConflictingAppointment } from '@/lib/services/appointment-conflict.service'

const SLOT_STEP_MINUTES = 30
const SEARCH_HORIZON_DAYS = 30
const LEAD_TIME_MINUTES = 60 // earliest bookable start: now + 1h

/**
 * POST /api/waitlist/[id]/promote — book a waitlist entry into the next
 * genuinely available slot (RECEPTIONIST / ADMIN, tenant-scoped).
 *
 * Server-side availability search mirrors the booking gate: working window
 * (doctor shift → hospital hours → default), lunch break, approved leave,
 * clinic holidays, and per-doctor overlap rejection. The chosen slot is
 * booked with the standard booking pipeline and the entry becomes BOOKED.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'RECEPTIONIST'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const duration =
      typeof body.duration === 'number' && body.duration >= 15 && body.duration <= 240
        ? body.duration
        : 30

    const entry = await prisma.waitlist.findFirst({
      where: { id, hospitalId },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }
    if (entry.status === 'BOOKED') {
      return NextResponse.json({ error: 'This waitlist entry is already booked' }, { status: 400 })
    }
    if (entry.status === 'CANCELLED' || entry.status === 'EXPIRED') {
      return NextResponse.json({ error: `Cannot book a ${entry.status.toLowerCase()} entry` }, { status: 400 })
    }

    // Patient must still exist in this hospital.
    const patient = await prisma.patient.findFirst({
      where: { id: entry.patientId, hospitalId },
      select: { id: true },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient no longer exists' }, { status: 400 })
    }

    // Candidate doctors: preferred doctor first, then every active doctor.
    const doctors = await prisma.staff.findMany({
      where: { hospitalId, isActive: true, user: { role: 'DOCTOR', isActive: true } },
      select: { id: true },
    })
    if (doctors.length === 0) {
      return NextResponse.json({ error: 'No active doctors available' }, { status: 400 })
    }
    const candidates: Array<{ id: string }> = entry.doctorId
      ? [
          ...doctors.filter((d: { id: string }) => d.id === entry.doctorId),
          ...doctors.filter((d: { id: string }) => d.id !== entry.doctorId),
        ]
      : doctors

    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { workingHours: true },
    })

    const earliestStart = new Date(Date.now() + LEAD_TIME_MINUTES * 60000)
    const horizonEnd = new Date()
    horizonEnd.setDate(horizonEnd.getDate() + SEARCH_HORIZON_DAYS)

    const [shifts, leaves, holidays] = await Promise.all([
      prisma.staffShift.findMany({ where: { hospitalId } }),
      prisma.leave.findMany({
        where: {
          hospitalId,
          status: 'APPROVED',
          startDate: { lte: horizonEnd },
        },
        select: { staffId: true, startDate: true, endDate: true },
      }),
      prisma.holiday.findMany({ where: { hospitalId } }),
    ])

    const holidayEntries = (holidays as Array<{ date: Date; isRecurring: boolean }>).map((h) => ({
      date: toDateKey(h.date),
      isRecurring: h.isRecurring,
    }))

    const dayStartCursor = new Date(earliestStart)
    dayStartCursor.setHours(0, 0, 0, 0)

    for (let dayOffset = 0; dayOffset < SEARCH_HORIZON_DAYS; dayOffset++) {
      const day = new Date(dayStartCursor)
      day.setDate(day.getDate() + dayOffset)
      const dateKey = toDateKey(day)
      const weekday = day.getDay()

      if (isClinicHoliday(dateKey, holidayEntries)) continue

      for (const doctor of candidates) {
        const doctorLeaves = (leaves as Array<{ staffId: string; startDate: Date; endDate: Date }>)
          .filter((l) => l.staffId === doctor.id)
          .map((l) => ({ startDate: toDateKey(l.startDate), endDate: toDateKey(l.endDate), status: 'APPROVED' }))
        if (isOnApprovedLeave(dateKey, doctorLeaves)) continue

        // Working window for this doctor/weekday: shift → clinic schedule →
        // defaults (resolveDayWindow understands the app's week-schedule JSON).
        const shift = (shifts as Array<{ staffId: string; dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }>).find(
          (sh) => sh.staffId === doctor.id && sh.dayOfWeek === weekday && sh.isActive
        )
        const resolved = resolveDayWindow(dateKey, hospital?.workingHours ?? null, shift ?? null)
        const window = resolved.window
        if (!window) continue // clinic closed / doctor not working this day

        const windowStartMin = timeToMinutes(window.startTime)
        const windowEndMin = timeToMinutes(window.endTime)
        const earliestSlotMin = Math.max(
          windowStartMin,
          toDateKey(day) === toDateKey(earliestStart)
            ? earliestStart.getHours() * 60 + earliestStart.getMinutes()
            : 0
        )

        for (
          let slotMin = Math.ceil(earliestSlotMin / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
          slotMin + duration <= windowEndMin;
          slotMin += SLOT_STEP_MINUTES
        ) {
          const startTime = `${String(Math.floor(slotMin / 60)).padStart(2, '0')}:${String(slotMin % 60).padStart(2, '0')}`
          if (!isWithinWorkingHours(startTime, duration, window)) continue
          if (
            resolved.lunch &&
            overlapsBreak(startTime, duration, {
              lunchStart: resolved.lunch.start,
              lunchEnd: resolved.lunch.end,
            })
          )
            continue

          const scheduledDate = parseDateKey(dateKey)
          scheduledDate.setHours(0, 0, 0, 0)
          const conflict = await findConflictingAppointment({
            hospitalId,
            doctorId: doctor.id,
            scheduledDate,
            scheduledTime: startTime,
            duration,
          })
          if (conflict) continue

          // Free slot found — book through the standard pipeline.
          const appointmentNo = await generateAppointmentNo(hospitalId)
          const appointment = await prisma.appointment.create({
            data: {
              hospitalId,
              appointmentNo,
              patientId: entry.patientId,
              doctorId: doctor.id,
              scheduledDate,
              scheduledTime: startTime,
              duration,
              appointmentType: 'CONSULTATION',
              priority: 'NORMAL',
              status: 'SCHEDULED',
              notes: entry.notes ?? undefined,
            },
          })
          await prisma.waitlist.update({
            where: { id: entry.id },
            data: { status: 'BOOKED', bookedAt: new Date() },
          })

          return NextResponse.json(
            { appointment, waitlistEntryId: entry.id, status: 'BOOKED' },
            { status: 201 }
          )
        }
      }
    }

    return NextResponse.json(
      {
        error: `No free slot found within ${SEARCH_HORIZON_DAYS} days for this waiting-list entry`,
      },
      { status: 409 }
    )
  } catch (err) {
    console.error('Error promoting waitlist entry:', err)
    return NextResponse.json({ error: 'Failed to book the waitlist entry' }, { status: 500 })
  }
}

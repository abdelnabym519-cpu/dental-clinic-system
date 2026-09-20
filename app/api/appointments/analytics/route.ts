import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import {
  computeSchedulingAnalytics,
  computeDoctorUtilization,
  weeklyMinutesFromShifts,
  type AnalyticsAppointment,
} from '@/lib/agenda-availability'
import { toDateKey, parseDateKey, addDays, timeToMinutes } from '@/lib/agenda-utils'
import { resolveDayWindow } from '@/lib/agenda-availability'

// GET - Scheduling analytics for a period (tenant-scoped, real records only).
// Query: from=YYYY-MM-DD&to=YYYY-MM-DD (defaults: current month).
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)

    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    const fromDate = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? new Date(fromParam + 'T00:00:00') : defaultFrom
    const toDate = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? new Date(toParam + 'T23:59:59') : new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59)

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }
    const periodDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000))

    const [appointments, shifts] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          hospitalId,
          scheduledDate: { gte: fromDate, lte: toDate },
        },
        select: {
          status: true,
          duration: true,
          doctorId: true,
          scheduledDate: true,
        },
      }),
      prisma.staffShift.findMany({
        where: { hospitalId },
        select: { staffId: true, startTime: true, endTime: true, isActive: true },
      }),
    ])

    const analytics = computeSchedulingAnalytics(
      appointments.map((a: { status: string; duration: number; doctorId: string; scheduledDate: Date }) => ({
        status: a.status,
        duration: a.duration,
        doctorId: a.doctorId,
        scheduledDate: toDateKey(a.scheduledDate),
      })) as AnalyticsAppointment[]
    )

    const weeklyAvailable = weeklyMinutesFromShifts(
      shifts as Array<{ staffId: string; startTime: string; endTime: string; isActive: boolean }>
    )
    const doctorUtilization = computeDoctorUtilization(
      appointments.map((a: { status: string; duration: number; doctorId: string; scheduledDate: Date }) => ({
        status: a.status,
        duration: a.duration,
        doctorId: a.doctorId,
        scheduledDate: toDateKey(a.scheduledDate),
      })),
      weeklyAvailable,
      periodDays
    )

    // Clinic occupancy: booked active minutes / real scheduled capacity.
    // Capacity = Σ per-day window minutes (closed days contribute 0), from
    // the same week-schedule JSON the booking gate enforces.
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { workingHours: true },
    })
    let capacityMinutes = 0
    const from = parseDateKey(toDateKey(fromDate))
    for (let d = 0; d < Math.min(periodDays, 366); d++) {
      const day = addDays(from, d)
      const resolved = resolveDayWindow(toDateKey(day), hospital?.workingHours ?? null, null)
      if (resolved.window) {
        capacityMinutes += Math.max(
          timeToMinutes(resolved.window.endTime) - timeToMinutes(resolved.window.startTime),
          0
        )
      }
    }

    const activeBookedMinutes = analytics.bookedMinutes
    const occupancy = capacityMinutes === 0 ? 0 : Math.round((activeBookedMinutes / capacityMinutes) * 1000) / 10

    return NextResponse.json({
      period: { from: toDateKey(fromDate), to: toDateKey(toDate), days: periodDays },
      ...analytics,
      clinic: {
        capacityMinutes,
        bookedMinutes: activeBookedMinutes,
        occupancyPercent: occupancy,
        availablePercent: Math.max(0, Math.round((100 - occupancy) * 10) / 10),
      },
      doctorUtilization,
    })
  } catch (err) {
    console.error('Error computing scheduling analytics:', err)
    return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { resolveDayWorkingWindow } from '@/lib/working-hours'

// GET - Get available time slots for a doctor on a specific date
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const doctorId = searchParams.get('doctorId')
    const date = searchParams.get('date')
    const duration = parseInt(searchParams.get('duration') || '30')

    if (!doctorId || !date) {
      return NextResponse.json({ error: 'Doctor ID and date are required' }, { status: 400 })
    }

    const dateObj = new Date(date)

    // Get hospital working hours — canonicalized through lib/working-hours
    // (accepts BOTH stored shapes: flat {start,end,lunch…} and the onboarding
    // per-day {monday:{open,close,closed}, …}). The old code read `.start`
    // directly and 500-ed on the per-day shape — the live "no available
    // appointments for any date" defect.
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { workingHours: true },
    })

    const hospitalWindow = resolveDayWorkingWindow(hospital?.workingHours ?? null, dateObj.getDay())

    if (hospitalWindow.closed) {
      return NextResponse.json({
        available: false,
        reason: 'العيادة مقفولة في هذا اليوم حسب ساعات العمل المسجلة',
        slots: [],
      })
    }

    const workingHours = {
      start: hospitalWindow.start,
      end: hospitalWindow.end,
      // Lunch break only exists in the canonical shape; per-day data has none.
      lunchStart: hospitalWindow.lunchStart ?? '13:00',
      lunchEnd: hospitalWindow.lunchEnd ?? '13:00',
    }
    // When there is no lunch window, keep the loop simple: an empty lunch.
    const hasLunch = hospitalWindow.lunchStart != null && hospitalWindow.lunchEnd != null

    // Check if it's a holiday for this hospital
    const holiday = await prisma.holiday.findFirst({
      where: {
        hospitalId,
        date: dateObj,
      },
    })

    if (holiday) {
      return NextResponse.json({
        available: false,
        reason: `Holiday: ${holiday.name}`,
        slots: [],
      })
    }

    // Verify doctor belongs to this hospital
    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId },
    })

    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // Get doctor's shift for the day of week. An INACTIVE shift means the
    // doctor is intentionally off this day (/settings/working-hours) — the
    // hospital-level fallback must NOT resurrect availability.
    const dayOfWeek = dateObj.getDay()
    const doctorShift = await prisma.staffShift.findUnique({
      where: {
        staffId_dayOfWeek: {
          staffId: doctorId,
          dayOfWeek,
        },
      },
    })

    if (doctorShift && !doctorShift.isActive) {
      return NextResponse.json({
        available: false,
        reason: 'الطبيب مش متاح في هذا اليوم حسب ساعات العمل المسجلة',
        slots: [],
      })
    }

    // Get existing appointments for the doctor on this date
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
        doctorId,
        scheduledDate: dateObj,
        status: {
          notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
        },
      },
      select: {
        scheduledTime: true,
        duration: true,
      },
    })

    // Generate all possible slots
    const slots: { time: string; available: boolean }[] = []

    const startHour = parseInt(
      doctorShift?.startTime?.split(':')[0] || workingHours.start.split(':')[0]
    )
    const startMin = parseInt(
      doctorShift?.startTime?.split(':')[1] || workingHours.start.split(':')[1]
    )
    const endHour = parseInt(doctorShift?.endTime?.split(':')[0] || workingHours.end.split(':')[0])
    const endMin = parseInt(doctorShift?.endTime?.split(':')[1] || workingHours.end.split(':')[1])

    const lunchStartHour = parseInt(workingHours.lunchStart.split(':')[0])
    const lunchStartMin = parseInt(workingHours.lunchStart.split(':')[1])
    const lunchEndHour = parseInt(workingHours.lunchEnd.split(':')[0])
    const lunchEndMin = parseInt(workingHours.lunchEnd.split(':')[1])

    // Generate slots in 30-minute intervals
    let currentHour = startHour
    let currentMin = startMin

    while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
      const timeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`

      // Check if slot is during lunch break (canonical shape only — the
      // per-day onboarding shape carries no lunch window).
      const isLunchTime = hasLunch &&
        (currentHour > lunchStartHour ||
          (currentHour === lunchStartHour && currentMin >= lunchStartMin)) &&
        (currentHour < lunchEndHour || (currentHour === lunchEndHour && currentMin < lunchEndMin))

      // Check if slot overlaps with existing appointments
      const isBooked = existingAppointments.some((apt) => {
        const aptStartParts = apt.scheduledTime.split(':').map(Number)
        const aptStartMins = aptStartParts[0] * 60 + aptStartParts[1]
        const aptEndMins = aptStartMins + apt.duration

        const slotStartMins = currentHour * 60 + currentMin
        const slotEndMins = slotStartMins + duration

        // Check for overlap
        return slotStartMins < aptEndMins && slotEndMins > aptStartMins
      })

      // Check if slot is in the past (for today)
      const now = new Date()
      const isToday = dateObj.toDateString() === now.toDateString()
      const isPast =
        isToday &&
        (currentHour < now.getHours() ||
          (currentHour === now.getHours() && currentMin <= now.getMinutes()))

      slots.push({
        time: timeStr,
        available: !isLunchTime && !isBooked && !isPast,
      })

      // Increment by 30 minutes
      currentMin += 30
      if (currentMin >= 60) {
        currentHour += 1
        currentMin = 0
      }
    }

    return NextResponse.json({
      available: true,
      date,
      doctorId,
      slots,
      workingHours: doctorShift
        ? {
            start: doctorShift.startTime,
            end: doctorShift.endTime,
          }
        : workingHours,
    })
  } catch (error) {
    console.error('Error fetching time slots:', error)
    return NextResponse.json({ error: 'Failed to fetch time slots' }, { status: 500 })
  }
}

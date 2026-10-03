import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { parseDateKey, toDateKey } from '@/lib/agenda-utils'
import { generateAvailableSlots, isClinicHoliday, resolveDayWindow } from '@/lib/agenda-availability'

// GET - Get available time slots for a doctor on a specific clinic-local date
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const doctorId = searchParams.get('doctorId')
    const dateKey = searchParams.get('date')
    const duration = Number(searchParams.get('duration') || '30')

    if (!doctorId || !dateKey) {
      return NextResponse.json({ error: 'Doctor ID and date are required' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(duration) || duration < 5 || duration > 480) {
      return NextResponse.json({ error: 'Invalid date or appointment duration' }, { status: 400 })
    }

    const dateObj = parseDateKey(dateKey)
    if (toDateKey(dateObj) !== dateKey) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const [hospital, doctor] = await Promise.all([
      prisma.hospital.findUnique({ where: { id: hospitalId }, select: { workingHours: true } }),
      prisma.staff.findFirst({ where: { id: doctorId, hospitalId } }),
    ])
    if (!doctor) return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })

    const dayOfWeek = dateObj.getDay()
    const doctorShift = await prisma.staffShift.findFirst({
      where: { hospitalId, staffId: doctorId, dayOfWeek },
    })
    const resolved = resolveDayWindow(dateKey, hospital?.workingHours ?? null, doctorShift ?? null)

    if (!resolved.window) {
      const reason = doctorShift?.isActive === false
        ? 'الطبيب غير متاح في هذا اليوم حسب ساعات العمل المسجلة'
        : 'العيادة مغلقة في هذا اليوم حسب ساعات العمل المسجلة'
      return NextResponse.json({ available: false, reason, slots: [] })
    }

    const holidays = await prisma.holiday.findMany({
      where: { hospitalId, OR: [{ date: dateObj }, { isRecurring: true }] },
      select: { date: true, name: true, isRecurring: true },
    })
    const holiday = holidays.find((entry: { date: Date; isRecurring: boolean }) =>
      isClinicHoliday(dateKey, [{ date: toDateKey(entry.date), isRecurring: entry.isRecurring }])
    )
    if (holiday) {
      return NextResponse.json({
        available: false,
        reason: `العيادة مغلقة في عطلة ${holiday.name}`,
        slots: [],
      })
    }

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
        doctorId,
        scheduledDate: dateObj,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
      },
      select: { scheduledTime: true, duration: true },
    })

    const slots = generateAvailableSlots(
      dateKey,
      resolved.window,
      resolved.lunch,
      duration,
      existingAppointments
    )

    return NextResponse.json({
      available: true,
      date: dateKey,
      doctorId,
      slots,
      workingHours: {
        start: resolved.window.startTime,
        end: resolved.window.endTime,
        lunchStart: resolved.lunch?.start ?? null,
        lunchEnd: resolved.lunch?.end ?? null,
      },
    })
  } catch (error) {
    console.error('Error fetching time slots:', error)
    return NextResponse.json({ error: 'Failed to fetch time slots' }, { status: 500 })
  }
}

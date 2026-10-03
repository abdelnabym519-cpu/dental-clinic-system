import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseDateKey, toDateKey } from '@/lib/agenda-utils'
import { generateAvailableSlots, isClinicHoliday, resolveDayWindow } from '@/lib/agenda-availability'

/** GET: Public slot availability by hospital slug. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(req.url)
    const doctorId = searchParams.get('doctorId')
    const dateKey = searchParams.get('date')
    const duration = Number(searchParams.get('duration') || '30')

    if (!doctorId || !dateKey) {
      return NextResponse.json({ error: 'doctorId and date are required' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(duration) || duration < 5 || duration > 480) {
      return NextResponse.json({ error: 'Invalid date or appointment duration' }, { status: 400 })
    }

    const dateObj = parseDateKey(dateKey)
    if (toDateKey(dateObj) !== dateKey) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const hospital = await prisma.hospital.findUnique({
      where: { slug },
      select: { id: true, workingHours: true, patientPortalEnabled: true },
    })
    if (!hospital) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    if (!hospital.patientPortalEnabled) {
      return NextResponse.json({ error: 'Online booking is not enabled' }, { status: 403 })
    }

    const hospitalId = hospital.id
    const doctor = await prisma.staff.findFirst({ where: { id: doctorId, hospitalId } })
    if (!doctor) return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })

    const doctorShift = await prisma.staffShift.findFirst({
      where: { hospitalId, staffId: doctorId, dayOfWeek: dateObj.getDay() },
    })
    const resolved = resolveDayWindow(dateKey, hospital.workingHours, doctorShift ?? null)
    if (!resolved.window) {
      return NextResponse.json({
        available: false,
        reason: doctorShift?.isActive === false
          ? 'الطبيب غير متاح في هذا اليوم حسب ساعات العمل المسجلة'
          : 'العيادة مغلقة في هذا اليوم حسب ساعات العمل المسجلة',
        slots: [],
      })
    }

    const holidays = await prisma.holiday.findMany({
      where: { hospitalId, OR: [{ date: dateObj }, { isRecurring: true }] },
      select: { date: true, name: true, isRecurring: true },
    })
    const holiday = holidays.find((entry: { date: Date; isRecurring: boolean }) =>
      isClinicHoliday(dateKey, [{ date: toDateKey(entry.date), isRecurring: entry.isRecurring }])
    )
    if (holiday) {
      return NextResponse.json({ available: false, reason: `العيادة مغلقة في عطلة ${holiday.name}`, slots: [] })
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
    const slots = generateAvailableSlots(dateKey, resolved.window, resolved.lunch, duration, existingAppointments)

    return NextResponse.json({ available: true, date: dateKey, doctorId, slots })
  } catch (err: unknown) {
    console.error('Public slots error:', err)
    return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 })
  }
}

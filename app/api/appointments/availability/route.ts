import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { toDateKey, parseDateKey } from '@/lib/agenda-utils'
import { resolveDayWindow } from '@/lib/agenda-availability'

// GET - Availability context for the Agenda calendar overlay.
// Query: doctorId=<staffId>&date=YYYY-MM-DD (single day)
// Returns the doctor's working window for that weekday, the clinic break,
// approved leaves covering the week, and clinic holidays in the week —
// the UI shades unavailable time and the server enforces the same rules.
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const doctorId = searchParams.get('doctorId')
    const dateParam = searchParams.get('date')
    if (!doctorId) {
      return NextResponse.json({ error: 'doctorId is required' }, { status: 400 })
    }
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? parseDateKey(dateParam) : new Date()
    date.setHours(0, 0, 0, 0)
    const weekStart = new Date(date)
    weekStart.setDate(weekStart.getDate() - date.getDay())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)

    const doctor = await prisma.staff.findFirst({ where: { id: doctorId, hospitalId } })
    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { workingHours: true },
    })

    const [shifts, doctorBreaks, blockedSlots, leaves, holidays] = (
      await Promise.all([
        prisma.staffShift.findMany({
          where: { hospitalId, staffId: doctorId },
        }),
        prisma.doctorBreak
          .findMany({
            where: { hospitalId, staffId: doctorId, isActive: true },
            select: { dayOfWeek: true, startTime: true, endTime: true, label: true },
          })
          .catch(() => []),
        prisma.blockedSlot
          .findMany({
            where: {
              hospitalId,
              isActive: true,
              OR: [{ staffId: doctorId }, { staffId: null }],
              startAt: { lte: weekEnd },
              endAt: { gte: weekStart },
            },
            select: { startAt: true, endAt: true, reason: true, staffId: true },
          })
          .catch(() => []),
        prisma.leave.findMany({
          where: {
            hospitalId,
            staffId: doctorId,
            status: 'APPROVED',
            startDate: { lte: weekEnd },
            endDate: { gte: weekStart },
          },
          select: { startDate: true, endDate: true, leaveType: true, status: true },
        }),
        prisma.holiday.findMany({ where: { hospitalId } }),
      ])
    ).map((v) => v ?? [])

    // Per-day effective windows: doctor shift → clinic week schedule →
    // built-in defaults. The UI shades exactly what the booking gate enforces.
    const windowsByDay: Record<
      number,
      { startTime: string; endTime: string; lunchStart?: string; lunchEnd?: string } | null
    > = {}
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(weekStart)
      dayDate.setDate(weekStart.getDate() + d)
      const dayKey = toDateKey(dayDate)
      const shift = (shifts as Array<{ dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }>).find(
        (sh) => sh.dayOfWeek === d && sh.isActive
      )
      const resolved = resolveDayWindow(
        dayKey,
        hospital?.workingHours ?? null,
        shift ? { startTime: shift.startTime, endTime: shift.endTime } : null
      )
      windowsByDay[d] = resolved.window
        ? {
            startTime: resolved.window.startTime,
            endTime: resolved.window.endTime,
            ...(resolved.lunch
              ? { lunchStart: resolved.lunch.start, lunchEnd: resolved.lunch.end }
              : {}),
          }
        : null
    }

    return NextResponse.json({
      doctorId,
      date: toDateKey(date),
      windowsByDay,
      leaves: leaves.map((l: { startDate: Date; endDate: Date; leaveType: string; status: string }) => ({
        startDate: toDateKey(l.startDate),
        endDate: toDateKey(l.endDate),
        leaveType: l.leaveType,
        status: l.status,
      })),
      holidays: holidays.map((h: { date: Date; name: string; isRecurring: boolean }) => ({
        date: toDateKey(h.date),
        name: h.name,
        isRecurring: h.isRecurring,
      })),
      breaks: doctorBreaks as Array<{ dayOfWeek: number; startTime: string; endTime: string; label?: string | null }>,
      blockedSlots: (blockedSlots as Array<{ startAt: Date; endAt: Date; reason?: string | null }>).map(
        (b) => ({ startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), reason: b.reason ?? null })
      ),
    })
  } catch (err) {
    console.error('Error loading availability:', err)
    return NextResponse.json({ error: 'Failed to load availability' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { resolveDayWorkingWindow } from '@/lib/working-hours'

// Issue 2 — doctor working-hours management (Egyptian work week).
// GET  ?doctorId=… → that doctor's 7-day shift rows
// PUT  (ADMIN only) → upsert/deactivate per-day shifts. An INACTIVE day is
// stored (isActive:false) rather than deleted so the slots API treats the
// day as intentionally closed instead of falling back to hospital hours.

const DAYS = [0, 1, 2, 3, 4, 5, 6]

export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const doctorId = searchParams.get('doctorId')
    if (!doctorId) {
      return NextResponse.json({ error: 'بيانات ناقصة: يجب تحديد الطبيب' }, { status: 400 })
    }

    const doctor = await prisma.staff.findFirst({ where: { id: doctorId, hospitalId }, select: { id: true } })
    if (!doctor) {
      return NextResponse.json({ error: 'الطبيب غير موجود' }, { status: 404 })
    }

    const [shifts, hospital] = await Promise.all([
      prisma.staffShift.findMany({
        where: { hospitalId, staffId: doctorId },
        orderBy: { dayOfWeek: 'asc' },
      }),
      prisma.hospital.findUnique({ where: { id: hospitalId }, select: { workingHours: true } }),
    ])

    return NextResponse.json({
      days: DAYS.map((dayOfWeek) => {
        const shift = shifts.find((s: { dayOfWeek: number }) => s.dayOfWeek === dayOfWeek)
        const clinicDay = resolveDayWorkingWindow(hospital?.workingHours ?? null, dayOfWeek)
        return {
          dayOfWeek,
          startTime: shift?.startTime ?? clinicDay.start,
          endTime: shift?.endTime ?? clinicDay.end,
          isActive: shift ? shift.isActive : !clinicDay.closed,
          configured: !!shift,
        }
      }),
    })
  } catch (err) {
    console.error('Error fetching working hours:', err)
    return NextResponse.json({ error: 'تعذر تحميل ساعات العمل' }, { status: 500 })
  }
}

function validTime(t: unknown): t is string {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
}

export async function PUT(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const doctorId = body?.doctorId
    const days = Array.isArray(body?.days) ? body.days : null
    if (!doctorId || !days) {
      return NextResponse.json({ error: 'بيانات ناقصة: يجب تحديد الطبيب والأيام' }, { status: 400 })
    }

    const doctor = await prisma.staff.findFirst({ where: { id: doctorId, hospitalId }, select: { id: true } })
    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // Validate everything BEFORE writing anything (no partial saves).
    const seen = new Set<number>()
    for (const d of days) {
      const dayOfWeek = Number(d?.dayOfWeek)
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || seen.has(dayOfWeek)) {
        return NextResponse.json({ error: 'يوم غير صحيح في البيانات المرسلة' }, { status: 400 })
      }
      seen.add(dayOfWeek)
      if (d?.isActive) {
        if (!validTime(d?.startTime) || !validTime(d?.endTime)) {
          return NextResponse.json({ error: 'من فضلك أدخل وقت بداية ونهاية صحيحًا (24 ساعة)' }, { status: 400 })
        }
        if (d.startTime >= d.endTime) {
          return NextResponse.json({ error: 'وقت النهاية يجب أن يكون بعد وقت البداية' }, { status: 400 })
        }
      }
    }

    for (const d of days) {
      const dayOfWeek = Number(d.dayOfWeek)
      if (d.isActive) {
        await prisma.staffShift.upsert({
          where: { staffId_dayOfWeek: { staffId: doctorId, dayOfWeek } },
          update: { startTime: d.startTime, endTime: d.endTime, isActive: true },
          create: { hospitalId, staffId: doctorId, dayOfWeek, startTime: d.startTime, endTime: d.endTime, isActive: true },
        })
      } else if (seen.has(dayOfWeek)) {
        // Keep the row, marked inactive — "closed" must win over the
        // hospital-level fallback in the slot generator.
        await prisma.staffShift.upsert({
          where: { staffId_dayOfWeek: { staffId: doctorId, dayOfWeek } },
          update: { isActive: false },
          create: { hospitalId, staffId: doctorId, dayOfWeek, startTime: '09:00', endTime: '17:00', isActive: false },
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Error saving working hours:', err)
    return NextResponse.json({ error: 'تعذر حفظ ساعات العمل' }, { status: 500 })
  }
}

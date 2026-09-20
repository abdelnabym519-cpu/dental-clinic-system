import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { isValidTime } from '@/lib/agenda-utils'

/**
 * DoctorBreak management (Agenda Phase 2B — recurring per-doctor breaks,
 * e.g. lunch). RBAC: ADMIN (any doctor) and DOCTOR (own breaks only).
 * Enforcement lives in the booking gate (DOCTOR_ON_BREAK) and the calendar
 * overlay; these endpoints manage the rows.
 */

const VALID_DAYS = [0, 1, 2, 3, 4, 5, 6]

export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const staffId = searchParams.get('staffId')
    const breaks = await prisma.doctorBreak.findMany({
      where: {
        hospitalId,
        isActive: true,
        ...(staffId ? { staffId } : {}),
      },
      orderBy: [{ staffId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: { staff: { select: { id: true, firstName: true, lastName: true } } },
    })
    return NextResponse.json({ breaks })
  } catch (err) {
    console.error('Error listing doctor breaks:', err)
    return NextResponse.json({ error: 'Failed to list breaks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { staffId, dayOfWeek, startTime, endTime, label } = body
    if (!staffId || !VALID_DAYS.includes(dayOfWeek) || !isValidTime(startTime) || !isValidTime(endTime)) {
      return NextResponse.json(
        { error: 'staffId, dayOfWeek (0–6) and HH:MM startTime/endTime are required' },
        { status: 400 }
      )
    }
    if (endTime <= startTime) {
      return NextResponse.json({ error: 'endTime must be after startTime' }, { status: 400 })
    }

    if (session?.user?.role === 'DOCTOR') {
      const own = await prisma.staff.findFirst({
        where: { hospitalId, userId: session.user.id },
        select: { id: true },
      })
      if (!own || own.id !== staffId) {
        return NextResponse.json({ error: 'Doctors can only manage their own breaks' }, { status: 403 })
      }
    }
    const staff = await prisma.staff.findFirst({ where: { id: staffId, hospitalId } })
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

    const overlap = await prisma.doctorBreak.findFirst({
      where: {
        hospitalId,
        staffId,
        dayOfWeek,
        isActive: true,
        OR: [
          { startTime: { lt: endTime, gte: startTime } },
          { endTime: { gt: startTime, lte: endTime } },
          { startTime: { lte: startTime }, endTime: { gte: endTime } },
        ],
      },
    })
    if (overlap) {
      return NextResponse.json(
        { error: `This doctor already has a break overlapping ${startTime}–${endTime} on that day` },
        { status: 409 }
      )
    }

    const created = await prisma.doctorBreak.create({
      data: {
        hospitalId,
        staffId,
        dayOfWeek,
        startTime,
        endTime,
        label: typeof label === 'string' ? label.slice(0, 100) : null,
      },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    console.error('Error creating doctor break:', err)
    return NextResponse.json({ error: 'Failed to create break' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const row = await prisma.doctorBreak.findFirst({ where: { id, hospitalId } })
    if (!row) return NextResponse.json({ error: 'Break not found' }, { status: 404 })

    if (session?.user?.role === 'DOCTOR') {
      const own = await prisma.staff.findFirst({
        where: { hospitalId, userId: session.user.id },
        select: { id: true },
      })
      if (!own || own.id !== row.staffId) {
        return NextResponse.json({ error: 'Doctors can only remove their own breaks' }, { status: 403 })
      }
    }

    const updated = await prisma.doctorBreak.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json(updated)
  } catch (err) {
    console.error('Error removing doctor break:', err)
    return NextResponse.json({ error: 'Failed to remove break' }, { status: 500 })
  }
}

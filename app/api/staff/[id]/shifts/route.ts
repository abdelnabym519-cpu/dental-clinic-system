import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { isValidTime } from '@/lib/agenda-utils'

// GET - Get staff member's shifts
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Verify staff belongs to hospital
    const staffMember = await prisma.staff.findFirst({
      where: { id, hospitalId },
    })
    if (!staffMember) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    const shifts = await prisma.staffShift.findMany({
      where: { hospitalId, staffId: id },
      orderBy: { dayOfWeek: 'asc' },
    })

    return NextResponse.json({ shifts })
  } catch (error) {
    console.error('Error fetching shifts:', error)
    return NextResponse.json({ error: 'Failed to fetch shifts' }, { status: 500 })
  }
}

// PUT - Update staff member's shifts (replace all)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Only admin can update shifts
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { shifts } = body

    // Verify staff belongs to hospital
    const staffMember = await prisma.staff.findFirst({
      where: { id, hospitalId },
    })
    if (!staffMember) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    if (!Array.isArray(shifts)) {
      return NextResponse.json({ error: 'shifts must be an array' }, { status: 400 })
    }

    // Validate shifts before writing anything. Omitted days are treated as
    // explicitly inactive, never as permission to fall back to clinic hours.
    const byDay = new Map<number, any>()
    for (const shift of shifts) {
      const dayOfWeek = Number(shift?.dayOfWeek)
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || byDay.has(dayOfWeek)) {
        return NextResponse.json(
          { error: 'dayOfWeek must be unique and between 0 (Sunday) and 6 (Saturday)' },
          { status: 400 }
        )
      }
      if (!shift.startTime || !shift.endTime) {
        return NextResponse.json(
          { error: 'Each shift must have startTime and endTime' },
          { status: 400 }
        )
      }
      if (
        shift.isActive !== false &&
        (!isValidTime(shift.startTime) || !isValidTime(shift.endTime) || shift.startTime >= shift.endTime)
      ) {
        return NextResponse.json(
          { error: 'Active shifts require valid increasing 24-hour times' },
          { status: 400 }
        )
      }
      byDay.set(dayOfWeek, shift)
    }

    const normalizedShifts = Array.from({ length: 7 }, (_, dayOfWeek) => {
      const shift = byDay.get(dayOfWeek)
      return {
        hospitalId,
        staffId: id,
        dayOfWeek,
        startTime: shift?.startTime ?? '09:00',
        endTime: shift?.endTime ?? '17:00',
        isActive: shift ? shift.isActive !== false : false,
      }
    })

    // Replace the complete weekly schedule atomically, including closed days.
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.staffShift.deleteMany({
        where: { hospitalId, staffId: id },
      })
      await tx.staffShift.createMany({ data: normalizedShifts })
      return await tx.staffShift.findMany({
        where: { hospitalId, staffId: id },
        orderBy: { dayOfWeek: 'asc' },
      })
    })

    return NextResponse.json({ shifts: result })
  } catch (error) {
    console.error('Error updating shifts:', error)
    return NextResponse.json({ error: 'Failed to update shifts' }, { status: 500 })
  }
}

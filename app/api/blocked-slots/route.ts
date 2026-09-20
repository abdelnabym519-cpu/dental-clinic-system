import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * Blocked-slot management (Agenda Phase 2D — meetings, maintenance, one-off
 * breaks). RBAC: ADMIN (any staff) and DOCTOR (own staffId only).
 * Enforcement lives in the booking gate (SLOT_BLOCKED) and the availability
 * overlay; these endpoints manage the rows.
 */

async function resolveOwnStaffId(hospitalId: string, userId: string): Promise<string | null> {
  const staff = await prisma.staff.findFirst({
    where: { hospitalId, userId },
    select: { id: true },
  })
  return staff?.id ?? null
}

export async function GET() {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const slots = await prisma.blockedSlot.findMany({
      where: { hospitalId, isActive: true, endAt: { gte: new Date() } },
      orderBy: { startAt: 'asc' },
      include: {
        staff: { select: { id: true, firstName: true, lastName: true } },
        room: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({ slots })
  } catch (err) {
    console.error('Error listing blocked slots:', err)
    return NextResponse.json({ error: 'Failed to list blocked slots' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { startAt, endAt, reason, staffId, roomId } = body
    const start = new Date(startAt)
    const end = new Date(endAt)
    if (!startAt || !endAt || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Valid startAt and endAt are required' }, { status: 400 })
    }
    if (end <= start) {
      return NextResponse.json({ error: 'endAt must be after startAt' }, { status: 400 })
    }

    // Doctors may only create blocks for themselves; admins for anyone.
    let resolvedStaffId: string | null = null
    if (typeof staffId === 'string' && staffId) {
      if (session?.user?.role === 'DOCTOR') {
        const ownId = await resolveOwnStaffId(hospitalId, session.user.id)
        if (ownId !== staffId) {
          return NextResponse.json(
            { error: 'Doctors can only block their own time' },
            { status: 403 }
          )
        }
      }
      const staff = await prisma.staff.findFirst({ where: { id: staffId, hospitalId } })
      if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
      resolvedStaffId = staffId
    }
    let resolvedRoomId: string | null = null
    if (typeof roomId === 'string' && roomId) {
      const room = await prisma.room.findFirst({ where: { id: roomId, hospitalId } })
      if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      resolvedRoomId = roomId
    }

    const slot = await prisma.blockedSlot.create({
      data: {
        hospitalId,
        staffId: resolvedStaffId,
        roomId: resolvedRoomId,
        startAt: start,
        endAt: end,
        reason: typeof reason === 'string' ? reason.slice(0, 200) : null,
        createdBy: session?.user?.id ?? null,
      },
    })
    return NextResponse.json(slot, { status: 201 })
  } catch (err) {
    console.error('Error creating blocked slot:', err)
    return NextResponse.json({ error: 'Failed to create blocked slot' }, { status: 500 })
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

    const slot = await prisma.blockedSlot.findFirst({ where: { id, hospitalId } })
    if (!slot) return NextResponse.json({ error: 'Blocked slot not found' }, { status: 404 })

    if (session?.user?.role === 'DOCTOR' && slot.staffId) {
      const ownId = await resolveOwnStaffId(hospitalId, session.user.id)
      if (ownId !== slot.staffId) {
        return NextResponse.json(
          { error: 'Doctors can only remove their own blocked slots' },
          { status: 403 }
        )
      }
    }

    // State transition, not a destructive delete — the audit trail survives.
    const updated = await prisma.blockedSlot.update({
      where: { id },
      data: { isActive: false },
    })
    return NextResponse.json(updated)
  } catch (err) {
    console.error('Error removing blocked slot:', err)
    return NextResponse.json({ error: 'Failed to remove blocked slot' }, { status: 500 })
  }
}

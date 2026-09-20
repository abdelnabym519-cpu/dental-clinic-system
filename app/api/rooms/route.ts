import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

// GET - List clinical rooms for this hospital (any authenticated role).
export async function GET() {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const rooms = await prisma.room.findMany({
      where: { hospitalId, isActive: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ rooms })
  } catch (err) {
    console.error('Error listing rooms:', err)
    return NextResponse.json({ error: 'Failed to list rooms' }, { status: 500 })
  }
}

// POST - Create a clinical room (ADMIN only, tenant-scoped).
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'Room name is required (max 80 chars)' }, { status: 400 })
    }

    const existing = await prisma.room.findFirst({
      where: { hospitalId, name },
    })
    if (existing) {
      return NextResponse.json({ error: 'A room with this name already exists' }, { status: 409 })
    }

    const room = await prisma.room.create({
      data: {
        hospitalId,
        name,
        description: typeof body.description === 'string' ? body.description : null,
      },
    })
    return NextResponse.json(room, { status: 201 })
  } catch (err) {
    console.error('Error creating room:', err)
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }
}

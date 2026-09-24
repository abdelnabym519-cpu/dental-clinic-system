import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * /api/clinical-notes/[id] (Phase 11).
 * PATCH  — the author (their Staff record) may edit their own note, but only
 *          within 24h of creation (documentation integrity: clinical notes
 *          are a point-in-time record, not a free-form wiki).
 * DELETE — the author (DOCTOR) or any ADMIN.
 */
const EDIT_WINDOW_MS = 24 * 3600_000

async function resolveActorStaff(hospitalId: string, userId: string) {
  return prisma.staff.findFirst({ where: { userId, hospitalId }, select: { id: true } })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const note = await prisma.clinicalNote.findFirst({ where: { id, hospitalId } })
    if (!note) {
      return NextResponse.json({ error: 'Clinical note not found' }, { status: 404 })
    }

    const actorStaff = await resolveActorStaff(hospitalId, session!.user!.id)
    if (!actorStaff || actorStaff.id !== note.doctorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (Date.now() - note.createdAt.getTime() > EDIT_WINDOW_MS) {
      return NextResponse.json(
        { error: 'Clinical notes can only be edited within 24 hours of creation' },
        { status: 409 }
      )
    }

    const body = await request.json()
    const data: Record<string, unknown> = {}
    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || body.content.trim().length === 0) {
        return NextResponse.json({ error: 'content must be a non-empty string' }, { status: 400 })
      }
      data.content = body.content.trim()
    }
    if (body.noteType !== undefined) {
      const allowed = ['GENERAL', 'EXAMINATION', 'TREATMENT', 'FOLLOW_UP', 'REFERRAL']
      if (!allowed.includes(body.noteType)) {
        return NextResponse.json({ error: 'Invalid noteType' }, { status: 400 })
      }
      data.noteType = body.noteType
    }
    if (body.isPrivate !== undefined) data.isPrivate = Boolean(body.isPrivate)

    const updated = await prisma.clinicalNote.update({
      where: { id: note.id },
      data: data as never,
      include: { doctor: { select: { firstName: true, lastName: true } } },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (err: unknown) {
    console.error('Error updating clinical note:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update clinical note' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const note = await prisma.clinicalNote.findFirst({ where: { id, hospitalId } })
    if (!note) {
      return NextResponse.json({ error: 'Clinical note not found' }, { status: 404 })
    }

    const isAdmin = session?.user?.role === 'ADMIN'
    if (!isAdmin) {
      const actorStaff = await resolveActorStaff(hospitalId, session!.user!.id)
      if (!actorStaff || actorStaff.id !== note.doctorId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    await prisma.clinicalNote.delete({ where: { id: note.id } })
    return NextResponse.json({ success: true, actorId: session?.user?.id })
  } catch (err: unknown) {
    console.error('Error deleting clinical note:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete clinical note' },
      { status: 500 }
    )
  }
}

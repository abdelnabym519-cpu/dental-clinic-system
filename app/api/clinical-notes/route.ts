import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * /api/clinical-notes (Phase 11) — doctor documentation attached to an
 * appointment.
 *
 * POST — DOCTOR/ADMIN. patientId is derived from the appointment (never
 *        trusted from the client); doctorId is the actor's Staff record.
 * GET  — ?appointmentId= or ?patientId= (tenant-scoped, newest first).
 *        RBAC: DOCTOR/ADMIN see everything; every other role (e.g.
 *        RECEPTIONIST) sees non-private notes only — isPrivate=true notes
 *        are clinical and doctor-restricted.
 */
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { appointmentId, content, noteType, isPrivate, treatmentPlanId } = body

    if (!appointmentId || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'appointmentId and content are required' }, { status: 400 })
    }

    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, hospitalId },
      select: { id: true, patientId: true },
    })
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const actorStaff = await prisma.staff.findFirst({
      where: { userId: session!.user!.id, hospitalId },
      select: { id: true },
    })
    if (!actorStaff) {
      return NextResponse.json(
        { error: 'No staff record for this user — cannot attribute a clinical note' },
        { status: 400 }
      )
    }

    let treatmentPlan = null
    if (treatmentPlanId) {
      treatmentPlan = await prisma.treatmentPlan.findFirst({
        where: { id: treatmentPlanId, hospitalId },
        select: { id: true, patientId: true },
      })
      if (!treatmentPlan) {
        return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
      }
      if (treatmentPlan.patientId !== appointment.patientId) {
        return NextResponse.json(
          { error: 'Treatment plan belongs to a different patient' },
          { status: 400 }
        )
      }
    }

    const note = await prisma.clinicalNote.create({
      data: {
        hospitalId,
        appointmentId,
        patientId: appointment.patientId,
        doctorId: actorStaff.id,
        treatmentPlanId: treatmentPlanId ?? null,
        content: content.trim(),
        noteType: noteType ?? 'GENERAL',
        isPrivate: Boolean(isPrivate),
      },
      include: { doctor: { select: { firstName: true, lastName: true } } },
    })

    return NextResponse.json({ success: true, data: note }, { status: 201 })
  } catch (err: unknown) {
    console.error('Error creating clinical note:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create clinical note' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const { error, hospitalId, session } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sp = new URL(request.url).searchParams
    const appointmentId = sp.get('appointmentId') || ''
    const patientId = sp.get('patientId') || ''
    if (!appointmentId && !patientId) {
      return NextResponse.json({ error: 'Provide appointmentId or patientId' }, { status: 400 })
    }

    const where: Record<string, unknown> = { hospitalId }
    if (appointmentId) where.appointmentId = appointmentId
    if (patientId) where.patientId = patientId

    // Private notes are clinical: DOCTOR/ADMIN only.
    const role = session?.user?.role
    if (role !== 'DOCTOR' && role !== 'ADMIN') {
      where.isPrivate = false
    }

    const notes = await prisma.clinicalNote.findMany({
      where,
      include: {
        doctor: { select: { id: true, firstName: true, lastName: true } },
        appointment: { select: { id: true, appointmentNo: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, data: notes })
  } catch (err: unknown) {
    console.error('Error fetching clinical notes:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch clinical notes' },
      { status: 500 }
    )
  }
}

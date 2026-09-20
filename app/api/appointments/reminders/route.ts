import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

const VALID_CHANNELS = ['SMS', 'EMAIL', 'WHATSAPP'] as const
type Channel = (typeof VALID_CHANNELS)[number]

function isValidFutureDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).getTime() > Date.now() - 60000
  )
}

// GET - Reminders for an appointment (appointment detail drawer).
// Query: appointmentId=<id>
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const appointmentId = searchParams.get('appointmentId')
    if (!appointmentId) {
      return NextResponse.json({ error: 'appointmentId is required' }, { status: 400 })
    }

    // Ownership first: the appointment must belong to this hospital.
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, hospitalId },
      select: { id: true },
    })
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const reminders = await prisma.appointmentReminder.findMany({
      where: { appointmentId },
      orderBy: { scheduledFor: 'desc' },
    })
    return NextResponse.json({ reminders })
  } catch (err) {
    console.error('Error listing reminders:', err)
    return NextResponse.json({ error: 'Failed to list reminders' }, { status: 500 })
  }
}

// POST - Schedule a reminder for an appointment (RECEPTIONIST / ADMIN).
// Infrastructure only: the record is queued for the existing reminder cron;
// no live channel sending happens here.
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'RECEPTIONIST'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const appointmentId = body.appointmentId
    const channel = body.channel as Channel
    const scheduledFor = body.scheduledFor

    if (!appointmentId || !VALID_CHANNELS.includes(channel) || !isValidFutureDate(scheduledFor)) {
      return NextResponse.json(
        {
          error:
            'appointmentId, channel (SMS/EMAIL/WHATSAPP) and a future scheduledFor are required',
        },
        { status: 400 }
      )
    }

    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, hospitalId },
      select: { id: true },
    })
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const reminder = await prisma.appointmentReminder.create({
      data: {
        hospitalId,
        appointmentId,
        reminderType: channel,
        scheduledFor: new Date(scheduledFor),
        status: 'PENDING',
      },
    })
    return NextResponse.json(reminder, { status: 201 })
  } catch (err) {
    console.error('Error scheduling reminder:', err)
    return NextResponse.json({ error: 'Failed to schedule reminder' }, { status: 500 })
  }
}

// DELETE - Cancel a pending reminder (RECEPTIONIST / ADMIN).
// Query: id=<reminderId>  (state transition, not a destructive delete)
export async function DELETE(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'RECEPTIONIST'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Reminder id is required' }, { status: 400 })
    }

    const reminder = await prisma.appointmentReminder.findFirst({
      where: { id },
      include: { appointment: { select: { hospitalId: true } } },
    })

    // Tenant scope verified through the parent appointment.
    if (!reminder || (reminder as { appointment?: { hospitalId?: string } }).appointment?.hospitalId !== hospitalId) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
    }
    if (reminder.status === 'SENT') {
      return NextResponse.json({ error: 'Cannot cancel a sent reminder' }, { status: 400 })
    }

    const updated = await prisma.appointmentReminder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })
    return NextResponse.json(updated)
  } catch (err) {
    console.error('Error cancelling reminder:', err)
    return NextResponse.json({ error: 'Failed to cancel reminder' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requirePatientAuth } from '@/lib/patient-auth'
import { enqueueMessage } from '@/lib/messaging/service'
import { doctorCancellation } from '@/lib/messaging/templates'

/**
 * POST /api/patient-portal/appointments/[id]/cancel (Phase 13, D8) — the
 * patient cancels one of their own upcoming appointments.
 *
 * Rules (all server-side, id taken from the token, never the URL of another
 * patient's data):
 *   - only the authenticated patient's own appointment (anything else → 404)
 *   - only SCHEDULED appointments can be cancelled
 *   - the appointment must start more than 24 hours from now
 * On success the doctor is notified via the existing WhatsApp MessageQueue.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  try {
    const { id } = await params

    const appointment = await prisma.appointment.findFirst({
      where: {
        id,
        patientId: patient!.id,
        hospitalId: patient!.hospitalId,
      },
      include: {
        doctor: { select: { firstName: true, lastName: true, phone: true } },
      },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    if (appointment.status !== 'SCHEDULED') {
      return NextResponse.json(
        { error: 'Only scheduled appointments can be cancelled' },
        { status: 409 }
      )
    }

    const start = new Date(appointment.scheduledDate)
    const [h, m] = (appointment.scheduledTime || '00:00').split(':').map(Number)
    start.setHours(h, m, 0, 0)
    if (start.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: 'Appointments can only be cancelled more than 24 hours in advance' },
        { status: 409 }
      )
    }

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Cancelled by the patient via the portal',
      },
    })

    if (appointment.doctor?.phone) {
      await enqueueMessage({
        hospitalId: patient!.hospitalId,
        appointmentId: appointment.id,
        patientId: patient!.id,
        recipient: appointment.doctor.phone,
        channel: 'WHATSAPP',
        messageType: 'DOCTOR_CANCELLATION',
        payload: {
          text: doctorCancellation(
            `${patient!.firstName} ${patient!.lastName}`.trim(),
            appointment.scheduledDate.toISOString().slice(0, 10)
          ),
        },
      })
    }

    return NextResponse.json({ success: true, appointmentId: appointment.id }, { status: 200 })
  } catch (err: unknown) {
    console.error('Patient cancel appointment error:', err)
    return NextResponse.json({ error: 'Failed to cancel appointment' }, { status: 500 })
  }
}

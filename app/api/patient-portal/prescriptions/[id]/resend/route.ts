import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requirePatientAuth } from '@/lib/patient-auth'
import { enqueueMessage } from '@/lib/messaging/service'
import { prescriptionSent } from '@/lib/messaging/templates'

/**
 * POST /api/patient-portal/prescriptions/[id]/resend (Phase 13, D9) — the
 * patient asks the clinic's WhatsApp channel to re-send one of their own
 * prescriptions. Queued on the existing MessageQueue (Phase 10 infra) with
 * the standard PRESCRIPTION template.
 *
 * SECURITY: looked up by { id, hospitalId, patientId } from the portal
 * token — another patient's prescription is a 404.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  try {
    const { id } = await params
    const prescription = await prisma.prescription.findFirst({
      where: {
        id,
        hospitalId: patient!.hospitalId,
        patientId: patient!.id,
      },
      include: {
        doctor: { select: { firstName: true, lastName: true } },
      },
    })
    if (!prescription) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: patient!.hospitalId },
      select: { name: true, address: true, phone: true },
    })

    const queueId = await enqueueMessage({
      hospitalId: patient!.hospitalId,
      patientId: patient!.id,
      recipient: patient!.phone,
      channel: 'WHATSAPP',
      messageType: 'PRESCRIPTION',
      payload: {
        text: prescriptionSent(
          { name: hospital?.name ?? '', address: hospital?.address ?? null },
          `Dr. ${prescription.doctor.firstName} ${prescription.doctor.lastName}`,
          (prescription.issuedAt ?? prescription.createdAt)
            .toISOString()
            .slice(0, 10)
        ),
      },
    })

    await prisma.prescription.update({
      where: { id: prescription.id },
      data: { sentViaWhatsApp: true, whatsappSentAt: new Date() },
    })

    return NextResponse.json(
      { success: true, queued: queueId !== null, queueId },
      { status: 200 }
    )
  } catch (err: unknown) {
    console.error('Patient prescription resend error:', err)
    return NextResponse.json({ error: 'Failed to queue the prescription message' }, { status: 500 })
  }
}

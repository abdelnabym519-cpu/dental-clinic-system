import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { renderSimplePdf } from '@/lib/pdf'
import { formatDate } from '@/lib/i18n/format'
import { getServerLocale } from '@/lib/i18n/server'
import { translateText } from '@/lib/i18n/dictionary'
import { enqueueMessage } from '@/lib/messaging/service'
import * as templates from '@/lib/messaging/templates'
import { getStorage } from '@/lib/storage'
import { buildStorageKey } from '@/lib/storage/keys'

/**
 * POST /api/communications/prescriptions/[id]/send — electronic prescription
 * via WhatsApp (master prompt 3F). RBAC: DOCTOR, ADMIN. Tenant-scoped.
 *
 * Renders the prescription as a PDF and queues it as a WhatsApp document
 * message. The MessageQueue row is the sent-prescription record (status +
 * timestamps); actual delivery is the queue processor's job.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requireAuthAndRole(['DOCTOR', 'ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const prescription = await prisma.prescription.findFirst({
      where: { id, hospitalId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor: { select: { id: true, firstName: true, lastName: true, phone: true } },
        medications: {
          select: { medicationName: true, dosage: true, frequency: true, duration: true },
        },
      },
    })
    if (!prescription) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    // Phase 11 — a prescription is only sent after the doctor signed it.
    if (prescription.status !== 'SIGNED') {
      return NextResponse.json(
        { error: 'Prescription must be signed before sending' },
        { status: 409 }
      )
    }

    // Recipient: manual override number on the prescription request body wins
    // over the stored patient phone (master prompt 3K).
    const body = await request.json().catch(() => ({}))
    const recipient =
      typeof body?.contactPhone === 'string' && body.contactPhone.trim()
        ? body.contactPhone.trim()
        : prescription.patient.phone

    // Same rule as the invoice attachment: the document language follows the
    // staff member's selected locale (docs/LOCALIZATION.md §6).
    const locale = await getServerLocale()
    const t = (key: string, vars?: Record<string, string | number>) =>
      translateText(locale, key, vars)

    const clinicName =
      (await prisma.hospital.findUnique({ where: { id: hospitalId }, select: { name: true } }))
        ?.name ?? t('Clinic')
    const dateStr = new Date().toISOString().slice(0, 10) // caption, as 3C–3J pins
    const pdfDate = formatDate(new Date(), { locale })
    const doctorName = `Dr. ${prescription.doctor.firstName} ${prescription.doctor.lastName}`

    // Phase 11 — the rendered PDF is persisted (storage key in prescription.pdfUrl)
    // so it can be re-sent / previewed without re-rendering.
    const storageKey = buildStorageKey(
      hospitalId,
      'prescriptions',
      prescription.id,
      'prescription.pdf'
    )
    const markSent = async () => {
      await getStorage().put(storageKey, pdf, { contentType: 'application/pdf' })
      await prisma.prescription.update({
        where: { id: prescription.id },
        data: {
          status: 'SENT',
          sentViaWhatsApp: true,
          whatsappSentAt: new Date(),
          pdfUrl: storageKey,
        },
      })
    }

    const pdf = renderSimplePdf({
      title: t('Prescription {v1}', { v1: prescription.prescriptionNo }),
      subtitle: `${clinicName} — ${pdfDate}`,
      lines: [
        {
          text: t('Patient: {v1}', {
            v1: `${prescription.patient.firstName} ${prescription.patient.lastName}`,
          }),
          bold: true,
        },
        { text: t('Doctor: {v1}', { v1: doctorName }), gapAfter: 10 },
        ...(prescription.diagnosis
          ? [{ text: t('Diagnosis: {v1}', { v1: prescription.diagnosis }), gapAfter: 8 }]
          : []),
        { text: t('Medications:'), bold: true, gapAfter: 4 },
        ...prescription.medications.map(
          (m: { medicationName: string; dosage: string; frequency: string; duration: string }) => ({
            text: `- ${m.medicationName} — ${m.dosage}, ${m.frequency}, ${m.duration}`,
            gapAfter: 2,
          })
        ),
        ...(prescription.notes
          ? [{ text: t('Notes: {v1}', { v1: prescription.notes }), gapAfter: 10 }]
          : []),
      ],
      footer: t('This prescription was issued electronically by the clinic.'),
    })

    const queueId = await enqueueMessage({
      hospitalId,
      patientId: prescription.patient.id,
      recipient,
      channel: 'WHATSAPP',
      messageType: 'PRESCRIPTION',
      payload: {
        text: templates.prescriptionSent({ name: clinicName }, doctorName, dateStr),
        attachment: {
          filename: `prescription-${prescription.prescriptionNo}.pdf`,
          mimeType: 'application/pdf',
          data: pdf.toString('base64'),
        },
      },
    })

    if (!queueId) {
      return NextResponse.json(
        { error: 'No valid recipient phone number on file for this patient' },
        { status: 400 }
      )
    }

    await markSent()

    return NextResponse.json(
      {
        success: true,
        queueId,
        maskedRecipient: true,
        actorId: session?.user?.id,
        pdfUrl: storageKey,
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('Error sending prescription:', err)
    return NextResponse.json({ error: 'Failed to queue prescription message' }, { status: 500 })
  }
}

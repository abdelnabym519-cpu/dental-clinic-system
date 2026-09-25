import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requirePatientAuth } from '@/lib/patient-auth'
import { renderSimplePdf } from '@/lib/pdf'
import { getStorage, StorageNotFoundError } from '@/lib/storage'
import { formatDate } from '@/lib/i18n/format'
import { getServerLocale } from '@/lib/i18n/server'
import { translateText } from '@/lib/i18n/dictionary'

/**
 * GET /api/patient-portal/prescriptions/[id]/pdf (Phase 13, D9) — the
 * prescription PDF for the patient's own record. Same stored-first /
 * live-fallback behavior as the staff route
 * (/api/documents/prescription/[id]) — the layout is deliberately identical
 * so what the patient downloads matches what the clinic sent.
 *
 * SECURITY: the prescription is looked up by { id, hospitalId, patientId }
 * where patientId comes from the authenticated portal token — a patient can
 * never reach another patient's prescription (404, no enumeration).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, patient } = await requirePatientAuth(_request)
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
        medications: {
          select: {
            medicationName: true,
            dosage: true,
            frequency: true,
            duration: true,
            instructions: true,
          },
        },
      },
    })
    if (!prescription) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    const pdfHeaders = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="prescription-${prescription.prescriptionNo}.pdf"`,
      'Cache-Control': 'no-store',
    }

    // 1) Prefer the stored document (the one that was signed/sent).
    if (prescription.pdfUrl) {
      try {
        const stored = await getStorage().get(prescription.pdfUrl)
        return new Response(new Uint8Array(stored.body), { headers: pdfHeaders })
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) throw err
        // Stored object vanished — fall through to re-render.
      }
    }

    // 2) Render on the fly (same layout as the staff/send routes).
    const locale = await getServerLocale()
    const t = (key: string, vars?: Record<string, string | number>) =>
      translateText(locale, key, vars)
    const hospital = await prisma.hospital.findUnique({
      where: { id: patient!.hospitalId },
      select: { name: true },
    })
    const clinicName = hospital?.name ?? t('Clinic')
    const doctorName = `Dr. ${prescription.doctor.firstName} ${prescription.doctor.lastName}`
    const age = patient!.dateOfBirth
      ? Math.floor((Date.now() - patient!.dateOfBirth.getTime()) / (365.25 * 24 * 3600_000))
      : null

    const pdf = renderSimplePdf({
      title: t('Prescription {v1}', { v1: prescription.prescriptionNo }),
      subtitle: `${clinicName} — ${formatDate(new Date(), { locale })}`,
      lines: [
        {
          text: t('Patient: {v1}', {
            v1:
              `${patient!.firstName} ${patient!.lastName}` +
              (age !== null ? t(' (age {v1})', { v1: age }) : ''),
          }),
          bold: true,
        },
        { text: t('Doctor: {v1}', { v1: doctorName }), gapAfter: 10 },
        ...(prescription.diagnosis
          ? [{ text: t('Diagnosis: {v1}', { v1: prescription.diagnosis }), gapAfter: 8 }]
          : []),
        { text: t('Medications:'), bold: true, gapAfter: 4 },
        ...prescription.medications.map(
          (m: {
            medicationName: string
            dosage: string
            frequency: string
            duration: string
            instructions: string | null
          }) => ({
            text: `- ${m.medicationName} — ${m.dosage}, ${m.frequency}, ${m.duration}${m.instructions ? ` (${m.instructions})` : ''}`,
            gapAfter: 2,
          })
        ),
        ...(prescription.notes
          ? [{ text: t('Notes: {v1}', { v1: prescription.notes }), gapAfter: 10 }]
          : []),
      ],
      footer: t('This prescription was issued electronically by the clinic.'),
    })

    return new Response(new Uint8Array(pdf), { headers: pdfHeaders })
  } catch (err: unknown) {
    console.error('Error rendering patient prescription PDF:', err)
    return NextResponse.json(
      { error: 'Failed to render prescription PDF' },
      { status: 500 }
    )
  }
}

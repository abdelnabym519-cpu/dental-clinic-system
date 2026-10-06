import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { renderSimplePdf } from '@/lib/pdf'
import { getStorage } from '@/lib/storage'
import { StorageNotFoundError } from '@/lib/storage'
import { formatDate } from '@/lib/i18n/format'
import { getServerLocale } from '@/lib/i18n/server'
import { translateText } from '@/lib/i18n/dictionary'

/**
 * GET /api/documents/prescription/[id] (Phase 11) — the prescription PDF
 * for the preview button. Serves the stored PDF (pdfUrl) when present —
 * i.e. what was actually sent to the patient — and renders on the fly for
 * unsigned drafts. Any authenticated role in the tenant may view (clinical
 * data is read-only for RECEPTIONIST; the prescription body itself carries
 * no note-level privacy flag).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const prescription = await prisma.prescription.findFirst({
      where: { id, hospitalId },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            gender: true,
            medicalHistory: { select: { drugAllergies: true } },
          },
        },
        doctor: { select: { firstName: true, lastName: true, licenseNumber: true } },
        medications: {
          select: {
            medicationName: true,
            dosage: true,
            frequency: true,
            duration: true,
            route: true,
            timing: true,
            instructions: true,
            quantity: true,
          },
        },
      },
    })
    if (!prescription) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    // 1) Prefer the stored document (the one that was signed/sent).
    if (prescription.pdfUrl) {
      try {
        const stored = await getStorage().get(prescription.pdfUrl)
        return new Response(new Uint8Array(stored.body), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="prescription-${prescription.prescriptionNo}.pdf"`,
            'Cache-Control': 'no-store',
          },
        })
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) throw err
        // Stored object vanished (e.g. local storage wiped) — fall through to re-render.
      }
    }

    // 2) Render on the fly (same layout as the send route).
    const locale = await getServerLocale()
    const t = (key: string, vars?: Record<string, string | number>) =>
      translateText(locale, key, vars)
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true },
    })
    const clinicName = hospital?.name ?? t('Clinic')
    const doctorName = `Dr. ${prescription.doctor.firstName} ${prescription.doctor.lastName}`
    const age = prescription.patient.dateOfBirth
      ? Math.floor(
          (Date.now() - prescription.patient.dateOfBirth.getTime()) / (365.25 * 24 * 3600_000)
        )
      : null

    const pdf = renderSimplePdf({
      title: t('Prescription {v1}', { v1: prescription.prescriptionNo }),
      subtitle: `${clinicName} — ${formatDate(new Date(), { locale })}`,
      lines: [
        {
          text: t('Patient: {v1}', {
            v1:
              `${prescription.patient.firstName} ${prescription.patient.lastName}` +
              (age !== null ? t(' (age {v1})', { v1: age }) : ''),
          }),
          bold: true,
        },
        { text: t('Doctor: {v1}', { v1: doctorName }), gapAfter: 10 },
        ...(prescription.patient.medicalHistory?.drugAllergies
          ? [
              {
                text: t('Allergies: {v1}', {
                  v1: prescription.patient.medicalHistory.drugAllergies,
                }),
                gapAfter: 8,
              },
            ]
          : []),
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

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="prescription-${prescription.prescriptionNo}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: unknown) {
    console.error('Error rendering prescription PDF:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to render prescription PDF' },
      { status: 500 }
    )
  }
}

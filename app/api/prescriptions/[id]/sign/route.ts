import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * POST /api/prescriptions/[id]/sign (Phase 11) — DOCTOR/ADMIN signs the
 * prescription: DRAFT → SIGNED, sets issuedAt and a 30-day validity window
 * (validUntil, the existing expiry field) when one was not already chosen.
 * A signed prescription is frozen for edits (PATCH rejects non-DRAFT).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const prescription = await prisma.prescription.findFirst({
      where: { id, hospitalId },
      include: { medications: { select: { id: true } } },
    })
    if (!prescription) {
      return NextResponse.json({ error: 'الروشتة غير موجودة' }, { status: 404 })
    }

    if (prescription.status !== 'DRAFT') {
      return NextResponse.json({ error: 'لا يمكن توقيع روشتة غير مسودة' }, { status: 409 })
    }
    if (prescription.medications.length === 0) {
      return NextResponse.json(
        { error: 'لا يمكن توقيع روشتة بدون أدوية' },
        { status: 400 }
      )
    }

    const now = new Date()
    const expiresAt = prescription.validUntil ?? new Date(now.getTime() + 30 * 24 * 3600_000)

    const signed = await prisma.prescription.update({
      where: { id: prescription.id },
      data: {
        status: 'SIGNED',
        issuedAt: now,
        validUntil: expiresAt,
      },
      include: {
        patient: { select: { patientId: true, firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
        medications: true,
      },
    })

    return NextResponse.json(
      { success: true, data: signed, actorId: session?.user?.id, signedAt: now.toISOString() },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('Error signing prescription:', err)
    // Issue 5 — raw internal errors never reach the clinic user.
    return NextResponse.json({ error: 'تعذر توقيع الروشتة. حاول مرة أخرى.' }, { status: 500 })
  }
}

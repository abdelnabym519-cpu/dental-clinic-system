import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET — single prescription with medications
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            dateOfBirth: true,
            gender: true,
            address: true,
            city: true,
            medicalHistory: {
              select: { drugAllergies: true, foodAllergies: true, materialAllergies: true },
            },
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
            licenseNumber: true,
          },
        },
        medications: {
          include: { medication: { select: { id: true, name: true, genericName: true } } },
        },
      },
    })

    if (!prescription) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    // Also fetch hospital info for the print view
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        name: true,
        tagline: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        logo: true,
        registrationNo: true,
      },
    })

    return NextResponse.json({ success: true, data: prescription, hospital })
  } catch (err: any) {
    console.error('Error fetching prescription:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to fetch prescription' },
      { status: 500 }
    )
  }
}

// DELETE — delete prescription
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await prisma.prescription.findFirst({ where: { id, hospitalId } })
    if (!existing) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }

    await prisma.prescription.delete({ where: { id } })

    return NextResponse.json({ success: true, message: 'Prescription deleted' })
  } catch (err: any) {
    console.error('Error deleting prescription:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to delete prescription' },
      { status: 500 }
    )
  }
}

/**
 * PATCH (Phase 11) — edit a DRAFT prescription (diagnosis, notes, expiry,
 * medications, appointment/plan links). DOCTOR/ADMIN. Once signed the
 * document is frozen — edit requires cancel + re-create (the signed PDF
 * must stay truthful to what was issued).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await prisma.prescription.findFirst({ where: { id, hospitalId } })
    if (!existing) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 })
    }
    if (existing.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only DRAFT prescriptions can be edited' }, { status: 409 })
    }

    const body = await request.json()

    if (body.appointmentId) {
      const appt = await prisma.appointment.findFirst({
        where: { id: body.appointmentId, hospitalId },
        select: { id: true, patientId: true },
      })
      if (!appt) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
      if (appt.patientId !== existing.patientId) {
        return NextResponse.json(
          { error: 'Appointment belongs to a different patient' },
          { status: 400 }
        )
      }
    }
    if (body.treatmentPlanId) {
      const plan = await prisma.treatmentPlan.findFirst({
        where: { id: body.treatmentPlanId, hospitalId },
        select: { id: true, patientId: true },
      })
      if (!plan) return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
      if (plan.patientId !== existing.patientId) {
        return NextResponse.json(
          { error: 'Treatment plan belongs to a different patient' },
          { status: 400 }
        )
      }
    }

    const data: Record<string, unknown> = {}
    if (body.diagnosis !== undefined) data.diagnosis = body.diagnosis
    if (body.notes !== undefined) data.notes = body.notes
    if (body.validUntil !== undefined) {
      data.validUntil = body.validUntil ? new Date(body.validUntil) : null
    }
    if (body.appointmentId !== undefined) data.appointmentId = body.appointmentId || null
    if (body.treatmentPlanId !== undefined) data.treatmentPlanId = body.treatmentPlanId || null

    // Medications: replace the whole list (draft editing is all-or-nothing).
    if (Array.isArray(body.medications)) {
      for (const m of body.medications) {
        if (!m?.medicationName || !m?.dosage || !m?.frequency || !m?.duration) {
          return NextResponse.json(
            { error: 'Each medication needs name, dosage, frequency and duration' },
            { status: 400 }
          )
        }
      }
      await prisma.prescriptionMedication.deleteMany({ where: { prescriptionId: existing.id } })
      await prisma.prescriptionMedication.createMany({
        data: body.medications.map((m: Record<string, unknown>) => ({
          prescriptionId: existing.id,
          medicationId: m.medicationId || null,
          medicationName: m.medicationName,
          dosage: m.dosage,
          frequency: m.frequency,
          duration: m.duration,
          route: m.route || 'Oral',
          timing: m.timing || null,
          quantity: m.quantity || null,
          instructions: m.instructions || null,
        })),
      })
    }

    const prescription = await prisma.prescription.update({
      where: { id: existing.id },
      data: data as never,
      include: { medications: true },
    })

    return NextResponse.json({ success: true, data: prescription })
  } catch (err: any) {
    console.error('Error updating prescription:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to update prescription' },
      { status: 500 }
    )
  }
}

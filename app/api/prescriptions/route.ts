import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { containsCI } from '@/lib/prisma-search'

// GET — list prescriptions
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sp = request.nextUrl.searchParams
    const search = sp.get('search') || ''
    const patientId = sp.get('patientId') || ''
    const doctorId = sp.get('doctorId') || ''
    const page = parseInt(sp.get('page') || '1')
    const limit = parseInt(sp.get('limit') || '20')
    const skip = (page - 1) * limit

    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { prescriptionNo: containsCI(search) },
        {
          patient: {
            OR: [
              { firstName: containsCI(search) },
              { lastName: containsCI(search) },
              { patientId: containsCI(search) },
            ],
          },
        },
      ]
    }

    if (patientId) where.patientId = patientId
    if (doctorId) where.doctorId = doctorId

    const [prescriptions, total] = await Promise.all([
      prisma.prescription.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              dateOfBirth: true,
            },
          },
          doctor: { select: { id: true, firstName: true, lastName: true } },
          medications: {
            include: { medication: { select: { id: true, name: true, genericName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.prescription.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: prescriptions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err: any) {
    console.error('Error fetching prescriptions:', err)
    // Issue 5 — raw internal errors never reach the clinic user.
    return NextResponse.json({ error: 'تعذر تحميل الروشتات. حاول مرة أخرى.' }, { status: 500 })
  }
}

// POST — create prescription
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { patientId, diagnosis, notes, validUntil, medications } = body

    if (!patientId || !Array.isArray(medications) || medications.length === 0) {
      return NextResponse.json(
        { error: 'المريض ودواء واحد على الأقل مطلوبان' },
        { status: 400 }
      )
    }

    // Issue 5 — server-side medication validation (Phase 11 of the clinical
    // prompt): the schema requires name/dosage/frequency/duration on every
    // item; accepting junk here used to explode into a raw Prisma 500.
    for (const m of medications) {
      if (
        !m ||
        typeof m.medicationName !== 'string' ||
        !m.medicationName.trim() ||
        typeof m.dosage !== 'string' ||
        !m.dosage.trim() ||
        typeof m.frequency !== 'string' ||
        !m.frequency.trim() ||
        typeof m.duration !== 'string' ||
        !m.duration.trim()
      ) {
        return NextResponse.json(
          { error: 'كل دواء يحتاج الاسم والجرعة والعدد المتكرر والمدة' },
          { status: 400 }
        )
      }
      if (m.quantity !== undefined && m.quantity !== null) {
        const q = Number(m.quantity)
        if (!Number.isInteger(q) || q < 1) {
          return NextResponse.json(
            { error: 'كمية الدواء يجب أن تكون رقمًا صحيحًا أكبر من صفر' },
            { status: 400 }
          )
        }
      }
    }

    // Verify patient (tenant-scoped — a foreign patient id is NOT FOUND)
    const patient = await prisma.patient.findFirst({ where: { id: patientId, hospitalId } })
    if (!patient) {
      return NextResponse.json({ error: 'المريض غير موجود' }, { status: 404 })
    }

    // Generate prescription number
    const year = new Date().getFullYear()
    const lastRx = await prisma.prescription.findFirst({
      where: { hospitalId, prescriptionNo: { startsWith: `RX${year}` } },
      orderBy: { prescriptionNo: 'desc' },
    })

    let prescriptionNo = `RX${year}0001`
    if (lastRx) {
      const lastNum = parseInt(lastRx.prescriptionNo.slice(-4))
      prescriptionNo = `RX${year}${(lastNum + 1).toString().padStart(4, '0')}`
    }

    // Get doctor's staff record
    const staff = await prisma.staff.findFirst({ where: { userId: session!.user!.id, hospitalId } })
    if (!staff) {
      return NextResponse.json(
        { error: 'لا يوجد ملف طبيب مرتبط بحسابك في هذه العيادة' },
        { status: 400 }
      )
    }

    const prescription = await prisma.prescription.create({
      data: {
        hospitalId,
        prescriptionNo,
        patientId,
        doctorId: staff.id,
        diagnosis: diagnosis || null,
        notes: notes || null,
        validUntil: validUntil ? new Date(validUntil) : null,
        medications: {
          create: medications.map((m: any) => ({
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
        },
      },
      include: {
        patient: { select: { patientId: true, firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
        medications: true,
      },
    })

    return NextResponse.json({ success: true, data: prescription }, { status: 201 })
  } catch (err: any) {
    console.error('Error creating prescription:', err)
    // Issue 5 — a unique-collision or Prisma failure must never leak its text.
    return NextResponse.json({ error: 'تعذر إنشاء الروشتة. حاول مرة أخرى.' }, { status: 500 })
  }
}

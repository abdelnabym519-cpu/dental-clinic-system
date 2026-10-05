import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole, checkPatientLimit } from '@/lib/api-helpers'

// Generate unique patient ID for the hospital
async function generatePatientId(hospitalId: string): Promise<string> {
  const today = new Date()
  const prefix = `PAT${today.getFullYear()}`

  const lastPatient = await prisma.patient.findFirst({
    where: {
      hospitalId,
      patientId: {
        startsWith: prefix,
      },
    },
    orderBy: {
      patientId: 'desc',
    },
  })

  if (lastPatient) {
    const lastNumber = parseInt(lastPatient.patientId.slice(-5))
    return `${prefix}${String(lastNumber + 1).padStart(5, '0')}`
  }

  return `${prefix}00001`
}

// GET - List patients
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10') || 10))
    const search = searchParams.get('search') || ''
    const all = searchParams.get('all') === 'true'

    const skip = (page - 1) * limit

    const where: any = {
      hospitalId,
      isActive: true,
    }

    if (search) {
      where.OR = [
        { patientId: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ]
    }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          gender: true,
          age: true,
          bloodGroup: true,
          city: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: all ? undefined : skip,
        take: all ? undefined : limit,
      }),
      prisma.patient.count({ where }),
    ])

    return NextResponse.json({
      patients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching patients:', error)
    return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 })
  }
}

// POST - Create new patient
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Check patient limit
    const patientLimit = await checkPatientLimit(hospitalId)
    if (!patientLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Patient limit reached',
          message: `Your plan allows up to ${patientLimit.max} patients. Please upgrade to add more.`,
          current: patientLimit.current,
          max: patientLimit.max,
        },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      firstName,
      lastName,
      dateOfBirth,
      age,
      gender,
      bloodGroup,
      phone,
      alternatePhone,
      email,
      address,
      city,
      state,
      pincode,
      aadharNumber,
      occupation,
      referredBy,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      medicalHistory,
    } = body

    // Issue 5 — clinical data safety: the embedded medical history is
    // SANITIZED server-side. Previously the raw client object went straight
    // into prisma.patient.create, so arbitrary fields (including a forged
    // `patientId` re-linking the 1:1 history row) could be smuggled in.
    const HISTORY_BOOLEANS = [
      'hasAllergies', 'hasDiabetes', 'hasHypertension', 'hasHeartDisease',
      'hasBleedingDisorder', 'hasAsthma', 'hasThyroid', 'hasHepatitis',
      'hasHiv', 'hasEpilepsy', 'isPregnant', 'tobaccoChewing',
    ] as const
    const HISTORY_STRINGS = [
      'drugAllergies', 'foodAllergies', 'materialAllergies', 'diabetesType',
      'heartCondition', 'thyroidType', 'hepatitisType', 'otherConditions',
      'currentMedications', 'previousDentalWork', 'familyDentalHistory',
      'additionalNotes',
    ] as const
    const HISTORY_ENUMS: Record<string, string[]> = {
      smokingStatus: ['NEVER', 'FORMER', 'CURRENT', 'OCCASIONAL'],
      alcoholConsumption: ['NEVER', 'OCCASIONAL', 'MODERATE', 'HEAVY'],
    }
    const cap = (v: unknown) =>
      typeof v === 'string' ? v.trim().slice(0, 2000) || null : null
    const sanitizedHistory: Record<string, unknown> = {}
    if (medicalHistory && typeof medicalHistory === 'object') {
      const raw = medicalHistory as Record<string, unknown>
      for (const k of HISTORY_BOOLEANS) if (raw[k] === true || raw[k] === 'true') sanitizedHistory[k] = true
      for (const k of HISTORY_STRINGS) if (raw[k] !== undefined) sanitizedHistory[k] = cap(raw[k])
      for (const [k, allowed] of Object.entries(HISTORY_ENUMS)) {
        if (typeof raw[k] === 'string' && (allowed as string[]).includes(raw[k] as string))
          sanitizedHistory[k] = raw[k]
      }
      for (const k of ['pregnancyWeeks', 'dentalAnxietyLevel'] as const) {
        const n = Number(raw[k])
        if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '' && Number.isInteger(n) && n >= 0)
          sanitizedHistory[k] = n
      }
      if (typeof raw.lastDentalVisit === 'string' && raw.lastDentalVisit) {
        const d = new Date(raw.lastDentalVisit)
        if (!isNaN(d.getTime())) sanitizedHistory.lastDentalVisit = d
      }
    }

    // Validate required fields
    if (!firstName || !lastName || !phone) {
      return NextResponse.json(
        { error: 'الاسم الأول واسم العائلة ورقم الهاتف مطلوبة' },
        { status: 400 }
      )
    }

    // Check for duplicate phone within this hospital
    const existingPatient = await prisma.patient.findFirst({
      where: { hospitalId, phone },
    })

    if (existingPatient) {
      return NextResponse.json(
        { error: 'يوجد مريض مسجل بنفس رقم الهاتف' },
        { status: 409 }
      )
    }

    // Generate patient ID for this hospital
    const patientId = await generatePatientId(hospitalId)

    // Create patient with medical history
    const patient = await prisma.patient.create({
      data: {
        patientId,
        firstName,
        lastName,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        age,
        gender,
        bloodGroup,
        phone,
        alternatePhone,
        email,
        address,
        city,
        state,
        pincode,
        aadharNumber,
        occupation,
        referredBy,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelation,
        hospitalId,
        medicalHistory: Object.keys(sanitizedHistory).length
          ? {
              create: sanitizedHistory,
            }
          : undefined,
      },
      include: {
        medicalHistory: true,
      },
    })

    return NextResponse.json(patient, { status: 201 })
  } catch (error) {
    console.error('Error creating patient:', error)
    return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 })
  }
}

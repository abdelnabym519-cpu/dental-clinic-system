import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { isValidFdi } from '@/lib/dental-chart/fdi'

// GET - Get dental chart entries for a patient
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')
    const toothNumber = searchParams.get('toothNumber')
    const condition = searchParams.get('condition')
    const isActive = searchParams.get('isActive')

    if (!patientId) {
      return NextResponse.json({ error: 'Patient ID is required' }, { status: 400 })
    }

    // Verify patient belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Build where clause
    const where: any = {
      patientId,
      hospitalId,
    }

    if (toothNumber) {
      where.toothNumber = parseInt(toothNumber)
    }

    if (condition) {
      where.condition = condition
    }

    // Filter by resolved status if provided
    if (isActive !== null && isActive !== '') {
      if (isActive === 'true') {
        // Active = not resolved (no resolvedDate)
        where.resolvedDate = null
      } else {
        // Inactive = resolved (has resolvedDate)
        where.resolvedDate = { not: null }
      }
    }

    const entries = await prisma.dentalChartEntry.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [{ toothNumber: 'asc' }, { diagnosedDate: 'desc' }],
    })

    // Group entries by tooth number for easier consumption
    const chartData: Record<number, any[]> = {}
    entries.forEach((entry) => {
      if (!chartData[entry.toothNumber]) {
        chartData[entry.toothNumber] = []
      }
      chartData[entry.toothNumber].push(entry)
    })

    return NextResponse.json({
      entries,
      chartData,
      patientId,
    })
  } catch (error) {
    console.error('Error fetching dental chart:', error)
    return NextResponse.json({ error: 'Failed to fetch dental chart' }, { status: 500 })
  }
}

// POST - Create new dental chart entry
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Check if user has permission
    if (!['ADMIN', 'DOCTOR'].includes(session?.user?.role || '')) {
      return NextResponse.json({ error: 'لا تملك صلاحية تعديل المخطط السني' }, { status: 403 })
    }

    const body = await request.json()
    const {
      patientId,
      toothNumber,
      condition,
      severity,
      mesial,
      distal,
      occlusal,
      buccal,
      lingual,
      notes,
      toothNotation,
    } = body

    // Validate required fields
    if (!patientId || !toothNumber || !condition) {
      return NextResponse.json(
        { error: 'Patient ID, tooth number, and condition are required' },
        { status: 400 }
      )
    }

    // Validate against the SINGLE canonical FDI rule set in
    // lib/dental-chart/fdi.ts: all 52 identifiers - 32 permanent (11-48) plus
    // the 20 primary/deciduous teeth (51-85). A literal array here is what
    // silently locked primary teeth out of this API.
    // isValidFdi takes `unknown`, so a numeric string ('51'), a float, a
    // boolean, null and undefined are rejected without any coercion.
    if (!isValidFdi(toothNumber)) {
      return NextResponse.json(
        {
          error:
            'رقم السن غير صالح. استخدم ترقيم FDI (الدائم 11-48، واللبني 51-85)',
        },
        { status: 400 },
      )
    }

    // Check if patient exists and belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // MISSING/EXTRACTION auto-resolve + the new entry MUST be atomic:
    // a failure between "resolve the old findings" and "create the new one"
    // would leave the tooth silently healed/missing with the new finding
    // lost (a clinical-coherence violation). One transaction, or neither.
    const entry = await prisma.$transaction(async (tx) => {
      if (['MISSING', 'EXTRACTION'].includes(condition)) {
        await tx.dentalChartEntry.updateMany({
          where: {
            patientId,
            hospitalId,
            toothNumber,
            resolvedDate: null,
          },
          data: {
            resolvedDate: new Date(),
          },
        })
      }

      // Create new entry
      return tx.dentalChartEntry.create({
        data: {
          hospitalId,
          patientId,
          toothNumber,
          toothNotation: toothNotation || String(toothNumber),
          condition,
          severity: severity || 'MILD',
          mesial: mesial || false,
          distal: distal || false,
          occlusal: occlusal || false,
          buccal: buccal || false,
          lingual: lingual || false,
          notes: notes || null,
          diagnosedDate: new Date(),
        },
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      })
    })

    // Audit trail (master spec Stage K) — clinical mutations are always
    // audited with actor, tenant, patient, tooth and the recorded change.
    await prisma.auditLog.create({
      data: {
        hospitalId,
        userId: session?.user?.id,
        action: 'DENTAL_FINDING_ADDED',
        entityType: 'DentalChartEntry',
        entityId: entry.id,
        newValues: JSON.stringify({
          patientId,
          toothNumber,
          condition,
          severity: severity || 'MILD',
          mesial: mesial || false,
          distal: distal || false,
          occlusal: occlusal || false,
          buccal: buccal || false,
          lingual: lingual || false,
        }),
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    console.error('Error creating dental chart entry:', error)
    return NextResponse.json({ error: 'Failed to create dental chart entry' }, { status: 500 })
  }
}

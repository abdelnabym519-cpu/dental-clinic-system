import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import {
  clinicInfoSchema,
  clinicValidationMessage,
  CLINIC_LOAD_ERROR,
  CLINIC_SAVE_ERROR,
} from '@/lib/clinic-settings-validation'

// GET /api/settings/clinic - Get clinic information
export async function GET(_req: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const clinicInfo = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        id: true,
        name: true,
        tagline: true,
        logo: true,
        phone: true,
        alternatePhone: true,
        email: true,
        website: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        registrationNo: true,
        gstNumber: true,
        panNumber: true,
        workingHours: true,
        bankName: true,
        bankAccountNo: true,
        bankIfsc: true,
        upiId: true,
        slug: true,
        patientPortalEnabled: true,
      },
    })

    return NextResponse.json({ success: true, data: clinicInfo })
  } catch (error) {
    console.error('Get clinic info error:', error)
    return NextResponse.json({ success: false, error: CLINIC_LOAD_ERROR }, { status: 500 })
  }
}

// POST /api/settings/clinic - Create or update clinic information
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, code: 'INVALID_JSON', error: 'تعذر قراءة البيانات المدخلة.' },
      { status: 400 }
    )
  }

  const parsed = clinicInfoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        code: 'VALIDATION_ERROR',
        error: clinicValidationMessage(parsed.error),
      },
      { status: 400 }
    )
  }

  try {
    const clinicInfo = await prisma.hospital.update({
      where: { id: hospitalId },
      data: parsed.data,
    })

    return NextResponse.json({
      success: true,
      data: clinicInfo,
      message: 'تم حفظ بيانات العيادة بنجاح.',
    })
  } catch (error) {
    console.error('Update clinic info error:', error)
    return NextResponse.json(
      { success: false, error: CLINIC_SAVE_ERROR, code: 'SAVE_FAILED' },
      { status: 500 }
    )
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import {
  clinicPincodeSchema,
  clinicValidationMessage,
  optionalClinicPhoneSchema,
  optionalWebsiteSchema,
} from '@/lib/clinic-settings-validation'

const onboardingSchema = z.object({
  // Step 1: Clinic Details
  tagline: z.string().optional(),
  address: z.string().trim().min(1, 'عنوان العيادة مطلوب.'),
  city: z.string().trim().min(1, 'المدينة مطلوبة.'),
  state: z.string().trim().min(1, 'المحافظة مطلوبة.'),
  pincode: clinicPincodeSchema,
  alternatePhone: optionalClinicPhoneSchema,
  website: optionalWebsiteSchema,

  // Step 2: Business Details
  gstNumber: z.string().optional(),
  registrationNo: z.string().optional(),

  // Step 3: Working Hours
  workingHours: z.string().optional(), // JSON string

  // Step 4: Payment Details
  upiId: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankAccountName: z.string().optional(),
})

export async function POST(request: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole(['ADMIN'])

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only hospital admin can complete onboarding
  if (!user?.isHospitalAdmin) {
    return NextResponse.json({ error: 'يُسمح لمسؤول العيادة فقط بإكمال الإعداد.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, code: 'INVALID_JSON', error: 'تعذر قراءة البيانات المدخلة.' },
      { status: 400 }
    )
  }

  const validated = onboardingSchema.safeParse(body)
  if (!validated.success) {
    return NextResponse.json(
      {
        success: false,
        code: 'VALIDATION_ERROR',
        error: clinicValidationMessage(validated.error),
      },
      { status: 400 }
    )
  }

  const data = validated.data
  try {
    // Update hospital with onboarding data
    const hospital = await prisma.hospital.update({
      where: { id: hospitalId },
      data: {
        tagline: data.tagline,
        address: data.address,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        alternatePhone: data.alternatePhone,
        website: data.website,
        gstNumber: data.gstNumber,
        registrationNo: data.registrationNo,
        workingHours: data.workingHours,
        upiId: data.upiId,
        bankName: data.bankName,
        bankAccountNo: data.bankAccountNo,
        bankIfsc: data.bankIfsc,
        bankAccountName: data.bankAccountName,
        onboardingCompleted: true,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'اكتمل إعداد العيادة بنجاح.',
      hospital: {
        id: hospital.id,
        name: hospital.name,
        slug: hospital.slug,
      },
    })
  } catch (error) {
    console.error('Onboarding error:', error)
    return NextResponse.json(
      {
        success: false,
        code: 'ONBOARDING_FAILED',
        error: 'تعذر إكمال إعداد العيادة. حاول مرة أخرى.',
      },
      { status: 500 }
    )
  }
}

// GET current onboarding status
export async function GET() {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        tagline: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        alternatePhone: true,
        website: true,
        gstNumber: true,
        registrationNo: true,
        workingHours: true,
        upiId: true,
        bankName: true,
        bankAccountNo: true,
        bankIfsc: true,
        bankAccountName: true,
        onboardingCompleted: true,
        plan: true,
      },
    })

    if (!hospital) {
      return NextResponse.json({ error: 'بيانات العيادة غير متاحة.' }, { status: 404 })
    }

    return NextResponse.json(hospital)
  } catch (error) {
    console.error('Get onboarding status error:', error)
    return NextResponse.json(
      { error: 'تعذر تحميل بيانات العيادة. حاول مرة أخرى.' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { isValidEgyptianClinicPhone } from '@/lib/services/sms.service'

const optionalString = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().optional()
)

const clinicInfoSchema = z.object({
  name: z.string().min(1),
  tagline: optionalString,
  logo: optionalString,
  // Issue 3 — the clinic phone follows the ONE canonical Egyptian numbering
  // rule shared with the SMS/WhatsApp gateway (mobile 01[0125]… or landline
  // 02…); whitespace-only or alphabetic junk can no longer be saved, and the
  // message is Arabic instead of a bare min(10) Zod output.
  phone: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z.string().refine(isValidEgyptianClinicPhone, {
      message: 'يرجى إدخال رقم هاتف صحيح (رقم مصري مثل 01xxxxxxxxx أو رقم أرضي).',
    })
  ),
  alternatePhone: optionalString,
  email: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().email().optional()
  ),
  website: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    // Issue 3 — enforcement now MATCHES the canonical Arabic message the
    // product has always shown: a real URL starting with https:// (empty /
    // whitespace-only stays optional and is accepted).
    z
      .string()
      .url({ message: 'رابط الموقع غير صحيح — يجب أن يبدأ بـ https://' })
      .refine((v) => v.startsWith('https://'), {
        message: 'رابط الموقع غير صحيح — يجب أن يبدأ بـ https://',
      })
      .optional()
  ),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  // Issue 3 — PIN code: 6–8 DIGITS only, with Arabic messages (was a bare
  // min(6) whose raw English/Zod JSON reached the user's toast).
  pincode: z
    .string()
    .regex(/^\d{6,8}$/, 'الرمز السري يجب أن يكون من 6 إلى 8 أرقام فقط'),
  registrationNo: optionalString,
  gstNumber: optionalString,
  panNumber: optionalString,
  workingHours: optionalString,
  bankName: optionalString,
  bankAccountNo: optionalString,
  bankIfsc: optionalString,
  upiId: optionalString,
  patientPortalEnabled: z.boolean().optional(),
})

// GET /api/settings/clinic - Get clinic information
export async function GET(req: NextRequest) {
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

    if (!clinicInfo) {
      // Return default structure if not found
      return NextResponse.json({
        success: true,
        data: null,
      })
    }

    return NextResponse.json({
      success: true,
      data: clinicInfo,
    })
  } catch (error: any) {
    console.error('Get clinic info error:', error)
    // Issue 3 — internal/Prisma error text must never reach the client.
    return NextResponse.json({ error: 'تعذر تحميل بيانات العيادة' }, { status: 500 })
  }
}

// POST /api/settings/clinic - Create or update clinic information
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = clinicInfoSchema.parse(body)

    const clinicInfo = await prisma.hospital.update({
      where: { id: hospitalId },
      data,
    })

    return NextResponse.json({
      success: true,
      data: clinicInfo,
      message: 'Clinic information saved successfully',
    })
  } catch (error: any) {
    console.error('Update clinic info error:', error)

    // Issue 3 — validation failures are a 400 with a FRIENDLY ARABIC
    // message, never the raw Zod JSON array the user used to see in the
    // toast. Each issue maps to plain Arabic; unexpected errors keep the
    // generic message.
    if (error?.name === 'ZodError' && Array.isArray(error.issues)) {
      const AR_FIELD_NAMES: Record<string, string> = {
        name: 'اسم العيادة',
        phone: 'رقم الهاتف',
        alternatePhone: 'رقم الهاتف البديل',
        email: 'البريد الإلكتروني',
        website: 'رابط الموقع',
        address: 'العنوان',
        city: 'المدينة',
        state: 'المحافظة',
        pincode: 'الرمز السري',
        registrationNo: 'رقم التسجيل',
        gstNumber: 'الرقم الضريبي',
        panNumber: 'رقم PAN',
      }
      const friendly = error.issues.map((issue: any) => {
        const field = AR_FIELD_NAMES[issue.path?.[0]] ?? ''
        if (typeof issue.message === 'string' && /[\u0600-\u06FF]/.test(issue.message)) return issue.message
        if (issue.code === 'invalid_format' && issue.format === 'url') return `${field || 'رابط الموقع'} غير صحيح — يجب أن يبدأ بـ https://`
        if (issue.code === 'too_small') return `${field || 'القيمة'} قصيرة جدًا — الحد الأدنى ${issue.minimum}`
        if (issue.code === 'invalid_string') return `${field || 'القيمة'} غير صحيحة`
        if (issue.code === 'invalid_type') return `${field || 'الحقل'} مطلوب`
        return `${field ? field + ': ' : ''}القيمة غير صحيحة`
      })
      return NextResponse.json({ error: friendly.join('؛ ') }, { status: 400 })
    }

    // Issue 3 — Prisma/database/internal failures are normalized to one safe
    // Arabic line; the raw exception text is only logged server-side.
    return NextResponse.json(
      { error: 'تعذر حفظ بيانات العيادة. حاول مرة أخرى.' },
      { status: 500 }
    )
  }
}

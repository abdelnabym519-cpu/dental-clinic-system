import { z } from 'zod'
import { normalizeClinicPhone } from '@/lib/phone'

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value?.trim() === '' ? undefined : value))

const emailSchema = z
  .string()
  .optional()
  .transform((value) => (value?.trim() === '' ? undefined : value))
  .pipe(z.string().email('يرجى إدخال بريد إلكتروني صحيح.').optional())

function isHttpWebsite(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Optional website: blank input is allowed; non-blank input must be a web URL. */
export const optionalWebsiteSchema = z
  .string()
  .optional()
  .transform((value) => (value?.trim() === '' ? undefined : value))
  .pipe(
    z
      .string()
      .refine(isHttpWebsite, 'رابط الموقع غير صحيح. أدخل عنوانًا يبدأ بـ http:// أو https://.')
      .optional()
  )

/** Shared required postal-code rule for clinic settings and onboarding. */
export const clinicPincodeSchema = z
  .string({ error: 'الرمز البريدي مطلوب.' })
  .min(1, 'الرمز البريدي مطلوب.')
  .regex(/^\d{6,8}$/, 'يجب أن يتكون الرمز البريدي من 6 إلى 8 أرقام فقط.')

/** Required clinic contact number; accepts local formatting and E.164. */
export const clinicPhoneSchema = z
  .string({ error: 'رقم هاتف العيادة مطلوب.' })
  .min(1, 'رقم هاتف العيادة مطلوب.')
  .refine((value) => value.trim().length > 0, 'رقم هاتف العيادة مطلوب.')
  .refine(
    (value) => value.trim().length === 0 || normalizeClinicPhone(value) !== null,
    'يرجى إدخال رقم هاتف عيادة صحيح.'
  )

/** Optional alternate contact; whitespace is treated as blank. */
export const optionalClinicPhoneSchema = z
  .string()
  .optional()
  .transform((value) => (value?.trim() === '' ? undefined : value))
  .pipe(
    z
      .string()
      .refine((value) => normalizeClinicPhone(value) !== null, 'يرجى إدخال رقم هاتف بديل صحيح.')
      .optional()
  )

export const clinicInfoSchema = z.object({
  name: z.string().min(1, 'اسم العيادة مطلوب.'),
  tagline: optionalText,
  logo: optionalText,
  phone: clinicPhoneSchema,
  alternatePhone: optionalClinicPhoneSchema,
  email: emailSchema,
  website: optionalWebsiteSchema,
  address: z.string().min(1, 'عنوان العيادة مطلوب.'),
  city: z.string().min(1, 'المدينة مطلوبة.'),
  state: z.string().min(1, 'المحافظة مطلوبة.'),
  pincode: clinicPincodeSchema,
  registrationNo: optionalText,
  gstNumber: optionalText,
  panNumber: optionalText,
  workingHours: optionalText,
  bankName: optionalText,
  bankAccountNo: optionalText,
  bankIfsc: optionalText,
  upiId: optionalText,
  patientPortalEnabled: z.boolean().optional(),
})

const FIELD_MESSAGES: Record<string, string> = {
  name: 'اسم العيادة مطلوب أو غير صحيح.',
  phone: 'يرجى إدخال رقم هاتف عيادة صحيح.',
  alternatePhone: 'يرجى إدخال رقم هاتف بديل صحيح.',
  email: 'يرجى إدخال بريد إلكتروني صحيح.',
  website: 'يرجى إدخال رابط موقع صحيح يبدأ بـ http:// أو https://.',
  address: 'عنوان العيادة مطلوب.',
  city: 'المدينة مطلوبة.',
  state: 'المحافظة مطلوبة.',
  pincode: 'يجب أن يتكون الرمز البريدي من 6 إلى 8 أرقام فقط.',
  registrationNo: 'رقم التسجيل غير صحيح.',
  gstNumber: 'الرقم الضريبي غير صحيح.',
  panNumber: 'رقم PAN غير صحيح.',
}

/**
 * Return only short, user-facing Arabic messages from a Zod failure. Never
 * serialize issues or forward Zod's internal/default English diagnostics.
 */
export function clinicValidationMessages(error: z.ZodError): string[] {
  const messages = error.issues.map((issue) => {
    if (/[\u0600-\u06FF]/.test(issue.message)) return issue.message

    const field = String(issue.path[0] ?? '')
    if (field === 'pincode') {
      return issue.code === 'invalid_type' ? 'الرمز البريدي مطلوب.' : FIELD_MESSAGES.pincode
    }
    if (field === 'phone') {
      return issue.code === 'too_small' ? 'رقم هاتف العيادة مطلوب.' : FIELD_MESSAGES.phone
    }
    if (FIELD_MESSAGES[field]) return FIELD_MESSAGES[field]
    if (field === 'tagline' || field === 'logo' || field === 'workingHours') {
      return 'يرجى مراجعة البيانات المدخلة.'
    }
    return 'يرجى مراجعة البيانات المدخلة.'
  })

  return [...new Set(messages)]
}

export function clinicValidationMessage(error: z.ZodError): string {
  return clinicValidationMessages(error).join(' ')
}

/** Safe Arabic fallbacks for loading and saving failures. */
export const CLINIC_LOAD_ERROR = 'تعذر تحميل بيانات العيادة.'
export const CLINIC_SAVE_ERROR = 'تعذر حفظ بيانات العيادة. حاول مرة أخرى.'

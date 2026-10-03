import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { smsService } from '@/lib/services/sms.service'
import { emailService } from '@/lib/services/email.service'
import { prisma } from '@/lib/prisma'
import { normalizeClinicPhone } from '@/lib/phone'
import { getWhatsAppProvider } from '@/lib/messaging/factory'

async function testWhatsAppForClinic(hospitalId: string): Promise<NextResponse> {
  try {
    const clinic = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { phone: true },
    })

    if (!clinic) {
      return NextResponse.json(
        { success: false, code: 'CLINIC_NOT_FOUND', error: 'بيانات العيادة غير متاحة.' },
        { status: 404 }
      )
    }

    if (typeof clinic.phone !== 'string' || !clinic.phone.trim()) {
      return NextResponse.json(
        {
          success: false,
          code: 'CLINIC_PHONE_MISSING',
          error: 'لم يتم حفظ رقم هاتف للعيادة. أضف رقمًا صحيحًا واحفظه أولًا.',
        },
        { status: 400 }
      )
    }

    const phone = normalizeClinicPhone(clinic.phone)
    if (!phone) {
      return NextResponse.json(
        {
          success: false,
          code: 'CLINIC_PHONE_INVALID',
          error: 'رقم هاتف العيادة المحفوظ غير صالح. حدّثه واحفظ رقمًا صحيحًا.',
        },
        { status: 400 }
      )
    }

    const provider = getWhatsAppProvider()
    // Mock providers deliberately report success without contacting WhatsApp;
    // never let that simulated result appear as a verified provider test.
    if (provider.channel !== 'WHATSAPP' || provider.name.toLowerCase().startsWith('mock-')) {
      return NextResponse.json(
        {
          success: false,
          code: 'PROVIDER_UNAVAILABLE',
          error: 'خدمة واتساب غير متاحة حاليًا. تحقق من إعداد المزود أو حاول لاحقًا.',
        },
        { status: 503 }
      )
    }

    const result = await provider.sendMessage(phone, {
      text: 'هذه رسالة اختبار من إعدادات العيادة.',
    })

    if (!result.success) {
      console.warn('WhatsApp clinic test was not accepted', {
        provider: provider.name,
        errorCode: result.errorCode,
      })
      const recipientUnavailable = result.errorCode === 131026
      return NextResponse.json(
        {
          success: false,
          code: recipientUnavailable ? 'CLINIC_PHONE_NOT_ON_WHATSAPP' : 'PROVIDER_UNAVAILABLE',
          error: recipientUnavailable
            ? 'رقم الهاتف المحفوظ غير مسجل على واتساب أو لا يستقبل الرسائل.'
            : 'خدمة واتساب غير متاحة حاليًا. تحقق من إعداد المزود أو حاول لاحقًا.',
        },
        { status: recipientUnavailable ? 400 : 503 }
      )
    }

    return NextResponse.json({
      success: true,
      code: 'PROVIDER_ACCEPTED',
      message: 'قبل مزود واتساب طلب الاختبار؛ ولا يؤكد ذلك وصول الرسالة إلى الهاتف.',
    })
  } catch (error) {
    console.error('WhatsApp clinic test failed:', error)
    return NextResponse.json(
      {
        success: false,
        code: 'PROVIDER_UNAVAILABLE',
        error: 'خدمة واتساب غير متاحة حاليًا. حاول مرة أخرى لاحقًا.',
      },
      { status: 503 }
    )
  }
}

// POST - Test SMS, email, or the authenticated clinic's saved WhatsApp number
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { type, testData } = body

    if (!type) {
      return NextResponse.json({ error: 'Type is required' }, { status: 400 })
    }

    if (type !== 'sms' && type !== 'email' && type !== 'whatsapp') {
      return NextResponse.json(
        { error: "Type must be 'sms', 'email', or 'whatsapp'" },
        { status: 400 }
      )
    }

    if (type === 'whatsapp') {
      // The recipient is always loaded from this authenticated tenant's
      // persisted Hospital.phone. Client-supplied testData is intentionally ignored.
      return testWhatsAppForClinic(hospitalId)
    }

    // Test SMS connection
    if (type === 'sms') {
      if (!testData?.phone) {
        return NextResponse.json(
          { error: 'Phone number is required for SMS test' },
          { status: 400 }
        )
      }

      try {
        // Initialize SMS service with current settings
        await smsService.initialize()

        // Send test SMS
        const testMessage =
          testData.message ||
          'This is a test message from Dentora. Your SMS gateway is configured correctly.'

        await smsService.sendSMS({
          phone: testData.phone,
          message: testMessage,
        })

        return NextResponse.json({
          success: true,
          message: 'Test SMS sent successfully',
          details: `SMS sent to ${testData.phone}`,
        })
      } catch (error: any) {
        console.error('SMS test failed:', error)
        return NextResponse.json(
          {
            success: false,
            error: 'تعذر إرسال رسالة الاختبار عبر SMS. تحقق من الإعدادات وحاول مرة أخرى.',
          },
          { status: 400 }
        )
      }
    }

    // Test Email connection
    if (type === 'email') {
      if (!testData?.email) {
        return NextResponse.json(
          { error: 'Email address is required for email test' },
          { status: 400 }
        )
      }

      try {
        // Initialize email service with current settings
        await emailService.initialize()

        // Send test email
        const testSubject = testData.subject || 'Test Email from Dentora'

        const testBody =
          testData.body ||
          `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Email Configuration Test</h2>
            <p>Hello,</p>
            <p>This is a test email from Dentora.</p>
            <p>If you're receiving this email, your SMTP settings are configured correctly.</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              Sent from Dental Hospital Management System<br>
              Dentora
            </p>
          </div>
        `

        await emailService.sendEmail({
          to: testData.email,
          subject: testSubject,
          body: testBody,
        })

        return NextResponse.json({
          success: true,
          message: 'Test email sent successfully',
          details: `Email sent to ${testData.email}`,
        })
      } catch (error: any) {
        console.error('Email test failed:', error)
        return NextResponse.json(
          {
            success: false,
            error:
              'تعذر إرسال رسالة الاختبار عبر البريد الإلكتروني. تحقق من الإعدادات وحاول مرة أخرى.',
          },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error: any) {
    console.error('Error testing communication settings:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'تعذر اختبار إعدادات الاتصال. حاول مرة أخرى.',
      },
      { status: 500 }
    )
  }
}

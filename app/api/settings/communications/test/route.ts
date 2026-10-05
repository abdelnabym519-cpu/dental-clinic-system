import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { smsService, isValidEgyptianPhoneNumber } from '@/lib/services/sms.service'
import { emailService } from '@/lib/services/email.service'

// Issue 3 — configuration failures of the SMS/WhatsApp gateway are a distinct,
// understandable category for the user (settings incomplete), never a raw
// provider/stack message.
function isGatewayConfigurationError(err: any): boolean {
  const msg = typeof err?.message === 'string' ? err.message : ''
  return (
    msg.includes('not configured') ||
    msg.includes('SMS API key') ||
    msg.includes('gateway') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT')
  )
}

const MSG_CONFIG_UNAVAILABLE = 'إعدادات واتساب غير مكتملة أو غير متاحة حاليًا.'
const MSG_TEST_SEND_FAILED = 'تعذر إرسال رسالة الاختبار. حاول مرة أخرى.'

// POST - Test SMS or email connection
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

    if (type !== 'sms' && type !== 'email') {
      return NextResponse.json({ error: "Type must be 'sms' or 'email'" }, { status: 400 })
    }

    // Test SMS connection
    if (type === 'sms') {
      if (!testData?.phone || String(testData.phone).trim() === '') {
        return NextResponse.json(
          { error: 'يرجى إدخال رقم هاتف للاختبار.' },
          { status: 400 }
        )
      }

      // Issue 3 — validate with the SAME canonical Egyptian rule the gateway
      // itself enforces, BEFORE initialize(), and answer in Arabic so the
      // user can tell an invalid number apart from a misconfigured gateway.
      if (!isValidEgyptianPhoneNumber(String(testData.phone))) {
        return NextResponse.json(
          { error: 'يرجى إدخال رقم هاتف صحيح (موبايل مصري مثل 01xxxxxxxxx).' },
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
        const safeError =
          error?.message === 'Invalid phone number format'
            ? 'يرجى إدخال رقم هاتف صحيح (موبايل مصري مثل 01xxxxxxxxx).'
            : isGatewayConfigurationError(error)
              ? MSG_CONFIG_UNAVAILABLE
              : MSG_TEST_SEND_FAILED
        return NextResponse.json(
          {
            success: false,
            error: safeError,
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
            error: isGatewayConfigurationError(error)
              ? MSG_CONFIG_UNAVAILABLE
              : MSG_TEST_SEND_FAILED,
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
        error: 'Failed to test communication settings',
        details: error.message,
      },
      { status: 500 }
    )
  }
}

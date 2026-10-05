// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// ---------------------------------------------------------------------------
// Issue 3 — WhatsApp/SMS test endpoint error safety.
// The test action used to echo `details: error.message` (raw provider/stack
// output) and English messages for missing input. Contract now:
//   • missing phone      → 400 Arabic
//   • invalid phone      → 400 Arabic (canonical Egyptian rule, pre-validated)
//   • gateway not configured → 400 Arabic configuration message
//   • provider failure   → 400 Arabic generic — NEVER the raw error text
//   • success            → success:true + safe details
// ---------------------------------------------------------------------------

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
const { mockSmsService, mockEmailService } = vi.hoisted(() => ({
  mockSmsService: {
    initialize: vi.fn(),
    sendSMS: vi.fn(),
  },
  mockEmailService: {
    initialize: vi.fn(),
    sendEmail: vi.fn(),
  },
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/services/sms.service', () => ({
  smsService: mockSmsService,
  isValidEgyptianPhoneNumber: (phone: string) => /^01[0125]\d{8}$/.test(String(phone)),
}))
vi.mock('@/lib/services/email.service', () => ({
  emailService: mockEmailService,
}))

import { POST } from '@/app/api/settings/communications/test/route'

function post(body: unknown) {
  return new Request('http://localhost/api/settings/communications/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe('POST /api/settings/communications/test — Issue 3 error safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
  })

  it('T1: missing phone → 400 Arabic, asks for the number', async () => {
    const res = await POST(post({ type: 'sms', testData: {} }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('يرجى إدخال رقم هاتف')
    expect(data.error).toMatch(/[\u0600-\u06FF]/)
  })

  it('T2: invalid phone → 400 Arabic from the canonical Egyptian rule', async () => {
    const res = await POST(post({ type: 'sms', testData: { phone: '12345' } }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('رقم هاتف صحيح')
    // the gateway was never invoked for an invalid number
    expect(mockSmsService.sendSMS).not.toHaveBeenCalled()
  })

  it('T3: gateway not configured → the distinct Arabic configuration message, no details leak', async () => {
    mockSmsService.initialize.mockRejectedValue(new Error('SMS gateway not configured'))
    const res = await POST(post({ type: 'sms', testData: { phone: '01012345678' } }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain('إعدادات واتساب غير مكتملة')
    expect(data).not.toHaveProperty('details')
    expect(data.error).not.toContain('not configured')
  })

  it('T4: provider/network failure → safe Arabic generic, raw provider text never escapes', async () => {
    mockSmsService.initialize.mockResolvedValue(undefined)
    mockSmsService.sendSMS.mockRejectedValue(
      new Error('Twilio HTTP 502: upstream relay denied msisdn +20100…')
    )
    const res = await POST(post({ type: 'sms', testData: { phone: '01012345678' } }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('تعذر إرسال رسالة الاختبار')
    expect(data).not.toHaveProperty('details')
    expect(data.error).not.toContain('Twilio')
    expect(data.error).not.toContain('502')
    expect(data.error).not.toContain('msisdn')
  })

  it('T5: no stack trace can reach the client on any failure path', async () => {
    mockSmsService.initialize.mockRejectedValue(
      new Error('kaboom\n    at SMSService.initialize (/app/lib/services/sms.service.ts:26:19)')
    )
    const res = await POST(post({ type: 'sms', testData: { phone: '01012345678' } }))
    const data = await res.json()
    expect(JSON.stringify(data)).not.toContain('at SMSService')
    expect(JSON.stringify(data)).not.toContain('node_modules')
  })

  it('T6: success path still returns success:true with a safe details echo', async () => {
    mockSmsService.initialize.mockResolvedValue(undefined)
    mockSmsService.sendSMS.mockResolvedValue('log-id-1')
    const res = await POST(post({ type: 'sms', testData: { phone: '01012345678' } }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.details).toContain('01012345678')
    expect(mockSmsService.sendSMS).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '01012345678' })
    )
  })

  it('T7: ADMIN authorization remains enforced', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      hospitalId: null,
    })
    const res = await POST(post({ type: 'sms', testData: { phone: '01012345678' } }))
    expect(res.status).toBe(401)
  })

  it('T8: invalid type contract unchanged', async () => {
    const res = await POST(post({ type: 'fax', testData: {} }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain("'sms' or 'email'")
  })
})

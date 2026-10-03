// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

import { GET, POST } from '@/app/api/settings/clinic/route'

function request(method: string, body?: unknown) {
  const content = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return new Request('http://localhost/api/settings/clinic', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: content } : {}),
  }) as never
}

const validClinic = {
  name: 'عيادة النيل لطب الأسنان',
  phone: '01012345678',
  address: '15 شارع التحرير',
  city: 'القاهرة',
  state: 'القاهرة',
  pincode: '115135',
}

const storedClinic = {
  id: 'h1',
  ...validClinic,
  website: 'https://dentora.example',
  email: 'clinic@example.com',
  bankName: 'National Bank of Egypt',
  bankAccountNo: '1234567890',
  bankIfsc: 'NBEGEGCX',
  upiId: 'clinic@instapay',
  patientPortalEnabled: true,
}

function expectSafeArabic(body: any) {
  expect(typeof body.error).toBe('string')
  expect(body.error).toMatch(/[\u0600-\u06FF]/)
  expect(body.error).not.toMatch(/^\s*[\[{]/)
  expect(JSON.stringify(body)).not.toMatch(/ZodError|PrismaClient|stack trace|expected.*received/i)
}

describe('Clinic settings API — Issue 3 validation, persistence, and safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: null, hospitalId: 'h1' })
    prisma.hospital.update.mockResolvedValue(storedClinic as any)
    prisma.hospital.findUnique.mockResolvedValue(storedClinic as any)
  })

  describe('website validation', () => {
    it('allows a blank website', async () => {
      const res = await POST(request('POST', { ...validClinic, website: '' }))
      expect(res.status).toBe(200)
      expect(prisma.hospital.update).toHaveBeenCalledTimes(1)
    })

    it('allows whitespace-only website when optional', async () => {
      const res = await POST(request('POST', { ...validClinic, website: '  \t  ' }))
      expect(res.status).toBe(200)
    })

    it.each([
      'http://localhost:3000/clinic',
      'http://clinic',
      'http://192.168.1.12',
      'https://dentora.example',
    ])('accepts an absolute HTTP(S) website URL: %s', async (website) => {
      const res = await POST(request('POST', { ...validClinic, website }))
      expect(res.status).toBe(200)
    })

    it('rejects a non-empty malformed website with accurate Arabic copy', async () => {
      const res = await POST(request('POST', { ...validClinic, website: 'not-a-url' }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expectSafeArabic(body)
      expect(body.error).toContain('رابط الموقع غير صحيح')
      expect(body.error).toContain('http://')
      expect(body.error).not.toContain('يجب أن يبدأ بـ https://')
      expect(prisma.hospital.update).not.toHaveBeenCalled()
    })

    it('does not accept non-web protocols as clinic websites', async () => {
      const res = await POST(
        request('POST', { ...validClinic, website: 'mailto:clinic@example.com' })
      )
      expect(res.status).toBe(400)
    })
  })

  describe('pincode contract', () => {
    it.each(['123456', '12345678'])('accepts %s numeric digits', async (pincode) => {
      const res = await POST(request('POST', { ...validClinic, pincode }))
      expect(res.status).toBe(200)
    })

    it.each(['12345', '123456789', '12a456', '١٢٣٤٥٦'])(
      'rejects invalid pincode %s',
      async (pincode) => {
        const res = await POST(request('POST', { ...validClinic, pincode }))
        expect(res.status).toBe(400)
        const body = await res.json()
        expectSafeArabic(body)
        expect(body.error).toContain('الرمز البريدي')
        expect(body.error).toContain('6 إلى 8 أرقام')
      }
    )

    it('keeps pincode required', async () => {
      const { pincode: _omitted, ...withoutPincode } = validClinic
      const res = await POST(request('POST', withoutPincode))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('الرمز البريدي مطلوب')
    })
  })

  describe('clinic phone validation', () => {
    it.each(['010 1234 5678', '+20 10 1234 5678', '+44 (0)20 7946 0958', '00971 50 123 4567'])(
      'accepts valid formatted or international phone %s',
      async (phone) => {
        const res = await POST(request('POST', { ...validClinic, phone }))
        expect(res.status).toBe(200)
      }
    )

    it.each(['call 01012345678', '012345', '+20', '01012345678 ext 4'])(
      'rejects malformed phone %s in Arabic',
      async (phone) => {
        const res = await POST(request('POST', { ...validClinic, phone }))
        expect(res.status).toBe(400)
        const body = await res.json()
        expectSafeArabic(body)
        expect(body.error).toContain('رقم هاتف عيادة صحيح')
      }
    )

    it('keeps the clinic phone required', async () => {
      const { phone: _omitted, ...withoutPhone } = validClinic
      const res = await POST(request('POST', withoutPhone))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('رقم هاتف العيادة مطلوب')
    })
  })

  describe('save, retrieval, authorization, and tenant isolation', () => {
    it('persists the supplied clinic fields against the authenticated tenant only', async () => {
      const payload = {
        ...validClinic,
        phone: '  +20 10 1234 5678  ',
        website: 'http://clinic',
        alternatePhone: '+971 50 123 4567',
        email: 'clinic@example.com',
        bankName: 'National Bank of Egypt',
        bankAccountNo: '1234567890',
        bankIfsc: 'NBEGEGCX',
        upiId: 'clinic@instapay',
        patientPortalEnabled: true,
        hospitalId: 'attacker-controlled-tenant',
      }
      const res = await POST(request('POST', payload))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(prisma.hospital.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: expect.objectContaining({
          phone: '  +20 10 1234 5678  ',
          pincode: '115135',
          website: 'http://clinic',
          bankName: 'National Bank of Egypt',
          bankAccountNo: '1234567890',
          bankIfsc: 'NBEGEGCX',
          upiId: 'clinic@instapay',
          patientPortalEnabled: true,
        }),
      })
      expect(mockAuth.requireAuthAndRole).toHaveBeenCalledWith(['ADMIN'])
    })

    it('retrieves persisted clinic fields for the authenticated tenant', async () => {
      const res = await GET(request('GET'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toMatchObject({
        id: 'h1',
        phone: validClinic.phone,
        pincode: validClinic.pincode,
        website: storedClinic.website,
      })
      expect(prisma.hospital.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'h1' } })
      )
    })

    it('preserves ADMIN-only write authorization', async () => {
      mockAuth.requireAuthAndRole.mockResolvedValue({
        error: Response.json({ error: 'Forbidden' }, { status: 403 }),
        hospitalId: 'h1',
      })
      const res = await POST(request('POST', validClinic))
      expect(res.status).toBe(403)
      expect(prisma.hospital.update).not.toHaveBeenCalled()
    })
  })

  describe('safe errors', () => {
    it('returns an Arabic validation message, never raw Zod JSON', async () => {
      const res = await POST(
        request('POST', { ...validClinic, website: 'bad url', pincode: '123' })
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expectSafeArabic(body)
      expect(body.error).toContain('رابط الموقع')
      expect(body.error).toContain('الرمز البريدي')
    })

    it('normalizes malformed JSON into safe Arabic feedback', async () => {
      const res = await POST(request('POST', '{'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expectSafeArabic(body)
      expect(body.error).toContain('تعذر قراءة البيانات')
    })

    it('does not expose database errors in the save response', async () => {
      prisma.hospital.update.mockRejectedValue(new Error('PRIVATE_DB_SECRET stack trace'))
      const res = await POST(request('POST', validClinic))
      expect(res.status).toBe(500)
      const body = await res.json()
      expectSafeArabic(body)
      expect(body.error).toContain('تعذر حفظ بيانات العيادة')
      expect(JSON.stringify(body)).not.toContain('PRIVATE_DB_SECRET')
    })

    it('does not expose database errors in the retrieval response', async () => {
      prisma.hospital.findUnique.mockRejectedValue(new Error('PRIVATE_DB_SECRET'))
      const res = await GET(request('GET'))
      expect(res.status).toBe(500)
      const body = await res.json()
      expectSafeArabic(body)
      expect(JSON.stringify(body)).not.toContain('PRIVATE_DB_SECRET')
    })
  })
})

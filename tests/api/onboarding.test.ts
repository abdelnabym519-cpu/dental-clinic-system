// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    hospital: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(),
}))

import { GET, POST } from '@/app/api/onboarding/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function createRequest(body: any) {
  return new Request('http://localhost/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validOnboardingData = {
  address: '123 Main St',
  city: 'Cairo',
  state: 'القاهرة',
  pincode: '115135',
  tagline: 'Best dental clinic',
  gstNumber: '27AAPFU0939F1ZV',
  registrationNo: 'MH/12345',
  workingHours: JSON.stringify({ mon: '9:00-18:00', tue: '9:00-18:00' }),
  upiId: 'clinic@upi',
  bankName: 'National Bank of Egypt',
  bankAccountNo: '1234567890',
  bankIfsc: 'HDFC0001234',
  bankAccountName: 'Dental Clinic',
}

describe('Onboarding API — POST /api/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: null,
      user: { id: 'user-1', email: 'admin@test.com', role: 'ADMIN', isHospitalAdmin: true },
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1' } },
    })
  })

  it('should return 401 for unauthenticated requests', async () => {
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    })

    const res = await POST(createRequest(validOnboardingData))
    expect(res.status).toBe(401)
  })

  it('should return 403 for non-hospital-admin users', async () => {
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: null,
      user: { id: 'user-1', email: 'doc@test.com', role: 'ADMIN', isHospitalAdmin: false },
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1' } },
    })

    const res = await POST(createRequest(validOnboardingData))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('مسؤول العيادة')
  })

  it('should return 400 for missing required fields', async () => {
    const res = await POST(createRequest({ tagline: 'No address' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('عنوان العيادة مطلوب.')
    expect(body.details).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/expected|received|ZodError|Prisma|stack/i)
  })

  it('should return 400 for empty address', async () => {
    const res = await POST(createRequest({ ...validOnboardingData, address: '' }))
    expect(res.status).toBe(400)
  })

  it('should return 400 for short pincode with safe Arabic copy', async () => {
    const res = await POST(createRequest({ ...validOnboardingData, pincode: '123' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('6 إلى 8 أرقام')
    expect(body.details).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/ZodError|expected.*received|Prisma/i)
  })

  it.each(['123456', '12345678'])('accepts onboarding pincode %s', async (pincode) => {
    vi.mocked(prisma.hospital.update).mockResolvedValue({
      id: 'hospital-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
    })
    const res = await POST(createRequest({ ...validOnboardingData, pincode }))
    expect(res.status).toBe(200)
  })

  it('accepts a blank optional website and a valid HTTP URL', async () => {
    vi.mocked(prisma.hospital.update).mockResolvedValue({
      id: 'hospital-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
    })
    const blank = await POST(createRequest({ ...validOnboardingData, website: '   ' }))
    expect(blank.status).toBe(200)
    expect(prisma.hospital.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ website: undefined }) })
    )

    const http = await POST(createRequest({ ...validOnboardingData, website: 'http://localhost' }))
    expect(http.status).toBe(200)
    expect(prisma.hospital.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ website: 'http://localhost' }) })
    )
  })

  it('rejects invalid optional website and alternate phone with Arabic messages', async () => {
    const res = await POST(
      createRequest({
        ...validOnboardingData,
        website: 'not-a-url',
        alternatePhone: 'call 01012345678',
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('رابط الموقع')
    expect(body.error).toContain('رقم هاتف بديل صحيح')
    expect(body.details).toBeUndefined()
  })

  it('should complete onboarding with valid data', async () => {
    vi.mocked(prisma.hospital.update).mockResolvedValue({
      id: 'hospital-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
    })

    const res = await POST(createRequest(validOnboardingData))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.message).toContain('اكتمل إعداد العيادة بنجاح.')
    expect(body.hospital.id).toBe('hospital-1')
  })

  it('should set onboardingCompleted to true', async () => {
    vi.mocked(prisma.hospital.update).mockResolvedValue({
      id: 'hospital-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
    })

    await POST(createRequest(validOnboardingData))

    expect(prisma.hospital.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hospital-1' },
        data: expect.objectContaining({
          onboardingCompleted: true,
          address: '123 Main St',
          city: 'Cairo',
          state: 'القاهرة',
          pincode: '115135',
          gstNumber: '27AAPFU0939F1ZV',
        }),
      })
    )
  })

  it('should accept onboarding with only required fields', async () => {
    vi.mocked(prisma.hospital.update).mockResolvedValue({
      id: 'hospital-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
    })

    const minimalData = {
      address: '123 Main St',
      city: 'Cairo',
      state: 'القاهرة',
      pincode: '115135',
    }

    const res = await POST(createRequest(minimalData))
    expect(res.status).toBe(200)
  })

  it('should return 500 on database error', async () => {
    vi.mocked(prisma.hospital.update).mockRejectedValue(new Error('DB error'))

    const res = await POST(createRequest(validOnboardingData))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('تعذر إكمال إعداد العيادة. حاول مرة أخرى.')
    expect(JSON.stringify(body)).not.toContain('DB error')
  })
})

describe('Onboarding API — GET /api/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: null,
      user: { id: 'user-1', email: 'admin@test.com', role: 'ADMIN' },
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1' } },
    })
  })

  it('should return 401 for unauthenticated requests', async () => {
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    })

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('should return hospital onboarding status', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'hospital-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
      email: 'clinic@test.com',
      phone: '01012345678',
      address: '123 Main St',
      city: 'Cairo',
      state: 'القاهرة',
      pincode: '115135',
      onboardingCompleted: true,
      plan: 'FREE',
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('hospital-1')
    expect(body.onboardingCompleted).toBe(true)
    expect(body.plan).toBe('FREE')
  })

  it('should return 404 when hospital not found', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(null)

    const res = await GET()
    expect(res.status).toBe(404)
  })

  it('should return hospital with all select fields', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'hospital-1',
      name: 'Test Clinic',
      slug: 'test-clinic',
      email: 'clinic@test.com',
      phone: '01012345678',
      tagline: 'Best clinic',
      address: '123 St',
      city: 'Alexandria',
      state: 'Alexandria',
      pincode: '115990',
      alternatePhone: '9999999999',
      website: 'https://clinic.com',
      gstNumber: '07AAPFU0939F1ZV',
      registrationNo: 'DL/123',
      workingHours: '{"mon":"9-6"}',
      upiId: 'clinic@upi',
      bankName: 'SBI',
      bankAccountNo: '123456',
      bankIfsc: 'SBIN0001',
      bankAccountName: 'Clinic',
      onboardingCompleted: true,
      plan: 'PROFESSIONAL',
    })

    const res = await GET()
    const body = await res.json()
    expect(body.gstNumber).toBe('07AAPFU0939F1ZV')
    expect(body.website).toBe('https://clinic.com')
    expect(body.bankName).toBe('SBI')
  })

  it('should return 500 on database error', async () => {
    vi.mocked(prisma.hospital.findUnique).mockRejectedValue(new Error('DB down'))

    const res = await GET()
    expect(res.status).toBe(500)
  })
})

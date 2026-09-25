// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

/**
 * Phase 13 bug fix — 11-digit Egyptian mobile numbers in the patient portal.
 *
 * The portal login (online-booking entry) UI previously capped phone input at
 * 10 digits. The backend is the consistency anchor: it has always matched
 * Patient.phone by exact string (no digit-count rule) and real Egyptian
 * numbers are 11 digits — so these tests pin the API side of the contract:
 * an 11-digit number is accepted end to end, and values that match no patient
 * (e.g. a truncated 10-digit number) are still rejected.
 */

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/patient-auth', () => ({
  requirePatientAuth: vi.fn(),
  getAuthenticatedPatient: vi.fn(),
  generateOTP: vi.fn(() => '123456'),
  createPatientToken: vi.fn(async () => 'patient-token'),
  setPatientCookie: vi.fn((res) => res),
}))

import { prisma } from '@/lib/prisma'

function makeReq(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const EGYPTIAN_11_DIGIT = '01012345678' // 11 digits — standard Egyptian mobile
const TRUNCATED_10_DIGIT = '0101234567' // what the old UI capped at

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/patient-portal/auth/send-otp (11-digit phone)', () => {
  it('accepts an 11-digit Egyptian mobile number', async () => {
    const { POST } = await import('@/app/api/patient-portal/auth/send-otp/route')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      name: 'DenToRa',
      patientPortalEnabled: true,
    } as any)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({ id: 'pat1', firstName: 'Ahmed' } as any)
    vi.mocked(prisma.patientOTP.count).mockResolvedValue(0)
    vi.mocked(prisma.patientOTP.create).mockResolvedValue({ id: 'otp1' } as any)

    const res = await POST(
      makeReq('/api/patient-portal/auth/send-otp', {
        phone: EGYPTIAN_11_DIGIT,
        hospitalSlug: 'dento-ra',
      })
    )
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    // exact-string match on the full 11-digit number
    expect(vi.mocked(prisma.patient.findFirst).mock.calls[0][0].where).toMatchObject({
      hospitalId: 'h1',
      phone: EGYPTIAN_11_DIGIT,
      isActive: true,
    })
    expect(vi.mocked(prisma.patientOTP.create).mock.calls[0][0].data.phone).toBe(EGYPTIAN_11_DIGIT)
  })

  it('still rejects a truncated 10-digit number (no matching patient)', async () => {
    const { POST } = await import('@/app/api/patient-portal/auth/send-otp/route')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      name: 'DenToRa',
      patientPortalEnabled: true,
    } as any)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(null)

    const res = await POST(
      makeReq('/api/patient-portal/auth/send-otp', {
        phone: TRUNCATED_10_DIGIT,
        hospitalSlug: 'dento-ra',
      })
    )
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toBe('No patient account found with this phone number')
    expect(prisma.patientOTP.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/patient-portal/auth/login (11-digit phone)', () => {
  it('accepts an 11-digit phone + password for a portal-enabled patient', async () => {
    const { POST } = await import('@/app/api/patient-portal/auth/login/route')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ id: 'h1' } as any)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'pat1',
      hospitalId: 'h1',
      phone: EGYPTIAN_11_DIGIT,
      portalUser: {
        id: 'user-p1',
        password: await bcrypt.hash('secret123', 10),
        isActive: true,
        name: 'Ahmed Ali',
      },
    } as any)

    const res = await POST(
      makeReq('/api/patient-portal/auth/login', {
        phone: EGYPTIAN_11_DIGIT,
        password: 'secret123',
        hospitalSlug: 'dento-ra',
      })
    )
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('still rejects a 10-digit phone that matches no patient (401)', async () => {
    const { POST } = await import('@/app/api/patient-portal/auth/login/route')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ id: 'h1' } as any)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(null)

    const res = await POST(
      makeReq('/api/patient-portal/auth/login', {
        phone: TRUNCATED_10_DIGIT,
        password: 'secret123',
        hospitalSlug: 'dento-ra',
      })
    )
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe('Invalid phone or password')
  })
})

// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))
vi.mock('@/lib/api-helpers', () => mockAuth)

const mockPatientAuth = vi.hoisted(() => ({
  requirePatientAuth: vi.fn(),
  createPatientToken: vi.fn(async () => 'patient-token'),
  setPatientCookie: vi.fn((res) => res),
  getAuthenticatedPatient: vi.fn(),
}))
vi.mock('@/lib/patient-auth', () => mockPatientAuth)

const mockEnqueue = vi.hoisted(() => vi.fn(async () => 'queue-1'))
vi.mock('@/lib/messaging/service', () => ({ enqueueMessage: mockEnqueue }))

const mockRenderPdf = vi.hoisted(() => vi.fn(async () => new Uint8Array([37, 80, 68, 70])))
vi.mock('@/lib/pdf', () => ({ renderSimplePdf: mockRenderPdf }))

vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ get: vi.fn(async () => { throw new Error('not found') }) }),
  StorageNotFoundError: class StorageNotFoundError extends Error {},
}))

vi.mock('@/lib/billing/invoice-pdf', () => ({
  generateInvoicePDF: vi.fn(async () => new Uint8Array([1, 2, 3])),
}))

vi.mock('@/lib/i18n/server', () => ({
  getServerLocale: vi.fn(async () => 'en-US'),
  getServerTranslator: vi.fn(async () => ({ t: (k) => k })),
}))
vi.mock('@/lib/i18n/dictionary', () => ({
  translateText: vi.fn((_l, s, vars) => s),
}))
vi.mock('@/lib/i18n/format', () => ({
  formatDate: vi.fn(() => '2026-01-01'),
}))

import { prisma } from '@/lib/prisma'

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(path: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const PATIENT = {
  id: 'pat1',
  hospitalId: 'h1',
  patientId: 'P-001',
  firstName: 'Ahmed',
  lastName: 'Ali',
  phone: '01012345678',
  email: null,
  locale: null,
  dateOfBirth: new Date('1990-05-01'),
  portalUserId: null,
  portalEnabled: false,
}

const PATIENT_OTHER = { ...PATIENT, id: 'pat2', patientId: 'P-002', firstName: 'Sara' }

beforeEach(() => {
  vi.clearAllMocks()
  mockPatientAuth.requirePatientAuth.mockResolvedValue({ error: null, patient: PATIENT })
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    user: { id: 'staff1', role: 'ADMIN' },
    hospitalId: 'h1',
    session: { user: { id: 'staff1', role: 'ADMIN' } },
  })
})

// ── POST /api/portal/accounts (D3) ───────────────────────────────────────────
describe('POST /api/portal/accounts (Phase 13)', () => {
  it('creates a PATIENT-role portal account, links it, enables the portal, queues welcome', async () => {
    const { POST } = await import('@/app/api/portal/accounts/route')
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ ...PATIENT } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.create).mockResolvedValue({ id: 'user-p1', email: 'patient-01012345678@portal.dentora.local' } as any)
    vi.mocked(prisma.patient.update).mockResolvedValue(PATIENT as any)

    const res = await POST(makeReq('/api/portal/accounts', 'POST', { patientId: 'pat1', password: 'secret123' }))
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.portalAccount.portalEnabled).toBe(true)
    const userArg = vi.mocked(prisma.user.create).mock.calls[0][0]
    expect(userArg.data.role).toBe('PATIENT')
    expect(userArg.data.email).toBe('patient-01012345678@portal.dentora.local')
    expect(userArg.data.hospitalId).toBe('h1')
    expect(userArg.data.password).not.toBe('secret123') // hashed
    expect(vi.mocked(prisma.patient.update).mock.calls[0][0].data).toMatchObject({
      portalUserId: 'user-p1',
      portalEnabled: true,
    })
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        hospitalId: 'h1',
        recipient: '01012345678',
        channel: 'WHATSAPP',
        messageType: 'WELCOME',
      })
    )
  })

  it('rejects short passwords (400)', async () => {
    const { POST } = await import('@/app/api/portal/accounts/route')
    const res = await POST(makeReq('/api/portal/accounts', 'POST', { patientId: 'pat1', password: 'short' }))
    expect(res.status).toBe(400)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('rejects when a portal account already exists (409)', async () => {
    const { POST } = await import('@/app/api/portal/accounts/route')
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ ...PATIENT, portalUserId: 'existing' } as any)
    const res = await POST(makeReq('/api/portal/accounts', 'POST', { patientId: 'pat1', password: 'secret123' }))
    expect(res.status).toBe(409)
  })

  it('respects staff RBAC (403 for a rejected role)', async () => {
    const { POST } = await import('@/app/api/portal/accounts/route')
    const { NextResponse } = await import('next/server')
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
      session: null,
    })
    const res = await POST(makeReq('/api/portal/accounts', 'POST', { patientId: 'pat1', password: 'secret123' }))
    expect(res.status).toBe(403)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })
})

// ── POST /api/patient-portal/auth/login (D3 password mode) ───────────────────
describe('POST /api/patient-portal/auth/login (Phase 13)', () => {
  it('logs in with phone + password and sets the patient cookie', async () => {
    const { POST } = await import('@/app/api/patient-portal/auth/login/route')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ id: 'h1' } as any)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      ...PATIENT,
      portalUser: { id: 'user-p1', password: await bcrypt.hash('secret123', 10), isActive: true, name: 'Ahmed Ali' },
    } as any)
    mockPatientAuth.setPatientCookie.mockImplementation((res) => res)

    const res = await POST(
      makeReq('/api/patient-portal/auth/login', 'POST', {
        phone: '01012345678',
        password: 'secret123',
        hospitalSlug: 'dento-ra',
      })
    )
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockPatientAuth.createPatientToken).toHaveBeenCalledWith({
      patientId: 'pat1',
      hospitalId: 'h1',
      phone: '01012345678',
    })
    expect(mockPatientAuth.setPatientCookie).toHaveBeenCalled()
  })

  it('returns a generic 401 for a wrong password (no enumeration)', async () => {
    const { POST } = await import('@/app/api/patient-portal/auth/login/route')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ id: 'h1' } as any)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      ...PATIENT,
      portalUser: { id: 'user-p1', password: await bcrypt.hash('otherpass9', 10), isActive: true, name: 'Ahmed Ali' },
    } as any)

    const res = await POST(
      makeReq('/api/patient-portal/auth/login', 'POST', {
        phone: '01012345678',
        password: 'secret123',
        hospitalSlug: 'dento-ra',
      })
    )
    const data = await res.json()
    expect(res.status).toBe(401)
    expect(data.error).toBe('Invalid phone or password')
  })

  it('returns 404 for an unknown clinic', async () => {
    const { POST } = await import('@/app/api/patient-portal/auth/login/route')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(null)
    const res = await POST(
      makeReq('/api/patient-portal/auth/login', 'POST', {
        phone: '01012345678',
        password: 'secret123',
        hospitalSlug: 'nope',
      })
    )
    expect(res.status).toBe(404)
  })
})

// ── POST /api/patient-portal/appointments (D7 hardening) ─────────────────────
describe('POST /api/patient-portal/appointments (Phase 13 booking rules)', () => {
  const futureDate = () => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  }
  const body = { doctorId: 'doc1', date: futureDate(), time: '10:00', chiefComplaint: 'toothache' }

  const baseSetup = () => {
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({
      id: 'doc1',
      firstName: 'Laila',
      lastName: 'Khaled',
      phone: '01099999999',
      specialization: 'Endo',
    } as any)
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      name: 'DenToRa',
      address: 'Cairo',
      phone: '0200000000',
      workingHours: JSON.stringify({ start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '14:00' }),
    } as any)
    vi.mocked(prisma.staffShift.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.appointment.create).mockResolvedValue({
      id: 'apt-new',
      appointmentNo: 'APT00001',
      status: 'SCHEDULED',
      doctor: { firstName: 'Laila', lastName: 'Khaled' },
    } as any)
  }

  it('books a valid slot (201) and queues patient + doctor confirmations', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/route')
    baseSetup()

    const res = await POST(makeReq('/api/patient-portal/appointments', 'POST', body))
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.success).toBe(true)
    const createArg = vi.mocked(prisma.appointment.create).mock.calls[0][0]
    expect(createArg.data.patientId).toBe('pat1')
    expect(createArg.data.doctorId).toBe('doc1')
    expect(createArg.data.status).toBe('SCHEDULED')
    expect(createArg.data.duration).toBe(30)
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    const types = mockEnqueue.mock.calls.map((c) => c[0].messageType).sort()
    expect(types).toEqual(['APPOINTMENT_CONFIRMATION', 'DOCTOR_NEW_APPOINTMENT'])
    expect(mockEnqueue.mock.calls[0][0].recipient).toBe('01012345678')
  })

  it('rejects past dates (400)', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/route')
    baseSetup()
    const res = await POST(
      makeReq('/api/patient-portal/appointments', 'POST', { ...body, date: '2020-01-01' })
    )
    expect(res.status).toBe(400)
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('rejects a double-booked doctor slot (409)', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/route')
    baseSetup()
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { scheduledTime: '10:00', duration: 30, patientId: 'pat-X' },
    ])
    const res = await POST(makeReq('/api/patient-portal/appointments', 'POST', body))
    expect(res.status).toBe(409)
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('rejects a second booking within one hour for the same patient (409)', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/route')
    baseSetup()
    // patient already has 09:30 with the same doctor — 10:00 is within 1h
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { scheduledTime: '09:30', duration: 30, patientId: 'pat1' },
    ])
    const res = await POST(makeReq('/api/patient-portal/appointments', 'POST', body))
    expect(res.status).toBe(409)
  })

  it('rejects a time outside the doctor working hours (409)', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/route')
    baseSetup()
    const res = await POST(
      makeReq('/api/patient-portal/appointments', 'POST', { ...body, time: '08:00' })
    )
    expect(res.status).toBe(409)
  })
})

// ── POST /api/patient-portal/appointments/[id]/cancel (D8) ───────────────────
describe('POST /api/patient-portal/appointments/[id]/cancel (Phase 13)', () => {
  const dateIn = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d
  }

  it('cancels a SCHEDULED appointment >24h away (200) and notifies the doctor', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/[id]/cancel/route')
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: 'apt1',
      status: 'SCHEDULED',
      scheduledDate: dateIn(5),
      scheduledTime: '10:00',
      doctor: { firstName: 'Laila', lastName: 'Khaled', phone: '01099999999' },
    } as any)
    vi.mocked(prisma.appointment.update).mockResolvedValue({ id: 'apt1' } as any)

    const res = await POST(makeReq('/api/patient-portal/appointments/apt1/cancel', 'POST'), {
      params: Promise.resolve({ id: 'apt1' }),
    })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(vi.mocked(prisma.appointment.update).mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: expect.any(Date),
    })
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'DOCTOR_CANCELLATION', recipient: '01099999999' })
    )
  })

  it('rejects cancellation <24h before the appointment (409)', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/[id]/cancel/route')
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: 'apt1',
      status: 'SCHEDULED',
      scheduledDate: soon,
      scheduledTime: `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`,
      doctor: { phone: null },
    } as any)
    const res = await POST(makeReq('/api/patient-portal/appointments/apt1/cancel', 'POST'), {
      params: Promise.resolve({ id: 'apt1' }),
    })
    expect(res.status).toBe(409)
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('rejects non-SCHEDULED appointments (409)', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/[id]/cancel/route')
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: 'apt1',
      status: 'COMPLETED',
      scheduledDate: dateIn(-2),
      scheduledTime: '10:00',
      doctor: { phone: null },
    } as any)
    const res = await POST(makeReq('/api/patient-portal/appointments/apt1/cancel', 'POST'), {
      params: Promise.resolve({ id: 'apt1' }),
    })
    expect(res.status).toBe(409)
  })

  it('returns 404 for another patient appointment (security)', async () => {
    const { POST } = await import('@/app/api/patient-portal/appointments/[id]/cancel/route')
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null)
    const res = await POST(makeReq('/api/patient-portal/appointments/other/cancel', 'POST'), {
      params: Promise.resolve({ id: 'other' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── GET /api/patient-portal/prescriptions/[id]/pdf (D9) ──────────────────────
describe('GET /api/patient-portal/prescriptions/[id]/pdf (Phase 13)', () => {
  it('renders the own prescription PDF (200)', async () => {
    const { GET } = await import('@/app/api/patient-portal/prescriptions/[id]/pdf/route')
    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx1',
      prescriptionNo: 'RX-0001',
      pdfUrl: null,
      diagnosis: 'Caries',
      notes: null,
      doctor: { firstName: 'Laila', lastName: 'Khaled' },
      medications: [
        { medicationName: 'Amoxicillin', dosage: '500mg', frequency: 'BD', duration: '7 days', instructions: 'After meals' },
      ],
    } as any)
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ name: 'DenToRa' } as any)

    const res = await GET(makeReq('/api/patient-portal/prescriptions/rx1/pdf'), {
      params: Promise.resolve({ id: 'rx1' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(mockRenderPdf).toHaveBeenCalledOnce()
    // scoped lookup: patientId from the token
    expect(vi.mocked(prisma.prescription.findFirst).mock.calls[0][0].where).toMatchObject({
      id: 'rx1',
      patientId: 'pat1',
      hospitalId: 'h1',
    })
  })

  it('returns 404 for another patient prescription (security)', async () => {
    const { GET } = await import('@/app/api/patient-portal/prescriptions/[id]/pdf/route')
    vi.mocked(prisma.prescription.findFirst).mockResolvedValue(null)
    const res = await GET(makeReq('/api/patient-portal/prescriptions/other/pdf'), {
      params: Promise.resolve({ id: 'other' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── POST /api/patient-portal/prescriptions/[id]/resend (D9) ──────────────────
describe('POST /api/patient-portal/prescriptions/[id]/resend (Phase 13)', () => {
  it('queues the WhatsApp resend and stamps sentViaWhatsApp', async () => {
    const { POST } = await import('@/app/api/patient-portal/prescriptions/[id]/resend/route')
    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx1',
      issuedAt: new Date('2026-09-01'),
      createdAt: new Date('2026-09-01'),
      doctor: { firstName: 'Laila', lastName: 'Khaled' },
    } as any)
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ name: 'DenToRa', address: 'Cairo', phone: null } as any)
    vi.mocked(prisma.prescription.update).mockResolvedValue({} as any)

    const res = await POST(makeReq('/api/patient-portal/prescriptions/rx1/resend', 'POST'), {
      params: Promise.resolve({ id: 'rx1' }),
    })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.queued).toBe(true)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'PRESCRIPTION', recipient: '01012345678' })
    )
    expect(vi.mocked(prisma.prescription.update).mock.calls[0][0].data).toMatchObject({
      sentViaWhatsApp: true,
      whatsappSentAt: expect.any(Date),
    })
  })
})

// ── POST /api/patient-portal/bills/[id]/pay (D10) ────────────────────────────
describe('POST /api/patient-portal/bills/[id]/pay (Phase 13)', () => {
  it('creates a 48h payment link and returns the /pay/[token] URL (201)', async () => {
    const { POST } = await import('@/app/api/patient-portal/bills/[id]/pay/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: 'inv1',
      invoiceNo: 'INV-202609-0001',
      balanceAmount: 500,
      status: 'PENDING',
    } as any)
    vi.mocked(prisma.paymentGatewayConfig.findUnique).mockResolvedValue({ isEnabled: true } as any)
    vi.mocked(prisma.paymentLink.create).mockResolvedValue({ id: 'link1' } as any)

    const res = await POST(makeReq('/api/patient-portal/bills/inv1/pay', 'POST'), {
      params: Promise.resolve({ id: 'inv1' }),
    })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.paymentUrl).toMatch(/\/pay\/[a-f0-9]{48}$/)
    const linkArg = vi.mocked(prisma.paymentLink.create).mock.calls[0][0]
    expect(linkArg.data.hospitalId).toBe('h1')
    expect(linkArg.data.invoiceId).toBe('inv1')
    expect(linkArg.data.amount).toBe(500)
  })

  it('rejects when the gateway is disabled (400)', async () => {
    const { POST } = await import('@/app/api/patient-portal/bills/[id]/pay/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: 'inv1',
      invoiceNo: 'INV-202609-0001',
      balanceAmount: 500,
      status: 'PENDING',
    } as any)
    vi.mocked(prisma.paymentGatewayConfig.findUnique).mockResolvedValue(null)
    const res = await POST(makeReq('/api/patient-portal/bills/inv1/pay', 'POST'), {
      params: Promise.resolve({ id: 'inv1' }),
    })
    expect(res.status).toBe(400)
    expect(prisma.paymentLink.create).not.toHaveBeenCalled()
  })

  it('rejects a fully paid invoice (400)', async () => {
    const { POST } = await import('@/app/api/patient-portal/bills/[id]/pay/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: 'inv1',
      invoiceNo: 'INV-202609-0001',
      balanceAmount: 0,
      status: 'PAID',
    } as any)
    const res = await POST(makeReq('/api/patient-portal/bills/inv1/pay', 'POST'), {
      params: Promise.resolve({ id: 'inv1' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for another patient invoice (security)', async () => {
    const { POST } = await import('@/app/api/patient-portal/bills/[id]/pay/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null)
    const res = await POST(makeReq('/api/patient-portal/bills/other/pay', 'POST'), {
      params: Promise.resolve({ id: 'other' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── PATCH /api/patient-portal/profile (D11) ──────────────────────────────────
describe('PATCH /api/patient-portal/profile (Phase 13)', () => {
  it('updates the own email (200)', async () => {
    const { PATCH } = await import('@/app/api/patient-portal/profile/route')
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({
      portalUserId: null,
      hospital: { locale: 'ar-EG' },
    } as any)
    vi.mocked(prisma.patient.update).mockResolvedValue({
      locale: null,
      email: 'ahmed@example.com',
      hospital: { locale: 'ar-EG' },
    } as any)

    const res = await PATCH(
      makeReq('/api/patient-portal/profile', 'PATCH', { email: 'ahmed@example.com' })
    )
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.email).toBe('ahmed@example.com')
    expect(vi.mocked(prisma.patient.update).mock.calls[0][0].data).toMatchObject({
      email: 'ahmed@example.com',
    })
  })

  it('rejects an invalid email (400)', async () => {
    const { PATCH } = await import('@/app/api/patient-portal/profile/route')
    const res = await PATCH(
      makeReq('/api/patient-portal/profile', 'PATCH', { email: 'not-an-email' })
    )
    expect(res.status).toBe(400)
    expect(prisma.patient.update).not.toHaveBeenCalled()
  })
})

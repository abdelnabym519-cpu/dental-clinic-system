import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// Mock auth — enforces the role list exactly like the real helper
const mockAuth = vi.hoisted(() => {
  const state = {
    error: null as Response | null,
    hospitalId: 'h1',
    user: { id: 'u-1', role: 'DOCTOR' },
  }
  const requireAuthAndRole = vi.fn(async (allowedRoles?: string[]) => {
    if (state.error) {
      return { error: state.error, user: null, hospitalId: null, session: null }
    }
    if (allowedRoles && !allowedRoles.includes(state.user.role)) {
      return {
        error: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return {
      error: null,
      user: state.user,
      hospitalId: state.hospitalId,
      session: { user: state.user },
    }
  })
  return { requireAuthAndRole, state }
})
vi.mock('@/lib/api-helpers', () => mockAuth)

// Mock prisma
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

// Phase 11 — deterministic PDF / storage / i18n doubles
const storageMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(async () => ({})),
  StorageNotFoundError: class StorageNotFoundError extends Error {},
}))
vi.mock('@/lib/storage', () => ({
  getStorage: () => storageMock,
  StorageNotFoundError: storageMock.StorageNotFoundError,
}))
vi.mock('@/lib/storage/keys', () => ({
  buildStorageKey: (hospitalId: string, ...rest: string[]) => `${hospitalId}/${rest.join('/')}`,
}))
vi.mock('@/lib/pdf', () => ({
  renderSimplePdf: () => Buffer.from('%PDF-1.7 phase11-render'),
}))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'en' }))
vi.mock('@/lib/i18n/dictionary', () => ({
  translateText: (key: string) => key,
}))
vi.mock('@/lib/i18n/format', () => ({
  formatDate: () => '2026-09-24',
}))
vi.mock('@/lib/messaging/templates', () => ({
  prescriptionSent: () => 'Your prescription from the clinic',
}))

function makeRequest(url: string, options: any = {}) {
  return new Request(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
}

async function as(role: string = 'DOCTOR', userId: string = 'u-1') {
  mockAuth.state.error = null
  mockAuth.state.hospitalId = 'h1'
  mockAuth.state.user = { id: userId, role }
}

const SIGNED_RX = {
  id: 'rx-1',
  hospitalId: 'h1',
  prescriptionNo: 'RX-0001',
  patientId: 'p1',
  status: 'SIGNED',
  diagnosis: 'caries',
  notes: null,
  pdfUrl: null,
  prescriptionNoField: undefined,
  patient: { id: 'p1', firstName: 'A', lastName: 'B', phone: '+201012345678' },
  doctor: { id: 'st-1', firstName: 'Dr', lastName: 'Who' },
  medications: [
    { medicationName: 'Amoxicillin', dosage: '500mg', frequency: '3x/day', duration: '7 days' },
  ],
}

describe('PATCH /api/prescriptions/[id] (Phase 11 draft editing)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replaces the medication list on a DRAFT', async () => {
    await as()
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
      patientId: 'p1',
    } as any)
    vi.mocked(prisma.prescriptionMedication.deleteMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.prescriptionMedication.createMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.prescription.update).mockResolvedValue({ id: 'rx-1' } as any)

    const req = makeRequest('http://localhost/api/prescriptions/rx-1', {
      method: 'PATCH',
      body: {
        diagnosis: 'updated dx',
        medications: [
          {
            medicationName: 'Amoxicillin',
            dosage: '500mg',
            frequency: '3x/day',
            duration: '7 days',
          },
        ],
      },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(200)
    expect(prisma.prescriptionMedication.deleteMany).toHaveBeenCalledWith({
      where: { prescriptionId: 'rx-1' },
    })
    expect(prisma.prescriptionMedication.createMany).toHaveBeenCalled()
  })

  it('rejects editing a SIGNED prescription (frozen document, 409)', async () => {
    await as()
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'SIGNED',
      patientId: 'p1',
    } as any)

    const req = makeRequest('http://localhost/api/prescriptions/rx-1', {
      method: 'PATCH',
      body: { diagnosis: 'sneaky' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(409)
    expect(prisma.prescription.update).not.toHaveBeenCalled()
  })

  it('rejects an appointment that belongs to a different patient (400)', async () => {
    await as()
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
      patientId: 'p1',
    } as any)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: 'a9',
      patientId: 'someone-else',
    } as any)

    const req = makeRequest('http://localhost/api/prescriptions/rx-1', {
      method: 'PATCH',
      body: { appointmentId: 'a9' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(400)
  })

  it('rejects a medication row missing dosage (400)', async () => {
    await as()
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
      patientId: 'p1',
    } as any)

    const req = makeRequest('http://localhost/api/prescriptions/rx-1', {
      method: 'PATCH',
      body: { medications: [{ medicationName: 'No dosage' }] },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(400)
    expect(prisma.prescriptionMedication.deleteMany).not.toHaveBeenCalled()
  })

  it('is DOCTOR/ADMIN only (RECEPTIONIST → 403)', async () => {
    await as('RECEPTIONIST')
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')

    const req = makeRequest('http://localhost/api/prescriptions/rx-1', {
      method: 'PATCH',
      body: { diagnosis: 'x' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(403)
    expect(prisma.prescription.findFirst).not.toHaveBeenCalled()
  })
})

describe('POST /api/prescriptions/[id]/sign (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('signs a DRAFT with medications: SIGNED + issuedAt + 30-day validity', async () => {
    await as('DOCTOR', 'u-1')
    const { POST } = await import('@/app/api/prescriptions/[id]/sign/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
      validUntil: null,
      medications: [{ id: 'm1' }],
    } as any)
    vi.mocked(prisma.prescription.update).mockResolvedValue({
      id: 'rx-1',
      status: 'SIGNED',
    } as any)

    const before = Date.now()
    const req = makeRequest('http://localhost/api/prescriptions/rx-1/sign', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'rx-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.status).toBe('SIGNED')
    const dataArg = vi.mocked(prisma.prescription.update).mock.calls[0][0].data as Record<
      string,
      unknown
    >
    expect(dataArg.status).toBe('SIGNED')
    expect(dataArg.issuedAt).toBeInstanceOf(Date)
    // default validity window ≈ 30 days
    const deltaDays = (dataArg.validUntil as Date).getTime() - (dataArg.issuedAt as Date).getTime()
    expect(deltaDays).toBeGreaterThan(29 * 24 * 3600_000)
    expect(deltaDays).toBeLessThanOrEqual(30 * 24 * 3600_000 + 60_000)
    expect(before).toBeGreaterThan(0)
  })

  it('refuses to sign an empty prescription (400)', async () => {
    await as()
    const { POST } = await import('@/app/api/prescriptions/[id]/sign/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
      medications: [],
    } as any)

    const req = makeRequest('http://localhost/api/prescriptions/rx-1/sign', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(400)
  })

  it('refuses to sign a non-DRAFT (409)', async () => {
    await as()
    const { POST } = await import('@/app/api/prescriptions/[id]/sign/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'SENT',
      medications: [{ id: 'm1' }],
    } as any)

    const req = makeRequest('http://localhost/api/prescriptions/rx-1/sign', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(409)
    expect(prisma.prescription.update).not.toHaveBeenCalled()
  })

  it('is DOCTOR/ADMIN only (RECEPTIONIST → 403)', async () => {
    await as('RECEPTIONIST')
    const { POST } = await import('@/app/api/prescriptions/[id]/sign/route')

    const req = makeRequest('http://localhost/api/prescriptions/rx-1/sign', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(403)
    expect(prisma.prescription.findFirst).not.toHaveBeenCalled()
  })
})

describe('POST /api/communications/prescriptions/[id]/send (Phase 11 signed gate + PDF persist)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.messageQueue.create).mockResolvedValue({ id: 'mq-1' } as any)
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ name: 'Dentora' } as any)
    storageMock.get.mockReset()
    storageMock.put.mockClear()
  })

  it('refuses to send an unsigned prescription (409, nothing queued)', async () => {
    await as()
    const { POST } = await import('@/app/api/communications/prescriptions/[id]/send/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      ...SIGNED_RX,
      status: 'DRAFT',
    } as any)

    const req = makeRequest('http://localhost/api/communications/prescriptions/rx-1/send', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(409)
    expect(prisma.messageQueue.create).not.toHaveBeenCalled()
    expect(storageMock.put).not.toHaveBeenCalled()
  })

  it('sends a SIGNED one: queues the PDF, persists it, marks SENT with pdfUrl', async () => {
    await as('DOCTOR', 'u-1')
    const { POST } = await import('@/app/api/communications/prescriptions/[id]/send/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue(SIGNED_RX as any)
    vi.mocked(prisma.prescription.update).mockResolvedValue({ id: 'rx-1', status: 'SENT' } as any)

    const req = makeRequest('http://localhost/api/communications/prescriptions/rx-1/send', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'rx-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    // queued as a WhatsApp document
    expect(prisma.messageQueue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'WHATSAPP',
          messageType: 'PRESCRIPTION',
          recipient: '+201012345678',
        }),
      })
    )
    // PDF persisted + prescription marked SENT
    expect(storageMock.put).toHaveBeenCalled()
    expect(prisma.prescription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          sentViaWhatsApp: true,
          pdfUrl: 'h1/prescriptions/rx-1/prescription.pdf',
        }),
      })
    )
    expect(body.pdfUrl).toBe('h1/prescriptions/rx-1/prescription.pdf')
  })

  it('400 when there is no valid recipient (nothing marked sent)', async () => {
    await as()
    const { POST } = await import('@/app/api/communications/prescriptions/[id]/send/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      ...SIGNED_RX,
      patient: { id: 'p1', firstName: 'A', lastName: 'B', phone: null },
    } as any)

    const req = makeRequest('http://localhost/api/communications/prescriptions/rx-1/send', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(400)
    expect(prisma.prescription.update).not.toHaveBeenCalled()
  })
})

describe('GET /api/documents/prescription/[id] (Phase 11 PDF preview)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ name: 'Dentora' } as any)
    storageMock.get.mockReset()
    storageMock.get.mockResolvedValue({ body: Buffer.from('STORED-PDF-BYTES') } as any)
  })

  it('serves the stored PDF (what was actually sent)', async () => {
    await as('RECEPTIONIST') // any tenant role may view
    const { GET } = await import('@/app/api/documents/prescription/[id]/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      prescriptionNo: 'RX-0001',
      status: 'SENT',
      pdfUrl: 'h1/prescriptions/rx-1/prescription.pdf',
    } as any)

    const req = makeRequest('http://localhost/api/documents/prescription/rx-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'rx-1' }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toBe('STORED-PDF-BYTES')
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('prescription-RX-0001.pdf')
  })

  it('falls back to a live render when the stored object is gone', async () => {
    await as()
    const { GET } = await import('@/app/api/documents/prescription/[id]/route')

    storageMock.get.mockRejectedValue(new storageMock.StorageNotFoundError('gone'))
    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      prescriptionNo: 'RX-0001',
      status: 'SIGNED',
      pdfUrl: 'h1/prescriptions/rx-1/prescription.pdf',
      diagnosis: null,
      notes: null,
      patient: {
        firstName: 'A',
        lastName: 'B',
        dateOfBirth: null,
        gender: 'M',
        medicalHistory: { drugAllergies: null },
      },
      doctor: { firstName: 'Dr', lastName: 'Who', licenseNumber: '123' },
      medications: [
        {
          medicationName: 'Amoxicillin',
          dosage: '500mg',
          frequency: '3x/day',
          duration: '7 days',
          route: 'Oral',
          timing: null,
          instructions: null,
          quantity: null,
        },
      ],
    } as any)

    const req = makeRequest('http://localhost/api/documents/prescription/rx-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'rx-1' }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text.startsWith('%PDF')).toBe(true)
  })

  it('renders on the fly for unsigned drafts (no pdfUrl)', async () => {
    await as()
    const { GET } = await import('@/app/api/documents/prescription/[id]/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      prescriptionNo: 'RX-0001',
      status: 'DRAFT',
      pdfUrl: null,
      diagnosis: null,
      notes: null,
      patient: {
        firstName: 'A',
        lastName: 'B',
        dateOfBirth: null,
        gender: 'M',
        medicalHistory: { drugAllergies: null },
      },
      doctor: { firstName: 'Dr', lastName: 'Who', licenseNumber: '123' },
      medications: [],
    } as any)

    const req = makeRequest('http://localhost/api/documents/prescription/rx-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'rx-1' }) })

    expect(res.status).toBe(200)
    expect(storageMock.get).not.toHaveBeenCalled()
  })

  it('404 for a prescription outside the tenant', async () => {
    await as()
    const { GET } = await import('@/app/api/documents/prescription/[id]/route')

    vi.mocked(prisma.prescription.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/documents/prescription/ghost')
    const res = await GET(req, { params: Promise.resolve({ id: 'ghost' }) })

    expect(res.status).toBe(404)
  })
})

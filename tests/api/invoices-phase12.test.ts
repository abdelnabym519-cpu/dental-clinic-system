import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

const storageMock = vi.hoisted(() => ({
  put: vi.fn(async () => undefined),
  get: vi.fn(async () => {
    throw new Error('not found')
  }),
}))
vi.mock('@/lib/storage', () => ({
  getStorage: () => storageMock,
  StorageNotFoundError: class StorageNotFoundError extends Error {},
}))
vi.mock('@/lib/storage/keys', () => ({
  buildStorageKey: (hospitalId: string, kind: string, id: string, file: string) =>
    `${hospitalId}/${kind}/${id}/${file}`,
}))

const mockGenerateInvoicePDF = vi.hoisted(() => vi.fn(async () => new Uint8Array([37, 80, 68, 70])))
vi.mock('@/lib/billing/invoice-pdf', () => ({
  generateInvoicePDF: mockGenerateInvoicePDF,
}))

const { mockGeneratePaymentNo } = vi.hoisted(() => ({
  mockGeneratePaymentNo: vi.fn(),
}))
vi.mock('@/lib/billing-utils', () => ({
  generatePaymentNo: mockGeneratePaymentNo,
  generateInvoiceNo: vi.fn(async () => 'INV-202609-0001'),
  calculateInvoiceTotals: vi.fn(() => ({
    subtotal: 1000,
    discountAmount: 0,
    taxableAmount: 1000,
    cgstRate: 7,
    cgstAmount: 70,
    sgstRate: 0,
    sgstAmount: 70,
    totalAmount: 1140,
  })),
  vatConfig: { rate: 14 },
}))

function makeRequest(url: string, options: any = {}) {
  return new Request(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
}

const baseInvoice = {
  id: 'inv1',
  hospitalId: 'h1',
  invoiceNo: 'INV-202609-0001',
  patientId: 'pat1',
  status: 'DRAFT',
  invoiceDate: new Date('2026-09-01'),
  dueDate: new Date('2026-09-30'),
  subtotal: 1000,
  discountType: 'FIXED',
  discountValue: 0,
  discountAmount: 0,
  taxableAmount: 1000,
  cgstRate: 14,
  cgstAmount: 140,
  sgstRate: 0,
  sgstAmount: 140,
  totalAmount: 1140,
  paidAmount: 0,
  balanceAmount: 1140,
  notes: null,
  termsAndConditions: null,
  issuedAt: null,
  paidAt: null,
  pdfUrl: null,
  sentViaWhatsApp: false,
  currency: 'EGP',
  createdAt: new Date('2026-09-01'),
  patient: { id: 'pat1', patientId: 'P-001', firstName: 'Ahmed', lastName: 'Ali', phone: '01012345678' },
  items: [
    {
      id: 'item1',
      description: 'Root canal (tooth 16)',
      quantity: 1,
      unitPrice: 1000,
      amount: 1000,
      taxable: true,
      treatmentId: null,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    session: { user: { id: 'user1', role: 'ACCOUNTANT' } },
  })
  vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ id: 'h1', name: 'DenToRa Clinic' } as any)
})

// ── POST /api/invoices/[id]/issue ────────────────────────────────────────────
describe('POST /api/invoices/[id]/issue (Phase 12)', () => {
  it('issues a DRAFT invoice → 201, ISSUED status, issuedAt + pdfUrl stamped, PDF persisted', async () => {
    const { POST } = await import('@/app/api/invoices/[id]/issue/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(baseInvoice as any)
    vi.mocked(prisma.invoice.update).mockResolvedValue({ ...baseInvoice, status: 'ISSUED', issuedAt: new Date('2026-09-10'), pdfUrl: 'h1/invoices/inv1/invoice.pdf' } as any)

    const res = await POST(makeRequest('http://localhost/api/invoices/inv1/issue', { method: 'POST' }), {
      params: Promise.resolve({ id: 'inv1' }),
    })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.success).toBe(true)
    expect(data.pdfUrl).toBe('h1/invoices/inv1/invoice.pdf')
    expect(data.actorId).toBe('user1')
    expect(mockGenerateInvoicePDF).toHaveBeenCalledOnce()
    expect(storageMock.put).toHaveBeenCalledWith('h1/invoices/inv1/invoice.pdf', expect.any(Uint8Array), {
      contentType: 'application/pdf',
    })
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv1' },
        data: expect.objectContaining({ status: 'ISSUED', issuedAt: expect.any(Date), pdfUrl: 'h1/invoices/inv1/invoice.pdf' }),
      })
    )
  })

  it('returns 409 for a non-DRAFT invoice', async () => {
    const { POST } = await import('@/app/api/invoices/[id]/issue/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ ...baseInvoice, status: 'ISSUED' } as any)

    const res = await POST(makeRequest('http://localhost/api/invoices/inv1/issue', { method: 'POST' }), {
      params: Promise.resolve({ id: 'inv1' }),
    })

    expect(res.status).toBe(409)
    expect(mockGenerateInvoicePDF).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing invoice', async () => {
    const { POST } = await import('@/app/api/invoices/[id]/issue/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null)

    const res = await POST(makeRequest('http://localhost/api/invoices/nope/issue', { method: 'POST' }), {
      params: Promise.resolve({ id: 'nope' }),
    })

    expect(res.status).toBe(404)
  })

  it('respects the role gate: 403 when requireAuthAndRole rejects', async () => {
    const { POST } = await import('@/app/api/invoices/[id]/issue/route')
    const { NextResponse } = await import('next/server')
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
      session: null,
    })
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(baseInvoice as any)

    const res = await POST(makeRequest('http://localhost/api/invoices/inv1/issue', { method: 'POST' }), {
      params: Promise.resolve({ id: 'inv1' }),
    })

    expect(res.status).toBe(403)
    expect(prisma.invoice.update).not.toHaveBeenCalled()
    expect(mockGenerateInvoicePDF).not.toHaveBeenCalled()
  })
})

// ── GET /api/invoices/[id]/pdf ───────────────────────────────────────────────
describe('GET /api/invoices/[id]/pdf (Phase 12)', () => {
  it('serves the stored document when pdfUrl is present', async () => {
    const { GET } = await import('@/app/api/invoices/[id]/pdf/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...baseInvoice,
      status: 'ISSUED',
      pdfUrl: 'h1/invoices/inv1/invoice.pdf',
    } as any)
    storageMock.get.mockResolvedValue({ body: new Uint8Array([99, 99, 99]) })

    const res = await GET(makeRequest('http://localhost/api/invoices/inv1/pdf'), {
      params: Promise.resolve({ id: 'inv1' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="invoice-INV-202609-0001.pdf"')
    expect(storageMock.get).toHaveBeenCalledWith('h1/invoices/inv1/invoice.pdf')
    expect(mockGenerateInvoicePDF).not.toHaveBeenCalled()
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 3).equals(Buffer.from([99, 99, 99]))).toBe(true)
  })

  it('falls back to live rendering for DRAFT invoices without a stored PDF', async () => {
    const { GET } = await import('@/app/api/invoices/[id]/pdf/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(baseInvoice as any)

    const res = await GET(makeRequest('http://localhost/api/invoices/inv1/pdf'), {
      params: Promise.resolve({ id: 'inv1' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(mockGenerateInvoicePDF).toHaveBeenCalledOnce()
    const call = mockGenerateInvoicePDF.mock.calls[0][0]
    expect(call.invoiceNo).toBe('INV-202609-0001')
    expect(call.clinicName).toBe('DenToRa Clinic')
    expect(call.patientName).toBe('Ahmed Ali')
  })

  it('returns 404 for a missing invoice', async () => {
    const { GET } = await import('@/app/api/invoices/[id]/pdf/route')
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null)

    const res = await GET(makeRequest('http://localhost/api/invoices/nope/pdf'), {
      params: Promise.resolve({ id: 'nope' }),
    })

    expect(res.status).toBe(404)
  })
})

// ── POST /api/invoices — clinical links + attribution (Phase 12) ─────────────
describe('POST /api/invoices (Phase 12 extensions)', () => {
  const createBody = {
    patientId: 'pat1',
    items: [{ description: 'Root canal (tooth 16)', quantity: 1, unitPrice: 1000, taxable: true }],
  }

  it('accepts matching appointmentId + treatmentPlanId and stamps createdById/currency', async () => {
    const { POST } = await import('@/app/api/invoices/route')
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ id: 'pat1' } as any)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: 'apt1', patientId: 'pat1' } as any)
    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({ id: 'plan1', patientId: 'pat1' } as any)
    vi.mocked(prisma.invoice.create).mockResolvedValue({ ...baseInvoice, id: 'inv-new' } as any)

    const res = await POST(
      makeRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: { ...createBody, appointmentId: 'apt1', treatmentPlanId: 'plan1' },
      }),
      {}
    )
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.id).toBe('inv-new')
    const createArg = vi.mocked(prisma.invoice.create).mock.calls[0][0]
    expect(createArg.data.appointmentId).toBe('apt1')
    expect(createArg.data.treatmentPlanId).toBe('plan1')
    expect(createArg.data.createdById).toBe('user1')
    expect(createArg.data.currency).toBe('EGP')
  })

  it('rejects an appointment belonging to another patient (400)', async () => {
    const { POST } = await import('@/app/api/invoices/route')
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ id: 'pat1' } as any)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: 'apt1', patientId: 'pat-OTHER' } as any)

    const res = await POST(
      makeRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: { ...createBody, appointmentId: 'apt1' },
      }),
      {}
    )

    expect(res.status).toBe(400)
    expect(prisma.invoice.create).not.toHaveBeenCalled()
  })

  it('rejects a treatment plan belonging to another patient (400)', async () => {
    const { POST } = await import('@/app/api/invoices/route')
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ id: 'pat1' } as any)
    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({ id: 'plan1', patientId: 'pat-OTHER' } as any)

    const res = await POST(
      makeRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: { ...createBody, treatmentPlanId: 'plan1' },
      }),
      {}
    )

    expect(res.status).toBe(400)
    expect(prisma.invoice.create).not.toHaveBeenCalled()
  })
})

// ── POST /api/invoices/[id]/payments — attribution (Phase 12) ────────────────
describe('POST /api/invoices/[id]/payments (Phase 12 attribution)', () => {
  it('records patientId + recordedById on the payment and stamps invoice.paidAt on full payment', async () => {
    const { POST } = await import('@/app/api/invoices/[id]/payments/route')
    const fullInvoice = { ...baseInvoice, status: 'ISSUED', paidAmount: 0, balanceAmount: 1140, totalAmount: 1140 }
    vi.mocked(prisma.invoice.findUnique)
      .mockResolvedValueOnce(fullInvoice as any)
      .mockResolvedValueOnce({ ...fullInvoice, paidAmount: 1140, balanceAmount: 0, status: 'PAID', paidAt: new Date() } as any)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay1', amount: 1140 } as any)
    vi.mocked(prisma.invoice.update).mockResolvedValue(fullInvoice as any)
    mockGeneratePaymentNo.mockResolvedValue('PAY-0001')

    const res = await POST(
      makeRequest('http://localhost/api/invoices/inv1/payments', {
        method: 'POST',
        body: { amount: 1140, paymentMethod: 'CASH', paymentDate: '2026-09-10' },
      }),
      { params: Promise.resolve({ id: 'inv1' }) }
    )

    expect(res.status).toBe(201)
    const createArg = vi.mocked(prisma.payment.create).mock.calls[0][0]
    expect(createArg.data.patientId).toBe('pat1')
    expect(createArg.data.recordedById).toBe('user1')
    // paidAt stamped on the transition to PAID
    expect(vi.mocked(prisma.invoice.update).mock.calls[0][0].data).toMatchObject({
      status: 'PAID',
      paidAt: expect.any(Date),
    })
  })

  it('partial payment keeps ISSUED status without a paidAt stamp', async () => {
    const { POST } = await import('@/app/api/invoices/[id]/payments/route')
    const fullInvoice = { ...baseInvoice, status: 'ISSUED' }
    vi.mocked(prisma.invoice.findUnique)
      .mockResolvedValueOnce(fullInvoice as any)
      .mockResolvedValueOnce({ ...fullInvoice, status: 'PARTIALLY_PAID' } as any)
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'pay1' } as any)
    vi.mocked(prisma.invoice.update).mockResolvedValue(fullInvoice as any)
    mockGeneratePaymentNo.mockResolvedValue('PAY-0002')

    const res = await POST(
      makeRequest('http://localhost/api/invoices/inv1/payments', {
        method: 'POST',
        body: { amount: 500, paymentMethod: 'CASH', paymentDate: '2026-09-10' },
      }),
      { params: Promise.resolve({ id: 'inv1' }) }
    )

    expect(res.status).toBe(201)
    const updateArg = vi.mocked(prisma.invoice.update).mock.calls[0][0]
    expect(updateArg.data.status).toBe('PARTIALLY_PAID')
    expect(updateArg.data.paidAt).toBeUndefined()
  })
})

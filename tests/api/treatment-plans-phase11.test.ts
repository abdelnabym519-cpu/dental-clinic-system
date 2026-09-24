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

describe('PATCH /api/treatment-plans/[id] (Phase 11 status machine)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves DRAFT → PROPOSED', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'DRAFT',
    } as any)
    vi.mocked(prisma.treatmentPlan.update).mockResolvedValue({
      id: 'tp1',
      status: 'PROPOSED',
    } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1', {
      method: 'PATCH',
      body: { status: 'PROPOSED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(200)
    expect(prisma.treatmentPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROPOSED' }) })
    )
  })

  it('rejects an invalid transition (DRAFT → COMPLETED)', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'DRAFT',
    } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1', {
      method: 'PATCH',
      body: { status: 'COMPLETED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(400)
    expect(prisma.treatmentPlan.update).not.toHaveBeenCalled()
  })

  it('rejects leaving a terminal state (COMPLETED → IN_PROGRESS)', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'COMPLETED',
    } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1', {
      method: 'PATCH',
      body: { status: 'IN_PROGRESS' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(400)
  })

  it('setting consentGiven also stamps consentDate', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'PROPOSED',
      consentGiven: false,
    } as any)
    vi.mocked(prisma.treatmentPlan.update).mockResolvedValue({
      id: 'tp1',
      consentGiven: true,
    } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1', {
      method: 'PATCH',
      body: { consentGiven: true },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(200)
    const dataArg = vi.mocked(prisma.treatmentPlan.update).mock.calls[0][0].data as Record<
      string,
      unknown
    >
    expect(dataArg.consentGiven).toBe(true)
    expect(dataArg.consentDate).toBeInstanceOf(Date)
  })

  it('is DOCTOR/ADMIN only (RECEPTIONIST → 403)', async () => {
    await as('RECEPTIONIST')
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/route')

    const req = makeRequest('http://localhost/api/treatment-plans/tp1', {
      method: 'PATCH',
      body: { status: 'PROPOSED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(403)
    expect(prisma.treatmentPlan.findFirst).not.toHaveBeenCalled()
  })

  it('404 for a plan outside the tenant', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/treatment-plans/nope', {
      method: 'PATCH',
      body: { status: 'PROPOSED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'nope' }) })

    expect(res.status).toBe(404)
  })
})

describe('POST /api/treatment-plans — Phase 11 appointment link + doctor attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the appointment and attributes the acting doctor', async () => {
    await as('DOCTOR', 'u-1')
    const { POST } = await import('@/app/api/treatment-plans/route')

    vi.mocked(prisma.patient.findFirst).mockResolvedValue({ id: 'p1' } as any)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: 'a1' } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-1' } as any)
    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue(null) // number generation
    vi.mocked(prisma.treatmentPlan.create).mockResolvedValue({ id: 'tp1', status: 'DRAFT' } as any)

    const req = makeRequest('http://localhost/api/treatment-plans', {
      method: 'POST',
      body: { patientId: 'p1', title: 'Phase 11 plan', appointmentId: 'a1' },
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    const dataArg = vi.mocked(prisma.treatmentPlan.create).mock.calls[0][0].data as Record<
      string,
      unknown
    >
    expect(dataArg.appointmentId).toBe('a1')
    expect(dataArg.doctorId).toBe('st-1')
  })

  it('rejects an appointment that belongs to a different patient (400)', async () => {
    await as()
    const { POST } = await import('@/app/api/treatment-plans/route')

    vi.mocked(prisma.patient.findFirst).mockResolvedValue({ id: 'p1' } as any)
    // Appointment found but for another patient → the route filters by patientId,
    // so findFirst returns null for the wrong pairing.
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/treatment-plans', {
      method: 'POST',
      body: { patientId: 'p1', title: 'Bad link', appointmentId: 'a9' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(prisma.treatmentPlan.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/treatment-plans/[id]/items (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds a procedure item and keeps the plan totals in sync', async () => {
    await as()
    const { POST } = await import('@/app/api/treatment-plans/[id]/items/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'DRAFT',
    } as any)
    vi.mocked(prisma.procedure.findFirst).mockResolvedValue({
      id: 'proc1',
      basePrice: 5000,
      defaultDuration: 60,
    } as any)
    vi.mocked(prisma.treatmentPlanItem.create).mockResolvedValue({ id: 'it1' } as any)
    vi.mocked(prisma.treatmentPlanItem.findMany).mockResolvedValue([
      // the item without its own cost falls back to the procedure base price
      { estimatedCost: null, procedure: { basePrice: 5000, defaultDuration: 60 } },
    ] as any)
    vi.mocked(prisma.treatmentPlan.update).mockResolvedValue({ id: 'tp1' } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1/items', {
      method: 'POST',
      body: { procedureId: 'proc1', toothNumbers: '16' },
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(201)
    expect(prisma.treatmentPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estimatedCost: 5000, estimatedDuration: 60 }),
      })
    )
  })

  it('rejects new items on terminal plans (409)', async () => {
    await as()
    const { POST } = await import('@/app/api/treatment-plans/[id]/items/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'COMPLETED',
    } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1/items', {
      method: 'POST',
      body: { procedureId: 'proc1' },
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(409)
  })

  it('404 for a procedure outside the tenant catalog', async () => {
    await as()
    const { POST } = await import('@/app/api/treatment-plans/[id]/items/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'DRAFT',
    } as any)
    vi.mocked(prisma.procedure.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1/items', {
      method: 'POST',
      body: { procedureId: 'ghost' },
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(404)
  })

  it('400 without procedureId', async () => {
    await as()
    const { POST } = await import('@/app/api/treatment-plans/[id]/items/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'DRAFT',
    } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1/items', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'tp1' }) })

    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/treatment-plans/[id]/items/[itemId] (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toggles the item status (COMPLETED)', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/items/[itemId]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'IN_PROGRESS',
    } as any)
    vi.mocked(prisma.treatmentPlanItem.findFirst).mockResolvedValue({ id: 'it1' } as any)
    vi.mocked(prisma.treatmentPlanItem.update).mockResolvedValue({
      id: 'it1',
      status: 'COMPLETED',
    } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1/items/it1', {
      method: 'PATCH',
      body: { status: 'COMPLETED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1', itemId: 'it1' }) })

    expect(res.status).toBe(200)
    expect(prisma.treatmentPlanItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    )
  })

  it('rejects an unknown item status (400)', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/items/[itemId]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'IN_PROGRESS',
    } as any)
    vi.mocked(prisma.treatmentPlanItem.findFirst).mockResolvedValue({ id: 'it1' } as any)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1/items/it1', {
      method: 'PATCH',
      body: { status: 'FINISHED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1', itemId: 'it1' }) })

    expect(res.status).toBe(400)
    expect(prisma.treatmentPlanItem.update).not.toHaveBeenCalled()
  })

  it('404 for an item that does not belong to the plan', async () => {
    await as()
    const { PATCH } = await import('@/app/api/treatment-plans/[id]/items/[itemId]/route')

    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp1',
      hospitalId: 'h1',
      status: 'IN_PROGRESS',
    } as any)
    vi.mocked(prisma.treatmentPlanItem.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/treatment-plans/tp1/items/ghost', {
      method: 'PATCH',
      body: { status: 'COMPLETED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'tp1', itemId: 'ghost' }) })

    expect(res.status).toBe(404)
  })
})

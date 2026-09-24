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

describe('POST /api/clinical-notes (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a note: patientId from the appointment, doctorId from the actor staff record', async () => {
    await as('DOCTOR', 'u-1')
    const { POST } = await import('@/app/api/clinical-notes/route')

    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: 'a1',
      patientId: 'p1',
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-1' } as any)
    vi.mocked(prisma.clinicalNote.create).mockResolvedValue({
      id: 'n1',
      content: 'Exam notes',
    } as any)

    const req = makeRequest('http://localhost/api/clinical-notes', {
      method: 'POST',
      body: {
        appointmentId: 'a1',
        content: 'Exam notes',
        noteType: 'EXAMINATION',
        isPrivate: true,
      },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    const dataArg = vi.mocked(prisma.clinicalNote.create).mock.calls[0][0].data as Record<
      string,
      unknown
    >
    expect(dataArg.patientId).toBe('p1') // derived, never client-trusted
    expect(dataArg.doctorId).toBe('st-1') // actor attribution
    expect(dataArg.isPrivate).toBe(true)
    expect(dataArg.noteType).toBe('EXAMINATION')
  })

  it('400 without content', async () => {
    await as()
    const { POST } = await import('@/app/api/clinical-notes/route')

    const req = makeRequest('http://localhost/api/clinical-notes', {
      method: 'POST',
      body: { appointmentId: 'a1', content: '   ' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(prisma.clinicalNote.create).not.toHaveBeenCalled()
  })

  it('404 for an unknown appointment', async () => {
    await as()
    const { POST } = await import('@/app/api/clinical-notes/route')

    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/clinical-notes', {
      method: 'POST',
      body: { appointmentId: 'ghost', content: 'x' },
    })
    const res = await POST(req)

    expect(res.status).toBe(404)
  })

  it('400 when the actor has no staff record (cannot attribute)', async () => {
    await as('DOCTOR', 'u-1')
    const { POST } = await import('@/app/api/clinical-notes/route')

    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: 'a1', patientId: 'p1' } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/clinical-notes', {
      method: 'POST',
      body: { appointmentId: 'a1', content: 'x' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('rejects a treatment plan that belongs to a different patient (400)', async () => {
    await as()
    const { POST } = await import('@/app/api/clinical-notes/route')

    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: 'a1', patientId: 'p1' } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-1' } as any)
    vi.mocked(prisma.treatmentPlan.findFirst).mockResolvedValue({
      id: 'tp9',
      patientId: 'someone-else',
    } as any)

    const req = makeRequest('http://localhost/api/clinical-notes', {
      method: 'POST',
      body: { appointmentId: 'a1', content: 'x', treatmentPlanId: 'tp9' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('is DOCTOR/ADMIN only (RECEPTIONIST → 403)', async () => {
    await as('RECEPTIONIST')
    const { POST } = await import('@/app/api/clinical-notes/route')

    const req = makeRequest('http://localhost/api/clinical-notes', {
      method: 'POST',
      body: { appointmentId: 'a1', content: 'x' },
    })
    const res = await POST(req)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/clinical-notes — private-note RBAC (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.clinicalNote.findMany).mockResolvedValue([])
  })

  it('DOCTOR sees everything (no isPrivate filter)', async () => {
    await as('DOCTOR')
    const { GET } = await import('@/app/api/clinical-notes/route')

    const req = makeRequest('http://localhost/api/clinical-notes?appointmentId=a1')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const where = vi.mocked(prisma.clinicalNote.findMany).mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where.hospitalId).toBe('h1')
    expect(where.appointmentId).toBe('a1')
    expect(where.isPrivate).toBeUndefined()
  })

  it('RECEPTIONIST never sees private notes (isPrivate=false enforced server-side)', async () => {
    await as('RECEPTIONIST')
    const { GET } = await import('@/app/api/clinical-notes/route')

    const req = makeRequest('http://localhost/api/clinical-notes?patientId=p1')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const where = vi.mocked(prisma.clinicalNote.findMany).mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where.isPrivate).toBe(false)
  })

  it('400 without appointmentId or patientId', async () => {
    await as()
    const { GET } = await import('@/app/api/clinical-notes/route')

    const req = makeRequest('http://localhost/api/clinical-notes')
    const res = await GET(req)

    expect(res.status).toBe(400)
    expect(prisma.clinicalNote.findMany).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/clinical-notes/[id] — author-only, 24h window (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('the author can edit within 24h', async () => {
    await as('DOCTOR', 'u-1')
    const { PATCH } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue({
      id: 'n1',
      hospitalId: 'h1',
      doctorId: 'st-1',
      createdAt: new Date(Date.now() - 3600_000),
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-1' } as any)
    vi.mocked(prisma.clinicalNote.update).mockResolvedValue({ id: 'n1' } as any)

    const req = makeRequest('http://localhost/api/clinical-notes/n1', {
      method: 'PATCH',
      body: { content: 'corrected note', noteType: 'TREATMENT' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'n1' }) })

    expect(res.status).toBe(200)
    expect(prisma.clinicalNote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'corrected note', noteType: 'TREATMENT' }),
      })
    )
  })

  it('a different doctor is forbidden (403)', async () => {
    await as('DOCTOR', 'u-2')
    const { PATCH } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue({
      id: 'n1',
      hospitalId: 'h1',
      doctorId: 'st-1',
      createdAt: new Date(),
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-2' } as any)

    const req = makeRequest('http://localhost/api/clinical-notes/n1', {
      method: 'PATCH',
      body: { content: 'not mine' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'n1' }) })

    expect(res.status).toBe(403)
  })

  it('edits are rejected after the 24h integrity window (409)', async () => {
    await as('DOCTOR', 'u-1')
    const { PATCH } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue({
      id: 'n1',
      hospitalId: 'h1',
      doctorId: 'st-1',
      createdAt: new Date(Date.now() - 25 * 3600_000),
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-1' } as any)

    const req = makeRequest('http://localhost/api/clinical-notes/n1', {
      method: 'PATCH',
      body: { content: 'too late' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'n1' }) })

    expect(res.status).toBe(409)
    expect(prisma.clinicalNote.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid noteType (400)', async () => {
    await as('DOCTOR', 'u-1')
    const { PATCH } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue({
      id: 'n1',
      hospitalId: 'h1',
      doctorId: 'st-1',
      createdAt: new Date(),
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-1' } as any)

    const req = makeRequest('http://localhost/api/clinical-notes/n1', {
      method: 'PATCH',
      body: { noteType: 'RAMBLE' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'n1' }) })

    expect(res.status).toBe(400)
  })

  it('404 for a note outside the tenant', async () => {
    await as()
    const { PATCH } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue(null)

    const req = makeRequest('http://localhost/api/clinical-notes/ghost', {
      method: 'PATCH',
      body: { content: 'x' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'ghost' }) })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/clinical-notes/[id] — author or ADMIN (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('the author doctor can delete', async () => {
    await as('DOCTOR', 'u-1')
    const { DELETE } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue({
      id: 'n1',
      hospitalId: 'h1',
      doctorId: 'st-1',
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-1' } as any)
    vi.mocked(prisma.clinicalNote.delete).mockResolvedValue({ id: 'n1' } as any)

    const req = makeRequest('http://localhost/api/clinical-notes/n1', { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'n1' }) })

    expect(res.status).toBe(200)
    expect(prisma.clinicalNote.delete).toHaveBeenCalledWith({ where: { id: 'n1' } })
  })

  it('an ADMIN can delete someone else\u2019s note', async () => {
    await as('ADMIN', 'u-9')
    const { DELETE } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue({
      id: 'n1',
      hospitalId: 'h1',
      doctorId: 'st-1',
    } as any)
    vi.mocked(prisma.clinicalNote.delete).mockResolvedValue({ id: 'n1' } as any)

    const req = makeRequest('http://localhost/api/clinical-notes/n1', { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'n1' }) })

    expect(res.status).toBe(200)
    // admin path does not even consult the actor staff record
    expect(prisma.staff.findFirst).not.toHaveBeenCalled()
  })

  it('another doctor is forbidden (403)', async () => {
    await as('DOCTOR', 'u-2')
    const { DELETE } = await import('@/app/api/clinical-notes/[id]/route')

    vi.mocked(prisma.clinicalNote.findFirst).mockResolvedValue({
      id: 'n1',
      hospitalId: 'h1',
      doctorId: 'st-1',
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'st-2' } as any)

    const req = makeRequest('http://localhost/api/clinical-notes/n1', { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'n1' }) })

    expect(res.status).toBe(403)
    expect(prisma.clinicalNote.delete).not.toHaveBeenCalled()
  })
})

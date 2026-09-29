/**
 * Phase 2 — E2E: POST /api/ai/context (developer Context Inspector).
 *
 * Exercises the real route handler against a prisma-shaped fake (real
 * where/orderBy/take semantics) with mocked session auth:
 *  - dev-only gate (production → 403),
 *  - auth required,
 *  - input validation (patientId/profile/tooth FDI),
 *  - structured context + serialization in the response,
 *  - PATIENT self-scope through the full route,
 *  - cross-tenant patient id → not_found, never a leak.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakePrisma, HOSP_A, PAT_A1, ACTORS } from '@/tests/harness/context-fixtures'

// NOTE: vi.hoisted runs BEFORE this file's imports initialize — only literals
// (or other hoisted values) may be referenced inside. Fixture constants are
// applied in beforeEach instead.
const mockAuth = vi.hoisted(() => {
  const state = {
    error: null as unknown,
    hospitalId: 'hosp-A',
    user: { id: 'staff-doctor-1', role: 'DOCTOR', name: 'Hana Shalaby' } as any,
  }
  const requireAuthAndRole = vi.fn(async () => {
    if (state.error) return { error: state.error, user: null, hospitalId: null, session: null }
    return { error: null, user: state.user, hospitalId: state.hospitalId, session: { user: state.user } }
  })
  return { requireAuthAndRole, state }
})

vi.mock('@/lib/api-helpers', () => mockAuth)

// The prisma mock resolves LAZILY through a hoisted holder, so the fake can be
// swapped per-test without re-evaluating the mock factory.
const prismaHolder = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return prismaHolder.current
  },
  get default() {
    return prismaHolder.current
  },
}))

let fake: ReturnType<typeof createFakePrisma>

function setPrisma(f: unknown) {
  prismaHolder.current = f
}

function makeRequest(body: unknown, url = 'http://localhost/api/ai/context') {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function loadRoute() {
  return import('@/app/api/ai/context/route')
}

describe('POST /api/ai/context (Phase 2 Context Inspector)', () => {
  beforeEach(() => {
    fake = createFakePrisma()
    setPrisma(fake)
    mockAuth.state.error = null
    mockAuth.state.hospitalId = HOSP_A
    mockAuth.state.user = { id: ACTORS.doctorA.id, role: 'DOCTOR', name: ACTORS.doctorA.name }
  })

  it('is disabled in production (403, dev/test only)', async () => {
    const original = process.env.NODE_ENV
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { POST } = await loadRoute()
      const res = await POST(makeRequest({ patientId: PAT_A1 }))
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('Context inspector is only available in development')
    } finally {
      vi.unstubAllEnvs()
      process.env.NODE_ENV = original
    }
  })

  it('requires authentication', async () => {
    mockAuth.state.error = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ patientId: PAT_A1 }))
    expect(res.status).toBe(401)
  })

  it('validates input: patientId, profile, toothFdi', async () => {
    const { POST } = await loadRoute()
    expect((await POST(makeRequest({}))).status).toBe(400)
    expect((await POST(makeRequest({ patientId: PAT_A1, profile: 'NOPE' }))).status).toBe(400)
    expect((await POST(makeRequest({ patientId: PAT_A1, toothFdi: 99 }))).status).toBe(400)
    const badJson = new Request('http://localhost/api/ai/context', { method: 'POST', body: '{oops' })
    expect((await POST(badJson)).status).toBe(400)
  })

  it('returns the structured context AND its serialization, with scope + provenance + budget stats', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ patientId: PAT_A1, profile: 'CLINICAL' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.context.meta.profile).toBe('CLINICAL')
    expect(body.context.meta.tenantId).toBe(HOSP_A)
    expect(body.context.meta.patient.found).toBe(true)
    expect(body.context.meta.patient.patientId).toBe('PAT-A1')
    expect(body.context.meta.role).toBe('DOCTOR')
    expect(body.context.meta.queryCount).toBeGreaterThan(0)
    expect(body.context.meta.constructionMs).toBeGreaterThanOrEqual(0)
    expect(body.context.identity.status).toBe('included')
    expect(body.context.cases.data.plans[0].planNumber).toBe('TP-A-501')
    expect(body.context.cases.data.plans[0].provenance.sourceType).toBe('treatment_plan')
    // serialization mirrors the structure
    expect(body.serialized).toContain('PATIENT 360 CLINICAL CONTEXT')
    expect(body.serialized).toContain('Ahmed Ali')
    expect(body.serialized).toContain('<<<DEN_TORA_UNTRUSTED_DATA')
  })

  it('tooth scope through the route: TOOTH profile + toothFdi', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ patientId: PAT_A1, profile: 'TOOTH', toothFdi: 36 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.context.meta.scope.toothFdi).toBe(36)
    expect(body.context.dental.data.active.map((t: any) => t.toothFdi)).toEqual([36])
    expect(body.serialized).not.toContain('TRT-A-702')
  })

  it('PATIENT actor through the route: own record only, minimal sections', async () => {
    mockAuth.state.user = { id: ACTORS.patientA.id, role: 'PATIENT', name: 'Ahmed' }
    const { POST } = await loadRoute()
    const own = await POST(makeRequest({ patientId: PAT_A1, profile: 'PATIENT_OVERVIEW' }))
    expect(own.status).toBe(200)
    const ownBody = await own.json()
    expect(ownBody.context.meta.patient.found).toBe(true)
    expect(ownBody.context.identity.status).toBe('included')
    expect(ownBody.context.clinical.status).toBe('excluded')
    expect(ownBody.serialized).not.toContain('TENANT-A-PRIVATE')
    expect(ownBody.serialized).not.toContain('Metformin')

    const other = await POST(makeRequest({ patientId: 'pat-A2', profile: 'PATIENT_OVERVIEW' }))
    const otherBody = await other.json()
    expect(otherBody.context.meta.patient.reason).toBe('unauthorized')
  })

  it('cross-tenant identifier through the route → not_found, no leak', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ patientId: 'pat-B1', profile: 'FULL_360' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.context.meta.patient.found).toBe(false)
    expect(body.context.meta.patient.reason).toBe('not_found')
    expect(body.serialized).not.toContain('Omar Farouk')
    expect(body.serialized).not.toContain('TENANT-B-SECRET')
  })

  it('build failure → 500 with a translatable error (fail closed, no partial context)', async () => {
    // simulate an exploding delegate
    setPrisma({
      ...createFakePrisma(),
      dentalChartEntry: { findMany: async () => { throw new Error('db down') } },
    })
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ patientId: PAT_A1, profile: 'CLINICAL' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Context build failed')
  })
})

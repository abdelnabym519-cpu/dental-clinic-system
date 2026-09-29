// @ts-nocheck
/**
 * Phase 4 — Knowledge admin API route (§30): session-resolved admin actor,
 * tenant-pinned scope, deterministic typed ingestion, patient-data rejection,
 * duplicate rejection, version replacement, tenant isolation, audit.
 * Prisma is a forwarder over an in-memory knowledge delegate fake
 * (same pattern as the Phase 3 agent route tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({
  requireAuth: null,
  auditCreate: [],
  kb: null,
}))

// ---------------------------------------------------------------------------
// In-memory prisma-shaped fake for the knowledge delegates.
// ---------------------------------------------------------------------------
function makeKnowledgeFake() {
  let sources = []
  let documents = []
  let chunks = []
  let autoN = 0

  const match = (row, where) => {
    if (!where) return true
    return Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return v.some((sub) => match(row, sub))
      if (k === 'AND') return v.every((sub) => match(row, sub))
      if (v && typeof v === 'object' && !Array.isArray(v) && 'in' in v) return v.in.includes(row[k])
      return row[k] === v
    })
  }

  const delegate = (getRows) => ({
    findFirst: async ({ where } = {}) => getRows().find((r) => match(r, where)) ?? null,
    findMany: async ({ where } = {}) => getRows().filter((r) => match(r, where)),
    create: async ({ data }) => {
      const row = { ...(data ?? {}) }
      if (!row.id) row.id = `kauto-${++autoN}`
      if (!row.createdAt) row.createdAt = new Date('2026-09-29T12:00:00Z')
      getRows().push(row)
      return row
    },
    createMany: async ({ data }) => {
      const arr = Array.isArray(data) ? data : [data]
      for (const d of arr) getRows().push({ ...d })
      return { count: arr.length }
    },
    update: async ({ where, data }) => {
      const row = getRows().find((r) => match(r, where))
      if (!row) return null
      Object.assign(row, data ?? {})
      return row
    },
    updateMany: async ({ where, data }) => {
      let count = 0
      for (const r of getRows()) {
        if (match(r, where)) { Object.assign(r, data ?? {}); count++ }
      }
      return { count }
    },
  })

  const client = {
    knowledgeSource: delegate(() => sources),
    knowledgeDocument: delegate(() => documents),
    knowledgeChunk: delegate(() => chunks),
  }
  client.$transaction = async (fn) => {
    const snapS = [...sources]
    const snapD = [...documents]
    const snapC = [...chunks]
    try {
      return await fn(client)
    } catch (e) {
      sources = snapS
      documents = snapD
      chunks = snapC
      throw e
    }
  }
  return {
    client,
    rows: () => ({ sources, documents, chunks }),
  }
}

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return Object.assign(store.kb.client, {
      auditLog: {
        count: async () => 0,
        create: async (args) => { store.auditCreate.push(args); return { id: 'audit-1' } },
      },
    })
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  // Enforces the allowed-roles argument exactly like the real helper.
  requireAuthAndRole: async (allowedRoles) => {
    const r = store.requireAuth
    if (r.error) return r
    if (allowedRoles && r.user && !allowedRoles.includes(r.user.role)) {
      return {
        error: Response.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return r
  },
}))

import { GET, POST } from '@/app/api/ai/knowledge/route'

const ADMIN = { id: 'staff-admin-1', name: 'Admin A', role: 'ADMIN' }
const DOCTOR = { id: 'staff-doctor-1', name: 'Hana Shalaby', role: 'DOCTOR' }
const RECEPTIONIST = { id: 'staff-recep-1', name: 'Recep A', role: 'RECEPTIONIST' }
const HOSP_A = 'HOSP-A'
const HOSP_B = 'HOSP-B'

function json(body) {
  return new Request('http://localhost/api/ai/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function auth(user, hospitalId, error = null) {
  store.requireAuth = { error, user, hospitalId }
}

const GUIDELINE = {
  sourceKey: 'route-test-periodontitis-guideline',
  title: 'Route Test Periodontitis Guideline TEST DATA',
  publisher: 'Route Test National Dental Board (TEST)',
  sourceType: 'GUIDELINE',
  authorityTier: 'TIER_1',
  domain: 'PERIODONTOLOGY',
  language: 'en',
  publicationDate: '2024-06-01',
  reference: 'https://example.test/guideline',
  scope: 'GLOBAL',
}

const GUIDELINE_CONTENT = [
  '# Route Test Periodontitis Guideline (TEST DATA)',
  '',
  '## Diagnostic Criteria',
  '',
  'Periodontitis is diagnosed when probing depths exceed 4 mm together with',
  'clinical attachment loss and radiographic bone loss. Gingival bleeding on',
  'probing supports the diagnosis in active disease.',
  '',
  '## Treatment',
  '',
  'Non-surgical therapy with scaling and root planing is first-line for all',
  'probing depths. Re-evaluation is scheduled after the healing phase.',
].join('\n')

beforeEach(() => {
  store.kb = makeKnowledgeFake()
  store.auditCreate.length = 0
  auth(ADMIN, HOSP_A)
})

// ===========================================================================
// INGESTION
// ===========================================================================

describe('POST /api/ai/knowledge — ingestion', () => {
  it('admin ingests a guideline → PUBLISHED report, listed on GET, audit written', async () => {
    const res = await POST(json({ source: { ...GUIDELINE }, content: GUIDELINE_CONTENT }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.report.status).toBe('PUBLISHED')
    expect(body.report.failure).toBeNull()
    expect(body.report.chunkCount).toBeGreaterThan(0)

    const list = await (await GET()).json()
    expect(list.hospitalId).toBe(HOSP_A)
    const src = list.sources.find((s) => s.sourceKey === GUIDELINE.sourceKey)
    expect(src).toBeTruthy()
    expect(src.authorityTier).toBe('TIER_1')
    expect(src.domain).toBe('PERIODONTOLOGY')
    expect(src.documents.length).toBe(1)
    expect(src.documents[0].status).toBe('PUBLISHED')

    expect(store.auditCreate.length).toBe(1)
    expect(store.auditCreate[0].data.action).toBe('AI_KNOWLEDGE_INGEST')
    expect(store.auditCreate[0].data.hospitalId).toBe(HOSP_A)
    // audit carries no content
    expect(JSON.stringify(store.auditCreate[0])).not.toContain('probing depths')
  })

  it('duplicate content → REJECTED DUPLICATE_CONTENT, nothing published', async () => {
    await POST(json({ source: { ...GUIDELINE }, content: GUIDELINE_CONTENT }))
    const dup = await POST(json({
      source: { ...GUIDELINE, sourceKey: 'route-test-mirror', title: 'Mirror (TEST)' },
      content: GUIDELINE_CONTENT,
    }))
    const dupBody = await dup.json()
    expect(dupBody.report.status).toBe('REJECTED')
    expect(dupBody.report.failure.code).toBe('DUPLICATE_CONTENT')
    const list = await (await GET()).json()
    expect(list.sources.find((s) => s.sourceKey === 'route-test-mirror')).toBeUndefined()
  })

  it('patient data in content → REJECTED PATIENT_DATA_DETECTED (§8)', async () => {
    const res = await POST(json({
      source: { ...GUIDELINE, sourceKey: 'route-test-patient-leak', sourceType: 'OTHER', authorityTier: 'TIER_3' },
      content: 'Patient PAT_A1 has caries on tooth 36. Patient id: PAT_A1. Chart #4521. Diagnosis: deep caries, plan: root canal treatment.',
    }))
    const body = await res.json()
    expect(body.report.status).toBe('REJECTED')
    expect(body.report.failure.code).toBe('PATIENT_DATA_DETECTED')
    const list = await (await GET()).json()
    expect(list.sources.find((s) => s.sourceKey === 'route-test-patient-leak')).toBeUndefined()
  })

  it('version replacement → new PUBLISHED version, old one SUPERSEDED', async () => {
    await POST(json({ source: { ...GUIDELINE }, content: GUIDELINE_CONTENT }))
    const v2 = [
      '# Route Test Periodontitis Guideline (TEST DATA)',
      '',
      '## Diagnostic Criteria',
      '',
      'In the updated version, probing depths exceeding 5 mm with attachment',
      'loss define advanced periodontitis. The 4 mm threshold applies to',
      'moderate disease only in this revision.',
    ].join('\n')
    const res = await POST(json({ source: { ...GUIDELINE, version: '2' }, content: v2, replaceVersion: true }))
    const body = await res.json()
    expect(body.report.status).toBe('PUBLISHED')
    expect(body.report.supersededDocumentIds.length).toBe(1)

    const list = await (await GET()).json()
    const src = list.sources.find((s) => s.sourceKey === GUIDELINE.sourceKey)
    expect(src.documents.length).toBe(2)
    const statuses = src.documents.map((d) => d.status).sort()
    expect(statuses).toEqual(['PUBLISHED', 'SUPERSEDED'])
  })

  it('TENANT scope is pinned to the session tenant; client hospitalId is ignored', async () => {
    const res = await POST(json({
      source: { ...GUIDELINE, sourceKey: 'route-test-tenant-private', scope: 'TENANT', hospitalId: HOSP_B },
      content: GUIDELINE_CONTENT,
    }))
    expect(res.status).toBe(200)
    const row = store.kb.rows().sources.find((s) => s.sourceKey === 'route-test-tenant-private')
    expect(row.scope).toBe('TENANT')
    expect(row.hospitalId).toBe(HOSP_A) // session tenant, NOT the client-asserted HOSP_B

    // invisible to tenant B, visible to A
    auth(ADMIN, HOSP_B)
    const listB = await (await GET()).json()
    expect(listB.sources.find((s) => s.sourceKey === 'route-test-tenant-private')).toBeUndefined()
    auth(ADMIN, HOSP_A)
    const listA = await (await GET()).json()
    expect(listA.sources.find((s) => s.sourceKey === 'route-test-tenant-private')).toBeTruthy()
  })

  it('400 on missing/invalid input', async () => {
    const noContent = await POST(json({ source: { ...GUIDELINE } }))
    expect(noContent.status).toBe(400) // no content
    const noSource = await POST(json({ content: GUIDELINE_CONTENT }))
    expect(noSource.status).toBe(400) // no source
    const bad = await POST(json({ source: { ...GUIDELINE, authorityTier: 'TIER_9' }, content: GUIDELINE_CONTENT }))
    expect(bad.status).toBe(400)
    const badBody = await bad.json()
    expect(badBody.error).toContain('authorityTier')
    const badDomain = await POST(json({ source: { ...GUIDELINE, domain: 'ROBOTICS' }, content: GUIDELINE_CONTENT }))
    expect(badDomain.status).toBe(400)
    const badLang = await POST(json({ source: { ...GUIDELINE, language: 'fr' }, content: GUIDELINE_CONTENT }))
    expect(badLang.status).toBe(400)
  })

  it('403 for non-admin roles, 401 when unauthenticated', async () => {
    const payload = () => json({ source: { ...GUIDELINE }, content: GUIDELINE_CONTENT })
    auth(DOCTOR, HOSP_A)
    let res = await POST(payload())
    expect(res.status).toBe(403)
    res = await GET()
    expect(res.status).toBe(403)

    auth(RECEPTIONIST, HOSP_A)
    res = await GET()
    expect(res.status).toBe(403)

    const unauthorized = Response.json({ error: 'Unauthorized' }, { status: 401 })
    auth(null, null, unauthorized)
    res = await GET()
    expect(res.status).toBe(401)
    res = await POST(payload())
    expect(res.status).toBe(401)
  })

  it('400 on invalid JSON', async () => {
    const req = new Request('http://localhost/api/ai/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// @ts-nocheck
/**
 * Phase 8 — Memory API route: session-resolved actor, tenant-pinned scope,
 * re-validated scope columns, USER_CONFIRMED-only API writes, typed
 * machine-readable errors, no cross-tenant/cross-patient access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({
  auth: { error: null, user: null, hospitalId: 'hosp-A' },
}))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: async () => ({ ...store.auth }),
}))

function makePrismaFake() {
  const patients = [
    { id: 'PAT-A1', hospitalId: 'hosp-A', firstName: 'Ahmed', lastName: 'Ali', portalUser: { id: 'user-pat' } },
    { id: 'PAT-A2', hospitalId: 'hosp-A', firstName: 'Laila', lastName: 'Said', portalUser: { id: 'user-2' } },
  ]
  const staff = [{ id: 'staff-1', hospitalId: 'hosp-A', isActive: true }]
  const treatments = [{ id: 'trt-1', hospitalId: 'hosp-A' }]
  const conversations = [{ id: 'conv-1', hospitalId: 'hosp-A', userId: 'user-pat' }]
  const items = []
  const events = []
  let seq = 0

  const match = (row, where) => {
    if (!where) return true
    return Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return v.some((sub) => match(row, sub))
      if (k === 'AND') return v.every((sub) => match(row, sub))
      if (v === null || v === undefined) return row[k] === v
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('is' in v) return row[k] && JSON.stringify(row[k]) === JSON.stringify(v.is) || (v.is && typeof row[k] === 'object' && row[k].id === v.is.id)
        if ('gt' in v) return row[k] > v.gt
        if ('lt' in v) return row[k] < v.lt
        if ('in' in v) return v.in.includes(row[k])
        if ('notIn' in v) return !v.notIn.includes(row[k])
        return true
      }
      return row[k] === v
    })
  }

  const delegate = (rows) => ({
    findFirst: async ({ where } = {}) => rows.find((r) => match(r, where)) ?? null,
    findMany: async ({ where } = {}) => rows.filter((r) => match(r, where)),
    findUnique: async ({ where } = {}) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }) => {
      const row = { ...data, id: data.id ?? `m-${++seq}`, createdAt: new Date(), updatedAt: new Date() }
      rows.push(row)
      return row
    },
    update: async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id)
      if (!row) return null
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
  })

  const memDelegate = delegate(items)
  memDelegate.create = async ({ data }) => {
    const row = { ...data, id: `mem-${++seq}`, createdAt: new Date('2026-09-30T12:00:00Z'), updatedAt: new Date('2026-09-30T12:00:00Z'), status: 'ACTIVE' }
    items.push(row)
    return row
  }
  const evDelegate = delegate(events)
  evDelegate.create = async ({ data }) => {
    const row = { ...data, id: `ev-${++seq}`, createdAt: new Date('2026-09-30T12:00:00Z') }
    events.push(row)
    return row
  }

  return {
    patients, items, events,
    patient: delegate(patients),
    staff: delegate(staff),
    treatment: delegate(treatments),
    aIConversation: delegate(conversations),
    aiMemoryItem: memDelegate,
    aiMemoryEvent: evDelegate,
  }
}

let fake: ReturnType<typeof makePrismaFake>

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fake
  },
}))

import { POST } from '@/app/api/ai/memory/route'

const PATIENT = { id: 'user-pat', name: 'Ahmed', role: 'PATIENT' }
const DOCTOR = { id: 'user-doc', name: 'Dr. A', role: 'DOCTOR' }
const STRANGER = { id: 'user-2', name: 'Laila', role: 'PATIENT' }

function req(body: unknown) {
  return new Request('http://localhost/api/ai/memory', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fake = makePrismaFake()
  store.auth = { error: null, user: PATIENT, hospitalId: 'hosp-A' }
})

describe('memory API route', () => {
  it('401 without a session', async () => {
    store.auth = { error: new Response('unauthorized', { status: 401 }), user: null, hospitalId: null }
    const res = await POST(req({ op: 'list', domain: 'PATIENT', patientId: 'PAT-A1' }))
    expect(res.status).toBe(401)
  })

  it('a patient writes their own preference (201) with retention + provenance', async () => {
    const res = await POST(req({
      op: 'write',
      domain: 'PATIENT',
      patientId: 'PAT-A1',
      key: 'pref.language',
      value: { text: 'Arabic' },
      memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED',
      sourceKind: 'USER_STATEMENT',
    }))
    expect(res.status).toBe(201)
    const item = fake.items[0]
    expect(item.trustLevel).toBe('USER_PROVIDED')
    expect(JSON.parse(item.value)).toEqual({ text: 'Arabic' })
    expect(item.createdBy).toBe('user-pat')
    expect(item.hospitalId).toBe('hosp-A')
    expect(item.expiresAt).toBeTruthy() // retention applied (PATIENT default 730d)
  })

  it('a patient cannot write for another patient (tenant-validated scope)', async () => {
    const res = await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A2',
      key: 'pref.language', value: { text: 'x' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
    }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('MEMORY_SCOPE_MISMATCH')
  })

  it('a patient cannot write CLINIC domain', async () => {
    const res = await POST(req({
      op: 'write', domain: 'CLINIC',
      key: 'rule.hours', value: { open: '09:00' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
    }))
    expect(res.status).toBe(404)
  })

  it('API writes accept USER_CONFIRMED only (no client trust escalation)', async () => {
    store.auth = { error: null, user: DOCTOR, hospitalId: 'hosp-A' }
    const res = await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A1',
      key: 'note.clinical', value: { text: 'x' }, memoryType: 'STRUCTURED',
      writeClass: 'DOCTOR_CONFIRMED', sourceKind: 'USER_CONFIRMATION',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('MEMORY_WRITE_CLASS_MISMATCH')
  })

  it('unsourced confidence is rejected with a typed error', async () => {
    const res = await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A1',
      key: 'pref.slot', value: { text: 'morning' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
      confidence: { value: 0.9 },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('MEMORY_CONFIDENCE_INVALID')
  })

  it('duplicate active (scope+key+trust) → 409, correct instead', async () => {
    await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A1',
      key: 'pref.language', value: { text: 'Arabic' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
    }))
    const res = await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A1',
      key: 'pref.language', value: { text: 'English' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('MEMORY_DUPLICATE_ACTIVE')
  })

  it('a doctor corrects (supersedes) with DOCTOR_CONFIRMED trust; original preserved', async () => {
    await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A1',
      key: 'pref.language', value: { text: 'Arabic' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
    }))
    store.auth = { error: null, user: DOCTOR, hospitalId: 'hosp-A' }
    const old = fake.items[0]
    const res = await POST(req({
      op: 'correct', domain: 'PATIENT', patientId: 'PAT-A1',
      id: old.id, value: { text: 'English' }, reason: 'patient confirmed',
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.superseded).toBe(old.id)
    const original = fake.items.find((i) => i.id === old.id)
    expect(original.status).toBe('SUPERSEDED')
    expect(JSON.parse(original.value)).toEqual({ text: 'Arabic' }) // content preserved
  })

  it('a patient lists only their own items (no cross-patient leakage)', async () => {
    await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A1',
      key: 'pref.language', value: { text: 'Arabic' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
    }))
    // Laila (another patient) sees nothing of Ahmed's.
    store.auth = { error: null, user: STRANGER, hospitalId: 'hosp-A' }
    const res = await POST(req({ op: 'list', domain: 'PATIENT', patientId: 'PAT-A2' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(0)
    // Ahmed sees their own.
    store.auth = { error: null, user: PATIENT, hospitalId: 'hosp-A' }
    const mine = await POST(req({ op: 'list', domain: 'PATIENT', patientId: 'PAT-A1' }))
    expect((await mine.json()).items).toHaveLength(1)
  })

  it('delete is permission-checked and audited', async () => {
    await POST(req({
      op: 'write', domain: 'PATIENT', patientId: 'PAT-A1',
      key: 'pref.slot', value: { text: 'morning' }, memoryType: 'STRUCTURED',
      writeClass: 'USER_CONFIRMED', sourceKind: 'USER_STATEMENT',
    }))
    const id = fake.items[0].id
    // Stranger cannot touch Ahmed's scope (scope validation precedes
    // permission checks; 404 by design — no existence leak).
    store.auth = { error: null, user: STRANGER, hospitalId: 'hosp-A' }
    const denied = await POST(req({ op: 'delete', domain: 'PATIENT', patientId: 'PAT-A1', id, reason: 'x' }))
    expect(denied.status).toBe(404)
    expect((await denied.json()).error.code).toBe('MEMORY_SCOPE_MISMATCH')
    // Owner can.
    store.auth = { error: null, user: PATIENT, hospitalId: 'hosp-A' }
    const ok = await POST(req({ op: 'delete', domain: 'PATIENT', patientId: 'PAT-A1', id, reason: 'patient request' }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).status).toBe('DELETED')
    const evs = fake.events.filter((e) => e.memoryId === id)
    expect(evs.map((e) => e.eventKind)).toEqual(['WRITE', 'DELETE'])
  })
})

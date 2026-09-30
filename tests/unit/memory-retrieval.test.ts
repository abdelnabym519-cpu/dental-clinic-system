/**
 * Phase 8 — memory retrieval (scoping, budget, trust filter, staleness,
 * provenance rendering, candidate handling).
 */

import { describe, expect, it } from 'vitest'
import { InMemoryMemoryStore } from '@/lib/ai/memory/store'
import { serializeMemoryBlock } from '@/lib/ai/memory/retrieval'
import { planMemoryRetrieval, hasMemoryIntent, extractUserPreferenceStatement } from '@/lib/ai/memory/orchestrator'
import type { MemoryActor, MemoryScope } from '@/lib/ai/memory/types'

const HOSP_A = 'hosp-A'
const HOSP_B = 'hosp-B'
const NOW = new Date('2026-09-30T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const user: MemoryActor = { id: 'user-1', role: 'PATIENT' }
const doc: MemoryActor = { id: 'doc-1', role: 'DOCTOR' }
const sys: MemoryActor = { id: 'system', role: 'SYSTEM' }

async function seed() {
  const store = new InMemoryMemoryStore(NOW)
  const pScope: MemoryScope = { hospitalId: HOSP_A, domain: 'PATIENT', patientId: 'PAT-A1' }
  await store.write({
    scope: pScope, key: 'pref.language', value: { text: 'Arabic' }, memoryType: 'STRUCTURED',
    writeClass: 'USER_CONFIRMED', trustLevel: 'USER_PROVIDED', sourceKind: 'USER_STATEMENT', actor: user,
  })
  await store.write({
    scope: pScope, key: 'event.book_appointment', value: { action: 'book_appointment', at: NOW.toISOString() },
    memoryType: 'EPISODIC', writeClass: 'SYSTEM_VERIFIED', trustLevel: 'SYSTEM_DERIVED',
    sourceKind: 'ACTION_RESULT', sourceRef: 'appr-1', actor: sys,
  })
  // Candidate (AI_DERIVED) — must NOT appear in a default clinical retrieval.
  await store.write({
    scope: pScope, key: 'obs.candidate', value: { text: 'mentioned swelling' }, memoryType: 'SEMANTIC',
    writeClass: 'CANDIDATE_MEMORY', trustLevel: 'AI_DERIVED', sourceKind: 'CONVERSATION', actor: user,
  })
  // Another tenant — must never leak.
  await store.write({
    scope: { hospitalId: HOSP_B, domain: 'PATIENT', patientId: 'PAT-B1' }, key: 'pref.language',
    value: { text: 'English' }, memoryType: 'STRUCTURED', writeClass: 'USER_CONFIRMED',
    trustLevel: 'USER_PROVIDED', sourceKind: 'USER_STATEMENT', actor: { id: 'user-b', role: 'PATIENT' },
  })
  // Another patient, same tenant.
  await store.write({
    scope: { hospitalId: HOSP_A, domain: 'PATIENT', patientId: 'PAT-A2' }, key: 'pref.language',
    value: { text: 'English' }, memoryType: 'STRUCTURED', writeClass: 'USER_CONFIRMED',
    trustLevel: 'USER_PROVIDED', sourceKind: 'USER_STATEMENT', actor: { id: 'user-2', role: 'PATIENT' },
  })
  // Expired item — stale memory must not be retrieved.
  await store.write({
    scope: { hospitalId: HOSP_A, domain: 'CONVERSATION', conversationId: 'conv-1' }, key: 'decision.slot',
    value: { text: 'morning preferred' }, memoryType: 'SEMANTIC', writeClass: 'USER_CONFIRMED',
    trustLevel: 'USER_PROVIDED', sourceKind: 'CONVERSATION', actor: user,
    expiresAt: new Date(NOW.getTime() - DAY),
  })
  return store
}

describe('memory retrieval', () => {
  it('is tenant-scoped and patient-scoped (no cross-tenant, no cross-patient)', async () => {
    const store = await seed()
    const block = await store.query({ scope: { hospitalId: HOSP_A, domain: 'PATIENT', patientId: 'PAT-A1' } }, NOW)
    expect(block.items.map((i) => i.key).sort()).toEqual(['event.book_appointment', 'pref.language'])
    // Tenant B and patient A2 values are absent.
    expect(JSON.stringify(block.items)).not.toContain('English')
  })

  it('excludes AI_DERIVED candidates by default and includes them when opted in (labeled)', async () => {
    const store = await seed()
    const scope: MemoryScope = { hospitalId: HOSP_A, domain: 'PATIENT', patientId: 'PAT-A1' }
    const clinical = await store.query({ scope }, NOW)
    expect(clinical.items.some((i) => i.key === 'obs.candidate')).toBe(false)
    expect(clinical.candidateCount).toBe(0)

    const conv = await store.query({ scope, includeCandidate: true }, NOW)
    const cand = conv.items.find((i) => i.key === 'obs.candidate')
    expect(cand).toBeTruthy()
    expect(cand?.candidate).toBe(true)
    expect(cand?.rendered).toContain('UNVERIFIED candidate')
    expect(serializeMemoryBlock(conv)).toContain('never for clinical decisions')
  })

  it('never returns expired (stale) memory', async () => {
    const store = await seed()
    const block = await store.query(
      { scope: { hospitalId: HOSP_A, domain: 'CONVERSATION', conversationId: 'conv-1' }, includeCandidate: true },
      NOW,
    )
    expect(block.items).toHaveLength(0)
    // After retention runs, the row is DELETED (terminal) + audited.
    const n = await store.applyRetention(HOSP_A, NOW)
    expect(n).toBeGreaterThanOrEqual(1)
    const row = store.items.find((i) => i.key === 'decision.slot')
    expect(row?.status).toBe('DELETED')
    const evs = await store.events(row!.id, HOSP_A)
    expect(evs.some((e) => e.eventKind === 'EXPIRE')).toBe(true)
  })

  it('honours the item budget and truncates with a flag', async () => {
    const store = await seed()
    const block = await store.query(
      { scope: { hospitalId: HOSP_A, domain: 'PATIENT', patientId: 'PAT-A1' }, maxItems: 1 },
      NOW,
    )
    expect(block.items).toHaveLength(1)
    expect(block.truncated).toBe(true)
    expect(block.totalMatched).toBe(2)
  })

  it('renders provenance on every line (trust + source + as-of)', async () => {
    const store = await seed()
    const block = await store.query({ scope: { hospitalId: HOSP_A, domain: 'PATIENT', patientId: 'PAT-A1' } }, NOW)
    for (const item of block.items) {
      expect(item.rendered).toMatch(/\[(USER_PROVIDED|SYSTEM_DERIVED)\] /)
      expect(item.rendered).toContain('source: ')
      expect(item.rendered).toContain('as of 2026-09-30')
    }
    expect(serializeMemoryBlock(block)).toContain('MEMORY (provenance-labeled context')
  })

  it('key/type filters narrow retrieval (task-specific, never whole history)', async () => {
    const store = await seed()
    const block = await store.query(
      { scope: { hospitalId: HOSP_A, domain: 'PATIENT', patientId: 'PAT-A1' }, keys: ['pref.language'] },
      NOW,
    )
    expect(block.items.map((i) => i.key)).toEqual(['pref.language'])
  })
})

describe('memory intent planning (deterministic triggers)', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    hospitalId: HOSP_A,
    conversationId: 'conv-1',
    actor: doc,
    message: '',
    patientId: 'PAT-A1',
    doctorId: 'doc-1',
    caseId: null,
    taskType: 'INFORMATIONAL',
    contextProfile: null,
    now: NOW,
    ...over,
  })

  it('no retrieval without a trigger (smallest-sufficient-context)', () => {
    expect(planMemoryRetrieval(input({ message: 'What are today\u2019s appointments?' }))).toBeNull()
  })

  it('English + Arabic memory intents fire', () => {
    expect(hasMemoryIntent('What did we discuss last time?')).toBe(true)
    expect(hasMemoryIntent('ما هو تفضيلي السابق؟')).toBe(true)
    expect(hasMemoryIntent('I prefer morning slots.')).toBe(true)
    expect(hasMemoryIntent('حجز موعد')).toBe(false)
  })

  it('case-level profiles always pull case memory', () => {
    const plan = planMemoryRetrieval(input({ contextProfile: 'CASE', caseId: 'treat-1', message: 'Summarize the case' }))
    expect(plan?.domains).toContain('CASE')
  })

  it('extracts explicit first-person preference statements only', () => {
    expect(extractUserPreferenceStatement('I prefer morning appointments.', 'PATIENT')?.domain).toBe('PATIENT')
    expect(extractUserPreferenceStatement('أفضّل المواعيد الصباحية', 'DOCTOR')?.domain).toBe('DOCTOR')
    expect(extractUserPreferenceStatement('Book an appointment.', 'PATIENT')).toBeNull()
  })
})

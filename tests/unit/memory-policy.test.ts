/**
 * Phase 8 — memory write policy (trust, roles, scope, content, confidence).
 * Fail-closed: every rule is asserted as a typed rejection.
 */

import { describe, expect, it } from 'vitest'
import { InMemoryMemoryStore } from '@/lib/ai/memory/store'
import { MemoryError } from '@/lib/ai/memory/types'
import { CLASS_TO_TRUST, DOMAIN_WRITE_ROLES, validateWrite } from '@/lib/ai/memory/validation'
import type { MemoryScope } from '@/lib/ai/memory/types'

const HOSP = 'hosp-A'

const scope = (over: Partial<MemoryScope> = {}): MemoryScope => ({
  hospitalId: HOSP,
  domain: 'PATIENT',
  patientId: 'PAT-A1',
  ...over,
})

const write = (over: Record<string, unknown> = {}) => ({
  scope: scope(),
  key: 'pref.language',
  value: { text: 'Arabic' },
  memoryType: 'STRUCTURED',
  writeClass: 'USER_CONFIRMED',
  trustLevel: 'USER_PROVIDED',
  sourceKind: 'USER_STATEMENT',
  actor: { id: 'user-1', role: 'PATIENT' },
  ...over,
})

describe('memory write policy', () => {
  it('accepts a legal user-confirmed patient write', async () => {
    const store = new InMemoryMemoryStore()
    const item = await store.write(write())
    expect(item.trustLevel).toBe('USER_PROVIDED')
    expect(item.status).toBe('ACTIVE')
    expect(item.createdByIdType).toBe('USER')
  })

  it('rejects trust escalation: a patient cannot write DOCTOR_CONFIRMED', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(write({ writeClass: 'DOCTOR_CONFIRMED', trustLevel: 'DOCTOR_CONFIRMED' }) as never),
    ).rejects.toThrow(MemoryError)
  })

  it('rejects class/trust mismatch (USER_CONFIRMED with DOCTOR_CONFIRMED trust)', async () => {
    expect(() =>
      validateWrite({
        ...write({ writeClass: 'USER_CONFIRMED', trustLevel: 'DOCTOR_CONFIRMED', actor: { id: 'd1', role: 'DOCTOR' } }),
      }),
    ).toThrow(/trust/i)
  })

  it('rejects a patient writing to the CLINIC domain', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(write({ scope: { hospitalId: HOSP, domain: 'CLINIC' } }) as never),
    ).rejects.toThrow(MemoryError)
  })

  it('rejects SYSTEM actor outside SYSTEM_VERIFIED', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(write({ actor: { id: 'system', role: 'SYSTEM' }, writeClass: 'USER_CONFIRMED', trustLevel: 'USER_PROVIDED' }) as never),
    ).rejects.toThrow(MemoryError)
  })

  it('rejects a user acting as the system identity', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(write({ actor: { id: 'system', role: 'PATIENT' } }) as never),
    ).rejects.toThrow(MemoryError)
  })

  it('accepts SYSTEM writes only as SYSTEM_VERIFIED / SYSTEM_DERIVED', async () => {
    const store = new InMemoryMemoryStore()
    const item = await store.write(
      write({
        writeClass: 'SYSTEM_VERIFIED',
        trustLevel: 'SYSTEM_DERIVED',
        sourceKind: 'ACTION_RESULT',
        actor: { id: 'system', role: 'SYSTEM' },
      }) as never,
    )
    expect(item.createdByIdType).toBe('SYSTEM')
  })

  it('rejects DOCTOR_CONFIRMED from non-doctor roles', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(
        write({
          writeClass: 'DOCTOR_CONFIRMED',
          trustLevel: 'DOCTOR_CONFIRMED',
          actor: { id: 'rec-1', role: 'RECEPTIONIST' },
        }) as never,
      ),
    ).rejects.toThrow(MemoryError)
  })

  it('rejects an AI_DERIVED trust from a user (LLM text cannot self-authorize)', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(write({ writeClass: 'USER_CONFIRMED', trustLevel: 'AI_DERIVED' }) as never),
    ).rejects.toThrow(MemoryError)
  })

  it('accepts a CANDIDATE_MEMORY write as AI_DERIVED', async () => {
    const store = new InMemoryMemoryStore()
    const item = await store.write(
      write({ writeClass: 'CANDIDATE_MEMORY', trustLevel: 'AI_DERIVED', sourceKind: 'CONVERSATION' }) as never,
    )
    expect(item.trustLevel).toBe('AI_DERIVED')
  })

  it('rejects prototype-polluting value members', async () => {
    const store = new InMemoryMemoryStore()
    // JSON.parse creates REAL own properties named __proto__ (assignment
    // through a literal would hit the setter and vanish).
    const poisoned = JSON.parse('{"__proto__":"x"}') as unknown
    await expect(store.write(write({ value: poisoned }) as never)).rejects.toThrow(MemoryError)
    await expect(store.write(write({ value: JSON.parse('{"constructor":{"name":"x"}}') }) as never)).rejects.toThrow(MemoryError)
  })

  it('rejects oversized values and bad keys', async () => {
    const store = new InMemoryMemoryStore()
    await expect(store.write(write({ value: 'x'.repeat(3000) }) as never)).rejects.toThrow(MemoryError)
    await expect(store.write(write({ key: 'Bad Key!' }) as never)).rejects.toThrow(MemoryError)
    await expect(store.write(write({ key: '' }) as never)).rejects.toThrow(MemoryError)
  })

  it('rejects unsourced confidence (a number without provenance is fabricated)', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(write({ confidence: { value: 0.9, source: '', semantics: '', version: '1', at: '2026-09-30T00:00:00Z' } }) as never),
    ).rejects.toThrow(MemoryError)
    await expect(
      store.write(write({ confidence: { value: 1.4, source: 's', semantics: 'sem', version: '1', at: '2026-09-30T00:00:00Z' } }) as never),
    ).rejects.toThrow(MemoryError)
    const item = await store.write(
      write({
        confidence: {
          value: 0.8,
          source: 'engine meshsegnet-max run gen-1',
          semantics: 'fraction of cells assigned to the top class',
          calibration: null,
          version: '1.0.0',
          at: '2026-09-30T00:00:00Z',
        },
      }) as never,
    )
    expect(item.confidence?.value).toBe(0.8)
  })

  it('rejects scope/domain mismatches (PATIENT domain without patientId)', async () => {
    const store = new InMemoryMemoryStore()
    await expect(
      store.write(write({ scope: { hospitalId: HOSP, domain: 'PATIENT' } }) as never),
    ).rejects.toThrow(MemoryError)
  })

  it('domain write-role matrix is fail-closed (unknown role rejected)', () => {
    expect(DOMAIN_WRITE_ROLES.CLINIC).toContain('ADMIN')
    expect(CLASS_TO_TRUST.SYSTEM_VERIFIED).toEqual(['SYSTEM_DERIVED'])
  })
})

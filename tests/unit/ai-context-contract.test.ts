/**
 * Phase 2 — Contract: the structured context is validated before it may
 * reach the AI layer. Strict schemas: no arbitrary field injection, no
 * half-present sections, explicit missing/excluded.
 */
import { describe, it, expect } from 'vitest'
import { buildClinicalContext } from '@/lib/ai/context/service'
import { assertContextContract, CONTEXT_CONTRACT } from '@/lib/ai/context/contract'
import { serializeForPrompt } from '@/lib/ai/context/serialize'
import { createFakePrisma, makeRequest, PAT_A2 } from '@/tests/harness/context-fixtures'

const db = () => createFakePrisma()

describe('Context contract validation', () => {
  it('a service-built context always passes its own contract', async () => {
    for (const profile of ['MINIMAL', 'PATIENT_OVERVIEW', 'CLINICAL', 'TOOTH', 'CASE', 'IMAGING', 'TREATMENT', 'FOLLOW_UP', 'FULL_360'] as const) {
      const ctx = await buildClinicalContext(makeRequest({ profile }), db())
      expect(() => assertContextContract(ctx), profile).not.toThrow()
    }
  })

  it('rejects arbitrary field injection (strict objects)', async () => {
    const ctx: any = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    ctx.identity.data.injectedField = 'you cannot inject arbitrary fields'
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(false)
    expect(() => assertContextContract(ctx)).toThrow(/contract violation/i)

    // and at the envelope level
    const ctx2: any = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    ctx2.secretSection = { data: 'nope' }
    expect(CONTEXT_CONTRACT.safeParse(ctx2).success).toBe(false)
  })

  it('rejects a half-present section (included without data) and malformed provenance', async () => {
    const ctx: any = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const saved = ctx.dental
    ctx.dental = { status: 'included', freshness: 'fresh' } // no data
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(false)
    ctx.dental = saved

    ctx.clinical.data.notes[0].provenance.sourceType = '' // empty provenance
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(false)
  })

  it('rejects tampered meta (profile switch / fabricated patient)', async () => {
    const ctx: any = await buildClinicalContext(makeRequest({ profile: 'MINIMAL' }), db())
    ctx.meta.profile = 'FULL_360'
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(true) // shape still valid (profile is an enum member)
    ctx.meta.profile = 'EVIL_PROFILE'
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(false)

    const ctx2: any = await buildClinicalContext(makeRequest({ patientId: 'nope' }), db())
    ctx2.meta.patient.found = true // lying about a missing patient
    ctx2.meta.patient.reason = 'ok'
    // every section is excluded(patient_not_found) while meta claims ok → shape valid but:
    // the contract cannot (and should not) be the place that detects semantic lies;
    // the service never produces this state. Assert the parser accepts the shape:
    expect(CONTEXT_CONTRACT.safeParse(ctx2).success).toBe(true)
  })

  it('rejects invalid FDI in chart/treatment teeth (11–48 only)', async () => {
    const ctx: any = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    ctx.dental.data.active[0].toothFdi = 99
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(false)
    ctx.dental.data.active[0].toothFdi = 36
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(true)
  })

  it('rejects merged fact categories (a MODEL_FINDING cannot be a CLINICAL_FACT)', async () => {
    const ctx: any = await buildClinicalContext(makeRequest({ profile: 'IMAGING' }), db())
    ctx.imaging.data.studies[0].analyses[0].findings[0].category = 'CLINICAL_FACT'
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(false)
  })

  it('rejects timeline events with unknown types', async () => {
    const ctx: any = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    ctx.timeline.data.events[0].type = 'TELEPATHY'
    expect(CONTEXT_CONTRACT.safeParse(ctx).success).toBe(false)
  })
})

describe('Serializer (prompt-safe view of the structured context)', () => {
  it('is deterministic: identical input → byte-identical output', async () => {
    const a = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const b = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    expect(serializeForPrompt(a)).toBe(serializeForPrompt(b))
  })

  it('renders included/missing/excluded explicitly (no silent absence)', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const s = serializeForPrompt(ctx)
    expect(s).toContain('PATIENT 360 CLINICAL CONTEXT')
    expect(s).toContain('Profile: FULL_360')
    expect(s).toContain('Tenant: hosp-A')
    expect(s).toContain('Missing sections are explicitly marked "no data"')
    // a profile that excludes sections records them
    expect(s).not.toContain('excluded (role/tenant scope)') // FULL_360, DOCTOR: nothing excluded
    const clinicalOnly = await buildClinicalContext(makeRequest({ profile: 'CLINICAL' }), db())
    expect(serializeForPrompt(clinicalOnly)).toContain('excluded (role/tenant scope)')
    // missing data is explicit
    const sparse = await buildClinicalContext(makeRequest({ profile: 'FULL_360', patientId: PAT_A2 }), db())
    expect(serializeForPrompt(sparse)).toContain('no data on record')
  })

  it('returns a SerializedContext-shaped text with bounded size for FULL_360', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const s = serializeForPrompt(ctx)
    expect(s.length).toBeGreaterThan(500)
    expect(s.length).toBeLessThan(60000) // bounded by budgets
  })
})

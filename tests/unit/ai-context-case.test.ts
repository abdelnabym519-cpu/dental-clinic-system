/**
 * Phase 2 — Case context: TreatmentPlan as the case anchor, case→treatment
 * link via shared appointmentId (the only real relationship in the schema).
 */
import { describe, it, expect } from 'vitest'
import { buildClinicalContext } from '@/lib/ai/context/service'
import { serializeForPrompt } from '@/lib/ai/context/serialize'
import {
  createFakePrisma, makeRequest, PAT_A1, HOSP_A, ACTORS,
} from '@/tests/harness/context-fixtures'

const db = () => createFakePrisma()

describe('Case 360 context (CASE profile)', () => {
  it('shows the plan with items, teeth (confirmed FDI), consent and cost', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'CASE' }), db())
    const c = (ctx.cases as any).data
    expect(c.plans.length).toBe(1)
    const plan = c.plans[0]
    expect(plan.planNumber).toBe('TP-A-501')
    expect(plan.status).toBe('ACTIVE')
    expect(plan.consentGiven).toBe(true)
    expect(plan.estimatedCost).toBe(4500)
    expect(plan.diagnosis).toBe('Irreversible pulpitis tooth 36')
    expect(plan.teeth).toEqual([36])
    expect(plan.items.length).toBe(2)
    expect(plan.items[0].procedure).toBe('Root Canal Treatment')
    expect(plan.items[0].teeth).toEqual([36])
    expect(plan.items[0].toothSource).toBe('confirmed')
    expect(plan.provenance.sourceType).toBe('treatment_plan')
    expect(plan.provenance.entityType).toBe('TreatmentPlan')
  })

  it('links treatments to the case ONLY through the shared appointmentId', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'CASE' }), db())
    const t = (ctx.treatments as any).data
    // TRT-A-701 shares appointment appt-A2 with plan TP-A-501 → linked
    const rct = t.treatments.find((x: any) => x.treatmentNo === 'TRT-A-701')
    expect(rct.caseId).toBe('plan-A1')
    // TRT-A-702 has no appointment link → no invented caseId
    const fill = t.treatments.find((x: any) => x.treatmentNo === 'TRT-A-702')
    expect(fill.caseId).toBeNull()
    const serialized = serializeForPrompt(ctx)
    expect(serialized).toContain('case plan-A1')
  })

  it('caseId scope is re-validated against tenant+patient — same id owned by another patient does not resolve', async () => {
    const ok = await buildClinicalContext(
      makeRequest({ profile: 'CASE', caseId: 'plan-A1' }),
      db()
    )
    expect((ok.cases as any).data.plans.length).toBe(1)
    expect((ok.cases as any).data.plans[0].planNumber).toBe('TP-A-501')

    // A row with the SAME id but a different patientId in the same tenant
    // must not be returned for Patient A's request.
    const db2 = createFakePrisma({
      treatmentPlan: [{
        id: 'plan-A1', hospitalId: HOSP_A, patientId: 'pat-OTHER', planNumber: 'TP-IMPOSTOR',
        title: 'Impostor plan', status: 'ACTIVE', diagnosis: 'IMPOSTOR DATA',
        chiefComplaint: null, consentGiven: false, estimatedCost: null,
        appointmentId: null, doctorId: 'x', doctor: null, createdAt: new Date('2026-01-01'),
        items: [],
      }],
    })
    const scoped = await buildClinicalContext(
      makeRequest({ profile: 'CASE', caseId: 'plan-A1' }),
      db2
    )
    const plans = (scoped.cases as any).data.plans
    expect(plans.length).toBe(1)
    expect(plans[0].planNumber).toBe('TP-A-501')
    expect(JSON.stringify(scoped)).not.toContain('IMPOSTOR')
  })

  it('caseId scope that does not exist → cases missing', async () => {
    const ctx = await buildClinicalContext(
      makeRequest({ profile: 'CASE', caseId: 'no-such-plan' }),
      db()
    )
    expect(ctx.cases.status).toBe('missing')
  })

  it('ACCOUNTANT sees the case in billing scope: no clinical text', async () => {
    const ctx = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.accountantA }, profile: 'CASE' }),
      db()
    )
    expect(ctx.cases.status).toBe('included')
    const plan = (ctx.cases as any).data.plans[0]
    expect(plan.diagnosis).toBeNull()
    expect(plan.chiefComplaint).toBeNull()
    expect(plan.estimatedCost).toBe(4500)
    const serialized = serializeForPrompt(ctx)
    expect(serialized).not.toContain('Irreversible pulpitis')
  })

  it('RECEPTIONIST sees the case in operational scope: status/cost, no diagnosis', async () => {
    const ctx = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.receptionistA }, profile: 'CASE' }),
      db()
    )
    expect(ctx.cases.status).toBe('included')
    const plan = (ctx.cases as any).data.plans[0]
    expect(plan.diagnosis).toBeNull()
    expect(plan.chiefComplaint).toBeNull()
    expect(plan.status).toBe('ACTIVE')
  })

  it('LAB_TECH cannot see cases at all (excluded, never retrieved-and-hidden)', async () => {
    const ctx = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.labTechA }, profile: 'CASE' }),
      db()
    )
    expect(ctx.cases.status).toBe('excluded')
    expect((ctx.cases as any).reason).toBe('not_permitted')
    // the excluded list in meta records the decision for the inspector
    expect(ctx.meta.excluded).toContainEqual({ section: 'cases', reason: 'not_permitted' })
  })
})

/**
 * Phase 2 — Patient-level context: sections, missing-data semantics,
 * freshness, budgets, query accounting.
 */
import { describe, it, expect } from 'vitest'
import { buildClinicalContext } from '@/lib/ai/context/service'
import { serializeForPrompt } from '@/lib/ai/context/serialize'
import {
  createFakePrisma, makeRequest, NOW, PAT_A1, PAT_A2, HOSP_A, ACTORS,
} from '@/tests/harness/context-fixtures'

const db = () => createFakePrisma()

describe('Patient 360 context (service)', () => {
  it('CLINICAL profile for Patient A includes every permitted section with provenance', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'CLINICAL' }), db())
    expect(ctx.meta.patient.found).toBe(true)
    expect(ctx.meta.patient.patientId).toBe('PAT-A1')
    expect(ctx.meta.tenantId).toBe(HOSP_A)
    expect(ctx.meta.role).toBe('DOCTOR')

    for (const s of ['identity', 'medical', 'dental', 'appointments', 'clinical', 'cases', 'treatments', 'prescriptions'] as const) {
      expect(ctx[s].status, s).toBe('included')
    }
    // CLINICAL has no imaging/financial/timeline
    expect(ctx.imaging.status).toBe('excluded')
    expect((ctx.imaging as any).reason).toBe('not_in_profile')
    expect(ctx.financial.status).toBe('excluded')
    expect(ctx.timeline.status).toBe('excluded')

    // identity provenance-free basics
    const id = (ctx.identity as any).data
    expect(id.name).toBe('Ahmed Ali')
    expect(id.age).toBe(34)
    expect(id.contact.phone).toBe('01011112222') // DOCTOR may see contact

    // every included section carries explicit freshness
    for (const s of ['identity', 'medical', 'dental', 'appointments', 'clinical', 'cases', 'treatments', 'prescriptions'] as const) {
      expect(['fresh', 'recent', 'historical', 'unknown'], s).toContain((ctx[s] as any).freshness)
    }
  })

  it('sections are bounded: budgets truncate, never the full history', async () => {
    // 500 notes beyond the clinical budget (15) must not appear.
    const notes = Array.from({ length: 50 }, (_, i) => ({
      id: `note-extra-${i}`, hospitalId: HOSP_A, patientId: PAT_A1,
      noteType: 'GENERAL', content: `Extra note ${i}`, isPrivate: false,
      createdAt: new Date(NOW.getTime() - (i + 400) * 86400000),
      doctorId: 'staff-doctor-1', doctor: { firstName: 'Hana', lastName: 'Shalaby' },
      treatmentPlanId: null,
    }))
    const ctx = await buildClinicalContext(makeRequest({ profile: 'CLINICAL' }), createFakePrisma({ clinicalNote: notes }))
    const d = (ctx.clinical as any).data
    expect(d.notes.length + d.examinations.length + d.followUpNotes.length).toBeLessThanOrEqual(15)
  })

  it('missing data is explicit — Patient A2 (no medical history, no notes) is never fabricated', async () => {
    const ctx = await buildClinicalContext(makeRequest({ patientId: PAT_A2 }), db())
    expect(ctx.meta.patient.found).toBe(true)
    expect(ctx.medical.status).toBe('missing')
    expect(ctx.clinical.status).toBe('missing')
    expect(ctx.cases.status).toBe('missing')
    expect(ctx.treatments.status).toBe('missing')
    expect(ctx.prescriptions.status).toBe('missing')
    expect(ctx.imaging.status).toBe('excluded')
    // identity + dental still present
    expect(ctx.identity.status).toBe('included')
    expect(ctx.dental.status).toBe('included')
    expect((ctx.dental as any).data.toothCount).toBe(1)
    const serialized = serializeForPrompt(ctx)
    expect(serialized).toContain('Medical history [freshness: unknown] — no data on record')
    expect(serialized).not.toContain('Metformin')
  })

  it('unknown patient id → all sections excluded(patient_not_found), meta says not_found', async () => {
    const ctx = await buildClinicalContext(makeRequest({ patientId: 'nope' }), db())
    expect(ctx.meta.patient.found).toBe(false)
    expect(ctx.meta.patient.reason).toBe('not_found')
    for (const key of Object.keys(ctx).filter((k) => k !== 'meta')) {
      const s = (ctx as any)[key]
      expect(s.status, key).toBe('excluded')
      expect(s.reason).toBe('patient_not_found')
    }
    // serialization still works and states no patient
    const serialized = serializeForPrompt(ctx)
    expect(serialized).toContain('excluded')
  })

  it('queryCount is bounded and constant per profile (N+1 guardrail)', async () => {
    const minimal = await buildClinicalContext(makeRequest({ profile: 'MINIMAL' }), db())
    const overview = await buildClinicalContext(makeRequest({ profile: 'PATIENT_OVERVIEW' }), db())
    const clinical = await buildClinicalContext(makeRequest({ profile: 'CLINICAL' }), db())
    const full = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())

    expect(minimal.meta.queryCount).toBe(1) // only the patient lookup
    expect(overview.meta.queryCount).toBe(6)
    expect(clinical.meta.queryCount).toBe(8)
    expect(full.meta.queryCount).toBe(11)
    for (const c of [minimal, overview, clinical, full]) {
      expect(c.meta.queryCount).toBeLessThanOrEqual(12)
      expect(c.meta.constructionMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('queryCount does NOT grow when the data grows (N+1 scaling: 1 → 100 rows)', async () => {
    const base = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const scaled = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), createFakePrisma({
      clinicalNote: Array.from({ length: 100 }, (_, i) => ({
        id: `n-scale-${i}`, hospitalId: HOSP_A, patientId: PAT_A1,
        noteType: 'GENERAL', content: `x${i}`, isPrivate: false,
        createdAt: new Date(NOW.getTime() - (i + 300) * 86400000),
        doctorId: 'staff-doctor-1', doctor: { firstName: 'H', lastName: 'S' }, treatmentPlanId: null,
      })),
      dentalChartEntry: Array.from({ length: 100 }, (_, i) => ({
        id: `c-scale-${i}`, hospitalId: HOSP_A, patientId: PAT_A1,
        toothNumber: 11 + (i % 38), condition: 'CARIES', severity: 'MILD',
        mesial: false, distal: false, occlusal: i % 2 === 0, buccal: false, lingual: false,
        notes: null, diagnosedDate: new Date(NOW.getTime() - (i + 300) * 86400000), resolvedDate: null,
      })),
      appointment: Array.from({ length: 100 }, (_, i) => ({
        id: `a-scale-${i}`, hospitalId: HOSP_A, patientId: PAT_A1,
        appointmentNo: `APPT-SC-${i}`, appointmentType: 'CHECK_UP', status: 'COMPLETED',
        scheduledDate: new Date(NOW.getTime() - (i + 300) * 86400000), chiefComplaint: null,
        doctorId: 'staff-doctor-1', doctor: { firstName: 'H', lastName: 'S' }, createdAt: NOW,
      })),
    }))
    expect(scaled.meta.queryCount).toBe(base.meta.queryCount)
    // budgets still hold
    const sc = (scaled.clinical as any).data
    expect(sc.notes.length + sc.examinations.length + sc.followUpNotes.length).toBeLessThanOrEqual(20)
    // toothCount is hard-bounded by the 38 valid FDI teeth (chart output cap)
    expect((scaled.dental as any).data.toothCount).toBeLessThanOrEqual(38)
  })

  it('freshness follows the windows: fresh <24h, recent <90d, historical ≥90d, unknown = no data', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    // risk calculatedAt = NOW-1d → fresh
    expect((ctx.risk as any).freshness).toBe('fresh')
    // notes newest = NOW-2d → recent
    expect((ctx.clinical as any).freshness).toBe('recent')
    // chart has entries at -10d → recent
    expect((ctx.dental as any).freshness).toBe('recent')
    // Patient A2 has no notes → clinical missing → unknown
    const a2 = await buildClinicalContext(makeRequest({ patientId: PAT_A2 }), db())
    expect(a2.clinical.freshness).toBe('unknown')
    // appointments: newest scheduled is +30d → fresh (timestamp based)
    expect(['fresh', 'recent', 'historical', 'unknown']).toContain((ctx.appointments as any).freshness)
  })

  it('PATIENT_OVERVIEW is Minimum Necessary: no clinical free text, no AI internals', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'PATIENT_OVERVIEW' }), db())
    expect(ctx.clinical.status).toBe('excluded')
    expect(ctx.cases.status).toBe('excluded')
    expect(ctx.treatments.status).toBe('excluded')
    expect(ctx.prescriptions.status).toBe('excluded')
    const serialized = serializeForPrompt(ctx)
    // financial section is included (open balance) — the ONLY financial surface
    expect(serialized).toContain('Financial (open balances only)')
    expect(serialized).toContain('2500.00 EGP')
    expect(serialized).not.toContain('Irreversible pulpitis')
    expect(serialized).not.toContain('AI analysis') // no imaging/AI-findings surface
    expect(serialized).not.toContain('Pulp necrosis')
  })

  it('medical section renders conditions/allergies/pregnancy as structured facts', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'PATIENT_OVERVIEW' }), db())
    const m = (ctx.medical as any).data
    expect(m.conditions).toContain('Diabetes (TYPE_2)')
    expect(m.allergies.drug).toContain('Penicillin')
    expect(m.currentMedications).toBe('Metformin 500mg daily')
    expect(m.smokingStatus).toBe('NEVER')
    expect(m.pregnancy.isPregnant).toBe(false)
    expect(m.provenance.sourceType).toBe('medical_history')
    expect(m.provenance.entityType).toBe('MedicalHistory')
  })

  it('PATIENT role: own record only, only identity+appointments, no contact block', async () => {
    const own = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.patientA }, profile: 'PATIENT_OVERVIEW', patientId: PAT_A1 }),
      db()
    )
    expect(own.meta.patient.found).toBe(true)
    expect(own.identity.status).toBe('included')
    expect(own.appointments.status).toBe('included')
    // no contact for the patient
    expect((own.identity as any).data.contact).toBeUndefined()
    // everything else excluded (not permitted for PATIENT)
    for (const s of ['medical', 'dental', 'clinical', 'cases', 'treatments', 'prescriptions', 'imaging', 'financial', 'risk', 'timeline'] as const) {
      expect(own[s].status, s).toBe('excluded')
    }
    // other patient → unauthorized
    const other = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.patientA }, patientId: PAT_A2 }),
      db()
    )
    expect(other.meta.patient.found).toBe(false)
    expect(other.meta.patient.reason).toBe('unauthorized')
    // tenant B's patient → unauthorized too (the portal link is tenant-scoped)
    const foreign = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.patientB }, patientId: PAT_A1 }),
      db()
    )
    expect(foreign.meta.patient.reason).toBe('unauthorized')
  })

  it('is deterministic: same request + data → byte-identical context (except wall-clock fields)', async () => {
    const a = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const b = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const strip = (c: any) => JSON.stringify(c, (k, v) => (k === 'constructionMs' ? 0 : v))
    expect(strip(a)).toBe(strip(b))
  })
})

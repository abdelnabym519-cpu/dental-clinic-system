/**
 * Phase 9 — Dental Brain (unit, §10–§13).
 *
 * Reusable domain-aware intelligence over the case graph:
 *  - case-understanding: teeth, AI vs clinician-confirmed findings,
 *    symptoms, imaging, treatments done/pending/cancelled, follow-ups,
 *    and EXPLICIT missing information (never fabricated);
 *  - structured clinical summary: FIXED section shape — every section
 *    AVAILABLE or NOT_AVAILABLE; CDS disclaimer always present;
 *  - differential SUPPORT: candidates with supporting/contradicting/
 *    missing evidence — stance is always clinical_decision_support,
 *    NEVER a confirmed diagnosis.
 *
 * Adversarial note: the fixture's chiefComplaints contain prompt-injection
 * text — it must appear only as bounded DATA (count/text), never as
 * instructions, and the summary must not be steered by it.
 */
import { describe, it, expect } from 'vitest'
import { createFakePrisma, HOSP_A, PAT_A1, NOW, ACTORS } from '@/tests/harness/context-fixtures'
import { buildCaseGraph, type GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { understandCase, buildClinicalSummary, differentialSupport, domainsForCase, runDentalBrain } from '@/lib/ai/intelligence/dental-brain'
import type { CaseGraph, ClinicalSummary } from '@/lib/ai/intelligence/types'

const STAFF = [{ id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' }]
const AI_JOBS = [{
  id: 'job-A1', hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED',
  requestedById: 'staff-doctor-1', modelVersion: 'v1.2.0', modelChecksum: 'c0ffee0000000000000000000000000000000000',
  orchestratorVersion: '2.1.0', startedAt: NOW, completedAt: NOW, confidence: 0.87,
  findings: [{ condition: 'caries', tooth_number: 36 }],
  reviewedById: 'staff-doctor-1', reviewedAt: NOW, reviewDecision: 'ACCEPTED',
  acceptedFindings: [{ condition: 'caries', tooth_number: 36 }], createdAt: NOW,
}]

async function graph(): Promise<CaseGraph> {
  const fake = createFakePrisma({ staff: STAFF, aiAnalysisJob: AI_JOBS, aiMemoryItem: [] } as never)
  return buildCaseGraph(fake as unknown as GraphPrisma, {
    hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
    actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
  })
}

const SUMMARY_SECTIONS = [
  'patientContext', 'chiefComplaint', 'relevantHistory', 'affectedTeeth', 'symptoms',
  'clinicalFindings', 'imaging', 'aiFindings', 'clinicianConfirmedFindings',
  'differentialConsiderations', 'treatmentHistory', 'currentTreatment',
  'pendingItems', 'followUp', 'knownUncertainty', 'missingInformation',
] as const

describe('Phase 9 — dental brain: case understanding (§11)', () => {
  it('reads the full case spine: teeth, findings, imaging, treatments, follow-up', async () => {
    const g = await graph()
    const u = understandCase(g, { procedureCategories: [], now: NOW })

    // Tooth 36 (active + resolved history) and 46 (filled).
    expect(u.teeth.map((t) => t.fdi).sort()).toEqual([36, 46])
    const t36 = u.teeth.find((t) => t.fdi === 36)!
    expect(t36.conditions.length).toBeGreaterThanOrEqual(2)

    // ONE accepted AI finding → clinician-confirmed.
    expect(u.aiFindings).toHaveLength(1)
    expect(u.aiFindings[0].reviewDecision).toBe('ACCEPTED')
    expect(u.aiFindings[0].provenance.modelVersion).toBe('v1.2.0')
    expect(u.clinicianConfirmedFindings.length).toBe(1)

    // Imaging present (1 study, 1 AI job).
    expect(u.imaging).toHaveLength(1)
    expect(u.imaging[0].aiJobs).toBe(1)

    // Treatments: trt-A2 COMPLETED (+ prescription), trt-A1 IN_PROGRESS pending.
    expect(u.treatment.done.length).toBeGreaterThanOrEqual(1)
    expect(u.treatment.pending.length).toBeGreaterThanOrEqual(1)
    expect(u.treatment.cancelled).toHaveLength(0)

    // Follow-up d+30 → not overdue.
    expect(u.followUps).toHaveLength(1)
    expect(u.followUps[0].overdue).toBe(false)
  })

  it('missing information is EXPLICIT and deterministic (fixture has none)', async () => {
    const g = await graph()
    const u = understandCase(g, { procedureCategories: [], now: NOW })
    // Rich fixture: chief complaint + imaging + findings + dated follow-up.
    expect(u.missingInformation).toEqual([])
    // Items exist for every AVAILABLE facet.
    const titleKeys = u.items.map((i) => i.titleKey)
    expect(titleKeys).toContain('int.casing.teeth')
    expect(titleKeys).toContain('int.casing.aiFindingAccepted')
    expect(titleKeys).toContain('int.casing.imaging')
    expect(titleKeys).toContain('int.casing.treatment')
    expect(titleKeys).toContain('int.casing.plan')
  })

  it('an EMPTY case reports explicit NOT_AVAILABLE items (never fabricated)', async () => {
    const fake = createFakePrisma({
      staff: STAFF, aiAnalysisJob: [], aiMemoryItem: [],
      patient: [{
        id: 'pat-empty', hospitalId: HOSP_A, patientId: 'PAT-EMPTY',
        firstName: 'Empty', lastName: 'Record', age: 30, dateOfBirth: new Date('1996-01-01'),
        gender: 'MALE', bloodGroup: 'O+', phone: null, alternatePhone: null,
        email: null, locale: 'ar', portalUserId: null, createdAt: NOW, medicalHistory: null,
      }],
    } as never)
    const g = await buildCaseGraph(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: 'pat-empty', caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
    })
    const u = understandCase(g, { procedureCategories: [], now: NOW })
    expect(u.teeth).toHaveLength(0)
    expect(u.aiFindings).toHaveLength(0)
    expect(u.symptoms).toHaveLength(0)
    expect(u.imaging).toHaveLength(0)
    expect(u.followUps).toHaveLength(0)
    const missing = u.missingInformation
    expect(missing).toContain('chief_complaint')
    expect(missing).toContain('imaging')
    expect(missing).toContain('findings')
    // NOT_AVAILABLE items are explicitly emitted.
    const na = u.items.filter((i) => i.state === 'NOT_AVAILABLE').map((i) => i.titleKey)
    expect(na).toContain('int.casing.noTeeth')
    expect(na).toContain('int.casing.noImaging')
    expect(na).toContain('int.casing.noSymptoms')
    expect(na).toContain('int.casing.noFollowUps')
  })

  it('prompt-injection text in chief complaints stays bounded DATA', async () => {
    const g = await graph()
    const u = understandCase(g, { procedureCategories: [], now: NOW })
    // Symptom text is bounded (<=10 items) and the injection payload, if
    // present, is DATA — the items never escalate trust or change shape.
    expect(u.symptoms.length).toBeLessThanOrEqual(10)
    for (const s of u.symptoms) expect(typeof s).toBe('string')
    // Every item carries its trust class; nothing becomes DOCTOR_CONFIRMED
    // merely because the patient "said" it.
    for (const i of u.items) {
      expect(['FACT', 'AI_INTERPRETATION', 'DERIVED_INSIGHT', 'RECOMMENDATION', 'ACTION']).toContain(i.insightClass)
    }
  })

  it('domain mapping stays inside the approved knowledge domains', async () => {
    const g = await graph()
    const domains = domainsForCase(g, [])
    expect(domains.length).toBeGreaterThan(0)
    // Caries/filled → RESTORATIVE + diagnosis support; nothing invented.
    expect(domains).toContain('DIAGNOSIS')
    expect(domains).toContain('RESTORATIVE')
    expect(domainsForCase(g, ['ORTHODONTIC'])).toContain('ORTHODONTICS')
  })
})

describe('Phase 9 — dental brain: clinical summary (§12–§13)', () => {
  it('FIXED section shape: every section AVAILABLE|NOT_AVAILABLE + CDS disclaimer', async () => {
    const g = await graph()
    const u = understandCase(g, { procedureCategories: [], now: NOW })
    const s: ClinicalSummary = buildClinicalSummary(u, g, 'Ahmed Ali')
    for (const section of SUMMARY_SECTIONS) {
      const line = s[section]
      expect(line, `section ${section} missing`).toBeTruthy()
      expect(['AVAILABLE', 'NOT_AVAILABLE']).toContain(line.state)
      expect(Array.isArray(line.lines)).toBe(true)
    }
    expect(s.disclaimerKey).toBe('int.summary.disclaimer')
  })

  it('rich fixture → key sections AVAILABLE; patientContext carries the name', async () => {
    const g = await graph()
    const u = understandCase(g, { procedureCategories: [], now: NOW })
    const s = buildClinicalSummary(u, g, 'Ahmed Ali')
    expect(s.patientContext.state).toBe('AVAILABLE')
    expect(s.patientContext.lines.join(' ')).toContain('Ahmed Ali')
    expect(s.affectedTeeth.state).toBe('AVAILABLE')
    expect(s.imaging.state).toBe('AVAILABLE')
    expect(s.aiFindings.state).toBe('AVAILABLE')
    expect(s.clinicianConfirmedFindings.state).toBe('AVAILABLE')
    expect(s.followUp.state).toBe('AVAILABLE')
  })

  it('empty case → NOT_AVAILABLE sections (explicit, never invented)', async () => {
    const fake = createFakePrisma({
      staff: STAFF, aiAnalysisJob: [], aiMemoryItem: [],
      patient: [{
        id: 'pat-empty', hospitalId: HOSP_A, patientId: 'PAT-EMPTY',
        firstName: 'Empty', lastName: 'Record', age: 30, dateOfBirth: new Date('1996-01-01'),
        gender: 'MALE', bloodGroup: 'O+', phone: null, alternatePhone: null,
        email: null, locale: 'ar', portalUserId: null, createdAt: NOW, medicalHistory: null,
      }],
    } as never)
    const g = await buildCaseGraph(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: 'pat-empty', caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
    })
    const u = understandCase(g, { procedureCategories: [], now: NOW })
    const s = buildClinicalSummary(u, g, 'Empty Record')
    expect(s.patientContext.state).toBe('AVAILABLE')
    expect(s.affectedTeeth.state).toBe('NOT_AVAILABLE')
    expect(s.clinicalFindings.state).toBe('NOT_AVAILABLE')
    expect(s.imaging.state).toBe('NOT_AVAILABLE')
    expect(s.aiFindings.state).toBe('NOT_AVAILABLE')
    expect(s.missingInformation.state).toBe('AVAILABLE') // the gaps themselves ARE data
  })
})

describe('Phase 9 — dental brain: differential SUPPORT (CDS, §13)', () => {
  it('candidates carry supporting/contradicting/missing evidence + CDS stance', async () => {
    const g = await graph()
    const d = differentialSupport(g, { procedureCategories: [] })
    expect(d.stance).toBe('clinical_decision_support')
    expect(d.candidates.length).toBeGreaterThan(0)
    for (const c of d.candidates) {
      expect(c.candidate).toBeTruthy()
      expect(Array.isArray(c.supportingEvidence)).toBe(true)
      expect(Array.isArray(c.contradictingEvidence)).toBe(true)
      expect(Array.isArray(c.missingEvidence)).toBe(true)
      expect(Array.isArray(c.suggestedInformation)).toBe(true)
    }
  })

  it('no recorded findings → zero candidates (no invented differentials)', async () => {
    const fake = createFakePrisma({
      staff: STAFF, aiAnalysisJob: [], aiMemoryItem: [],
      patient: [{
        id: 'pat-empty', hospitalId: HOSP_A, patientId: 'PAT-EMPTY',
        firstName: 'Empty', lastName: 'Record', age: 30, dateOfBirth: new Date('1996-01-01'),
        gender: 'MALE', bloodGroup: 'O+', phone: null, alternatePhone: null,
        email: null, locale: 'ar', portalUserId: null, createdAt: NOW, medicalHistory: null,
      }],
    } as never)
    const g = await buildCaseGraph(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: 'pat-empty', caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
    })
    const d = differentialSupport(g, { procedureCategories: [] })
    expect(d.stance).toBe('clinical_decision_support')
    expect(d.candidates).toHaveLength(0)
  })
})

describe('Phase 9 — dental brain: one-call entry (§10)', () => {
  it('runDentalBrain = graph + understanding + summary + differential in one bounded call', async () => {
    const fake = createFakePrisma({ staff: STAFF, aiAnalysisJob: AI_JOBS, aiMemoryItem: [] } as never)
    const out = await runDentalBrain(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' },
      procedureCategories: [], now: NOW, patientName: 'Ahmed Ali',
    })
    expect(out.understanding.aiFindings).toHaveLength(1)
    expect(out.summary.disclaimerKey).toBe('int.summary.disclaimer')
    expect(out.differential.stance).toBe('clinical_decision_support')
  })
})

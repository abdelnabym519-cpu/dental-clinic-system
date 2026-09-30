/**
 * Phase 9 — Patient AI (unit, §15–§16, §20).
 *
 * Longitudinal + current state over the case graph:
 *  - timeline: structured events from EXISTING records only, deterministic
 *    sort (time desc, kind, id), bounded (limit 50 + truncation flag);
 *  - trust preservation: UNCONFIRMED AI findings stay AI_INTERPRETATION —
 *    they never silently become FACT; ACCEPTED ones become FACT with the
 *    confirmation made explicit;
 *  - current state: active cases, current treatments, pending items
 *    (incl. missing consent), follow-ups due, recent findings, unresolved
 *    issues, memory references (trust-preserved, content-free);
 *  - unknownAreas: EXPLICIT list of what the record does not show —
 *    unknown stays unknown; nothing is invented;
 *  - patient isolation: a foreign patient node in the graph fails closed.
 */
import { describe, it, expect } from 'vitest'
import { createFakePrisma, HOSP_A, PAT_A1, NOW, ACTORS } from '@/tests/harness/context-fixtures'
import { buildCaseGraph, type GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { buildPatientIntelligence } from '@/lib/ai/intelligence/patient-ai'
import { IntelligenceError, type CaseGraph, type GraphNode } from '@/lib/ai/intelligence/types'

const STAFF = [{ id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' }]
const MEM = [{
  id: 'mem-A1-1', hospitalId: HOSP_A, domain: 'PATIENT', patientId: PAT_A1,
  key: 'event.followup_plan', value: { summary: 'Recheck 36 in four weeks' },
  trustLevel: 'USER_PROVIDED', status: 'ACTIVE', sourceKind: 'USER_STATEMENT',
  sourceRef: null, createdBy: 'staff-doctor-1', createdByIdType: 'USER',
  createdAt: NOW, updatedAt: NOW, expiresAt: null, supersededBy: null,
}]

async function graph(jobs: Record<string, unknown>[] = []): Promise<CaseGraph> {
  const fake = createFakePrisma({ staff: STAFF, aiMemoryItem: MEM, aiAnalysisJob: jobs } as never)
  return buildCaseGraph(fake as unknown as GraphPrisma, {
    hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
    actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
  })
}

const JOB_ACCEPTED = {
  id: 'job-A1', hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED',
  requestedById: 'staff-doctor-1', modelVersion: 'v1.2.0', modelChecksum: 'c0ffee',
  orchestratorVersion: '2.1.0', startedAt: NOW, completedAt: NOW, confidence: 0.87,
  findings: [{ condition: 'caries', tooth_number: 36 }],
  reviewedById: 'staff-doctor-1', reviewedAt: NOW, reviewDecision: 'ACCEPTED',
  acceptedFindings: [{ condition: 'caries', tooth_number: 36 }], createdAt: NOW,
}
const JOB_PENDING = {
  ...JOB_ACCEPTED, id: 'job-pend', studyId: 'study-A1', reviewedById: null, reviewedAt: null, reviewDecision: null, acceptedFindings: null,
}

describe('Phase 9 — patient AI: timeline (§15)', () => {
  it('structured events from existing records, deterministic order', async () => {
    const g = await graph([JOB_ACCEPTED])
    const pi = buildPatientIntelligence(g, NOW)
    expect(pi.patientId).toBe(PAT_A1)
    expect(pi.timeline.length).toBeGreaterThan(0)
    // Every event is typed + trust-labeled + provenance-labeled.
    for (const e of pi.timeline) {
      expect(['APPOINTMENT', 'TREATMENT', 'IMAGING', 'AI_FINDING', 'AI_REVIEW', 'FOLLOW_UP', 'OUTCOME', 'CASE', 'MEMORY']).toContain(e.kind)
      expect(['FACT', 'AI_INTERPRETATION', 'DERIVED_INSIGHT']).toContain(e.insightClass)
      expect(e.provenance).toBeTruthy()
    }
    // Deterministic: time DESC (stable), then kind, then id — so a later
    // item must be older-or-equal, never newer than its predecessor.
    for (let i = 1; i < pi.timeline.length; i++) {
      const a = pi.timeline[i - 1]
      const b = pi.timeline[i]
      if (String(b.at) > String(a.at)) throw new Error(`timeline not time-desc at ${i}: ${b.id} (${b.at}) newer than ${a.id} (${a.at})`)
    }
    // The accepted AI finding appears as FACT (confirmed) + an AI_REVIEW event.
    const aiEvent = pi.timeline.find((e) => e.id === 'ev:aifinding:job-A1')
    expect(aiEvent).toBeTruthy()
    expect(aiEvent!.insightClass).toBe('FACT')
  })

  it('UNCONFIRMED AI finding stays AI_INTERPRETATION (never silently a fact)', async () => {
    const g = await graph([JOB_PENDING])
    const pi = buildPatientIntelligence(g, NOW)
    const aiEvent = pi.timeline.find((e) => e.id === 'ev:aifinding:job-pend')
    expect(aiEvent).toBeTruthy()
    expect(aiEvent!.insightClass).toBe('AI_INTERPRETATION')
    // And it surfaces in unresolvedIssues — explicit, not hidden.
    expect(pi.current.unresolvedIssues.some((s) => s.includes('job-pend'))).toBe(true)
  })

  it('bounded: >50 events → limit 50 + timelineTruncated flag', async () => {
    const g = await graph([JOB_ACCEPTED])
    const synthetic: GraphNode[] = []
    for (let i = 0; i < 60; i++) {
      synthetic.push({
        id: `appointment:syn-${i}`, kind: 'APPOINTMENT', ref: `syn-${i}`, label: `Appt ${i}`,
        trust: 'RECORD_FACT', provenance: { source: `Appointment:syn-${i}`, actor: 'SYSTEM', at: NOW.toISOString(), sourceType: 'RECORD' },
        data: { status: 'COMPLETED', date: NOW.toISOString(), at: NOW.toISOString(), chiefComplaint: null },
      })
    }
    const bloated: CaseGraph = { ...g, nodes: [...g.nodes, ...synthetic] }
    const pi = buildPatientIntelligence(bloated, NOW)
    expect(pi.timeline.length).toBe(50)
    expect(pi.timelineTruncated).toBe(true)
  })
})

describe('Phase 9 — patient AI: current state (§16)', () => {
  it('active case, current treatment, pending items, follow-up due, memory refs', async () => {
    const g = await graph([JOB_ACCEPTED])
    const pi = buildPatientIntelligence(g, NOW)
    const c = pi.current
    // plan-A1 is ACTIVE.
    expect(c.activeCases.length).toBe(1)
    expect(c.activeCases[0].status).toBe('ACTIVE')
    expect(c.activeCases[0].consentGiven).toBe(true)
    // trt-A1 IN_PROGRESS.
    expect(c.currentTreatments.some((t) => t.ref === 'TRT-A-701' && t.status === 'IN_PROGRESS')).toBe(true)
    // Pending items include the in-progress treatment.
    expect(c.pendingItems.length).toBeGreaterThan(0)
    // Follow-up d+30 → due (not overdue).
    expect(c.followUpsDue.length).toBe(1)
    expect(c.followUpsDue[0].overdue).toBe(false)
    // Memory refs: trust-preserved, content-free.
    expect(c.memoryRefs.length).toBe(1)
    expect(c.memoryRefs[0].trustLevel).toBe('USER_PROVIDED')
    expect(JSON.stringify(c.memoryRefs[0])).not.toContain('Recheck 36')
  })

  it('overdue follow-up → flagged overdue + unresolved issue', async () => {
    const fake = createFakePrisma({
      staff: STAFF, aiMemoryItem: MEM, aiAnalysisJob: [JOB_ACCEPTED],
      treatment: [{
        id: 'trt-over', hospitalId: HOSP_A, patientId: PAT_A1, treatmentNo: 'TRT-OVER',
        status: 'COMPLETED', toothNumbers: '36', diagnosis: null, findings: null, chiefComplaint: null,
        procedureId: 'proc-rct', procedure: { name: 'RCT' }, doctorId: 'staff-doctor-1', doctor: null,
        startTime: NOW, endTime: NOW, followUpRequired: true, followUpDate: new Date(NOW.getTime() - 10 * 86400000),
        followUpNotes: 'recheck', complications: null, appointmentId: null, createdAt: NOW, updatedAt: NOW,
      }],
    } as never)
    const g = await buildCaseGraph(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
    })
    const pi = buildPatientIntelligence(g, NOW)
    const over = pi.current.followUpsDue.find((f) => f.ref === 'trt-over')
    expect(over).toBeTruthy()
    expect(over!.overdue).toBe(true)
    expect(pi.current.unresolvedIssues.some((s) => s.includes('trt-over'))).toBe(true)
  })

  it('missing consent on a pending plan → explicit pending item', async () => {
    const fake = createFakePrisma({
      staff: STAFF, aiMemoryItem: [], aiAnalysisJob: [],
      treatmentPlan: [{
        id: 'plan-pc', hospitalId: HOSP_A, patientId: PAT_A1, planNumber: 'TP-PC',
        title: 'Consent pending plan', status: 'PROPOSED', diagnosis: null, chiefComplaint: null,
        consentGiven: false, estimatedCost: 100, appointmentId: null, doctorId: 'staff-doctor-1', doctor: null,
        createdAt: NOW, items: [],
      }],
    } as never)
    const g = await buildCaseGraph(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
    })
    const pi = buildPatientIntelligence(g, NOW)
    expect(pi.current.pendingItems.some((s) => s.includes('consent'))).toBe(true)
  })
})

describe('Phase 9 — patient AI: honesty & isolation (§15/§16)', () => {
  it('empty history → explicit empty state, unknownAreas non-empty (unknown stays unknown)', async () => {
    const fake = createFakePrisma({
      staff: STAFF, aiMemoryItem: [], aiAnalysisJob: [],
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
    const pi = buildPatientIntelligence(g, NOW)
    expect(pi.timeline).toHaveLength(0)
    expect(pi.current.activeCases).toHaveLength(0)
    expect(pi.unknownAreas.length).toBeGreaterThan(0) // explicit, never fabricated
  })

  it('foreign patient node in the graph → INT_SCOPE_MISMATCH (fail closed)', async () => {
    const g = await graph([JOB_ACCEPTED])
    const foreign: GraphNode = {
      id: 'patient:pat-foreign', kind: 'PATIENT', ref: 'pat-foreign', label: 'Foreign', trust: 'UNKNOWN',
      provenance: { source: 'forged', actor: 'SYSTEM', at: NOW.toISOString(), sourceType: 'DERIVED' }, data: {},
    }
    const bad: CaseGraph = { ...g, nodes: [...g.nodes, foreign] }
    expect(() => buildPatientIntelligence(bad, NOW)).toThrowError(IntelligenceError)
    expect(() => buildPatientIntelligence(bad, NOW)).toThrowError(/INT_SCOPE_MISMATCH|foreign patient/)
  })
})

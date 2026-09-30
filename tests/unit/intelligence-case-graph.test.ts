/**
 * Phase 9 — canonical Case/Patient Graph (unit, §5–§9, §31).
 *
 * The graph is an in-process PROJECTION over the existing relational tables
 * (no graph DB). Contract:
 *  - tenant + patient scope enforced at the builder (fail closed);
 *  - trust classes are distinct (AI finding ≠ record fact; the ACCEPTED
 *    upgrade is explicit via an edge, never silent);
 *  - every node/edge carries provenance (source/actor/at/sourceType);
 *  - edge kinds are closed (GRAPH_EDGE_KINDS);
 *  - bounded (limits) and deterministic;
 *  - consistency checks REPORT problems (orphans, missing provenance,
 *    duplicates, impossible links, stale derived, conflicting state) —
 *    never silently repair clinical data.
 */
import { describe, it, expect } from 'vitest'
import { createFakePrisma, HOSP_A, PAT_A1, PAT_A2, PAT_B1, NOW, ACTORS } from '@/tests/harness/context-fixtures'
import { buildCaseGraph, traverseGraph, checkGraphConsistency, type GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { GRAPH_EDGE_KINDS, GRAPH_NODE_KINDS, GRAPH_TRUSTS, type CaseGraph, type GraphNode, type GraphEdge } from '@/lib/ai/intelligence/types'

const STAFF_A = [
  { id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' },
  { id: 'staff-doctor-B', hospitalId: 'hosp-B', firstName: 'Laila', lastName: 'Nabil', role: 'DOCTOR' },
]
// Standalone AI jobs (the graph reads them from the aiAnalysisJob table and
// re-pins them to the patient's studies — embedded job shapes are not used).
const AI_JOBS = [
  {
    id: 'job-A1', hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED',
    requestedById: 'staff-doctor-1', modelVersion: 'v1.2.0', modelChecksum: 'c0ffee0000000000000000000000000000000000',
    orchestratorVersion: '2.1.0', startedAt: NOW, completedAt: NOW,
    confidence: 0.87, findings: [{ condition: 'caries', tooth_number: 36 }],
    reviewedById: 'staff-doctor-1', reviewedAt: NOW, reviewDecision: 'ACCEPTED',
    acceptedFindings: [{ condition: 'caries', tooth_number: 36 }], createdAt: NOW,
  },
  {
    id: 'job-B1', hospitalId: 'hosp-B', studyId: 'study-B1', engine: 'clm', status: 'COMPLETED',
    requestedById: 'staff-doctor-B', modelVersion: 'v1.2.0', modelChecksum: 'beef0000000000000000000000000000000000',
    orchestratorVersion: '2.1.0', startedAt: NOW, completedAt: NOW,
    confidence: 0.9, findings: [{ condition: 'periapical', tooth_number: 46 }],
    reviewedById: null, reviewedAt: null, reviewDecision: null,
    acceptedFindings: null, createdAt: NOW,
  },
]
const baseExtra = (memory = true) => ({
  staff: STAFF_A,
  aiAnalysisJob: AI_JOBS,
  aiMemoryItem: memory
    ? [{
        id: 'mem-A1-1', hospitalId: HOSP_A, domain: 'PATIENT', patientId: PAT_A1,
        key: 'event.followup_plan', value: { summary: 'Recheck 36 in four weeks' },
        trustLevel: 'USER_PROVIDED', status: 'ACTIVE', sourceKind: 'USER_STATEMENT',
        sourceRef: null, createdBy: 'staff-doctor-1', createdByIdType: 'USER',
        createdAt: NOW, updatedAt: NOW, expiresAt: null, supersededBy: null,
      }]
    : [],
} as never)

const db = () => createFakePrisma(baseExtra())

const build = (p: { hospitalId?: string; patientId?: string; caseId?: string | null; now?: Date } = {}) =>
  buildCaseGraph(db() as unknown as GraphPrisma, {
    hospitalId: p.hospitalId ?? HOSP_A,
    patientId: p.patientId ?? PAT_A1,
    caseId: p.caseId ?? null,
    actor: { id: ACTORS.doctorA.id, role: ACTORS.doctorA.role },
    now: p.now ?? NOW,
  })

describe('Phase 9 — case graph: scope & fail-closed (§7)', () => {
  it('unknown patient → INT_PATIENT_NOT_FOUND (never an empty graph served)', async () => {
    await expect(build({ patientId: 'pat-nope' })).rejects.toMatchObject({ code: 'INT_PATIENT_NOT_FOUND' })
  })

  it('cross-tenant patient → INT_SCOPE_MISMATCH (the tenant-B trap)', async () => {
    await expect(build({ patientId: PAT_B1 })).rejects.toMatchObject({ code: 'INT_SCOPE_MISMATCH' })
  })

  it('a graph contains ONLY the target patient (no cross-patient nodes)', async () => {
    const g = await build({ patientId: PAT_A1 })
    const patientNodes = g.nodes.filter((n) => n.kind === 'PATIENT')
    expect(patientNodes.map((n) => n.ref)).toEqual([PAT_A1])
    for (const e of g.edges) {
      if (e.kind.startsWith('PATIENT_')) {
        expect(e.from === `patient:${PAT_A1}` || e.to === `patient:${PAT_A1}`, `edge ${e.kind} off the patient spine`).toBe(true)
      }
    }
  })

  it('case focus is recorded on the graph (patient spine remains)', async () => {
    const gCase = await build({ patientId: PAT_A1, caseId: 'plan-A1' })
    expect(gCase.caseId).toBe('plan-A1')
    expect(gCase.patientId).toBe(PAT_A1)
    expect(gCase.nodes.length).toBeGreaterThan(0)
  })
})

describe('Phase 9 — case graph: trust classes & provenance (§8)', () => {
  it('every node and edge carries full provenance + closed kinds', async () => {
    const graph = await build({ patientId: PAT_A1 })
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(0)
    for (const n of graph.nodes) {
      expect(n.provenance.source).toBeTruthy()
      expect(n.provenance.actor).toBeTruthy()
      expect(new Date(n.provenance.at).getTime()).not.toBeNaN()
      expect(['RECORD', 'DERIVED', 'AI', 'USER', 'KNOWLEDGE']).toContain(n.provenance.sourceType)
      expect(GRAPH_TRUSTS).toContain(n.trust)
      expect(GRAPH_NODE_KINDS).toContain(n.kind)
    }
    for (const e of graph.edges) {
      expect(GRAPH_EDGE_KINDS).toContain(e.kind)
      expect(e.provenance.source).toBeTruthy()
      expect(e.trust).toBeTruthy()
      const from = graph.nodes.find((n) => n.id === e.from)
      const to = graph.nodes.find((n) => n.id === e.to)
      expect(from, `edge ${e.kind} ${e.from}→${e.to} orphan from`).toBeTruthy()
      expect(to, `edge ${e.kind} ${e.from}→${e.to} orphan to`).toBeTruthy()
    }
  })

  it('ACCEPTED AI job → DOCTOR_CONFIRMED trust + explicit confirmation edge', async () => {
    const graph = await build({ patientId: PAT_A1 })
    const ai = graph.nodes.filter((n) => n.id.startsWith('aifinding:'))
    expect(ai.length).toBe(1) // job-A1 (tenant A only)
    expect(ai[0].trust).toBe('DOCTOR_CONFIRMED')
    const confirmEdges = graph.edges.filter((e) => e.kind === 'AI_FINDING_CONFIRMED_BY')
    expect(confirmEdges.length).toBe(1)
    expect(confirmEdges[0].from).toBe(ai[0].id)
    const link = graph.edges.find((e) => e.kind === 'IMAGING_HAS_AI_FINDING' && e.to === ai[0].id)
    expect(link?.trust).toBe('DOCTOR_CONFIRMED')
  })

  it('a tenant-B (unreviewed) AI job NEVER appears in a tenant-A graph', async () => {
    const graph = await build({ patientId: PAT_A1 })
    expect(graph.nodes.filter((n) => n.id.includes('job-B1'))).toHaveLength(0)
  })

  it('interpretation never silently becomes fact: pending AI job keeps AI_DERIVED', async () => {
    const fake = createFakePrisma({
      ...baseExtra(false),
      aiAnalysisJob: [{
        id: 'job-pend', hospitalId: HOSP_A, studyId: 'study-pend', engine: 'clm', status: 'COMPLETED',
        requestedById: null, modelVersion: 'v1', modelChecksum: 'aa', orchestratorVersion: '2',
        startedAt: NOW, completedAt: NOW, confidence: 0.5, findings: [],
        reviewedById: null, reviewedAt: null, reviewDecision: null, acceptedFindings: null, createdAt: NOW,
      }],
      imagingStudy: [
        {
          id: 'study-pend', hospitalId: HOSP_A, patientId: PAT_A1,
          studyType: 'PERIAPICAL', modality: 'DIGITAL_XRAY', studyDate: NOW,
          status: 'COMPLETED', description: 'pending job', appointmentId: null, appointment: null,
          uploadedById: 'staff-doctor-1', uploadedBy: null, createdAt: NOW,
          aiJobs: [{ id: 'job-pend', engine: 'clm', status: 'COMPLETED', modelVersion: 'v1', modelChecksum: 'aa', orchestratorVersion: '2', completedAt: NOW, createdAt: NOW, confidence: 0.5, findings: [], reviewedById: null, reviewedAt: null, reviewDecision: null, reviewedBy: null, acceptedFindings: null }],
        },
      ],
    } as never)
    const graph = await buildCaseGraph(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
    })
    const pending = graph.nodes.find((n) => n.id === 'aifinding:job-pend')
    expect(pending?.trust).toBe('AI_DERIVED')
    expect(graph.edges.some((e) => e.kind === 'AI_FINDING_CONFIRMED_BY' && e.from === 'aifinding:job-pend')).toBe(false)
  })
})

describe('Phase 9 — case graph: content mapping (§6)', () => {
  it('maps teeth, findings, case, treatments, follow-up, imaging, memory, symptoms', async () => {
    const graph = await build({ patientId: PAT_A1 })
    const kinds = new Set(graph.nodes.map((n) => n.kind))
    for (const k of ['PATIENT', 'TOOTH', 'CASE', 'TREATMENT', 'FOLLOW_UP', 'IMAGING', 'AI_FINDING', 'MEMORY', 'SYMPTOM', 'FINDING']) {
      expect(kinds, `missing kind ${k}`).toContain(k as never)
    }
    const tooth36 = graph.nodes.find((n) => n.kind === 'TOOTH' && n.ref === '36')
    expect(tooth36).toBeTruthy()
    const findings36 = graph.edges.filter((e) => e.kind === 'TOOTH_HAS_FINDING' && e.from === tooth36!.id)
    expect(findings36.length).toBeGreaterThanOrEqual(2) // active + resolved history
    const fu = graph.nodes.find((n) => n.kind === 'FOLLOW_UP')
    expect(fu).toBeTruthy()
    expect(typeof fu!.data.date).toBe('string')
    const mem = graph.nodes.find((n) => n.kind === 'MEMORY')
    expect(mem?.id.startsWith('memory:')).toBe(true)
  })

  it('cross-patient trap: PAT_A2 tooth-36 entry never lands in PAT_A1 graph', async () => {
    const graph = await build({ patientId: PAT_A1 })
    expect(graph.nodes.filter((n) => n.id.includes('chart-A2'))).toHaveLength(0)
    void PAT_A2
  })
})

describe('Phase 9 — traversal & consistency (§31/§36)', () => {
  it('traverse: bounded depth, tenant-pinned node set', async () => {
    const graph = await build({ patientId: PAT_A1 })
    const res = traverseGraph(graph, { startId: `patient:${PAT_A1}`, maxDepth: 2 })
    expect(res.nodes.length).toBeGreaterThan(0)
    expect(res.maxDepthReached).toBeLessThanOrEqual(2)
    const ids = new Set(graph.nodes.map((n) => n.id))
    for (const n of res.nodes) expect(ids).toContain(n.id)
  })

  it('traverse: unknown start node → empty result (no crash, no leak)', async () => {
    const graph = await build({ patientId: PAT_A1 })
    const res = traverseGraph(graph, { startId: 'patient:pat-foreign', maxDepth: 3 })
    expect(res.nodes).toHaveLength(0)
    expect(res.edges).toHaveLength(0)
  })

  it('consistency: clean fixture graph → no non-stale findings', async () => {
    const graph = await build({ patientId: PAT_A1 })
    const issues = checkGraphConsistency(graph)
    const nonStale = issues.filter((i) => i.code !== 'STALE_DERIVED_RELATIONSHIP')
    expect(nonStale).toEqual([])
  })

  it('consistency: orphan + duplicate + missing-provenance edges are REPORTED (report-only)', async () => {
    const graph = await build({ patientId: PAT_A1 })
    const orphanEdge: GraphEdge = {
      kind: 'PATIENT_HAS_APPOINTMENT', from: `patient:${PAT_A1}`, to: 'appointment:ghost', trust: 'RECORD_FACT',
      provenance: { source: 'x', actor: 'SYSTEM', at: NOW.toISOString(), sourceType: 'RECORD' },
    }
    const noProvEdge: GraphEdge = {
      ...graph.edges[0],
      provenance: { source: '', actor: 'SYSTEM', at: NOW.toISOString(), sourceType: 'RECORD' },
    }
    const mutated: CaseGraph = {
      ...graph,
      nodes: [...graph.nodes],
      edges: [...graph.edges, orphanEdge, noProvEdge, { ...graph.edges[0] }],
    }
    const issues = checkGraphConsistency(mutated)
    const codes = issues.map((i) => i.code)
    expect(codes).toContain('ORPHAN_EDGE')
    expect(codes).toContain('DUPLICATE_EDGE')
    expect(codes).toContain('MISSING_PROVENANCE')
    // The original graph object is untouched (report-only, never repaired).
    expect(graph.edges).not.toBe(mutated.edges)
    expect(graph.edges.length).toBeLessThan(mutated.edges.length)
  })

  it('consistency: two distinct patient nodes → impossible-link finding', async () => {
    const graph = await build({ patientId: PAT_A1 })
    const ghost: GraphNode = {
      id: 'patient:pat-ghost', kind: 'PATIENT', ref: 'pat-ghost', label: 'ghost', trust: 'UNKNOWN',
      provenance: { source: 'unknown', actor: 'SYSTEM', at: NOW.toISOString(), sourceType: 'DERIVED' }, data: {},
    }
    const mutated: CaseGraph = {
      ...graph,
      nodes: [...graph.nodes, ghost],
      edges: [
        ...graph.edges,
        {
          kind: 'PATIENT_HAS_SYMPTOM', from: `patient:${PAT_A1}`, to: 'patient:pat-ghost', trust: 'USER_PROVIDED',
          provenance: { source: 'forged', actor: 'SYSTEM', at: NOW.toISOString(), sourceType: 'DERIVED' },
        },
      ],
    }
    const codes = checkGraphConsistency(mutated).map((i) => i.code)
    expect(codes).toContain('IMPOSSIBLE_PATIENT_CASE_LINK')
  })

  it('consistency: stale (past-dated) recorded follow-up is REPORTED, not auto-corrected', async () => {
    const fake = createFakePrisma({
      ...baseExtra(false),
      treatment: [
        {
          id: 'trt-stale', hospitalId: HOSP_A, patientId: PAT_A1, treatmentNo: 'TRT-STALE',
          status: 'COMPLETED', toothNumbers: '36', diagnosis: null, findings: null, chiefComplaint: null,
          procedureId: 'proc-rct', procedure: { name: 'RCT' }, doctorId: 'staff-doctor-1', doctor: null,
          startTime: NOW, endTime: NOW, followUpRequired: true, followUpDate: new Date(NOW.getTime() - 5 * 86400000),
          followUpNotes: null, complications: null, appointmentId: null, createdAt: NOW, updatedAt: NOW,
        },
      ],
    } as never)
    const graph = await buildCaseGraph(fake as unknown as GraphPrisma, {
      hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
      actor: { id: ACTORS.doctorA.id, role: 'DOCTOR' }, now: NOW,
    })
    const codes = checkGraphConsistency(graph).map((i) => i.code)
    expect(codes).toContain('STALE_DERIVED_RELATIONSHIP')
    // The row itself is untouched — the graph only REPORTS.
    const rows = await (fake as { treatment: { findMany: () => Promise<unknown[]> } }).treatment.findMany()
    expect((rows as Record<string, unknown>[]).find((r) => r.id === 'trt-stale')?.followUpRequired).toBe(true)
  })
})

/**
 * Phase 9 — evaluation goldens (§31–§32).
 *
 * Synthetic goldens over the REAL deterministic modules (no LLM involved in
 * this surface — honesty: these modules are rules over structured data, so
 * "evaluation" = typed invariants over golden scenarios, fail-closed).
 *
 * Dataset: tests/evaluation/golden/intelligence-phase9.golden.json
 * (SYNTHETIC_ONLY — no real patient data; same policy attestation as the
 * Phase 7/8 agent goldens).
 *
 * Every case produces ≥1 typed check; ANY FAIL fails this test (zero
 * false-greens). Deterministic replay goldens (WF-001) run the module twice
 * over fresh stores and require identical step programs + results.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakePrisma, HOSP_A, HOSP_B, PAT_A1, NOW } from '@/tests/harness/context-fixtures'
import { buildCaseGraph, type GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { understandCase, buildClinicalSummary, differentialSupport } from '@/lib/ai/intelligence/dental-brain'
import { buildPatientIntelligence } from '@/lib/ai/intelligence/patient-ai'
import { buildClinicMetrics, buildCommandCenter, type ClinicPrisma } from '@/lib/ai/intelligence/clinic-brain'
import { runProactiveIntelligence, type AlertPrisma } from '@/lib/ai/intelligence/proactive'
import { runWorkflow, type WorkflowDeps } from '@/lib/ai/workflows/engine'
import { createMemoryWorkflowRunStore } from '@/lib/ai/workflows/run-store'
import { IntelligenceError, type CaseGraph } from '@/lib/ai/intelligence/types'
import type { WorkflowContext } from '@/lib/ai/workflows/types'

interface GoldenCheck {
  id: string
  code: string
  verdict: 'PASS' | 'FAIL'
  detail: string
}

interface GJob {
  id: string
  engine: string
  status: string
  reviewDecision: string | null
  findings: unknown[]
  acceptedFindings: unknown[]
  modelVersion: string
  modelChecksum: string
}

interface GoldenCase9 {
  caseId: string
  module: 'case-graph' | 'dental-brain' | 'patient-ai' | 'clinic-brain' | 'workflows' | 'alerts'
  tenant: 'A' | 'B'
  patientId?: string
  actorRole?: string
  pipeline?: string
  workflowId?: string
  emptyPatient?: boolean
  todayAppointments?: { status: string }[]
  aiJobs: GJob[]
  expect: Record<string, unknown>
}

const DATASET = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'golden', 'intelligence-phase9.golden.json'), 'utf8'),
) as { phiPolicy: string; cases: GoldenCase9[] }

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

function fullJob(job: GJob, tenant: 'A'): Record<string, unknown> {
  const reviewed = job.reviewDecision !== null
  return {
    id: job.id,
    hospitalId: tenant === 'A' ? HOSP_A : HOSP_B,
    studyId: tenant === 'A' ? 'study-A1' : 'study-B1',
    engine: job.engine,
    status: job.status,
    requestedById: null,
    modelVersion: job.modelVersion,
    modelChecksum: job.modelChecksum,
    orchestratorVersion: '2.1.0',
    startedAt: NOW, completedAt: NOW, confidence: 0.85,
    findings: job.findings,
    reviewedById: reviewed ? 'staff-doctor-1' : null,
    reviewedAt: reviewed ? NOW : null,
    reviewDecision: job.reviewDecision,
    acceptedFindings: job.acceptedFindings,
    createdAt: NOW,
  }
}

const EMPTY_PATIENT = {
  id: 'pat-empty', hospitalId: HOSP_A, patientId: 'PAT-EMPTY',
  firstName: 'Empty', lastName: 'Record', age: 30, dateOfBirth: new Date('1996-01-01'),
  gender: 'MALE', phone: null, alternatePhone: null, email: null, locale: 'ar',
  portalUserId: null, createdAt: daysAgo(100), medicalHistory: null,
}

function makeFixture(c: GoldenCase9) {
  const tenant = c.tenant
  const extra: Record<string, Record<string, unknown>[]> = {
    staff: [{ id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' }],
    aiAnalysisJob: c.aiJobs.map((j) => fullJob(j, tenant)),
    aiMemoryItem: [],
  }
  if (c.emptyPatient) extra.patient = [EMPTY_PATIENT]
  if (c.todayAppointments) {
    const d0 = new Date(NOW)
    const at = (h: number) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), h)
    extra.appointment = c.todayAppointments.map((a, i) => ({
      id: `eval-appt-${i}`, hospitalId: HOSP_A, patientId: 'pat-A1', appointmentNo: `EVAL-${i}`,
      appointmentType: 'CONSULTATION', status: a.status, scheduledDate: at(8 + (i % 8)),
      chiefComplaint: null, doctorId: 'staff-doctor-1', priority: 'NORMAL',
      checkedInAt: null, checkedOutAt: null, createdAt: daysAgo(2),
    }))
  }
  return createFakePrisma(extra as never) as unknown as Record<string, any>
}

function withInsights(fake: Record<string, any>) {
  const rows: Record<string, unknown>[] = []
  let seq = 0
  fake.aIInsight = {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `eval-ins-${++seq}`, createdAt: NOW, dismissed: false, ...data }
      rows.push(row)
      return row
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0
      for (const r of rows) if (Object.entries(where).every(([k, v]) => r[k] === v)) { Object.assign(r, data); count++ }
      return { count }
    },
  }
  return rows
}

function wfDeps(fake: Record<string, any>, c: GoldenCase9): WorkflowDeps {
  return {
    prisma: fake as unknown as GraphPrisma,
    now: () => NOW,
    store: createMemoryWorkflowRunStore(),
    nextRunId: (n) => `wfrun-eval-${n}`,
    ...(c.pipeline === 'APPROVAL_REQUIRED'
      ? { runAction: async () => ({ status: 'APPROVAL_REQUIRED', success: false, message: 'pending', approvalId: 'appr-golden' }) }
      : {}),
  }
}

function wfCtx(c: GoldenCase9): WorkflowContext {
  return {
    hospitalId: HOSP_A,
    patientId: c.patientId ?? null,
    caseId: null,
    actor: { id: 'eval-actor', role: c.actorRole ?? 'DOCTOR', name: 'Eval Actor' },
  }
}

async function buildGraph(c: GoldenCase9): Promise<CaseGraph> {
  const fake = makeFixture(c)
  return buildCaseGraph(fake as unknown as GraphPrisma, {
    hospitalId: c.tenant === 'A' ? HOSP_A : HOSP_B,
    patientId: c.patientId!,
    caseId: null,
    actor: { id: 'eval-actor', role: 'DOCTOR' },
    now: NOW,
  })
}

async function evaluateCase(c: GoldenCase9): Promise<GoldenCheck[]> {
  const checks: GoldenCheck[] = []
  const chk = (code: string, ok: boolean, detail: string) =>
    checks.push({ id: c.caseId, code, verdict: ok ? 'PASS' : 'FAIL', detail })

  // expectedError cases: the module MUST throw the typed error.
  if (typeof c.expect.expectedError === 'string') {
    try {
      if (c.module === 'workflows') {
        await runWorkflow(wfDeps(makeFixture(c), c), { workflowId: c.workflowId!, context: wfCtx(c) })
        chk('EXPECTED_ERROR', false, `expected ${c.expect.expectedError} but the run succeeded`)
      } else {
        await buildGraph(c)
        chk('EXPECTED_ERROR', false, `expected ${c.expect.expectedError} but the graph built`)
      }
    } catch (e) {
      chk('EXPECTED_ERROR', e instanceof IntelligenceError && e.code === c.expect.expectedError, `threw ${e instanceof IntelligenceError ? e.code : String(e)} (expected ${c.expect.expectedError})`)
    }
    return checks
  }

  if (c.module === 'case-graph' || c.module === 'dental-brain' || c.module === 'patient-ai') {
    const g = await buildGraph(c)
    const blob = JSON.stringify({ nodes: g.nodes, edges: g.edges })

    if (c.module === 'case-graph') {
      const teeth = [...new Set(
        g.nodes.filter((n) => n.id.startsWith('finding:')).map((n) => Number(n.data.toothNumber ?? n.data.tooth)).filter((t) => !Number.isNaN(t)),
      )].sort((a, b) => a - b)
      if (Array.isArray(c.expect.teeth)) {
        chk('TEETH', JSON.stringify(teeth) === JSON.stringify(c.expect.teeth), `teeth ${JSON.stringify(teeth)} (golden ${JSON.stringify(c.expect.teeth)})`)
      }
      if (Array.isArray(c.expect.nodeKinds)) {
        const kinds = new Set(g.nodes.map((n) => n.kind))
        chk('NODE_KINDS', (c.expect.nodeKinds as string[]).every((k) => kinds.has(k)), `kinds ${[...kinds].join(',')}`)
      }
      if (c.expect.allEdgesHaveProvenance) {
        const bad = g.edges.filter((e) => !e.provenance?.source || !e.provenance?.at).length
        chk('EDGE_PROVENANCE', bad === 0, `${g.edges.length} edges, ${bad} without provenance`)
      }
      if (typeof c.expect.maxNodes === 'number') {
        chk('BOUND', g.nodes.length <= c.expect.maxNodes, `${g.nodes.length} nodes (limit ${c.expect.maxNodes})`)
      }
      if (Array.isArray(c.expect.forbiddenSubstrings)) {
        const leaked = (c.expect.forbiddenSubstrings as string[]).filter((s) => blob.includes(s))
        chk('ISOLATION', leaked.length === 0, leaked.length ? `leaked: ${leaked.join(', ')}` : 'no foreign data in graph')
      }
    }

    if (c.module === 'dental-brain') {
      const u = understandCase(g, { procedureCategories: [], now: NOW })
      if (Array.isArray(c.expect.affectedTeeth)) {
        const teeth = u.teeth.map((t) => Number(t.fdi)).sort((a, b) => a - b)
        chk('AFFECTED_TEETH', JSON.stringify(teeth) === JSON.stringify(c.expect.affectedTeeth), `teeth ${JSON.stringify(teeth)}`)
      }
      if (typeof c.expect.clinicianConfirmedMin === 'number') {
        chk('CONFIRMED_MIN', u.clinicianConfirmedFindings.length >= c.expect.clinicianConfirmedMin, `${u.clinicianConfirmedFindings.length} confirmed`)
      }
      if (Array.isArray(c.expect.domainsInclude)) {
        const domains = u.domains.map((d) => d.domain ?? d)
        chk('DOMAINS', (c.expect.domainsInclude as string[]).every((d) => domains.includes(d)), `domains ${JSON.stringify(domains)}`)
      }
      if (c.expect.missingInformationEmpty) {
        chk('MISSING_EMPTY', u.missingInformation.length === 0, JSON.stringify(u.missingInformation))
      }
      if (Array.isArray(c.expect.missingInformationIncludes)) {
        chk('MISSING_INCLUDES', (c.expect.missingInformationIncludes as string[]).every((m) => u.missingInformation.includes(m)), JSON.stringify(u.missingInformation))
      }
      const summary = buildClinicalSummary(u, g, 'Patient')
      if (typeof c.expect.summarySections === 'number') {
        const sectionKeys = Object.keys(summary).filter((k) => k !== 'disclaimerKey')
        chk('SUMMARY_SECTIONS', sectionKeys.length === c.expect.summarySections, `${sectionKeys.length} sections`)
      }
      if (c.expect.noDiagnosisFabrication) {
        // No top-level diagnosis on the summary, no AI-derived diagnosis in
        // the understanding, and the differential keeps its CDS stance.
        // (A plan's *recorded* diagnosis flag is a clinician record, not a
        // fabrication — the invariant is about structure + stance.)
        const noTopLevel = !('diagnosis' in summary)
        const noAiDiag = !JSON.stringify(u).includes('"aiDiagnosis"')
        const diff = differentialSupport(g, { procedureCategories: [] })
        chk('NO_DIAGNOSIS', noTopLevel && noAiDiag && diff.stance === 'clinical_decision_support', `topLevel=${noTopLevel} aiDiag=${noAiDiag} stance=${diff.stance}`)
      }
      const diff = differentialSupport(g, { procedureCategories: [] })
      if (typeof c.expect.differentialStance === 'string') {
        chk('CDS_STANCE', diff.stance === c.expect.differentialStance, diff.stance)
      }
      if (typeof c.expect.differentialCandidatesMin === 'number') {
        chk('DIFF_MIN', diff.candidates.length >= c.expect.differentialCandidatesMin, `${diff.candidates.length} candidates`)
      }
    }

    if (c.module === 'patient-ai') {
      const pi = buildPatientIntelligence(g, NOW)
      if (c.expect.timelineSortedDesc) {
        let ok = true
        for (let i = 1; i < pi.timeline.length; i++) {
          if (String(pi.timeline[i].at) > String(pi.timeline[i - 1].at)) { ok = false; break }
        }
        chk('TIMELINE_DESC', ok, `${pi.timeline.length} events`)
      }
      if (Array.isArray(c.expect.timelineKinds)) {
        const bad = pi.timeline.filter((e) => !(c.expect.timelineKinds as string[]).includes(e.kind))
        chk('TIMELINE_KINDS', bad.length === 0, bad.length ? `unexpected ${bad.map((b) => b.kind).join(',')}` : 'all kinds canonical')
      }
      if (typeof c.expect.aiEventFact === 'string') {
        const ev = pi.timeline.find((e) => e.id === `ev:aifinding:${c.expect.aiEventFact}`)
        chk('AI_FACT', ev?.insightClass === 'FACT', ev ? ev.insightClass : 'event missing')
      }
      if (typeof c.expect.aiEventNotFact === 'string') {
        const ev = pi.timeline.find((e) => e.id === `ev:aifinding:${c.expect.aiEventNotFact}`)
        chk('AI_NOT_FACT', ev !== undefined && ev.insightClass !== 'FACT', ev ? ev.insightClass : 'event missing')
      }
      if (typeof c.expect.currentTreatmentsIncludeRef === 'string') {
        chk('CURRENT_TREATMENT', pi.current.currentTreatments.some((t) => t.ref === c.expect.currentTreatmentsIncludeRef), JSON.stringify(pi.current.currentTreatments.map((t) => t.ref)))
      }
      if (c.expect.timelineEmpty) {
        chk('TIMELINE_EMPTY', pi.timeline.length === 0, `${pi.timeline.length} events`)
      }
      if (c.expect.activeCasesEmpty) {
        chk('ACTIVE_CASES_EMPTY', pi.current.activeCases.length === 0, `${pi.current.activeCases.length} cases`)
      }
      if (typeof c.expect.timelineLimit === 'number') {
        chk('TIMELINE_LIMIT', pi.timeline.length <= c.expect.timelineLimit, `${pi.timeline.length} events`)
      }
      if (typeof c.expect.unresolvedIssuesMin === 'number') {
        chk('UNRESOLVED_MIN', pi.current.unresolvedIssues.length >= c.expect.unresolvedIssuesMin, `${pi.current.unresolvedIssues.length} issues`)
      }
    }
    return checks
  }

  if (c.module === 'clinic-brain') {
    const fake = makeFixture(c)
    const db = fake as unknown as ClinicPrisma
    const role = c.actorRole ?? 'DOCTOR'
    const [m, cc] = await Promise.all([
      buildClinicMetrics(db, { hospitalId: HOSP_A, now: NOW, actorRole: role }),
      buildCommandCenter(db, { hospitalId: HOSP_A, now: NOW, actorRole: role }),
    ])
    if (typeof c.expect.todayTotal === 'number') {
      chk('TODAY_TOTAL', m.todayAppointments.total === c.expect.todayTotal, `${m.todayAppointments.total} appointments`)
    }
    if ('utilization' in c.expect) {
      chk('UTILIZATION', m.todayAppointments.utilization === c.expect.utilization, `utilization ${m.todayAppointments.utilization}`)
    }
    if (Array.isArray(c.expect.bottleneckCodes)) {
      const codes = m.bottlenecks.rows.map((b) => b.code)
      chk('BOTTLENECKS', (c.expect.bottleneckCodes as string[]).every((k) => codes.includes(k)), JSON.stringify(codes))
    }
    if (typeof c.expect.financialState === 'string') {
      chk('FINANCIAL_GATE', m.financialItems.state === c.expect.financialState, `${role} → ${m.financialItems.state}`)
    }
    if (typeof c.expect.commandCenterSectionsMin === 'number') {
      chk('CC_SECTIONS', cc.sections.length >= c.expect.commandCenterSectionsMin, `${cc.sections.length} sections`)
    }
    if (c.expect.delayedNotMeasured) {
      const delayed = cc.sections.find((s) => s.key === 'delayedAppointments')
      chk('DELAYED_NOT_MEASURED', delayed?.state === 'NOT_MEASURED', delayed?.state)
    }
    return checks
  }

  if (c.module === 'workflows') {
    const first = await runWorkflow(wfDeps(makeFixture(c), c), { workflowId: c.workflowId!, context: wfCtx(c) })
    if (typeof c.expect.status === 'string') {
      chk('STATUS', first.run.status === c.expect.status, `${first.run.status}`)
    }
    if (typeof c.expect.steps === 'number') {
      chk('STEPS', first.run.stepLog.length === c.expect.steps, `${first.run.stepLog.length} steps`)
    }
    if (typeof c.expect.failedStep === 'string') {
      chk('FAILED_STEP', first.run.result?.failedStep === c.expect.failedStep, JSON.stringify(first.run.result))
    }
    if (Array.isArray(c.expect.outputKeysInclude)) {
      const keys = first.outputItems.map((o) => o.titleKey)
      chk('OUTPUT_KEYS', (c.expect.outputKeysInclude as string[]).every((k) => keys.includes(k)), JSON.stringify(keys))
    }
    if (c.expect.noExecutedAction) {
      chk('NO_EXECUTED_ACTION', first.outputItems.filter((o) => o.titleKey === 'wf.out.actionExecuted').length === 0, 'sensitive step never executed directly')
    }
    if (c.expect.replayDeterministic) {
      const second = await runWorkflow(wfDeps(makeFixture(c), c), { workflowId: c.workflowId!, context: wfCtx(c) })
      const sameSteps = JSON.stringify(first.run.stepLog.map((s) => s.stepId)) === JSON.stringify(second.run.stepLog.map((s) => s.stepId))
      const sameResult = JSON.stringify(first.run.result) === JSON.stringify(second.run.result)
      const sameItems = JSON.stringify(first.outputItems.map((o) => o.titleKey)) === JSON.stringify(second.outputItems.map((o) => o.titleKey))
      chk('REPLAY_DETERMINISTIC', sameSteps && sameResult && sameItems, `steps=${sameSteps} result=${sameResult} items=${sameItems}`)
    }
    return checks
  }

  if (c.module === 'alerts') {
    const fake = makeFixture(c)
    const rows = withInsights(fake)
    const db = fake as unknown as AlertPrisma
    const first = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'eval-actor' })
    if (typeof c.expect.created === 'number') {
      chk('CREATED', first.created === c.expect.created, `created ${first.created} of ${first.detected.length} detected`)
    }
    if (typeof c.expect.reRunCreated === 'number' || typeof c.expect.reRunDeduplicated === 'number') {
      const second = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'eval-actor' })
      if (typeof c.expect.reRunCreated === 'number') chk('RERUN_CREATED', second.created === c.expect.reRunCreated, `created ${second.created}`)
      if (typeof c.expect.reRunDeduplicated === 'number') chk('RERUN_DEDUP', second.deduplicated === c.expect.reRunDeduplicated, `dedup ${second.deduplicated}`)
    }
    if (c.expect.signalOnly) {
      const bad = rows.filter((r) => (r.data as Record<string, unknown>).action !== null)
      chk('SIGNAL_ONLY', bad.length === 0, `${rows.length} alerts, ${bad.length} with actions`)
    }
    return checks
  }

  chk('UNSUPPORTED_MODULE', false, `module ${c.module} not covered by evaluator`)
  return checks
}

describe('Phase 9 — evaluation goldens (SYNTHETIC_ONLY, §31–§32)', () => {
  it('dataset attests synthetic-only PHI policy', () => {
    expect(DATASET.phiPolicy).toBe('SYNTHETIC_ONLY')
    expect(DATASET.cases.length).toBeGreaterThanOrEqual(14)
  })

  it('every golden case passes every typed check (fail-closed)', async () => {
    const all: GoldenCheck[] = []
    for (const c of DATASET.cases) {
      const checks = await evaluateCase(c)
      expect(checks.length, `${c.caseId} produced no checks`).toBeGreaterThan(0)
      all.push(...checks)
    }
    const failures = all.filter((c) => c.verdict === 'FAIL')
    if (failures.length > 0) {
      throw new Error(
        `PHASE 9 GOLDEN FAILURES:\n` + failures.map((f) => `  ✗ [${f.id}] ${f.code}: ${f.detail}`).join('\n'),
      )
    }
    const codes = new Set(all.map((c) => c.code))
    expect(codes.size).toBeGreaterThan(10) // the suite really exercises many invariants
  })
})

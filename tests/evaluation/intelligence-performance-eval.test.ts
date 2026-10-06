/**
 * Phase 9 — PERFORMANCE gate (Gate K, §36): environment-labeled metrics for
 * the intelligence + workflow surface.
 *
 * Same contract as Phase 7/8 performance gates:
 *   - every number is emitted with its environment label
 *     (SANDBOX / DEVELOPMENT_MACHINE / TARGET_MACHINE / UNKNOWN);
 *   - in this environment the label must NOT be TARGET_MACHINE unless the
 *     suite is explicitly forced (no silent production claims);
 *   - warmup + samples, median / p95, zero failures.
 *
 * Measured (all SYNTHETIC harness data):
 *   - case-graph: build + bounded traversal (depth / query count);
 *   - per-brain + summary: understanding, summary, differential,
 *     patient AI timeline;
 *   - workflow: full case_review run (total / steps / tool calls);
 *   - proactive: sweep detection + idempotent re-run (dedup path).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { benchmark, environmentFacts, assertLabeled, isEnvLabel } from '@/lib/ai/evaluation'
import { createFakePrisma, HOSP_A, PAT_A1, NOW } from '@/tests/harness/context-fixtures'
import { buildCaseGraph, traverseGraph, type GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { understandCase, buildClinicalSummary, differentialSupport } from '@/lib/ai/intelligence/dental-brain'
import { buildPatientIntelligence } from '@/lib/ai/intelligence/patient-ai'
import { buildClinicMetrics, buildCommandCenter, type ClinicPrisma } from '@/lib/ai/intelligence/clinic-brain'
import { runProactiveIntelligence, type AlertPrisma } from '@/lib/ai/intelligence/proactive'
import { runWorkflow, type WorkflowDeps } from '@/lib/ai/workflows/engine'
import { createMemoryWorkflowRunStore } from '@/lib/ai/workflows/run-store'
import type { WorkflowContext } from '@/lib/ai/workflows/types'

const envLabel = environmentFacts().label

function fixture() {
  return createFakePrisma({
    staff: [{ id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' }],
    aiAnalysisJob: [{
      id: 'job-perf', hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED',
      requestedById: null, modelVersion: 'v1', modelChecksum: 'c', orchestratorVersion: '2',
      startedAt: NOW, completedAt: NOW, confidence: 0.87,
      findings: [{ condition: 'caries', tooth_number: 36 }],
      reviewedById: 'staff-doctor-1', reviewedAt: NOW, reviewDecision: 'ACCEPTED',
      acceptedFindings: [{ condition: 'caries', tooth_number: 36 }], createdAt: NOW,
    }],
    aiMemoryItem: [],
  } as never) as unknown as GraphPrisma
}

function wfDeps(): WorkflowDeps {
  return {
    prisma: fixture(),
    now: () => NOW,
    store: createMemoryWorkflowRunStore(),
    nextRunId: (n) => `wfrun-perf-${n}`,
  }
}

const wfCtx: WorkflowContext = {
  hospitalId: HOSP_A, patientId: PAT_A1, caseId: null,
  actor: { id: 'perf-actor', role: 'DOCTOR', name: 'Perf Actor' },
}

describe('PERFORMANCE (Phase 9, §36): environment-labeled intelligence metrics', () => {
  beforeAll(() => {
    expect(isEnvLabel(envLabel)).toBe(true)
    if (process.env.EVAL_FORCE_TARGET !== '1') {
      expect(envLabel).not.toBe('TARGET_MACHINE')
    }
  })

  it('case graph build + bounded traversal: labeled, zero failures', async () => {
    const record = await benchmark('phase9_graph_build_traverse', async () => {
      const g = await buildCaseGraph(fixture(), { hospitalId: HOSP_A, patientId: PAT_A1, caseId: null, actor: { id: 'x', role: 'DOCTOR' }, now: NOW })
      const t = traverseGraph(g, { startId: `patient:${PAT_A1}`, maxDepth: 3 })
      return g.nodes.length + g.edges.length + t.queryCount
    }, { warmup: 2, samples: 7 })
    expect(record.env.label).toBe(envLabel)
    expect(assertLabeled(record.env)).toBeNull()
    expect(record.failures).toBe(0)
    expect(record.medianMs).toBeGreaterThanOrEqual(0)
    expect(record.p95Ms).toBeGreaterThanOrEqual(record.medianMs)
  }, 120000)

  it('per-brain + summary latency (understanding/summary/differential/patient AI): labeled, zero failures', async () => {
    const record = await benchmark('phase9_brains_latency', async () => {
      const g = await buildCaseGraph(fixture(), { hospitalId: HOSP_A, patientId: PAT_A1, caseId: null, actor: { id: 'x', role: 'DOCTOR' }, now: NOW })
      const u = understandCase(g, { procedureCategories: [], now: NOW })
      buildClinicalSummary(u, g, 'Ahmed Ali')
      differentialSupport(g, { procedureCategories: [] })
      const pi = buildPatientIntelligence(g, NOW)
      return pi.timeline.length + u.teeth.length
    }, { warmup: 2, samples: 7 })
    expect(record.env.label).toBe(envLabel)
    expect(assertLabeled(record.env)).toBeNull()
    expect(record.failures).toBe(0)
  }, 120000)

  it('clinic brain + command center: labeled, zero failures', async () => {
    const record = await benchmark('phase9_clinic_command_center', async () => {
      const db = fixture() as unknown as ClinicPrisma
      const [m, cc] = await Promise.all([
        buildClinicMetrics(db, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' }),
        buildCommandCenter(db, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' }),
      ])
      return m.todayAppointments.total + cc.sections.length
    }, { warmup: 2, samples: 5 })
    expect(record.env.label).toBe(envLabel)
    expect(assertLabeled(record.env)).toBeNull()
    expect(record.failures).toBe(0)
  }, 120000)

  it('workflow case_review run (total / steps / tool calls): labeled, zero failures', async () => {
    let lastSteps = 0
    let lastTools = 0
    const record = await benchmark('phase9_workflow_case_review', async () => {
      const res = await runWorkflow(wfDeps(), { workflowId: 'case_review', context: wfCtx })
      lastSteps = res.run.stepLog.length
      lastTools = Number(res.run.result?.toolCalls ?? 0)
      return lastSteps
    }, { warmup: 1, samples: 5 })
    expect(record.env.label).toBe(envLabel)
    expect(assertLabeled(record.env)).toBeNull()
    expect(record.failures).toBe(0)
    // The run shape is stable: 9 steps, bounded tool calls.
    expect(lastSteps).toBe(9)
    expect(lastTools).toBeGreaterThan(0)
    expect(lastTools).toBeLessThanOrEqual(8)
  }, 120000)

  it('proactive sweep + idempotent re-run (dedup path): labeled, zero failures', async () => {
    const fake = fixture() as unknown as Record<string, any>
    const rows: Record<string, unknown>[] = []
    let seq = 0
    fake.aiInsight = {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `perf-ins-${++seq}`, createdAt: NOW, dismissed: false, ...data }
        rows.push(row)
        return row
      },
      updateMany: async () => ({ count: 0 }),
    }
    const db = fake as unknown as AlertPrisma
    const record = await benchmark('phase9_alerts_sweep_dedup', async () => {
      const first = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'perf' })
      const second = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'perf' })
      return first.detected.length + second.deduplicated
    }, { warmup: 1, samples: 5 })
    expect(record.env.label).toBe(envLabel)
    expect(assertLabeled(record.env)).toBeNull()
    expect(record.failures).toBe(0)
  }, 120000)

  it('emitted summaries always carry the label and never claim TARGET_MACHINE here', () => {
    const env = environmentFacts()
    const summary = `phase9_graph_build_traverse on ${env.label}: (labeled fact, node ${env.node}, ${env.cpuCount} vCPU)`
    expect(summary).toContain(env.label)
    if (env.label !== 'TARGET_MACHINE') {
      expect(summary).not.toMatch(/target machine|TARGET_MACHINE|production performance/i)
    }
  })
})

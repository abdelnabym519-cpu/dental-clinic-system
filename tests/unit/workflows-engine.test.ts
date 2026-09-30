/**
 * Phase 9 — bounded agentic workflows (unit, §22–§26).
 *
 * Contract:
 *  - definitions are closed + valid (steps ≤ maxSteps, tools ⊆ allowedTools,
 *    approval steps ⊆ step ids, unique step ids, sensible budgets);
 *  - RBAC at trigger time (the client/LLM can never grant roles);
 *  - a VALIDATED state machine: PENDING → RUNNING → (WAITING_APPROVAL →)
 *    terminal; invalid transitions rejected (INT_WORKFLOW_INVALID_TRANSITION);
 *  - hard bounds: maxToolCalls, timeout (INT_WORKFLOW_EXPIRED), retry policy
 *    (bounded, typed);
 *  - SENSITIVE steps NEVER mutate: they route through the injected action
 *    pipeline and park in WAITING_APPROVAL (approvalId recorded);
 *    'create_finding' has no Phase-1 pipeline policy → fails closed
 *    (NO_PIPELINE_ACTION) — never a direct write;
 *  - persistence via the store (step log, attempts, status) — replayable;
 *  - deterministic ordering: same input → same step sequence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createFakePrisma, HOSP_A, PAT_A1, NOW, ACTORS } from '@/tests/harness/context-fixtures'
import { WORKFLOWS, getWorkflow, WORKFLOW_CASE_REVIEW, WORKFLOW_IMAGING_REVIEW, WORKFLOW_FOLLOW_UP, WORKFLOW_DAILY_CLINIC } from '@/lib/ai/workflows/definitions'
import { runWorkflow, cancelWorkflow, type WorkflowDeps } from '@/lib/ai/workflows/engine'
import { createMemoryWorkflowRunStore } from '@/lib/ai/workflows/run-store'
import { isValidTransition, WORKFLOW_STATUSES, type WorkflowDefinition, type WorkflowContext } from '@/lib/ai/workflows/types'
import { IntelligenceError, type CaseGraph } from '@/lib/ai/intelligence/types'
import { buildCaseGraph, type GraphPrisma } from '@/lib/ai/intelligence/case-graph'

const STAFF = [{ id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' }]
const AI_JOBS = [{
  id: 'job-A1', hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED',
  requestedById: 'staff-doctor-1', modelVersion: 'v1.2.0', modelChecksum: 'c0ffee',
  orchestratorVersion: '2.1.0', startedAt: NOW, completedAt: NOW, confidence: 0.87,
  findings: [{ condition: 'caries', tooth_number: 36 }],
  reviewedById: 'staff-doctor-1', reviewedAt: NOW, reviewDecision: 'ACCEPTED',
  acceptedFindings: [{ condition: 'caries', tooth_number: 36 }], createdAt: NOW,
}]

function fakePrisma() {
  return createFakePrisma({ staff: STAFF, aiAnalysisJob: AI_JOBS, aiMemoryItem: [] } as never) as unknown as GraphPrisma
}

function ctx(over: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    hospitalId: HOSP_A,
    patientId: PAT_A1,
    caseId: null,
    actor: { id: ACTORS.doctorA.id, role: ACTORS.doctorA.role, name: 'Hana Shalaby' },
    ...over,
  }
}

let runSeq = 0
function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  runSeq += 1
  return {
    prisma: fakePrisma(),
    now: () => NOW,
    store: createMemoryWorkflowRunStore(),
    nextRunId: (n) => `wfrun-test-${n}`,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Definitions (§22)
// ---------------------------------------------------------------------------

describe('Phase 9 — workflow definitions (§22)', () => {
  const all = [WORKFLOW_CASE_REVIEW, WORKFLOW_IMAGING_REVIEW, WORKFLOW_FOLLOW_UP, WORKFLOW_DAILY_CLINIC]
  it('four canonical workflows, unique ids, resolvable', () => {
    expect(Object.keys(WORKFLOWS)).toHaveLength(4)
    const ids = all.map((d) => d.workflowId)
    expect(new Set(ids).size).toBe(4)
    for (const d of all) expect(getWorkflow(d.workflowId)).toBe(d)
  })

  it.each(all.map((d) => [d.workflowId, d] as const))('definition %s is structurally valid', (_id, d) => {
    // Unique step ids.
    const stepIds = d.steps.map((s) => s.id)
    expect(new Set(stepIds).size).toBe(stepIds.length)
    // Bounded program.
    expect(d.steps.length).toBeLessThanOrEqual(d.maxSteps)
    expect(d.maxSteps).toBeGreaterThan(0)
    expect(d.maxToolCalls).toBeGreaterThan(0)
    expect(d.timeoutMs).toBeGreaterThan(0)
    // No invented tools: every step tool is in the allowed set.
    for (const s of d.steps) {
      if (s.usesTool) expect(d.allowedTools, `step ${s.id} tool ${s.usesTool}`).toContain(s.usesTool)
    }
    // Approval steps must exist in the program.
    for (const a of d.approvalRequiredSteps) expect(stepIds, `approval step ${a}`).toContain(a)
    // Retry policy is bounded.
    expect(d.retry.maxRetries).toBeGreaterThanOrEqual(0)
    // Roles are real roles.
    for (const r of d.allowedRoles) expect(['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT']).toContain(r)
  })

  it('sensitive steps are declared approval-required', () => {
    expect(WORKFLOW_FOLLOW_UP.approvalRequiredSteps).toContain('propose_action')
    expect(WORKFLOW_IMAGING_REVIEW.approvalRequiredSteps).toContain('create_finding')
    expect(WORKFLOW_CASE_REVIEW.approvalRequiredSteps).toHaveLength(0)
    expect(WORKFLOW_DAILY_CLINIC.approvalRequiredSteps).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// State machine (§23)
// ---------------------------------------------------------------------------

describe('Phase 9 — state machine (§23)', () => {
  it('valid/invalid transitions are closed', () => {
    expect(isValidTransition('PENDING', 'RUNNING')).toBe(true)
    expect(isValidTransition('RUNNING', 'WAITING_APPROVAL')).toBe(true)
    expect(isValidTransition('RUNNING', 'COMPLETED')).toBe(true)
    expect(isValidTransition('WAITING_APPROVAL', 'COMPLETED')).toBe(true)
    expect(isValidTransition('COMPLETED', 'RUNNING')).toBe(false)
    expect(isValidTransition('FAILED', 'RUNNING')).toBe(false)
    expect(isValidTransition('CANCELLED', 'COMPLETED')).toBe(false)
    expect(isValidTransition('EXPIRED', 'RUNNING')).toBe(false)
    // Terminal states have no exits.
    for (const t of ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const) {
      for (const s of WORKFLOW_STATUSES) {
        expect(isValidTransition(t, s)).toBe(false)
      }
    }
  })

  it('cancelling a completed run → INT_WORKFLOW_INVALID_TRANSITION', async () => {
    const deps = makeDeps()
    const done = await runWorkflow(deps, { workflowId: 'daily_clinic_review', context: ctx({ patientId: null }) })
    expect(done.run.status).toBe('COMPLETED')
    await expect(cancelWorkflow(deps, done.run.id, HOSP_A)).rejects.toMatchObject({ code: 'INT_WORKFLOW_INVALID_TRANSITION' })
  })

  it('cancelling an active (PENDING-equivalent) run → CANCELLED', async () => {
    const deps = makeDeps()
    const run = await deps.store.create({
      id: 'wfrun-cancel-1', workflowId: 'case_review', version: 1, status: 'PENDING',
      hospitalId: HOSP_A, patientId: PAT_A1, caseId: null, actorId: 's', actorRole: 'DOCTOR',
      currentStep: null, stepLog: [], approvalId: null, context: {}, result: null,
      attempts: 1, startedAt: null, completedAt: null, expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    })
    const cancelled = await cancelWorkflow(deps, run.id, HOSP_A)
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.completedAt).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Runner: RBAC, budgets, parking, fail-closed (§24–§26)
// ---------------------------------------------------------------------------

describe('Phase 9 — engine runner (§24–§26)', () => {
  it('RBAC at trigger: a role outside the definition → INT_WORKFLOW_ROLE_DENIED', async () => {
    // daily_clinic_review allows only SUPER_ADMIN/ADMIN/DOCTOR.
    await expect(
      runWorkflow(makeDeps(), { workflowId: 'daily_clinic_review', context: ctx({ patientId: null, actor: { id: 'r', role: 'RECEPTIONIST' } }) }),
    ).rejects.toMatchObject({ code: 'INT_WORKFLOW_ROLE_DENIED' })
    // imaging_review has no RECEPTIONIST either.
    await expect(
      runWorkflow(makeDeps(), { workflowId: 'imaging_review', context: ctx({ actor: { id: 'r', role: 'RECEPTIONIST' } }) }),
    ).rejects.toMatchObject({ code: 'INT_WORKFLOW_ROLE_DENIED' })
  })

  it('unknown workflowId → INT_WORKFLOW_NOT_FOUND (no invented workflows)', async () => {
    await expect(runWorkflow(makeDeps(), { workflowId: 'hack_workflow', context: ctx() })).rejects.toMatchObject({ code: 'INT_WORKFLOW_NOT_FOUND' })
  })

  it('patient-scoped workflow without patientId → INT_INVALID_PARAMS', async () => {
    await expect(runWorkflow(makeDeps(), { workflowId: 'case_review', context: ctx({ patientId: null }) })).rejects.toMatchObject({ code: 'INT_INVALID_PARAMS' })
  })

  it('case_review → COMPLETED with bounded, verified step log', async () => {
    const deps = makeDeps()
    const res = await runWorkflow(deps, { workflowId: 'case_review', context: ctx() })
    expect(res.run.status).toBe('COMPLETED')
    expect(res.run.workflowId).toBe('case_review')
    expect(res.run.attempts).toBe(1)
    expect(res.run.stepLog.length).toBe(WORKFLOW_CASE_REVIEW.steps.length)
    for (const s of res.run.stepLog) {
      expect(s.ok).toBe(true)
      expect(s.verification, `step ${s.stepId} verification`).not.toBeNull()
      expect(s.verification!.verified).toBe(true)
    }
    expect(res.run.result).toMatchObject({ steps: 9, toolCalls: expect.any(Number) })
    expect(Number(res.run.result!.toolCalls)).toBeLessThanOrEqual(WORKFLOW_CASE_REVIEW.maxToolCalls)
    // Output items keep trust classes.
    const classes = new Set(res.outputItems.map((o) => o.insightClass))
    for (const c of classes) expect(['FACT', 'AI_INTERPRETATION', 'DERIVED_INSIGHT', 'RECOMMENDATION', 'ACTION']).toContain(c)
    // The persistent store has the terminal row.
    const stored = await deps.store.findUnique(res.run.id, HOSP_A)
    expect(stored?.status).toBe('COMPLETED')
    expect(stored?.stepLog.length).toBe(9)
  })

  it('imaging_review → review package built; create_finding FAILS CLOSED (no pipeline policy)', async () => {
    const deps = makeDeps()
    const res = await runWorkflow(deps, { workflowId: 'imaging_review', context: ctx() })
    // The run reaches the sensitive step and stops there, failing closed.
    expect(res.run.status).toBe('FAILED')
    expect(res.run.result).toMatchObject({ failedStep: 'create_finding', error: expect.stringContaining('NO_PIPELINE_ACTION') })
    // The review package (CDS stance) WAS produced before the boundary.
    const pkg = res.outputItems.find((o) => o.titleKey === 'wf.out.reviewPackage')
    expect(pkg).toBeTruthy()
    expect(pkg!.detail).toMatchObject({ differentialStance: 'clinical_decision_support' })
    // No direct mutation ever happened (no ACTION item executed).
    expect(res.outputItems.filter((o) => o.titleKey === 'wf.out.actionExecuted')).toHaveLength(0)
  })

  it('follow_up with an approval pipeline → parks in WAITING_APPROVAL (action NOT executed)', async () => {
    const calls: { action: string; params: Record<string, string> }[] = []
    const deps = makeDeps({
      runAction: async (action, params) => {
        calls.push({ action, params })
        return { status: 'APPROVAL_REQUIRED', success: false, message: 'pending approval', approvalId: 'appr-123' }
      },
    })
    const res = await runWorkflow(deps, { workflowId: 'follow_up', context: ctx({ patientName: 'Ahmed Ali' }) })
    expect(res.run.status).toBe('WAITING_APPROVAL')
    expect(res.run.approvalId).toBe('appr-123')
    expect(res.run.currentStep).toBe('propose_action')
    // Exactly ONE pipeline call (the proposal) — mapped to book_appointment.
    expect(calls).toHaveLength(1)
    expect(calls[0].action).toBe('book_appointment')
    expect(calls[0].params).toMatchObject({ patientId: PAT_A1, patientName: 'Ahmed Ali' })
    // An ACTION item was emitted (pending approval) — never EXECUTED.
    expect(res.outputItems.some((o) => o.titleKey === 'wf.out.actionPendingApproval')).toBe(true)
    expect(res.outputItems.filter((o) => o.titleKey === 'wf.out.actionExecuted')).toHaveLength(0)
    // The terminal row is persisted with the approval hand-off.
    const stored = await deps.store.findUnique(res.run.id, HOSP_A)
    expect(stored?.status).toBe('WAITING_APPROVAL')
    expect(stored?.approvalId).toBe('appr-123')
  })

  it('follow_up with a BLOCKED pipeline → FAILED (blocked upstream, no retry noise)', async () => {
    const deps = makeDeps({
      runAction: async () => ({ status: 'BLOCKED', success: false, message: 'RBAC_DENIED' }),
    })
    const res = await runWorkflow(deps, { workflowId: 'follow_up', context: ctx() })
    expect(res.run.status).toBe('FAILED')
    expect(res.run.result).toMatchObject({ failedStep: 'propose_action' })
    expect(String(res.run.result!.error)).toContain('BLOCKED')
  })

  it('no action pipeline bound → sensitive step fails closed (NO_ACTION_PIPELINE)', async () => {
    const deps = makeDeps() // no runAction
    const res = await runWorkflow(deps, { workflowId: 'follow_up', context: ctx() })
    expect(res.run.status).toBe('FAILED')
    expect(String(res.run.result!.error)).toContain('NO_ACTION_PIPELINE')
  })

  it('bounded retry: one retriable failure then success → attempts=2, COMPLETED', async () => {
    let patientCalls = 0
    const prisma = fakePrisma()
    const origFind = prisma.patient.findUnique.bind(prisma.patient)
    prisma.patient.findUnique = async (args: unknown) => {
      patientCalls += 1
      if (patientCalls === 1) throw new IntelligenceError('RETRIEVAL_TIMEOUT', 'simulated timeout')
      return origFind(args)
    }
    const deps = makeDeps({ prisma })
    const res = await runWorkflow(deps, { workflowId: 'case_review', context: ctx() })
    expect(res.run.status).toBe('COMPLETED')
    expect(res.run.attempts).toBe(2)
    // The retry is visible in the step log (the failed attempt is logged).
    const failedSteps = res.run.stepLog.filter((s) => !s.ok)
    expect(failedSteps).toHaveLength(1)
    expect(String(failedSteps[0].error)).toContain('RETRIEVAL_TIMEOUT')
  })

  it('non-retriable failure → FAILED immediately (no retry)', async () => {
    const prisma = fakePrisma()
    prisma.patient.findUnique = async () => {
      throw new IntelligenceError('INT_SCOPE_MISMATCH', 'cross-tenant patient')
    }
    const deps = makeDeps({ prisma })
    const res = await runWorkflow(deps, { workflowId: 'case_review', context: ctx() })
    expect(res.run.status).toBe('FAILED')
    expect(res.run.attempts).toBe(1)
    expect(res.run.result).toMatchObject({ failedStep: 'resolve_patient' })
    expect(String(res.run.result!.error)).toContain('INT_SCOPE_MISMATCH')
  })

  it('timeout: clock past expiresAt → INT_WORKFLOW_EXPIRED (fail closed)', async () => {
    let tick = 0
    const deps = makeDeps({
      now: () => {
        tick += 1
        // create() uses NOW; the first step-loop check is already past the 30s timeout.
        return tick <= 1 ? NOW : new Date(NOW.getTime() + 60_000)
      },
    })
    await expect(runWorkflow(deps, { workflowId: 'case_review', context: ctx() })).rejects.toMatchObject({ code: 'INT_WORKFLOW_EXPIRED' })
  })

  it('tool budget: a definition whose steps exceed maxToolCalls is rejected', async () => {
    // Extend the registry temporarily with a budget-violating definition to
    // exercise the engine's hard bound (definitions are otherwise frozen).
    const evil: WorkflowDefinition = {
      ...WORKFLOW_CASE_REVIEW,
      workflowId: '__test_budget__',
      allowedTools: ['t'],
      maxToolCalls: 1,
      steps: [
        { id: 's1', kind: 'BUILD_CASE_GRAPH', titleKey: 'wf.step.buildCaseGraph', usesTool: 't' },
        { id: 's2', kind: 'RETRIEVE_KNOWLEDGE', titleKey: 'wf.step.retrieveKnowledge', usesTool: 't' },
      ],
    }
    ;(WORKFLOWS as Record<string, WorkflowDefinition>)['__test_budget__'] = evil
    try {
      const deps = makeDeps()
      const res = await runWorkflow(deps, { workflowId: '__test_budget__', context: ctx() })
      // s1 consumes 1 call (ok); s2 would exceed the budget → bounded failure.
      expect(res.run.status).toBe('FAILED')
      expect(res.run.result).toMatchObject({ failedStep: 's2' })
      expect(String(res.run.result!.error)).toContain('INT_WORKFLOW_LIMIT_EXCEEDED')
      expect(res.run.stepLog).toHaveLength(2)
      expect(res.run.stepLog[1].ok).toBe(false)
    } finally {
      delete (WORKFLOWS as Record<string, WorkflowDefinition>)['__test_budget__']
    }
  })

  it('invented tool reference → INT_WORKFLOW_NOT_RUNNABLE (planner cannot invent tools)', async () => {
    const evil: WorkflowDefinition = {
      ...WORKFLOW_CASE_REVIEW,
      workflowId: '__test_tool__',
      allowedTools: ['t'],
      steps: [{ id: 's1', kind: 'RESOLVE_PATIENT', titleKey: 'wf.step.resolvePatient', usesTool: 'invented_tool' }],
    }
    ;(WORKFLOWS as Record<string, WorkflowDefinition>)['__test_tool__'] = evil
    try {
      await expect(runWorkflow(makeDeps(), { workflowId: '__test_tool__', context: ctx() })).rejects.toMatchObject({ code: 'INT_WORKFLOW_NOT_RUNNABLE' })
    } finally {
      delete (WORKFLOWS as Record<string, WorkflowDefinition>)['__test_tool__']
    }
  })

  it('deterministic replay: same input → identical step sequence + output keys', async () => {
    const a = await runWorkflow(makeDeps(), { workflowId: 'case_review', context: ctx() })
    const b = await runWorkflow(makeDeps(), { workflowId: 'case_review', context: ctx() })
    expect(a.run.stepLog.map((s) => s.stepId)).toEqual(b.run.stepLog.map((s) => s.stepId))
    expect(a.run.status).toEqual(b.run.status)
    expect(a.run.result).toEqual(b.run.result)
    expect(a.outputItems.map((o) => o.titleKey)).toEqual(b.outputItems.map((o) => o.titleKey))
  })

  it('clinic workflow (no patient) runs to COMPLETED without a graph', async () => {
    const res = await runWorkflow(makeDeps(), { workflowId: 'daily_clinic_review', context: ctx({ patientId: null }) })
    expect(res.run.status).toBe('COMPLETED')
    expect(res.run.patientId).toBeNull()
    const clinic = res.outputItems.find((o) => o.titleKey === 'wf.out.clinicState')
    expect(clinic).toBeTruthy()
  })

  it('cross-tenant patient in context → scope revalidation fails the run (never serves foreign data)', async () => {
    // PAT_B1 belongs to tenant B; the context claims hospitalId HOSP_A.
    const res = await runWorkflow(makeDeps(), { workflowId: 'case_review', context: ctx({ patientId: 'pat-B1' }) })
    expect(res.run.status).toBe('FAILED')
    // Deliberately vague (no tenant enumeration): NOT_FOUND, never a foreign graph.
    expect(String(res.run.result!.error)).toContain('INT_PATIENT_NOT_FOUND')
    // No output items were produced from the foreign scope.
    expect(res.outputItems).toHaveLength(0)
  })
})

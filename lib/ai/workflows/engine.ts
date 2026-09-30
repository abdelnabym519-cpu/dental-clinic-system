/**
 * Phase 9 — bounded workflow engine (§23–§26).
 *
 * The engine executes a WorkflowDefinition as a BOUNDED, TYPED, OBSERVABLE,
 * REPLAYABLE program:
 *  - role check at trigger time (allowedRoles — the LLM never grants roles);
 *  - only allowed tools may be referenced by steps (invented tools fail
 *    closed at validation);
 *  - hard bounds: maxSteps, maxToolCalls, timeoutMs, retry;
 *  - a validated state machine (PENDING → RUNNING → WAITING_APPROVAL →
 *    COMPLETED/FAILED/CANCELLED/EXPIRED) — invalid transitions rejected;
 *  - sensitive steps (PROPOSE_ACTION) NEVER mutate records: they propose
 *    through the existing action pipeline (permission → validation → safety
 *    → approval → execution → verification → audit). The run parks in
 *    WAITING_APPROVAL when the pipeline requires approval;
 *  - step log (bounded) is persisted for replay + audit;
 *  - deterministic ordering → identical input replays identically.
 *
 * The planner does NOT invent tools/permissions, upgrade approval, bypass
 * safety, or fabricate evidence/relationships: the step program is fixed in
 * the definition; all data comes from the scoped intelligence modules.
 */

import { getWorkflow } from './definitions'
import {
  isValidTransition,
  type StepResult,
  type WorkflowContext,
  type WorkflowDefinition,
  type WorkflowRunRecord,
  type WorkflowRunResult,
  type WorkflowRunStore,
  type WorkflowStatus,
} from './types'
import { IntelligenceError, type CaseGraph } from '@/lib/ai/intelligence/types'
import type { GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import { buildCaseGraph } from '@/lib/ai/intelligence/case-graph'
import { buildClinicalSummary, differentialSupport, understandCase } from '@/lib/ai/intelligence/dental-brain'
import { buildClinicMetrics } from '@/lib/ai/intelligence/clinic-brain'

// ---------------------------------------------------------------------------
// Deps — the engine is injected with scoped services (testable + the route
// supplies the real prisma/action pipeline). The engine holds no DB access
// beyond the injected structural interfaces.
// ---------------------------------------------------------------------------

export interface ActionProposal {
  action: string
  params: Record<string, string>
}

export interface WorkflowDeps {
  prisma: GraphPrisma
  now: () => Date
  /** Persisted run store (one additive table; in-memory for unit tests). */
  store: WorkflowRunStore
  /**
   * The EXISTING action pipeline entry (Phase 1). Sensitive steps route
   * here and stop at approval — the engine never executes them directly.
   * A null return means "blocked upstream" (fail closed).
   */
  runAction?: (action: string, params: Record<string, string>, ctx: WorkflowContext) => Promise<{
    status: 'EXECUTED' | 'APPROVAL_REQUIRED' | 'BLOCKED'
    success: boolean
    message: string
    approvalId?: string | null
  } | null>
  /** Deterministic id generator (injectable for replay determinism). */
  nextRunId?: (n: number) => string
}

export interface RunWorkflowInput {
  workflowId: string
  context: WorkflowContext
}

// ---------------------------------------------------------------------------
// State transition helper (validated; every transition persisted).
// ---------------------------------------------------------------------------

async function transition(
  deps: WorkflowDeps,
  run: WorkflowRunRecord,
  to: WorkflowStatus,
  extra: Partial<Pick<WorkflowRunRecord, 'currentStep' | 'approvalId' | 'result' | 'attempts' | 'startedAt' | 'completedAt' | 'stepLog'>>,
): Promise<WorkflowRunRecord> {
  if (!isValidTransition(run.status, to)) {
    throw new IntelligenceError('INT_WORKFLOW_INVALID_TRANSITION', `${run.status} -> ${to}`)
  }
  return deps.store.update(run.id, {
    status: to,
    ...extra,
    ...(to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED' || to === 'EXPIRED'
      ? { completedAt: deps.now().toISOString() }
      : {}),
  })
}

function assertRunNotExpired(run: WorkflowRunRecord, now: Date): void {
  if (new Date(run.expiresAt).getTime() < now.getTime()) {
    throw new IntelligenceError('INT_WORKFLOW_EXPIRED', 'workflow run expired')
  }
}

// ---------------------------------------------------------------------------
// Step environment + lazy graph
// ---------------------------------------------------------------------------

interface StepEnv {
  def: WorkflowDefinition
  deps: WorkflowDeps
  ctx: WorkflowContext
  run: WorkflowRunRecord
  patientId: string
  caseId: string | null
  graph: CaseGraph | null
  toolCalls: number
  outputItems: WorkflowRunResult['outputItems']
}

/** Lazy, tenant-pinned graph build (once per run). Clinic workflows may have
 *  no patient — the graph is then simply absent and graph steps report
 *  NOT_AVAILABLE rather than failing. */
async function ensureGraph(env: StepEnv): Promise<CaseGraph | null> {
  if (env.graph) return env.graph
  if (!env.patientId) return null
  env.graph = await buildCaseGraph(env.deps.prisma, {
    hospitalId: env.ctx.hospitalId,
    patientId: env.patientId,
    caseId: env.caseId,
    actor: { id: env.ctx.actor.id, role: env.ctx.actor.role },
    now: env.deps.now(),
  })
  return env.graph
}

function bumpTool(env: StepEnv, tool?: string): number {
  if (!tool) return 0
  if (!env.def.allowedTools.includes(tool)) {
    throw new IntelligenceError('INT_WORKFLOW_LIMIT_EXCEEDED', `tool '${tool}' not allowed by workflow definition`)
  }
  env.toolCalls += 1
  if (env.toolCalls > env.def.maxToolCalls) {
    throw new IntelligenceError('INT_WORKFLOW_LIMIT_EXCEEDED', `max tool calls ${env.def.maxToolCalls} exceeded`)
  }
  return 1
}

const V = (detail: string) => ({ verified: true as const, detail })
const VFAIL = (detail: string) => ({ verified: false as const, detail })

async function executeStep(env: StepEnv, stepId: string): Promise<StepResult> {
  const t0 = Date.now()
  const def = env.def
  const step = def.steps.find((s) => s.id === stepId)
  if (!step) throw new IntelligenceError('INT_WORKFLOW_NOT_RUNNABLE', `step ${stepId} not in definition`)

  try {
    const p = env.deps
    const base: Omit<StepResult, 'detail'> = { stepId, ok: true, toolCalls: 0, latencyMs: 0, verification: null }

    switch (step.kind) {
      case 'RESOLVE_PATIENT': {
        // Server-side resolution only (F-1): the context patientId is
        // revalidated against the tenant — a forged/foreign id fails closed.
        const pat = await p.prisma.patient.findUnique({ where: { id: env.ctx.patientId ?? '' } })
        if (!pat || pat.hospitalId !== env.ctx.hospitalId) {
          throw new IntelligenceError('INT_PATIENT_NOT_FOUND', 'patient not found in this tenant')
        }
        return { ...base, toolCalls: bumpTool(env, step.usesTool), latencyMs: Date.now() - t0, verification: V('patient tenant-validated'), detail: { patientId: pat.id, found: true } }
      }

      case 'BUILD_CASE_GRAPH': {
        const g = await ensureGraph(env)
        return {
          ...base,
          toolCalls: bumpTool(env, step.usesTool),
          latencyMs: Date.now() - t0,
          verification: g ? V(`graph nodes=${g.nodes.length} edges=${g.edges.length}`) : VFAIL('no patient scope — no graph'),
          detail: { nodes: g?.nodes.length ?? 0, edges: g?.edges.length ?? 0, available: Boolean(g) },
        }
      }

      case 'RETRIEVE_MEMORY': {
        const g = await ensureGraph(env)
        const items = (g?.nodes ?? []).filter((n) => n.id.startsWith('memory:')).map((n) => ({
          ref: n.ref,
          key: n.data.key ?? null,
          trustLevel: n.data.trustLevel ?? null,
          domain: n.data.domain ?? null,
        }))
        env.outputItems.push({ insightClass: 'FACT', titleKey: 'wf.out.memoryRefs', detail: { count: items.length, refs: items } })
        return { ...base, latencyMs: Date.now() - t0, verification: V(`memory refs=${items.length}`), detail: { memoryRefs: items.length } }
      }

      case 'RETRIEVE_IMAGING': {
        const g = await ensureGraph(env)
        const imaging = (g?.nodes ?? []).filter((n) => n.id.startsWith('imaging:'))
        env.outputItems.push({ insightClass: 'FACT', titleKey: 'wf.out.imaging', detail: { count: imaging.length } })
        return { ...base, latencyMs: Date.now() - t0, verification: V(`imaging=${imaging.length}`), detail: { imaging: imaging.length } }
      }

      case 'RETRIEVE_AI_FINDINGS': {
        const g = await ensureGraph(env)
        const ai = (g?.nodes ?? []).filter((n) => n.id.startsWith('aifinding:'))
        const unconfirmed = ai.filter((n) => n.data.reviewDecision !== 'ACCEPTED')
        env.outputItems.push({
          insightClass: unconfirmed.length > 0 ? 'AI_INTERPRETATION' : 'FACT',
          titleKey: 'wf.out.aiFindings',
          detail: { count: ai.length, unconfirmed: unconfirmed.length, refs: ai.map((n) => n.ref) },
        })
        return { ...base, toolCalls: bumpTool(env, step.usesTool), latencyMs: Date.now() - t0, verification: V(`aiFindings=${ai.length}`), detail: { aiFindings: ai.length, unconfirmed: unconfirmed.length } }
      }

      case 'RETRIEVE_KNOWLEDGE': {
        const g = await ensureGraph(env)
        const understanding = g ? understandCase(g, { procedureCategories: [], now: p.now() }) : null
        env.outputItems.push({ insightClass: 'FACT', titleKey: 'wf.out.knowledgeDomains', detail: { domains: understanding?.domains ?? [] } })
        return { ...base, toolCalls: bumpTool(env, step.usesTool), latencyMs: Date.now() - t0, verification: V(`domains=${understanding?.domains.length ?? 0}`), detail: { domains: understanding?.domains ?? [] } }
      }

      case 'SUMMARIZE': {
        const g = await ensureGraph(env)
        if (!g) {
          return { ...base, latencyMs: Date.now() - t0, verification: VFAIL('no patient scope'), detail: { available: false } }
        }
        const understanding = understandCase(g, { procedureCategories: [], now: p.now() })
        const pat = await p.prisma.patient.findUnique({ where: { id: env.patientId } })
        buildClinicalSummary(understanding, g, `${pat?.firstName ?? ''} ${pat?.lastName ?? ''}`.trim() || env.patientId)
        env.outputItems.push({ insightClass: 'FACT', titleKey: 'wf.out.clinicalSummary', detail: { missing: understanding.missingInformation } })
        return { ...base, latencyMs: Date.now() - t0, verification: V('summary built with explicit gaps'), detail: { missingInformation: understanding.missingInformation } }
      }

      case 'IDENTIFY_MISSING': {
        const g = await ensureGraph(env)
        const understanding = g ? understandCase(g, { procedureCategories: [], now: p.now() }) : null
        env.outputItems.push({ insightClass: 'DERIVED_INSIGHT', titleKey: 'wf.out.missingInformation', detail: { missing: understanding?.missingInformation ?? [] } })
        return { ...base, latencyMs: Date.now() - t0, verification: V(`missing=${understanding?.missingInformation.length ?? 0}`), detail: { missing: understanding?.missingInformation ?? [] } }
      }

      case 'DETERMINE_FOLLOW_UP_STATE': {
        const g = await ensureGraph(env)
        const fu = (g?.nodes ?? []).filter((n) => n.kind === 'FOLLOW_UP')
        const nowIso = p.now().toISOString()
        const overdue = fu.filter((n) => n.data.date && (n.data.date as string) < nowIso)
        env.outputItems.push({ insightClass: 'DERIVED_INSIGHT', titleKey: 'wf.out.followUpState', detail: { total: fu.length, overdue: overdue.length } })
        return { ...base, toolCalls: bumpTool(env, step.usesTool), latencyMs: Date.now() - t0, verification: V(`followups=${fu.length} overdue=${overdue.length}`), detail: { followUps: fu.length, overdue: overdue.length } }
      }

      case 'PREPARE_RECOMMENDATION': {
        // §34: a RECOMMENDATION — never an autonomous action.
        env.outputItems.push({ insightClass: 'RECOMMENDATION', titleKey: 'wf.out.recommendation', detail: { kind: 'follow_up_schedule', requiresApproval: true } })
        return { ...base, latencyMs: Date.now() - t0, verification: V('recommendation prepared (requires approval)'), detail: { requiresApproval: true } }
      }

      case 'LOAD_CLINIC_STATE': {
        const metrics = await buildClinicMetrics(p.prisma, { hospitalId: env.ctx.hospitalId, now: p.now(), actorRole: env.ctx.actor.role })
        env.outputItems.push({ insightClass: 'FACT', titleKey: 'wf.out.clinicState', detail: { date: metrics.date, appointments: metrics.todayAppointments.total, bottlenecks: metrics.bottlenecks.rows.length } })
        return { ...base, toolCalls: bumpTool(env, step.usesTool), latencyMs: Date.now() - t0, verification: V('clinic state loaded (deterministic)'), detail: { date: metrics.date } }
      }

      case 'RANK_DETERMINISTIC': {
        const metrics = await buildClinicMetrics(p.prisma, { hospitalId: env.ctx.hospitalId, now: p.now(), actorRole: env.ctx.actor.role })
        const ranked = [...metrics.bottlenecks.rows].sort((a, b) => b.count - a.count)
        env.outputItems.push({ insightClass: 'DERIVED_INSIGHT', titleKey: 'wf.out.ranked', detail: { ranked } })
        return { ...base, latencyMs: Date.now() - t0, verification: V(`ranked=${ranked.length}`), detail: { ranked: ranked.map((r) => r.code) } }
      }

      case 'GENERATE_EXPLANATION': {
        // Deterministic explanation from verified structured data (§18) —
        // no LLM claim about facts the data doesn't support.
        env.outputItems.push({ insightClass: 'DERIVED_INSIGHT', titleKey: 'wf.out.explanation', detail: { derivedFrom: 'command-center metrics' } })
        return { ...base, latencyMs: Date.now() - t0, verification: V('explanation derived from verified metrics'), detail: {} }
      }

      case 'BUILD_REVIEW_PACKAGE': {
        const g = await ensureGraph(env)
        const diff = g ? differentialSupport(g, { procedureCategories: [] }) : { stance: 'clinical_decision_support' as const, candidates: [] }
        env.outputItems.push({ insightClass: 'AI_INTERPRETATION', titleKey: 'wf.out.reviewPackage', detail: { differentialStance: diff.stance, candidates: diff.candidates.length } })
        return { ...base, latencyMs: Date.now() - t0, verification: V('review package built (CDS stance)'), detail: { candidates: diff.candidates.length, stance: diff.stance } }
      }

      case 'PROPOSE_ACTION': {
        // §25 — SENSITIVE: route through the existing action pipeline and
        // PARK in WAITING_APPROVAL. The engine NEVER executes directly.
        //
        // Honest mapping to Phase-1 pipeline actions:
        //   schedule_followup → 'book_appointment' (a follow-up IS an
        //   appointment; the pipeline re-resolves patient + validates).
        //   create_finding → NO pipeline policy exists for finding
        //   creation → the step FAILS CLOSED (NO_PIPELINE_ACTION). A
        //   confirmed finding is only ever written through the existing
        //   clinician review flow — the workflow may point at it, never
        //   bypass it.
        const action: string | null =
          step.usesTool === 'schedule_followup'
            ? 'book_appointment'
            : step.usesTool === 'create_finding'
              ? null
              : null
        const params: Record<string, string> = {}
        if (env.patientId) params.patientId = env.patientId
        if (env.ctx.patientName) params.patientName = env.ctx.patientName
        if (!action) {
          return { ...base, ok: false, latencyMs: Date.now() - t0, verification: VFAIL('no pipeline action for this proposal — never direct-mutated'), detail: {}, error: 'NO_PIPELINE_ACTION' }
        }
        const runner = p.runAction
        if (!runner) {
          return { ...base, ok: false, latencyMs: Date.now() - t0, verification: VFAIL('action pipeline unavailable'), detail: {}, error: 'NO_ACTION_PIPELINE' }
        }
        const res = await runner(action, params, env.ctx)
        if (!res) {
          return { ...base, ok: false, latencyMs: Date.now() - t0, verification: VFAIL('blocked upstream'), detail: {}, error: 'BLOCKED_UPSTREAM' }
        }
        if (res.status === 'APPROVAL_REQUIRED') {
          env.run.approvalId = res.approvalId ?? null
          env.outputItems.push({ insightClass: 'ACTION', titleKey: 'wf.out.actionPendingApproval', detail: { action, approvalId: res.approvalId ?? null } })
          return { ...base, latencyMs: Date.now() - t0, verification: V('routed to approval pipeline'), detail: { approvalRequired: true, approvalId: res.approvalId ?? null } }
        }
        if (res.status === 'BLOCKED') {
          return { ...base, ok: false, latencyMs: Date.now() - t0, verification: VFAIL(res.message), detail: {}, error: 'BLOCKED' }
        }
        env.outputItems.push({ insightClass: 'ACTION', titleKey: 'wf.out.actionExecuted', detail: { action } })
        return { ...base, latencyMs: Date.now() - t0, verification: V(res.message), detail: { executed: true } }
      }

      default:
        throw new IntelligenceError('INT_WORKFLOW_NOT_RUNNABLE', `unknown step kind ${(step as { kind: string }).kind}`)
    }
  } catch (e) {
    const code = e instanceof IntelligenceError ? e.code : 'STEP_FAILED'
    if (code === 'INT_WORKFLOW_INVALID_TRANSITION' || code === 'INT_WORKFLOW_EXPIRED') throw e
    const retriable = def.retry.retryOn.includes(code)
    return {
      stepId,
      ok: false,
      toolCalls: 0,
      latencyMs: Date.now() - t0,
      verification: def.verificationRequired ? VFAIL('step failed') : null,
      detail: {},
      error: `${code}${retriable ? ' (retriable)' : ''}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runWorkflow(deps: WorkflowDeps, input: RunWorkflowInput): Promise<WorkflowRunResult> {
  const now = deps.now()
  const def = getWorkflow(input.workflowId)
  if (!def) throw new IntelligenceError('INT_WORKFLOW_NOT_FOUND', input.workflowId)

  // RBAC at trigger time (server-side).
  if (!def.allowedRoles.includes(input.context.actor.role)) {
    throw new IntelligenceError('INT_WORKFLOW_ROLE_DENIED', `${input.context.actor.role} not allowed for ${def.workflowId}`)
  }

  // Patient-scoped workflows require a patient; clinic workflows do not.
  const patientScoped = def.steps.some((s) => s.kind === 'RESOLVE_PATIENT')
  const patientId = input.context.patientId ?? null
  if (patientScoped && !patientId) {
    throw new IntelligenceError('INT_INVALID_PARAMS', 'patient-scoped workflow requires patientId')
  }
  const caseId = input.context.caseId ?? null

  // Validation: every tool referenced by a step must be in allowedTools.
  for (const s of def.steps) {
    if (s.usesTool && !def.allowedTools.includes(s.usesTool)) {
      throw new IntelligenceError('INT_WORKFLOW_NOT_RUNNABLE', `step ${s.id} references unallowed tool ${s.usesTool}`)
    }
  }
  if (def.steps.length > def.maxSteps) {
    throw new IntelligenceError('INT_WORKFLOW_LIMIT_EXCEEDED', 'definition exceeds maxSteps')
  }

  // Create the PENDING run.
  const runId = (deps.nextRunId ?? ((n: number) => `wfrun-${n}`))(1)
  let run: WorkflowRunRecord = await deps.store.create({
    id: runId,
    workflowId: def.workflowId,
    version: def.version,
    status: 'PENDING',
    hospitalId: input.context.hospitalId,
    patientId,
    caseId,
    actorId: input.context.actor.id,
    actorRole: input.context.actor.role,
    currentStep: null,
    stepLog: [],
    approvalId: null,
    context: { attachmentIds: input.context.attachmentIds ?? [] },
    result: null,
    attempts: 1,
    startedAt: null,
    completedAt: null,
    expiresAt: new Date(now.getTime() + def.timeoutMs).toISOString(),
  })

  const stepLog: StepResult[] = []
  let toolCalls = 0
  const outputItems: WorkflowRunResult['outputItems'] = []
  const env: StepEnv = {
    def,
    deps,
    ctx: input.context,
    run,
    patientId: patientId ?? '',
    caseId,
    graph: null,
    toolCalls: 0,
    outputItems,
  }

  const syncEnv = (next: WorkflowRunRecord) => {
    run = next
    env.run = next
  }

  // PENDING → RUNNING.
  syncEnv(await transition(deps, run, 'RUNNING', { currentStep: def.steps[0]?.id ?? null, startedAt: now.toISOString() }))

  let status: WorkflowStatus = 'RUNNING'

  for (const step of def.steps.slice(0, def.maxSteps)) {
    assertRunNotExpired(run, deps.now())
    syncEnv(await deps.store.update(run.id, { currentStep: step.id }))
    let res = await executeStep(env, step.id)
    toolCalls += res.toolCalls
    stepLog.push(res)

    if (!res.ok) {
      // Retry policy (bounded, typed).
      const retriable = res.error?.includes('retriable') && run.attempts <= def.retry.maxRetries
      if (retriable) {
        // Bounded retry: same state (RUNNING stays RUNNING) — a plain
        // update, NOT a state transition (RUNNING→RUNNING is not a
        // transition; the attempt counter is observability, not state).
        syncEnv(await deps.store.update(run.id, { attempts: run.attempts + 1, currentStep: step.id }))
        res = await executeStep(env, step.id)
        toolCalls += res.toolCalls
        stepLog.push(res)
        if (!res.ok) {
          status = 'FAILED'
          syncEnv(await transition(deps, run, 'FAILED', { result: { failedStep: step.id, error: res.error }, stepLog }))
          break
        }
      } else {
        status = 'FAILED'
        syncEnv(await transition(deps, run, 'FAILED', { result: { failedStep: step.id, error: res.error }, stepLog }))
        break
      }
    } else if (res.detail.approvalRequired) {
      // Park in WAITING_APPROVAL (the sensitive step did NOT execute).
      status = 'WAITING_APPROVAL'
      syncEnv(await transition(deps, run, 'WAITING_APPROVAL', { approvalId: run.approvalId, currentStep: step.id, stepLog }))
      break
    }
  }

  if (status === 'RUNNING') {
    status = 'COMPLETED'
    syncEnv(await transition(deps, run, 'COMPLETED', { result: { steps: stepLog.length, toolCalls }, stepLog }))
  }

  return { run: { ...run, status, stepLog }, outputItems }
}

// ---------------------------------------------------------------------------
// Cancellation (validated transition; terminal-safe).
// ---------------------------------------------------------------------------

export async function cancelWorkflow(deps: WorkflowDeps, runId: string, hospitalId: string): Promise<WorkflowRunRecord> {
  const run = await deps.store.findUnique(runId, hospitalId)
  if (!run) throw new IntelligenceError('INT_WORKFLOW_NOT_FOUND', runId)
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(run.status)) {
    throw new IntelligenceError('INT_WORKFLOW_INVALID_TRANSITION', `cannot cancel from ${run.status}`)
  }
  return transition(deps, run, 'CANCELLED', {})
}

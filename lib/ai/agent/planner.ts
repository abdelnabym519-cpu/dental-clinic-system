/**
 * Phase 3 — Bounded planner (§13/§14).
 *
 * Plans are TEMPLATES per task type (not model-freeform): deterministic,
 * capped at `maxPlanSteps`, de-duplicated (same tool+input once), and
 * cycle-checked. A plan is never started when patient resolution failed.
 * The EXECUTE stage can stop early on any hard limit — the plan defines an
 * upper bound, not a commitment.
 */

import type { AgentLimits, AgentPlan, AgentPlanStep, AgentTask } from './types'
import { TOOL_REGISTRY, toolNamesByProfile } from './tools'

export interface PlanContext {
  task: AgentTask
  hasPatient: boolean
  /** Context already retrieved in the RETRIEVE stage — never re-fetch. */
  hasContext: boolean
  actionIntent: string | null
  actionTool: string | null
  actionParams: Record<string, string>
  actionParamsComplete: boolean
  operationalTopic: 'appointments' | 'queue' | 'schedule' | 'followups' | null
  /** Extra validated inputs for the operational tool (e.g. today's date). */
  operationalInput: Record<string, unknown>
  limit: AgentLimits
}

function step(index: number, tool: string, input: Record<string, unknown>, intent: string): AgentPlanStep {
  return { index, tool, input, intent, status: 'PENDING' }
}

export function buildPlan(ctx: PlanContext): { plan: AgentPlan | null; reason: string | null } {
  const { task, limit } = ctx
  const steps: AgentPlanStep[] = []
  const seen = new Set<string>()
  const add = (tool: string, input: Record<string, unknown>, intent: string) => {
    const def = TOOL_REGISTRY[tool]
    if (!def) return // never schedule unknown tools
    const key = `${tool}:${JSON.stringify(input)}`
    if (seen.has(key)) return // §13 — duplicate tool call
    if (steps.length >= limit.maxPlanSteps) return // §14 — plan cap
    seen.add(key)
    steps.push(step(steps.length, tool, input, intent))
  }

  const profileTool = task.contextProfile ? toolNamesByProfile(task.contextProfile) : null

  switch (task.taskType) {
    case 'OUT_OF_DOMAIN':
    case 'UNKNOWN':
      return { plan: null, reason: task.taskType }

    case 'INFORMATIONAL':
    case 'CLINICAL_ANALYSIS':
    case 'IMAGING_ANALYSIS': {
      if (!ctx.hasPatient) return { plan: null, reason: 'patient_required' }
      if (profileTool && !ctx.hasContext) add(profileTool, {}, 'retrieve context')
      return { plan: steps.length ? finalize(steps, task) : null, reason: steps.length ? null : 'context_already_retrieved' }
    }

    case 'OPERATIONAL': {
      const map: Record<string, [string, string]> = {
        appointments: ['get_appointments', 'list appointments'],
        queue: ['get_waiting_queue', 'list waiting queue'],
        schedule: ['get_doctor_schedule', 'list schedule'],
        followups: ['get_followup_due', 'list due follow-ups'],
      }
      const t = ctx.operationalTopic ?? 'appointments'
      add(map[t][0], { ...(ctx.operationalInput ?? {}) }, map[t][1])
      return { plan: steps.length ? finalize(steps, task) : null, reason: steps.length ? null : 'no_operational_tool' }
    }

    case 'ACTION_REQUEST':
    case 'MULTI_STEP': {
      // Context for grounding the proposal / multi-step analysis (skipped
      // when the RETRIEVE stage already built it — no duplicate calls).
      if (ctx.hasPatient && !ctx.hasContext) {
        const tool = task.taskType === 'MULTI_STEP' && task.contextProfile === 'FULL_360' ? 'get_patient_360' : profileTool
        if (tool) add(tool, {}, 'retrieve context')
      }
      // The action step is only SCHEDULED when parameters are complete —
      // otherwise the SAFETY stage proposes it (DRAFT) without execution.
      if (ctx.actionTool && ctx.actionParamsComplete) {
        add(ctx.actionTool, ctx.actionParams, `execute ${ctx.actionTool}`)
      }
      if (!steps.length) return { plan: null, reason: ctx.actionTool && !ctx.actionParamsComplete ? 'params_incomplete_draft' : 'no_steps' }
      return { plan: finalize(steps, task), reason: ctx.actionTool && !ctx.actionParamsComplete ? 'params_incomplete_draft' : null }
    }
  }
}

/** §13 — cycle detection over step references. Exported for tests. */
export function finalizePlan(steps: AgentPlanStep[], task: AgentTask): AgentPlan {
  // Templates are linear (no cross-step references), so a cycle is provably
  // impossible; the detector guards template evolution.
  const state = new Map<number, 'VISITING' | 'DONE'>(steps.map((s) => [s.index, 'VISITING']))
  const visit = (i: number): boolean => {
    if (state.get(i) === 'DONE') return false
    if (state.get(i) !== 'VISITING') return true
    const s = steps[i]
    for (const dep of s.dependsOn ?? []) {
      if (dep >= s.index) { state.set(i, 'DONE'); return true } // self / forward = cycle
      if (state.get(dep) === 'VISITING') { state.set(i, 'DONE'); return true }
    }
    state.set(i, 'DONE')
    return false
  }
  let cycle = false
  for (const s of steps) if (visit(s.index)) cycle = true
  if (cycle) throw new Error('PLAN_CYCLE_DETECTED')
  return { steps, maxSteps: steps.length }
}

function finalize(steps: AgentPlanStep[], task: AgentTask): AgentPlan {
  return finalizePlan(steps, task)
}



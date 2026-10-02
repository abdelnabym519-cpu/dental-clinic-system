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
  operationalTopic?: 'appointments' | 'queue' | 'schedule' | 'followups' | 'billing' | null
  /** Extra validated inputs for the operational tool (e.g. today's date). */
  operationalInput: Record<string, unknown>
  /** Phase 4 — the user's original message (for the knowledge query). */
  message: string
  /** Phase 6 — resolved attachment metadata (server facts, tenant-scoped). */
  attachmentRefs?: { id: string; fileClass: string; dentalModality: string | null; patientId: string | null }[] | null
  /** Phase 6 — deterministic tooth focus (FDI) when exactly one was named. */
  toothFdi?: number | null
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
  const knowledge = task.knowledge?.needed ? task.knowledge : null

  /** Phase 4 — the bounded knowledge tool (server-resolved scope). */
  const addKnowledge = () => {
    if (!knowledge) return
    add('retrieve_dental_knowledge', {
      question: ctx.message,
      ...(knowledge.domain ? { domain: knowledge.domain } : {}),
      maxResults: 5,
    }, 'retrieve dental knowledge')
  }

  switch (task.taskType) {
    case 'OUT_OF_DOMAIN':
    case 'UNKNOWN':
      return { plan: null, reason: task.taskType }

    case 'INFORMATIONAL':
    case 'CLINICAL_ANALYSIS':
    case 'IMAGING_ANALYSIS':
    case 'KNOWLEDGE': {
      // Phase 5 — local AI capability question: answered from the trusted
      // capability matrix (read-only tool). No patient context, no imaging
      // access, no engine invocation — the agent never selects an engine
      // from text here; it only reports what is registered and evidenced.
      if (task.localAiCapability) {
        add('local_ai_capabilities', {}, 'list local AI capabilities')
        return { plan: steps.length ? finalize(steps, task) : null, reason: steps.length ? null : 'local_ai_capability_plan_failed' }
      }
      // Phase 4 — pure knowledge question (no patient involved): knowledge
      // only; no patient context is fetched and none is fabricated.
      if (knowledge && !ctx.hasPatient) {
        addKnowledge()
        return { plan: steps.length ? finalize(steps, task) : null, reason: steps.length ? null : 'knowledge_plan_failed' }
      }
      if (!ctx.hasPatient) return { plan: null, reason: 'patient_required' }
      if (profileTool && !ctx.hasContext) add(profileTool, {}, 'retrieve context')
      // Phase 4 — hybrid: patient facts AND dental knowledge (kept separate).
      addKnowledge()
      return { plan: steps.length ? finalize(steps, task) : null, reason: steps.length ? null : 'context_already_retrieved' }
    }

    case 'ATTACHMENT_ANALYSIS': {
      // Phase 6 — attachment plan: template-only, ids are the server-
      // resolved attachment ids (never client text), engine selection is
      // the tool's job via the Phase 5 registry (§17/§32).
      const atts = ctx.attachmentRefs ?? []
      if (!atts.length) return { plan: null, reason: 'no_attachments' }
      // §11/§18 — an unclassified 2D image (dentalModality null) is NOT
      // scheduled for analysis: no engine can be selected without a modality,
      // and guessing is forbidden. MESH_3D always resolves to THREE_D_SCAN.
      const analyzable = atts.filter(
        (a) => a.fileClass === 'MESH_3D' || (a.fileClass === 'IMAGE_2D' && a.dentalModality != null),
      )
      const documents = atts.filter(
        (a) => a.fileClass === 'DOCUMENT_PDF' || a.fileClass === 'DOCUMENT_TEXT',
      )
      const compare = task.attachmentTask?.compare === true && analyzable.length >= 2
      if (compare) {
        // §15 — one paired comparison; extras are analyzed individually.
        add(
          'compare_attachments',
          { attachmentIdA: analyzable[0].id, attachmentIdB: analyzable[1].id },
          'safe before/after comparison (observed + model differences)',
        )
        for (const a of analyzable.slice(2)) {
          add('analyze_attachment', { attachmentId: a.id }, 'analyze extra attachment individually')
        }
      } else {
        for (const a of analyzable) {
          add(
            'analyze_attachment',
            typeof ctx.toothFdi === 'number' ? { attachmentId: a.id, toothFdi: ctx.toothFdi } : { attachmentId: a.id },
            'run verified local AI analysis on the attachment',
          )
        }
      }
      for (const d of documents) {
        add('read_document_attachment', { attachmentId: d.id }, 'read document attachment as untrusted data')
      }
      if (!steps.length) {
        // DICOM volumes / unknown files only: no engine step — the answer
        // states the honest ingestion-only state from the attachment block.
        return { plan: null, reason: 'no_analyzable_attachments' }
      }
      return { plan: finalize(steps, task), reason: null }
    }

    case 'OPERATIONAL': {
      const map: Record<string, [string, string]> = {
        appointments: ['get_appointments', 'list appointments'],
        queue: ['get_waiting_queue', 'list waiting queue'],
        schedule: ['get_doctor_schedule', 'list schedule'],
        followups: ['get_followup_due', 'list due follow-ups'],
      }
      const t = ctx.operationalTopic ?? 'appointments'
      if (t === 'billing') {
        // No clinic-level invoice-read tool exists in the registry — plan
        // nothing rather than misroute (the loop answers the honest
        // capability boundary).
        return { plan: null, reason: 'no_billing_read_tool' }
      }
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
      // Phase 4 — hybrid knowledge alongside an action (e.g. "book a
      // follow-up and explain the periodontitis guidelines").
      addKnowledge()
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



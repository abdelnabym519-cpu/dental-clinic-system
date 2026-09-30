/**
 * Phase 9 — Bounded agentic workflows (§22–§26).
 *
 * NOT an unrestricted autonomous planner: every workflow is an explicit,
 * versioned, typed definition with hard bounds (roles, tools, steps, tool
 * calls, timeout, retry), a validated state machine, and audit metadata.
 * Sensitive steps do NOT mutate records directly — they route through the
 * EXISTING action pipeline (permission → validation → safety → approval →
 * execution → verification → audit, Phase 1). The engine can never bypass
 * Phase 1, upgrade approval, invent tools, or fabricate relationships.
 */

import type { InsightClass } from '@/lib/ai/intelligence/types'

export const WORKFLOW_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

/** Validated transitions — any other move is INT_WORKFLOW_INVALID_TRANSITION. */
export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  PENDING: ['RUNNING', 'CANCELLED', 'EXPIRED'],
  RUNNING: ['WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  WAITING_APPROVAL: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
}

export function isValidTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return (WORKFLOW_TRANSITIONS[from] ?? []).includes(to)
}

export interface RetryPolicy {
  maxRetries: number
  retryOn: string[]
}

export interface WorkflowDefinition {
  workflowId: string
  version: number
  nameKey: string
  /** Which agent roles may trigger this workflow (RBAC at trigger time). */
  allowedRoles: string[]
  /** Only these tool names may be used by steps (no invented tools). */
  allowedTools: string[]
  maxSteps: number
  maxToolCalls: number
  timeoutMs: number
  retry: RetryPolicy
  /** Steps that touch sensitive records require the approval pipeline. */
  approvalRequiredSteps: string[]
  failureBehavior: 'STOP' | 'COMPENSATE'
  /** Every completed step must report verification evidence. */
  verificationRequired: boolean
  audit: { action: string }
  /** Bounded step program (deterministic order — replayable). */
  steps: WorkflowStep[]
}

export interface WorkflowStep {
  id: string
  kind:
    | 'RESOLVE_PATIENT'
    | 'BUILD_CASE_GRAPH'
    | 'RETRIEVE_MEMORY'
    | 'RETRIEVE_KNOWLEDGE'
    | 'RETRIEVE_IMAGING'
    | 'RETRIEVE_AI_FINDINGS'
    | 'SUMMARIZE'
    | 'IDENTIFY_MISSING'
    | 'BUILD_REVIEW_PACKAGE'
    | 'DETERMINE_FOLLOW_UP_STATE'
    | 'PREPARE_RECOMMENDATION'
    | 'PROPOSE_ACTION'
    | 'LOAD_CLINIC_STATE'
    | 'RANK_DETERMINISTIC'
    | 'GENERATE_EXPLANATION'
  titleKey: string
  usesTool?: string
}

export interface StepResult {
  stepId: string
  ok: boolean
  /** Tool call count consumed by this step (bounded against maxToolCalls). */
  toolCalls: number
  latencyMs: number
  verification: { verified: boolean; detail: string } | null
  detail: Record<string, unknown>
  error?: string
}

export interface WorkflowContext {
  hospitalId: string
  patientId?: string | null
  caseId?: string | null
  attachmentIds?: string[]
  /**
   * Server-resolved display name (route fills it from the tenant-validated
   * patient row). Used only as a pipeline proposal parameter — the action
   * pipeline re-resolves the patient tenant-side and never trusts this.
   */
  patientName?: string | null
  actor: { id: string; role: string; name?: string }
}

export interface WorkflowRunRecord {
  id: string
  workflowId: string
  version: number
  status: WorkflowStatus
  hospitalId: string
  patientId: string | null
  caseId: string | null
  actorId: string
  actorRole: string
  currentStep: string | null
  /** Bounded step log (replay + audit; never raw PHI dumps). */
  stepLog: StepResult[]
  approvalId: string | null
  context: Record<string, unknown>
  result: Record<string, unknown> | null
  attempts: number
  startedAt: string | null
  completedAt: string | null
  expiresAt: string
  createdAt: string
}

export interface WorkflowRunResult {
  run: WorkflowRunRecord
  /** §20 — the run's output items keep their trust classes intact. */
  outputItems: { insightClass: InsightClass; titleKey: string; detail: Record<string, unknown> }[]
}

// ---------------------------------------------------------------------------
// Workflow run persistence (structural interface — one additive table).
// ---------------------------------------------------------------------------

export interface WorkflowRunStore {
  create: (rec: Omit<WorkflowRunRecord, 'createdAt'> & { createdAt?: string }) => Promise<WorkflowRunRecord>
  findUnique: (id: string, hospitalId: string) => Promise<WorkflowRunRecord | null>
  update: (id: string, data: Partial<Pick<WorkflowRunRecord, 'status' | 'currentStep' | 'stepLog' | 'approvalId' | 'result' | 'attempts' | 'startedAt' | 'completedAt'>>) => Promise<WorkflowRunRecord>
}

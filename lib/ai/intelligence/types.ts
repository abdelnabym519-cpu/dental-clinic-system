/**
 * Phase 9 — Intelligence layer shared types.
 *
 * ONE canonical intelligence vocabulary for the Dental Brain, Patient AI,
 * Clinic Brain, the Case/Patient Graph, proactive intelligence and workflows.
 * These are capability modules of the single DenToRa Agent — not separate
 * agents/brains. The Agent loop, Memory, RAG, Local AI, Safety, Approval,
 * Verification and Audit from Phases 1–8 are reused, never duplicated.
 *
 * Honesty contract (§35/§42/§48):
 *  - Every intelligence item carries an `insightClass` (FACT | DERIVED_INSIGHT
 *    | AI_INTERPRETATION | RECOMMENDATION | ACTION) — never mixed.
 *  - Every graph node/edge carries `trust` + `provenance`.
 *  - Missing data is explicit (`NOT_AVAILABLE` / `NOT_MEASURED`) — never
 *    fabricated, never silently dropped.
 *  - AI output is Clinical Decision Support, never a diagnosis.
 */

// ---------------------------------------------------------------------------
// §7 — Graph trust model (nodes are NOT equally authoritative)
// ---------------------------------------------------------------------------

export const GRAPH_TRUSTS = [
  'RECORD_FACT',
  'USER_PROVIDED',
  'DOCTOR_CONFIRMED',
  'AI_DERIVED',
  'KNOWLEDGE_EVIDENCE',
  'SYSTEM_INFERRED',
  'UNKNOWN',
] as const
export type GraphTrust = (typeof GRAPH_TRUSTS)[number]

// ---------------------------------------------------------------------------
// §20 — Insight trust classes (never mixed)
// ---------------------------------------------------------------------------

export const INSIGHT_CLASSES = [
  'FACT',
  'DERIVED_INSIGHT',
  'AI_INTERPRETATION',
  'RECOMMENDATION',
  'ACTION',
] as const
export type InsightClass = (typeof INSIGHT_CLASSES)[number]

// ---------------------------------------------------------------------------
// Graph node / edge kinds (explicit relationships — §5/§6/§48)
// ---------------------------------------------------------------------------

export const GRAPH_NODE_KINDS = [
  'CLINIC',
  'DOCTOR',
  'PATIENT',
  'CASE',
  'TOOTH',
  'FINDING',
  'SYMPTOM',
  'IMAGING',
  'AI_FINDING',
  'DIAGNOSIS_SUPPORT',
  'TREATMENT',
  'FOLLOW_UP',
  'OUTCOME',
  'APPOINTMENT',
  'CONVERSATION',
  'MEMORY',
] as const
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number]

export const GRAPH_EDGE_KINDS = [
  'CLINIC_HAS_DOCTOR',
  'DOCTOR_SEES_PATIENT',
  'PATIENT_HAS_CASE',
  'CASE_HAS_TOOTH',
  'TOOTH_HAS_FINDING',
  'PATIENT_HAS_SYMPTOM',
  'CASE_HAS_SYMPTOM',
  'CASE_HAS_DOCTOR_LINK',
  'PATIENT_HAS_IMAGING',
  'CASE_HAS_IMAGING',
  'PATIENT_HAS_FINDING_LINK',
  'IMAGING_HAS_AI_FINDING',
  'CASE_HAS_AI_FINDING',
  'AI_FINDING_CONFIRMED_BY',
  'CASE_HAS_DIAGNOSIS_SUPPORT',
  'PATIENT_HAS_TREATMENT',
  'CASE_HAS_TREATMENT',
  'TREATMENT_HAS_OUTCOME',
  'CASE_HAS_FOLLOW_UP',
  'TREATMENT_HAS_FOLLOW_UP',
  'PATIENT_HAS_APPOINTMENT',
  'CASE_HAS_APPOINTMENT',
  'PATIENT_HAS_CONVERSATION',
  'PATIENT_HAS_MEMORY',
  'CASE_HAS_MEMORY',
] as const
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number]

/**
 * §8 — provenance for every derived relationship. A relationship without a
 * source is rejected by the consistency checker (never silently accepted).
 */
export interface GraphProvenance {
  /** Where the relationship came from (entity + id, or `derived:<rule>`). */
  source: string
  /** Who produced it (actor id, or 'SYSTEM'). */
  actor: string
  at: string
  sourceType: 'RECORD' | 'DERIVED' | 'AI' | 'USER' | 'KNOWLEDGE'
  version?: string
  /** Set when this relationship was superseded (never silently overwritten). */
  supersededBy?: string | null
}

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  /** Stable reference (entity id or `case:<planNumber>` / `tooth:<fdi>`). */
  ref: string
  label: string
  trust: GraphTrust
  provenance: GraphProvenance
  /** Bounded, structured detail — never a free-form record dump. */
  data: Record<string, unknown>
}

export interface GraphEdge {
  kind: GraphEdgeKind
  from: string
  to: string
  trust: GraphTrust
  provenance: GraphProvenance
}

export interface CaseGraph {
  tenant: string
  patientId: string
  caseId: string | null
  builtAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Bounded-traversal guard rails that actually applied. */
  limits: { maxNodes: number; maxDepth: number; truncated: boolean }
}

export interface GraphTraversalInput {
  startId: string
  direction?: 'out' | 'in' | 'both'
  edgeKinds?: GraphEdgeKind[]
  maxDepth?: number
  maxNodes?: number
}

export interface GraphTraversalResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  depth: number
  truncated: boolean
  queryCount: number
  resultCount: number
  maxDepthReached: number
}

// ---------------------------------------------------------------------------
// §33 — consistency findings (reported, never silently repaired)
// ---------------------------------------------------------------------------

export const GRAPH_INCONSISTENCY_CODES = [
  'ORPHAN_EDGE',
  'CROSS_TENANT_EDGE',
  'IMPOSSIBLE_PATIENT_CASE_LINK',
  'MISSING_PROVENANCE',
  'STALE_DERIVED_RELATIONSHIP',
  'DUPLICATE_EDGE',
  'CONFLICTING_STATE',
  'INVALID_LIFECYCLE_TRANSITION',
] as const
export type GraphInconsistencyCode = (typeof GRAPH_INCONSISTENCY_CODES)[number]

export interface GraphInconsistency {
  code: GraphInconsistencyCode
  detail: string
  edges?: number
  nodes?: number
}

// ---------------------------------------------------------------------------
// §19 — proactive intelligence (typed, deduplicated, dismissible, audited)
// ---------------------------------------------------------------------------

export const ALERT_TYPES = [
  'FOLLOW_UP_DUE',
  'MISSED_APPOINTMENT',
  'AI_REVIEW_REQUIRED',
  'CASE_INCOMPLETE',
  'TREATMENT_PENDING',
  'QUEUE_BOTTLENECK',
  'TASK_OVERDUE',
] as const
export type AlertType = (typeof ALERT_TYPES)[number]

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export interface ProactiveAlert {
  alertType: AlertType
  severity: AlertSeverity
  /** Deterministic trigger that fired (name of the rule). */
  trigger: string
  /** Structured evidence backing the alert (bounded; no free text dumps). */
  evidence: Record<string, unknown>
  scope: { patientId: string | null; caseId: string | null }
  titleKey: string
  titleParams: Record<string, string>
  at: string
  /** Stable dedup key (alertType + scope + subject) — one active alert per key. */
  dedupKey: string
  state: 'ACTIVE' | 'DISMISSED' | 'ACTION_TAKEN'
}

// ---------------------------------------------------------------------------
// §21 — insight status for every intelligence item
// ---------------------------------------------------------------------------

export const DATA_STATE = ['AVAILABLE', 'NOT_AVAILABLE', 'NOT_MEASURED'] as const
export type DataState = (typeof DATA_STATE)[number]

/**
 * A single intelligence item with an explicit trust class. Used across the
 * command center, alerts, summaries and timelines so FACT vs DERIVED vs
 * AI_INTERPRETATION vs RECOMMENDATION vs ACTION are never mixed.
 */
export interface IntelligenceItem {
  id: string
  insightClass: InsightClass
  state: DataState
  titleKey: string
  titleParams: Record<string, string>
  detail: Record<string, unknown>
  /** Provenance for derived items (deterministic rule / record ref / model). */
  provenance?: GraphProvenance
  scope: { patientId: string | null; caseId: string | null }
}

// ---------------------------------------------------------------------------
// Errors (typed, i18n-keyed — never free-form English in Arabic responses)
// ---------------------------------------------------------------------------

export const INTELLIGENCE_ERROR_CODES = [
  'INT_UNAUTHORIZED',
  'INT_PATIENT_NOT_FOUND',
  'INT_CASE_NOT_FOUND',
  'INT_SCOPE_MISMATCH',
  'INT_INVALID_PARAMS',
  'INT_WORKFLOW_NOT_FOUND',
  'INT_WORKFLOW_ROLE_DENIED',
  'INT_WORKFLOW_LIMIT_EXCEEDED',
  'INT_WORKFLOW_INVALID_TRANSITION',
  'INT_WORKFLOW_NOT_RUNNABLE',
  'INT_WORKFLOW_EXPIRED',
  'INT_ENGINE_UNAVAILABLE',
  'INT_DATA_UNAVAILABLE',
] as const
export type IntelligenceErrorCode = (typeof INTELLIGENCE_ERROR_CODES)[number]

export class IntelligenceError extends Error {
  constructor(
    public readonly code: IntelligenceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'IntelligenceError'
  }
}

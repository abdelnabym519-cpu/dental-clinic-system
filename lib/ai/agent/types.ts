/**
 * Phase 3 — Agent core contract (final).
 *
 * The DenToRa Dental & Clinic Agent is an ORCHESTRATOR, not an authorization
 * authority: it coordinates existing capabilities (Phase 2 context engine,
 * Phase 1 action pipeline) behind one strongly typed loop.
 *
 * Invariants encoded here:
 * - The server-resolved actor/tenant is the ONLY identity (never client
 *   asserted); client-suggested entities are re-validated before use.
 * - The LLM is allowed exactly two jobs (classification fallback, clinical
 *   synthesis) — never authorization, execution, approval or tool selection.
 * - Writes only exist as Phase 1 pipeline outcomes; the agent can propose
 *   (DRAFT) and request approval, never grant it.
 * - No chain-of-thought is represented anywhere: plans are execution
 *   structures, traces are operational metadata (no secrets, no raw PHI).
 */

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface AgentRequest {
  requestId: string
  conversationId?: string | null
  /** Server-resolved actor (from the session) — never client-asserted. */
  actor: { id: string; name: string; role: string }
  /** Authoritative tenant (server-side, from the session). */
  hospitalId: string
  /** The user's message (DATA — untrusted). */
  message: string
  /** Client-suggested entities — ALWAYS re-validated server-side. */
  patientId?: string | null
  patientName?: string | null
  toothFdi?: number | null
  caseId?: string | null
  studyId?: string | null
  treatmentNo?: string | null
  /** Client-provided history: conversational continuity ONLY.
   *  NEVER for authorization, approval, action results, identity, tenant or
   *  patient ownership (server state is authoritative — Phase 9 boundary). */
  history?: { role: 'user' | 'assistant'; content: string }[]
  page?: string | null
  timestamp?: string
  source?: string
}

// ---------------------------------------------------------------------------
// Task classification
// ---------------------------------------------------------------------------

export const AGENT_TASK_TYPES = [
  'INFORMATIONAL',
  'CLINICAL_ANALYSIS',
  'IMAGING_ANALYSIS',
  'OPERATIONAL',
  'ACTION_REQUEST',
  'MULTI_STEP',
  'KNOWLEDGE',
  'OUT_OF_DOMAIN',
  'UNKNOWN',
] as const
export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number]

export const AGENT_DOMAINS = [
  'patient', 'dental', 'clinical', 'imaging', 'treatment', 'prescription',
  'billing', 'scheduling', 'staff', 'inventory', 'lab', 'knowledge',
] as const
export type AgentDomain = (typeof AGENT_DOMAINS)[number]

export const RISK_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const EXECUTION_MODES = ['READ_ONLY', 'DRAFT', 'APPROVAL_REQUIRED', 'EXECUTE', 'FORBIDDEN'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export interface AgentTask {
  taskType: AgentTaskType
  domains: AgentDomain[]
  riskLevel: RiskLevel
  contextProfile: ContextProfileRef | null
  executionMode: ExecutionMode
  patientInvolved: boolean
  toothInvolved: boolean
  caseInvolved: boolean
  readOnly: boolean
  actionRequested: boolean
  multiStep: boolean
  /** 0..1 — how confident the classification is. */
  confidence: number
  /** Measured split (§28): deterministic vs LLM-assisted. */
  classifiedBy: 'deterministic' | 'llm'
  /** What is missing to answer precisely (drives clarification). */
  missingInfo: string[]
  /**
   * Phase 4 — dental knowledge (RAG) signal. `needed` when the question
   * asks for general dental knowledge (guidelines/criteria/protocols), not
   * only the patient's records. `hybrid` = patient facts + knowledge in one
   * answer (kept visibly separate in the response). Server decides the use
   * case tiers; the LLM/client cannot.
   */
  knowledge?: KnowledgeSignal | null
}

export interface KnowledgeSignal {
  needed: boolean
  hybrid: boolean
  useCase: 'clinical' | 'educational'
  /** Taxonomy domain detected for the question (validated or null). */
  domain: import('../knowledge/taxonomy').KnowledgeDomain | null
}

/** Indirection so the agent package does not import Phase 2 types eagerly. */
export type ContextProfileRef =
  | 'MINIMAL' | 'PATIENT_OVERVIEW' | 'CLINICAL' | 'TOOTH' | 'CASE'
  | 'IMAGING' | 'TREATMENT' | 'FOLLOW_UP' | 'TIMELINE' | 'FULL_360'

// ---------------------------------------------------------------------------
// Plan (bounded templates — §13/§14)
// ---------------------------------------------------------------------------

export interface AgentPlanStep {
  index: number
  tool: string
  input: Record<string, unknown>
  /** What this step is for (tracing only, not instructions). */
  intent: string
  /** Must complete first (templates are linear; detector guards evolution). */
  dependsOn?: number[]
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
}

export interface AgentPlan {
  steps: AgentPlanStep[]
  maxSteps: number
}

// ---------------------------------------------------------------------------
// Tools (§8/§9/§10)
// ---------------------------------------------------------------------------

export type ToolWriteClass = 'READ' | 'DRAFT' | 'WRITE'

export interface AgentToolDefinition {
  name: string
  description: string
  domain: AgentDomain
  writeClass: ToolWriteClass
  riskLevel: RiskLevel
  requiredRoles: string[]
  /** Tool needs a resolved, tenant-scoped patient. */
  requiresPatient: boolean
  /** WRITE tools must route through the Phase 1 pipeline. */
  viaActionPipeline: boolean
  /** Phase 1 intent for WRITE tools (policy/approval/verification live there). */
  actionIntent?: string
  /** Input validation: error message or null. */
  validateInput: (input: Record<string, unknown>) => string | null
  timeoutMs: number
  /** 0 = no retry (writes never auto-retry). */
  maxRetries: number
  idempotent: boolean
}

export interface AgentToolResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  meta: {
    tool: string
    tenantId: string
    patientId?: string | null
    latencyMs: number
    /** Provenance summary for the response contract. */
    sources?: { sourceType: string; sourceId: string; entityType: string; freshness: string }[]
  }
}

// ---------------------------------------------------------------------------
// Failures (§20) — typed, user-safe
// ---------------------------------------------------------------------------

export const AGENT_FAILURE_CODES = [
  'INVALID_REQUEST',      // malformed request envelope
  'MISSING_CONTEXT',      // required entity (patient/tooth/param) not provided
  'UNAUTHORIZED',         // role may not perform this
  'SCOPE_ERROR',          // tenant/patient scope violated (fail-stop)
  'TOOL_NOT_FOUND',       // unknown tool name — closed registry
  'TOOL_INPUT_ERROR',     // unknown/invalid tool parameter
  'TOOL_TIMEOUT',         // hard per-tool timeout
  'TOOL_FAILURE',         // unexpected tool error
  'PLAN_LIMIT',           // plan/iteration/repetition limit hit
  'SAFETY_BLOCK',         // Phase 1 policy blocked the action
  'APPROVAL_REQUIRED',    // pipeline requires human approval (not an error)
  'APPROVAL_REJECTED',    // approval rejected (informational)
  'VERIFICATION_FAILED',  // write ran but post-verification failed
  'MODEL_UNAVAILABLE',    // LLM down — deterministic path took over
  'PARSE_ERROR',          // unparseable model output — ignored safely
  'SYSTEM_ERROR',         // everything else (fail closed)
] as const
export type AgentFailureCode = (typeof AGENT_FAILURE_CODES)[number]

export interface AgentFailure {
  code: AgentFailureCode
  description?: string
}

export const AGENT_FAILURES: Record<AgentFailureCode, AgentFailure> = Object.fromEntries(
  AGENT_FAILURE_CODES.map((c) => [c, { code: c }])
) as Record<AgentFailureCode, AgentFailure>

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const AGENT_STATUSES = [
  'COMPLETED',
  'CLARIFICATION_REQUIRED',
  'PENDING_APPROVAL',
  'DRAFT_CREATED',
  'NOT_EXECUTED',
  'FAILED',
] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export interface SourceRef {
  sourceType: string
  sourceId: string
  entityType: string
  freshness: string
}

export interface ActionProposed {
  action: string
  intent: string
  params: Record<string, string>
  riskLevel: RiskLevel
  approvalRequired: boolean
  mode: 'DRAFT' | 'APPROVAL_REQUIRED' | 'EXECUTE'
  status: 'PROPOSED' | 'PENDING_APPROVAL'
  reason?: string
}

export interface ActionExecuted {
  action: string
  intent: string
  params: Record<string, string>
  executed: boolean
  verified: boolean
  verificationDetail: string | null
  result: unknown
}

export interface ApprovalState {
  state: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  approvalId: string | null
  fingerprint: string | null
  decision: string | null
  decidedBy: string | null
  decidedAt: string | null
  replaySafe: boolean
}

export interface AgentState {
  traceId: string
  request: AgentRequest
  actor: { id: string; name: string; role: string }
  hospitalId: string
  startedAt: Date
  finishedAt?: Date
  status: 'RUNNING' | AgentStatus
  stopReason: string | null
  stageTimes: Record<string, number>
  modelCalls: number
  modelLatencyMs: number
  toolCalls: {
    index: number
    tool: string
    input: Record<string, unknown>
    ok: boolean
    error: string | null
    latencyMs: number
  }[]
  lastToolResults: AgentToolResult[]
  limitHits: string[]
  limits: AgentLimits
  task: AgentTask | null
  context: unknown
  contextProfile: ContextProfileRef | null
  contextText: string | null
  plan: AgentPlan | null
  sources: SourceRef[]
  actionsProposed: ActionProposed[]
  actionsExecuted: ActionExecuted[]
  approvalState: ApprovalState | null
  verification: { verified: boolean; method: string; result: 'PASS' | 'FAIL' } | null
  uncertainty: string[]
  missingInfo: string[]
  warnings: string[]
  /** Phase 4 — last successful knowledge package (for ANALYZE). */
  knowledgePackage?: import('../knowledge/types').KnowledgeEvidencePackage | null
  /** Phase 4 — knowledge observability (no content, no CoT). */
  knowledge?: {
    queryId: string
    ok: boolean
    failureCode: string | null
    candidateCount: number
    selectedCount: number
    sourceCount: number
    retrievalMs: number
    citationCount: number
  } | null
}

// ---------------------------------------------------------------------------
// Trace (§29 — no CoT, no secrets, no raw PHI; tenant-isolated row)
// ---------------------------------------------------------------------------

export interface AgentTrace {
  traceId: string
  taskType: AgentTaskType
  profile: ContextProfileRef | null
  stages: Record<string, number>
  totalMs: number
  modelCalls: number
  modelLatencyMs: number
  /** Phase 4 — knowledge retrieval observability (no content, no CoT). */
  knowledge?: {
    queryId: string
    ok: boolean
    failureCode: string | null
    candidateCount: number
    selectedCount: number
    sourceCount: number
    retrievalMs: number
    citationCount: number
  } | null
  toolCalls: {
    index: number
    tool: string
    input: Record<string, unknown>
    ok: boolean
    error: string | null
    latencyMs: number
  }[]
  limits: {
    hits: string[]
    maxPlanSteps: number
    maxToolCalls: number
    maxIterations: number
    totalTimeoutMs: number
  }
  status: 'RUNNING' | AgentStatus
  stopReason: string | null
  failureCodes: string[]
  startedAt: string
}

// ---------------------------------------------------------------------------
// Response contract (§23)
// ---------------------------------------------------------------------------

export interface AgentResponse {
  status: AgentStatus
  /** The user-facing answer (text). Deterministic when it can be. */
  answer: string
  task: AgentTask | null
  contextProfileUsed: ContextProfileRef | null
  toolsUsed: string[]
  sources: SourceRef[]
  actionsProposed: ActionProposed[]
  actionsExecuted: ActionExecuted[]
  approvalState: ApprovalState | null
  verification: { verified: boolean; method: string; result: 'PASS' | 'FAIL' } | null
  uncertainty: string[]
  missingInfo: string[]
  warnings: string[]
  limitHits: string[]
  trace: AgentTrace
  /** Phase 4 — structured dental-knowledge evidence (null when not used). */
  evidence?: AgentEvidenceSummary | null
  /** Phase 4 — deterministic grounding check of the answer's citations. */
  grounding?: GroundingSummary | null
}

/** Phase 4 — evidence summary in the response (contract-safe subset). */
export interface AgentEvidenceSummary {
  ok: boolean
  queryId: string
  resultCount: number
  sourceCount: number
  failureCode?: string | null
  emptyReason?: string | null
  conflicts: Array<{ topic: string; sourceIds: string[]; note: string }>
  citations: import('../knowledge/types').KnowledgeCitation[]
}

/** Phase 4 — grounding (deterministic, no LLM). */
export interface GroundingSummary {
  citedIds: string[]
  unsupportedCitations: string[]
  factClass: 'KNOWN_FROM_SOURCE' | 'KNOWN_FROM_PATIENT_RECORD' | 'MODEL_INTERPRETATION' | 'UNKNOWN'
}

// ---------------------------------------------------------------------------
// Limits (§14) — hard, injectable for tests
// ---------------------------------------------------------------------------

export interface AgentLimits {
  maxPlanSteps: number
  maxToolCalls: number
  maxRepeatedToolCalls: number
  maxIterations: number
  totalTimeoutMs: number
  maxContextChars: number
  maxAnswerChars: number
  /** LLM calls per request (classification fallback + synthesis). */
  maxLlmCalls: number
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxPlanSteps: 12,
  maxToolCalls: 10,
  maxRepeatedToolCalls: 3,
  maxIterations: 8,
  totalTimeoutMs: 30000,
  maxContextChars: 60000,
  maxAnswerChars: 4000,
  maxLlmCalls: 1,
}

// ---------------------------------------------------------------------------
// Dependencies (injectable for deterministic tests)
// ---------------------------------------------------------------------------

export interface AgentDeps {
  /** prisma-shaped client (Phase 2 fake in tests; real prisma in prod). */
  client: any
  /** LLM completion: (messages, purpose) → content. Used ONLY for
   *  classification fallback + clinical synthesis — never for
   *  authorization, tool selection, execution or approval. */
  llm: (
    messages: { role: 'system' | 'user'; content: string }[],
    purpose: 'agent_classify' | 'agent_synthesis'
  ) => Promise<{ content: string; model?: string }>
  limits: AgentLimits
  /** Injectable clock (deterministic tests). */
  now: () => Date
  /** Phase 4 — knowledge store (injectable for tests; defaults to Prisma). */
  knowledgeStore?: import('../knowledge/types').KnowledgeStore
}

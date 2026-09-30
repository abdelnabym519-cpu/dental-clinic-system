/**
 * Phase 7 — DenToRa AI Evaluation Framework (canonical, single location).
 *
 * This module defines the TYPED concepts of the evaluation harness. It is a
 * CONSUMER of the existing architecture — it projects the real
 * `AgentResponse`/`AgentTrace` (Phase 3), the knowledge evidence package
 * (Phase 4), the engine registry/envelope (Phase 5), and the attachment
 * contract (Phase 6). It creates no second agent, brain, RAG, tool registry,
 * or observability framework (§2).
 *
 * PHI rule (§3.2/§13): golden fixtures are synthetic only; every trace
 * stores structured decisions, safe references, hashes, and summaries —
 * never raw patient records, attachment contents, or chain-of-thought.
 */

// ---------------------------------------------------------------------------
// Verdicts & typed failures (§21/§24)
// ---------------------------------------------------------------------------

export const EVAL_VERDICTS = [
  'PASS',
  'FAIL',
  'SKIPPED',
  'BLOCKED_ENVIRONMENT',
  'NOT_APPLICABLE',
] as const
export type EvalVerdict = (typeof EVAL_VERDICTS)[number]

export const EVAL_FAILURE_CODES = [
  // Agent (§17)
  'EVAL_AGENT_ROUTING_MISMATCH',
  'EVAL_AGENT_TOOL_MISMATCH',
  'EVAL_AGENT_TOOL_INPUT_MISMATCH',
  'EVAL_AGENT_PLAN_MISMATCH',
  'EVAL_AGENT_CONTEXT_MISMATCH',
  'EVAL_AGENT_OUTPUT_CONSTRAINT',
  'EVAL_AGENT_FAILURE_EXPECTATION',
  'EVAL_AGENT_LLM_FALLBACK_MISMATCH',
  // Scope / safety (§7/§8/§12)
  'EVAL_TENANT_SCOPE_VIOLATION',
  'EVAL_PATIENT_SCOPE_VIOLATION',
  'EVAL_APPROVAL_BYPASS',
  'EVAL_APPROVAL_FORGERY',
  'EVAL_APPROVAL_TAMPER',
  'EVAL_APPROVAL_REPLAY',
  'EVAL_POLICY_VIOLATION',
  'EVAL_EXECUTION_BOUNDARY',
  // RAG (§9/§17)
  'EVAL_RAG_RETRIEVAL_MISMATCH',
  'EVAL_RAG_CITATION_MISMATCH',
  'EVAL_RAG_GROUNDING_MISMATCH',
  'EVAL_RAG_NO_EVIDENCE_MISHANDLE',
  'EVAL_RAG_SECURITY_BREACH',
  // Multimodal (§10)
  'EVAL_MODALITY_CLASSIFICATION_MISMATCH',
  'EVAL_MODALITY_ROUTING_MISMATCH',
  'EVAL_MODALITY_UNSUPPORTED_MISHANDLE',
  'EVAL_ATTACHMENT_IDENTITY_MISMATCH',
  'EVAL_MULTIMODAL_PROVENANCE_MISMATCH',
  // Local AI (§11)
  'EVAL_ENGINE_IDENTITY_MISMATCH',
  'EVAL_ENGINE_ARTIFACT_MISMATCH',
  'EVAL_ENGINE_PROVENANCE_MISMATCH',
  'EVAL_ENGINE_INFERENCE_MISMATCH',
  'EVAL_ENGINE_SCHEMA_MISMATCH',
  // Replay / performance / observability (§13/§15/§17/§18)
  'EVAL_REPLAY_MISMATCH',
  'EVAL_REPLAY_NON_DETERMINISTIC',
  'EVAL_PERFORMANCE_REGRESSION',
  'EVAL_PERFORMANCE_ENV_UNLABELED',
  'EVAL_ATTACK_NOT_BLOCKED',
  'EVAL_PHI_LEAK',
  'EVAL_TRACE_MISSING',
  // Framework
  'EVAL_DATASET_INVALID',
  'EVAL_CONTRACT_MISMATCH',
  // Phase 10 — voice replay extension (same vocabulary, additive)
  'EVAL_VOICE_BEHAVIOR_MISMATCH',
  'EVAL_VOICE_TEXT_MISMATCH',
] as const
export type EvalFailureCode = (typeof EVAL_FAILURE_CODES)[number]

/** One checkable assertion inside a case/suite. */
export interface EvalCheck {
  id: string
  verdict: EvalVerdict
  /** Typed failure code when verdict === 'FAIL' (else null). */
  code: EvalFailureCode | null
  /** Human-readable, PHI-free detail (what was expected vs observed). */
  detail: string
  /** Mandatory reason for SKIPPED / BLOCKED_ENVIRONMENT / NOT_APPLICABLE. */
  reason: string | null
}

// ---------------------------------------------------------------------------
// Case taxonomy (§5/§6/§16)
// ---------------------------------------------------------------------------

export const EVAL_CATEGORIES = [
  'AGENT',
  'CLINICAL',
  'PATIENT_360',
  'APPROVAL_SAFETY',
  'RAG',
  'MULTIMODAL',
  'LOCAL_AI',
  'ADVERSARIAL',
  // Phase 8 — memory contract cases (synthetic-only, Gate B extension).
  'MEMORY',
] as const
export type EvalCategory = (typeof EVAL_CATEGORIES)[number]

export const EVAL_LANGUAGES = ['ar', 'en', 'mixed'] as const
export type EvalLanguage = (typeof EVAL_LANGUAGES)[number]

export const EVAL_ACTOR_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'DOCTOR',
  'RECEPTIONIST',
  'ACCOUNTANT',
  'LAB_TECH',
  'PATIENT',
] as const
export type EvalActorRole = (typeof EVAL_ACTOR_ROLES)[number]

/** Which execution boundary a case replays against (§15). */
export const REPLAY_MODES = [
  'UNIT_REPLAY',
  'INTEGRATION_REPLAY',
  'REAL_ENGINE_REPLAY',
  'LIVE_EXTERNAL',
] as const
export type ReplayMode = (typeof REPLAY_MODES)[number]

/**
 * Attachment fixture spec (synthetic). The harness materializes these into
 * the Phase 6 `AttachmentRecord` shape through the real attachment service
 * fakes — the case never carries bytes or storage paths.
 */
export interface GoldenAttachment {
  id: string
  fileClass: 'IMAGE_2D' | 'MESH_3D' | 'DOCUMENT_PDF' | 'DOCUMENT_TEXT' | 'VOLUME_DICOM' | 'UNKNOWN'
  dentalModality: string | null
  patientId: string | null
  originalName: string
  /** Document fixtures only — the extracted text that must be stored. */
  extractedText?: string
  studyId?: string | null
}

/** Externally observable expected behavior (§16 — no hidden reasoning). */
export interface ExpectedBehavior {
  status?: EvalAgentStatus[]
  taskType?: string | string[]
  patientInvolved?: boolean
  toothInvolved?: boolean
  /** Ordered tool names (exact sequence for UNIT_REPLAY). */
  tools?: string[]
  /** Per-tool exact input constraints (subset match on the given keys). */
  toolInputs?: Record<string, Record<string, unknown>>
  contextProfile?: string | null
  llmCalls?: { min?: number; max?: number }
  failureCodes?: string[]
  /** Exact stop reason (null = must complete without a stop reason). */
  stopReason?: string | null
  warningsMin?: number
  /** Answer text constraints — strings or 'rx:<pattern>' regex sources. */
  mustContain?: string[]
  mustNotContain?: string[]
  actionsProposed?: { min?: number; max?: number }
  actionsExecuted?: { min?: number; max?: number }
  approvalState?: string | null
  /** Knowledge/evidence expectations (Phase 4). */
  evidence?: {
    required?: boolean
    sourcesMin?: number
    sourcesMax?: number
    citationsMin?: number
    citationsMax?: number
    failureCode?: string | null
  }
  grounding?: { ok?: boolean; unsupportedMax?: number }
  /** Phase 6 — how many requested attachments must resolve. */
  attachmentsResolved?: number
  attachmentsDroppedMin?: number
}

export type EvalAgentStatus =
  | 'COMPLETED'
  | 'CLARIFICATION_REQUIRED'
  | 'PENDING_APPROVAL'
  | 'DRAFT_CREATED'
  | 'NOT_EXECUTED'
  | 'FAILED'

export interface GoldenCase {
  caseId: string
  category: EvalCategory
  /** Dental domain (KNOWLEDGE_DOMAINS or a phase area) — keeps the dataset
   *  inside the dental product identity (§1). */
  domain: string
  language: EvalLanguage
  title: string
  description?: string
  actorRole: EvalActorRole
  /** Synthetic tenant: 'A' (HOSP_A) or 'B' (HOSP_B). */
  tenant: 'A' | 'B'
  /** Synthetic patient context rows merged into the fake tenant DB. */
  patientContext?: Record<string, unknown>[] | null
  input: {
    message: string
    patientId?: string | null
    patientName?: string | null
    toothFdi?: number | null
    caseId?: string | null
    studyId?: string | null
    attachments?: string[]
  }
  attachments?: GoldenAttachment[]
  expected: ExpectedBehavior
  /** Test-quality tags (§22): positive/negative/boundary/malformed/
   *  unsupported/adversarial/authorization/replay/regression. */
  tags?: string[]
}

// ---------------------------------------------------------------------------
// Observed behavior & traces (§13/§14/§15)
// ---------------------------------------------------------------------------

/** Structured, PHI-minimized projection of one replayed case. */
export interface ObservedBehavior {
  status: string
  taskType: string | null
  patientInvolved: boolean | null
  toothInvolved: boolean | null
  tools: { tool: string; ok: boolean; input: Record<string, unknown> }[]
  toolNames: string[]
  contextProfile: string | null
  llmCalls: number
  failureCodes: string[]
  warnings: number
  stopReason: string | null
  answer: string
  actionsProposed: number
  actionsExecuted: number
  approvalState: string | null
  sources: number
  citations: number
  evidenceOk: boolean | null
  evidenceFailureCode: string | null
  groundingOk: boolean | null
  attachmentsResolved: number
  attachmentIds: string[]
  engines: { tool: string; engine: string | null; jobId: string | null }[]
  /** Phase 8 — memory observability (COUNTS ONLY — no memory content, no PHI). */
  memory?: {
    items: number
    domains: string[]
    truncated: boolean
    candidates: number
    retrievalMs: number
    written: number
  } | null
}

/**
 * Canonical evaluation trace (§13). Every field is a structured decision,
 * a safe reference, a hash, or a summary. Raw messages, patient records,
 * attachment contents, and model chain-of-thought are NEVER stored.
 */
export interface EvaluationTrace {
  traceId: string
  requestId: string
  /** Safe tenant reference — a hash, never the raw tenant id/secret. */
  tenantHash: string
  actorRole: string
  taskType: string | null
  /** Per-stage latency (existing AgentTrace.stages — structured only). */
  stages: Record<string, number>
  toolSummary: { index: number; tool: string; ok: boolean; latencyMs: number; inputKeys: string[] }[]
  routingDecision: { taskType: string | null; stopReason: string | null; deterministic: boolean }
  contextProfile: string | null
  knowledgeRetrievalSummary: {
    ok: boolean
    candidateCount: number
    selectedCount: number
    sourceCount: number
    citationCount: number
    failureCode: string | null
    retrievalMs: number
  } | null
  attachmentSummary: { requested: number; resolved: number; byClass: Record<string, number> }
  engineIdentity: { tool: string; engine: string | null; jobId: string | null; modality: string | null }[]
  approvalState: string | null
  safetyDecision: { blocked: boolean; mode: string | null; verification: { verified: boolean; result: 'PASS' | 'FAIL' } | null }
  latencyMs: number
  failureCode: string | null
  fallback: 'DETERMINISTIC' | 'LLM_FALLBACK_USED'
  timestamp: string
  /** Stable hash over the structured behavior (excludes traceId/startedAt). */
  fingerprint: string
}

// ---------------------------------------------------------------------------
// Results, metrics, environment, benchmarks (§17/§18)
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  suite: string
  caseId: string | null
  verdict: EvalVerdict
  checks: EvalCheck[]
  /** Aggregate typed failure codes for this result (PASS → none). */
  failureCodes: EvalFailureCode[]
  reason: string | null
  durationMs: number
}

export interface EvaluationMetric {
  name: string
  value: number
  numerator: number
  denominator: number
  unit: 'ratio' | 'ms' | 'count'
}

export const ENV_LABELS = [
  'SANDBOX',
  'DEVELOPMENT_MACHINE',
  'TARGET_MACHINE',
  'UNKNOWN',
] as const
export type EnvLabel = (typeof ENV_LABELS)[number]

export interface EnvironmentFacts {
  label: EnvLabel
  node: string
  platform: string
  arch: string
  cpuCount: number
  cpuModel: string
  totalMemGb: number
  /** Explicitly recorded when the label was set via EVAL_ENV_LABEL. */
  labelSource: 'env-var' | 'heuristic'
}

export interface BenchmarkRecord {
  name: string
  env: EnvironmentFacts
  runs: { warmup: number; samples: number }
  minMs: number
  maxMs: number
  meanMs: number
  medianMs: number
  p95Ms: number
  coldMs: number | null
  failures: number
  notes: string | null
}

// ---------------------------------------------------------------------------
// Gates (§27) & dataset
// ---------------------------------------------------------------------------

export const GATE_IDS = [
  'A_ARCHITECTURE',
  'B_AGENT',
  'C_SAFETY',
  'D_RAG',
  'E_MULTIMODAL',
  'F_LOCAL_AI',
  'G_SECURITY',
  'H_OBSERVABILITY',
  'I_REPLAY',
  'J_REGRESSION',
  'K_PERFORMANCE',
  'L_DOCUMENTATION',
] as const
export type GateId = (typeof GATE_IDS)[number]

export interface GateReport {
  gate: GateId
  title: string
  checks: EvalCheck[]
  verdict: EvalVerdict
  blockedReasons: string[]
}

export const PHASE_STATUSES = ['PASS', 'PASS_WITH_EXPLICIT_BLOCKERS', 'FAIL'] as const
export type PhaseStatus = (typeof PHASE_STATUSES)[number]

export interface GoldenDataset {
  datasetVersion: string
  /** Synthetic-only attestation (§3.2/§16). */
  phiPolicy: 'SYNTHETIC_ONLY'
  cases: GoldenCase[]
}

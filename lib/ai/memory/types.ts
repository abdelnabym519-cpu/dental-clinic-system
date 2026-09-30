/**
 * Phase 8 — canonical DenToRa Memory: typed contracts.
 *
 * ONE memory architecture (no second brain): the store is Prisma
 * (AiMemoryItem + AiMemoryEvent — additive migration 20261002000000), the
 * policy/policy-validation/retrieval live here, and the Agent loop is the
 * only caller (through the injectable MemoryService seam in AgentDeps).
 *
 * Hard rules encoded in these types:
 *  - Working memory is NEVER persisted (EPHEMERAL) — it is the current
 *    AgentState context, not a row.
 *  - AI_DERIVED items are candidates: excluded from clinical context by
 *    default; they are never equivalent to CLINICALLY_VERIFIED.
 *  - Trust is a stored fact (trustLevel), never inferred from the content.
 *  - Confidence, when present, must be a fully-sourced object — never a
 *    fabricated number.
 *  - Every persistent item carries provenance (sourceKind/sourceRef/
 *    createdBy) and a scope (domain + tenant-scoped columns).
 */

export const MEMORY_DOMAINS = [
  'CLINIC',
  'DOCTOR',
  'PATIENT',
  'CASE',
  'CONVERSATION',
] as const
export type MemoryDomain = (typeof MEMORY_DOMAINS)[number]

export const MEMORY_TYPES = ['STRUCTURED', 'EPISODIC', 'SEMANTIC'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export const MEMORY_TRUST = [
  'USER_PROVIDED',
  'CLINIC_CONFIGURED',
  'DOCTOR_CONFIRMED',
  'SYSTEM_DERIVED',
  'AI_DERIVED',
  'CLINICALLY_VERIFIED',
  'UNKNOWN',
] as const
export type MemoryTrust = (typeof MEMORY_TRUST)[number]

export const MEMORY_STATUS = ['ACTIVE', 'SUPERSEDED', 'INVALIDATED', 'DELETED'] as const
export type MemoryStatus = (typeof MEMORY_STATUS)[number]

export const MEMORY_SOURCE_KINDS = [
  'USER_STATEMENT',
  'USER_CONFIRMATION',
  'CLINIC_SETTING',
  'ENGINE_RESULT',
  'ACTION_RESULT',
  'CONVERSATION',
  'SYSTEM',
] as const
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number]

/**
 * §17 — write classification. The LLM NEVER chooses this; the caller
 * (agent loop / API) picks it from deterministic facts, and the policy
 * maps it to the only legal trust level:
 *
 *   EPHEMERAL        → not persisted at all (working memory)
 *   CANDIDATE_MEMORY → persisted as AI_DERIVED (retrievable only when the
 *                      caller explicitly opts in — always labeled unverified)
 *   USER_CONFIRMED   → USER_PROVIDED (explicit user statement/confirmation)
 *   DOCTOR_CONFIRMED → DOCTOR_CONFIRMED or CLINICALLY_VERIFIED (doctor/
 *                      admin only, clinical scopes only)
 *   SYSTEM_VERIFIED  → SYSTEM_DERIVED (server-verified facts: executed
 *                      actions, engine jobs, clinic configuration)
 *   FORBIDDEN        → rejected before any persistence
 */
export const MEMORY_WRITE_CLASSES = [
  'EPHEMERAL',
  'CANDIDATE_MEMORY',
  'USER_CONFIRMED',
  'DOCTOR_CONFIRMED',
  'SYSTEM_VERIFIED',
  'FORBIDDEN',
] as const
export type MemoryWriteClass = (typeof MEMORY_WRITE_CLASSES)[number]

export const MEMORY_EVENT_KINDS = [
  'WRITE',
  'CORRECT',
  'SUPERSEDE',
  'INVALIDATE',
  'DELETE',
  'EXPIRE',
] as const
export type MemoryEventKind = (typeof MEMORY_EVENT_KINDS)[number]

export const MEMORY_ERROR_CODES = [
  'MEMORY_SCOPE_MISMATCH',
  'MEMORY_UNAUTHORIZED',
  'MEMORY_TRUST_ESCALATION',
  'MEMORY_WRITE_CLASS_MISMATCH',
  'MEMORY_CONTENT_INVALID',
  'MEMORY_KEY_INVALID',
  'MEMORY_CONFIDENCE_INVALID',
  'MEMORY_NOT_FOUND',
  'MEMORY_NOT_ACTIVE',
  'MEMORY_TENANT_MISMATCH',
  'MEMORY_DUPLICATE_ACTIVE',
] as const
export type MemoryErrorCode = (typeof MEMORY_ERROR_CODES)[number]

export class MemoryError extends Error {
  constructor(
    public readonly code: MemoryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'MemoryError'
  }
}

/** Tenant-scoped memory scope. Domain determines which columns are used. */
export interface MemoryScope {
  hospitalId: string
  domain: MemoryDomain
  doctorId?: string | null
  patientId?: string | null
  /** A "case" in this schema IS a Treatment row. */
  caseId?: string | null
  conversationId?: string | null
}

/**
 * §13 — confidence only where meaningful. Every field is mandatory: a
 * number without source/semantics/version/timestamp is rejected
 * (MEMORY_CONFIDENCE_INVALID).
 */
export interface MemoryConfidence {
  value: number
  source: string
  semantics: string
  calibration: string | null
  version: string
  at: string
}

/** The persistent row (mirrors AiMemoryItem). */
export interface MemoryItem {
  id: string
  hospitalId: string
  domain: MemoryDomain
  memoryType: MemoryType
  trustLevel: MemoryTrust
  status: MemoryStatus
  doctorId: string | null
  patientId: string | null
  caseId: string | null
  conversationId: string | null
  key: string
  value: unknown
  confidence: MemoryConfidence | null
  sourceKind: MemorySourceKind
  sourceRef: string | null
  createdBy: string
  createdByIdType: 'USER' | 'SYSTEM'
  validFrom: Date
  expiresAt: Date | null
  supersededBy: string | null
  correctionReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface MemoryActor {
  id: string
  name?: string
  role: string
}

/** A durable write request (EPHEMERAL/FORBIDDEN never reach the store). */
export interface MemoryWriteRequest {
  scope: MemoryScope
  key: string
  value: unknown
  memoryType: MemoryType
  writeClass: Exclude<MemoryWriteClass, 'EPHEMERAL' | 'FORBIDDEN'>
  /** Must equal the class's canonical trust (policy enforces). */
  trustLevel: MemoryTrust
  sourceKind: MemorySourceKind
  sourceRef?: string | null
  confidence?: MemoryConfidence | null
  expiresAt?: Date | null
  actor: MemoryActor
}

export interface MemoryQuery {
  scope: MemoryScope
  /**
   * Include AI_DERIVED/UNKNOWN candidates. Clinical callers keep this
   * false (default); conversation-continuity callers may set true and the
   * block renders them with an explicit UNVERIFIED label.
   */
  includeCandidate?: boolean
  maxItems?: number
  maxChars?: number
  keys?: string[]
  memoryTypes?: MemoryType[]
  since?: Date
}

/**
 * The bounded, provenance-labeled memory block handed to context
 * assembly. NEVER the whole patient history — retrieval is always
 * task-scoped and budget-capped.
 */
export interface MemoryBlockItem {
  id: string
  domain: MemoryDomain
  key: string
  value: unknown
  trustLevel: MemoryTrust
  candidate: boolean
  sourceKind: MemorySourceKind
  sourceRef: string | null
  validFrom: Date
  /** Bounded rendered form used for context assembly (no raw JSON dumps). */
  rendered: string
}

export interface MemoryBlock {
  scope: MemoryScope
  items: MemoryBlockItem[]
  totalMatched: number
  truncated: boolean
  budgetChars: number
  usedChars: number
  candidateCount: number
  trustSummary: Partial<Record<MemoryTrust, number>>
}

/** Audit row (mirrors AiMemoryEvent). */
export interface MemoryEvent {
  id: string
  hospitalId: string
  memoryId: string
  eventKind: MemoryEventKind
  actorId: string | null
  actorRole: string | null
  reason: string | null
  oldValue: unknown
  newValue: unknown
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Bounds (loop engineering — every retrieval is bounded)
// ---------------------------------------------------------------------------

export const MEMORY_LIMITS = {
  maxKeyLength: 128,
  maxValueChars: 2000,
  defaultMaxItems: 10,
  hardMaxItems: 25,
  defaultMaxChars: 2000,
  hardMaxChars: 4000,
} as const

export const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/

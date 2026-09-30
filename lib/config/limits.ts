/**
 * Phase 11 — Canonical timeout classes + retry policy (§17/§18/§63).
 *
 * ONE table of timeout budgets; ONE error classifier. No infinite waits, no
 * unbounded retries. Existing component limits (agent trace.limits, engine
 * timeouts, provider command caps) remain the enforced values at their own
 * boundaries — this module is the canonical REFERENCE they must stay within,
 * plus the shared retry classification.
 */

export const TIMEOUT_CLASSES_MS = {
  REQUEST: 30_000,
  TOOL: 15_000,
  WORKFLOW_STEP: 20_000,
  DATABASE: 10_000,
  REDIS: 2_000,
  OBJECT_STORAGE: 15_000,
  AI_ENGINE: 120_000,
  STT: 30_000,
  TTS: 30_000,
} as const

export type TimeoutClass = keyof typeof TIMEOUT_CLASSES_MS

export type RetryClass =
  | 'RETRYABLE'
  | 'NON_RETRYABLE'
  | 'SECURITY_FAILURE'
  | 'USER_ACTION_REQUIRED'
  | 'RESOURCE_FAILURE'

/** Error codes that must NEVER be retried (§17 — never retry safety). */
const NEVER_RETRY = new Set([
  'SAFETY_BLOCK', 'ROLE_NOT_PERMITTED', 'TENANT_MISMATCH', 'PATIENT_MISMATCH',
  'APPROVAL_REQUIRED', 'APPROVAL_EXPIRED', 'APPROVAL_INVALID', 'APPROVAL_REPLAY',
  'FORGED_PROVENANCE', 'INVALID_INPUT', 'VALIDATION_ERROR', 'UNAUTHORIZED',
  'FORBIDDEN', 'VOICE_SESSION_INVALID', 'VOICE_STATE_TRANSITION_INVALID',
  'VOICE_TRANSCRIPT_UNSAFE', 'AUDIO_UNSAFE', 'AUDIO_PATH_ESCAPES',
  'PROVENANCE_INVALID', 'CHECKSUM_MISMATCH', 'CROSS_TENANT_BLOCKED',
])

/** Error codes that are the caller's move (no retry will help). */
const USER_ACTION = new Set([
  'APPROVAL_REQUIRED', 'APPROVAL_EXPIRED', 'CLARIFICATION_REQUIRED',
  'PATIENT_NOT_FOUND', 'TOOTH_AMBIGUOUS', 'PATIENT_AMBIGUOUS', 'PAYMENT_REQUIRED',
])

/** Transient infrastructure faults worth a bounded retry. */
const RETRYABLE = new Set([
  'TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
  'RATE_LIMITED', 'STORAGE_UNAVAILABLE', 'DATABASE_UNAVAILABLE', 'ENGINE_BUSY',
])

export type ClassifiedError = {
  retryClass: RetryClass
  /** bounded retry advice; SECURITY/USER_ACTION failures are never retried */
  maxRetries: number
  code: string
}

/** Classify an error (or error code) into the canonical retry policy. */
export function classifyError(err: unknown): ClassifiedError {
  const code = typeof err === 'string'
    ? err
    : err instanceof Error
      ? String((err as { code?: string }).code ?? err.message ?? 'UNKNOWN').split(/[\s:]/)[0].toUpperCase()
      : 'UNKNOWN'
  if (NEVER_RETRY.has(code)) return { retryClass: code.startsWith('APPROVAL') || USER_ACTION.has(code) ? 'USER_ACTION_REQUIRED' : 'SECURITY_FAILURE', maxRetries: 0, code }
  if (USER_ACTION.has(code)) return { retryClass: 'USER_ACTION_REQUIRED', maxRetries: 0, code }
  if (RETRYABLE.has(code)) return { retryClass: 'RETRYABLE', maxRetries: 3, code }
  if (code.startsWith('AUDIO_') || code.startsWith('COMMAND_')) return { retryClass: 'RESOURCE_FAILURE', maxRetries: 1, code }
  // Unknown errors: a small bounded budget for genuinely transient faults,
  // never for anything that already mutated state (callers enforce that).
  return { retryClass: 'NON_RETRYABLE', maxRetries: 0, code }
}

/** Bounded exponential backoff delays (ms) for a retryable operation. */
export function backoffSchedule(maxRetries: number, baseMs = 200): number[] {
  const out: number[] = []
  for (let i = 0; i < maxRetries; i++) out.push(baseMs * 2 ** i)
  return out
}

/**
 * Phase 10 — canonical Voice + Robot interaction contracts.
 *
 * ONE interaction state model (§34): the Voice layer and the Robot layer
 * both consume the SAME state machine. Voice is an interface, not a second
 * brain — every turn here ends in the EXISTING Agent loop (`runAgent`),
 * which keeps its own safety/approval/verification/audit stack.
 *
 * Invariants:
 * - The server-resolved actor/tenant is the ONLY identity (same as Phase 3).
 * - Speech is UNTRUSTED INPUT (§9): transcripts are normalized, validated,
 *   entity-resolved and confirmed before anything sensitive may happen.
 * - Raw audio never enters the server API (§41): the contract carries typed
 *   STT output only. Audio stays in the browser or in an explicitly
 *   configured local engine boundary.
 * - No chain-of-thought anywhere; telemetry is PHI-minimized (§22).
 */

// ---------------------------------------------------------------------------
// Canonical interaction state model (shared Voice + Robot — §34)
// ---------------------------------------------------------------------------

export const INTERACTION_STATES = [
  'IDLE',
  'LISTENING',
  'TRANSCRIBING',
  'UNDERSTANDING',
  'PROCESSING',
  'WAITING_APPROVAL',
  'SPEAKING',
  'INTERRUPTED',
  'WARNING',
  'ERROR',
  'COMPLETED',
  'CANCELLED',
] as const
export type InteractionState = (typeof INTERACTION_STATES)[number]

/**
 * Allowed transitions. Everything not listed is REJECTED (fail closed) —
 * `transitionInteractionState` throws `VOICE_STATE_TRANSITION_INVALID`.
 */
export const INTERACTION_STATE_TRANSITIONS: Record<InteractionState, InteractionState[]> = {
  // UNDERSTANDING is legal from IDLE: a typed (text-fallback) turn or a
  // first SPEAK turn carries a final transcript without a mic phase.
  IDLE: ['LISTENING', 'UNDERSTANDING', 'CANCELLED'],
  LISTENING: ['TRANSCRIBING', 'UNDERSTANDING', 'CANCELLED', 'ERROR', 'INTERRUPTED'],
  TRANSCRIBING: ['UNDERSTANDING', 'CANCELLED', 'ERROR', 'INTERRUPTED'],
  // SPEAKING is legal: short-circuit answers (clarification acks, duplicate
  // notices) speak without entering PROCESSING.
  UNDERSTANDING: ['PROCESSING', 'LISTENING', 'SPEAKING', 'CANCELLED', 'ERROR'],
  PROCESSING: ['SPEAKING', 'WAITING_APPROVAL', 'LISTENING', 'WARNING', 'ERROR', 'CANCELLED', 'INTERRUPTED'],
  WAITING_APPROVAL: ['PROCESSING', 'SPEAKING', 'CANCELLED', 'ERROR', 'INTERRUPTED', 'WARNING'],
  SPEAKING: ['COMPLETED', 'LISTENING', 'INTERRUPTED', 'ERROR', 'CANCELLED'],
  INTERRUPTED: ['LISTENING', 'IDLE', 'CANCELLED', 'ERROR'],
  WARNING: ['LISTENING', 'IDLE', 'CANCELLED', 'ERROR'],
  // A fresh utterance re-enters understanding from an error (recovery path).
  ERROR: ['IDLE', 'LISTENING', 'UNDERSTANDING', 'CANCELLED'],
  COMPLETED: ['IDLE', 'LISTENING', 'CANCELLED'],
  CANCELLED: [],
}

export class VoiceStateTransitionError extends Error {
  readonly code = 'VOICE_STATE_TRANSITION_INVALID'
  constructor(public readonly from: InteractionState, public readonly to: InteractionState) {
    super(`VOICE_STATE_TRANSITION_INVALID: ${from} -> ${to}`)
    this.name = 'VoiceStateTransitionError'
  }
}

export function canTransitionInteractionState(from: InteractionState, to: InteractionState): boolean {
  return (INTERACTION_STATE_TRANSITIONS[from] ?? []).includes(to)
}

/** Terminal/quiet states the robot treats as calm. */
export function isQuietState(s: InteractionState): boolean {
  return s === 'IDLE' || s === 'COMPLETED' || s === 'CANCELLED'
}

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------

export const VOICE_LOCALES = ['ar-EG', 'en-US'] as const
export type VoiceLocale = (typeof VOICE_LOCALES)[number]

/** Coarse language of a transcript (mixed = both scripts in one utterance). */
export type TranscriptLanguage = 'ar' | 'en' | 'mixed'

// ---------------------------------------------------------------------------
// Voice session (§5)
// ---------------------------------------------------------------------------

export interface VoiceSession {
  voiceSessionId: string
  userId: string
  tenantId: string
  locale: VoiceLocale
  state: InteractionState
  startedAt: string
  lastActivityAt: string
  /** Existing Conversation Memory conversation (Phase 2/8) — never a new store. */
  conversationId: string | null
  /** Server-verified patient scope for this session (empty until resolved). */
  patientScope: { patientId: string; displayName: string } | null
  caseScope: { caseId: string } | null
  /** Pending approval awaiting explicit confirmation (approval-ledger id). */
  pendingApprovalId: string | null
  pendingApprovalExpiresAt: string | null
  interruptionCount: number
  retryCount: number
  turnCount: number
  /** Bounded prior-turn transcript for conversational references (§8) —
   *  user+assistant pairs, newest last, capped (oldest dropped). Session-
   *  scoped: never crosses users/tenants (the store is user+tenant keyed). */
  history: { role: 'user' | 'assistant'; content: string }[]
  /** Expiry (idle TTL) — expired sessions fail closed. */
  expiresAt: string
  /**
   * Turn-taking state (§5/§6 — the turn manager owns the semantics).
   * Optional for backward compatibility with pre-existing session fixtures;
   * the pipeline normalizes on access (a missing value = fresh LISTENING).
   */
  turn?: {
    phase: 'LISTENING' | 'POSSIBLE_END' | 'CONFIRMED_END' | 'PROCESSING' | 'RESPONDING'
    bufferedTranscript: string | null
    holds: number
    lastCompletionReason:
      | 'FINAL_COMPLETE' | 'COMBINED' | 'PARTIAL_BUFFERED' | 'HELD_INCOMPLETE'
      | 'FORCED_AFTER_MAX_HOLDS' | 'BARGE_IN' | null
    /** Trailing buffer chars sourced from the LATEST interim (replace-semantics). */
    partialChars?: number
  }
}

export const VOICE_SESSION_TTL_MS = 15 * 60 * 1000
/** A duplicate utterance inside this window never re-triggers actions (§17). */
export const VOICE_DUPLICATE_WINDOW_MS = 8_000
/** Confirmation must arrive within this window after the approval prompt. */
export const VOICE_CONFIRM_WINDOW_MS = 30_000
export const VOICE_TRANSCRIPT_MAX_CHARS = 600

// ---------------------------------------------------------------------------
// Typed STT output (§6/§37) — the ONLY speech representation crossing the API
// ---------------------------------------------------------------------------

export interface VoiceTranscript {
  /** Raw recognized text (untrusted DATA). */
  text: string
  /** Provider-declared confidence 0..1 (0 when unknown). */
  confidence: number
  /** True when the provider finalized the utterance (partials are never acted on). */
  isFinal: boolean
  providerId: string
  locale?: VoiceLocale
  /** Client capture timestamp (informational; server time is authoritative). */
  capturedAt?: string
}

export interface NormalizedTranscript {
  original: string
  normalized: string
  language: TranscriptLanguage
  charCount: number
  /** Arabic-Indic digits that were folded to ASCII (observability only). */
  digitFoldCount: number
}

// ---------------------------------------------------------------------------
// Clarification + entity resolution (§10)
// ---------------------------------------------------------------------------

export type EntityResolutionStatus = 'RESOLVED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'NOT_REQUESTED'

export interface ToothResolution {
  status: EntityResolutionStatus
  /** Canonical FDI when unambiguous (existing contract — no second system). */
  fdi: number | null
  /** Candidates when ambiguous (e.g. 36 vs 63). */
  candidates: number[]
}

export interface PatientResolutionResult {
  status: EntityResolutionStatus
  patientId: string | null
  displayName: string | null
  candidates: { patientId: string; displayName: string }[]
}

export type ControlPhraseKind = 'INTERRUPT' | 'CANCEL' | 'CONFIRM' | null

export interface VoiceClarification {
  code:
    | 'TOOTH_AMBIGUOUS'
    | 'PATIENT_AMBIGUOUS'
    | 'PATIENT_NOT_FOUND'
    | 'TOOTH_NOT_FOUND'
  questionAr: string
  questionEn: string
  candidates: string[]
}

// ---------------------------------------------------------------------------
// Turn contracts (§36 — typed API)
// ---------------------------------------------------------------------------

export type VoiceTurnOp = 'SPEAK' | 'PLAYBACK_ENDED' | 'INTERRUPT' | 'CANCEL'

export interface VoiceTurnInput {
  voiceSessionId: string
  op?: VoiceTurnOp
  /** Required when op is SPEAK (or omitted = SPEAK). */
  transcript?: VoiceTranscript
}

export interface VoiceApprovalView {
  approvalId: string
  action: string
  riskLevel: string
  /** Already-validated params from the Phase 1 ledger (display only). */
  params: Record<string, string>
  requestReason: string | null
  expiresAt: string | null
}

export interface VoiceTurnResponse {
  voiceSessionId: string
  state: InteractionState
  op: VoiceTurnOp
  /** What the robot/voice UI should say (already speakable — §12). */
  speakableText: string | null
  /** Full agent answer for the transcript panel (may include citations). */
  displayText: string | null
  clarification: VoiceClarification | null
  approval: VoiceApprovalView | null
  agentStatus: string | null
  taskType: string | null
  duplicateSuppressed: boolean
  interrupted: boolean
  /**
   * Robot language context (Robot consolidation): the dominant language of
   * THIS user turn ('ar' | 'en'), mixed-flag included. The session's
   * authoritative language follows confident, non-mixed turns so response
   * copy and TTS track the conversation instead of the UI locale alone.
   */
  language?: { detected: 'ar' | 'en'; mixed: boolean; session: 'ar-EG' | 'en-US' }
  telemetry: VoiceTurnTelemetry
  error: { code: VoiceErrorCode; message: string } | null
}

export const VOICE_ERROR_CODES = [
  'VOICE_SESSION_INVALID',
  'VOICE_SESSION_EXPIRED',
  'VOICE_STATE_TRANSITION_INVALID',
  'VOICE_TRANSCRIPT_EMPTY',
  'VOICE_TRANSCRIPT_TOO_LONG',
  'VOICE_TRANSCRIPT_UNSAFE',
  'VOICE_TRANSCRIPT_PARTIAL',
  'VOICE_DUPLICATE_SUPPRESSED',
  'VOICE_ENTITY_AMBIGUOUS',
  'VOICE_ENTITY_NOT_FOUND',
  'VOICE_AGENT_ERROR',
  'VOICE_DEPENDENCY_ERROR',
  'VOICE_RATE_LIMITED',
  'VOICE_OP_INVALID',
] as const
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[number]

// ---------------------------------------------------------------------------
// PHI-minimized telemetry (§22) — no raw audio, no full transcripts
// ---------------------------------------------------------------------------

export interface VoiceTurnTelemetry {
  voiceSessionId: string
  locale: VoiceLocale
  turnIndex: number
  /** Normalized transcript length + fingerprint (SHA-256, first 16 hex). */
  transcriptChars: number
  transcriptFingerprint: string
  language: TranscriptLanguage
  sttProviderId: string
  sttConfidence: number
  normalizeMs: number
  entityResolutionMs: number
  agentMs: number
  totalMs: number
  interruptionCount: number
  duplicateSuppressed: boolean
  state: InteractionState
  agentStatus: string | null
  approvalRequired: boolean
  error: VoiceErrorCode | null
  /** Performance environment label (§43) — never hardware claims. */
  env: 'SANDBOX' | 'TARGET_MACHINE' | 'CI'
  /** Turn-taking diagnostics (§5/§6/§20). */
  turnPhase?: 'LISTENING' | 'POSSIBLE_END' | 'CONFIRMED_END' | 'PROCESSING' | 'RESPONDING'
  turnCompletionReason?: 'FINAL_COMPLETE' | 'COMBINED' | 'PARTIAL_BUFFERED' | 'HELD_INCOMPLETE' | 'FORCED_AFTER_MAX_HOLDS' | 'BARGE_IN' | null
  /** Characters currently held in the partial/fragment buffer. */
  bufferedChars?: number
  /** True when this turn BARGE-INTO active speech (user speech during TTS). */
  bargeIn?: boolean
  /**
   * Failure-layer attribution (§14): WHERE the turn degraded — answers
   * "did the robot misunderstand me, or did ASR misunderstand me?".
   * TTS failures are client-side (browser synthesis) and surface as
   * STT_/TTS_ UI errors, not server telemetry — the server cannot
   * observe them, and none are fabricated.
   */
  failureLayer?: 'NONE' | 'ASR_FAILURE' | 'TURN_DETECTION_FAILURE' | 'ENTITY_RESOLUTION_FAILURE' | 'AGENT_REASONING_FAILURE' | 'TOOL_FAILURE' | 'TTS_FAILURE'
}

// ---------------------------------------------------------------------------
// Provider registry (§40) — ONE canonical registry for STT + TTS
// ---------------------------------------------------------------------------

export const VOICE_PROVIDER_TYPES = ['STT', 'TTS'] as const
export type VoiceProviderType = (typeof VOICE_PROVIDER_TYPES)[number]

/** Same evidence vocabulary as the Phase 8 engine registry (never collapsed). */
export const VOICE_PROVIDER_STATUSES = [
  'DISCOVERED',
  'ARTIFACT_VERIFIED',
  'RUNTIME_VERIFIED',
  'REAL_INFERENCE_VERIFIED',
  'UNAVAILABLE',
  'BLOCKED',
] as const
export type VoiceProviderStatus = (typeof VOICE_PROVIDER_STATUSES)[number]

export const VOICE_PRIVACY_MODES = ['LOCAL_ONLY', 'BROWSER_RUNTIME', 'EXTERNAL_TRANSPORT'] as const
export type VoicePrivacyMode = (typeof VOICE_PRIVACY_MODES)[number]

export interface VoiceProviderRegistryEntry {
  providerId: string
  type: VoiceProviderType
  engine: string
  version: string
  localeSupport: string[]
  runtime: string
  device: 'cpu' | 'browser'
  status: VoiceProviderStatus
  /** Artifact identity (wheel/tarball/voice data) — or named absence. */
  artifact: string
  sha256: string | null
  provenance: string
  resourceRequirements: { ramMb: number | null; note: string }
  latencyEvidence: { decodeMs: number | null; env: string; ref: string }
  privacyMode: VoicePrivacyMode
  offlineCapable: boolean
  /** VERIFIED / RUNTIME_DEPENDENT / BLOCKED / UNAVAILABLE (honest). */
  verificationStatus: string
  limitations: string[]
}

/**
 * Phase 10 — voice security (§15/§18/§42).
 *
 * Fail-closed checks for the voice boundary. The agent below this layer
 * already treats message text as untrusted DATA (Phase 3); these guards
 * stop voice-SPECIFIC attacks before the agent is ever involved:
 *
 *  - transcript hygiene (control chars, bidi spoofing, oversize, partials)
 *  - duplicate-action protection (fingerprint + window, §17)
 *  - confirmation binding (§15): a CONFIRM phrase is only valid when a
 *    single pending approval is bound to THIS session, the phrase is
 *    explicit, and the utterance is fresh. Background speech, another
 *    person, TTS echo, partial transcripts, or a stale session can never
 *    confirm. Sensitive actions additionally keep the Phase 1 approval
 *    ledger (role-separated human decision) — voice never bypasses it.
 *  - session confusion / cross-tenant / cross-patient: the store rejects
 *    mismatched bindings (fail closed) and patient scope is only ever set
 *    from server-verified resolution results.
 */

import { createHash } from 'node:crypto'
import path from 'node:path'
import { matchControlPhrase } from './entity-resolution'
import { normalizeTranscript, sanitizeTranscript } from './normalize'
import {
  VOICE_CONFIRM_WINDOW_MS,
  VOICE_DUPLICATE_WINDOW_MS,
  type InteractionState,
  type VoiceSession,
  type VoiceTranscript,
} from './types'

// ---------------------------------------------------------------------------
// Transcript hygiene
// ---------------------------------------------------------------------------

export interface TranscriptSafetyResult {
  ok: boolean
  code:
    | 'VOICE_TRANSCRIPT_EMPTY'
    | 'VOICE_TRANSCRIPT_TOO_LONG'
    | 'VOICE_TRANSCRIPT_UNSAFE'
    | 'VOICE_TRANSCRIPT_PARTIAL'
    | null
  normalized: string
  language: ReturnType<typeof normalizeTranscript>['language']
}

/**
 * Full typed validation of an incoming STT transcript. Partials are rejected
 * for action purposes (streaming may DISPLAY them; §37 they never trigger).
 */
export function validateTranscriptSafety(t: VoiceTranscript): TranscriptSafetyResult {
  if (!t || typeof t.text !== 'string') {
    return { ok: false, code: 'VOICE_TRANSCRIPT_UNSAFE', normalized: '', language: 'en' }
  }
  if (!t.isFinal) {
    return { ok: false, code: 'VOICE_TRANSCRIPT_PARTIAL', normalized: '', language: 'en' }
  }
  const sanitized = sanitizeTranscript(t.text)
  if (!sanitized.ok) {
    return { ok: false, code: sanitized.code, normalized: '', language: 'en' }
  }
  const n = normalizeTranscript(sanitized.text)
  return { ok: true, code: null, normalized: n.normalized, language: n.language }
}

// ---------------------------------------------------------------------------
// Duplicate-action protection (§17)
// ---------------------------------------------------------------------------

export interface DuplicateWindowEntry {
  fingerprint: string
  atMs: number
  ledToAction: boolean
}

export function transcriptFingerprint(normalizedTranscript: string, tenantId: string, userId: string): string {
  return createHash('sha256').update(`${tenantId}:${userId}:${normalizedTranscript}`).digest('hex').slice(0, 16)
}

export interface DuplicateVerdict {
  duplicate: boolean
  fingerprint: string
}

/**
 * A normalized transcript identical to a RECENT action-leading utterance
 * inside the duplicate window is suppressed (STT repeat / double-tap).
 * Pure informational repeats are allowed (the agent is read-only for them)
 * but still fingerprinted.
 */
export function assessDuplicate(
  normalized: string,
  tenantId: string,
  userId: string,
  history: DuplicateWindowEntry[],
  nowMs: number,
): DuplicateVerdict {
  const fp = transcriptFingerprint(normalized, tenantId, userId)
  const recent = history.find(
    (h) => h.fingerprint === fp && nowMs - h.atMs <= VOICE_DUPLICATE_WINDOW_MS && h.ledToAction,
  )
  return { duplicate: Boolean(recent), fingerprint: fp }
}

// ---------------------------------------------------------------------------
// Confirmation binding (§15) — explicit, fresh, session-local
// ---------------------------------------------------------------------------

export interface ConfirmationVerdict {
  /** The utterance contained an explicit confirmation phrase. */
  phrasePresent: boolean
  /** AND: a single pending approval is bound to this session, unexpired. */
  boundToPendingApproval: boolean
  valid: boolean
  reason: string | null
}

export function assessVoiceConfirmation(
  normalized: string,
  session: VoiceSession,
  nowMs: number,
): ConfirmationVerdict {
  const phrasePresent = matchControlPhrase(normalized) === 'CONFIRM'
  const bound =
    session.state === ('WAITING_APPROVAL' as InteractionState) &&
    typeof session.pendingApprovalId === 'string' &&
    session.pendingApprovalId.length > 0 &&
    session.pendingApprovalExpiresAt !== null &&
    new Date(session.pendingApprovalExpiresAt).getTime() >= nowMs &&
    nowMs - new Date(session.lastActivityAt).getTime() <= VOICE_CONFIRM_WINDOW_MS * 6
  if (phrasePresent && bound) {
    return { phrasePresent, boundToPendingApproval: true, valid: true, reason: null }
  }
  if (phrasePresent && !bound) {
    return {
      phrasePresent,
      boundToPendingApproval: false,
      valid: false,
      reason: 'CONFIRM_WITHOUT_PENDING_APPROVAL',
    }
  }
  return { phrasePresent: false, boundToPendingApproval: bound, valid: false, reason: null }
}

// ---------------------------------------------------------------------------
// Local-audio boundary checks (CommandSttProvider; §42 malformed audio)
// ---------------------------------------------------------------------------

export const ALLOWED_AUDIO_EXTENSIONS = ['.wav', '.wave'] as const
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

export interface AudioFileSafetyResult {
  ok: boolean
  code: 'AUDIO_TOO_LARGE' | 'AUDIO_BAD_EXTENSION' | 'AUDIO_PATH_ESCAPES' | null
}

/**
 * Validate an audio file path for the OPTIONAL local engine command boundary.
 * The path must be a plain file inside the provided base directory (no
 * traversal), with an allowed extension, under the size cap. The server API
 * never accepts audio — this protects the opt-in local provider only.
 */
export function validateAudioFileSafety(audioPath: string, baseDir: string, sizeBytes: number): AudioFileSafetyResult {
  const resolvedBase = path.resolve(baseDir)
  const resolved = path.resolve(audioPath)
  if (!resolved.startsWith(resolvedBase + path.sep)) {
    return { ok: false, code: 'AUDIO_PATH_ESCAPES' }
  }
  const ext = path.extname(resolved).toLowerCase()
  if (!(ALLOWED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, code: 'AUDIO_BAD_EXTENSION' }
  }
  if (sizeBytes > MAX_AUDIO_BYTES) {
    return { ok: false, code: 'AUDIO_TOO_LARGE' }
  }
  return { ok: true, code: null }
}

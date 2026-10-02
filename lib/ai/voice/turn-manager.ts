/**
 * Phase 10/11 — TURN MANAGER (first-class turn-taking, §5/§6).
 *
 * The turn lifecycle is DISTINCT from the interaction state machine: it
 * tracks whether the USER's utterance is complete, not what the system is
 * doing. Deterministic and bounded — no timers, no VAD inside the server
 * (raw audio never reaches the API, §41); the turn decision uses the ASR's
 * finality flag plus a LINGUISTIC end-of-turn assessment of the words
 * themselves:
 *
 *   LISTENING      — no live utterance (or only buffered partials so far)
 *   POSSIBLE_END   — the ASR finalized, but the text ends mid-thought
 *                    (trailing dependency word / ellipsis): HOLD, never act
 *   CONFIRMED_END  — a final fragment that can legally end a request
 *   PROCESSING     — the combined turn is handed to the agent
 *   RESPONDING     — the agent answered; TTS may be speaking
 *
 * Incomplete fragments ACCUMULATE in the session-scoped buffer and are
 * combined into ONE turn when a complete fragment arrives. Holds are
 * bounded (VOICE_TURN_MAX_HOLDS) — after the bound the buffered content is
 * processed anyway (a robot that waits forever is also broken, §24).
 *
 * This is intentionally NOT a phrase dictionary: the trailing-word check is
 * a closed class of FUNCTION words (conjunctions/prepositions/relative and
 * possessive scaffolding) that grammatically cannot terminate a request in
 * Egyptian Arabic or English. Content words never trigger a hold.
 */

import type { VoiceTranscript } from './types'

// ---------------------------------------------------------------------------
// Turn lifecycle (§6)
// ---------------------------------------------------------------------------

export const TURN_PHASES = [
  'LISTENING',
  'POSSIBLE_END',
  'CONFIRMED_END',
  'PROCESSING',
  'RESPONDING',
] as const
export type TurnPhase = (typeof TURN_PHASES)[number]

/** Why the turn reached the agent (or did not) — telemetry, §20. */
export type TurnCompletionReason =
  | 'FINAL_COMPLETE'          // a single complete final fragment
  | 'COMBINED'                // buffered fragment(s) + a complete fragment → ONE turn
  | 'PARTIAL_BUFFERED'        // interim transcript buffered (never acted on)
  | 'HELD_INCOMPLETE'         // final fragment held: ends mid-thought
  | 'FORCED_AFTER_MAX_HOLDS'  // hold bound reached — process the buffer
  | 'BARGE_IN'                // user speech while the robot was speaking
  | null

/** Max consecutive holds before the buffered content is processed anyway. */
export const VOICE_TURN_MAX_HOLDS = 3
/** Max buffered characters across combined fragments (bounded history). */
export const VOICE_TURN_BUFFER_MAX_CHARS = 600

/** Session-scoped turn state (additive to the interaction session). */
export interface VoiceTurnState {
  phase: TurnPhase
  /** Incomplete fragments accumulated so far (combined on CONFIRMED_END). */
  bufferedTranscript: string | null
  /** Holds consumed for the current buffer (bounded). */
  holds: number
  /** Why the last dispatched turn fired (telemetry/observability). */
  lastCompletionReason: TurnCompletionReason
  /**
   * How many TRAILING characters of the buffer came from the LATEST interim
   * (the provider keeps revising it): a new interim REPLACES them instead of
   * accumulating the same words repeatedly.
   */
  partialChars?: number
}

export function initialTurnState(): VoiceTurnState {
  return { phase: 'LISTENING', bufferedTranscript: null, holds: 0, lastCompletionReason: null, partialChars: 0 }
}

/**
 * Merge an ASR INTERIM into the buffer: the interim REPLACES the previous
 * interim-sourced suffix (same utterance, revised text), never duplicates it.
 */
export function mergePartial(buffered: string | null, partialChars: number, interim: string): { text: string; partialChars: number } {
  const base = buffered ? buffered.slice(0, Math.max(0, buffered.length - Math.max(0, partialChars))) : ''
  const text = combineBuffer(base || null, interim)
  return { text, partialChars: interim.length }
}

// ---------------------------------------------------------------------------
// End-of-turn assessment (deterministic, no timers)
// ---------------------------------------------------------------------------

/**
 * Trailing FUNCTION words that cannot legally END a request: the utterance
 * stops mid-dependency ('وريني مواعيد المريض اللي…', 'مواعيد محمد بتاع…',
 * '…بكرة و'). A closed grammatical class — never a content-word list.
 * Stored WITHOUT diacritics, letters folded (matching the normalized form).
 */
const TRAILING_DEPENDENCY_WORDS = new Set([
  // relative / identity clauses
  'اللي', 'الذي', 'التي', 'الذى', 'اسمه', 'اسمها', 'الاسم', 'اسم',
  // possessive + connectors
  'بتاع', 'بتاعه', 'بتاعها', 'بتاعهم', 'بتاعتها', 'بتاعته', 'بتاعي', 'بتاعت',
  'و', 'يا', 'أو', 'او', 'ثم', 'بس',
  // prepositions that demand a complement ('على/علي' deliberately EXCLUDED:
  // normalization folds ى→ي so the preposition collides with the common
  // NAME علي — a missed hold on a preposition is far less harmful than
  // holding every Ali-ending name)
  'في', 'فى', 'من', 'عن', 'مع', 'ل', 'لى', 'الي', 'إلى', 'ال',
  'for', 'with', 'of', 'to', 'and', 'his', 'her', 'their', 'my',
])

/** Strip normalized-Arabic punctuation; keep letters/digits/spaces. */
function coreOf(normalized: string): string {
  return normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export interface TurnCompletionAssessment {
  complete: boolean
  /** Why (telemetry + tests). */
  detail: 'TERMINAL_PUNCTUATION' | 'LAST_WORD_CONTENT' | 'TRAILING_DEPENDENCY_WORD' | 'TRAILING_ELLIPSIS' | 'EMPTY'
}

/**
 * Assess whether a NORMALIZED final fragment can legally end a request.
 * Explicit sentence punctuation (؟ ? ! . ،) ⇒ complete. A trailing
 * dependency word or ellipsis ⇒ INCOMPLETE (hold, combine with what comes
 * next). Content words ⇒ complete.
 */
export function assessTurnCompletion(normalizedFragment: string): TurnCompletionAssessment {
  const raw = normalizedFragment.trim()
  if (!raw) return { complete: false, detail: 'EMPTY' }
  if (/\.\.\.|…|—\s*$|-{2,}\s*$/.test(raw)) return { complete: false, detail: 'TRAILING_ELLIPSIS' }
  if (/[؟?!.،,]$/.test(raw)) return { complete: true, detail: 'TERMINAL_PUNCTUATION' }
  const core = coreOf(raw)
  if (!core) return { complete: false, detail: 'EMPTY' }
  const last = core.split(' ').slice(-1)[0]!.toLowerCase()
  if (TRAILING_DEPENDENCY_WORDS.has(last)) return { complete: false, detail: 'TRAILING_DEPENDENCY_WORD' }
  return { complete: true, detail: 'LAST_WORD_CONTENT' }
}

// ---------------------------------------------------------------------------
// Buffer lifecycle
// ---------------------------------------------------------------------------

/** Combine a buffered fragment with the next fragment (bounded). */
export function combineBuffer(buffered: string | null, next: string): string {
  const merged = buffered ? `${buffered} ${next.trim()}` : next.trim()
  // Bound the buffer: drop the OLDEST characters beyond the cap (recent
  // speech matters most; the fragment never grows without limit).
  return merged.length > VOICE_TURN_BUFFER_MAX_CHARS
    ? merged.slice(merged.length - VOICE_TURN_BUFFER_MAX_CHARS)
    : merged
}

/** The turn text to dispatch: buffer + current fragment, or the fragment alone. */
export function turnTextFor(buffered: string | null, fragment: string): string {
  return combineBuffer(buffered, fragment)
}

/** True when the transcript is an ASR interim (provider has not finalized). */
export function isPartialTranscript(t: VoiceTranscript | undefined | null): boolean {
  return !!t && t.isFinal === false
}

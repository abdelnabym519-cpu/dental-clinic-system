/**
 * Voice/text language policy for the Robot (Phase: Robot consolidation).
 *
 * The response language must follow the ACTUAL conversation, not blindly the
 * browser/UI locale:
 *   Arabic input  → Arabic understanding → Arabic response → Arabic TTS
 *   English input → English understanding → English response → English TTS
 *   Mixed input   → dominant conversational language decides (no forced
 *                    conversion in either direction)
 *
 * Detection is script-based (deterministic, offline, CPU-free by design):
 * Arabic-script character ratio vs Latin ratio. A turn is "mixed" when both
 * scripts are materially present; in a mixed turn the session's current
 * language stays authoritative (no flip-flopping on one borrowed English
 * word inside an Arabic sentence).
 */

export type VoiceLang = 'ar' | 'en'

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const ARABIC_GLOBAL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g
const LATIN_RE = /[A-Za-z]/

export interface LanguageDetection {
  /** Dominant language of the input. */
  lang: VoiceLang
  /** True when both scripts are materially present (mixed input). */
  mixed: boolean
}

/** Count of Arabic-script characters in the text. */
function arabicChars(text: string): number {
  return (text.match(ARABIC_GLOBAL_RE) ?? []).length
}

/** Count of Latin characters in the text. */
function latinChars(text: string): number {
  let n = 0
  for (const ch of text) if (LATIN_RE.test(ch)) n++
  return n
}

/**
 * Detect the language of one user turn. Letters only are compared, so
 * numbers/emoji/punctuation never skew the decision. If neither script is
 * present (e.g. pure numbers), the language is undecidable → treat as
 * non-mixed English ('en') and let the session language stay authoritative
 * (callers must not flip the session on this).
 */
export function detectInputLanguage(text: string): LanguageDetection {
  const ar = arabicChars(text)
  const la = latinChars(text)
  if (ar === 0 && la === 0) return { lang: 'en', mixed: false }
  const arRatio = ar / (ar + la)
  const mixed = arRatio >= 0.15 && arRatio <= 0.85
  // Dominance is WORD-level: the sentence skeleton decides. Borrowed English
  // terms inside an Arabic sentence ('افتح patient record بتاع أحمد' — 3
  // Arabic words, 2 English) keep Arabic in charge, and vice versa.
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((w) => /\p{L}/u.test(w))
  let arWords = 0
  let laWords = 0
  for (const w of words) {
    if (ARABIC_RE.test(w)) arWords++
    else laWords++
  }
  const lang: VoiceLang = arWords >= laWords && arWords > 0 ? 'ar' : 'en'
  return { lang, mixed }
}

/**
 * TTS voice selection for a piece of RESPONSE text: the voice must match the
 * language actually being spoken. Any Arabic script → ar-EG; otherwise en-US.
 * (NOT word-level dominance: Arabic answers embed untranslated Latin data
 * tokens — names, IDs, dates — which must not flip the voice to English.)
 */
export function ttsLangForText(text: string): 'ar-EG' | 'en-US' {
  // Word-level dominance is wrong for ANSWER text: Arabic answers embed
  // untranslated Latin data tokens (patient names, treatment IDs, dates),
  // which can numerically out-vote the Arabic sentence skeleton. An Arabic
  // sentence must be spoken by the Arabic voice regardless of its embedded
  // data tokens — any Arabic script means Arabic content.
  return arabicChars(text ?? '') > 0 ? 'ar-EG' : 'en-US'
}

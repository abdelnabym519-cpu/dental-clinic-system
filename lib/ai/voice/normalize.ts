/**
 * Phase 10 — transcript normalization + trust boundaries (§9/§11).
 *
 * STT output is UNTRUSTED. This module performs deterministic, meaning-
 * preserving normalization only:
 *  - Unicode NFC, tashkeel/diacritics removal, tatweel removal
 *  - alef/ya/hamza carrier folding (conservative, standard forms)
 *  - Arabic-Indic + extended digits → ASCII
 *  - zero-width / bidi control stripping (spoofing + injection hygiene)
 *  - hard length cap
 *
 * It NEVER invents words and never changes numbers semantically: digit
 * folding maps ١٢٣ → 123 (same value). Tooth-number interpretation and its
 * 36/63 ambiguity live in entity-resolution.ts — never silently guessed.
 */

import { VOICE_TRANSCRIPT_MAX_CHARS, type NormalizedTranscript, type TranscriptLanguage } from './types'

export { VOICE_TRANSCRIPT_MAX_CHARS }

const ARABIC_INDIC: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

/** Tashkeel + Quranic annotation + tatweel. */
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g
/** Zero-width and bidi controls (CVE-2021-42574 class) — stripped. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

const ARABIC_CHAR = /[\u0600-\u06FF\u0750-\u077F]/
const LATIN_CHAR = /[A-Za-z]/

export interface SanitizeResult {
  ok: boolean
  code: 'VOICE_TRANSCRIPT_EMPTY' | 'VOICE_TRANSCRIPT_TOO_LONG' | 'VOICE_TRANSCRIPT_UNSAFE' | null
  text: string
}

/**
 * Strip invisible/bidi controls and control characters. Returns a typed
 * rejection for empty / oversized input. Never "fixes" content silently.
 */
export function sanitizeTranscript(raw: string): SanitizeResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'VOICE_TRANSCRIPT_UNSAFE', text: '' }
  }
  const stripped = raw.normalize('NFC').replace(INVISIBLE, '')
  // eslint-disable-next-line no-control-regex
  // eslint-disable-next-line no-control-regex
  const noControls = stripped.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
  const text = noControls.replace(/[ \t]+/g, ' ').trim()
  if (!text) return { ok: false, code: 'VOICE_TRANSCRIPT_EMPTY', text: '' }
  if (text.length > VOICE_TRANSCRIPT_MAX_CHARS) {
    return { ok: false, code: 'VOICE_TRANSCRIPT_TOO_LONG', text: '' }
  }
  return { ok: true, code: null, text }
}

/**
 * The text the AGENT receives: sanitize + Arabic-Indic digit folding ONLY.
 * Letter folding / lowercasing are deliberately NOT applied — the agent's
 * own Arabic classifier and tools are tuned for natural text (proven by the
 * Phase 7 goldens); entity normalization below is for RESOLUTION only.
 */
export function prepareAgentMessage(raw: string): string {
  const sanitized = sanitizeTranscript(raw)
  if (!sanitized.ok) return ''
  return sanitized.text.replace(/[۰-۹٠-٩]/g, (d) => ARABIC_INDIC[d] ?? d)
}

/**
 * Deterministic normalization: NFC, mark stripping, conservative Arabic
 * letter folding, digit folding. Case-folded for Latin (match-only; the
 * original text is preserved for the agent).
 */
export function normalizeTranscript(raw: string): NormalizedTranscript {
  const sanitized = sanitizeTranscript(raw)
  const original = sanitized.text
  let digitFoldCount = 0
  let out = original.replace(ARABIC_MARKS, '')
  out = out.replace(/[۰-۹٠-٩]/g, (d) => {
    digitFoldCount += 1
    return ARABIC_INDIC[d] ?? d
  })
  // Conservative hamza-carrier folding (standard Arabic normalization).
  out = out
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
  out = out.toLowerCase()
  return {
    original,
    normalized: out.replace(/\s+/g, ' ').trim(),
    language: detectTranscriptLanguage(original),
    charCount: original.length,
    digitFoldCount,
  }
}

export function detectTranscriptLanguage(text: string): TranscriptLanguage {
  let ar = 0
  let en = 0
  for (const ch of text) {
    if (ARABIC_CHAR.test(ch)) ar += 1
    else if (LATIN_CHAR.test(ch)) en += 1
  }
  if (ar > 0 && en > 0) return 'mixed'
  if (ar > 0) return 'ar'
  return 'en'
}

// ---------------------------------------------------------------------------
// Spoken tooth numbers — bounded, explicit tables (no open-ended NLU here)
// ---------------------------------------------------------------------------

/** English spoken tooth numbers 11..48 as technicians actually say them. */
const EN_SPOKEN_NUMBERS: Record<string, number> = {
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18,
  'twenty one': 21, 'twenty two': 22, 'twenty three': 23, 'twenty four': 24,
  'twenty five': 25, 'twenty six': 26, 'twenty seven': 27, 'twenty eight': 28,
  'thirty one': 31, 'thirty two': 32, 'thirty three': 33, 'thirty four': 34,
  'thirty five': 35, 'thirty six': 36, 'thirty seven': 37, 'thirty eight': 38,
  'forty one': 41, 'forty two': 42, 'forty three': 43, 'forty four': 44,
  'forty five': 45, 'forty six': 46, 'forty seven': 47, 'forty eight': 48,
}

/** Arabic spoken tooth numbers (Egyptian-clinic phrasing, normalized letters). */
// NOTE: keys are in NORMALIZED letter form (ة→ه, أ→ا) — the extractor runs
// against normalized transcripts.
const AR_SPOKEN_NUMBERS: Record<string, number> = {
  'احد عشر': 11, 'اثنا عشر': 12, 'ثنا عشر': 12, 'تلاته عشر': 13, 'ثلاثه عشر': 13,
  'اربعه عشر': 14, 'اربعتاشر': 14, 'خمسه عشر': 15, 'خمستاشر': 15,
  'سته عشر': 16, 'ستاشر': 16, 'سبعه عشر': 17, 'سبعتاشر': 17,
  'تمانيه عشر': 18, 'تمنتاشر': 18,
  'واحد وعشرين': 21, 'تنين وعشرين': 22, 'اتنين وعشرين': 22,
  'تلاتة وعشرين': 23, 'ثلاثه وعشرين': 23, 'اربعه وعشرين': 24, 'اربعتين وعشرين': 24,
  'خمسه وعشرين': 25, 'سته وعشرين': 26, 'سبعه وعشرين': 27, 'تمانيه وعشرين': 28,
  'واحد وتلاتين': 31, 'واحد وثلاثين': 31, 'تنين وتلاتين': 32, 'اتنين وثلاثين': 32,
  'تلاتة وتلاتين': 33, 'ثلاثه وثلاثين': 33, 'اربعه وتلاتين': 34, 'اربعه وثلاثين': 34,
  'خمسه وتلاتين': 35, 'خمسه وثلاثين': 35, 'سته وتلاتين': 36, 'سته وثلاثين': 36,
  'سبعه وتلاتين': 37, 'سبعه وثلاثين': 37, 'تمانيه وتلاتين': 38, 'تمانيه وثلاثين': 38,
  'واحد واربعين': 41, 'تنين واربعين': 42, 'اتنين واربعين': 42, 'تلاتة واربعين': 43,
  'ثلاثة واربعين': 43, 'اربعة واربعين': 44, 'خمسة واربعين': 45, 'ستة واربعين': 46,
  'سبعة واربعين': 47, 'تمانية واربعين': 48,
}

/** Words that mark a number as a tooth reference (dental context). */
const TOOTH_CONTEXT_WORDS = [
  // EN
  'tooth', 'teeth', 'molar', 'incisor', 'canine', 'premolar',
  // AR (normalized forms)
  'سن', 'السن', 'أسنان', 'اسنان', 'ضرس', 'الضرس', 'ضرسية',
]

export interface SpokenToothHit {
  fdi: number
  /** The literal substring that produced the hit (observability only). */
  matched: string
  kind: 'digit' | 'spoken-en' | 'spoken-ar'
  dentalContext: boolean
}

/**
 * Extract candidate tooth references from a NORMALIZED transcript.
 * Digits are reported verbatim — FDI validation + 36/63 disambiguation are
 * the resolver's job (never here). Spoken-word tables are bounded.
 */
export function extractToothCandidates(normalized: string): SpokenToothHit[] {
  const hits: SpokenToothHit[] = []
  const words = normalized.split(/\s+/)
  const hasToothContext = TOOTH_CONTEXT_WORDS.some((w) => normalized.includes(w))

  // Digit tokens (also "36," handled by split; also digit-pairs inside words
  // like "سن36" are matched via the global regex below).
  const digitRe = /\d{1,4}/g
  let m: RegExpExecArray | null
  while ((m = digitRe.exec(normalized)) !== null) {
    hits.push({
      fdi: Number(m[0]),
      matched: m[0],
      kind: 'digit',
      dentalContext: hasToothContext,
    })
  }

  // Bounded spoken tables — longest match first to avoid partial overlap.
  for (const [table, kind] of [
    [AR_SPOKEN_NUMBERS, 'spoken-ar'],
    [EN_SPOKEN_NUMBERS, 'spoken-en'],
  ] as const) {
    const keys = Object.keys(table).sort((a, b) => b.length - a.length)
    for (const k of keys) {
      if (words.includes(k) || normalized.includes(` ${k} `) || normalized === k || normalized.startsWith(`${k} `) || normalized.endsWith(` ${k}`)) {
        hits.push({ fdi: table[k]!, matched: k, kind, dentalContext: hasToothContext })
        break
      }
    }
  }
  return hits
}

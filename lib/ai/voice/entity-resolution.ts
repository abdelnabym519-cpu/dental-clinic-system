/**
 * Phase 10 — dental entity resolution over the EXISTING graph (§5/§10).
 *
 * Voice utterances resolve through: Patient → Case → Graph → Agent. There is
 * no separate voice database. Ambiguity is NEVER guessed: ambiguous patients
 * or tooth numbers produce an explicit clarification question (bilingual),
 * e.g. "تقصد السن 36 ولا 63؟".
 *
 * All patient lookups are tenant-scoped through the caller's Prisma client
 * (the same DB the agent uses) and only ever return id + display name.
 */

import { isValidFdi } from '@/lib/ai/context/fdi'
import { latinFormsFor } from '@/lib/ai/entity/name-matching'
import {
  extractToothCandidates,
  normalizeTranscript,
  type SanitizeResult,
  sanitizeTranscript,
} from './normalize'
import type {
  ControlPhraseKind,
  PatientResolutionResult,
  ToothResolution,
  VoiceClarification,
} from './types'

// ---------------------------------------------------------------------------
// Control phrases — interruption / cancellation / confirmation lexicon (§16)
// ---------------------------------------------------------------------------

const INTERRUPT_PATTERNS = [
  // EN
  'stop', 'wait', 'hold on', 'enough', 'quiet', 'cancel',
  // AR (normalized: alef folded, tashkeel stripped)
  'اسكت', 'استني', 'استنى', 'كفايه', 'قف', 'الغي', 'بردو لا',
]

const CONFIRM_PATTERNS = [
  // EN — explicit verbs ONLY ("yes" alone is NOT a confirmation, §15)
  'confirm', 'confirmed', 'yes confirm', 'i confirm', 'please confirm', 'do it', 'send it',
  // AR — explicit confirmation verbs
  'اكد', 'اتاكد', 'تاكيد', 'نعم اكد', 'ايوه اكد', 'ايوا اكد', 'موافق', 'انا موافق', 'ابعتها', 'ابعت',
]

const CANCEL_PATTERNS = [
  'cancel that', 'forget it', 'never mind', 'cancel request',
  'الغاء', 'الغي ده', 'منساش', 'سيبها', 'خلاص مانساش', 'خلاص سيبها',
]

function matchesAny(normalized: string, patterns: string[]): boolean {
  const words = ` ${normalized} `
  return patterns.some((p) => words.includes(` ${p} `) || normalized === p || words.includes(` ${p}.`) || words.includes(` ${p}?`))
}

/**
 * Classify a normalized transcript as an interaction control phrase.
 * Interruption/cancellation are recognized BEFORE the agent is ever called.
 * CONFIRM here is only a candidate — real confirmation binding is enforced
 * in security.ts (session state + freshness + single pending approval).
 */
/**
 * The content AFTER a leading control phrase, when the utterance is an
 * INTERRUPTION WITH CONTENT ('استنى، قصدي الأسبوع ده' → 'قصدي الأسبوع ده').
 * Deterministic: the utterance must START with a control word (punctuation
 * between the word and the rest is tolerated — 'استنى، …'), the leading
 * control words + connectors are stripped, and a non-empty remainder means
 * the doctor SAID something after the stop — capture it as the real turn.
 * A pure control utterance returns null (bare stop → ack path).
 */
export function remainderAfterControlPhrase(normalizedText: string): string | null {
  const strip = new Set([...INTERRUPT_PATTERNS, ...CANCEL_PATTERNS, 'يا'])
  const clean = (w: string) => w.replace(/[،,.:;!?؟]+/g, '')
  let words = normalizedText.trim().split(/\s+/).filter(Boolean)
  // first word (punctuation-stripped) must be a control word
  if (!words.length || !strip.has(clean(words[0]!))) return null
  let anyRemoved = false
  while (words.length) {
    const c = clean(words[0]!)
    if (strip.has(c)) {
      anyRemoved = true
      words = words.slice(1)
      continue
    }
    break
  }
  // drop separators glued to the control words
  words = words.map((w) => w.replace(/^[،,]+\s*/, ''))
  const remainder = words.join(' ').trim()
  return anyRemoved && remainder ? remainder : null
}

export function matchControlPhrase(text: string): ControlPhraseKind {
  // Normalize defensively so callers may pass raw STT text (hamza/ى folding
  // must not hide control words like أسكت / أكد).
  const normalized = normalizeTranscript(text).normalized
  if (matchesAny(normalized, CONFIRM_PATTERNS)) return 'CONFIRM'
  if (matchesAny(normalized, CANCEL_PATTERNS)) return 'CANCEL'
  if (matchesAny(normalized, INTERRUPT_PATTERNS)) return 'INTERRUPT'
  return null
}

// ---------------------------------------------------------------------------
// Tooth resolution — FDI via the EXISTING parser (§11), 36↔63 disambiguation
// ---------------------------------------------------------------------------

/**
 * Resolve tooth references from a transcript.
 *
 * STT digit errors ("36" heard as "63") are the classic dental failure: a
 * non-FDI number whose digit-reversal IS valid (63→36, 24→42) is reported
 * AMBIGUOUS with both candidates — the pipeline asks instead of guessing.
 * A number that is valid FDI stays a single candidate (still confirmed
 * implicitly by the agent's own clarification path for clinical actions).
 */
export function resolveToothReference(rawTranscript: string): ToothResolution {
  const n = normalizeTranscript(rawTranscript)
  const hits = extractToothCandidates(n.normalized)
  const digitHits = hits.filter((h) => h.kind === 'digit')
  const spokenHits = hits.filter((h) => h.kind !== 'digit')

  const candidates: number[] = []
  const push = (fdi: number) => {
    if (!candidates.includes(fdi)) candidates.push(fdi)
  }

  for (const h of digitHits) {
    if (isValidFdi(h.fdi)) push(h.fdi)
  }
  for (const h of spokenHits) {
    if (isValidFdi(h.fdi)) push(h.fdi)
  }

  if (candidates.length === 1) {
    return { status: 'RESOLVED', fdi: candidates[0]!, candidates }
  }
  if (candidates.length === 0) {
    // Reversal rescue: one non-FDI number whose reversal is valid FDI.
    const reversals = new Set<number>()
    for (const h of digitHits) {
      const rev = Number(String(h.fdi).split('').reverse().join(''))
      if (isValidFdi(rev)) reversals.add(rev)
    }
    if (reversals.size >= 1) {
      const list = [...reversals]
      return { status: 'AMBIGUOUS', fdi: null, candidates: list }
    }
    return { status: 'NOT_FOUND', fdi: null, candidates: [] }
  }
  return { status: 'AMBIGUOUS', fdi: null, candidates }
}

export function toothClarification(res: ToothResolution): VoiceClarification {
  // A single reversal rescue (e.g. "63" heard, only 36 valid) still asks:
  // the classic 36/63 STT confusion is resolved by CONFIRMATION, not a guess.
  const display = [...res.candidates]
  if (display.length === 1) {
    // Offer the heard form too (it is by definition non-FDI — that is why we
    // are asking): "63" heard → candidate 36 → question offers 36 or 63.
    const rev = Number(String(display[0]).split('').reverse().join(''))
    if (Number.isInteger(rev) && rev !== display[0]) display.push(rev)
  }
  return {
    code: res.candidates.length > 0 ? 'TOOTH_AMBIGUOUS' : 'TOOTH_NOT_FOUND',
    questionAr:
      display.length > 1
        ? `تقصد السن ${display.join(' ولا السن ')}؟`
        : 'معلش، مقدرتش أحدد رقم السن. ممكن تعيد رقم السن؟',
    questionEn:
      display.length > 1
        ? `Do you mean tooth ${display.join(' or tooth ')}?`
        : 'Sorry, I could not determine the tooth number. Could you repeat it?',
    candidates: display.map(String),
  }
}

// ---------------------------------------------------------------------------
// Patient resolution — tenant-scoped, through the existing DB (§5 diagram)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PatientLookupClient {
  patient: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args: any): Promise<{ id: string; firstName: string | null; lastName: string | null }[]>
  }
}

interface PatientNameHint {
  first: string | null
  last: string | null
}

/**
 * Extract a likely patient-name hint from a normalized transcript using the
 * SAME bounded lexicon approach as the agent classifier (a LOOKUP HINT —
 * resolution is always server-verified; a wrong hint yields clarification,
 * never identity). Supports "patient X", "المريض X", "X المريض" word order.
 */
// Letters only — EXCLUDES Arabic punctuation (؟ ، ؛ live in U+0600-06FF).
const AR_NAME_CHARS = '[\u0621-\u064A]'
const AR_PUNCT = /[\u061F\u060C\u061B\u06D4?!.,،؛:;'"]+/g

function cleanHintToken(t: string | null | undefined): string | null {
  if (!t) return null
  const cleaned = t.replace(AR_PUNCT, '').trim()
  return cleaned.length >= 2 ? cleaned : null
}

/** Common Arabic words that follow the name in clinical phrases (bounded). */
const AR_NON_NAME = new Set([
  'عنده', 'عندها', 'عندهم', 'عند', 'في', 'من', 'الي', 'الى',
  'ده', 'دي', 'اللي', 'مع', 'عن', 'الذي', 'التي', 'لا', 'ما',
  // temporal words directly after 'المريض' are DATE constraints, not the
  // patient's name ('مواعيد المريض النهاردة' = the patient's appointments
  // TODAY — probing 'النهاردة' as a name produced a bogus NOT_FOUND that
  // interrupted the request before the agent could ask for the identity).
  'النهاردة', 'النهارده', 'اليوم', 'بكرة', 'بكده', 'امبارح', 'امس',
  // possessive pronouns + identity-clause scaffolding name a RELATION,
  // never a patient ('المواعيد بتاعه' = his appointments).
  'بتاعه', 'بتاعها', 'بتاعهم', 'بتاعتها', 'بتاعته', 'اللي', 'الذي', 'التي', 'اسمه', 'اسمها', 'اسم', 'الاسم',
])

export function extractPatientNameHint(text: string): PatientNameHint | null {
  const en = text.match(/(?:patient|for patient|mr\.?|ms\.?)\s+([a-z]+)(?:\s+([a-z]+))?/i)
  if (en) {
    const first = cleanHintToken(en[1])
    if (first) return { first, last: cleanHintToken(en[2]) }
  }
  const ar = text.match(new RegExp('المريض\\s+(' + AR_NAME_CHARS + '+)(?:\\s+(' + AR_NAME_CHARS + '+))?'))
  if (ar) {
    const first = cleanHintToken(ar[1])
    // The FIRST token must itself be a plausible name: 'المريض اللي عليه
    // مراجعة النهارده' is a clinic-level relative clause — extracting 'اللي'
    // would fail resolution and clarify BEFORE the agent ever sees that the
    // request needs no patient at all.
    const second = cleanHintToken(ar[2])
    if (first && !AR_NON_NAME.has(first) && first !== 'اللي' && first !== 'الذي' && first !== 'التي') {
      // A second token is a last name ONLY when it is not a following
      // preposition/verb ("المريض منى عنده..." → first=منى, last=null).
      const last = second && !AR_NON_NAME.has(second) ? second : null
      return { first, last }
    }
  }
  return null
}

/**
 * Resolve a patient reference against the tenant DB (exact → unique contains
 * → ambiguous → not found). NEVER guesses: >1 hits → AMBIGUOUS with bounded
 * candidate list (max 5). All queries are hospitalId-scoped.
 *
 * Matching is normalization-aware: DB names are compared with the SAME
 * transcript normalizer (Arabic folding, diacritics, case), so a spoken
 * "أحمد" (folded احمد) matches a stored "أحمد" or "Ahmed"-style rows whose
 * normalized forms collide. Queries stay bounded (DB-level contains first;
 * candidates verified in JS).
 */
export async function resolvePatientReference(
  client: PatientLookupClient,
  hospitalId: string,
  hint: PatientNameHint | null,
): Promise<PatientResolutionResult> {
  if (!hint?.first) {
    return { status: 'NOT_REQUESTED', patientId: null, displayName: null, candidates: [] }
  }
  const first = hint.first
  const last = hint.last
  const norm = (s: string | null): string => (s ? normalizeTranscript(s).normalized : '')
  const hintFirst = norm(first)
  const hintLast = last ? norm(last) : null

  const rows = await client.patient.findMany({
    where: {
      hospitalId,
      OR: [
        { firstName: { contains: first } },
        ...(last ? [{ lastName: { contains: last } }] : []),
        // Folded-form probe (Arabic carriers): stored names may keep أ/إ/ة.
        { firstName: { contains: hintFirst } },
      ],
    },
    select: { id: true, firstName: true, lastName: true },
  })

  // Bounded Arabic→Latin renderings of the hint ('أحمد' → 'ahmed'): Egyptian
  // records often store LATIN names while doctors speak Arabic. Same
  // exact → unique-contains → ambiguous-clarify semantics; never a guess.
  const latinFirst = latinFormsFor(hintFirst)
  const matchesFirst = (nf: string): boolean => nf === hintFirst || latinFirst.includes(nf)
  const containsFirst = (nf: string): boolean => nf.includes(hintFirst) || latinFirst.some((f) => nf.includes(f))

  // Normalization-aware verification of the DB-level candidates.
  const exact = rows.filter((p) => {
    const nf = norm(p.firstName)
    const nl = norm(p.lastName)
    if (hintLast) return matchesFirst(nf) && nl === norm(hintLast)
    return matchesFirst(nf)
  })
  if (exact.length === 1) {
    const p = exact[0]!
    return { status: 'RESOLVED', patientId: p.id, displayName: displayOf(p), candidates: [] }
  }
  if (exact.length > 1) {
    return {
      status: 'AMBIGUOUS',
      patientId: null,
      displayName: null,
      candidates: exact.slice(0, 5).map((p) => ({ patientId: p.id, displayName: displayOf(p) })),
    }
  }

  const contains = rows.filter((p) => {
    const nf = norm(p.firstName)
    const nl = norm(p.lastName)
    if (hintLast) return (containsFirst(nf) || nl.includes(norm(hintLast)))
    return containsFirst(nf)
  })
  if (contains.length === 1) {
    const p = contains[0]!
    return { status: 'RESOLVED', patientId: p.id, displayName: displayOf(p), candidates: [] }
  }
  if (contains.length > 1) {
    return {
      status: 'AMBIGUOUS',
      patientId: null,
      displayName: null,
      candidates: contains.slice(0, 5).map((p) => ({ patientId: p.id, displayName: displayOf(p) })),
    }
  }
  return { status: 'NOT_FOUND', patientId: null, displayName: null, candidates: [] }
}

export function patientClarification(
  res: PatientResolutionResult,
): VoiceClarification | null {
  if (res.status === 'AMBIGUOUS') {
    return {
      code: 'PATIENT_AMBIGUOUS',
      questionAr: `فيه أكتر من مريض بالاسم ده. تقصد ${res.candidates.map((c) => c.displayName).join(' ولا ')}؟`,
      questionEn: `There is more than one patient with that name. Do you mean ${res.candidates.map((c) => c.displayName).join(' or ')}?`,
      candidates: res.candidates.map((c) => c.displayName),
    }
  }
  if (res.status === 'NOT_FOUND') {
    return {
      code: 'PATIENT_NOT_FOUND',
      questionAr: 'مقدرتش ألاقي المريض ده. ممكن تتأكد من الاسم أو رقم المريض؟',
      questionEn: 'I could not find that patient. Could you verify the name or patient number?',
      candidates: [],
    }
  }
  return null
}

function displayOf(p: { id: string; firstName: string | null; lastName: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.id
}

/** Convenience: sanitize + normalize in one typed step. */
export function prepareTranscript(raw: string): { sanitize: SanitizeResult; normalized: ReturnType<typeof normalizeTranscript> } {
  const sanitize = sanitizeTranscript(raw)
  return { sanitize, normalized: normalizeTranscript(raw) }
}

/**
 * Phase 4 — deterministic grounding (spec §20/§21/§40).
 *
 * The LLM may *interpret* retrieved evidence, but it can never *create* a
 * citation. Grounding is a pure, deterministic check over the final answer:
 *
 * - every `[c#]` marker is DETECTED (never trusted);
 * - a marker is valid only if it was minted by the retrieval layer for this
 *   response (server-built `KnowledgeCitation[]`);
 * - a statement is "grounded" when it cites at least one valid marker AND
 *   shares content words with the cited chunk text (overlap check);
 * - the answer body is labelled with exactly one of the four fact classes —
 *   an LLM interpretation over grounded evidence is MODEL_INTERPRETATION,
 *   never KNOWN_FROM_SOURCE.
 *
 * No LLM, no network, no side effects.
 */

import type { FactClass, KnowledgeCitation } from './types'

const CITATION_MARKER = /\[c(\d+)\]/g

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'which', 'where',
  'there', 'their', 'were', 'will', 'have', 'has', 'had', 'not', 'but', 'are',
  'was', 'were', 'can', 'may', 'might', 'should', 'would', 'could', 'must',
  'does', 'done', 'about', 'into', 'over', 'under', 'between', 'among', 'such',
  'than', 'then', 'them', 'they', 'its', 'his', 'her', 'our', 'your', 'you',
  'who', 'whom', 'whose', 'why', 'how', 'what', 'when', 'whoa', 'else',
  'غير', 'كل', 'من', 'في', 'على', 'عن', 'إلى', 'أن', 'كان', 'كانت', 'هي', 'هو',
  'هذا', 'هذه', 'ذلك', 'تلك', 'ما', 'ماذا', 'لماذا', 'كيف', 'متى', 'أين',
])

/**
 * All citation markers present in the text, in order of first appearance,
 * deduplicated. Detection only — validity is checked against the package.
 */
export function extractCitedIds(text: string): string[] {
  const seen: string[] = []
  const set = new Set<string>()
  for (const m of text.matchAll(CITATION_MARKER)) {
    const id = `c${m[1]}`
    if (!set.has(id)) {
      set.add(id)
      seen.push(id)
    }
  }
  return seen
}

/** Casefolded content words (length ≥ 4, no stopwords) — deterministic overlap unit. */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06ff]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
}

/** Split into sentences on terminal punctuation (bilingual-safe). */
export function splitStatements(text: string): string[] {
  return text
    .split(/(?<=[.!?؟؛。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * A statement is grounded when it carries ≥ 1 valid citation marker and
 * shares ≥ 1 content word with the text of a cited chunk.
 */
export function isStatementGrounded(
  statement: string,
  citedIds: string[],
  chunkTextByCitation: ReadonlyMap<string, string>
): boolean {
  const ids = extractCitedIds(statement)
  const valid = ids.filter((id) => chunkTextByCitation.has(id))
  if (!valid.length) return false
  const words = new Set(contentWords(statement))
  if (!words.size) return false
  for (const id of valid) {
    const chunkWords = new Set(contentWords(chunkTextByCitation.get(id) ?? ''))
    for (const w of words) {
      if (chunkWords.has(w)) return true
    }
  }
  return false
}

export interface CheckGroundingInput {
  /** The answer body (model-interpreted part, or full deterministic answer). */
  answer: string
  /** Citations minted by retrieval for THIS response — the only valid ids. */
  citations: KnowledgeCitation[]
  /** citationId → chunk text (for the deterministic overlap check). */
  chunkTextByCitation: ReadonlyMap<string, string>
  /** True when the answer body was produced by the LLM (not deterministic text). */
  modelGenerated: boolean
  /** True when the answer also embeds patient-record facts. */
  includesPatientFacts?: boolean
}

/**
 * Deterministic grounding report (spec §40). `unsupportedCitations` are the
 * markers the model invented — the caller must strip or refuse them; this
 * function only measures.
 */
export function checkGrounding(input: CheckGroundingInput): import('./types').GroundingReport {
  const { answer, citations, chunkTextByCitation, modelGenerated, includesPatientFacts = false } = input
  const validIds = new Set(citations.map((c) => c.citationId))
  const citedIds = extractCitedIds(answer).filter((id) => validIds.has(id))
  const unsupportedCitations = extractCitedIds(answer).filter((id) => !validIds.has(id))

  const statements = splitStatements(answer)
  const groundedStatements = statements.filter((s) => isStatementGrounded(s, citedIds, chunkTextByCitation)).length

  const hasEvidence = citations.length > 0
  const allCitedGrounded =
    statements.filter((s) => extractCitedIds(s).length > 0).length === 0 ||
    groundedStatements > 0

  const factClass = classifyFactClass({
    modelGenerated,
    hasEvidence,
    includesPatientFacts,
    allCitedGrounded,
  })

  return {
    citedIds,
    unsupportedCitations,
    groundedStatements,
    totalStatements: statements.length,
    factClass,
  }
}

export interface FactClassInput {
  modelGenerated: boolean
  hasEvidence: boolean
  includesPatientFacts: boolean
  /** No statement with a citation failed the overlap check. */
  allCitedGrounded: boolean
}

/**
 * Label the answer body with exactly one fact class (spec §20):
 * - KNOWN_FROM_SOURCE: pure deterministic retrieval echo (no LLM body);
 * - KNOWN_FROM_PATIENT_RECORD: patient facts only, no evidence, no LLM;
 * - MODEL_INTERPRETATION: LLM body over (at least partially) grounded evidence;
 * - UNKNOWN: nothing verifiable (failure / no evidence / ungrounded claims).
 */
export function classifyFactClass(args: FactClassInput): FactClass {
  if (!args.hasEvidence && !args.includesPatientFacts) return 'UNKNOWN'
  if (args.modelGenerated) {
    if (!args.allCitedGrounded) return 'UNKNOWN'
    return 'MODEL_INTERPRETATION'
  }
  if (args.includesPatientFacts && !args.hasEvidence) return 'KNOWN_FROM_PATIENT_RECORD'
  return 'KNOWN_FROM_SOURCE'
}

/**
 * Strip citation markers that the retrieval layer did not mint. Returns the
 * cleaned text + the removed ids (the caller reports them, never the LLM).
 */
export function stripUnsupportedCitations(
  text: string,
  validCitationIds: ReadonlySet<string>
): { text: string; removed: string[] } {
  const removed = extractCitedIds(text).filter((id) => !validCitationIds.has(id))
  if (!removed.length) return { text, removed }
  let out = text
  for (const id of removed) {
    out = out.replace(new RegExp(`\\[c${id.slice(1)}\\]`, 'g'), '')
  }
  return { text: out, removed }
}

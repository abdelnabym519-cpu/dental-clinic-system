/**
 * Phase 4 — Retrieval pipeline (spec §15–§17, §22–§24, §36).
 *
 *   query → normalize → domain filter → metadata filter → candidate
 *         retrieval → ranking (deterministic) → dedup → evidence selection
 *         (budget + diversity) → conflicts → evidence package
 *
 * Methods (§13/§14/§17):
 * - LEXICAL (default): posting-list BM25-style scoring over raw tokens +
 *   canonical terms (bilingual), section boost, tier/freshness/domain
 *   factors. Fully offline — no network, no embedding model, ever.
 * - HYBRID (only when an EmbeddingProvider is passed): the SAME lexical
 *   candidates are re-ranked with a clamped cosine (0.6 lexical + 0.4
 *   semantic) against build-time vectors. A semantic-only recall channel
 *   is intentionally NOT implemented (documented limitation): lexical
 *   posting remains the recall floor so nothing lexical is lost.
 *
 * Deterministic: identical query + corpus (+ provider) → identical results
 * (stable tie-breaks). No LLM involved anywhere in this file.
 */
import { buildKnowledgeIndex, type KnowledgeIndex } from './index'
import { normalizeQuery, tokenize } from './normalize'
import { knowledgeFailure } from './errors'
import {
  DEFAULT_RETRIEVAL_CONFIG,
  TIER_ELIGIBILITY,
  type EvidenceConflict, type FreshnessStatus, type KnowledgeCitation,
  type KnowledgeEvidencePackage, type KnowledgeFailure, type KnowledgeQuery,
  type KnowledgeRetrievalResult, type KnowledgeStore, type KnowledgeStats,
  type RetrievalConfig, type SourceTier,
} from './types'
import { isKnowledgeDomain } from './taxonomy'

const TIER_WEIGHT: Record<SourceTier, number> = {
  TIER_1: 1.0,
  TIER_2: 0.95,
  TIER_3: 0.85,
  TIER_4: 0.6,
}
const TIER_RANK: Record<SourceTier, number> = { TIER_1: 1, TIER_2: 2, TIER_3: 3, TIER_4: 4 }

/** Curated opposition pairs for explicit conflict detection (§22). */
const OPPOSITION: Array<{ neg: string[]; pos: string[]; label: string }> = [
  {
    neg: ['contraindicated', 'contraindication', 'not recommended', 'avoid use'],
    pos: ['recommended', 'first-line', 'standard of care'],
    label: 'recommendation vs contraindication',
  },
  {
    neg: ['must not', 'should not', 'is not indicated'],
    pos: ['should be', 'is indicated', 'must be performed'],
    label: 'indication disagreement',
  },
]

function freshnessOf(source: { meta: { publicationDate?: string | null; lastUpdated?: string | null } }, now: Date, maxYears: number): FreshnessStatus {
  const date = source.meta.lastUpdated ?? source.meta.publicationDate
  if (!date) return 'UNKNOWN_DATE'
  const ageMs = now.getTime() - new Date(date).getTime()
  if (ageMs > maxYears * 365.25 * 86400000) return 'STALE'
  if (ageMs > 3 * 365.25 * 86400000) return 'AGING'
  return 'CURRENT'
}

export interface RetrieveOptions {
  now?: () => Date
  config?: Partial<RetrievalConfig>
  /** Optional embedding provider (spec §13/§14). Absent → deterministic
   * LEXICAL method (the documented default; no network, ever). */
  embeddingProvider?: import('./types').EmbeddingProvider | null
}

export async function retrieveKnowledge(
  query: KnowledgeQuery,
  store: KnowledgeStore,
  opts: RetrieveOptions = {}
): Promise<KnowledgeEvidencePackage> {
  const config: RetrievalConfig = { ...DEFAULT_RETRIEVAL_CONFIG, ...opts.config }
  const now = opts.now ?? (() => new Date())
  const nowDate = now()
  const queryId = `kq-${Date.now().toString(36)}`
  const t0 = Date.now()

  const fail = (code: Parameters<typeof knowledgeFailure>[0], message: string): KnowledgeEvidencePackage => ({
    ok: false,
    queryId,
    question: query.question,
    failure: knowledgeFailure(code, message),
    results: [],
    citations: [],
    conflicts: [],
    budgetUsed: { evidenceChars: 0, limit: config.maxEvidenceChars, truncated: false },
    stats: {
      candidateCount: 0, selectedCount: 0, sourceCount: 0,
      retrievalMs: 0, rankingMs: 0, duplicateChunksDropped: 0, method: 'LEXICAL',
    },
    retrievedAt: nowDate.toISOString(),
  })

  // ── validate ──────────────────────────────────────────────────────────
  const question = query.question?.trim() ?? ''
  if (!question) return fail('INVALID_QUERY', 'question is required')
  if (question.length > config.maxQueryChars) return fail('INVALID_QUERY', `question exceeds ${config.maxQueryChars} chars`)
  if (query.domain && !isKnowledgeDomain(query.domain)) {
    return fail('UNSUPPORTED_DOMAIN', `unknown domain: ${query.domain}`)
  }
  const maxResults = Math.min(Math.max(query.maxResults ?? config.maxResultsDefault, 1), config.maxResults)

  const normalized = normalizeQuery(question)
  const queryKeys = new Set<string>()
  for (const t of normalized.tokens) queryKeys.add(`t:${t}`)
  for (const canonical of normalized.terms.keys()) queryKeys.add(`c:${canonical}`)
  if (queryKeys.size === 0) return fail('INVALID_QUERY', 'no searchable content in question')

  // ── index (3 bounded loads) ───────────────────────────────────────────
  let index: KnowledgeIndex
  try {
    index = await buildKnowledgeIndex(store, query.hospitalId, {
      includeSuperseded: query.includeSuperseded ?? false,
      embeddingProvider: opts.embeddingProvider ?? null,
    })
  } catch {
    return fail('INDEX_FAILURE', 'knowledge index could not be loaded')
  }
  const retrievalMs = Date.now() - t0

  if (index.totalChunks === 0) {
    return fail('KNOWLEDGE_NOT_AVAILABLE', 'no published knowledge sources are available')
  }

  // ── semantic path (only when a provider is configured, §13/§14) ───────
  // Default (no provider) is the deterministic LEXICAL method — offline,
  // zero network. When a provider is present the SAME lexical candidates
  // are re-ranked with a clamped cosine against build-time vectors
  // (hybrid = lexical recall + semantic re-rank; a semantic-only recall
  // channel is intentionally out of scope — documented limitation).
  const queryVec = index.embeddingProvider ? await index.embeddingProvider.embed(question) : null

  // ── candidate retrieval + scoring (posting-driven) ────────────────────
  const useCase = query.useCase
  const eligibleTiers = new Set<string>(TIER_ELIGIBILITY[useCase])
  if (query.allowTier4) eligibleTiers.add('TIER_4')

  const eligible = (entry: (typeof index.chunks)[number]): boolean =>
    eligibleTiers.has(entry.source.meta.authorityTier) &&
    (!query.domain || entry.chunk.domain === query.domain) &&
    (!query.language || entry.source.meta.language === query.language) &&
    (!query.jurisdiction || entry.source.meta.jurisdiction === query.jurisdiction) &&
    (entry.document.status !== 'SUPERSEDED' || (query.includeSuperseded ?? false))

  interface Acc { lexical: number; weight: number; matched: Set<string>; sectionBoost: number }
  const acc = new Map<number, Acc>()
  for (const key of queryKeys) {
    const posting = index.postings.get(key)
    if (!posting) continue
    const df = index.df.get(key) ?? 0
    const isTerm = key.startsWith('c:')
    const idf = Math.log(1 + index.totalChunks / (1 + df))
    for (const i of posting) {
      const entry = index.chunks[i]
      if (!eligible(entry)) continue
      const tf = isTerm ? 2 : (entry.tokenFreq.get(key.slice(2)) ?? 0)
      if (!tf) continue
      const w = (1 + Math.log(tf)) * idf * (isTerm ? 1.5 : 1)
      let a = acc.get(i)
      if (!a) { a = { lexical: 0, weight: 0, matched: new Set(), sectionBoost: 0 }; acc.set(i, a) }
      a.lexical += w
      a.weight += w
      a.matched.add(key.slice(2))
      // field boost: the matched term also appears in the section heading
      if (isTerm) {
        const surfaces = entry.terms.get(key.slice(2)) ?? []
        if (surfaces.some((s) => (entry.chunk.section ?? '').toLowerCase().includes(s))) a.sectionBoost += w * 0.15
      }
    }
  }

  const scores: Array<{ idx: number; score: number; matchedTerms: string[] }> = []
  for (const [i, a] of acc) {
    const entry = index.chunks[i]
    const domainFactor = query.domain ? 1 : 0.9
    const tierFactor = TIER_WEIGHT[entry.source.meta.authorityTier]
    const fresh = freshnessOf(entry.source, nowDate, config.clinicalFreshnessYears)
    const freshnessFactor = fresh === 'STALE' ? 0.92 : 1
    const normalizedLexical = a.weight ? (a.lexical + a.sectionBoost) / (a.weight * 3) : 0
    const semantic = queryVec && entry.vector ? cosineClamped(queryVec, entry.vector) : null
    // hybrid blend: lexical primary, semantic secondary (deterministic).
    const relevance = semantic === null ? normalizedLexical : 0.6 * normalizedLexical + 0.4 * semantic
    const score = Math.min(1, relevance * (0.55 + 0.45 * domainFactor) * tierFactor * freshnessFactor)
    scores.push({ idx: i, score, matchedTerms: [...a.matched].sort() })
  }

  // ── deterministic ranking (stable tie-breaks) ─────────────────────────
  const rankT0 = Date.now()
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const sa = index.chunks[a.idx].source.meta.authorityTier
    const sb = index.chunks[b.idx].source.meta.authorityTier
    if (TIER_RANK[sa] !== TIER_RANK[sb]) return TIER_RANK[sa] - TIER_RANK[sb]
    const da = index.chunks[a.idx].source.meta.publicationDate
    const db = index.chunks[b.idx].source.meta.publicationDate
    if (da && db && da !== db) return da < db ? 1 : -1 // newer first
    const ca = index.chunks[a.idx].chunk
    const cb = index.chunks[b.idx].chunk
    if (ca.documentId !== cb.documentId) return ca.documentId.localeCompare(cb.documentId)
    return ca.position - cb.position
  })
  const rankingMs = Date.now() - rankT0

  if (!scores.length) {
    const emptyReason = query.domain || query.language || query.jurisdiction ? 'DOMAIN_NO_MATCH' : 'NO_RESULTS'
    return {
      ok: true,
      queryId,
      question,
      failure: null,
      emptyReason,
      results: [],
      citations: [],
      conflicts: [],
      budgetUsed: { evidenceChars: 0, limit: config.maxEvidenceChars, truncated: false },
      stats: {
        candidateCount: index.chunks.length, selectedCount: 0, sourceCount: 0,
        retrievalMs, rankingMs, duplicateChunksDropped: 0, method: queryVec ? 'HYBRID' : 'LEXICAL',
      },
      retrievedAt: nowDate.toISOString(),
    }
  }

  // ── dedup + diversity + budget ────────────────────────────────────────
  const selected: Array<{ entry: (typeof index.chunks)[number]; score: number; matchedTerms: string[] }> = []
  const perSource = new Map<string, number>()
  let droppedDup = 0
  let budgetChars = 0
  let truncated = false
  const selectedTokenSets: Set<string>[] = []

  for (const s of scores) {
    if (selected.length >= maxResults) break
    const entry = index.chunks[s.idx]
    const srcCount = perSource.get(entry.source.id) ?? 0
    if (srcCount >= config.maxChunksPerSource) continue
    const toks = new Set(tokenize(entry.chunk.text).filter((t) => t.length > 2))
    const isDup = selectedTokenSets.some((st) => jaccard(st, toks) >= config.nearDuplicateJaccard)
    if (isDup) { droppedDup += 1; continue }
    const room = config.maxEvidenceChars - budgetChars
    if (room <= 0) { truncated = true; break }
    let text = entry.chunk.text
    if (text.length > room) {
      text = truncateAtSentence(text, room)
      truncated = true
    }
    selected.push({ entry, score: s.score, matchedTerms: s.matchedTerms })
    selectedTokenSets.push(toks)
    perSource.set(entry.source.id, srcCount + 1)
    budgetChars += text.length
  }

  // ── conflicts (explicit, never merged) ────────────────────────────────
  const conflicts = detectConflicts(selected.map((s) => ({
    sourceId: s.entry.source.id,
    tier: s.entry.source.meta.authorityTier,
    publicationDate: s.entry.source.meta.publicationDate ?? null,
    text: s.entry.chunk.text.toLowerCase(),
    terms: s.matchedTerms,
  })))

  // ── results + citations (server-side only) ────────────────────────────
  const results: KnowledgeRetrievalResult[] = selected.map((s, i) => ({
    rank: i + 1,
    chunk: { ...s.entry.chunk, text: budgetText(s.entry.chunk.text) },
    source: s.entry.source,
    document: s.entry.document,
    relevanceScore: Math.round(s.score * 1000) / 1000,
    matchType: index.embeddingProvider ? 'HYBRID' : 'LEXICAL',
    authorityTier: s.entry.source.meta.authorityTier,
    freshness: freshnessOf(s.entry.source, nowDate, config.clinicalFreshnessYears),
    lowAuthority: s.entry.source.meta.authorityTier === 'TIER_4' ? true : undefined,
    matchedTerms: s.matchedTerms,
    retrievedAt: nowDate.toISOString(),
  }))

  const citations: KnowledgeCitation[] = results.map((r, i) => buildCitation(`c${i + 1}`, r))

  const stats: KnowledgeStats = {
    candidateCount: index.totalChunks,
    selectedCount: results.length,
    sourceCount: new Set(results.map((r) => r.source.id)).size,
    retrievalMs,
    rankingMs,
    duplicateChunksDropped: droppedDup,
    method: index.embeddingProvider ? 'HYBRID' : 'LEXICAL',
  }

  const emptyReason = results.length
    ? null
    : query.domain || query.language || query.jurisdiction ? 'DOMAIN_NO_MATCH' : 'NO_RESULTS'

  return {
    ok: true,
    queryId,
    question,
    failure: null,
    emptyReason,
    results,
    citations,
    conflicts,
    budgetUsed: { evidenceChars: budgetChars, limit: config.maxEvidenceChars, truncated },
    stats,
    retrievedAt: nowDate.toISOString(),
  }
}

// ---------------------------------------------------------------------------

function buildCitation(citationId: string, r: KnowledgeRetrievalResult): KnowledgeCitation {
  return {
    citationId,
    sourceId: r.source.id,
    documentId: r.document.id,
    chunkId: r.chunk.id,
    title: r.source.meta.title,
    section: r.chunk.section ?? null,
    page: null, // unknown — never invented
    url: r.source.meta.reference ?? null, // stored metadata ONLY
    publisher: r.source.meta.publisher,
    publicationDate: r.source.meta.publicationDate ?? null,
    version: r.document.version,
    authorityTier: r.source.meta.authorityTier,
    language: r.source.meta.language,
    jurisdiction: r.source.meta.jurisdiction ?? null,
    factClass: 'KNOWN_FROM_SOURCE',
  }
}

interface ConflictCandidate {
  sourceId: string
  tier: SourceTier
  publicationDate: string | null
  text: string
  terms: string[]
}

function detectConflicts(candidates: ConflictCandidate[]): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = []
  // group by shared matched term (topic proxy)
  const byTerm = new Map<string, ConflictCandidate[]>()
  for (const c of candidates) {
    for (const t of c.terms) {
      const list = byTerm.get(t) ?? []
      list.push(c)
      byTerm.set(t, list)
    }
  }
  const seen = new Set<string>()
  for (const [term, group] of byTerm) {
    const sources = new Set(group.map((g) => g.sourceId))
    if (sources.size < 2) continue
    for (const opp of OPPOSITION) {
      const neg = group.filter((g) => opp.neg.some((m) => g.text.includes(m)))
      const pos = group.filter((g) => opp.pos.some((m) => g.text.includes(m)))
      if (neg.length && pos.length && new Set([...neg, ...pos].map((g) => g.sourceId)).size >= 2) {
        const key = `${term}|${[...sources].sort().join(',')}`
        if (seen.has(key)) continue
        seen.add(key)
        conflicts.push({
          topic: term,
          sourceIds: [...new Set(group.map((g) => g.sourceId))].sort(),
          tiers: [...new Set(group.map((g) => g.tier))],
          publicationDates: [...new Set(group.map((g) => g.publicationDate))].sort() as Array<string | null>,
          note: `Sources disagree on "${term}" (${opp.label}); no consensus is implied.`,
        })
      }
    }
  }
  return conflicts.slice(0, 5)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

/**
 * Cosine similarity clamped to [0,1] (negative similarity → 0: a vector
 * that points the opposite way carries no evidence for the query).
 * Pure + deterministic — exported for tests.
 */
export function cosineClamped(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb))
  return c < 0 ? 0 : c > 1 ? 1 : c
}

function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('؛ '), cut.lastIndexOf('؟ '))
  if (lastBreak > max * 0.5) return cut.slice(0, lastBreak + 1)
  return cut + ' …'
}

/** Keep the full chunk text in the contract (the evidence budget is applied
 * when the agent assembles its prompt, not to what the contract records). */
function budgetText(text: string): string {
  return text
}

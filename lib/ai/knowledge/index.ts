/**
 * Phase 4 — Knowledge index (in-memory, per-query build).
 *
 * Three bounded store loads (sources → documents → chunks): no N+1, no
 * per-chunk source loading. Posting lists are keyed on BOTH raw tokens
 * (`t:`) and canonical terms (`c:`) so bilingual matching is symmetric.
 *
 * No caching (Phase 2 decision stands): the build cost is measured by the
 * Phase 4 bench, and at clinic-scale corpora (hundreds–thousands of chunks)
 * a per-query build is simpler and always fresh.
 */
import { projectChunkText, tokenize } from './normalize'
import type {
  EmbeddingProvider, KnowledgeChunk, KnowledgeDocument, KnowledgeSource, KnowledgeStore,
} from './types'

export interface IndexChunk {
  chunk: KnowledgeChunk
  source: KnowledgeSource
  document: KnowledgeDocument
  /** token → frequency (surface tokens, stop-filtered) */
  tokenFreq: Map<string, number>
  /** canonical term → surface forms present */
  terms: Map<string, string[]>
  /** tokens of the section heading (for field boosting) */
  sectionTokens: Set<string>
  /** embedding vector — only when a provider is configured (spec §13/§14). */
  vector?: number[] | null
}

export interface KnowledgeIndex {
  chunks: IndexChunk[]
  /** posting key → chunk indices */
  postings: Map<string, number[]>
  /** posting key → chunk count (document frequency) */
  df: Map<string, number>
  totalChunks: number
  buildMs: number
  sourcesLoaded: number
  documentsLoaded: number
  embeddingProvider: EmbeddingProvider | null
}

export interface BuildIndexOptions {
  includeSuperseded?: boolean
  embeddingProvider?: EmbeddingProvider | null
}

export async function buildKnowledgeIndex(
  store: KnowledgeStore,
  hospitalId: string,
  opts: BuildIndexOptions = {}
): Promise<KnowledgeIndex> {
  const t0 = Date.now()
  const sources = await store.listPublishedSources(hospitalId)
  const sourceById = new Map(sources.map((s) => [s.id, s]))

  const sourceIds = [...sourceById.keys()]
  const documents = sourceIds.length
    ? await store.listDocumentsForSources(sourceIds, opts.includeSuperseded ?? false)
    : []
  const wantedDocs = documents
  const docIds = wantedDocs.map((d) => d.id)

  const chunkRows = docIds.length ? await store.listChunks(docIds) : []
  const docById = new Map(wantedDocs.map((d) => [d.id, d]))

  const chunks: IndexChunk[] = []
  const postings = new Map<string, number[]>()
  const df = new Map<string, number>()
  const provider = opts.embeddingProvider ?? null

  const post = (key: string, idx: number) => {
    const list = postings.get(key)
    if (list) list.push(idx)
    else postings.set(key, [idx])
    df.set(key, (df.get(key) ?? 0) + 1)
  }

  for (const c of chunkRows) {
    const document = docById.get(c.documentId)
    const source = sourceById.get(c.sourceId)
    if (!document || !source) continue
    const projected = projectChunkText(c.text)
    const freq = new Map<string, number>()
    for (const t of tokenize(c.text)) {
      if (t.length <= 1) continue
      freq.set(t, (freq.get(t) ?? 0) + 1)
    }
    const idx = chunks.length
    // Provider embeds are computed at build time (deterministic order),
    // never at query time — no duplicate embedding work (spec §34).
    const vector = provider ? await provider.embed(c.text) : null
    chunks.push({
      chunk: c,
      source,
      document,
      tokenFreq: freq,
      terms: projected.terms,
      sectionTokens: new Set(tokenize(c.section ?? '')),
      vector,
    })
    for (const t of freq.keys()) post(`t:${t}`, idx)
    for (const canonical of projected.terms.keys()) post(`c:${canonical}`, idx)
  }

  return {
    chunks,
    postings,
    df,
    totalChunks: chunks.length,
    buildMs: Date.now() - t0,
    sourcesLoaded: sources.length,
    documentsLoaded: wantedDocs.length,
    embeddingProvider: opts.embeddingProvider ?? null,
  }
}

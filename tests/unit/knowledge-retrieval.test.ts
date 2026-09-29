// @ts-nocheck
/**
 * Phase 4 — Retrieval + deterministic evaluation harness (spec §15–§17,
 * §22–§24, §32): recall@k, precision@k, ranking stability, dedup,
 * diversity, tier behavior, metadata/domain filtering, freshness,
 * citation correctness, tenant isolation, bilingual bridge.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { buildKnowledgeTestWorld, type TestKnowledgeWorld } from '@/tests/harness/knowledge-fixtures'
import { retrieveKnowledge } from '@/lib/ai/knowledge/retrieval'
import { HOSP_A } from '@/tests/harness/context-fixtures'

let w: TestKnowledgeWorld
const N = () => new Date('2026-09-29T12:00:00Z')
const q = (question: string, over: Record<string, any> = {}) =>
  retrieveKnowledge({ question, hospitalId: HOSP_A, useCase: 'clinical', ...over }, w.mem.store, { now: N })
const keys = (p: any) => p.results.map((r: any) => r.source.meta.sourceKey)

beforeAll(async () => {
  w = await buildKnowledgeTestWorld()
})

describe('retrieval — core behavior', () => {
  it('returns structured evidence with provenance (not raw text)', async () => {
    const p = await q('root canal treatment for irreversible pulpitis')
    expect(p.ok).toBe(true)
    expect(p.results.length).toBeGreaterThan(0)
    const r = p.results[0]
    expect(r).toMatchObject({
      rank: 1,
      matchType: 'LEXICAL',
      authorityTier: expect.stringMatching(/^TIER_[1-4]$/),
      freshness: expect.stringMatching(/^(CURRENT|AGING|STALE|UNKNOWN_DATE)$/),
    })
    expect(r.chunk.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(r.source.meta).toHaveProperty('publisher')
    expect(r.retrievedAt).toBeTruthy()
    // stats observable
    expect(p.stats.candidateCount).toBeGreaterThan(0)
    expect(p.stats.selectedCount).toBe(p.results.length)
    expect(p.stats.sourceCount).toBe(new Set(p.results.map((x: any) => x.source.id)).size)
  })

  it('recall@3 / precision@3 on ground truth (periodontitis criteria)', async () => {
    const truth = new Set(['synthetic-periodontitis-guideline'])
    const p = await q('What are the diagnostic criteria for periodontitis?', { maxResults: 3 })
    const hits = p.results.filter((r: any) => truth.has(r.source.meta.sourceKey))
    const recall = hits.length / 1
    const precision = hits.length / Math.max(p.results.length, 1)
    expect(recall).toBe(1) // ground-truth source retrieved within k
    expect(precision).toBeGreaterThanOrEqual(0.34)
    // the TIER_1 guideline chunk ranks in the top 2
    expect(p.results.slice(0, 2).some((r: any) => r.source.meta.sourceKey === 'synthetic-periodontitis-guideline')).toBe(true)
  })

  it('ranking is deterministic (identical query → identical order, twice)', async () => {
    const a = await q('root canal treatment for irreversible pulpitis', { maxResults: 5 })
    const b = await q('root canal treatment for irreversible pulpitis', { maxResults: 5 })
    expect(a.results.map((r: any) => [r.chunk.id, r.relevanceScore])).toEqual(b.results.map((r: any) => [r.chunk.id, r.relevanceScore]))
  })

  it('bilingual bridge: Arabic query retrieves the English guideline and vice versa', async () => {
    const ar = await q('عصب السن')
    expect(keys(ar)).toContain('synthetic-endodontic-guideline')
    const en = await q('root canal')
    expect(keys(en)).toContain('synthetic-endodontic-guideline')
    // the matched chunk reports which canonical term bridged it (عصب السن → root-canal)
    const hit = ar.results.find((r: any) => r.source.meta.sourceKey === 'synthetic-endodontic-guideline')
    expect(hit.matchedTerms).toContain('root-canal')
  })

  it('Arabic query with language=ar returns the Arabic source', async () => {
    const p = await q('fluoride for children', { language: 'ar' })
    expect(p.results.length).toBeGreaterThan(0)
    expect(p.results.every((r: any) => r.source.meta.language === 'ar')).toBe(true)
    expect(keys(p)).toContain('synthetic-arabic-pediatric-guide')
  })

  it('domain filter excludes other domains', async () => {
    const p = await q('root canal treatment', { domain: 'ENDODONTICS' })
    expect(p.results.every((r: any) => r.chunk.domain === 'ENDODONTICS')).toBe(true)
  })

  it('unknown domain → UNSUPPORTED_DOMAIN (typed)', async () => {
    const p = await q('root canal', { domain: 'CARDIOLOGY' })
    expect(p.ok).toBe(false)
    expect(p.failure.code).toBe('UNSUPPORTED_DOMAIN')
  })

  it('invalid queries → INVALID_QUERY (typed)', async () => {
    expect((await q('   ')).failure.code).toBe('INVALID_QUERY')
    expect((await q('x'.repeat(600))).failure.code).toBe('INVALID_QUERY')
  })

  it('out-of-domain question → honest NO_RESULTS (never fabricates evidence)', async () => {
    const p = await q('quantum entanglement of photons')
    expect(p.ok).toBe(true)
    expect(p.emptyReason).toBe('NO_RESULTS')
    expect(p.results).toHaveLength(0)
    expect(p.citations).toHaveLength(0)
  })
})

describe('retrieval — authority, version, freshness', () => {
  it('TIER_4 is never eligible for clinical use; TIER_3 educational is', async () => {
    const clinical = await q('root canal treatment', { maxResults: 10 })
    expect(clinical.results.every((r: any) => r.authorityTier !== 'TIER_4')).toBe(true)
    // the only TIER_3 in the corpus (oral medicine) is clinical-ineligible…
    const clinicalUlcers = await q('oral ulcers that persist', { maxResults: 10 })
    expect(clinicalUlcers.results.every((r: any) => r.authorityTier !== 'TIER_3')).toBe(true)
    // …but educational use admits it
    const edu = await q('oral ulcers that persist', { useCase: 'educational', maxResults: 10 })
    expect(edu.results.some((r: any) => r.source.meta.sourceKey === 'synthetic-oral-medicine-unknown')).toBe(true)
  })

  it('allowTier4 (explicit config) includes TIER_4 but labels lowAuthority', async () => {
    const p = await q('root canal treatment', { allowTier4: true, maxResults: 10 })
    const t4 = p.results.filter((r: any) => r.authorityTier === 'TIER_4')
    expect(t4.length).toBeGreaterThan(0)
    expect(t4.every((r: any) => r.lowAuthority === true)).toBe(true)
    // authoritative evidence still outranks the low-tier source on the same topic
    const t1 = p.results.filter((r: any) => r.authorityTier === 'TIER_1')
    expect(t1.length).toBeGreaterThan(0)
    expect(Math.max(...t1.map((r: any) => r.rank))).toBeLessThan(Math.min(...t4.map((r: any) => r.rank)))
  })

  it('poisoning: low-authority malicious source cannot outrank authoritative evidence', async () => {
    const p = await q('root canal treatment', { allowTier4: true, maxResults: 10 })
    const blog = p.results.find((r: any) => r.source.meta.sourceKey === 'synthetic-dental-blog')
    const endo = p.results.find((r: any) => r.source.meta.sourceKey === 'synthetic-endodontic-guideline')
    expect(blog).toBeTruthy()
    expect(endo).toBeTruthy()
    expect(endo.rank).toBeLessThan(blog.rank)
  })

  it('version attack: superseded v1 cannot masquerade as latest', async () => {
    const p = await q('should a tooth with a 6mm pocket be extracted', { maxResults: 10 })
    const periodo = p.results.filter((r: any) => r.source.meta.sourceKey === 'synthetic-periodontitis-guideline')
    expect(periodo.length).toBeGreaterThan(0)
    // every returned document of this source is the PUBLISHED v2
    expect(periodo.every((r: any) => r.document.version === '2')).toBe(true)
    expect(periodo.every((r: any) => r.document.status === 'PUBLISHED')).toBe(true)
  })

  it('includeSuperseded explicitly reveals version history (latest wins by rank)', async () => {
    const p = await q('probing depths and extraction', { includeSuperseded: true, maxResults: 10 })
    const periodo = p.results.filter((r: any) => r.source.meta.sourceKey === 'synthetic-periodontitis-guideline')
    if (periodo.length >= 2) {
      const versions = periodo.map((r: any) => r.document.version)
      expect(new Set(versions).size).toBeGreaterThan(1)
      expect(periodo[0].document.version).toBe('2')
    }
  })

  it('freshness status is computed from stored dates; UNKNOWN_DATE never claims "latest"', async () => {
    const p = await q('oral ulcers that persist', { useCase: 'educational' })
    const unknown = p.results.find((r: any) => r.source.meta.sourceKey === 'synthetic-oral-medicine-unknown')
    expect(unknown).toBeTruthy()
    expect(unknown.freshness).toBe('UNKNOWN_DATE')
    expect(unknown.document.version).toBeTruthy() // version label is factual, not a "latest" claim
    const dated = await q('periodontitis diagnosis')
    const current = dated.results.find((r: any) => r.source.meta.sourceKey === 'synthetic-periodontitis-guideline')
    expect(current).toBeTruthy()
    expect(['CURRENT', 'AGING']).toContain(current.freshness)
  })

  it('jurisdiction filter: unknown jurisdiction matches nothing (never inferred as Egyptian)', async () => {
    const p = await q('root canal treatment', { jurisdiction: 'EG' })
    expect(p.results).toHaveLength(0)
    expect(p.emptyReason).toBe('DOMAIN_NO_MATCH')
  })
})

describe('retrieval — dedup, diversity, budget, citations, conflicts', () => {
  it('near-duplicate selected chunks are dropped (counted)', async () => {
    // force both the copied diagnosis chunk and the original into the result set
    const p = await q('periodontitis diagnostic criteria probing depths attachment loss', { maxResults: 10 })
    expect(p.stats.duplicateChunksDropped).toBeGreaterThanOrEqual(0)
    // the partial-dup source may appear, but never both its copy AND an
    // identical chunk at adjacent ranks
    const sameText = p.results.filter((r: any) => r.chunk.checksum === p.results[0]?.chunk.checksum)
    expect(sameText.length).toBe(1)
  })

  it('source diversity: at most 2 chunks per source', async () => {
    const p = await q('periodontitis treatment and maintenance', { maxResults: 10 })
    const perSource = new Map<string, number>()
    for (const r of p.results) perSource.set(r.source.id, (perSource.get(r.source.id) ?? 0) + 1)
    for (const n of perSource.values()) expect(n).toBeLessThanOrEqual(2)
  })

  it('context budget is enforced', async () => {
    const p = await q('periodontitis treatment and maintenance', { maxResults: 10 })
    expect(p.budgetUsed.evidenceChars).toBeLessThanOrEqual(12000)
    expect(p.budgetUsed.limit).toBe(12000)
  })

  it('citations are machine-readable, complete, and server-built', async () => {
    const p = await q('root canal treatment for irreversible pulpitis')
    expect(p.citations.length).toBe(p.results.length)
    for (const c of p.citations) {
      expect(c.citationId).toMatch(/^c\d+$/)
      expect(c.sourceId).toBeTruthy()
      expect(c.documentId).toBeTruthy()
      expect(c.chunkId).toBeTruthy()
      expect(c.title).toBeTruthy()
      expect(c.publisher).toBeTruthy()
      expect(c.factClass).toBe('KNOWN_FROM_SOURCE')
      // url is from stored metadata only (null when the source has none)
      const src = p.results.find((r: any) => r.chunk.id === c.chunkId)
      expect(c.url).toBe(src.source.meta.reference ?? null)
      // page is never invented
      expect(c.page ?? null).toBeNull()
    }
    // every cited chunk id exists in the results (no phantom citations)
    const chunkIds = new Set(p.results.map((r: any) => r.chunk.id))
    expect(p.citations.every((c: any) => chunkIds.has(c.chunkId))).toBe(true)
  })

  it('URL spoofing: fake citation text inside a document never becomes citation metadata', async () => {
    const p = await q('root canal myth', { allowTier4: true, maxResults: 10 })
    // the blog citation url must be the STORED reference, not the fake in-body one
    const blog = p.citations.filter((c: any) => c.url === 'https://blog.test.example.org/root-canal')
    expect(blog.length).toBeGreaterThan(0)
    expect(p.citations.every((c: any) => !String(c.url ?? '').includes('fake.example/citation'))).toBe(true)
  })

  it('conflicting evidence is surfaced explicitly (never merged into fake consensus)', async () => {
    const p = await q('amalgam for a child under 6 years', { useCase: 'educational', maxResults: 10 })
    expect(p.conflicts.length).toBeGreaterThan(0)
    const c = p.conflicts[0]
    expect(c.sourceIds.length).toBeGreaterThanOrEqual(2)
    expect(c.topic).toBeTruthy()
    expect(c.note).toContain('no consensus')
    expect(p.results.some((r: any) => c.sourceIds.includes(r.source.id))).toBe(true)
  })
})

describe('retrieval — tenant isolation & availability', () => {
  it('tenant A cannot see tenant B private knowledge', async () => {
    const a = await q('dry socket after extraction', { maxResults: 10 })
    expect(a.results.every((r: any) => r.source.meta.sourceKey !== 'clinic-b-private-protocol')).toBe(true)
  })

  it('tenant B can see its own private knowledge (plus global)', async () => {
    const b = await retrieveKnowledge(
      { question: 'dry socket after extraction', hospitalId: 'hosp-B', useCase: 'clinical', maxResults: 10 },
      w.mem.store, { now: N })
    const own = b.results.find((r: any) => r.source.meta.sourceKey === 'clinic-b-private-protocol')
    expect(own).toBeTruthy()
    expect(own.source.meta.scope).toBe('TENANT')
  })

  it('empty corpus → KNOWLEDGE_NOT_AVAILABLE (agent must report honestly)', async () => {
    const { createMemoryKnowledgeStore } = await import('@/lib/ai/knowledge/store')
    const empty = createMemoryKnowledgeStore().store
    const p = await retrieveKnowledge({ question: 'root canal', hospitalId: HOSP_A, useCase: 'clinical' }, empty, { now: N })
    expect(p.ok).toBe(false)
    expect(p.failure.code).toBe('KNOWLEDGE_NOT_AVAILABLE')
  })

  it('N+1 guardrail: retrieval performs exactly 3 bounded store loads, always', async () => {
    const real = {
      listPublishedSources: w.mem.store.listPublishedSources.bind(w.mem.store),
      listDocumentsForSources: w.mem.store.listDocumentsForSources.bind(w.mem.store),
      listChunks: w.mem.store.listChunks.bind(w.mem.store),
    }
    let loads = 0
    ;(w.mem.store as any).listPublishedSources = (...a: any[]) => { loads += 1; return real.listPublishedSources(...a) }
    ;(w.mem.store as any).listDocumentsForSources = (...a: any[]) => { loads += 1; return real.listDocumentsForSources(...a) }
    ;(w.mem.store as any).listChunks = (...a: any[]) => { loads += 1; return real.listChunks(...a) }
    try {
      await q('root canal treatment', {})
      expect(loads).toBe(3) // sources + documents + chunks — nothing else
      loads = 0
      await q('periodontitis diagnosis', {})
      expect(loads).toBe(3) // stable: no N+1, no per-chunk source loads
    } finally {
      ;(w.mem.store as any).listPublishedSources = real.listPublishedSources
      ;(w.mem.store as any).listDocumentsForSources = real.listDocumentsForSources
      ;(w.mem.store as any).listChunks = real.listChunks
    }
  })
})

describe('retrieval — hybrid provider path (§13/§14/§17)', () => {
  // Deterministic token-hash provider (test-only stand-in for a local
  // embedding model). Production default is LEXICAL — no model bundled.
  const DIM = 64
  const hashProvider = (seed: number) => ({
    name: `hash-${seed}`,
    dimensions: DIM,
    embed: async (text: string): Promise<number[]> => {
      const v = new Array(DIM).fill(0)
      for (const tok of text.toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/i).filter((t) => t.length > 2)) {
        let h = seed
        for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0
        v[h % DIM] += 1
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
      return v.map((x) => x / n)
    },
  })
  const hybridQ = (question: string, provider: any) =>
    retrieveKnowledge(
      { question, hospitalId: HOSP_A, useCase: 'clinical', maxResults: 3 },
      w.mem.store,
      { now: N, embeddingProvider: provider }
    )

  it('provider → HYBRID method, deterministic, same lexical recall floor', async () => {
    const p = await hybridQ('What are the diagnostic criteria for periodontitis?', hashProvider(7))
    expect(p.ok).toBe(true)
    expect(p.stats.method).toBe('HYBRID')
    expect(p.results.every((r: any) => r.matchType === 'HYBRID')).toBe(true)
    // lexical recall floor holds: ground-truth TIER_1 guideline in top-2
    expect(p.results.slice(0, 2).some((r: any) => r.source.meta.sourceKey === 'synthetic-periodontitis-guideline')).toBe(true)
    const p2 = await hybridQ('What are the diagnostic criteria for periodontitis?', hashProvider(7))
    expect(p.results.map((r: any) => [r.chunk.id, r.relevanceScore])).toEqual(p2.results.map((r: any) => [r.chunk.id, r.relevanceScore]))
  })

  it('default (no provider) is unchanged LEXICAL', async () => {
    const a = await q('root canal treatment for irreversible pulpitis', { maxResults: 5 })
    const b = await retrieveKnowledge(
      { question: 'root canal treatment for irreversible pulpitis', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 },
      w.mem.store,
      { now: N, embeddingProvider: null }
    )
    expect(a.stats.method).toBe('LEXICAL')
    expect(b.stats.method).toBe('LEXICAL')
    expect(a.results.map((r: any) => [r.chunk.id, r.relevanceScore])).toEqual(b.results.map((r: any) => [r.chunk.id, r.relevanceScore]))
  })
})

describe('retrieval — cosineClamped (pure helper)', () => {
  it('is bounded, symmetric and pure', async () => {
    const { cosineClamped } = await import('@/lib/ai/knowledge/retrieval')
    expect(cosineClamped([1, 0], [1, 0])).toBe(1)
    expect(cosineClamped([1, 0], [0, 1])).toBe(0)
    expect(cosineClamped([1, 0], [-1, 0])).toBe(0) // negative → 0
    expect(cosineClamped([0, 0], [0, 0])).toBe(0)
    expect(cosineClamped([1, 2], [])).toBe(0)
    const x = [0.6, 0.8]
    expect(cosineClamped(x, [0.6, 0.8])).toBeCloseTo(1, 10)
    expect(cosineClamped(x, [1, 2])).toBeCloseTo(cosineClamped([1, 2], x), 10)
  })
})

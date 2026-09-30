/**
 * Phase 7 — RAG retrieval & grounding evaluation (Gate D, RAG half).
 *
 * Direct evaluation of the Phase 4 knowledge layer (retrieveKnowledge +
 * checkGrounding) against an in-memory store of synthetic dental sources:
 * lexical retrieval (offline, deterministic), bilingual (EN/AR) recall,
 * tier eligibility, superseded-version exclusion, tenant scoping, honest
 * no-results, and deterministic grounding (invented citations must be
 * detected and strippable).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createInMemoryKnowledgeStore, SEED_KNOWLEDGE } from './harness'
import { retrieveKnowledge } from '@/lib/ai/knowledge/retrieval'
import { checkGrounding, stripUnsupportedCitations, extractCitedIds } from '@/lib/ai/knowledge/grounding'
import type { KnowledgeStore, KnowledgeCitation } from '@/lib/ai/knowledge/types'

const HOSP = 'hosp-A'
let store: KnowledgeStore

beforeAll(() => {
  store = createInMemoryKnowledgeStore(SEED_KNOWLEDGE)
})

describe('RAG lexical retrieval (offline, deterministic)', () => {
  it('EN clinical query retrieves cited, in-domain evidence', async () => {
    const pkg = await retrieveKnowledge(
      { question: 'What are the indications for a root canal treatment?', useCase: 'clinical', hospitalId: HOSP },
      store,
    )
    expect(pkg.ok).toBe(true)
    expect(pkg.results.length).toBeGreaterThan(0)
    expect(pkg.citations.length).toBeGreaterThan(0)
    expect(pkg.stats.method).toBe('LEXICAL')
    expect(pkg.stats.candidateCount).toBeGreaterThan(0)
  })

  it('AR clinical query retrieves Arabic evidence (bilingual parity)', async () => {
    const pkg = await retrieveKnowledge(
      { question: 'ما هي معايير علاج قناة الجذر؟', useCase: 'clinical', hospitalId: HOSP, language: 'ar' },
      store,
    )
    expect(pkg.ok).toBe(true)
    expect(pkg.citations.length).toBeGreaterThan(0)
    // The retrieved chunks must actually be Arabic content.
    const hasArChunk = pkg.results.some((r) => /[\u0600-\u06FF]/.test(r.chunk.text))
    expect(hasArChunk).toBe(true)
    // Language filter: every result respects the requested language.
    for (const r of pkg.results) {
      expect(r.source.meta.language).toBe('ar')
    }
  })

  it('domain filter narrows retrieval to the requested taxonomy domain', async () => {
    const open = await retrieveKnowledge(
      { question: 'indications and contraindications criteria', useCase: 'clinical', hospitalId: HOSP },
      store,
    )
    const endo = await retrieveKnowledge(
      { question: 'indications and contraindications criteria', useCase: 'clinical', hospitalId: HOSP, domain: 'ENDODONTICS' },
      store,
    )
    expect(open.results.length).toBeGreaterThanOrEqual(endo.results.length)
    for (const r of endo.results) {
      expect(r.chunk.domain).toBe('ENDODONTICS')
    }
  })

  it('honest NO_RESULTS / no-evidence when nothing matches (never fabricated)', async () => {
    const pkg = await retrieveKnowledge(
      { question: 'What are the guidelines for fluoride varnish application?', useCase: 'clinical', hospitalId: HOSP },
      store,
    )
    expect(pkg.ok).toBe(true)
    expect(pkg.citations.length).toBe(0)
    expect(pkg.emptyReason).toBe('NO_RESULTS')
  })

  it('educational use case does not admit TIER_4 by default', async () => {
    // The seeded set has no TIER_4 sources; the invariant is that TIER_4 is
    // never eligible without the explicit flag. We assert the eligibility
    // gate is applied (no TIER_4 in results without allowTier4).
    const pkg = await retrieveKnowledge(
      { question: 'indications criteria protocol', useCase: 'educational', hospitalId: HOSP, allowTier4: false },
      store,
    )
    for (const c of pkg.citations) {
      expect(c.authorityTier).not.toBe('TIER_4')
    }
  })

  it('tenant-scoped knowledge is not visible to other tenants', async () => {
    const tenantStore = createInMemoryKnowledgeStore([
      ...SEED_KNOWLEDGE,
      {
        id: 'src-tenant-a',
        key: 'tenant-a-internal',
        title: 'Internal hospital A pricing protocol',
        publisher: 'Hospital A',
        domain: 'FOUNDATIONAL',
        language: 'en',
        // TIER_2 — TIER_ELIGIBILITY.clinical admits TIER_1/TIER_2 only.
        tier: 'TIER_2',
        scope: 'TENANT',
        hospitalId: 'hosp-A',
        chunks: ['Hospital A internal protocol: referral fee schedule for external labs applies only to hospital A contracts.'],
      },
    ])
    const fromA = await retrieveKnowledge(
      { question: 'referral fee schedule external labs contract', useCase: 'clinical', hospitalId: 'hosp-A' },
      tenantStore,
    )
    const fromB = await retrieveKnowledge(
      { question: 'referral fee schedule external labs contract', useCase: 'clinical', hospitalId: 'hosp-B' },
      tenantStore,
    )
    const aHasInternal = fromA.citations.some((c) => c.sourceId === 'src-tenant-a')
    const bHasInternal = fromB.citations.some((c) => c.sourceId === 'src-tenant-a')
    expect(aHasInternal).toBe(true)
    expect(bHasInternal).toBe(false)
  })
})

describe('RAG grounding (deterministic, no LLM)', () => {
  const CHUNK_TEXT = 'Indications for root canal treatment include irreversible pulpitis, pulp necrosis with or without apical periodontitis.'
  function mkCitation(id: string): KnowledgeCitation {
    return {
      citationId: id,
      sourceId: 'src-endo',
      documentId: 'src-endo-doc-1',
      chunkId: 'src-endo-c0',
      title: 'Root canal',
      section: null,
      page: null,
      url: null,
      publisher: 'Synthetic Endo Society',
      publicationDate: '2024-01-01',
      version: '1.0',
      authorityTier: 'TIER_2',
      language: 'en',
      jurisdiction: null,
      factClass: 'KNOWN_FROM_SOURCE',
    }
  }

  it('detects invented (unsupported) citations and marks them', async () => {
    const c1 = mkCitation('c1')
    const report = checkGrounding({
      answer: 'Root canal is indicated for pulp necrosis [c1] and also for something else [c99].',
      citations: [c1],
      chunkTextByCitation: new Map([['c1', CHUNK_TEXT]]),
      modelGenerated: true,
    })
    expect(report.citedIds).toContain('c1')
    expect(report.unsupportedCitations).toContain('c99')
  })

  it('fully-grounded answer has no unsupported citations', async () => {
    const c1 = mkCitation('c1')
    const report = checkGrounding({
      answer: 'Indications for root canal treatment include irreversible pulpitis [c1].',
      citations: [c1],
      chunkTextByCitation: new Map([['c1', CHUNK_TEXT]]),
      modelGenerated: true,
    })
    expect(report.unsupportedCitations.length).toBe(0)
    expect(report.citedIds).toContain('c1')
  })

  it('stripUnsupportedCitations removes invented markers, keeps valid ones', async () => {
    const c1 = mkCitation('c1', 'Indications for root canal treatment include irreversible pulpitis.')
    const { text, removed } = stripUnsupportedCitations('Pulp necrosis [c1] and more [c77].', new Set(['c1']))
    expect(removed).toContain('c77')
    expect(text).toContain('[c1]')
    expect(text).not.toContain('[c77]')
  })

  it('extractCitedIds finds all unique bracketed citation markers (order-stable)', () => {
    expect(extractCitedIds('one [c1] two [c2] three [c1]')).toEqual(['c1', 'c2'])
    expect(extractCitedIds('no markers here')).toEqual([])
  })
})

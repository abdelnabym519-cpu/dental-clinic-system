// @ts-nocheck
/**
 * Phase 4 — Ingestion pipeline: deterministic stages, validation, dedup,
 * versioning, all-or-nothing, patient-data rejection (spec §8/§9/§10/§12).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryKnowledgeStore } from '@/lib/ai/knowledge/store'
import { ingest, detectPatientData } from '@/lib/ai/knowledge/ingestion'
import { NOW } from '@/tests/harness/context-fixtures'
import { buildKnowledgeTestWorld, CORPUS, PATIENT_LEAK_SOURCE } from '@/tests/harness/knowledge-fixtures'

let mem, idFactory
function factory() {
  let n = 0
  return () => `ks-${String(++n).padStart(3, '0')}`
}
const run = (input, store = mem.store) => ingest(input, store, { now: () => NOW, idFactory: factory() })

const baseSource = (over = {}) => ({
  sourceKey: 'src-test',
  title: 'Synthetic Source (TEST DATA)',
  publisher: 'Synthetic Publisher (TEST)',
  sourceType: 'GUIDELINE',
  authorityTier: 'TIER_1',
  domain: 'PERIODONTOLOGY',
  language: 'en',
  scope: 'GLOBAL',
  ...over,
})

beforeEach(() => {
  mem = createMemoryKnowledgeStore()
  idFactory = factory()
})

describe('ingestion pipeline', () => {
  it('publishes a valid source through all observable stages', async () => {
    const report = await run({ source: baseSource(), content: CORPUS.periodoV2.content })
    expect(report.status).toBe('PUBLISHED')
    expect(report.failure).toBeNull()
    const stages = report.stages.map((s) => s.stage)
    // order: exact-hash dedup (checksum) runs before the heavier near-dup scan
    expect(stages).toEqual(['validate', 'normalize', 'metadata', 'domain', 'chunking', 'checksum', 'dedup', 'index', 'validate_publish', 'publish'])
    for (const s of report.stages) expect(s.ok).toBe(true)
    expect(report.chunkCount).toBeGreaterThan(0)
    expect(report.contentHash).toMatch(/^[0-9a-f]{64}$/)
    // readback: one published document + its chunks
    const src = await mem.store.findSourceByKey('src-test')
    expect(src.status).toBe('PUBLISHED')
    const docs = await mem.store.listDocumentsBySource(src.id)
    expect(docs).toHaveLength(1)
    const chunks = await mem.store.listChunks([docs[0].id])
    expect(chunks).toHaveLength(report.chunkCount)
    expect(chunks.every((c) => c.checksum.length === 64)).toBe(true)
  })

  it('rejects invalid metadata with a typed code (no partial publish)', async () => {
    const report = await run({ source: baseSource({ authorityTier: 'TIER_9' }), content: CORPUS.periodoV2.content })
    expect(report.status).toBe('REJECTED')
    expect(report.failure.code).toBe('INVALID_QUERY')
    // nothing published — only a REJECTED observability record
    const published = await mem.store.listPublishedSources(null)
    expect(published.filter((s) => s.meta.sourceKey === 'src-test')).toHaveLength(0)
  })

  it('rejects TENANT scope without hospitalId', async () => {
    const report = await run({ source: baseSource({ scope: 'TENANT' }), content: CORPUS.periodoV2.content })
    expect(report.failure?.code).toBe('INVALID_QUERY')
  })

  it('rejects oversized content', async () => {
    const report = await run({ source: baseSource(), content: 'x'.repeat(2_000_001) })
    expect(report.failure?.code).toBe('OVERSIZED_CONTENT')
  })

  it('rejects content with control characters (malformed payloads)', async () => {
    const report = await run({ source: baseSource(), content: 'periodontitis\u001b[31m diagnosis' })
    expect(report.failure?.code).toBe('INVALID_QUERY')
  })

  it('rejects content matching no dental domain (no invented taxonomy)', async () => {
    const report = await run({
      source: baseSource({ domain: 'NOT_A_DOMAIN' }),
      content: '# Physics\nQuantum entanglement of photons across spacetime intervals.',
    })
    expect(report.failure?.code).toBe('TAXONOMY_UNKNOWN')
  })

  it('keeps unknown metadata UNKNOWN — never infers jurisdiction/dates', async () => {
    const report = await run({
      source: baseSource({ jurisdiction: undefined, publicationDate: undefined, version: undefined, lastUpdated: undefined }),
      content: CORPUS.unknownMeta.content,
    })
    expect(report.status).toBe('PUBLISHED')
    const src = await mem.store.findSourceByKey('src-test')
    expect(src.meta.jurisdiction).toBeNull()
    expect(src.meta.publicationDate).toBeNull()
    expect(src.meta.version).toBeNull()
  })

  it('rejects duplicated content (same hash, different source)', async () => {
    await run({ source: baseSource(), content: CORPUS.periodoV2.content })
    const dup = await run({ source: baseSource({ sourceKey: 'src-mirror' }), content: CORPUS.periodoV2.content })
    expect(dup.failure?.code).toBe('DUPLICATE_CONTENT')
    expect(await mem.store.listPublishedSources(null)).toHaveLength(1)
  })

  it('versions stay distinguishable: v2 supersedes v1, never deletes it', async () => {
    await run({ source: { ...CORPUS.periodoV1.source }, content: CORPUS.periodoV1.content })
    const r2 = await run({ source: { ...CORPUS.periodoV2.source }, content: CORPUS.periodoV2.content, replaceVersion: true })
    expect(r2.status).toBe('PUBLISHED')
    expect(r2.supersededDocumentIds).toHaveLength(1)
    const src = await mem.store.findSourceByKey('synthetic-periodontitis-guideline')
    const docs = await mem.store.listDocumentsBySource(src.id)
    expect(docs.map((d) => d.version).sort()).toEqual(['1', '2'])
    expect(docs.find((d) => d.version === '1').status).toBe('SUPERSEDED')
    expect(docs.find((d) => d.version === '2').status).toBe('PUBLISHED')
  })

  it('drops near-identical chunks against the existing corpus (partial dup)', async () => {
    const w = await buildKnowledgeTestWorld()
    expect(w.reports.partialDup.status).toBe('PUBLISHED')
    expect(w.reports.partialDup.duplicateChunkCount).toBe(1)
  })

  it('patient data is NEVER indexed (spec §8)', async () => {
    expect(detectPatientData('Patient PAT_A1 has caries on tooth 36')).toBe(true)
    expect(detectPatientData('Patient id: 12345. Chart #4521.')).toBe(true)
    expect(detectPatientData('caries treatment includes scaling and root planing')).toBe(false)
    expect(detectPatientData('Root canal treatment is indicated for irreversible pulpitis')).toBe(false)
    const report = await run({ source: { ...PATIENT_LEAK_SOURCE.source }, content: PATIENT_LEAK_SOURCE.content })
    expect(report.failure?.code).toBe('PATIENT_DATA_DETECTED')
    expect(await mem.store.listPublishedSources(null)).toHaveLength(0)
  })

  it('failed ingestion cannot partially publish (all-or-nothing commit)', async () => {
    // poison the store so the atomic commit fails mid-batch
    const realCommit = mem.store.commit
    mem.store.commit = async (batch) => {
      throw new Error('simulated index failure')
    }
    const report = await run({ source: baseSource(), content: CORPUS.periodoV2.content })
    expect(report.status).toBe('REJECTED')
    expect(report.failure?.code).toBe('INDEX_FAILURE')
    // nothing published
    expect(await mem.store.listPublishedSources(null)).toHaveLength(0)
    void realCommit
  })

  it('records rejected sources as observability rows (never retrievable)', async () => {
    await run({ source: baseSource({ sourceKey: 'bad', domain: undefined as any }), content: 'not dental content about quantum physics' })
    const src = await mem.store.findSourceByKey('bad')
    expect(src.status).toBe('REJECTED')
    expect(src.rejectReason).toBeTruthy()
    const visible = await mem.store.listPublishedSources(null)
    expect(visible.some((s) => s.meta.sourceKey === 'bad')).toBe(false)
  })
})

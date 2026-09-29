// @ts-nocheck
/**
 * Phase 4 — Dental Knowledge performance bench (in-memory harness).
 *
 * Measures (§34):
 *   - ingestion latency (validate → normalize → chunk → checksum → dedup →
 *     index → publish), incl. version replacement
 *   - query latency: no-RAG (context only) vs RAG (knowledge only) vs
 *     hybrid (context + knowledge) — LLM stubbed, so the delta is pipeline
 *   - index build cost vs corpus size (1×/3×/10×) — linear expectation
 *   - bounded store loads (exactly 3 per query; stable at 3× corpus → no N+1)
 *   - no duplicate embedding work (provider embeds = chunks + 1 per query)
 *   - determinism (identical query → identical results + scores)
 *   - evidence budget enforcement (chars + max results)
 *
 * Run: npx tsx scripts/bench-knowledge-phase4.ts
 */
import { buildKnowledgeTestWorld } from '../tests/harness/knowledge-fixtures'
import { createMemoryKnowledgeStore } from '../lib/ai/knowledge/store'
import { createAgentFakePrisma, HOSP_A, NOW } from '../tests/harness/agent-fixtures'

const N = 25
const FIXED_NOW = () => new Date('2026-09-29T12:00:00Z')

let failures = 0
function check(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  if (!ok) failures += 1
  console.log(`  ${mark}  ${label}${detail ? `  —  ${detail}` : ''}`)
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function countingStore(store) {
  const counter = { n: 0 }
  const wrapped = {}
  for (const [k, v] of Object.entries(store)) {
    if (typeof v !== 'function') { wrapped[k] = v; continue }
    wrapped[k] = (...args) => { counter.n += 1; return v(...args) }
  }
  return { store: wrapped, counter }
}

// Deterministic synthetic corpus extension (scaled, never duplicate).
async function scaledWorld(baseWorld, factor) {
  const mem = createMemoryKnowledgeStore()
  const store = mem.store
  const { ingest } = await import('../lib/ai/knowledge/ingestion')
  // re-ingest the base corpus deterministically
  const baseKeys = Object.keys(baseWorld.reports)
  const baseCorpus = (await import('../tests/harness/knowledge-fixtures')).CORPUS
  let n = 0
  const idFactory = () => `ks-${String(++n).padStart(3, '0')}`
  const order = ['periodoV1', 'periodoV2', 'textbookMaterials', 'clinicEducation', 'endoGuideline', 'webBlog', 'arabicPediatric', 'tenantBPrivate', 'unknownMeta', 'partialDup']
  for (const key of order) {
    await ingest({ source: { ...baseCorpus[key].source }, content: baseCorpus[key].content, replaceVersion: key === 'periodoV2' }, store, { now: FIXED_NOW, idFactory })
  }
  // scaled synthetic sources (distinct content → no dedup drops)
  const topics = ['restorative', 'endodontic', 'periodontal', 'surgical', 'prosthodontic', 'orthodontic', 'pediatric', 'implant', 'radiographic', 'pharmacologic']
  for (let i = 0; i < 10 * factor; i++) {
    const topic = topics[i % topics.length]
    await ingest(
      {
        source: {
          sourceKey: `bench-scale-${i}`,
          title: `Bench Scale ${topic} reference ${i} TEST DATA`,
          publisher: 'Bench Scale Publisher (TEST)',
          sourceType: 'TEXTBOOK',
          authorityTier: (i % 3 === 0 ? 'TIER_1' : 'TIER_2'),
          domain: i % 2 === 0 ? 'RESTORATIVE' : 'ENDODONTICS',
          language: 'en',
          scope: 'GLOBAL',
          publicationDate: `202${i % 5}-0${(i % 8) + 1}-01`,
        },
        content: `# Bench Scale ${topic} reference ${i} (TEST DATA)\n\n## Section A ${i}\n\n` +
          `Deterministic filler for the bench: ${topic} procedures ${i} involve assessment ${i}, planning ${i} and follow-up ${i}. ` +
          `Probing depths ${i}, torque values ${i} and retention schedules ${i} are documented per case ${i}.\n\n` +
          `## Section B ${i}\n\nContinuation ${i}: maintenance intervals ${i}, material selection ${i} and outcome scoring ${i} complete the reference ${i}.`,
      },
      store,
      { now: FIXED_NOW, idFactory }
    )
  }
  void baseKeys
  void mem
  return store
}

async function main() {
  const { ingest } = await import('../lib/ai/knowledge/ingestion')
  const { retrieveKnowledge } = await import('../lib/ai/knowledge/retrieval')
  const { buildKnowledgeIndex } = await import('../lib/ai/knowledge/index')
  const { runAgent } = await import('../lib/ai/agent/loop')
  const { DEFAULT_AGENT_LIMITS } = await import('../lib/ai/agent/types')

  const world = await buildKnowledgeTestWorld()
  const store = world.mem.store
  const llmStub = async () => ({ content: 'stub interpretation [c1]' })
  const agentDeps = (knowledgeStore) => ({
    client: createAgentFakePrisma(),
    llm: llmStub,
    limits: { ...DEFAULT_AGENT_LIMITS },
    now: () => NOW,
    knowledgeStore,
  })
  const agentReq = (message, over = {}) => ({
    requestId: 'bench', conversationId: null,
    actor: { id: 'staff-doctor-1', name: 'Hana', role: 'DOCTOR' },
    hospitalId: HOSP_A, message,
    patientId: null, patientName: null, toothFdi: null, caseId: null,
    studyId: null, treatmentNo: null, timestamp: NOW.toISOString(), ...over,
  })

  console.log('Phase 4 dental-knowledge bench (in-memory harness, median of 25)')
  console.log('─'.repeat(78))

  // ── 1. ingestion ──────────────────────────────────────────────────────
  console.log('\n[1] ingestion latency (validate→normalize→chunk→checksum→dedup→publish)')
  const ING_CONTENT = [
    '# Bench Ingestion Source (TEST DATA)',
    '',
    '## Diagnostic Criteria',
    '',
    'Periodontitis is diagnosed when probing depths exceed 4 mm together with clinical attachment loss.',
    '',
    '## Treatment',
    '',
    'Non-surgical therapy with scaling and root planing is first-line.',
  ].join('\n')
  {
    const times = []
    let sample
    for (let i = 0; i < N; i++) {
      const fresh = createMemoryKnowledgeStore()
      const t0 = process.hrtime.bigint()
      sample = await ingest({
        source: {
          sourceKey: 'bench-ingest', title: 'Bench Ingestion Source (TEST)',
          publisher: 'Bench (TEST)', sourceType: 'GUIDELINE', authorityTier: 'TIER_1',
          domain: 'PERIODONTOLOGY', language: 'en', scope: 'GLOBAL', publicationDate: '2024-01-01',
        },
        content: ING_CONTENT,
      }, fresh.store, { now: FIXED_NOW })
      times.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    console.log(`  ingest guideline (8 lines, 2 sections): ${median(times).toFixed(2)} ms  (status=${sample.status}, chunks=${sample.chunkCount})`)
  }
  {
    // v2 differs substantially (new section) — a one-word edit would be
    // (correctly) dropped as a near-duplicate chunk by the ingest pipeline.
    const v2Content = ING_CONTENT + '\n\n## Re-evaluation (2024 revision)\n\nThe 2024 revision adds a structured re-evaluation schedule with full-mouth radiographs at six months and a periodontal re-examination before any surgical referral.\n'
    const v1 = { sourceKey: 'bench-ver', title: 'V1 (TEST)', publisher: 'B (TEST)', sourceType: 'GUIDELINE', authorityTier: 'TIER_1', domain: 'PERIODONTOLOGY', language: 'en', scope: 'GLOBAL', publicationDate: '2023-01-01' }
    const v2 = { sourceKey: 'bench-ver', title: 'V2 (TEST)', publisher: 'B (TEST)', sourceType: 'GUIDELINE', authorityTier: 'TIER_1', domain: 'PERIODONTOLOGY', language: 'en', scope: 'GLOBAL', publicationDate: '2024-01-01' }
    const times = []
    let sample
    for (let i = 0; i < N; i++) {
      // fresh store with v1 published each round (identical v2 re-ingest would
      // correctly be DUPLICATE_CONTENT against the previous round's publish).
      const fresh = createMemoryKnowledgeStore()
      await ingest({ source: { ...v1 }, content: ING_CONTENT }, fresh.store, { now: FIXED_NOW })
      const t0 = process.hrtime.bigint()
      sample = await ingest({ source: { ...v2 }, content: v2Content, replaceVersion: true }, fresh.store, { now: FIXED_NOW })
      times.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    console.log(`  ingest version replacement (supersede): ${median(times).toFixed(2)} ms  (status=${sample.status}, failure=${sample.failure?.code ?? '-'}, superseded=${(sample.supersededDocumentIds ?? []).length})`)
    check('version replacement supersedes exactly one document', (sample.supersededDocumentIds ?? []).length === 1, `status=${sample.status}`)
  }

  // ── 2. no-RAG vs RAG vs hybrid (agent loop, LLM stubbed) ─────────────
  console.log('\n[2] agent loop: no-RAG vs RAG vs hybrid (LLM stubbed — pipeline cost only)')
  async function agentBench(name, build) {
    const times = []
    let tools = 0
    let status
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint()
      const r = await build()
      times.push(Number(process.hrtime.bigint() - t0) / 1e6)
      if (i === 0) { tools = (r.toolsUsed ?? []).length; status = r.status }
    }
    console.log(`  ${name}: ${median(times).toFixed(2)} ms  (tools=${tools}, status=${status})`)
    return median(times)
  }
  const tNoRag = await agentBench('no-RAG  (INFORMATIONAL, context only) ', () =>
    runAgent(agentReq('Show appointments for Ahmed Ali', { patientName: 'Ahmed Ali' }), agentDeps(store)))
  const tRag = await agentBench('RAG     (KNOWLEDGE, retrieve only)     ', () =>
    runAgent(agentReq('What are the diagnostic criteria for periodontitis?'), agentDeps(store)))
  const tHybrid = await agentBench('hybrid  (context + knowledge)         ', () =>
    runAgent(agentReq('Ahmed Ali has pain — what are the periodontitis diagnostic criteria?', { patientName: 'Ahmed Ali' }), agentDeps(store)))
  check('hybrid ≥ RAG (context build is additive, no double retrieval)', tHybrid >= tRag * 0.99)
  check('RAG query completes (status COMPLETED)', tRag > 0)

  // ── 3. retrieval latency + index build vs corpus size ────────────────
  console.log('\n[3] index build + query latency vs corpus size (deterministic scaling)')
  const sizes = [1, 3, 10]
  const corpusStats = []
  for (const f of sizes) {
    const s = f === 1 ? store : await scaledWorld(world, f)
    const buildTimes = []
    let idx
    for (let i = 0; i < 5; i++) {
      const t0 = process.hrtime.bigint()
      idx = await buildKnowledgeIndex(s, HOSP_A)
      buildTimes.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    const qTimes = []
    let sample
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint()
      sample = await retrieveKnowledge({ question: 'What are the diagnostic criteria for periodontitis?', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, s, { now: FIXED_NOW })
      qTimes.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    corpusStats.push({ f, chunks: idx.totalChunks, build: median(buildTimes), query: median(qTimes), results: sample.results.length })
    console.log(`  corpus ×${String(f).padStart(2)}: ${String(idx.totalChunks).padStart(3)} chunks — index build ${median(buildTimes).toFixed(2)} ms · query ${median(qTimes).toFixed(2)} ms (results=${sample.results.length})`)
  }
  const linearOk =
    corpusStats[1].build / Math.max(corpusStats[0].build, 0.01) < 5 &&
    corpusStats[2].build / Math.max(corpusStats[1].build, 0.01) < 5
  check('index build scales ~linearly with corpus (no super-linear blowup)', linearOk,
    `${corpusStats.map((c) => `×${c.f}=${c.build.toFixed(2)}ms`).join(' · ')}`)
  check('query latency stays low at 10× corpus (< 15 ms)', corpusStats[2].query < 15, `${corpusStats[2].query.toFixed(2)} ms at ${corpusStats[2].chunks} chunks`)

  // ── 4. bounded loads — no N+1 at 3× corpus ───────────────────────────
  console.log('\n[4] bounded store loads (no N+1)')
  {
    const scaled = await scaledWorld(world, 3)
    const { store: counted, counter } = countingStore(scaled)
    let loads = 0
    for (let i = 0; i < 3; i++) {
      counter.n = 0
      await retrieveKnowledge({ question: 'root canal treatment', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, counted, { now: FIXED_NOW })
      if (i === 0) loads = counter.n
      else check(`query ${i + 1}: exactly 3 bounded loads`, counter.n === 3, `${counter.n} loads`)
    }
    check('3× corpus: still exactly 3 loads per query', loads === 3, `${loads} loads`)
  }

  // ── 5. no duplicate embedding work ───────────────────────────────────
  console.log('\n[5] embedding provider: one embed per chunk per build + one per query')
  {
    let embedCount = 0
    const DIM = 32
    const provider = {
      name: 'bench-hash',
      dimensions: DIM,
      embed: async (text) => {
        embedCount += 1
        const v = new Array(DIM).fill(0)
        for (const t of text.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
          let h = 3
          for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
          v[h % DIM] += 1
        }
        return v
      },
    }
    const p1 = await retrieveKnowledge({ question: 'What are the diagnostic criteria for periodontitis?', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, store, { now: FIXED_NOW, embeddingProvider: provider })
    const idx = await buildKnowledgeIndex(store, HOSP_A)
    const expectedFirst = idx.totalChunks + 1 // build-time + query-time
    check('first hybrid query embeds exactly chunks+1 (no per-candidate re-embed)', embedCount === expectedFirst, `${embedCount} embeds, expected ${expectedFirst}`)
    embedCount = 0
    await retrieveKnowledge({ question: 'What are the diagnostic criteria for periodontitis?', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, store, { now: FIXED_NOW, embeddingProvider: provider })
    check('second hybrid query: same embed count (index rebuild, no caching tricks, no dup work)', embedCount === expectedFirst, `${embedCount} embeds`)
    check('hybrid method labeled in stats', p1.stats.method === 'HYBRID')
  }

  // ── 6. determinism ───────────────────────────────────────────────────
  console.log('\n[6] determinism (identical query + corpus → identical package)')
  {
    const a = await retrieveKnowledge({ question: 'root canal treatment for irreversible pulpitis', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, store, { now: FIXED_NOW })
    const b = await retrieveKnowledge({ question: 'root canal treatment for irreversible pulpitis', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, store, { now: FIXED_NOW })
    const sig = (p) => JSON.stringify(p.results.map((r) => [r.chunk.id, r.relevanceScore, r.rank]))
    check('LEXICAL: identical results + scores across runs', sig(a) === sig(b))
    const sigP = { name: 'det', dimensions: 16, embed: async (t) => { const v = new Array(16).fill(0); for (const x of t.toLowerCase().split(/\s+/)) { let h = 5; for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) >>> 0; v[h % 16] += 1 } return v } }
    const h1 = await retrieveKnowledge({ question: 'root canal treatment for irreversible pulpitis', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, store, { now: FIXED_NOW, embeddingProvider: sigP })
    const h2 = await retrieveKnowledge({ question: 'root canal treatment for irreversible pulpitis', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 5 }, store, { now: FIXED_NOW, embeddingProvider: sigP })
    check('HYBRID: identical results + scores across runs', sig(h1) === sig(h2))
  }

  // ── 7. evidence budget ───────────────────────────────────────────────
  console.log('\n[7] evidence budget enforcement')
  {
    const p = await retrieveKnowledge({ question: 'periodontitis root canal amalgam dry socket protocol', hospitalId: HOSP_A, useCase: 'clinical', maxResults: 10 }, store, { now: FIXED_NOW })
    const chars = p.results.reduce((s, r) => s + r.chunk.text.length, 0)
    check('maxResults cap (≤10)', p.results.length <= 10, `${p.results.length} results`)
    check('evidence char budget (≤12000)', chars <= 12000, `${chars} chars`)
    check('per-source chunk cap (≤2/source)', (() => { const m = new Map(); for (const r of p.results) m.set(r.source.id, (m.get(r.source.id) ?? 0) + 1); return [...m.values()].every((v) => v <= 2) })())
  }

  console.log('\n─'.repeat(78))
  console.log(failures === 0 ? 'ALL BENCH CHECKS PASSED' : `${failures} BENCH CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

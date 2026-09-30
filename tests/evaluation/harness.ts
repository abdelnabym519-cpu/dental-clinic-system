/**
 * Phase 7 — evaluation test harness (shared by all suites).
 *
 * Thin glue over lib/ai/evaluation: run a golden case through the REAL
 * agent loop, compare observed behavior, and collect the typed checks.
 * Suites stay small; the behavior lives in the library.
 */
import path from 'node:path'
import {
  loadGoldenDataset, selectCases,
  type GoldenDataset, type GoldenCase, type EvaluationResult, type EvalCheck,
} from '@/lib/ai/evaluation'
import { replayAgentCase, compareBehavior, observe, makeScriptedLlm, makeFakeLocalAiService, type ReplayOverrides } from '@/lib/ai/evaluation/replay'
import { makeResult } from '@/lib/ai/evaluation/results'

export function goldenPath(name: string): string {
  return path.join(__dirname, 'golden', name)
}

export function loadSuiteDatasets(names: string[]): GoldenDataset[] {
  return names.map((n) => loadGoldenDataset(goldenPath(n)))
}

export interface CaseEvaluation {
  case: GoldenCase
  result: EvaluationResult
  observed: ReturnType<typeof observe>
}

/** Evaluate ONE golden case through the real loop (UNIT_REPLAY). */
export async function evaluateCase(
  suite: string,
  c: GoldenCase,
  overrides: ReplayOverrides = {},
): Promise<CaseEvaluation> {
  const t0 = Date.now()
  const outcome = await replayAgentCase(c, overrides)
  const checks = compareBehavior(c, outcome.observed)
  const result = makeResult(suite, c.caseId, checks, Date.now() - t0)
  return { case: c, result, observed: outcome.observed }
}

/** Evaluate a whole (filtered) golden set. */
export async function evaluateDataset(
  suite: string,
  datasets: GoldenDataset[],
  filter: { category?: GoldenCase['category']; tag?: string; caseIds?: string[] } = {},
  overridesFor?: (c: GoldenCase) => ReplayOverrides,
): Promise<{ evaluations: CaseEvaluation[]; checks: EvalCheck[]; results: EvaluationResult[] }> {
  const cases = selectCases(datasets, filter)
  const evaluations: CaseEvaluation[] = []
  for (const c of cases) {
    evaluations.push(await evaluateCase(suite, c, overridesFor?.(c) ?? {}))
  }
  return {
    evaluations,
    checks: evaluations.flatMap((e) => e.result.checks),
    results: evaluations.map((e) => e.result),
  }
}

/** Assertion helper: every check must be non-FAIL (BLOCKED/NOT_APPLICABLE
 *  allowed only when the caller explicitly expects them). */
export function assertNoFailures(
  checks: EvalCheck[],
  opts: { allowBlocked?: boolean; allowNotApplicable?: boolean } = {},
): void {
  const bad = checks.filter((c) => c.verdict === 'FAIL')
  if (bad.length > 0) {
    const lines = bad.map((c) => `  ✗ [${c.code}] ${c.id}: ${c.detail}`).join('\n')
    throw new Error(`EVALUATION FAILURES:\n${lines}`)
  }
  if (!opts.allowBlocked) {
    const blocked = checks.filter((c) => c.verdict === 'BLOCKED_ENVIRONMENT')
    if (blocked.length > 0) {
      throw new Error(`Unexpected BLOCKED_ENVIRONMENT checks:\n${blocked.map((c) => `  ⛔ ${c.id}: ${c.reason ?? c.detail}`).join('\n')}`)
    }
  }
}

/** Collect the typed failure codes across results (for gate reporting). */
export function failureCodeCounts(results: EvaluationResult[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of results) for (const code of r.failureCodes) counts[code] = (counts[code] ?? 0) + 1
  return counts
}

// ---------------------------------------------------------------------------
// In-memory KnowledgeStore (synthetic dental knowledge only)
// ---------------------------------------------------------------------------
import type {
  KnowledgeSource, KnowledgeDocument, KnowledgeChunk, KnowledgeStore,
  KnowledgeSourceMeta, CommitBatch, CommitReceipt, IngestionReport,
} from '@/lib/ai/knowledge/types'

export interface SeedSource {
  id: string
  key: string
  title: string
  publisher: string
  domain: string
  subtopic?: string | null
  language: 'en' | 'ar'
  tier?: 'TIER_1' | 'TIER_2' | 'TIER_3'
  jurisdiction?: string | null
  scope?: 'GLOBAL' | 'TENANT'
  hospitalId?: string | null
  /** Chunk texts (each becomes a retrievable chunk with the source domain). */
  chunks: string[]
}

function chunkChecksum(text: string): string {
  // Deterministic short checksum (not security-critical here).
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/**
 * Build an in-memory KnowledgeStore over synthetic sources. Only the read
 * surface retrieval uses (listPublishedSources / listDocumentsForSources /
 * listChunks) is fully implemented; the rest are honest no-ops.
 */
export function createInMemoryKnowledgeStore(seeds: SeedSource[]): KnowledgeStore {
  const sources: KnowledgeSource[] = []
  const documents: KnowledgeDocument[] = []
  const chunks: KnowledgeChunk[] = []

  for (const s of seeds) {
    const meta: KnowledgeSourceMeta = {
      sourceKey: s.key,
      title: s.title,
      publisher: s.publisher,
      authors: null,
      publicationDate: '2024-01-01',
      lastUpdated: '2024-01-01',
      reference: `https://example.dental/${s.key}`,
      sourceType: 'GUIDELINE',
      authorityTier: s.tier ?? 'TIER_2',
      domain: s.domain,
      subtopic: s.subtopic ?? null,
      jurisdiction: s.jurisdiction ?? null,
      language: s.language,
      version: '1.0',
      license: 'synthetic',
      scope: s.scope ?? 'GLOBAL',
      hospitalId: s.hospitalId ?? null,
    }
    const source: KnowledgeSource = {
      id: s.id, meta, status: 'PUBLISHED', rejectReason: null, createdAt: '2024-01-01T00:00:00.000Z',
    }
    const contentText = s.chunks.join('\n\n')
    const doc: KnowledgeDocument = {
      id: `${s.id}-doc-1`,
      sourceId: s.id,
      version: '1',
      title: s.title,
      contentText,
      contentHash: chunkChecksum(contentText),
      language: s.language,
      wordCount: contentText.split(/\s+/).length,
      status: 'PUBLISHED',
      ingestedAt: '2024-01-01T00:00:00.000Z',
      supersededBy: null,
      ingestion: null,
    }
    s.chunks.forEach((text, i) => {
      chunks.push({
        id: `${s.id}-c${i}`,
        documentId: doc.id,
        sourceId: s.id,
        domain: s.domain,
        subtopic: s.subtopic ?? null,
        section: s.title,
        position: i,
        text,
        tokenCount: Math.max(1, text.split(/\s+/).length),
        checksum: chunkChecksum(text),
        language: s.language,
      })
    })
    sources.push(source)
    documents.push(doc)
  }

  return {
    findSourceByKey: async (sourceKey) => sources.find((s) => s.meta.sourceKey === sourceKey) ?? null,
    listDocumentsBySource: async (sourceId) => documents.filter((d) => d.sourceId === sourceId),
    findPublishedByContentHash: async (hash) => documents.find((d) => d.contentHash === hash && d.status === 'PUBLISHED') ?? null,
    listPublishedSources: async (hospitalId) =>
      sources.filter((s) => {
        if (s.status !== 'PUBLISHED') return false
        if (s.meta.scope === 'TENANT') return hospitalId !== null && s.meta.hospitalId === hospitalId
        return true
      }),
    listDocumentsForSources: async (sourceIds, includeSuperseded) =>
      documents.filter((d) => sourceIds.includes(d.sourceId) && (includeSuperseded || d.status === 'PUBLISHED')),
    listChunks: async (documentIds) => chunks.filter((c) => documentIds.includes(c.documentId)),
    listAllChunks: async () => chunks,
    commit: async (batch: CommitBatch): Promise<CommitReceipt> => {
      throw new Error('in-memory eval store is read-only')
    },
    recordRejectedSource: async () => { /* observability no-op */ },
    updateDocumentIngestion: async (_documentId: string, _report: IngestionReport) => { /* no-op */ },
  }
}

// ---------------------------------------------------------------------------
// The seeded synthetic dental knowledge set (bilingual, multi-domain).
// Content is GENERIC educational/diagnostic language — never a claim about
// any real patient, and deliberately NOT a clinical-accuracy assertion.
// ---------------------------------------------------------------------------
export const SEED_KNOWLEDGE: SeedSource[] = [
  {
    id: 'src-endo',
    key: 'endo-root-canal- indications',
    title: 'Root canal treatment: indications and contraindications',
    publisher: 'Synthetic Endo Society',
    domain: 'ENDODONTICS',
    subtopic: 'vital-pulp-therapy',
    language: 'en',
    tier: 'TIER_2',
    jurisdiction: null,
    chunks: [
      'Indications for root canal treatment include irreversible pulpitis, pulp necrosis with or without apical periodontitis, and certain cracked teeth where the pulp is no longer vital. Conservative pulp-therapy options should be considered when the pulp is still vital and reversible.',
      'Contraindications to non-surgical endodontic treatment include strategic teeth that are not restorable, insufficient periodontal support, and patient medical conditions that preclude local anaesthesia. Referral to a specialist is appropriate for retreatment and surgical cases.',
    ],
  },
  {
    id: 'src-resto',
    key: 'resto-composite-indications',
    title: 'Composite restorations: indications and technique',
    publisher: 'Synthetic Restorative Council',
    domain: 'RESTORATIVE',
    subtopic: 'direct-restorations',
    language: 'en',
    tier: 'TIER_2',
    jurisdiction: null,
    chunks: [
      'Composite resin restorations are indicated for small to moderate Class I and Class II cavities, anterior aesthetic repairs, and minimally invasive conservative dentistry. Adequate isolation and incremental layering are essential for durability.',
      'Relative contraindications to composite include large load-bearing occlusal surfaces where a full-coverage restoration may be preferred, and patients with parafunction that increases the risk of wear or fracture.',
    ],
  },
  {
    id: 'src-perio',
    key: 'perio-gingivitis-criteria',
    title: 'Gingivitis and periodontitis: diagnostic criteria',
    publisher: 'Synthetic Periodontology Board',
    domain: 'PERIODONTOLOGY',
    subtopic: 'diagnosis',
    language: 'en',
    tier: 'TIER_1',
    jurisdiction: null,
    chunks: [
      'Gingivitis is characterized by clinical inflammation of the gingiva without loss of attachment. Periodontitis is diagnosed when there is radiographic or clinical evidence of attachment loss, typically staged and graded by severity and rate of progression.',
      'Diagnostic criteria for periodontitis include probing depth, clinical attachment level, radiographic bone level, and the extent of affected sites. Risk factors such as smoking and systemic disease are recorded to guide prognosis.',
    ],
  },
  {
    id: 'src-endo-ar',
    key: 'endo-root-canal-ar',
    title: 'علاج عصب السن: الدواعي',
    publisher: 'Synthetic Endo Society (AR)',
    domain: 'ENDODONTICS',
    subtopic: 'vital-pulp-therapy',
    language: 'ar',
    tier: 'TIER_2',
    jurisdiction: null,
    chunks: [
      'تشمل دواعي علاج قناة الجذر التهاب اللب غير القابل للانعكاس، ونخر اللب مع وجود التهاب حول القمة أو بدونه. ويجب مراعاة خيارات علاج اللب التحفظية عندما يكون اللب حيًا وقابلًا للشفاء.',
    ],
  },
  {
    id: 'src-ortho-ar',
    key: 'ortho-braces-indications-ar',
    title: 'دواعي تقويم الأسنان',
    publisher: 'Synthetic Ortho Academy (AR)',
    domain: 'ORTHODONTICS',
    subtopic: 'indications',
    language: 'ar',
    tier: 'TIER_2',
    jurisdiction: null,
    chunks: [
      'تشمل دواعي تقويم الأسنان التراكيب غير الطبيعية، والازدحام السني، والفراغات، والتعاضد غير الطبيعي، والحاجات الوظيفية أو الجمالية. يحدد الطبيب خطة العلاج حسب عمر المريض ونوع الحالة.',
    ],
  },
]

/** Re-observe an already-run response (replay determinism checks). */
export { observe, makeScriptedLlm, makeFakeLocalAiService }

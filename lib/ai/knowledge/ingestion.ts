/**
 * Phase 4 — Deterministic ingestion pipeline (spec §9/§10/§12).
 *
 *   load → validate → normalize → metadata → domain → chunking → dedup
 *       → checksum → index (atomic commit) → validate (readback) → publish
 *
 * Guarantees:
 *   - every stage is observable (IngestionStageReport per stage);
 *   - a failed ingestion NEVER produces a partially published source
 *     (the only write before the final commit is a single REJECTED source
 *     record for observability);
 *   - all source content is treated strictly as DATA (untrusted);
 *   - patient-specific content is REJECTED, never indexed (spec §8);
 *   - identical content is never indexed twice (spec §12); versions of the
 *     same source stay distinguishable (SUPERSEDED, never deleted).
 */
import { chunkContent, type ChunkUnit } from './chunking'
import { chunkChecksum, contentHash, normalizeForHash } from './checksum'
import { detectDomains, isKnowledgeDomain } from './taxonomy'
import {
  KNOWLEDGE_SCOPES, SOURCE_TIERS, SOURCE_TYPES,
  type CommitBatch, type IngestInput, type IngestionFailureCode,
  type IngestionReport, type IngestionStageReport, type KnowledgeChunk,
  type KnowledgeDocument, type KnowledgeSource, type KnowledgeStore, type KnowledgeSourceMeta,
} from './types'

export const MAX_CONTENT_CHARS = 2_000_000
export const NEAR_DUP_JACCARD = 0.92

// ---------------------------------------------------------------------------
// Patient-data detection (spec §8 — defense in depth at ingestion time)
// Conservative: flags only explicit patient-record markers. General dental
// text ("caries treatment is…") must pass.
// ---------------------------------------------------------------------------
const PATIENT_DATA_PATTERNS: RegExp[] = [
  /\bpatient\s+(?:id|identifier|number|no\.?|chart|record|file|code)\s*[:#]?\s*\S+/i,
  /\b(PAT[_-][A-Z0-9-]{2,})\b/i,
  /\bpatient\s+[a-z]+(?:\s+[a-z]+)?\s+has\b/i, // "Patient X has …"
  /\b(?:chart|record|file)\s+(?:no\.?|number)\s*[:#]?\s*\d{3,}\b/i,
  /\bnational\s+id(?:entifier)?\s*[:#]?\s*\d{14}\b/i,
  /\b[123]\d{13}\b/, // Egyptian national ID shape (14 digits)
  /\bchart\s*#\s*\d{3,}\b/i,
]

export function detectPatientData(text: string): boolean {
  return PATIENT_DATA_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------

interface Work {
  normalized: string
  meta: KnowledgeSourceMeta | null
  domain: string | null
  units: ChunkUnit[]
  docHash: string
  droppedNearDup: number
  document: KnowledgeDocument | null
  chunks: KnowledgeChunk[]
  superseded: string[]
}

interface Ctx {
  input: IngestInput
  store: KnowledgeStore
  now: () => Date
  idFactory: () => string
  report: IngestionReport
  stages: IngestionStageReport[]
  work: Work
}

async function stage(ctx: Ctx, name: IngestionStageReport['stage'], fn: () => void | Promise<void>): Promise<void> {
  const t0 = Date.now()
  try {
    await fn()
    ctx.stages.push({ stage: name, ok: true, durationMs: Date.now() - t0 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.stages.push({ stage: name, ok: false, detail: message, durationMs: Date.now() - t0 })
    throw err // preserve the typed code, if any
  }
}

function fail(code: IngestionFailureCode, message: string): never {
  const err = new Error(`${code}: ${message}`) as Error & { code: IngestionFailureCode }
  err.code = code
  throw err
}

function codeForStage(stages: IngestionStageReport[]): IngestionFailureCode {
  const failed = [...stages].reverse().find((s) => !s.ok)
  switch (failed?.stage) {
    case 'validate':
    case 'normalize':
    case 'metadata':
    case 'domain':
    case 'chunking':
      return failed?.detail?.startsWith('DUPLICATE') ? 'DUPLICATE_CONTENT' : 'INVALID_QUERY'
    case 'checksum':
    case 'dedup':
      return 'DUPLICATE_CONTENT'
    case 'index':
    case 'validate_publish':
      return 'INDEX_FAILURE'
    default:
      return 'INGESTION_FAILED'
  }
}

// ---------------------------------------------------------------------------

export interface IngestOptions {
  now?: () => Date
  idFactory?: () => string
}

export async function ingest(input: IngestInput, store: KnowledgeStore, opts: IngestOptions = {}): Promise<IngestionReport> {
  const now = opts.now ?? (() => new Date())
  const idFactory = opts.idFactory ?? (() => `ks-${Math.random().toString(36).slice(2, 12)}`)
  const ctx: Ctx = {
    input,
    store,
    now,
    idFactory,
    report: {
      queryId: `ing-${Date.now().toString(36)}`,
      sourceKey: input.source.sourceKey,
      status: 'PUBLISHED',
      failure: null,
      stages: [],
      totalDurationMs: 0,
    },
    stages: [],
    work: {
      normalized: '',
      meta: null,
      domain: null,
      units: [],
      docHash: '',
      droppedNearDup: 0,
      document: null,
      chunks: [],
      superseded: [],
    },
  }
  const t0 = Date.now()

  try {
    // ── validate ──────────────────────────────────────────────────────────
    await stage(ctx, 'validate', () => {
      const s = input.source
      if (!s.sourceKey?.trim()) fail('INVALID_QUERY', 'sourceKey is required')
      if (!s.title?.trim()) fail('INVALID_QUERY', 'title is required')
      if (!s.publisher?.trim()) fail('INVALID_QUERY', 'publisher is required')
      if (!SOURCE_TYPES.includes(s.sourceType)) fail('INVALID_QUERY', `unknown sourceType: ${s.sourceType}`)
      if (!SOURCE_TIERS.includes(s.authorityTier)) fail('INVALID_QUERY', `unknown authorityTier: ${s.authorityTier}`)
      if (!s.language?.trim()) fail('INVALID_QUERY', 'language is required')
      if (!KNOWLEDGE_SCOPES.includes(s.scope)) fail('INVALID_QUERY', 'scope must be GLOBAL or TENANT')
      if (s.scope === 'TENANT' && !s.hospitalId) fail('INVALID_QUERY', 'TENANT scope requires hospitalId')
      if (s.reference && !/^(https?:\/\/|doi:|urn:)/i.test(s.reference)) fail('INVALID_QUERY', 'reference must be a URL/DOI/URN')
      if (s.publicationDate && Number.isNaN(Date.parse(s.publicationDate))) fail('INVALID_QUERY', 'publicationDate must be ISO')
      if (s.lastUpdated && Number.isNaN(Date.parse(s.lastUpdated))) fail('INVALID_QUERY', 'lastUpdated must be ISO')
      const content = input.content
      if (!content || !content.trim()) fail('INVALID_QUERY', 'content is empty')
      if (content.length > MAX_CONTENT_CHARS) fail('OVERSIZED_CONTENT', `content exceeds ${MAX_CONTENT_CHARS} chars`)
      if (/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Z} \t\n\r]/u.test(content)) fail('INVALID_QUERY', 'content contains unsupported control characters')
      if (detectPatientData(content)) fail('PATIENT_DATA_DETECTED', 'content contains patient-record markers — patient data is never indexed into the knowledge layer')
    })

    // ── normalize (NFKC, structure preserved; hashing collapses whitespace) ─
    await stage(ctx, 'normalize', () => {
      ctx.work.normalized = input.content.normalize('NFKC')
      if (!normalizeForHash(ctx.work.normalized)) fail('INVALID_QUERY', 'content is empty after normalization')
    })

    // ── metadata (unknown stays UNKNOWN — never inferred) ─────────────────
    await stage(ctx, 'metadata', () => {
      ctx.work.meta = {
        ...input.source,
        sourceKey: input.source.sourceKey.trim(),
        authors: input.source.authors ?? null,
        publicationDate: input.source.publicationDate ?? null,
        lastUpdated: input.source.lastUpdated ?? null,
        reference: input.source.reference ?? null,
        subtopic: input.source.subtopic ?? null,
        jurisdiction: input.source.jurisdiction ?? null, // never inferred
        version: input.source.version ?? null,
        license: input.source.license ?? null,
      }
    })

    // ── domain (deterministic taxonomy) ───────────────────────────────────
    await stage(ctx, 'domain', () => {
      const meta = ctx.work.meta!
      if (isKnowledgeDomain(meta.domain)) {
        ctx.work.domain = meta.domain
      } else {
        const detected = detectDomains(`${meta.title} ${ctx.work.normalized.slice(0, 4000)}`)
        if (!detected.length) fail('TAXONOMY_UNKNOWN', 'content does not match any controlled dental domain')
        ctx.work.domain = detected[0].domain
      }
    })

    // ── chunking ──────────────────────────────────────────────────────────
    await stage(ctx, 'chunking', () => {
      ctx.work.units = chunkContent(ctx.work.normalized)
      if (!ctx.work.units.length) fail('INVALID_QUERY', 'content produced no chunks')
    })

    // ── checksum + corpus-level dedup ─────────────────────────────────────
    await stage(ctx, 'checksum', async () => {
      ctx.work.docHash = contentHash(ctx.work.normalized)
      const existing = await ctx.store.findPublishedByContentHash(ctx.work.docHash)
      if (existing) fail('DUPLICATE_CONTENT', `identical content already published (document ${existing.id})`)
    })

    // ── dedup (near-identical chunks, same domain) ────────────────────────
    await stage(ctx, 'dedup', async () => {
      const meta = ctx.work.meta!
      const corpus = await ctx.store.listAllChunks(meta.scope === 'TENANT' ? (meta.hospitalId ?? null) : null)
      const sameDomain = corpus.filter((c) => c.domain === ctx.work.domain)
      const newTokens = ctx.work.units.map((u) => tokenSet(u.text))
      const kept = ctx.work.units.filter((u, i) => {
        const dup = sameDomain.some((c) => jaccard(newTokens[i], tokenSet(c.text)) >= NEAR_DUP_JACCARD)
        if (dup) ctx.work.droppedNearDup += 1
        return !dup
      })
      if (!kept.length) fail('DUPLICATE_CONTENT', 'all chunks are near-identical to existing published content')
      ctx.work.units = kept
    })

    // ── index (single atomic commit — all or nothing) ─────────────────────
    await stage(ctx, 'index', async () => {
      const meta = ctx.work.meta!
      const domain = ctx.work.domain!
      const existingSource = await ctx.store.findSourceByKey(meta.sourceKey)
      const existingDocs = existingSource ? await ctx.store.listDocumentsBySource(existingSource.id) : []
      const version = meta.version ?? String(existingDocs.length + 1)
      const sourceId = existingSource?.id ?? ctx.idFactory()
      const docId = ctx.idFactory()

      const source: KnowledgeSource = {
        id: sourceId,
        meta: { ...meta, domain },
        status: 'PUBLISHED',
        rejectReason: null,
        createdAt: existingSource?.createdAt ?? now().toISOString(),
      }
      const document: KnowledgeDocument = {
        id: docId,
        sourceId,
        version,
        title: meta.title,
        contentText: ctx.work.normalized,
        contentHash: ctx.work.docHash,
        language: meta.language,
        wordCount: ctx.work.normalized.split(/\s+/).filter(Boolean).length,
        status: 'PUBLISHED',
        ingestedAt: now().toISOString(),
        supersededBy: null,
        ingestion: null,
      }
      const chunks: KnowledgeChunk[] = ctx.work.units.map((u, i) => ({
        id: ctx.idFactory(),
        documentId: docId,
        sourceId,
        domain,
        subtopic: meta.subtopic ?? null,
        section: u.section,
        position: i,
        text: u.text,
        tokenCount: u.text.split(/\s+/).filter(Boolean).length,
        checksum: chunkChecksum(u.text),
        language: meta.language,
      }))

      ctx.work.superseded = input.replaceVersion
        ? existingDocs.filter((d) => d.status === 'PUBLISHED').map((d) => d.id)
        : []

      const batch: CommitBatch = { source, document, chunks, supersedeDocumentIds: ctx.work.superseded }
      const receipt = await ctx.store.commit(batch)
      if (receipt.chunkIds.length !== chunks.length) fail('INDEX_FAILURE', 'commit did not persist all chunks')

      ctx.work.document = document
      ctx.work.chunks = chunks
      ctx.report.contentHash = ctx.work.docHash
      ctx.report.chunkCount = chunks.length
      ctx.report.duplicateChunkCount = ctx.work.droppedNearDup
      ctx.report.supersededDocumentIds = receipt.supersededDocumentIds
    })

    // ── validate (readback before the request succeeds) ───────────────────
    await stage(ctx, 'validate_publish', async () => {
      const doc = ctx.work.document!
      const docs = await ctx.store.listDocumentsBySource(doc.sourceId)
      const mine = docs.find((d) => d.id === doc.id && d.status === 'PUBLISHED' && d.contentHash === doc.contentHash)
      if (!mine) throw new Error('readback: published document not found')
      const back = await ctx.store.listChunks([mine.id])
      if (back.length !== ctx.work.chunks.length) throw new Error(`readback: expected ${ctx.work.chunks.length} chunks, found ${back.length}`)
    })

    // ── publish (observability record) ────────────────────────────────────
    await stage(ctx, 'publish', async () => {
      ctx.report.totalDurationMs = Date.now() - t0
      const doc = ctx.work.document!
      await ctx.store.updateDocumentIngestion(doc.id, { ...ctx.report })
      ctx.work.document = { ...doc, ingestion: { ...ctx.report } }
    })

    ctx.report.stages = ctx.stages
    ctx.report.totalDurationMs = Date.now() - t0
    return ctx.report
  } catch (err) {
    const e = err as Error & { code?: IngestionFailureCode }
    const code = e?.code ?? codeForStage(ctx.stages)
    ctx.report.status = 'REJECTED'
    ctx.report.stages = ctx.stages
    ctx.report.failure = { code, message: e?.message ?? 'ingestion failed' }
    ctx.report.totalDurationMs = Date.now() - t0
    // Observability-only: record the rejection (single atomic write).
    // Never retrievable — REJECTED sources are excluded from all retrieval.
    try {
      await ctx.store.recordRejectedSource(ctx.input.source, code)
    } catch {
      // recording the rejection must never mask the original failure
    }
    return ctx.report
  }
}

// ---------------------------------------------------------------------------

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter((t) => t.length > 2))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

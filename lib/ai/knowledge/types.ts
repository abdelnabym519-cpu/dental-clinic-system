/**
 * Phase 4 — Dental Knowledge Layer contracts.
 *
 * Strongly typed, no `any`. These are the boundary types between the
 * knowledge layer (ingestion/index/retrieval) and the agent (tools/loop).
 * All metadata is server-authoritative: the LLM and client never set tier,
 * publication date, checksum, citations or tenant scope.
 */

// ---------------------------------------------------------------------------
// Source policy (spec §5)
// ---------------------------------------------------------------------------

export const SOURCE_TIERS = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4'] as const
export type SourceTier = (typeof SOURCE_TIERS)[number]

/**
 * Default eligibility per use case. TIER_4 is NEVER eligible for clinical
 * decision support unless `allowTier4` is explicitly configured — and even
 * then results are labeled lowAuthority.
 */
export const TIER_ELIGIBILITY: Record<'clinical' | 'educational', SourceTier[]> = {
  clinical: ['TIER_1', 'TIER_2'],
  educational: ['TIER_1', 'TIER_2', 'TIER_3'],
}

export const SOURCE_TYPES = [
  'GUIDELINE', 'TEXTBOOK', 'JOURNAL_ARTICLE', 'CONSENSUS_STATEMENT',
  'REGULATORY', 'SYSTEMATIC_REVIEW', 'EDUCATIONAL', 'OTHER',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const KNOWLEDGE_SCOPES = ['GLOBAL', 'TENANT'] as const
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number]

export const SOURCE_STATUSES = ['PUBLISHED', 'RETIRED', 'REJECTED'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

export const DOCUMENT_STATUSES = ['PUBLISHED', 'SUPERSEDED', 'REJECTED'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

/** Freshness is a fact about recorded dates — never an inference. */
export const FRESHNESS_STATUSES = ['CURRENT', 'AGING', 'STALE', 'UNKNOWN_DATE'] as const
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number]

// ---------------------------------------------------------------------------
// Fact classes (spec §40) — the four ways a statement may be known
// ---------------------------------------------------------------------------

export const FACT_CLASSES = [
  'KNOWN_FROM_SOURCE',
  'KNOWN_FROM_PATIENT_RECORD',
  'MODEL_INTERPRETATION',
  'UNKNOWN',
] as const
export type FactClass = (typeof FACT_CLASSES)[number]

// ---------------------------------------------------------------------------
// KnowledgeSource (stored)
// ---------------------------------------------------------------------------

export interface KnowledgeSourceMeta {
  /** Stable identity: publisher-slug or URL (server-assigned when absent). */
  sourceKey: string
  title: string
  publisher: string
  authors?: string | null
  publicationDate?: string | null // ISO date — null = UNKNOWN
  lastUpdated?: string | null
  /** URL / citation string — stored only; the ONLY origin of citation URLs. */
  reference?: string | null
  sourceType: SourceType
  authorityTier: SourceTier
  domain: string // must be a taxonomy domain
  subtopic?: string | null
  /** country / organization — null = UNKNOWN (never inferred). */
  jurisdiction?: string | null
  language: string // ISO 639-1 ('en' | 'ar' | …)
  version?: string | null // known version label — null = UNKNOWN
  license?: string | null
  scope: KnowledgeScope
  /** Required when scope = TENANT. */
  hospitalId?: string | null
}

export interface KnowledgeSource {
  id: string
  meta: KnowledgeSourceMeta
  status: SourceStatus
  rejectReason?: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// KnowledgeDocument (stored)
// ---------------------------------------------------------------------------

export interface KnowledgeDocument {
  id: string
  sourceId: string
  version: string
  title: string
  contentText: string
  contentHash: string
  language: string
  wordCount: number
  status: DocumentStatus
  ingestedAt: string
  supersededBy?: string | null
  /** Per-stage pipeline observability (counts/timings only, no content). */
  ingestion?: IngestionReport | null
}

// ---------------------------------------------------------------------------
// KnowledgeChunk (stored)
// ---------------------------------------------------------------------------

export interface KnowledgeChunk {
  id: string
  documentId: string
  sourceId: string
  domain: string
  subtopic?: string | null
  /** Heading path — the semantic boundary the chunk starts under. */
  section?: string | null
  position: number
  text: string
  tokenCount: number
  checksum: string
  language: string
}

// ---------------------------------------------------------------------------
// Ingestion (spec §9/§10)
// ---------------------------------------------------------------------------

export const INGESTION_FAILURE_CODES = [
  'INVALID_QUERY', // invalid source metadata / content
  'OVERSIZED_CONTENT',
  'PATIENT_DATA_DETECTED',
  'TAXONOMY_UNKNOWN',
  'CHECKSUM_CONFLICT',
  'DUPLICATE_CONTENT',
  'SOURCE_NOT_FOUND',
  'INDEX_FAILURE',
  'INGESTION_FAILED',
] as const
export type IngestionFailureCode = (typeof INGESTION_FAILURE_CODES)[number]

export interface IngestionStageReport {
  stage:
    | 'validate' | 'normalize' | 'metadata' | 'domain' | 'chunking'
    | 'dedup' | 'checksum' | 'index' | 'validate_publish' | 'publish'
  ok: boolean
  detail?: string
  durationMs: number
}

export interface IngestionReport {
  queryId: string
  sourceKey: string
  status: 'PUBLISHED' | 'REJECTED' | 'SUPERSEDED'
  failure?: { code: IngestionFailureCode; message: string } | null
  stages: IngestionStageReport[]
  contentHash?: string
  chunkCount?: number
  duplicateChunkCount?: number
  supersededDocumentIds?: string[]
  totalDurationMs: number
}

export interface IngestInput {
  source: KnowledgeSourceMeta
  /** Raw content — treated strictly as DATA (untrusted). */
  content: string
  /** When true, supersede previously-published versions of the same source. */
  replaceVersion?: boolean
}

/**
 * Storage boundary. The pipeline is store-agnostic: the production store is
 * Prisma (transactional), tests use the deterministic in-memory store.
 * A failed ingestion must leave NO published artifact (all-or-nothing).
 */
export interface KnowledgeStore {
  /** Identity lookup (any version, any status). */
  findSourceByKey(sourceKey: string): Promise<KnowledgeSource | null>
  /** All document versions of a source (published + superseded). */
  listDocumentsBySource(sourceId: string): Promise<KnowledgeDocument[]>
  /** Any published document with this content hash (any source). */
  findPublishedByContentHash(hash: string): Promise<KnowledgeDocument | null>
  listPublishedSources(hospitalId: string | null): Promise<KnowledgeSource[]>
  listDocumentsForSources(sourceIds: string[], includeSuperseded: boolean): Promise<KnowledgeDocument[]>
  listChunks(documentIds: string[]): Promise<KnowledgeChunk[]>
  listAllChunks(hospitalId: string | null): Promise<KnowledgeChunk[]>
  /** Atomic batch: source + document + chunks (+ version supersede). */
  commit(batch: CommitBatch): Promise<CommitReceipt>
  /** Record a REJECTED source (observability only — never retrievable). */
  recordRejectedSource(meta: KnowledgeSourceMeta, reason: string): Promise<void>
  /** Store the per-stage pipeline report on a published document. */
  updateDocumentIngestion(documentId: string, report: IngestionReport): Promise<void>
}

export interface CommitBatch {
  source: KnowledgeSource
  document: KnowledgeDocument
  chunks: KnowledgeChunk[]
  /** Document ids to mark SUPERSEDED (version history stays distinguishable). */
  supersedeDocumentIds: string[]
}

export interface CommitReceipt {
  sourceId: string
  documentId: string
  chunkIds: string[]
  supersededDocumentIds: string[]
}

// ---------------------------------------------------------------------------
// Query / retrieval (spec §15–§17)
// ---------------------------------------------------------------------------

export const RETRIEVAL_USE_CASES = ['clinical', 'educational'] as const
export type RetrievalUseCase = (typeof RETRIEVAL_USE_CASES)[number]

export interface KnowledgeQuery {
  question: string
  domain?: string | null // must be a taxonomy domain when present
  language?: string | null // preferred language filter (null = any)
  jurisdiction?: string | null // metadata filter (null = any)
  maxResults?: number // clamped to 1..10
  useCase: RetrievalUseCase
  /** Tenant scope — private (TENANT) knowledge visible only to this tenant. */
  hospitalId: string
  /**
   * Explicit configuration flag (never a model parameter): when true,
   * TIER_4 becomes eligible and every TIER_4 result is labeled lowAuthority.
   */
  allowTier4?: boolean
  /** Include SUPERSEDED document versions (default false — latest wins). */
  includeSuperseded?: boolean
}

export const MATCH_TYPES = ['LEXICAL', 'SEMANTIC', 'HYBRID'] as const
export type MatchType = (typeof MATCH_TYPES)[number]

export interface KnowledgeRetrievalResult {
  rank: number
  chunk: KnowledgeChunk
  source: KnowledgeSource
  document: KnowledgeDocument
  relevanceScore: number // deterministic, bounded 0..1
  matchType: MatchType
  authorityTier: SourceTier
  freshness: FreshnessStatus
  lowAuthority?: boolean
  /** Terms (canonical + surface) that matched — explainability, not CoT. */
  matchedTerms: string[]
  retrievedAt: string
}

/**
 * Machine-readable citation (spec §21). Built exclusively server-side from
 * STORED metadata — model output can never create or alter a citation.
 */
export interface KnowledgeCitation {
  citationId: string // 'c1', 'c2', … — the only form usable in answers
  sourceId: string
  documentId: string
  chunkId: string
  title: string
  section?: string | null
  page?: number | null // unknown → null (never invented)
  url?: string | null // from stored reference ONLY
  publisher: string
  publicationDate?: string | null
  version?: string | null
  authorityTier: SourceTier
  language: string
  /** Stored jurisdiction ONLY (spec §23/§24) — null = UNKNOWN, never inferred. */
  jurisdiction?: string | null
  factClass: 'KNOWN_FROM_SOURCE'
}

export interface EvidenceConflict {
  topic: string
  sourceIds: string[]
  tiers: SourceTier[]
  publicationDates: Array<string | null>
  note: string
}

export interface KnowledgeStats {
  candidateCount: number
  selectedCount: number
  sourceCount: number
  retrievalMs: number
  rankingMs: number
  duplicateChunksDropped: number
  method: MatchType
}

export interface KnowledgeEvidencePackage {
  ok: boolean
  queryId: string
  question: string
  /** Present when ok === false — the agent must report this honestly. */
  failure?: KnowledgeFailure | null
  /** Why nothing was returned (ok === true but empty results). */
  emptyReason?: 'NO_RESULTS' | 'DOMAIN_NO_MATCH' | null
  results: KnowledgeRetrievalResult[]
  citations: KnowledgeCitation[]
  conflicts: EvidenceConflict[]
  budgetUsed: { evidenceChars: number; limit: number; truncated: boolean }
  stats: KnowledgeStats
  retrievedAt: string
}

// ---------------------------------------------------------------------------
// Typed failures (spec §36)
// ---------------------------------------------------------------------------

export const KNOWLEDGE_FAILURE_CODES = [
  'KNOWLEDGE_NOT_AVAILABLE',
  'NO_RESULTS',
  'INVALID_QUERY',
  'SOURCE_NOT_FOUND',
  'INDEX_FAILURE',
  'RETRIEVAL_TIMEOUT',
  'EVIDENCE_INSUFFICIENT',
  'CONFLICTING_EVIDENCE',
  'UNSUPPORTED_DOMAIN',
  'SECURITY_FILTERED',
] as const
export type KnowledgeFailureCode = (typeof KNOWLEDGE_FAILURE_CODES)[number]

export interface KnowledgeFailure {
  code: KnowledgeFailureCode
  message: string
}

// ---------------------------------------------------------------------------
// Grounding (spec §40)
// ---------------------------------------------------------------------------

export interface GroundingReport {
  /** citationIds referenced in the answer (detected, not trusted). */
  citedIds: string[]
  /** cited ids that do NOT exist in the package → hallucinated. */
  unsupportedCitations: string[]
  /** claims that reference stored facts (deterministic overlap check). */
  groundedStatements: number
  totalStatements: number
  /** fact-class label for the whole answer body. */
  factClass: FactClass
}

// ---------------------------------------------------------------------------
// Embedding provider abstraction (spec §13/§14)
// ---------------------------------------------------------------------------

/**
 * Provider abstraction for semantic retrieval. Phase 4 ships the
 * DETERMINISTIC LEXICAL path only (no external/cloud embeddings). Phase 5's
 * local model strategy can plug a CPU embedding model here without touching
 * retrieval policy. `null` (the default) = lexical-only.
 */
export interface EmbeddingProvider {
  name: string
  dimensions: number
  embed(text: string): Promise<number[]>
}

// ---------------------------------------------------------------------------
// Retrieval configuration (budgets)
// ---------------------------------------------------------------------------

export interface RetrievalConfig {
  maxResults: number // hard cap 10
  maxResultsDefault: number
  maxEvidenceChars: number
  maxChunksPerSource: number
  maxQueryChars: number
  nearDuplicateJaccard: number
  clinicalFreshnessYears: number
  timeoutMs: number
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  maxResults: 10,
  maxResultsDefault: 5,
  maxEvidenceChars: 12000,
  maxChunksPerSource: 2,
  maxQueryChars: 500,
  nearDuplicateJaccard: 0.9,
  clinicalFreshnessYears: 10,
  timeoutMs: 8000,
}

/**
 * Phase 4 — Knowledge store implementations.
 *
 *  - createMemoryKnowledgeStore: deterministic in-memory store (tests,
 *    ingestion script, offline dev). Full semantics: tenant scoping,
 *    versioning, dedup keys, atomic commits (all-or-nothing).
 *  - createPrismaKnowledgeStore: production store on the additive
 *    Knowledge* tables. Commits run in ONE transaction — a failed ingestion
 *    cannot partially publish (spec §9).
 *
 * Retrieval visibility rule (tenant isolation): a source is visible to a
 * query when it is PUBLISHED AND (scope GLOBAL OR (scope TENANT AND
 * hospitalId === query.hospitalId)).
 */
import type {
  CommitBatch, CommitReceipt, IngestionReport,
  KnowledgeChunk, KnowledgeDocument, KnowledgeSource, KnowledgeStore,
  KnowledgeSourceMeta,
} from './types'

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

export interface MemoryKnowledgeStore {
  store: KnowledgeStore
  /** Direct access for assertions in tests (not part of the store contract). */
  sources: Map<string, KnowledgeSource>
  documents: Map<string, KnowledgeDocument>
  chunks: Map<string, KnowledgeChunk>
}

export function createMemoryKnowledgeStore(idFactory?: () => string): MemoryKnowledgeStore {
  const makeId: () => string =
    idFactory ??
    (() => {
      let n = 0
      return () => `mem-${String(++n).padStart(4, '0')}`
    })()
  const sources = new Map<string, KnowledgeSource>()
  const documents = new Map<string, KnowledgeDocument>()
  const chunks = new Map<string, KnowledgeChunk>()

  const visibleSource = (s: KnowledgeSource, hospitalId: string | null): boolean =>
    s.status === 'PUBLISHED' && (s.meta.scope === 'GLOBAL' || (s.meta.scope === 'TENANT' && s.meta.hospitalId === hospitalId))

  const store: KnowledgeStore = {
    async findSourceByKey(sourceKey) {
      for (const s of sources.values()) if (s.meta.sourceKey === sourceKey) return s
      return null
    },
    async listDocumentsBySource(sourceId) {
      return [...documents.values()].filter((d) => d.sourceId === sourceId)
    },
    async findPublishedByContentHash(hash) {
      for (const d of documents.values()) if (d.status === 'PUBLISHED' && d.contentHash === hash) return d
      return null
    },
    async listPublishedSources(hospitalId) {
      return [...sources.values()].filter((s) => visibleSource(s, hospitalId))
    },
    async listDocumentsForSources(sourceIds, includeSuperseded) {
      return [...documents.values()].filter((d) =>
        sourceIds.includes(d.sourceId) &&
        (d.status === 'PUBLISHED' || (includeSuperseded && d.status === 'SUPERSEDED')))
    },
    async listChunks(documentIds) {
      return [...chunks.values()].filter((c) => documentIds.includes(c.documentId))
    },
    async listAllChunks(hospitalId) {
      const visible = new Set([...sources.values()].filter((s) => visibleSource(s, hospitalId)).map((s) => s.id))
      return [...chunks.values()].filter((c) => visible.has(c.sourceId))
    },
    async commit(batch): Promise<CommitReceipt> {
      // All-or-nothing: validate everything first, then write.
      if (sources.has(batch.source.id) && sources.get(batch.source.id)!.meta.sourceKey !== batch.source.meta.sourceKey) {
        throw new Error('commit: source id/key conflict')
      }
      if (batch.document.status === 'PUBLISHED') {
        for (const d of documents.values()) {
          if (d.status === 'PUBLISHED' && d.contentHash === batch.document.contentHash) {
            throw new Error('commit: duplicate content hash')
          }
          if (d.sourceId === batch.document.sourceId && d.version === batch.document.version) {
            throw new Error('commit: duplicate version label')
          }
        }
      }
      for (const c of batch.chunks) {
        for (const ex of chunks.values()) {
          if (ex.documentId === c.documentId && ex.position === c.position) throw new Error('commit: duplicate chunk position')
        }
      }
      sources.set(batch.source.id, batch.source)
      documents.set(batch.document.id, batch.document)
      for (const c of batch.chunks) chunks.set(c.id, c)
      for (const id of batch.supersedeDocumentIds) {
        const d = documents.get(id)
        if (d) documents.set(id, { ...d, status: 'SUPERSEDED', supersededBy: batch.document.id })
      }
      return {
        sourceId: batch.source.id,
        documentId: batch.document.id,
        chunkIds: batch.chunks.map((c) => c.id),
        supersededDocumentIds: [...batch.supersedeDocumentIds],
      }
    },
    async recordRejectedSource(meta: KnowledgeSourceMeta, reason) {
      const id = makeId()
      sources.set(id, {
        id,
        meta,
        status: 'REJECTED',
        rejectReason: reason,
        createdAt: new Date().toISOString(),
      })
    },
    async updateDocumentIngestion(documentId, report: IngestionReport) {
      const d = documents.get(documentId)
      if (d) documents.set(documentId, { ...d, ingestion: report })
    },
  }

  return { store, sources, documents, chunks }
}

// ---------------------------------------------------------------------------
// Prisma (production)
// ---------------------------------------------------------------------------

export function createPrismaKnowledgeStore(prisma: any): KnowledgeStore {
  const rowToSource = (row: any): KnowledgeSource => ({
    id: row.id,
    meta: {
      sourceKey: row.sourceKey,
      title: row.title,
      publisher: row.publisher,
      authors: row.authors ?? null,
      publicationDate: row.publicationDate ? row.publicationDate.toISOString() : null,
      lastUpdated: row.lastUpdated ? row.lastUpdated.toISOString() : null,
      reference: row.reference ?? null,
      sourceType: row.sourceType,
      authorityTier: row.authorityTier,
      domain: row.domain,
      subtopic: row.subtopic ?? null,
      jurisdiction: row.jurisdiction ?? null,
      language: row.language,
      version: row.version ?? null,
      license: row.license ?? null,
      scope: row.scope,
      hospitalId: row.hospitalId ?? null,
    },
    status: row.status,
    rejectReason: row.rejectReason ?? null,
    createdAt: row.createdAt.toISOString(),
  })

  const rowToDocument = (row: any): KnowledgeDocument => ({
    id: row.id,
    sourceId: row.sourceId,
    version: row.version,
    title: row.title,
    contentText: row.contentText,
    contentHash: row.contentHash,
    language: row.language,
    wordCount: row.wordCount,
    status: row.status,
    ingestedAt: row.ingestedAt.toISOString(),
    supersededBy: row.supersededByKnowledgeDocumentId ?? null,
    ingestion: (row.ingestion as IngestionReport | null) ?? null,
  })

  const rowToChunk = (row: any): KnowledgeChunk => ({
    id: row.id,
    documentId: row.documentId,
    sourceId: row.sourceId,
    domain: row.domain,
    subtopic: row.subtopic ?? null,
    section: row.section ?? null,
    position: row.position,
    text: row.text,
    tokenCount: row.tokenCount,
    checksum: row.checksum,
    language: row.language,
  })

  return {
    async findSourceByKey(sourceKey) {
      const row = await prisma.knowledgeSource.findFirst({ where: { sourceKey }, orderBy: { createdAt: 'asc' } })
      return row ? rowToSource(row) : null
    },
    async listDocumentsBySource(sourceId) {
      const rows = await prisma.knowledgeDocument.findMany({ where: { sourceId }, orderBy: { ingestedAt: 'asc' } })
      return rows.map(rowToDocument)
    },
    async findPublishedByContentHash(hash) {
      const row = await prisma.knowledgeDocument.findFirst({ where: { contentHash: hash, status: 'PUBLISHED' } })
      return row ? rowToDocument(row) : null
    },
    async listPublishedSources(hospitalId) {
      const where = { status: 'PUBLISHED', OR: [{ scope: 'GLOBAL' }, ...(hospitalId ? [{ scope: 'TENANT', hospitalId }] : [])] }
      const rows = await prisma.knowledgeSource.findMany({ where, orderBy: { createdAt: 'asc' } })
      return rows.map(rowToSource)
    },
    async listDocumentsForSources(sourceIds, includeSuperseded) {
      const where = {
        sourceId: { in: sourceIds },
        status: includeSuperseded ? { in: ['PUBLISHED', 'SUPERSEDED'] } : 'PUBLISHED',
      }
      const rows = await prisma.knowledgeDocument.findMany({ where, orderBy: { ingestedAt: 'asc' } })
      return rows.map(rowToDocument)
    },
    async listChunks(documentIds) {
      const rows = await prisma.knowledgeChunk.findMany({ where: { documentId: { in: documentIds } }, orderBy: [{ documentId: 'asc' }, { position: 'asc' }] })
      return rows.map(rowToChunk)
    },
    async listAllChunks(hospitalId) {
      const where = {
        source: { status: 'PUBLISHED', OR: [{ scope: 'GLOBAL' }, ...(hospitalId ? [{ scope: 'TENANT', hospitalId }] : [])] },
      }
      const rows = await prisma.knowledgeChunk.findMany({ where, orderBy: [{ documentId: 'asc' }, { position: 'asc' }] })
      return rows.map(rowToChunk)
    },
    async commit(batch) {
      const tx = await prisma.$transaction(async (txClient: any) => {
        let sourceRow = await txClient.knowledgeSource.findFirst({ where: { sourceKey: batch.source.meta.sourceKey }, orderBy: { createdAt: 'asc' } })
        if (!sourceRow) {
          sourceRow = await txClient.knowledgeSource.create({
            data: {
              id: batch.source.id,
              sourceKey: batch.source.meta.sourceKey,
              title: batch.source.meta.title,
              publisher: batch.source.meta.publisher,
              authors: batch.source.meta.authors,
              publicationDate: batch.source.meta.publicationDate ? new Date(batch.source.meta.publicationDate) : null,
              lastUpdated: batch.source.meta.lastUpdated ? new Date(batch.source.meta.lastUpdated) : null,
              reference: batch.source.meta.reference,
              sourceType: batch.source.meta.sourceType,
              authorityTier: batch.source.meta.authorityTier,
              domain: batch.source.meta.domain,
              subtopic: batch.source.meta.subtopic,
              jurisdiction: batch.source.meta.jurisdiction,
              language: batch.source.meta.language,
              version: batch.source.meta.version,
              license: batch.source.meta.license,
              scope: batch.source.meta.scope,
              hospitalId: batch.source.meta.hospitalId ?? null,
              status: 'PUBLISHED',
            },
          })
        }
        const doc = await txClient.knowledgeDocument.create({
          data: {
            id: batch.document.id,
            sourceId: batch.document.sourceId,
            version: batch.document.version,
            title: batch.document.title,
            contentText: batch.document.contentText,
            contentHash: batch.document.contentHash,
            language: batch.document.language,
            wordCount: batch.document.wordCount,
            status: batch.document.status,
            ingestedAt: new Date(batch.document.ingestedAt),
            ingestion: batch.document.ingestion,
          },
        })
        const chunkIds: string[] = []
        for (const c of batch.chunks) {
          await txClient.knowledgeChunk.create({
            data: {
              id: c.id,
              documentId: c.documentId,
              sourceId: c.sourceId,
              domain: c.domain,
              subtopic: c.subtopic,
              section: c.section,
              position: c.position,
              text: c.text,
              tokenCount: c.tokenCount,
              checksum: c.checksum,
              language: c.language,
            },
          })
          chunkIds.push(c.id)
        }
        if (batch.supersedeDocumentIds.length) {
          await txClient.knowledgeDocument.updateMany({
            where: { id: { in: batch.supersedeDocumentIds }, status: 'PUBLISHED' },
            data: { status: 'SUPERSEDED', supersededByKnowledgeDocumentId: doc.id },
          })
        }
        return { sourceId: sourceRow.id, documentId: doc.id, chunkIds }
      })
      return { ...tx, supersededDocumentIds: [...batch.supersedeDocumentIds] }
    },
    async recordRejectedSource(meta, reason) {
      await prisma.knowledgeSource.create({
        data: {
          sourceKey: meta.sourceKey,
          title: meta.title,
          publisher: meta.publisher,
          authors: meta.authors,
          publicationDate: meta.publicationDate ? new Date(meta.publicationDate) : null,
          lastUpdated: meta.lastUpdated ? new Date(meta.lastUpdated) : null,
          reference: meta.reference,
          sourceType: meta.sourceType,
          authorityTier: meta.authorityTier,
          domain: meta.domain,
          subtopic: meta.subtopic,
          jurisdiction: meta.jurisdiction,
          language: meta.language,
          version: meta.version,
          license: meta.license,
          scope: meta.scope,
          hospitalId: meta.hospitalId ?? null,
          status: 'REJECTED',
          rejectReason: reason,
        },
      })
    },
    async updateDocumentIngestion(documentId, report) {
      await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { ingestion: report } })
    },
  }
}

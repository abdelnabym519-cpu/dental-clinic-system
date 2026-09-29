/**
 * Phase 4 — Dental Knowledge admin API (§30 minimal ingestion workflow).
 *
 * GET  /api/ai/knowledge — published knowledge sources for the tenant
 *      (admin observability: what is in the KB, tiers, domains, versions).
 * POST /api/ai/knowledge — deterministic ingestion of a knowledge source.
 *
 * Security model:
 * - The actor + tenant are resolved from the SESSION; the client never
 *   asserts identity or tenant. TENANT-scope sources are always pinned to
 *   the session hospitalId (a client-supplied hospitalId is ignored).
 * - Ingestion is admin-only (ADMIN/SUPER_ADMIN). Other roles get 403.
 * - Source content is DATA: the pipeline never executes or interprets it
 *   (§10). A failed ingestion publishes nothing (all-or-nothing, §9) and is
 *   returned as a typed, observable IngestionReport — never a silent success.
 * - Every ingestion attempt is audit-logged server-side.
 *
 * This route is ADDITIVE: it does not touch the agent, context or action
 * pipelines.
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

async function getKnowledgeStore() {
  const { createPrismaKnowledgeStore } = await import('@/lib/ai/knowledge/store')
  return createPrismaKnowledgeStore(prisma)
}

/** Minimal list view over published sources (no raw content). */
async function listPublished(hospitalId: string) {
  const store = await getKnowledgeStore()
  const sources = await store.listPublishedSources(hospitalId)
  const out: Array<{
    id: string
    sourceKey: string
    title: string
    publisher: string
    authorityTier: string
    domain: string
    subtopic: string | null
    language: string
    jurisdiction: string | null
    scope: string
    sourceType: string
    publicationDate: string | null
    version: string | null
    reference: string | null
    status: string
    createdAt: string
    documents: Array<{ id: string; version: string; status: string; wordCount: number; ingestedAt: string }>
  }> = []
  for (const s of sources) {
    const docs = await store.listDocumentsBySource(s.id)
    out.push({
      id: s.id,
      sourceKey: s.meta.sourceKey,
      title: s.meta.title,
      publisher: s.meta.publisher,
      authorityTier: s.meta.authorityTier,
      domain: s.meta.domain,
      subtopic: s.meta.subtopic ?? null,
      language: s.meta.language,
      jurisdiction: s.meta.jurisdiction ?? null,
      scope: s.meta.scope,
      sourceType: s.meta.sourceType,
      publicationDate: s.meta.publicationDate ?? null,
      version: s.meta.version ?? null,
      reference: s.meta.reference ?? null,
      status: s.status,
      createdAt: s.createdAt,
      documents: docs.map((d) => ({
        id: d.id,
        version: d.version,
        status: d.status,
        wordCount: d.wordCount,
        ingestedAt: d.ingestedAt,
      })),
    })
  }
  return out
}

export async function GET() {
  const { error, user, hospitalId } = await requireAuthAndRole(ADMIN_ROLES)
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const sources = await listPublished(hospitalId)
    return NextResponse.json({ hospitalId, sources })
  } catch (err) {
    console.error('AI knowledge list error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole(ADMIN_ROLES)
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { SOURCE_TIERS, SOURCE_TYPES, KNOWLEDGE_SCOPES } = await import('@/lib/ai/knowledge/types')
  const { isKnowledgeDomain } = await import('@/lib/ai/knowledge/taxonomy')
  const { MAX_CONTENT_CHARS } = await import('@/lib/ai/knowledge/ingestion')

  const sourceIn = (body.source ?? null) as Record<string, unknown> | null
  const content = typeof body.content === 'string' ? body.content : null

  if (!sourceIn || typeof sourceIn !== 'object') {
    return NextResponse.json({ error: 'source is required' }, { status: 400 })
  }
  const sourceKey = typeof sourceIn.sourceKey === 'string' ? sourceIn.sourceKey.trim() : ''
  if (!sourceKey) return NextResponse.json({ error: 'source.sourceKey is required' }, { status: 400 })
  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return NextResponse.json({ error: 'content exceeds the maximum allowed size' }, { status: 400 })
  }
  const title = typeof sourceIn.title === 'string' && sourceIn.title.trim() ? sourceIn.title.trim() : sourceKey
  const publisher = typeof sourceIn.publisher === 'string' && sourceIn.publisher.trim() ? sourceIn.publisher.trim() : 'UNKNOWN'
  const sourceType = sourceIn.sourceType
  const authorityTier = sourceIn.authorityTier
  const domain = sourceIn.domain
  const language = sourceIn.language
  // Static, i18n-resolvable messages (the i18n sweep caps interpolated
  // templates repo-wide, so enum detail goes to server logs, not the API).
  if (!SOURCE_TYPES.includes(sourceType as (typeof SOURCE_TYPES)[number])) {
    console.error('knowledge ingest: invalid sourceType', sourceType)
    return NextResponse.json({ error: 'source.sourceType is invalid' }, { status: 400 })
  }
  if (!SOURCE_TIERS.includes(authorityTier as (typeof SOURCE_TIERS)[number])) {
    console.error('knowledge ingest: invalid authorityTier', authorityTier)
    return NextResponse.json({ error: 'source.authorityTier is invalid' }, { status: 400 })
  }
  if (!isKnowledgeDomain(domain)) {
    console.error('knowledge ingest: invalid domain', domain)
    return NextResponse.json({ error: 'source.domain must be a known dental knowledge domain' }, { status: 400 })
  }
  if (language !== 'en' && language !== 'ar') {
    return NextResponse.json({ error: 'source.language must be "en" or "ar"' }, { status: 400 })
  }

  // Scope: TENANT is always pinned to the SESSION tenant (never client-set).
  // A client-supplied hospitalId on the source is dropped by construction.
  const scope = (sourceIn.scope ?? 'GLOBAL') as (typeof KNOWLEDGE_SCOPES)[number]
  if (!KNOWLEDGE_SCOPES.includes(scope)) {
    console.error('knowledge ingest: invalid scope', scope)
    return NextResponse.json({ error: 'source.scope is invalid' }, { status: 400 })
  }

  const isoOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null

  const meta = {
    sourceKey,
    title,
    publisher,
    authors: isoOrNull(sourceIn.authors),
    publicationDate: isoOrNull(sourceIn.publicationDate),
    lastUpdated: isoOrNull(sourceIn.lastUpdated),
    reference: isoOrNull(sourceIn.reference),
    sourceType: sourceType as (typeof SOURCE_TYPES)[number],
    authorityTier: authorityTier as (typeof SOURCE_TIERS)[number],
    domain,
    subtopic: isoOrNull(sourceIn.subtopic),
    jurisdiction: isoOrNull(sourceIn.jurisdiction),
    language,
    version: isoOrNull(sourceIn.version),
    license: isoOrNull(sourceIn.license),
    scope,
    hospitalId: scope === 'TENANT' ? hospitalId : null,
  }

  try {
    const { ingest } = await import('@/lib/ai/knowledge/ingestion')
    const store = await getKnowledgeStore()
    // Deterministic, observable, all-or-nothing (§9/§10). Content is DATA.
    const report = await ingest(
      { source: meta, content, replaceVersion: body.replaceVersion === true },
      store,
      { now: () => new Date() }
    )

    // Non-blocking audit (must never break the response). No content —
    // status, typed failure code and counts only.
    prisma.auditLog
      .create({
        data: {
          hospitalId,
          userId: user.id,
          action: 'AI_KNOWLEDGE_INGEST',
          entityType: 'KnowledgeSource',
          entityId: sourceKey,
          newValues: JSON.stringify({
            status: report.status,
            failureCode: report.failure?.code ?? null,
            chunkCount: report.chunkCount ?? 0,
          }),
        },
      })
      .catch((e: unknown) => console.error('AI knowledge audit failed:', e instanceof Error ? e.message : e))

    return NextResponse.json({ hospitalId, report })
  } catch (err) {
    console.error('AI knowledge ingest error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

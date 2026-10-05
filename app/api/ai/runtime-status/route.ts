import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { getAIHealth, getAIModel } from '@/lib/ai/gateway'

/**
 * Canonical AI-runtime diagnostic (Cloudflare AI Gateway era).
 *
 * States (the §15 vocabulary, subset-mapped from the health probe):
 *
 *   UNAVAILABLE   — no Cloudflare AI Gateway configuration in the environment
 *   MISCONFIGURED — configured, but the identifiers are not valid shapes
 *   CONFIGURED    — configured and identifier-valid (no expensive LLM probe)
 *   AVAILABLE     — reserved for a real minimal-request confirmation; never
 *                   fabricated here (a configured gateway is not proof of a
 *                   reachable provider)
 *
 * Secrets: only presence is reported — account/gateway IDs and the token
 * value never leave the process. Auth: ADMIN only. The payload is cached for
 * 60s so the endpoint cannot be used to hammer anything.
 */

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 60_000

let cache: { at: number; payload: Record<string, unknown> } | null = null

export async function GET() {
  const { error } = await requireAuthAndRole(['ADMIN'])
  if (error) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload)
  }

  const health = getAIHealth()
  const payload: Record<string, unknown> = {
    runtime: health.runtime,
    configured: health.configured,
    status: health.status,
    model: getAIModel() ?? null,
    localEngines: health.localEngines, // dental vision/3D engines stay local by architecture
  }
  if (health.detail) payload.detail = health.detail

  cache = { at: Date.now(), payload }
  return NextResponse.json(payload)
}

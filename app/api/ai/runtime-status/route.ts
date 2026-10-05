import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * Issue 4 — smallest production-safe AI-runtime diagnostic.
 *
 * Distinguishes exactly four states for the report LLM runtime, with no
 * secrets (the API key value never leaves the process; only its presence):
 *
 *   not_configured            — no OPENROUTER_API_KEY in the environment
 *   unreachable               — configured, but the provider cannot be reached
 *   reachable_model_missing   — provider reachable, but the configured model is not served
 *   ready                     — provider reachable and the model is served
 *
 * Auth: ADMIN only (diagnostics must not be exposed to normal clinic users).
 * The probe result is cached for 60s so this cannot be used to hammer the
 * provider. No patient data is ever sent — this is a capability check only.
 */

export const dynamic = 'force-dynamic'

const MODELS_URL = 'https://openrouter.ai/api/v1/models'
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

  const configured = Boolean(process.env.OPENROUTER_API_KEY)
  const payload: Record<string, unknown> = {
    runtime: 'openrouter', // the repository's configured LLM provider
    configured,
  }

  if (!configured) {
    payload.status = 'not_configured'
    payload.detail = 'لم يتم تكوين مفتاح مزوّد نموذج اللغة — التقارير الجاهزة تعمل بدلًا من ذلك.'
    cache = { at: Date.now(), payload }
    return NextResponse.json(payload)
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(MODELS_URL, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      payload.status = 'unreachable'
      payload.httpStatus = res.status
    } else {
      const data = await res.json().catch(() => null)
      const wanted = 'google/gemini-2.5-pro'
      const ids: string[] = Array.isArray(data?.data) ? data.data.map((m: any) => m?.id) : []
      payload.status = ids.includes(wanted) ? 'ready' : 'reachable_model_missing'
      payload.model = wanted
    }
  } catch {
    payload.status = 'unreachable'
  }

  cache = { at: Date.now(), payload }
  return NextResponse.json(payload)
}

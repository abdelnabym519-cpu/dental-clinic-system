// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Cloudflare era — AI-runtime diagnostic (ADMIN-only, cached, probe-free):
//   UNAVAILABLE   — no gateway configuration
//   MISCONFIGURED — configured but identifier shapes are invalid
//   CONFIGURED    — configured and identifier-valid (NO expensive LLM probe)
// The payload never carries the token value, never sends patient data, and
// never fabricates "AVAILABLE" from configuration alone.

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
vi.mock('@/lib/api-helpers', () => mockAuth)

const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.stubGlobal('fetch', fetchMock.fn)

describe('GET /api/ai/runtime-status — Cloudflare AI Gateway diagnostic', () => {
  const ENV_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_GATEWAY_ID', 'DEN_TORA_AI_MODEL']

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    fetchMock.fn.mockReset()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'h1',
      session: { user: { id: 'u1', role: 'ADMIN' } },
    })
    for (const k of ENV_KEYS) delete process.env[k]
  })

  async function getStatus() {
    // fresh module instance per test so the 60s cache does not leak states
    const mod = await import('@/app/api/ai/runtime-status/route')
    return mod.GET()
  }

  it('UNAVAILABLE when no gateway configuration is present (and never fetches)', async () => {
    const res = await getStatus()
    const data = await res.json()
    expect(data.configured).toBe(false)
    expect(data.status).toBe('UNAVAILABLE')
    expect(data.runtime).toBe('cloudflare-ai-gateway')
    expect(data.localEngines).toBe('local')
    expect(fetchMock.fn).not.toHaveBeenCalled()
    // no secrets in the payload
    expect(JSON.stringify(data)).not.toMatch(/sk-|Bearer/i)
  })

  it('CONFIGURED with valid identifiers — configuration only, no LLM probe', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1'
    process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token-secret'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'gw_1'
    process.env.DEN_TORA_AI_MODEL = 'google/gemini-2.5-pro'
    const res = await getStatus()
    const data = await res.json()
    expect(data.status).toBe('CONFIGURED')
    expect(data.configured).toBe(true)
    expect(data.model).toBe('google/gemini-2.5-pro')
    // configuration is NOT proof of reachability — AVAILABLE is never fabricated
    expect(data.status).not.toBe('AVAILABLE')
    // no probe requests are fired by the diagnostic
    expect(fetchMock.fn).not.toHaveBeenCalled()
    // the token value never leaves the process
    expect(JSON.stringify(data)).not.toContain('test-cf-token-secret')
  })

  it('MISCONFIGURED when identifiers are present but not safe-ID shaped', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = '../../evil'
    process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token-secret'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'has space'
    const res = await getStatus()
    const data = await res.json()
    expect(data.status).toBe('MISCONFIGURED')
    expect(data.configured).toBe(true)
    expect(data.detail).toMatch(/[\u0600-\u06FF]/) // Arabic-safe detail
    // invalid identifiers are echoed nowhere
    expect(JSON.stringify(data)).not.toContain('../..')
    expect(JSON.stringify(data)).not.toContain('has space')
  })

  it('caches the payload for 60s (no repeated computation)', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1'
    process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token-secret'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'gw_1'
    const first = await (await getStatus()).json()
    const second = await (await getStatus()).json()
    expect(second).toEqual(first)
    expect(fetchMock.fn).not.toHaveBeenCalled()
  })

  it('ADMIN authorization is enforced', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await getStatus()
    expect(res.status).toBe(401)
  })
})

// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Issue 4 — smallest production-safe AI-runtime diagnostic: ADMIN-only,
// distinguishes not_configured / unreachable / reachable_model_missing / ready,
// never exposes the API key value, and never sends patient data anywhere.

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
vi.mock('@/lib/api-helpers', () => mockAuth)

const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.stubGlobal('fetch', fetchMock.fn)

import { GET } from '@/app/api/ai/runtime-status/route'

describe('GET /api/ai/runtime-status — Issue 4 diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    fetchMock.fn.mockReset()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'h1',
      session: { user: { id: 'u1', role: 'ADMIN' } },
    })
  })

  async function getStatus() {
    // fresh module instance per test so the 60s cache does not leak states
    const mod = await import('@/app/api/ai/runtime-status/route')
    return mod.GET()
  }

  it('not_configured when no key is present (and never fetches)', async () => {
    delete process.env.OPENROUTER_API_KEY
    const res = await getStatus()
    const data = await res.json()
    expect(data.configured).toBe(false)
    expect(data.status).toBe('not_configured')
    expect(fetchMock.fn).not.toHaveBeenCalled()
    expect(JSON.stringify(data)).not.toMatch(/sk-|Bearer/i)
  })

  it('ready when the provider serves the configured model', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123'
    fetchMock.fn.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'google/gemini-2.5-pro' }] }),
    })
    const res = await getStatus()
    const data = await res.json()
    expect(data.status).toBe('ready')
    expect(data.configured).toBe(true)
    // no secrets in the payload
    expect(JSON.stringify(data)).not.toContain('test-key-123')
  })

  it('reachable_model_missing when the provider is up but the model is absent', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123'
    fetchMock.fn.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ id: 'other/model' }] }) })
    const res = await getStatus()
    const data = await res.json()
    expect(data.status).toBe('reachable_model_missing')
  })

  it('unreachable on network failure — Arabic-safe, no stack', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123'
    fetchMock.fn.mockRejectedValue(new TypeError('fetch failed'))
    const res = await getStatus()
    const data = await res.json()
    expect(data.status).toBe('unreachable')
    expect(JSON.stringify(data)).not.toContain('fetch failed')
  })

  it('ADMIN authorization is enforced', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await getStatus()
    expect(res.status).toBe(401)
  })
})

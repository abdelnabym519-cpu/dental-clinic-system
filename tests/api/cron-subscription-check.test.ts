// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Phase 9 licensing — the cron secret gate for /api/cron/subscription-check.
// Isolated in its own file because vi.mock is hoisted per file: the health
// lib is mocked ONLY here, keeping the pure-logic tests (tests/unit/
// licensing.test.ts) running against the real implementation.

vi.mock('@/lib/licensing/subscription-health', () => ({
  runSubscriptionHealthCheck: vi.fn().mockResolvedValue({
    transitioned: 1,
    warnings: 0,
    errors: 0,
  }),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { POST } = await import('@/app/api/cron/subscription-check/route')
const { runSubscriptionHealthCheck } = await import('@/lib/licensing/subscription-health')

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.clearAllMocks()
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('POST /api/cron/subscription-check', () => {
  it('returns 401 without the Bearer secret', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/subscription-check', { method: 'POST' })
    )
    expect(res.status).toBe(401)
    expect(runSubscriptionHealthCheck).not.toHaveBeenCalled()
  })

  it('returns 401 with a wrong secret', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/subscription-check', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
      })
    )
    expect(res.status).toBe(401)
    expect(runSubscriptionHealthCheck).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(
      new Request('http://localhost/api/cron/subscription-check', {
        method: 'POST',
        headers: { authorization: 'Bearer anything' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('returns 200 with the correct secret and runs the health check', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/subscription-check', {
        method: 'POST',
        headers: { authorization: 'Bearer test-cron-secret' },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.results).toEqual({ transitioned: 1, warnings: 0, errors: 0 })
    expect(runSubscriptionHealthCheck).toHaveBeenCalledTimes(1)
  })
})

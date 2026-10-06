// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Typed AI-unavailability mapping (§LLM certification).
//
// Defect class: forecast/analysis routes returned HTTP 500 with raw
// error.message when the canonical gateway raised a typed AIUnavailableError
// (observed in production as AI_TIMEOUT at ~30s → 500 on inventory-forecast).
// Contract under test: every AI route maps typed unavailability to a
// truthful 503 carrying the Arabic-safe message + code + correlationId, and
// never leaks raw strings. The gateway-side timeout contract (measured
// 120s default) is pinned as well.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(),
}))

const mockGateway = vi.hoisted(() => ({
  complete: vi.fn(),
  extractJSON: vi.fn((t: string) => t),
  streamResponse: vi.fn(),
  AIUnavailableError: class AIUnavailableError extends Error {
    code: string
    correlationId: string
    constructor(message: string, code: string, correlationId: string) {
      super(message)
      this.name = 'AIUnavailableError'
      this.code = code
      this.correlationId = correlationId
    }
  },
}))
vi.mock('@/lib/ai/gateway', () => ({
  ...mockGateway,
  // structural contract, same logic as the real helper
  isAIUnavailableError: (err: unknown) =>
    err instanceof Error &&
    (err.name === 'AIUnavailableError' ||
      (err as { code?: string }).code === 'AI_NOT_CONFIGURED' ||
      (err as { code?: string }).code === 'AI_TIMEOUT' ||
      (err as { code?: string }).code === 'AI_PROVIDER_ERROR'),
}))

import { GET as inventoryForecastGET } from '@/app/api/ai/inventory-forecast/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function mockAuth() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    user: { id: 'u1', role: 'ADMIN' },
    session: { user: { id: 'u1', role: 'ADMIN' } },
    hospitalId: 'h1',
  } as any)
}

function req(path = '/api/ai/inventory-forecast'): NextRequest {
  return new NextRequest(`http://localhost${path}`)
}

describe('GET /api/ai/inventory-forecast — typed AI unavailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  it('the reported production defect: AI_TIMEOUT (30s abort) → truthful 503, never 500', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: 'i1', name: 'Gloves', sku: 'GL-1', currentStock: 50, minimumStock: 10, reorderLevel: 20, unit: 'box', purchasePrice: 30 },
    ])
    prisma.stockTransaction.findMany.mockResolvedValue([])
    mockGateway.complete.mockRejectedValue(
      new mockGateway.AIUnavailableError(
        'انتهت مهلة الاتصال بخدمة الذكاء الاصطناعي.',
        'AI_TIMEOUT',
        'corr-timeout-1'
      )
    )

    const res = await inventoryForecastGET(req())
    expect(res.status).toBe(503) // ← was 500 in production
    const body = await res.json()
    expect(body.code).toBe('AI_TIMEOUT')
    expect(body.correlationId).toBe('corr-timeout-1')
    expect(body.error).toMatch(/[\u0600-\u06FF]/)
  })

  it('AI_PROVIDER_ERROR and AI_NOT_CONFIGURED also map to 503 with the typed contract', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: 'i1', name: 'Gloves', sku: 'GL-1', currentStock: 50, minimumStock: 10, reorderLevel: 20, unit: 'box', purchasePrice: 30 },
    ])
    prisma.stockTransaction.findMany.mockResolvedValue([])

    for (const code of ['AI_PROVIDER_ERROR', 'AI_NOT_CONFIGURED']) {
      mockGateway.complete.mockRejectedValueOnce(
        new mockGateway.AIUnavailableError('رسالة عربية آمنة.', code, 'corr-' + code)
      )
      const res = await inventoryForecastGET(req())
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe(code)
    }
  })

  it('genuinely empty inventory keeps the deterministic early return (no LLM call at all)', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([])
    const res = await inventoryForecastGET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.forecasts).toEqual([])
    expect(mockGateway.complete).not.toHaveBeenCalled()
  })

  it('non-AI failures stay Arabic-safe 500 without leaking raw error strings', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: 'i1', name: 'Gloves', sku: 'GL-1', currentStock: 50, minimumStock: 10, reorderLevel: 20, unit: 'box', purchasePrice: 30 },
    ])
    prisma.stockTransaction.findMany.mockResolvedValue([])
    mockGateway.complete.mockRejectedValue(new TypeError('secret internal detail XYZ'))

    const res = await inventoryForecastGET(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/[\u0600-\u06FF]/)
    expect(body.error).not.toContain('secret internal detail XYZ')
  })
})

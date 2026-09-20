// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

const { mockGetGateway } = vi.hoisted(() => ({
  mockGetGateway: vi.fn(),
}))
vi.mock('@/lib/payment-gateways', () => ({
  getGateway: mockGetGateway,
}))

// ── Imports ──────────────────────────────────────────────────────────────────

import { POST as webhookPOST } from '@/app/api/webhooks/payment/[provider]/route'
import { prisma } from '@/lib/prisma'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(provider: string, body: any, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/webhooks/payment/${provider}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

function makeParams(provider: string) {
  return { params: Promise.resolve({ provider }) }
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/webhooks/payment/[provider]
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/webhooks/payment/[provider]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for unknown provider', async () => {
    const res = await webhookPOST(makeReq('stripe', { some: 'data' }), makeParams('stripe') as any)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('Unknown provider')
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/payment/fawry', {
      method: 'POST',
      body: 'not-json{{{',
      headers: { 'Content-Type': 'text/plain' },
    })
    const res = await webhookPOST(req, makeParams('fawry') as any)
    expect(res.status).toBe(400)
  })

  it('handles fawry webhook — extracts merchantRefNum', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      id: 'pay1',
      hospitalId: 'h1',
      status: 'COMPLETED',
      gatewayOrderId: 'INV-2026-001-1700000000000',
    } as any)

    const res = await webhookPOST(
      makeReq(
        'fawry',
        {
          fawryRefNumber: 'FWRY-99001',
          merchantRefNum: 'INV-2026-001-1700000000000',
          orderStatus: 'PAID',
          paymentAmount: 1500,
          paymentMethod: 'CARD',
        },
        { 'x-fawry-signature': 'sig123' }
      ),
      makeParams('fawry') as any
    )
    const body = await res.json()

    expect(body.status).toBe('already_processed')
  })

  it('handles fawry webhook — updates pending payment on verified signature', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      id: 'pay1',
      hospitalId: 'h1',
      status: 'PENDING',
      gatewayOrderId: 'INV-2026-001-1700000000000',
    } as any)

    const mockGateway = {
      verifyWebhook: vi.fn().mockReturnValue(true),
    }
    mockGetGateway.mockResolvedValue({
      gateway: mockGateway,
      credentials: { webhookSecret: 'whsec_123' },
    })
    vi.mocked(prisma.payment.update).mockResolvedValue({} as any)

    const res = await webhookPOST(
      makeReq(
        'fawry',
        {
          fawryRefNumber: 'FWRY-99002',
          merchantRefNum: 'INV-2026-001-1700000000000',
          orderStatus: 'PAID',
          paymentAmount: 1500,
          paymentMethod: 'CARD',
        },
        { 'x-fawry-signature': 'sig456' }
      ),
      makeParams('fawry') as any
    )
    const body = await res.json()

    expect(body.status).toBe('ok')
    expect(mockGateway.verifyWebhook).toHaveBeenCalledWith(
      expect.stringContaining('FWRY-99002'),
      'sig456',
      'whsec_123'
    )
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { gatewayStatus: 'captured', status: 'COMPLETED' },
    })
  })

  it('handles paymob webhook — extracts obj.order_id', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      id: 'pay2',
      hospitalId: 'h1',
      status: 'COMPLETED',
      gatewayOrderId: '424242',
    } as any)

    const res = await webhookPOST(
      makeReq(
        'paymob',
        {
          type: 'TRANSACTION',
          obj: {
            id: 987654,
            order_id: 424242,
            amount_cents: 150000,
            success: true,
          },
        },
        { 'x-paymob-hmac': 'hmac123' }
      ),
      makeParams('paymob') as any
    )
    const body = await res.json()

    expect(body.status).toBe('already_processed')
  })

  it('handles instapay webhook — extracts the payment reference', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      id: 'pay3',
      hospitalId: 'h1',
      status: 'COMPLETED',
      gatewayOrderId: 'IP-INV-2026-001-abcdef12',
    } as any)

    const res = await webhookPOST(
      makeReq('instapay', {
        reference: 'IP-INV-2026-001-abcdef12',
        status: 'COMPLETED',
      }),
      makeParams('instapay') as any
    )
    const body = await res.json()

    expect(body.status).toBe('already_processed')
  })

  it('skips update when the webhook signature fails verification', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      id: 'pay4',
      hospitalId: 'h1',
      status: 'PENDING',
      gatewayOrderId: 'IP-INV-2026-001-abcdef12',
    } as any)

    const mockGateway = {
      verifyWebhook: vi.fn().mockReturnValue(false),
    }
    mockGetGateway.mockResolvedValue({
      gateway: mockGateway,
      credentials: { webhookSecret: 'whsec_123' },
    })

    const res = await webhookPOST(
      makeReq('instapay', {
        reference: 'IP-INV-2026-001-abcdef12',
        status: 'COMPLETED',
      }),
      makeParams('instapay') as any
    )
    const body = await res.json()

    expect(body.status).toBe('ok')
    expect(prisma.payment.update).not.toHaveBeenCalled()
  })

  it('acknowledges webhook when order_id cannot be extracted', async () => {
    const res = await webhookPOST(
      makeReq('fawry', { orderStatus: 'PAID' }),
      makeParams('fawry') as any
    )
    const body = await res.json()

    // Should acknowledge but not process
    expect(body.status).toBe('ok')
  })

  it('handles errors gracefully and returns 200', async () => {
    vi.mocked(prisma.payment.findFirst).mockRejectedValue(new Error('DB down'))

    const res = await webhookPOST(
      makeReq('fawry', {
        fawryRefNumber: 'FWRY-ERR',
        merchantRefNum: 'INV-ERR-1',
        orderStatus: 'PAID',
      }),
      makeParams('fawry') as any
    )
    const body = await res.json()

    // Always return 200 to avoid gateway retries
    expect(res.status).toBe(200)
    expect(body.status).toBe('error_logged')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageQueue: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}))

import { GET, POST } from '@/app/api/webhooks/whatsapp/route'
import { prisma } from '@/lib/prisma'

const VERIFY_TOKEN = 'test-verify-token-123'

function webhookRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost/api/webhooks/whatsapp${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function metaPayload(statuses: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1',
        changes: [{ value: { statuses, metadata: { phone_number_id: '111' } } }],
      },
    ],
  })
}

/**
 * Phase 10 (D5) — Meta WhatsApp webhook: hub verification (GET) and
 * delivery-receipt correlation (POST → MessageQueue.providerMessageId).
 */
describe('GET /api/webhooks/whatsapp (hub verification)', () => {
  beforeEach(() => {
    process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN
  })

  afterEach(() => {
    delete process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
  })

  it('echoes hub.challenge when mode + token match', async () => {
    const res = await GET(
      webhookRequest(
        `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHALLENGE-42`
      )
    )
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('CHALLENGE-42')
  })

  it('rejects a wrong verify token (403)', async () => {
    const res = await GET(
      webhookRequest('?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=X')
    )
    expect(res.status).toBe(403)
  })

  it('rejects non-subscribe modes (403)', async () => {
    const res = await GET(
      webhookRequest(`?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=X`)
    )
    expect(res.status).toBe(403)
  })

  it('rejects when no verify token is configured (fail closed, 403)', async () => {
    delete process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
    const res = await GET(webhookRequest('?hub.mode=subscribe&hub.verify_token=x&hub.challenge=X'))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/webhooks/whatsapp (delivery receipts)', () => {
  beforeEach(() => {
    vi.mocked(prisma.messageQueue.updateMany).mockClear()
  })

  it('correlates a delivered receipt via providerMessageId (sets deliveredAt)', async () => {
    const res = await POST(
      webhookRequest('', {
        method: 'POST',
        body: metaPayload([
          { id: 'wamid.HBgLMTA', status: 'delivered', to: '201012345678', timestamp: '1750000000' },
        ]),
      })
    )
    expect(res.status).toBe(200)
    expect(prisma.messageQueue.updateMany).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(prisma.messageQueue.updateMany).mock.calls[0][0]
    expect(arg.where).toEqual({ providerMessageId: 'wamid.HBgLMTA' })
    expect(arg.data.deliveryStatus).toBe('DELIVERED')
    expect(arg.data.deliveredAt).toBeInstanceOf(Date)
    expect(arg.data.readAt).toBeUndefined()
  })

  it('correlates a read receipt (sets deliveredAt + readAt)', async () => {
    await POST(
      webhookRequest('', {
        method: 'POST',
        body: metaPayload([{ id: 'wamid.READ', status: 'read' }]),
      })
    )
    const arg = vi.mocked(prisma.messageQueue.updateMany).mock.calls[0][0]
    expect(arg.data.deliveryStatus).toBe('READ')
    expect(arg.data.deliveredAt).toBeInstanceOf(Date)
    expect(arg.data.readAt).toBeInstanceOf(Date)
  })

  it('records a failed receipt without timestamps', async () => {
    await POST(
      webhookRequest('', {
        method: 'POST',
        body: metaPayload([{ id: 'wamid.FAIL', status: 'failed' }]),
      })
    )
    const arg = vi.mocked(prisma.messageQueue.updateMany).mock.calls[0][0]
    expect(arg.data.deliveryStatus).toBe('FAILED')
    expect(arg.data.deliveredAt).toBeUndefined()
    expect(arg.data.readAt).toBeUndefined()
  })

  it('processes several statuses in one payload', async () => {
    await POST(
      webhookRequest('', {
        method: 'POST',
        body: metaPayload([
          { id: 'w-1', status: 'sent' },
          { id: 'w-2', status: 'delivered' },
        ]),
      })
    )
    expect(prisma.messageQueue.updateMany).toHaveBeenCalledTimes(2)
  })

  it('always acks 200 even when the payload is malformed', async () => {
    const res = await POST(webhookRequest('', { method: 'POST', body: 'not-json{' }))
    expect(res.status).toBe(200)
    expect(prisma.messageQueue.updateMany).not.toHaveBeenCalled()
  })

  it('ignores entries without statuses (e.g. incoming message events)', async () => {
    const res = await POST(
      webhookRequest('', {
        method: 'POST',
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [{ id: '1', changes: [{ value: { messages: [{ id: 'in-1' }] } }] }],
        }),
      })
    )
    expect(res.status).toBe(200)
    expect(prisma.messageQueue.updateMany).not.toHaveBeenCalled()
  })
})

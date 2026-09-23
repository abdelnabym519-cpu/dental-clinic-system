import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Phase 10 — Meta WhatsApp Cloud API webhook.
 *
 * GET  — Meta hub verification (handshake when the webhook URL is registered):
 *        echoes `hub.challenge` only when `hub.verify_token` matches the
 *        token from Meta Business Manager (META_WHATSAPP_WEBHOOK_VERIFY_TOKEN).
 *
 * POST — delivery receipts. Meta sends `statuses[]` (sent | delivered | read
 *        | failed | deleted) keyed by the message `id` (wamid) returned when
 *        the message was sent. We correlate via MessageQueue.providerMessageId
 *        and record deliveryStatus + deliveredAt/readAt.
 *
 * Always answers 200 quickly — Meta retries on 5xx/timeouts, and receipt
 * processing must never block the acknowledgement.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  const expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** Maps a Meta status to the queue's delivery tracking fields. */
function statusData(status: string): { deliveryStatus: string; deliveredAt?: Date; readAt?: Date } {
  const now = new Date()
  switch (status.toLowerCase()) {
    case 'sent':
      return { deliveryStatus: 'SENT' }
    case 'delivered':
      return { deliveryStatus: 'DELIVERED', deliveredAt: now }
    case 'read':
      return { deliveryStatus: 'READ', deliveredAt: now, readAt: now }
    case 'failed':
      return { deliveryStatus: 'FAILED' }
    default:
      // 'deleted' and unknown statuses: acknowledge, but don't move tracking.
      return { deliveryStatus: status.toUpperCase() }
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            statuses?: Array<{ id?: string; status?: string }>
          }
        }>
      }>
    }

    const statuses = body.entry?.[0]?.changes?.[0]?.value?.statuses
    if (Array.isArray(statuses)) {
      for (const status of statuses) {
        const messageId = status.id
        const statusName = status.status
        if (!messageId || !statusName) continue
        const data = statusData(statusName)
        await prisma.messageQueue.updateMany({
          where: { providerMessageId: messageId },
          data: {
            deliveryStatus: data.deliveryStatus,
            ...(data.deliveredAt ? { deliveredAt: data.deliveredAt } : {}),
            ...(data.readAt ? { readAt: data.readAt } : {}),
          },
        })
      }
    }
  } catch (err) {
    console.error('[whatsapp webhook] failed to process payload:', err)
  }

  // Acknowledge even on processing errors — Meta retries aggressively, and a
  // re-processed receipt is idempotent (same deliveryStatus/timestamps).
  return NextResponse.json({ ok: true })
}

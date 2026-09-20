import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { getMessageLog } from '@/lib/messaging/service'
import { normalizeToE164 } from '@/lib/phone'

/**
 * GET /api/communications/messages — message log / audit (master prompt 3L).
 * RBAC: ADMIN only. Tenant-scoped. Recipients are returned masked; payload
 * attachment bytes never leave the server.
 *
 * Query: status, channel, messageType, page, limit
 */
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const result = await getMessageLog({
      hospitalId,
      status: searchParams.get('status') || undefined,
      channel: searchParams.get('channel') || undefined,
      messageType: searchParams.get('messageType') || undefined,
      page: parseInt(searchParams.get('page') || '1', 10) || 1,
      limit: parseInt(searchParams.get('limit') || '25', 10) || 25,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('Error fetching message log:', err)
    return NextResponse.json({ error: 'Failed to fetch message log' }, { status: 500 })
  }
}

/**
 * POST /api/communications/messages — queue a TEST message (ADMIN only).
 * Verifies the provider abstraction end-to-end without real credentials:
 * with messaging disabled / unconfigured, the mock provider handles it.
 * Body: { to: string, text?: string }
 */
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const to = typeof body?.to === 'string' ? body.to : ''
    const text =
      typeof body?.text === 'string' && body.text.trim()
        ? body.text.trim().slice(0, 500)
        : 'رسالة تجريبية من نظام إدارة العيادة ✅'

    if (!normalizeToE164(to)) {
      return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 })
    }

    const { enqueueMessage } = await import('@/lib/messaging/service')
    const queueId = await enqueueMessage({
      hospitalId,
      recipient: to,
      channel: 'WHATSAPP',
      messageType: 'TEST',
      payload: { text },
    })
    if (!queueId) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }
    return NextResponse.json({ success: true, queueId }, { status: 201 })
  } catch (err) {
    console.error('Error queueing test message:', err)
    return NextResponse.json({ error: 'Failed to queue message' }, { status: 500 })
  }
}

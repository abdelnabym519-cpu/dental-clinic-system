import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { cancelQueuedMessage, retryQueuedMessage } from '@/lib/messaging/service'

/**
 * PATCH /api/communications/messages/[id] — ADMIN lifecycle actions on a
 * queued message (tenant-scoped). Body: { action: 'cancel' | 'retry' }.
 * - cancel: PENDING → CANCELLED
 * - retry:  FAILED → PENDING (attempts reset, scheduled now)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const action = body?.action

    if (action === 'cancel') {
      const ok = await cancelQueuedMessage(id, hospitalId)
      return ok
        ? NextResponse.json({ success: true })
        : NextResponse.json({ error: 'Message not found or not pending' }, { status: 400 })
    }
    if (action === 'retry') {
      const ok = await retryQueuedMessage(id, hospitalId)
      return ok
        ? NextResponse.json({ success: true })
        : NextResponse.json({ error: 'Message not found or not failed' }, { status: 400 })
    }
    return NextResponse.json({ error: 'action must be cancel or retry' }, { status: 400 })
  } catch (err) {
    console.error('Error updating queued message:', err)
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}

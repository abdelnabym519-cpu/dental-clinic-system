import { NextResponse } from 'next/server'
import { processDueMessages } from '@/lib/messaging/service'

/**
 * GET|POST /api/cron/messages — background queue processor (master prompt 3B).
 * Scheduled alongside the existing reminders cron; authenticated with the same
 * CRON_SECRET bearer. Delivers due messages with WhatsApp→SMS fallback,
 * retry (max 3, exponential backoff) and dead-lettering.
 */
async function handle(req: Request) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200)
    const summary = await processDueMessages(limit)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('Error processing message queue:', err)
    return NextResponse.json({ error: 'Failed to process message queue' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}

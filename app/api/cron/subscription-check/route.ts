import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runSubscriptionHealthCheck } from '@/lib/licensing/subscription-health'
import type { LicensingPrisma } from '@/lib/licensing/types'

/**
 * Phase 9 licensing — daily subscription health check.
 *
 * Secured via CRON_SECRET Bearer token (same convention as the other
 * /api/cron/* routes). Schedule it once per day, e.g.:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" -X POST \
 *     https://<host>/api/cron/subscription-check
 *
 * Transitions: ACTIVE/TRIAL (past period end) -> GRACE_PERIOD -> EXPIRED,
 * each recorded in LicenseAuditLog. Never destructive: rows are only moved
 * forward through the lifecycle and the log is append-only.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const results = await runSubscriptionHealthCheck(prisma as unknown as LicensingPrisma, now)

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    results,
  })
}

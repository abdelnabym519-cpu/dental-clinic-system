import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStorage } from '@/lib/storage'
import { appVersion, releaseRevision } from '@/lib/config/version'
import { currentEnvironment } from '@/lib/config/env'

// Readiness probe. Answers a different question from /api/health: can this
// instance actually serve useful traffic right now?
//
// This one checks the REQUIRED dependency (the database): an instance that
// cannot reach it should be pulled out of the load balancer. The distinction
// matters: a failing readiness probe means "stop sending traffic", a failing
// liveness probe means "replace this container". Conflating them turns a
// database blip into a cascade of restarts.
//
// Phase 11 (§20): optional subsystems are reported INFORMATIONALLY and never
// gate readiness — storage driver identity, local AI engines (honest
// per-engine statuses live in the registry/capability matrix), Redis
// (not configured in this deployment → explicit, never faked). Only the
// database flips 503.
export const dynamic = 'force-dynamic'

function storageCheck(): 'ok' | 'not_configured' {
  try {
    const storage = getStorage()
    return storage && typeof storage === 'object' ? 'ok' : 'not_configured'
  } catch {
    return 'not_configured'
  }
}

export async function GET() {
  const version = appVersion()
  const sha = releaseRevision()
  try {
    // Cheapest possible round trip that proves the connection pool works.
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      {
        status: 'ready',
        version,
        revision: sha,
        environment: currentEnvironment(),
        checks: {
          database: 'ok',
          // Informational (never gates readiness):
          storage: storageCheck(),
          redis: 'not_configured',
          localAi: 'registry',
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    // Return 503 rather than throwing. An unhandled throw here becomes a 500,
    // which is indistinguishable from the app being broken in some other way —
    // 503 is the specific, correct signal for "not ready yet".
    console.error('[ready] database check failed:', error)

    // The detail stays in the logs. This endpoint is unauthenticated, and a
    // driver error can carry the host, port and user of the database.
    return NextResponse.json(
      {
        status: 'not_ready',
        version,
        environment: currentEnvironment(),
        checks: { database: 'error', storage: storageCheck(), redis: 'not_configured' },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

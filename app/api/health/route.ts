import { NextResponse } from 'next/server'
import { appVersion, releaseRevision } from '@/lib/config/version'
import { currentEnvironment } from '@/lib/config/env'

// Liveness probe. Answers one question: is this process alive and able to
// serve a request?
//
// It deliberately touches nothing — no database, no cache, no disk. A liveness
// probe that checks its dependencies will fail when the database blips, and an
// orchestrator reading that will kill and restart a perfectly healthy process,
// turning a brief database outage into a restart loop. Dependency checks belong
// in /api/ready, which orchestrators treat as "stop sending traffic" rather
// than "this container is broken, replace it".
//
// Phase 11: the payload also carries the version contract (§57) and the
// resolved logical environment — diagnostics without a new endpoint.
export const dynamic = 'force-dynamic'

export async function GET() {
  const sha = releaseRevision()
  return NextResponse.json(
    {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: appVersion(),
      revision: sha,
      environment: currentEnvironment(),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}

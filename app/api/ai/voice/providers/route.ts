/**
 * Phase 10 — Voice provider registry API (§40).
 *
 * GET /api/ai/voice/providers → the canonical typed registry (STT + TTS in
 * ONE registry) with HONEST verification statuses for this environment.
 * The Robot settings/health view and local-voice tooling read from here —
 * never from a second list.
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { VOICE_PROVIDER_REGISTRY, VOICE_REGISTRY_AUDITED_AT, VOICE_REGISTRY_ENV } from '@/lib/ai/voice/providers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    env: VOICE_REGISTRY_ENV,
    auditedAt: VOICE_REGISTRY_AUDITED_AT,
    providers: VOICE_PROVIDER_REGISTRY,
  })
}

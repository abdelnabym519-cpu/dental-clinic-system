/**
 * Phase 10 — Voice session API.
 *
 * POST /api/ai/voice/session  { locale }  → typed VoiceSession (server id)
 * DELETE /api/ai/voice/session?id=...     → typed cancel (terminal-safe)
 *
 * The actor + tenant come from the SESSION (never the client). Voice is a
 * STAFF surface in Phase 10 (same roles as the agent intelligence layer);
 * the patient-portal voice surface is a Phase 11 interface. Sessions are
 * ephemeral interaction state — conversation content stays in the existing
 * Conversation Memory (Phase 2/8).
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { voiceSessions } from '@/lib/ai/voice/session-store'
import { VOICE_LOCALES, type VoiceLocale } from '@/lib/ai/voice/types'
import type { VoiceSession } from '@/lib/ai/voice/types'

export const dynamic = 'force-dynamic' 

function publicView(s: VoiceSession) {
  return {
    voiceSessionId: s.voiceSessionId,
    locale: s.locale,
    state: s.state,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    conversationId: s.conversationId,
    patientScope: s.patientScope,
    caseScope: s.caseScope,
    expiresAt: s.expiresAt,
  }
}

export async function POST(req: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { locale?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const locale: VoiceLocale = (VOICE_LOCALES as readonly string[]).includes(body.locale ?? '')
    ? (body.locale as VoiceLocale)
    : 'ar-EG'

  const sessions = voiceSessions()
  sessions.sweep(new Date())

  // Reuse the tenant's latest AI conversation when one exists (existing
  // Conversation Memory — never a new store); otherwise start fresh and let
  // the agent create one.
  const lastConversation = await prisma.aIConversation.findFirst({
    where: { hospitalId, userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })

  const session = sessions.create({
    userId: user.id,
    tenantId: hospitalId,
    locale,
    conversationId: lastConversation?.id ?? null,
    now: new Date(),
  })

  // Non-blocking audit (never breaks the response).
  prisma.auditLog
    .create({
      data: {
        hospitalId,
        userId: user.id,
        action: 'AI_VOICE_SESSION',
        entityType: 'VoiceSession',
        entityId: session.voiceSessionId,
      },
    })
    .catch((e: unknown) => console.error('voice audit failed:', e instanceof Error ? e.message : e))

  return NextResponse.json({ session: publicView(session) })
}

export async function DELETE(req: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const ok = voiceSessions().delete(id, user.id, hospitalId)
  if (!ok) return NextResponse.json({ error: 'Voice session not found' }, { status: 404 })
  return NextResponse.json({ cancelled: true, voiceSessionId: id })
}

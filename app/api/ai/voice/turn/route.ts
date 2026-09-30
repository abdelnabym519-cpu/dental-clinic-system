/**
 * Phase 10 — Voice turn API.
 *
 * POST /api/ai/voice/turn
 *   body: {
 *     voiceSessionId: string,
 *     op?: 'SPEAK' | 'PLAYBACK_ENDED' | 'INTERRUPT' | 'CANCEL',
 *     transcript?: { text, confidence, isFinal, providerId, locale? }
 *   }
 *   → typed VoiceTurnResponse (state, speakableText, clarification,
 *     approval view, telemetry).
 *
 * Trust model:
 *  - actor + tenant: server session ONLY (requireAuthAndRole).
 *  - transcript: UNTRUSTED DATA — validated/normalized in the pipeline;
 *    the agent treats it exactly like typed chat text.
 *  - raw audio is NEVER accepted here (§41) — the contract carries typed
 *    STT output only.
 *  - rate limit mirrors the agent route (audit-log based).
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { voiceSessions } from '@/lib/ai/voice/session-store'
import { runVoiceTurn, type VoiceTurnDeps } from '@/lib/ai/voice/pipeline'
import { isVoiceTranscript } from '@/lib/ai/voice/stt'
import type { VoiceTurnInput, VoiceTurnResponse } from '@/lib/ai/voice/types'

export const dynamic = 'force-dynamic'

const VALID_OPS: VoiceTurnInput['op'][] = ['SPEAK', 'PLAYBACK_ENDED', 'INTERRUPT', 'CANCEL']

export async function POST(req: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const voiceSessionId = typeof body.voiceSessionId === 'string' ? body.voiceSessionId : ''
  if (!voiceSessionId || voiceSessionId.length > 64) {
    return NextResponse.json({ error: 'voiceSessionId is required' }, { status: 400 })
  }

  const op = (VALID_OPS as string[]).includes(body.op as string) ? (body.op as VoiceTurnInput['op']) : 'SPEAK'

  // Rate limit (audit-log based, same pattern as /api/ai/chat + agent).
  const oneMinuteAgo = new Date(Date.now() - 60_000)
  const recentCount = await prisma.auditLog.count({
    where: { hospitalId, userId: user.id, action: 'AI_VOICE_TURN', createdAt: { gte: oneMinuteAgo } },
  })
  if (recentCount >= 60) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 })
  }

  const transcript = isVoiceTranscript(body.transcript) ? body.transcript : undefined
  if (op === 'SPEAK' && !transcript) {
    return NextResponse.json({ error: 'transcript is required for SPEAK turns' }, { status: 400 })
  }

  const deps: VoiceTurnDeps = {
    sessions: voiceSessions(),
    // NOTE: the sandbox's prisma client generation is engine-blocked, so the
    // generated type lacks delegates (pre-existing, see docs). Runtime has
    // the full surface; the pipeline keeps its own minimal typed view.
    client: prisma as unknown as VoiceTurnDeps['client'],
    agent: {
      runAgent: async (request) => {
        const { runAgent } = await import('@/lib/ai/agent/loop')
        const { createProductionAgentDeps } = await import('@/lib/ai/agent/server-deps')
        return runAgent(request, await createProductionAgentDeps(prisma))
      },
    },
    now: () => new Date(),
    env: process.env.NODE_ENV === 'production' ? 'TARGET_MACHINE' : 'SANDBOX',
  }

  try {
    const result: VoiceTurnResponse = await runVoiceTurn(deps, {
      voiceSessionId,
      op,
      transcript,
      actor: { userId: user.id, name: user.name || 'User', role: user.role, tenantId: hospitalId },
    })

    // Non-blocking audit — PHI-minimized: ids, state, codes, timings only.
    prisma.auditLog
      .create({
        data: {
          hospitalId,
          userId: user.id,
          action: 'AI_VOICE_TURN',
          entityType: 'VoiceSession',
          entityId: voiceSessionId,
          newValues: JSON.stringify({
            state: result.state,
            op: result.op,
            agentStatus: result.agentStatus,
            taskType: result.taskType,
            duplicateSuppressed: result.duplicateSuppressed,
            error: result.error?.code ?? null,
            totalMs: result.telemetry.totalMs,
            approvalRequired: result.telemetry.approvalRequired,
          }),
        },
      })
      .catch((e: unknown) => console.error('voice audit failed:', e instanceof Error ? e.message : e))

    return NextResponse.json(result)
  } catch (err) {
    console.error('voice turn error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Phase 3 — Agent API.
 *
 * POST /api/ai/agent → structured AgentResponse (§23).
 *
 * The route resolves the actor from the SESSION (server-side) — client
 * identity, roles, tenants, approvals and action results are never trusted.
 * Client-suggested entities (patientId/patientName/toothFdi/case/study) are
 * re-validated inside the agent before any read or action uses them.
 *
 * This route is ADDITIVE: the legacy /api/ai/chat flow is untouched.
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { AgentRequest } from '@/lib/ai/agent/types'

export const dynamic = 'force-dynamic'

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

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  // Rate limit (audit-log based, same pattern as /api/ai/chat).
  const oneMinuteAgo = new Date(Date.now() - 60_000)
  const recentCount = await prisma.auditLog.count({
    where: { hospitalId, userId: user.id, action: 'AI_AGENT', createdAt: { gte: oneMinuteAgo } },
  })
  if (recentCount >= 30) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 })
  }

  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const request: AgentRequest = {
    requestId: `agreq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    conversationId: str(body.conversationId),
    actor: { id: user.id, name: user.name || 'User', role: user.role },
    hospitalId,
    message,
    patientId: str(body.patientId),
    patientName: str(body.patientName),
    toothFdi: typeof body.toothFdi === 'number' ? body.toothFdi : null,
    caseId: str(body.caseId),
    studyId: str(body.studyId),
    treatmentNo: str(body.treatmentNo),
    history: Array.isArray(body.history)
      ? (body.history as { role: 'user' | 'assistant'; content: string }[]).slice(-10)
      : undefined,
    page: str(body.page),
    timestamp: new Date().toISOString(),
    source: str(body.source) ?? 'agent-api',
  }

  try {
    // Dynamic imports keep the legacy chat route's startup cost unchanged
    // and isolate agent failures from the module graph.
    const { runAgent } = await import('@/lib/ai/agent/loop')
    const { DEFAULT_AGENT_LIMITS } = await import('@/lib/ai/agent/types')
    const { complete } = await import('@/lib/ai/openrouter')
    const { getModelByTier } = await import('@/lib/ai/models')

    const result = await runAgent(
      request,
      {
        client: prisma,
        // LLM usage is bounded by design: classification fallback + synthesis
        // only — never authorization, execution or approval.
        llm: async (messages, purpose) => {
          const model = getModelByTier(purpose === 'agent_synthesis' ? 'default' : 'fast')
          const { content, model: used } = await complete(messages, model)
          return { content, model: used }
        },
        limits: { ...DEFAULT_AGENT_LIMITS },
        now: () => new Date(),
      }
    )

    // Non-blocking audit (must never break the response).
    prisma.auditLog
      .create({
        data: {
          hospitalId,
          userId: user.id,
          action: 'AI_AGENT',
          entityType: 'AIConversation',
          entityId: result.trace.traceId,
        },
      })
      .catch((e: unknown) => console.error('AI agent audit failed:', e instanceof Error ? e.message : e))

    return NextResponse.json(result)
  } catch (err) {
    console.error('AI agent route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

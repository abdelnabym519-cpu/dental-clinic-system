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
import { detectInputLanguage } from '@/lib/ai/voice/language'

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
    language: detectInputLanguage(message).lang,
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
    // Phase 6 — attachment ids ONLY (server re-resolves every id against
    // the tenant; names/paths/URLs are never accepted from the client).
    attachments: Array.isArray(body.attachments)
      ? [...new Set(
          (body.attachments as unknown[])
            .filter((a): a is string => typeof a === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(a))
        )].slice(0, 4)
      : null,
  }

  try {
    // Dynamic imports keep the legacy chat route's startup cost unchanged
    // and isolate agent failures from the module graph.
    const { runAgent } = await import('@/lib/ai/agent/loop')
    const { DEFAULT_AGENT_LIMITS } = await import('@/lib/ai/agent/types')
    const { complete } = await import('@/lib/ai/gateway')
    const { getModelByTier } = await import('@/lib/ai/models')
    const { createOrchestratorCapabilitySource } = await import('@/lib/ai/engines/orchestrator-source')
    // Phase 6 — real-inference path: attachment service + LocalAIService
    // wired to the existing orchestrator transport (the single inference
    // boundary — no second pipeline, no engine selection from text).
    const { createAttachmentService } = await import('@/lib/ai/multimodal/attachments')
    const { LocalAIService } = await import('@/lib/ai/engines/local-ai-service')
    const { requestOrchestratorAnalyze } = await import('@/lib/ai-orchestrator')
    // Phase 8 — canonical memory (one architecture; Prisma-backed store).
    const { MemoryOrchestrator } = await import('@/lib/ai/memory/orchestrator')
    const { PrismaMemoryStore } = await import('@/lib/ai/memory/store')

    const capabilitySource = createOrchestratorCapabilitySource()

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
        // Phase 5 — local AI capability view (live orchestrator when
        // configured; the tool reports honest unavailability otherwise).
        localAiCapabilities: capabilitySource,
        // Phase 6 — attachment service (tenant-scoped, server-resolved).
        attachments: createAttachmentService(prisma),
        // Phase 6 — LocalAIService WITH transport: integrity-checked real
        // inference through the orchestrator (stand-in refusal, checksum
        // verification, job identity check). The cast preserves runtime
        // is_standin_* fields that AnalyzeResult does not declare.
        localAiService: new LocalAIService(
          capabilitySource,
          (p) =>
            requestOrchestratorAnalyze(p).then(
              (r) =>
                r as unknown as import('@/lib/ai/engines/local-ai-service').OrchestratorAnalyzeResponse,
            ),
        ),
        // Phase 8 — canonical memory service (the loop's only memory path).
        memory: new MemoryOrchestrator(new PrismaMemoryStore(prisma)),
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

/**
 * Phase 10 — production AgentDeps factory (server-side, additive).
 *
 * Mirrors the wiring inside /api/ai/agent/route.ts EXACTLY (same modules,
 * same transports) so the Voice layer drives the SAME agent with the SAME
 * boundaries: orchestrator capability source, attachment service,
 * LocalAIService over the orchestrator transport, canonical memory.
 *
 * The Phase 3 route keeps its inline wiring untouched (no Phase 3 files
 * changed); Phase 11 can migrate the route to this factory behind the same
 * behavior tests.
 */

import type { prisma as PrismaClientType } from '@/lib/prisma'
import type { AgentDeps } from '@/lib/ai/agent/types'

export type { AgentDeps }

/** The generated Prisma client type (avoid importing the singleton eagerly). */
export type ProductionPrisma = typeof PrismaClientType

/**
 * Build production agent dependencies. Dynamic imports keep route startup
 * cost unchanged and isolate agent-module failures from the module graph
 * (same pattern as the existing agent route).
 */
export async function createProductionAgentDeps(client: ProductionPrisma): Promise<AgentDeps> {
  const { DEFAULT_AGENT_LIMITS } = await import('@/lib/ai/agent/types')
  const { complete } = await import('@/lib/ai/gateway')
  const { getModelByTier } = await import('@/lib/ai/models')
  const { createOrchestratorCapabilitySource } = await import('@/lib/ai/engines/orchestrator-source')
  const { createAttachmentService } = await import('@/lib/ai/multimodal/attachments')
  const { LocalAIService } = await import('@/lib/ai/engines/local-ai-service')
  const { requestOrchestratorAnalyze } = await import('@/lib/ai-orchestrator')
  const { MemoryOrchestrator } = await import('@/lib/ai/memory/orchestrator')
  const { PrismaMemoryStore } = await import('@/lib/ai/memory/store')

  const capabilitySource = createOrchestratorCapabilitySource()

  return {
    client,
    // LLM usage stays bounded by design (classification fallback + synthesis
    // only — never authorization, execution or approval).
    llm: async (messages, purpose) => {
      const model = getModelByTier(purpose === 'agent_synthesis' ? 'default' : 'fast')
      const { content, model: used } = await complete(messages, model)
      return { content, model: used }
    },
    limits: { ...DEFAULT_AGENT_LIMITS },
    now: () => new Date(),
    localAiCapabilities: capabilitySource,
    attachments: createAttachmentService(client),
    localAiService: new LocalAIService(
      capabilitySource,
      (p) =>
        requestOrchestratorAnalyze(p).then(
          (r) =>
            r as unknown as import('@/lib/ai/engines/local-ai-service').OrchestratorAnalyzeResponse,
        ),
    ),
    memory: new MemoryOrchestrator(new PrismaMemoryStore(client)),
  }
}

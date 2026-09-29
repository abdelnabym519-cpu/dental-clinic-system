/**
 * LocalAiCapabilitySource backed by the live orchestrator (Phase 5).
 *
 * The orchestrator's registry is the SINGLE SOURCE OF TRUTH for engine
 * identity; this source only transports its /engines and /health views into
 * the typed client contract. Failures propagate to LocalAIService, which
 * reports honest unavailability — it never invents engine state.
 *
 * Server-only. The internal secret comes from the environment (never
 * hardcoded, never logged).
 */

import type { EngineHealthEntry, EngineInfo, LocalAiCapabilitySource } from './types'

const VIEW_TIMEOUT_MS = 2500

function baseUrl(): string {
  return (process.env.AI_ORCHESTRATOR_URL || 'http://localhost:8000').replace(/\/$/, '')
}

async function orchestratorGet(path: string): Promise<Record<string, unknown>> {
  const secret = process.env.ORCHESTRATOR_SECRET
  if (!secret) {
    throw new Error('ORCHESTRATOR_SECRET is not configured')
  }
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      headers: { 'X-Orchestrator-Secret': secret },
      signal: AbortSignal.timeout(VIEW_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(
      `orchestrator unreachable: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!res.ok) {
    throw new Error(`orchestrator ${path} returned HTTP ${res.status}`)
  }
  return (await res.json()) as Record<string, unknown>
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function createOrchestratorCapabilitySource(): LocalAiCapabilitySource {
  return {
    async getEngines(): Promise<EngineInfo[]> {
      const data = await orchestratorGet('/engines')
      const engines = Array.isArray(data.engines) ? (data.engines as Record<string, unknown>[]) : []
      return engines.map((e) => ({
        name: str(e.name),
        displayName: str(e.display_name),
        modelVersion: str(e.model_version),
        modelChecksum: str(e.model_checksum).toLowerCase(),
        modelSource: str(e.model_source),
        modelLicense: str(e.model_license),
        runtime: str(e.runtime),
        device: 'cpu',
        gpuOptional: false,
        cudaRequired: false,
        classes: (e.classes ?? {}) as Record<string, string>,
        supportedModalities: Array.isArray(e.supported_modalities)
          ? (e.supported_modalities as string[])
          : [],
        resultKind: (str(e.result_kind) || 'findings') as EngineInfo['resultKind'],
        lifecycleStatus: (str(e.lifecycle_status) || 'REGISTERED') as EngineInfo['lifecycleStatus'],
        lifecycleNote: e.lifecycle_note != null ? str(e.lifecycle_note) : undefined,
      }))
    },

    async getHealth(): Promise<EngineHealthEntry[]> {
      const data = await orchestratorGet('/health')
      const health = (data.engines_health ?? {}) as Record<string, Record<string, unknown>>
      return Object.entries(health).map(([name, h]) => ({
        name,
        reachable: h.reachable === true,
        modelLoaded: h.model_loaded === true,
        status: h.status != null ? str(h.status) : null,
        error: h.error != null ? str(h.error) : null,
        modelChecksum: h.model_checksum != null ? str(h.model_checksum).toLowerCase() : null,
        isStandin: Boolean(h.is_standin_not_meshsegnet ?? h.is_standin_not_liodon ??
          h.is_standin_not_implant ?? h.is_standin_not_orthodontic),
        lifecycleStatus: (str(h.lifecycle_status) || 'BLOCKED') as EngineHealthEntry['lifecycleStatus'],
        lifecycleReason: str(h.lifecycle_reason),
      }))
    },
  }
}

/**
 * Phase 7 — canonical PHI-minimized evaluation trace (§13/§14).
 *
 * Projects the REAL `AgentResponse`/`AgentTrace` (Phase 3) plus the
 * Phase 6-safe extension fields into the evaluation trace model. Reuses the
 * existing observability — it never re-stores what the loop already records,
 * and it never stores what the loop forbids: raw patient records,
 * attachment contents, secrets, or model chain-of-thought. Sensitive
 * inputs are reduced to hashes, counts, and safe references.
 */
import { createHash } from 'node:crypto'
import type { AgentRequest, AgentResponse } from '@/lib/ai/agent/types'
import type { EvaluationTrace } from './types'

export function safeHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/**
 * Build the canonical evaluation trace for one replayed request.
 * The input message is NOT stored (it may carry untrusted/PHI text) — only
 * its hash, so two runs of the same case are correlatable.
 */
export function toEvaluationTrace(
  response: AgentResponse,
  request: AgentRequest,
): EvaluationTrace {
  const t = response.trace
  const toolSummary = t.toolCalls.map((c) => ({
    index: c.index,
    tool: c.tool,
    ok: c.ok,
    latencyMs: c.latencyMs,
    inputKeys: Object.keys(c.input).sort(),
  }))
  const k = t.knowledge
  const engineRuns = (t.engines ?? []).map((e) => ({
    tool: e.tool,
    engine: e.engine,
    jobId: e.jobId,
    modality: e.modality,
    modelVersion: e.modelVersion,
  }))
  const attachmentIds = (t.attachments ?? []).map((a) => a.id)
  const byClass: Record<string, number> = {}
  for (const a of t.attachments ?? []) byClass[a.fileClass] = (byClass[a.fileClass] ?? 0) + 1
  const requested = Array.isArray(request.attachments) ? request.attachments.length : 0
  const deterministic = t.modelCalls === 0
  const blocked =
    (response.status === 'FAILED' && (t.failureCodes.includes('UNAUTHORIZED') || t.failureCodes.includes('POLICY_BLOCKED'))) ||
    response.verification?.result === 'FAIL'
  const structure: Record<string, unknown> = {
    requestId: request.requestId,
    tenantHash: safeHash(request.hospitalId),
    actorRole: request.actor.role,
    messageHash: safeHash(request.message),
    taskType: response.task?.taskType ?? null,
    patientInvolved: response.task?.patientInvolved ?? null,
    toothInvolved: response.task?.toothInvolved ?? null,
    stopReason: t.stopReason,
    status: response.status,
    stages: t.stages,
    modelCalls: t.modelCalls,
    tools: toolSummary,
    contextProfile: response.contextProfileUsed,
    knowledge: k
      ? {
          ok: k.ok, failureCode: k.failureCode, candidateCount: k.candidateCount,
          selectedCount: k.selectedCount, sourceCount: k.sourceCount,
          citationCount: k.citationCount, retrievalMs: k.retrievalMs,
        }
      : null,
    attachments: { requested, resolved: attachmentIds.length, byClass },
    engineRuns,
    approvalState: response.approvalState,
    actionsProposed: response.actionsProposed.length,
    actionsExecuted: response.actionsExecuted.length,
    verification: response.verification,
    failureCodes: t.failureCodes,
    limitHits: t.limits.hits,
    sources: response.sources.length,
    citations: response.evidence?.citations.length ?? 0,
    warnings: response.warnings.length,
    fallback: deterministic ? 'DETERMINISTIC' : 'LLM_FALLBACK_USED',
  }
  const fingerprint = createHash('sha256')
    .update(canonicalJson(structure))
    .digest('hex')
  return {
    traceId: t.traceId,
    requestId: request.requestId,
    tenantHash: safeHash(request.hospitalId),
    actorRole: request.actor.role,
    taskType: response.task?.taskType ?? null,
    stages: t.stages,
    toolSummary,
    routingDecision: {
      taskType: response.task?.taskType ?? null,
      stopReason: t.stopReason,
      deterministic,
    },
    contextProfile: response.contextProfileUsed,
    knowledgeRetrievalSummary: k
      ? {
          ok: k.ok,
          candidateCount: k.candidateCount,
          selectedCount: k.selectedCount,
          sourceCount: k.sourceCount,
          citationCount: k.citationCount,
          failureCode: k.failureCode,
          retrievalMs: k.retrievalMs,
        }
      : null,
    attachmentSummary: { requested, resolved: attachmentIds.length, byClass },
    engineIdentity: engineRuns,
    approvalState: response.approvalState?.state ?? null,
    safetyDecision: {
      blocked: Boolean(blocked),
      mode: response.approvalState?.state ?? null,
      verification: response.verification
        ? { verified: response.verification.verified, result: response.verification.result }
        : null,
    },
    latencyMs: t.totalMs,
    failureCode: t.failureCodes[0] ?? null,
    fallback: deterministic ? 'DETERMINISTIC' : 'LLM_FALLBACK_USED',
    timestamp: t.startedAt,
    fingerprint,
  }
}

/**
 * Deterministic JSON (sorted object keys, stable arrays) so the fingerprint
 * is stable across runs of the same case. Excludes traceId/startedAt
 * (run-identity, not behavior).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

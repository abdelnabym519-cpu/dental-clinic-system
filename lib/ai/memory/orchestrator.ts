/**
 * Phase 8 — Memory Orchestrator (the Agent-facing seam).
 *
 * Agent → Orchestrator → Policy → Retrieval → Validation → Context Assembly
 * (Phase 8 §9 — one architecture; the orchestrator is the ONLY way the
 * agent loop touches memory, and every call is bounded + deterministic).
 *
 * Deterministic-first rules:
 *  - memory is RETRIEVED only when a deterministic trigger fires
 *    (memory-intent in the message, or a case-level context profile)
 *  - memory is UPDATED only from server-verified facts (executed actions,
 *    engine runs) or explicit user statements — never from free LLM text
 *  - the LLM never chooses a write class, trust level, or scope
 */

import { expiryFromNow } from './retention'
import { serializeMemoryBlock } from './retrieval'
import type { MemoryStore } from './store'
import {
  type MemoryActor,
  type MemoryBlock,
  type MemoryDomain,
  type MemoryScope,
} from './types'

// ---------------------------------------------------------------------------
// Deterministic triggers
// ---------------------------------------------------------------------------

/**
 * Memory-intent signals (bilingual, deterministic). A message matching one
 * of these asks about / states persistent context ("what do we know…",
 * "previously…", "I prefer…"). Everything else gets no memory retrieval —
 * the smallest-sufficient-context rule applies.
 */
const MEMORY_INTENT_PATTERNS: RegExp[] = [
  // English — looking back / preferences
  /\b(previously|last time|last visit|in the past|earlier today|earlier this week)\b/i,
  /\b(we discussed|we agreed|you mentioned|i mentioned|as (we|i) (said|noted))\b/i,
  /\b(what (do|did) we (know|agree|decide)|what was our|do you remember|recall)\b/i,
  /\b(my (last|previous)|my preference|my preferred|my usual)\b/i,
  /\b(i (prefer|like to|always|usually)|please (remember|note that|keep in mind))\b/i,
  // Arabic — looking back / preferences
  /قبل|في السابق|آخر مرة|آخر زيارة|مرّة سابقة/,
  /ذكّرنا|نوقش|اتفقنا|ذكرت (أن|لي)|كما (قلنا|اتفقنا)/,
  /ما (نعرف|اتفقنا)|هل تتذكر|تذكّر/,
  /تفضيلي|أفضّل|يفضّل(ون)?|طبيعتي|عادة(ً)? أ|يرجى (تذكر|ملاحظة)/,
]

export function hasMemoryIntent(message: string): boolean {
  if (typeof message !== 'string' || !message) return false
  return MEMORY_INTENT_PATTERNS.some((re) => re.test(message))
}

/** Context profiles that are case-centric (case memory is always relevant). */
const CASE_PROFILES = new Set(['CASE', 'TREATMENT', 'FOLLOW_UP', 'TIMELINE', 'FULL_360'])

export interface MemoryAgentInput {
  hospitalId: string
  conversationId: string | null
  actor: MemoryActor
  message: string
  /** All scope values are SERVER-RESOLVED (never client text). */
  patientId: string | null
  doctorId: string | null
  caseId: string | null
  taskType: string
  contextProfile: string | null
  now: Date
  /** Loop-supplied bounds (AgentLimits) — retrieval is always bounded. */
  maxItems?: number
  maxChars?: number
}

/**
 * Decide WHICH memory domains to retrieve (deterministic, bounded to the
 * resolved scope). Returns null when no memory retrieval is warranted.
 */
export function planMemoryRetrieval(input: MemoryAgentInput): { domains: MemoryDomain[]; includeCandidate: boolean } | null {
  const intent = hasMemoryIntent(input.message)
  const caseLevel = input.contextProfile !== null && CASE_PROFILES.has(input.contextProfile)
  if (!intent && !caseLevel) return null

  const domains: MemoryDomain[] = []
  if (input.caseId && (caseLevel || intent)) domains.push('CASE')
  if (input.patientId && intent) domains.push('PATIENT')
  if (input.doctorId && intent) domains.push('DOCTOR')
  // Conversation continuity is always available when there is a conversation
  // and some trigger — candidates allowed here (explicitly labeled).
  const includeCandidate = !!input.conversationId
  if (input.conversationId && (intent || caseLevel)) domains.push('CONVERSATION')
  if (domains.length === 0) return null
  return { domains, includeCandidate }
}

export interface MemoryRetrievalResult {
  block: MemoryBlock
  serialized: string
  domains: MemoryDomain[]
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface MemoryService {
  prepare(input: MemoryAgentInput): Promise<MemoryRetrievalResult | null>
  update(update: MemoryAgentUpdate): Promise<MemoryUpdateResult>
}

export class MemoryOrchestrator implements MemoryService {
  constructor(private readonly store: MemoryStore) {}

  async prepare(input: MemoryAgentInput): Promise<MemoryRetrievalResult | null> {
    const plan = planMemoryRetrieval(input)
    if (!plan) return null
    const scope = scopeFor(input.actor, input)
    const blocks: MemoryRetrievalResult[] = []
    for (const domain of plan.domains) {
      const domainScope: MemoryScope = { ...scope, domain }
      const block = await this.store.query(
        {
          scope: domainScope,
          includeCandidate: plan.includeCandidate,
          maxItems: input.maxItems,
          maxChars: input.maxChars,
        },
        input.now,
      )
      if (block.items.length > 0) {
        blocks.push({ block, serialized: serializeMemoryBlock(block), domains: [domain] })
      }
    }
    if (blocks.length === 0) return null
    // Merge (order: CASE, PATIENT, DOCTOR, CONVERSATION — deterministic).
    const order: Record<MemoryDomain, number> = { CASE: 0, PATIENT: 1, DOCTOR: 2, CONVERSATION: 3, CLINIC: 4 }
    blocks.sort((a, b) => order[a.domains[0]] - order[b.domains[0]])
    const items = blocks.flatMap((b) => b.block.items)
    const mergedBlock: MemoryBlock = {
      scope: scope as MemoryScope,
      items,
      totalMatched: blocks.reduce((n, b) => n + b.block.totalMatched, 0),
      truncated: blocks.some((b) => b.block.truncated),
      budgetChars: Math.min(...blocks.map((b) => b.block.budgetChars)),
      usedChars: blocks.reduce((n, b) => n + b.block.usedChars, 0),
      candidateCount: blocks.reduce((n, b) => n + b.block.candidateCount, 0),
      trustSummary: mergeTrust(blocks),
    }
    const serialized = blocks.map((b) => b.serialized).join('\n')
    return { block: mergedBlock, serialized, domains: blocks.flatMap((b) => b.domains) }
  }

  /**
   * The "Update eligible memory" stage (Phase 8 §20). Deterministic writes
   * only — the loop passes server-verified facts, never free LLM text.
   * Failures are collected, never thrown (memory must not break the agent).
   */
  async update(update: MemoryAgentUpdate): Promise<MemoryUpdateResult> {
    return updateMemoryAfterExecution(this.store, update)
  }
}

function mergeTrust(blocks: MemoryRetrievalResult[]): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {}
  for (const b of blocks) {
    for (const [k, v] of Object.entries(b.block.trustSummary)) {
      out[k] = (out[k] ?? 0) + (v ?? 0)
    }
  }
  return out
}

function scopeFor(actor: MemoryActor, input: MemoryAgentInput): MemoryScope {
  return {
    hospitalId: input.hospitalId,
    domain: 'PATIENT',
    doctorId: input.doctorId,
    patientId: input.patientId,
    caseId: input.caseId,
    conversationId: input.conversationId,
  }
}

// ---------------------------------------------------------------------------
// Post-execution updates (deterministic writes only)
// ---------------------------------------------------------------------------

export interface MemoryAgentUpdate {
  hospitalId: string
  conversationId: string | null
  /** The server-resolved acting user (preference statements are theirs). */
  actor: MemoryActor
  patientId: string | null
  doctorId: string | null
  caseId: string | null
  /** Executed (not proposed, not blocked) actions from this run. */
  actionsExecuted: {
    action: string
    executed: boolean
    approvalId: string | null
    reference: string | null
  }[]
  /** Engine runs that actually executed (job id present). */
  engineRuns: { engine: string; jobId: string | null; modality: string | null }[]
  /**
   * Explicit user preference statements detected deterministically by the
   * caller (verbatim user text — never LLM-generated).
   */
  userPreferenceStatements: { domain: 'PATIENT' | 'DOCTOR'; text: string }[]
  now: Date
}

export interface MemoryUpdateResult {
  written: number
  failures: { code: string; detail: string }[]
}

const SYSTEM_ACTOR: MemoryActor = { id: 'system', role: 'SYSTEM' }

export async function updateMemoryAfterExecution(
  store: MemoryStore,
  update: MemoryAgentUpdate,
): Promise<MemoryUpdateResult> {
  const result: MemoryUpdateResult = { written: 0, failures: [] }
  const push = (e: unknown) => {
    result.failures.push({
      code: e instanceof Error && 'code' in e ? String((e as { code: string }).code) : 'MEMORY_WRITE_FAILED',
      detail: e instanceof Error ? e.message : String(e),
    })
  }

  // 1) Executed actions → EPISODIC system-verified events.
  for (const a of update.actionsExecuted) {
    if (!a.executed) continue
    const scope: MemoryScope | null =
      update.caseId
        ? { hospitalId: update.hospitalId, domain: 'CASE', caseId: update.caseId, patientId: update.patientId }
        : update.patientId
          ? { hospitalId: update.hospitalId, domain: 'PATIENT', patientId: update.patientId }
          : null
    if (!scope) continue
    try {
      await store.write(
        {
          scope,
          key: `event.${a.action}`,
          value: {
            action: a.action,
            reference: a.reference ?? null,
            approvalId: a.approvalId ?? null,
            at: update.now.toISOString(),
          },
          memoryType: 'EPISODIC',
          writeClass: 'SYSTEM_VERIFIED',
          trustLevel: 'SYSTEM_DERIVED',
          sourceKind: 'ACTION_RESULT',
          sourceRef: a.approvalId ?? a.reference ?? null,
          actor: SYSTEM_ACTOR,
          expiresAt: expiryFromNow(scope.domain, update.now),
        },
        update.now,
      )
      result.written += 1
    } catch (e) {
      push(e)
    }
  }

  // 2) Engine runs → EPISODIC system-verified (safe identity only).
  for (const e of update.engineRuns) {
    if (!e.jobId) continue // comparison-style runs have no job — not persisted
    const scope: MemoryScope | null =
      update.caseId
        ? { hospitalId: update.hospitalId, domain: 'CASE', caseId: update.caseId, patientId: update.patientId }
        : update.patientId
          ? { hospitalId: update.hospitalId, domain: 'PATIENT', patientId: update.patientId }
          : null
    if (!scope) continue
    try {
      await store.write(
        {
          scope,
          key: `engine.${e.engine}`,
          value: { engine: e.engine, jobId: e.jobId, modality: e.modality ?? null, at: update.now.toISOString() },
          memoryType: 'EPISODIC',
          writeClass: 'SYSTEM_VERIFIED',
          trustLevel: 'SYSTEM_DERIVED',
          sourceKind: 'ENGINE_RESULT',
          sourceRef: e.jobId,
          actor: SYSTEM_ACTOR,
          expiresAt: expiryFromNow(scope.domain, update.now),
        },
        update.now,
      )
      result.written += 1
    } catch (e) {
      push(e)
    }
  }

  // 3) Explicit user preference statements → STRUCTURED USER_PROVIDED.
  for (const p of update.userPreferenceStatements) {
    const scopeCol = p.domain === 'DOCTOR' ? { doctorId: update.doctorId } : { patientId: update.patientId }
    if (!scopeCol.doctorId && !scopeCol.patientId) continue
    const scope: MemoryScope = {
      hospitalId: update.hospitalId,
      domain: p.domain,
      doctorId: scopeCol.doctorId ?? null,
      patientId: scopeCol.patientId ?? null,
    }
    const key = prefKey(p.text)
    if (!key) continue
    try {
      await store.write(
        {
          scope,
          key,
          value: { text: p.text.slice(0, 500), statedAt: update.now.toISOString() },
          memoryType: 'STRUCTURED',
          writeClass: 'USER_CONFIRMED',
          trustLevel: 'USER_PROVIDED',
          sourceKind: 'USER_STATEMENT',
          sourceRef: update.conversationId,
          actor: update.actor,
          expiresAt: expiryFromNow(p.domain, update.now),
        },
        update.now,
      )
      result.written += 1
    } catch (e) {
      push(e)
    }
  }

  return result
}

/**
 * Deterministic extraction of an EXPLICIT preference statement from the
 * user's own message (their verbatim words — never LLM-generated text).
 * Returns null unless the message is a narrow, unambiguous preference
 * declaration in the first person.
 */
const EXPLICIT_PREFERENCE_PATTERNS: RegExp[] = [
  /^(i (prefer|like to|always|usually)|my (preference|preferred) (is|option|time|slot|doctor))/i,
  /^please (remember|note that) (i (prefer|like)|my (preference|preferred))/i,
  /^(أفضّل|تفضيلي هو|تفضيلي هو أن|أريد عادةً|عادةً أ)/,
]

export function extractUserPreferenceStatement(
  message: string,
  role: string,
): { domain: 'PATIENT' | 'DOCTOR'; text: string } | null {
  if (typeof message !== 'string' || !EXPLICIT_PREFERENCE_PATTERNS.some((re) => re.test(message.trim()))) {
    return null
  }
  if (role !== 'PATIENT' && role !== 'DOCTOR' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') return null
  const domain: 'PATIENT' | 'DOCTOR' = role === 'DOCTOR' ? 'DOCTOR' : 'PATIENT'
  return { domain, text: message.trim().slice(0, 500) }
}

/** Deterministic, stable key for a preference statement (never free text). */
export function prefKey(text: string): string | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
  if (!normalized) return null
  return `pref.${normalized}`
}

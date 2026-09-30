/**
 * Phase 10 — Voice replay engine (§44/§45).
 *
 * Extends the Phase 7 harness (does NOT replace it): voice golden cases
 * replay SYNTHETIC TYPED TRANSCRIPTS (never real audio, never PHI) through
 * the REAL voice pipeline (`runVoiceTurn`), which drives the REAL agent loop
 * over the SAME fake boundary used by UNIT_REPLAY (`buildReplayAgentDeps`).
 *
 * Determinism: scripted transcripts, injected clock, in-memory session
 * store, no audio persistence anywhere.
 *
 * A voice case is a SEQUENCE of typed turns (speech + control ops), because
 * interruption / clarification / confirmation / duplicates are inherently
 * multi-turn. Expected behavior asserts the canonical interaction states,
 * clarification codes, duplicate suppression, interruptions, approval
 * states, and agent routing — externally observable behavior only.
 */

import { z } from 'zod'
import { InMemoryVoiceSessionStore } from '@/lib/ai/voice/session'
import { runVoiceTurn, resetDuplicateWindows } from '@/lib/ai/voice/pipeline'
import type { VoiceTurnDeps, VoiceTurnCall } from '@/lib/ai/voice/pipeline'
import { VOICE_LOCALES, type VoiceLocale, type VoiceTurnResponse } from '@/lib/ai/voice/types'
import type { EvalCheck, EvalLanguage } from './types'
import { pass, fail } from './results'
import type { GoldenCase } from './types'
import { buildReplayAgentDeps, tenantFor, ACTOR_FOR_ROLE, type LlmCallLog, type ReplayOverrides } from './replay'
import { NOW } from '@/tests/harness/agent-fixtures'
import { runAgent } from '@/lib/ai/agent/loop'

// ---------------------------------------------------------------------------
// Voice golden case schema (voice fields are additive to the Phase 7 spirit)
// ---------------------------------------------------------------------------

export const voiceTurnSchema = z.object({
  /** Synthetic transcript text (typed STT output fixture — no audio). */
  text: z.string(),
  op: z.enum(['SPEAK', 'INTERRUPT', 'PLAYBACK_ENDED', 'CANCEL']).default('SPEAK'),
  confidence: z.number().min(0).max(1).default(0.95),
  /** Simulated milliseconds after the previous turn (drives fake clock). */
  afterMs: z.number().min(0).default(50),
})

export const voiceExpectedSchema = z.object({
  /** Canonical interaction state after EACH turn (1:1 with turns). */
  states: z.array(z.string()).optional(),
  /** Agent status observed on the LAST SPEAK turn (nullable). */
  agentStatus: z.string().nullable().optional(),
  taskType: z.union([z.string(), z.array(z.string())]).optional(),
  /** Clarification codes expected (union over turns). */
  clarifications: z.array(z.string()).optional(),
  duplicateSuppressed: z.boolean().optional(),
  interrupted: z.boolean().optional(),
  approvalRequired: z.boolean().optional(),
  /** Failure codes expected across turns (e.g. VOICE_SESSION_INVALID). */
  errorCodes: z.array(z.string()).optional(),
  /** Substring (or rx: regex) that must appear in speakable/display text. */
  mustContain: z.array(z.string()).optional(),
  mustNotContain: z.array(z.string()).optional(),
})

export const voiceGoldenCaseSchema = z.object({
  caseId: z.string().min(3),
  domain: z.string().min(1),
  language: z.custom<EvalLanguage>(() => true),
  title: z.string().min(3),
  description: z.string().optional(),
  actorRole: z.string().default('DOCTOR'),
  tenant: z.enum(['A', 'B']),
  locale: z.enum(VOICE_LOCALES).default('ar-EG'),
  /** Synthetic patient rows merged into the fake tenant DB (same as agent goldens). */
  patientContext: z.array(z.record(z.string(), z.unknown())).nullish(),
  turns: z.array(voiceTurnSchema).min(1),
  expected: voiceExpectedSchema,
  tags: z.array(z.string()).default([]),
})

export type VoiceGoldenCase = z.infer<typeof voiceGoldenCaseSchema>
export type VoiceTurnFixture = z.infer<typeof voiceTurnSchema>

export const voiceGoldenDatasetSchema = z.object({
  version: z.string(),
  description: z.string().optional(),
  cases: z.array(voiceGoldenCaseSchema),
})

export interface VoiceGoldenDataset {
  version: string
  description?: string
  cases: VoiceGoldenCase[]
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface VoiceTurnObservation {
  turnIndex: number
  state: string
  op: string
  agentStatus: string | null
  taskType: string | null
  clarificationCodes: string[]
  duplicateSuppressed: boolean
  interrupted: boolean
  approvalRequired: boolean
  errorCode: string | null
  speakable: string | null
  display: string | null
  totalMs: number
}

export interface VoiceReplayOutcome {
  sessionId: string
  observations: VoiceTurnObservation[]
  finalState: string
}

/**
 * Replay ONE voice golden case through the REAL pipeline + REAL agent loop.
 */
export async function replayVoiceCase(
  c: VoiceGoldenCase,
  overrides: ReplayOverrides = {},
): Promise<VoiceReplayOutcome> {
  resetDuplicateWindows()
  const hospitalId = tenantFor(c.tenant)
  const actor = ACTOR_FOR_ROLE[c.actorRole as keyof typeof ACTOR_FOR_ROLE] ?? ACTOR_FOR_ROLE.DOCTOR
  const llmLog: LlmCallLog = { calls: [] }
  const agentDeps = await buildReplayAgentDeps(
    {
      caseId: c.caseId,
      category: 'AGENT',
      domain: c.domain,
      language: c.language,
      title: c.title,
      actorRole: (c.actorRole as GoldenCase['actorRole']) ?? 'DOCTOR',
      tenant: c.tenant,
      patientContext: (c.patientContext ?? null) as GoldenCase['patientContext'],
      input: { message: c.turns[0]?.text ?? '' },
      expected: {},
      tags: c.tags,
    },
    overrides,
    llmLog,
  )

  const sessions = new InMemoryVoiceSessionStore()
  let clock = new Date(NOW).getTime()
  let session: { voiceSessionId: string } | null = null

  const deps: VoiceTurnDeps = {
    sessions,
    // Tenant-scoped patient reads over the SAME fake DB the agent sees.
    client: agentDeps.client as unknown as VoiceTurnDeps['client'],
    agent: {
      runAgent: (request) => runAgent(request, agentDeps),
    },
    now: () => new Date(clock),
    env: 'SANDBOX',
  }

  const observations: VoiceTurnObservation[] = []
  for (const turn of c.turns) {
    clock += turn.afterMs
    if (!session) {
      session = sessions.create({
        userId: actor.id,
        tenantId: hospitalId,
        locale: (VOICE_LOCALES as readonly string[]).includes(c.locale) ? c.locale as VoiceLocale : 'ar-EG',
        conversationId: 'conv-eval',
        now: new Date(clock),
      })
    }
    const call: VoiceTurnCall = {
      voiceSessionId: session.voiceSessionId,
      op: turn.op,
      actor: { userId: actor.id, name: actor.name, role: actor.role, tenantId: hospitalId },
      ...(turn.op === 'SPEAK'
        ? {
            transcript: {
              text: turn.text,
              confidence: turn.confidence,
              isFinal: true,
              providerId: 'fixture-stt',
              locale: c.locale,
              capturedAt: new Date(clock).toISOString(),
            },
          }
        : {}),
    }
    const res: VoiceTurnResponse = await runVoiceTurn(deps, call)
    observations.push({
      turnIndex: observations.length,
      state: res.state,
      op: res.op,
      agentStatus: res.agentStatus,
      taskType: res.taskType,
      clarificationCodes: res.clarification ? [res.clarification.code] : [],
      duplicateSuppressed: res.duplicateSuppressed,
      interrupted: res.interrupted,
      approvalRequired: res.telemetry.approvalRequired,
      errorCode: res.error?.code ?? null,
      speakable: res.speakableText,
      display: res.displayText,
      totalMs: res.telemetry.totalMs,
    })
  }

  return {
    sessionId: session?.voiceSessionId ?? 'none',
    observations,
    finalState: observations[observations.length - 1]?.state ?? 'IDLE',
  }
}

// ---------------------------------------------------------------------------
// Comparison — typed checks, same conventions as Phase 7 compareBehavior
// ---------------------------------------------------------------------------

export function compareVoiceBehavior(c: VoiceGoldenCase, obs: VoiceReplayOutcome): EvalCheck[] {
  const checks: EvalCheck[] = []
  const id = (n: string) => `${c.caseId}.${n}`
  const mismatch = (what: string, expected: unknown, observed: unknown) =>
    fail(id(what), 'EVAL_VOICE_BEHAVIOR_MISMATCH', `${what}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`)

  const e = c.expected
  if (e.states) {
    const observed = obs.observations.map((o) => o.state)
    checks.push(
      JSON.stringify(observed) === JSON.stringify(e.states)
        ? pass(id('states'), `states ${observed.join('→')}`)
        : mismatch('states', e.states, observed),
    )
  }
  if (e.agentStatus !== undefined) {
    const lastSpeak = [...obs.observations].reverse().find((o) => o.op === 'SPEAK')
    const observed = lastSpeak?.agentStatus ?? null
    checks.push(
      (e.agentStatus === null && observed === null) || observed === e.agentStatus
        ? pass(id('agentStatus'), `agentStatus ${observed}`)
        : mismatch('agentStatus', e.agentStatus, observed),
    )
  }
  if (e.taskType !== undefined) {
    const allowed = Array.isArray(e.taskType) ? e.taskType : [e.taskType]
    const observed = obs.observations.map((o) => o.taskType).filter(Boolean)
    checks.push(
      observed.some((t) => allowed.includes(t as string))
        ? pass(id('taskType'), `taskType ${[...new Set(observed)].join('/')}`)
        : mismatch('taskType', allowed, observed),
    )
  }
  if (e.clarifications) {
    const observed = [...new Set(obs.observations.flatMap((o) => o.clarificationCodes))]
    const ok = e.clarifications.every((code) => observed.includes(code))
    checks.push(ok ? pass(id('clarifications'), observed.join(',')) : mismatch('clarifications', e.clarifications, observed))
  }
  if (e.duplicateSuppressed !== undefined) {
    const observed = obs.observations.some((o) => o.duplicateSuppressed)
    checks.push(observed === e.duplicateSuppressed ? pass(id('duplicateSuppressed'), String(observed)) : mismatch('duplicateSuppressed', e.duplicateSuppressed, observed))
  }
  if (e.interrupted !== undefined) {
    const observed = obs.observations.some((o) => o.interrupted)
    checks.push(observed === e.interrupted ? pass(id('interrupted'), String(observed)) : mismatch('interrupted', e.interrupted, observed))
  }
  if (e.approvalRequired !== undefined) {
    const observed = obs.observations.some((o) => o.approvalRequired)
    checks.push(observed === e.approvalRequired ? pass(id('approvalRequired'), String(observed)) : mismatch('approvalRequired', e.approvalRequired, observed))
  }
  if (e.errorCodes) {
    const observed = [...new Set(obs.observations.map((o) => o.errorCode).filter(Boolean))] as string[]
    const ok = e.errorCodes.every((code) => observed.includes(code))
    checks.push(ok ? pass(id('errorCodes'), observed.join(',')) : mismatch('errorCodes', e.errorCodes, observed))
  }
  if (e.mustContain) {
    const haystack = obs.observations
      .map((o) => `${o.speakable ?? ''} ${o.display ?? ''}`)
      .join(' \n ')
    for (const needle of e.mustContain) {
      let ok: boolean
      if (needle.startsWith('rx:')) {
        try {
          ok = new RegExp(needle.slice(3), 'i').test(haystack)
        } catch {
          ok = false
        }
      } else {
        ok = haystack.includes(needle)
      }
      checks.push(ok ? pass(id('mustContain'), needle) : fail(id('mustContain'), 'EVAL_VOICE_TEXT_MISMATCH', `expected text containing ${JSON.stringify(needle)}, got ${JSON.stringify(haystack.slice(0, 400))}`))
    }
  }
  if (e.mustNotContain) {
    const haystack = obs.observations
      .map((o) => `${o.speakable ?? ''} ${o.display ?? ''}`)
      .join(' \n ')
    for (const needle of e.mustNotContain) {
      const ok = !haystack.includes(needle)
      checks.push(ok ? pass(id('mustNotContain'), needle) : fail(id('mustNotContain'), 'EVAL_VOICE_TEXT_MISMATCH', `forbidden text present: ${JSON.stringify(needle)}`))
    }
  }
  return checks
}

/** Convenience: replay + compare in one step (mirrors evaluateCase). */
export async function evaluateVoiceCase(
  c: VoiceGoldenCase,
  overrides: ReplayOverrides = {},
): Promise<{ checks: EvalCheck[]; outcome: VoiceReplayOutcome }> {
  const outcome = await replayVoiceCase(c, overrides)
  return { checks: compareVoiceBehavior(c, outcome), outcome }
}

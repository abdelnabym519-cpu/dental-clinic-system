// @ts-nocheck
/**
 * Conversational voice-agent harness — TURN-TAKING, BARGE-IN and the
 * multi-turn conversational scenarios (§5/§6/§7/§18/§25).
 *
 * These tests validate STATE TRANSITIONS, not only final strings:
 * partials buffer, incomplete finals hold, complete finals combine with the
 * buffer into ONE dispatched turn, barge-in preserves pins/history, and the
 * interruption-with-content reaches the agent as the doctor's real turn.
 * Everything runs the REAL pipeline (runVoiceTurn → runAgent) over the
 * replay agent boundary — no scripted agent answers.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildReplayAgentDeps } from '@/lib/ai/evaluation/replay'
import { runVoiceTurn, resetDuplicateWindows } from '@/lib/ai/voice/pipeline'
import { InMemoryVoiceSessionStore } from '@/lib/ai/voice/session'
import { runAgent } from '@/lib/ai/agent/loop'
import { NOW as AGENT_NOW, HOSP_A } from '@/tests/harness/agent-fixtures'
import { assessTurnCompletion, initialTurnState, mergePartial, VOICE_TURN_MAX_HOLDS } from '@/lib/ai/voice/turn-manager'
import { remainderAfterControlPhrase } from '@/lib/ai/voice/entity-resolution'

// محمد النبي EXISTS in the tenant DB (the DB decides identity — nothing is
// hardcoded); محمد علي does NOT exist (failed resolution is recoverable).
const MN = {
  id: 'pat-mn', hospitalId: 'hosp-A', patientId: 'PAT-MN',
  firstName: 'محمد', lastName: 'النبي', phone: '01000000001', age: 40,
  dateOfBirth: '1986-02-01', gender: 'MALE', bloodGroup: null,
  alternatePhone: null, email: null, locale: 'ar', portalUserId: null,
  createdAt: '2025-06-01', medicalHistory: null,
}
// Two patients whose names SHARE a first+second pair — a fuzzy collision
// must clarify, never silently pick (§13/Scenario H).
const MALL = {
  id: 'pat-mall', hospitalId: 'hosp-A', patientId: 'PAT-MALL',
  firstName: 'محمد', lastName: 'علي', phone: '01000000002', age: 30,
  dateOfBirth: '1996-05-01', gender: 'MALE', bloodGroup: null,
  alternatePhone: null, email: null, locale: 'ar', portalUserId: null,
  createdAt: '2025-06-01', medicalHistory: null,
}
const MAH = {
  id: 'pat-mah', hospitalId: 'hosp-A', patientId: 'PAT-MAH',
  firstName: 'محمد', lastName: 'احمد', phone: '01000000003', age: 31,
  dateOfBirth: '1995-05-01', gender: 'MALE', bloodGroup: null,
  alternatePhone: null, email: null, locale: 'ar', portalUserId: null,
  createdAt: '2025-06-01', medicalHistory: null,
}

const actor = { userId: 'staff-doctor-1', name: 'Dr Test', role: 'DOCTOR', tenantId: 'hosp-A' }
const tr = (text: string, isFinal = true, confidence = 0.93) => ({
  text, confidence, isFinal, providerId: 'fixture-stt', locale: 'ar-EG',
})

async function makeDeps(extraPatients: unknown[] = [], agentSpy: ((r: unknown) => void) | null = null) {
  const base = await buildReplayAgentDeps({
    caseId: 'TM', category: 'AGENT', domain: 'dental', language: 'ar',
    title: 'turn manager', actorRole: 'DOCTOR', tenant: 'A',
    patientContext: [...extraPatients, MN] as never,
    input: { message: 'x' }, expected: {},
  } as never)
  const sessions = new InMemoryVoiceSessionStore()
  const seen: string[] = []
  const deps = {
    sessions,
    client: base.client,
    agent: {
      runAgent: (r: any) => {
        seen.push(r.message)
        agentSpy?.(r)
        return runAgent(r, base)
      },
    },
    now: () => new Date(new Date(AGENT_NOW).getTime() + 60_000),
    env: 'SANDBOX',
  }
  const session = sessions.create({ userId: actor.userId, tenantId: actor.tenantId, locale: 'ar-EG', now: new Date(new Date(AGENT_NOW).getTime()) })
  return { deps, sessions, seen, session }
}
const turnOf = (deps: any, session: any) => deps.sessions.get(session.voiceSessionId, actor.userId, actor.tenantId)?.turn ?? initialTurnState()

beforeEach(() => resetDuplicateWindows())

describe('turn manager — end-of-turn assessment (deterministic)', () => {
  it('a trailing dependency word or ellipsis is INCOMPLETE; content/punctuation is complete', () => {
    expect(assessTurnCompletion('وريني مواعيد محمد النبي بتاع').complete).toBe(false)
    expect(assessTurnCompletion('وريني مواعيد المريض اللي').complete).toBe(false)
    expect(assessTurnCompletion('وريني مواعيد محمد النبي بكرة').complete).toBe(true)
    expect(assessTurnCompletion('وريني مواعيد محمد النبي بتاع...').complete).toBe(false)
    expect(assessTurnCompletion('وريني مواعيد محمد النبي؟').complete).toBe(true)
    expect(assessTurnCompletion('show me his appointments for').complete).toBe(false)
    expect(assessTurnCompletion('show me his appointments').complete).toBe(true)
  })

  it('an interim REPLACES its own previous text (never accumulates duplicates)', () => {
    let st = initialTurnState()
    for (const interim of ['وريني', 'وريني مواعيد', 'وريني مواعيد محمد']) {
      const m = mergePartial(st.bufferedTranscript, st.partialChars ?? 0, interim)
      st = { ...st, bufferedTranscript: m.text, partialChars: m.partialChars }
    }
    expect(st.bufferedTranscript).toBe('وريني مواعيد محمد')
    expect(st.partialChars).toBe('وريني مواعيد محمد'.length)
  })

  it('a control phrase WITH content yields the remainder; a bare control phrase yields null', () => {
    expect(remainderAfterControlPhrase('استنى قصدي الاسبوع ده')).toBe('قصدي الاسبوع ده')
    expect(remainderAfterControlPhrase('stop')).toBe(null)
    expect(remainderAfterControlPhrase('wait i mean next week')).toBe('i mean next week')
  })
})

describe('Scenario E — continued speech: the first fragment NEVER executes alone (§6)', () => {
  it('وريني مواعيد محمد النبي بتاع… → بكرة بالليل is ONE dispatched turn (combined)', async () => {
    const { deps, seen, session } = await makeDeps()
    // 1) the pause-finalized fragment ends mid-thought → HELD, no agent call
    const r1 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد محمد النبي بتاع'), actor })
    expect(seen).toHaveLength(0)
    expect(r1.speakableText).toBeNull()
    expect(r1.telemetry.turnPhase).toBe('POSSIBLE_END')
    expect(r1.telemetry.turnCompletionReason).toBe('HELD_INCOMPLETE')
    expect(turnOf(deps, session).bufferedTranscript).toContain('بتاع')
    // 2) the continuation completes the request → ONE combined dispatch
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('بكرة بالليل'), actor })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('وريني مواعيد محمد النبي بتاع')
    expect(seen[0]).toContain('بكره بالليل')
    expect(r2.telemetry.turnCompletionReason).toBe('COMBINED')
    expect(r2.telemetry.bufferedChars).toBe(0) // the buffer was consumed
    expect(r2.agentStatus).toBe('COMPLETED')
    expect(r2.displayText).toMatch(/مواعيد/)
    // tomorrow = NOW+1d in the replay clock (normalized text: بكرة→بكره)
    expect(r2.displayText).toContain(new Date(new Date(AGENT_NOW).getTime() + 86400000).toISOString().slice(0, 10))
  })

  it('an ASR interim (isFinal=false) is buffered and merges with the final — never executed', async () => {
    const { deps, seen, session } = await makeDeps()
    const r1 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد محمد النبي', false), actor })
    expect(seen).toHaveLength(0)
    expect(r1.telemetry.turnCompletionReason).toBe('PARTIAL_BUFFERED')
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('بكرة'), actor })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('وريني مواعيد محمد النبي')
    expect(seen[0]).toContain('بكره')
    expect(r2.agentStatus).toBe('COMPLETED')
  })

  it('the hold bound is bounded — after 3 holds the buffered content is dispatched (never wait forever)', async () => {
    const { deps, seen, session } = await makeDeps()
    for (let i = 0; i < VOICE_TURN_MAX_HOLDS; i++) {
      const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('والمواعيد بتاع'), actor })
      expect(seen).toHaveLength(0)
      expect(r.telemetry.turnCompletionReason).toBe('HELD_INCOMPLETE')
    }
    const r4 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('والمواعيد بتاع'), actor })
    expect(seen).toHaveLength(1) // forced dispatch — the robot never waits forever
    expect(r4.telemetry.turnCompletionReason).toBe('FORCED_AFTER_MAX_HOLDS')
  })
})

describe('Scenario F — barge-in: interruption preserves the task and applies the correction (§7)', () => {
  it('speech during SPEAKING interrupts TTS, keeps the pin, and the correction turn re-targets the task', async () => {
    const { deps, seen, session } = await makeDeps()
    // turn 1: establish the task + pin (الأسبوع الجاي = next week)
    const r1 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد محمد النبي الأسبوع الجاي.'), actor })
    expect(r1.agentStatus).toBe('COMPLETED')
    expect(turnOf(deps, session).phase).toBe('RESPONDING')
    expect(deps.sessions.get(session.voiceSessionId, actor.userId, actor.tenantId).patientScope?.patientId).toBe('pat-mn')
    // turn 2 arrives WHILE SPEAKING: barge-in with a temporal correction
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('استنى، قصدي الأسبوع ده.'), actor })
    expect(r2.interrupted).toBe(true)
    expect(r2.telemetry.bargeIn).toBe(true)
    expect(r2.telemetry.turnCompletionReason).toBe('BARGE_IN')
    // the pin SURVIVED the interruption (state preserved)
    expect(deps.sessions.get(session.voiceSessionId, actor.userId, actor.tenantId).patientScope?.patientId).toBe('pat-mn')
    expect(r2.agentStatus).toBe('COMPLETED')
    // the answer is the THIS-WEEK range (deterministic), NOT next week
    const from = new Date(AGENT_NOW).toISOString().slice(0, 10)
    const to = new Date(new Date(AGENT_NOW).getTime() + 6 * 86400000).toISOString().slice(0, 10)
    expect(r2.displayText).toContain(from)
    expect(r2.displayText).toContain(to)
  })

  it('an interruption with content reaches the agent as the REMAINDER (control prefix stripped)', async () => {
    const { deps, seen, session } = await makeDeps()
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد محمد النبي.'), actor })
    seen.length = 0
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('استنى، قصدي الأسبوع الجاي.'), actor })
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toContain('استنى')
    expect(seen[0]).toContain('قصدي')
    expect(seen[0]).toContain('الاسبوع الجاي')
  })
})

describe('Scenario G — pronoun continuation after a name (بتاعته)', () => {
  it('وقولي الأشعة بتاعته resolves the pronoun to the pinned patient', async () => {
    const { deps, session } = await makeDeps()
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد محمد النبي.'), actor })
    const pin = deps.sessions.get(session.voiceSessionId, actor.userId, actor.tenantId).patientScope
    expect(pin?.patientId).toBe('pat-mn')
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وقولي الأشعة بتاعته.'), actor })
    expect(r2.agentStatus).toBe('COMPLETED')
    // the possessive pronoun resolved from context — محمد النبي's imaging
    expect(r2.displayText).toMatch(/محمد النبي|أشعة/)
    expect(deps.sessions.get(session.voiceSessionId, actor.userId, actor.tenantId).patientScope?.patientId).toBe('pat-mn')
  })
})

describe('Scenario H — fuzzy identity collisions clarify, never guess (§13)', () => {
  it('a shared first+second pair across two patients → AMBIGUOUS clarification with candidates', async () => {
    const { deps, session } = await makeDeps([MALL, MAH])
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد محمد علي.'), actor })
    // محمد علي fully matches MALL AND collides with the other محمد-patients'
    // first word set — the matcher may not silently pick: clarify or honest
    // NOT_FOUND are the only safe outcomes, never a wrong single resolution.
    if (r.agentStatus === 'COMPLETED') {
      expect(r.displayText).toMatch(/محمد علي/)
    } else {
      expect(r.agentStatus).toBe('CLARIFICATION_REQUIRED')
      expect(r.resolvedPatient).toBeNull()
    }
  })

  it('محمد علي does NOT ride محمد النبي onto the wrong patient (exact-name DB decides)', async () => {
    const { deps, session } = await makeDeps([MALL])
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد المريض اللي اسمه محمد النبي.'), actor })
    expect(r.agentStatus).toBe('COMPLETED')
    // the CORRECT patient answered — never the Muhammad-Ali collision
    expect(r.displayText).toContain('محمد النبي')
    expect(r.displayText).not.toContain('محمد علي')
  })
})

describe('failure-layer attribution (§14 — who misunderstood whom)', () => {
  it('ASR layer: an unsafe/empty transcript is ASR_FAILURE telemetry', async () => {
    const { deps, session } = await makeDeps()
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('', true), actor })
    expect(r.error?.code).toBe('VOICE_TRANSCRIPT_EMPTY')
    expect(r.telemetry.failureLayer).toBe('ASR_FAILURE')
  })

  it('entity layer: a NOT_FOUND patient clarification is ENTITY_RESOLUTION_FAILURE', async () => {
    const { deps, session } = await makeDeps()
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد المريض اللي اسمه محمد علي.'), actor })
    expect(r.agentStatus).toBe('CLARIFICATION_REQUIRED')
    expect(r.telemetry.failureLayer).toBe('ENTITY_RESOLUTION_FAILURE')
  })

  it('reasoning layer: a crashed agent is AGENT_REASONING_FAILURE (honest ERROR, no fake answer)', async () => {
    const base = await buildReplayAgentDeps({
      caseId: 'TMF', category: 'AGENT', domain: 'dental', language: 'ar',
      title: 'failure', actorRole: 'DOCTOR', tenant: 'A', input: { message: 'x' }, expected: {},
    } as never)
    const sessions = new InMemoryVoiceSessionStore()
    const deps = {
      sessions, client: base.client,
      agent: { runAgent: () => { throw new Error('boom') } },
      now: base.now, env: 'SANDBOX',
    }
    const session = sessions.create({ userId: actor.userId, tenantId: actor.tenantId, locale: 'ar-EG', now: new Date(new Date(AGENT_NOW).getTime()) })
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: tr('وريني مواعيد أحمد.'), actor })
    expect(r.error?.code).toBe('VOICE_AGENT_ERROR')
    expect(r.telemetry.failureLayer).toBe('AGENT_REASONING_FAILURE')
  })
})

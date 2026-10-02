// @ts-nocheck
/**
 * Phase 10 — voice pipeline unit tests with a SCRIPTED agent runner.
 *
 * These test the VOICE layer's own behavior (state mapping, approval binding,
 * lifecycle ops, telemetry shape) against a deterministic AgentResponse
 * fixture. Full agent behavior is covered by the Phase 7 gates and the
 * voice golden replay (real agent over the fake boundary).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { runVoiceTurn, resetDuplicateWindows } from '@/lib/ai/voice/pipeline'
import { InMemoryVoiceSessionStore } from '@/lib/ai/voice/session'
import type { AgentResponse } from '@/lib/ai/agent/types'
import type { VoiceTurnDeps } from '@/lib/ai/voice/pipeline'

function agentResponse(over: Partial<AgentResponse> = {}): AgentResponse {
  return {
    answer: 'The queue has 2 patients.',
    status: 'COMPLETED',
    task: {
      taskType: 'OPERATIONAL', domains: ['scheduling'], riskLevel: 'NONE', executionMode: 'READ_ONLY',
      patientInvolved: false, toothInvolved: false, caseInvolved: false, readOnly: true,
      actionRequested: false, multiStep: false, confidence: 0.9, classifiedBy: 'deterministic',
      missingInfo: [], contextProfile: null,
    },
    warnings: [],
    toolsUsed: [],
    actionsProposed: [],
    actionsExecuted: [],
    sources: [],
    uncertainty: [],
    missingInfo: [],
    trace: {
      traceId: 'tr-dbg', taskType: 'OPERATIONAL', stages: {}, totalMs: 5, modelCalls: 0, modelLatencyMs: 0,
      toolCalls: [], limits: { hits: [], maxPlanSteps: 8, maxToolCalls: 8, maxIterations: 6, totalTimeoutMs: 20000 },
    },
    contextProfileUsed: null,
    failureCodes: [],
    ...over,
  } as unknown as AgentResponse
}

function makeDeps(scripted: (req: unknown) => AgentResponse, clientRows: Record<string, unknown>[] = []) {
  const sessions = new InMemoryVoiceSessionStore()
  let clock = new Date('2026-09-30T10:00:00Z').getTime()
  const deps: VoiceTurnDeps = {
    sessions,
    client: { patient: { findMany: async () => clientRows } },
    agent: { runAgent: async (req) => scripted(req) },
    now: () => new Date((clock += 50)),
    env: 'SANDBOX',
  }
  const session = sessions.create({ userId: 'u1', tenantId: 't1', locale: 'ar-EG', now: new Date(clock) })
  return { deps, session, sessions }
}

const actor = { userId: 'u1', name: 'Dr Test', role: 'DOCTOR', tenantId: 't1' }
const transcript = (text: string) => ({ text, confidence: 0.95, isFinal: true, providerId: 'fixture-stt', locale: 'ar-EG' })

describe('voice pipeline — lifecycle ops', () => {
  beforeEach(() => resetDuplicateWindows())

  it('SPEAK informational turn: IDLE → … → SPEAKING with agent answer', async () => {
    const { deps, session } = makeDeps(() => agentResponse())
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('مين في الانتظار؟'), actor })
    expect(r.error).toBeNull()
    expect(r.state).toBe('SPEAKING')
    expect(r.agentStatus).toBe('COMPLETED')
    expect(r.speakableText).toContain('queue has 2 patients')
    expect(r.telemetry.transcriptChars).toBeGreaterThan(0)
    expect(r.telemetry.env).toBe('SANDBOX')
  })

  it('PLAYBACK_ENDED completes only from SPEAKING', async () => {
    const { deps, session } = makeDeps(() => agentResponse())
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('مرحبا'), actor })
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'PLAYBACK_ENDED', actor })
    expect(r.state).toBe('COMPLETED')
  })

  it('CANCEL is terminal-safe and clears pending approval', async () => {
    const { deps, session } = makeDeps(() => agentResponse())
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'CANCEL', actor })
    expect(r.state).toBe('CANCELLED')
  })

  it('INTERRUPT from SPEAKING → INTERRUPTED and counts', async () => {
    const { deps, session } = makeDeps(() => agentResponse())
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('مرحبا'), actor })
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'INTERRUPT', actor })
    expect(r.state).toBe('INTERRUPTED')
    expect(r.interrupted).toBe(true)
    expect(r.telemetry.interruptionCount).toBe(1)
  })

  it('unknown session fails closed', async () => {
    const { deps } = makeDeps(() => agentResponse())
    const r = await runVoiceTurn(deps, { voiceSessionId: 'vs-nope', op: 'SPEAK', transcript: transcript('مرحبا'), actor })
    expect(r.error?.code).toBe('VOICE_SESSION_INVALID')
    expect(r.state).toBe('ERROR')
  })

  it('cross-tenant session binding fails closed (§42)', async () => {
    const { deps, session } = makeDeps(() => agentResponse())
    const r = await runVoiceTurn(deps, {
      voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('مرحبا'),
      actor: { ...actor, tenantId: 't2' },
    })
    expect(r.error?.code).toBe('VOICE_SESSION_INVALID')
  })

  it('partial transcripts are BUFFERED, never acted on (§6 — turn manager)', async () => {
    let called = 0
    const { deps, session } = makeDeps(() => { called += 1; return agentResponse() })
    const r = await runVoiceTurn(deps, {
      voiceSessionId: session.voiceSessionId, op: 'SPEAK',
      transcript: { text: 'احجز', confidence: 0.5, isFinal: false, providerId: 'fixture-stt' },
      actor,
    })
    // the interim is held in the session buffer — NO agent call, NO audio out
    expect(called).toBe(0)
    expect(r.speakableText).toBeNull()
    expect(r.agentStatus).toBeNull()
    expect(r.telemetry.turnCompletionReason).toBe('PARTIAL_BUFFERED')
    expect(r.telemetry.bufferedChars).toBeGreaterThan(0)
    const after = deps.sessions.get(session.voiceSessionId, actor.userId, actor.tenantId)
    expect(after?.turn?.bufferedTranscript).toContain('احجز')
  })

  it('agent exceptions surface as honest voice ERROR (no fake success)', async () => {
    const { deps, session } = makeDeps(() => { throw new Error('boom') })
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('مرحبا'), actor })
    expect(r.error?.code).toBe('VOICE_AGENT_ERROR')
    expect(r.state).toBe('ERROR')
  })
})

describe('voice pipeline — approval state mapping (no fake approval)', () => {
  beforeEach(() => resetDuplicateWindows())

  const pendingResponse = () => agentResponse({
    status: 'PENDING_APPROVAL',
    answer: 'The message draft is ready.',
    approvalState: { state: 'PENDING', approvalId: 'apr-77', fingerprint: 'fp', decision: null, decidedBy: null, decidedAt: null, replaySafe: true },
    actionsProposed: [{
      action: 'send_message', intent: 'notify patient', params: { patientName: 'Ahmed' },
      riskLevel: 'MEDIUM', approvalRequired: true, mode: 'APPROVAL_REQUIRED', status: 'PENDING_APPROVAL',
    }],
  })

  it('PENDING_APPROVAL → WAITING_APPROVAL + approval view + spoken confirmation prompt', async () => {
    const { deps, session } = makeDeps(() => pendingResponse())
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('ابعت للمريض رسالة'), actor })
    expect(r.state).toBe('WAITING_APPROVAL')
    expect(r.approval?.approvalId).toBe('apr-77')
    expect(r.approval?.action).toBe('send_message')
    expect(r.speakableText).toContain('أكد')
    expect(r.telemetry.approvalRequired).toBe(true)
  })

  it('explicit confirmation in the window proceeds; the answer never grants approval', async () => {
    const { deps, session } = makeDeps(() => pendingResponse())
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('ابعت للمريض رسالة'), actor })
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('أكد'), actor })
    expect(r2.error).toBeNull()
    // The pipeline re-enters the agent; the FINAL approval still belongs to
    // the Phase 1 ledger — the response cannot contain an approval grant.
    expect(r2.approval === null || r2.approval?.approvalId === 'apr-77').toBe(true)
    expect(r2.displayText).not.toContain('APPROVED')
  })

  it('bare affirmation does NOT confirm (background speech defense, §15)', async () => {
    let calls = 0
    const { deps, session } = makeDeps(() => { calls += 1; return pendingResponse() })
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('ابعت للمريض رسالة'), actor })
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('ايوه'), actor })
    // The bare yes went to the agent as normal speech (no confirmation binding).
    expect(calls).toBe(2)
    expect(r2.speakableText ?? '').not.toContain('تم الإرسال')
  })

  it('cancelling during WAITING_APPROVAL clears the binding', async () => {
    const { deps, session, sessions } = makeDeps(() => pendingResponse())
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('ابعت للمريض رسالة'), actor })
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'CANCEL', actor })
    const s = sessions.get(session.voiceSessionId, 'u1', 't1')
    expect(s?.state).toBe('CANCELLED')
    expect(s?.pendingApprovalId).toBeNull()
  })
})

describe('voice pipeline — duplicate suppression (§17)', () => {
  beforeEach(() => resetDuplicateWindows())

  it('repeated sensitive command is suppressed on the second identical turn', async () => {
    let calls = 0
    const { deps, session } = makeDeps(() => {
      calls += 1
      return agentResponse({
        status: 'FAILED',
        answer: 'Recording payments is not permitted for your role.',
        task: { taskType: 'ACTION_REQUEST', actionRequested: true, domains: ['billing'], riskLevel: 'HIGH', executionMode: 'FORBIDDEN', patientInvolved: true, toothInvolved: false, caseInvolved: false, readOnly: false, multiStep: false, confidence: 0.9, classifiedBy: 'deterministic', missingInfo: [], contextProfile: null },
      })
    })
    const r1 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('سجل دفعة 500 جنيه'), actor })
    expect(r1.state).toBe('ERROR')
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('سجل دفعة 500 جنيه'), actor })
    expect(r2.duplicateSuppressed).toBe(true)
    expect(calls).toBe(1) // the agent ran ONCE — the repeat never re-entered
  })

  it('informational repeats are allowed (read-only answers are idempotent)', async () => {
    let calls = 0
    const { deps, session } = makeDeps(() => { calls += 1; return agentResponse() })
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('مين في الانتظار؟'), actor })
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('مين في الانتظار؟'), actor })
    expect(calls).toBe(2)
    expect(r2.duplicateSuppressed).toBe(false)
  })
})

describe('voice pipeline — clarifications ask instead of guessing (§10)', () => {
  beforeEach(() => resetDuplicateWindows())

  it('ambiguous tooth number never reaches the agent', async () => {
    let calls = 0
    const { deps, session } = makeDeps(() => { calls += 1; return agentResponse() })
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('ركز على السن 63'), actor })
    expect(r.clarification?.code).toBe('TOOTH_AMBIGUOUS')
    expect(r.state).toBe('LISTENING')
    expect(calls).toBe(0)
    expect(r.speakableText).toContain('36')
    expect(r.speakableText).toContain('63')
  })

  it('ambiguous patient name asks with bounded candidates', async () => {
    let calls = 0
    const rows = [
      { id: 'p1', hospitalId: 't1', firstName: 'احمد', lastName: 'علي', patientId: 'PAT-1' },
      { id: 'p2', hospitalId: 't1', firstName: 'احمد', lastName: 'سعيد', patientId: 'PAT-2' },
    ]
    const { deps, session } = makeDeps(() => { calls += 1; return agentResponse() }, rows)
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: transcript('إيه حالة المريض احمد؟'), actor })
    expect(r.clarification?.code).toBe('PATIENT_AMBIGUOUS')
    expect(calls).toBe(0)
    expect(r.speakableText).toContain('احمد')
  })
})

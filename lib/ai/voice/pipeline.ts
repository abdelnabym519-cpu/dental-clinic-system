/**
 * Phase 10 — the ONE voice turn pipeline (§4/§14/§16/§17).
 *
 *   Speech → STT (typed transcript) → Input Validation → Control Phrases
 *   → Entity Resolution (existing graph) → EXISTING Agent Loop → Safety
 *   → Approval → Response → Speakable shaping → TTS → Audio output
 *
 * Hard rules:
 *  - The ACTOR comes from the server session (route) and is carried on every
 *    agent request — never asserted by the client, never hardcoded here.
 *  - The pipeline never decides clinical content and never executes actions:
 *    every write is the agent's Phase 1 pipeline outcome.
 *  - Clarification questions and control phrases are handled BEFORE the agent
 *    is invoked (cheaper, safer, keeps agent context clean).
 *  - Confirmation (§15) is bound to a single pending approval on THIS
 *    session; sensitive actions still keep the Phase 1 role-separated
 *    approval ledger — voice never grants approval.
 *
 * Testability: all effects arrive through VoiceTurnDeps (session store,
 * prisma-like client, agent deps, clock) — the replay harness injects fakes;
 * the route injects production wiring. Identical code path (§45).
 */

import {
  matchControlPhrase,
  patientClarification,
  extractPatientNameHint,
  resolvePatientReference,
  resolveToothReference,
  toothClarification,
} from './entity-resolution'
import { extractCorrectedPatientName } from '@/lib/ai/agent/classifier'
import { speakableFromResponse } from './tts'
import { prepareAgentMessage } from './normalize'
import { detectInputLanguage } from './language'
import { assessDuplicate, assessVoiceConfirmation, transcriptFingerprint, validateTranscriptSafety, type DuplicateWindowEntry } from './security'
import { isSessionExpired, transitionSession, type VoiceSessionStore } from './session'
import {
  VOICE_CONFIRM_WINDOW_MS,
  type InteractionState,
  type VoiceApprovalView,
  type VoiceClarification,
  type VoiceErrorCode,
  type VoiceSession,
  type VoiceTurnInput,
  type VoiceTurnResponse,
  type VoiceTurnTelemetry,
  type VoiceTranscript,
} from './types'

// ---------------------------------------------------------------------------
// Deps + call shape
// ---------------------------------------------------------------------------

export interface VoiceActorContext {
  /** Server-resolved (never client-asserted). */
  userId: string
  name: string
  role: string
  tenantId: string
}

export interface VoiceAgentRunner {
  runAgent: (request: import('@/lib/ai/agent/types').AgentRequest) => Promise<import('@/lib/ai/agent/types').AgentResponse>
}

export interface VoiceTurnDeps {
  sessions: VoiceSessionStore
  // Minimal tenant-scoped read surface (Prisma-compatible). The pipeline
  // never writes and never sees any other table.
  client: {
    patient: { findMany(args: any): Promise<{ id: string; firstName: string | null; lastName: string | null }[]> }
  }
  agent: VoiceAgentRunner
  now: () => Date
  env?: 'SANDBOX' | 'TARGET_MACHINE' | 'CI'
}

export interface VoiceTurnCall extends VoiceTurnInput {
  actor: VoiceActorContext
}

// ---------------------------------------------------------------------------
// Copy (bilingual; session locale picks the spoken variant)
// ---------------------------------------------------------------------------

function clarificationText(c: VoiceClarification, session: VoiceSession): string {
  return session.locale === 'ar-EG' ? c.questionAr : c.questionEn
}

function ackFor(kind: 'INTERRUPT' | 'CANCEL', session: VoiceSession): string {
  if (kind === 'CANCEL') return session.locale === 'ar-EG' ? 'تم إلغاء الطلب. في خدمتك.' : 'Cancelled. I am here when you need me.'
  return session.locale === 'ar-EG' ? 'تم التوقف. أنا سامعك.' : 'Stopped. I am listening.'
}

function approvalPromptText(session: VoiceSession): string {
  return session.locale === 'ar-EG'
    ? 'الإجراء محتاج موافقة. لو ده طلبك قول "أكد". القرار النهائي للإجراءات الحساسة بيفضل عبر نظام الموافقات بالصلاحيات المطلوبة.'
    : 'This action needs approval. If that is your request, say "confirm". Final approval for sensitive actions still follows the role-separated approval system.'
}

function duplicateNotice(session: VoiceSession): string {
  return session.locale === 'ar-EG'
    ? 'الطلب ده اتسمع حالًا — مش هكرر الإجراء تاني. لو فعلاً عايز تكراره قوله من جديد بعد لحظات.'
    : 'I just heard that command — I will not repeat the action. Say it again in a moment if you truly want to repeat it.'
}

function agentErrorText(session: VoiceSession): string {
  return session.locale === 'ar-EG'
    ? 'حصلت مشكلة أثناء التنفيذ. جرّب تاني.'
    : 'Something went wrong while processing. Please try again.'
}

// ---------------------------------------------------------------------------
// Duplicate window (per session id, in-process; replay injects fresh state)
// ---------------------------------------------------------------------------

const duplicateWindows = new Map<string, DuplicateWindowEntry[]>()

export function duplicateWindowFor(sessionId: string): DuplicateWindowEntry[] {
  let w = duplicateWindows.get(sessionId)
  if (!w) {
    w = []
    duplicateWindows.set(sessionId, w)
  }
  return w
}

/** Test/replay hook: clear duplicate history (determinism). */
export function resetDuplicateWindows(): void {
  duplicateWindows.clear()
}

function fingerprintOf(normalized: string, tenantId: string, userId: string): string {
  return transcriptFingerprint(normalized, tenantId, userId)
}


// ---------------------------------------------------------------------------
// Telemetry skeleton (PHI-minimized, §22)
// ---------------------------------------------------------------------------

function baseTelemetry(session: VoiceSession, turnIndex: number): VoiceTurnTelemetry {
  return {
    voiceSessionId: session.voiceSessionId,
    locale: session.locale,
    turnIndex,
    transcriptChars: 0,
    transcriptFingerprint: '',
    language: 'en',
    sttProviderId: '',
    sttConfidence: 0,
    normalizeMs: 0,
    entityResolutionMs: 0,
    agentMs: 0,
    totalMs: 0,
    interruptionCount: session.interruptionCount,
    duplicateSuppressed: false,
    state: session.state,
    agentStatus: null,
    approvalRequired: false,
    error: null,
    env: 'SANDBOX',
  }
}

function approvalViewFromAgent(agent: import('@/lib/ai/agent/types').AgentResponse): VoiceApprovalView | null {
  const st = agent.approvalState
  if (!st || st.state !== 'PENDING' || !st.approvalId) return null
  const first = agent.actionsProposed?.[0]
  return {
    approvalId: st.approvalId,
    action: first?.action ?? 'unknown',
    riskLevel: first?.riskLevel ?? 'UNKNOWN',
    params: (first?.params ?? {}) as Record<string, string>,
    requestReason: first?.reason ?? null,
    expiresAt: null,
  }
}

function agentRequest(session: VoiceSession, actor: VoiceActorContext, call: VoiceTurnCall, message: string, patientId: string | null, toothFdi: number | null, now: Date, patientNameHint: string | null = null): import('@/lib/ai/agent/types').AgentRequest {
  return {
    requestId: `vturn-${session.voiceSessionId}-${session.turnCount}`,
    conversationId: session.conversationId,
    actor: { id: actor.userId, name: actor.name, role: actor.role },
    hospitalId: actor.tenantId,
    message,
    patientId,
    patientName: patientNameHint,
    toothFdi,
    // Bounded prior turns (§8): lets the agent resolve conversational
    // references ('الحالة دي', 'آخر واحدة') within THIS session only.
    history: (session.history ?? []).slice(-12),
    timestamp: now.toISOString(),
    source: 'voice',
    // Robot language policy (§10): the response language follows the
    // conversation — the session locale AFTER this turn's language context
    // update (confident non-mixed turns flip it; mixed keep it).
    language: session.locale === 'ar-EG' ? 'ar' : 'en',
  }
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export async function runVoiceTurn(deps: VoiceTurnDeps, call: VoiceTurnCall): Promise<VoiceTurnResponse> {
  const t0 = deps.now()
  const nowMs = t0.getTime()
  const op: VoiceTurnInput['op'] = call.op ?? 'SPEAK'

  // ---- 1. Session binding (fail closed: unknown / foreign / expired) ------
  const sessions = deps.sessions
  const session = sessions.get(call.voiceSessionId, call.actor.userId, call.actor.tenantId)
  if (!session) {
    return rejected(call.voiceSessionId, 'VOICE_SESSION_INVALID', 'Unknown or foreign voice session', deps.env ?? 'SANDBOX')
  }
  if (isSessionExpired(session, t0)) {
    sessions.delete(session.voiceSessionId, session.userId, session.tenantId)
    return rejected(session.voiceSessionId, 'VOICE_SESSION_EXPIRED', 'Voice session expired', deps.env ?? 'SANDBOX')
  }

  // ---- 2. Lifecycle ops (robot/voice client) ------------------------------
  if (op === 'INTERRUPT') {
    let next = session
    if (session.state !== 'CANCELLED') {
      try {
        next = transitionSession(session, 'INTERRUPTED', { now: t0 })
        next.interruptionCount += 1
      } catch {
        next = session // ILLEGAL from this state → no-op, report current
      }
    }
    sessions.save(next)
    return respond(next, 'INTERRUPT', {
      interrupted: next.state === 'INTERRUPTED',
      telemetry: { ...baseTelemetry(next, next.turnCount), interruptionCount: next.interruptionCount },
    })
  }
  if (op === 'PLAYBACK_ENDED') {
    let next = session
    if (session.state === 'SPEAKING') {
      next = transitionSession(session, 'COMPLETED', { now: t0 })
      sessions.save(next)
    }
    return respond(next, 'PLAYBACK_ENDED', { telemetry: baseTelemetry(next, next.turnCount) })
  }
  if (op === 'CANCEL') {
    const next: VoiceSession = {
      ...session,
      state: 'CANCELLED',
      lastActivityAt: t0.toISOString(),
      pendingApprovalId: null,
      pendingApprovalExpiresAt: null,
    }
    sessions.save(next)
    return respond(next, 'CANCEL', { telemetry: baseTelemetry(next, next.turnCount) })
  }

  // ---- 3. SPEAK: typed transcript validation ------------------------------
  const transcript: VoiceTranscript | undefined = call.transcript
  if (!transcript) {
    return rejected(session.voiceSessionId, 'VOICE_TRANSCRIPT_EMPTY', 'transcript is required for SPEAK', deps.env ?? 'SANDBOX')
  }
  const safety = validateTranscriptSafety(transcript)
  if (!safety.ok) {
    const err: VoiceErrorCode = safety.code ?? 'VOICE_TRANSCRIPT_UNSAFE'
    return rejected(session.voiceSessionId, err, 'Transcript rejected', deps.env ?? 'SANDBOX')
  }
  const normalized = safety.normalized
  // The agent sees sanitized natural text (digit-folded, control-stripped) —
  // NOT the entity-resolution normalization (which folds Arabic letters and
  // would break the agent's own Arabic routing).
  const agentMessage = prepareAgentMessage(transcript.text)
  const safetyOriginal = agentMessage

  // LISTENING → UNDERSTANDING (double-submit keeps previous legal state)
  let working = session
  try {
    working = transitionSession(session, 'UNDERSTANDING', { now: t0 })
  } catch {
    working = session
  }
  working.turnCount += 1
  const turnIndex = working.turnCount

  // ---- Language context (Robot consolidation §10/§11) --------------------
  // The response language follows the ACTUAL conversation: detect the
  // dominant script of this turn. A confident, NON-MIXED turn in the other
  // language flips the session language (so copy + TTS track the doctor);
  // mixed turns keep the current session language (no flip-flopping on one
  // borrowed word). The UI locale only seeds the FIRST session.
  const detected = detectInputLanguage(normalized)
  const detectedSessionLocale: 'ar-EG' | 'en-US' = detected.lang === 'ar' ? 'ar-EG' : 'en-US'
  if (!detected.mixed && working.locale !== detectedSessionLocale) {
    working = { ...working, locale: detectedSessionLocale }
  }
  const languageContext = { detected: detected.lang, mixed: detected.mixed, session: working.locale }

  // ---- 4. Control phrases BEFORE the agent (§16) --------------------------
  const control = matchControlPhrase(normalized)
  if (control === 'INTERRUPT' || control === 'CANCEL') {
    let next = working
    try {
      next = transitionSession(working, 'INTERRUPTED', { now: t0 })
      next.interruptionCount += 1
    } catch {
      next = working
    }
    if (control === 'CANCEL') {
      next.pendingApprovalId = null
      next.pendingApprovalExpiresAt = null
    }
    sessions.save(next)
    const spoken = ackFor(control, next)
    return respond(next, 'SPEAK', {
      language: languageContext,
      speakableText: spoken,
      displayText: spoken,
      interrupted: true,
      telemetry: {
        ...baseTelemetry(next, turnIndex),
        transcriptChars: normalized.length,
        language: safety.language,
        sttProviderId: transcript.providerId,
        sttConfidence: transcript.confidence,
        totalMs: deps.now().getTime() - nowMs,
        interruptionCount: next.interruptionCount,
        state: next.state,
        transcriptFingerprint: fingerprintOf(normalized, next.tenantId, next.userId),
      },
    })
  }

  // ---- 5. Confirmation binding (WAITING_APPROVAL only, §15) ---------------
  if (working.state === 'WAITING_APPROVAL') {
    const confirm = assessVoiceConfirmation(normalized, working, nowMs)
    if (confirm.valid && working.pendingApprovalId) {
      const approvalId = working.pendingApprovalId
      const next = transitionSession(working, 'PROCESSING', { now: t0 })
      next.pendingApprovalId = null
      next.pendingApprovalExpiresAt = null
      sessions.save(next)
      const agentMsStart = deps.now().getTime()
      let agent: import('@/lib/ai/agent/types').AgentResponse
      try {
        agent = await deps.agent.runAgent(
          agentRequest(next, call.actor, call, agentMessage, next.patientScope?.patientId ?? null, null, t0),
        )
      } catch {
        const failed = transitionSession(next, 'ERROR', { now: t0 })
        sessions.save(failed)
        const spoken = agentErrorText(failed)
        return respond(failed, 'SPEAK', {
          language: languageContext,
          speakableText: spoken,
          displayText: spoken,
          error: { code: 'VOICE_AGENT_ERROR', message: 'Agent invocation failed' },
          telemetry: { ...baseTelemetry(failed, turnIndex), transcriptChars: normalized.length, language: safety.language, sttProviderId: transcript.providerId, sttConfidence: transcript.confidence, totalMs: deps.now().getTime() - nowMs, error: 'VOICE_AGENT_ERROR', transcriptFingerprint: fingerprintOf(normalized, failed.tenantId, failed.userId) },
        })
      }
      const agentMs = deps.now().getTime() - agentMsStart
      // The agent re-evaluates; if the action still needs the human ledger
      // decision it answers PENDING_APPROVAL again (voice cannot grant it).
      return finishAgentTurn(deps, {
        deps, call, t0, nowMs, turnIndex, normalized, safety, transcript,
        session: next, agent, agentMs,
        entityResolutionMs: 0,
        confirmedApprovalId: approvalId,
        language: languageContext,
      })
    }
    // A bare confirmation with nothing pending falls through as normal
    // speech — the agent will clarify. No approval is ever fabricated.
  }

  // ---- 6. Duplicate-action protection (§17) -------------------------------
  const window = duplicateWindowFor(working.voiceSessionId)
  const dup = assessDuplicate(normalized, working.tenantId, working.userId, window, nowMs)
  if (dup.duplicate) {
    let next = working
    try {
      next = transitionSession(working, 'SPEAKING', { now: t0 })
      next.retryCount += 1
    } catch {
      next = working
    }
    sessions.save(next)
    const spoken = duplicateNotice(next)
    return respond(next, 'SPEAK', {
      language: languageContext,
      speakableText: spoken,
      displayText: spoken,
      duplicateSuppressed: true,
      telemetry: { ...baseTelemetry(next, turnIndex), transcriptChars: normalized.length, language: safety.language, sttProviderId: transcript.providerId, sttConfidence: transcript.confidence, duplicateSuppressed: true, totalMs: deps.now().getTime() - nowMs, transcriptFingerprint: dup.fingerprint },
    })
  }

  // ---- 7. Entity resolution over the existing graph (never guess) ---------
  const entityStart = deps.now().getTime()
  let patientId: string | null = working.patientScope?.patientId ?? null
  let clarification: VoiceClarification | null = null
  let toothFdi: number | null = null
  // §17 — set when the turn is an explicit patient CORRECTION with a name.
  let correctionName: string | null = null

  const tooth = resolveToothReference(normalized)
  if (tooth.status === 'RESOLVED') toothFdi = tooth.fdi
  else if (tooth.status === 'AMBIGUOUS') clarification = toothClarification(tooth)

  if (!clarification) {
    // Hints come from the SANITIZED ORIGINAL text: normalization folds
    // ى→ي / أ→ا, and the hint must be comparable to the STORED name forms
    // (the resolver itself normalizes both sides before comparing).
    const hint = extractPatientNameHint(safetyOriginal)
    // §17 — an explicit CORRECTION ('لا، قصدي محمد', 'I mean Mohamed') with a
    // resolvable name RE-RESOLVES: the stale pin loses to the corrected name.
    // The new identity is still server-verified by the agent (never guessed),
    // and without BOTH a cue and a name the pinned scope persists untouched.
    if (!hint?.first && working.patientScope?.patientId &&
        /(?:^|\s)(?:قصدي|مقصدش|مقصدي|أقصد|اقصد|أنا بقصد|\bi mean\b|\bi meant\b)/i.test(safetyOriginal)) {
      const corrected = extractCorrectedPatientName(safetyOriginal)
      if (corrected) correctionName = corrected
    }
    // Phase 11 (§59): a dependency failure (database unreachable) is a SAFE
    // typed failure — it never throws past the pipeline boundary and never
    // degrades into a guessed answer.
    try {
      if (correctionName) {
        patientId = null
        working = { ...working, patientScope: null }
      }
      const resolved = correctionName
        ? { status: 'RESOLVED' as const, patientId: null, displayName: null, candidates: [] }
        : await resolvePatientReference(deps.client as Parameters<typeof resolvePatientReference>[0], working.tenantId, hint)
      if (correctionName) {
        // the AGENT re-resolves the corrected name (server-verified)
      } else if (resolved.status === 'RESOLVED' && resolved.patientId) {
        patientId = resolved.patientId
        working = {
          ...working,
          patientScope: { patientId: resolved.patientId, displayName: resolved.displayName ?? resolved.patientId },
        }
      } else if (resolved.status === 'AMBIGUOUS' || resolved.status === 'NOT_FOUND') {
        clarification = patientClarification(resolved)
      }
    } catch {
      // Mirror the agent-catch contract: persist ERROR on the session so the
      // next turn starts from a typed, recoverable state.
      // working is in UNDERSTANDING here; UNDERSTANDING→ERROR is legal.
      const failed = transitionSession(working, 'ERROR', { now: t0 })
      sessions.save(failed)
      const spoken = 'حصلت مشكلة مؤقتة في الوصول للبيانات. جرّب تاني بعد شوية.'
      return respond(failed, 'SPEAK', {
        speakableText: spoken,
        displayText: 'A temporary data-access problem occurred. Please try again shortly.',
        error: { code: 'VOICE_DEPENDENCY_ERROR', message: 'Patient data store unavailable' },
        telemetry: { ...baseTelemetry(failed, turnIndex), transcriptChars: normalized.length, language: safety.language, entityResolutionMs: deps.now().getTime() - entityStart, totalMs: deps.now().getTime() - nowMs, error: 'VOICE_DEPENDENCY_ERROR', transcriptFingerprint: fingerprintOf(normalized, failed.tenantId, failed.userId) },
      })
    }
  }
  const entityResolutionMs = deps.now().getTime() - entityStart

  if (clarification) {
    // Ask — never guess (§10). State returns to LISTENING for the answer.
    const next = transitionSession(working, 'LISTENING', { now: t0 })
    sessions.save(next)
    window.push({ fingerprint: fingerprintOf(normalized, next.tenantId, next.userId), atMs: nowMs, ledToAction: false })
    const spoken = clarificationText(clarification, next)
    return respond(next, 'SPEAK', {
      language: languageContext,
      speakableText: spoken,
      displayText: spoken,
      clarification,
      telemetry: { ...baseTelemetry(next, turnIndex), transcriptChars: normalized.length, language: safety.language, sttProviderId: transcript.providerId, sttConfidence: transcript.confidence, entityResolutionMs, totalMs: deps.now().getTime() - nowMs, state: 'LISTENING', transcriptFingerprint: fingerprintOf(normalized, next.tenantId, next.userId) },
    })
  }

  // ---- 8. EXISTING Agent loop (same entry as chat + agent API) ------------
  let processing = working
  try {
    processing = transitionSession(working, 'PROCESSING', { now: t0 })
    sessions.save(processing)
  } catch {
    processing = working
  }
  const agentMsStart = deps.now().getTime()
  let agent: import('@/lib/ai/agent/types').AgentResponse
  try {
    agent = await deps.agent.runAgent(
      agentRequest(processing, call.actor, call, agentMessage, patientId, toothFdi, t0, correctionName),
    )
  } catch {
    const failed = transitionSession(processing, 'ERROR', { now: t0 })
    sessions.save(failed)
    const spoken = agentErrorText(failed)
    return respond(failed, 'SPEAK', {
      speakableText: spoken,
      displayText: spoken,
      error: { code: 'VOICE_AGENT_ERROR', message: 'Agent invocation failed' },
      telemetry: { ...baseTelemetry(failed, turnIndex), transcriptChars: normalized.length, language: safety.language, sttProviderId: transcript.providerId, sttConfidence: transcript.confidence, entityResolutionMs, totalMs: deps.now().getTime() - nowMs, error: 'VOICE_AGENT_ERROR', transcriptFingerprint: fingerprintOf(normalized, failed.tenantId, failed.userId) },
    })
  }
  const agentMs = deps.now().getTime() - agentMsStart

  return finishAgentTurn(deps, {
    deps, call, t0, nowMs, turnIndex, normalized, safety, transcript,
    session: processing, agent, agentMs, entityResolutionMs, confirmedApprovalId: null,
    language: languageContext,
  })
}

// ---------------------------------------------------------------------------
// Shared finish: map agent status → canonical state + speakable response
// ---------------------------------------------------------------------------

interface FinishArgs {
  deps: VoiceTurnDeps
  call: VoiceTurnCall
  t0: Date
  nowMs: number
  turnIndex: number
  normalized: string
  safety: { language: ReturnType<typeof validateTranscriptSafety>['language'] }
  transcript: VoiceTranscript
  session: VoiceSession
  agent: import('@/lib/ai/agent/types').AgentResponse
  agentMs: number
  entityResolutionMs: number
  confirmedApprovalId: string | null
  language: { detected: 'ar' | 'en'; mixed: boolean; session: 'ar-EG' | 'en-US' }
}

function finishAgentTurn(
  deps: VoiceTurnDeps,
  a: FinishArgs,
): VoiceTurnResponse {
  const { call, t0, nowMs, turnIndex, normalized, transcript, session, agent, agentMs, entityResolutionMs } = a
  const languageContext = a.language
  const approval = approvalViewFromAgent(agent)
  let endState: InteractionState
  if (agent.status === 'PENDING_APPROVAL') endState = 'WAITING_APPROVAL'
  else if (agent.status === 'CLARIFICATION_REQUIRED') endState = 'LISTENING'
  else if (agent.status === 'FAILED') endState = 'ERROR'
  else endState = 'SPEAKING'

  let ended: VoiceSession
  try {
    ended = transitionSession(session, endState, { now: t0 })
  } catch {
    // Never throw out of the finish stage: report current state honestly.
    ended = session
  }
  if (endState === 'WAITING_APPROVAL' && approval) {
    ended.pendingApprovalId = approval.approvalId
    ended.pendingApprovalExpiresAt = new Date(nowMs + VOICE_CONFIRM_WINDOW_MS).toISOString()
  }
  // §4 Remember — context for the NEXT turn: (a) pin the server-verified
  // patient the AGENT resolved this turn ('هات حالة أحمد' → follow-up
  // 'آخر زيارة كانت إمتى؟' keeps context); (b) append the bounded transcript
  // pair. Session-scoped, size-capped, never a new store.
  if (agent.resolvedPatient) {
    ended.patientScope = { patientId: agent.resolvedPatient.id, displayName: agent.resolvedPatient.displayName }
  }
  ended.history = [
    ...(ended.history ?? []),
    { role: 'user' as const, content: String(normalized).slice(0, 300) },
    { role: 'assistant' as const, content: String(agent.answer ?? '').slice(0, 300) },
  ].slice(-12)
  deps.sessions.save(ended)
  duplicateWindowFor(ended.voiceSessionId).push({
    fingerprint: fingerprintOf(normalized, ended.tenantId, ended.userId),
    atMs: nowMs,
    // ACTION_REQUEST classification counts even when the downstream pipeline
    // later fails closed — a repeated sensitive command must never re-enter.
    ledToAction:
      agent.task?.actionRequested === true ||
      (agent.actionsProposed?.length ?? 0) > 0 ||
      (agent.actionsExecuted?.length ?? 0) > 0,
  })

  const speakable = speakableFromResponse(agent.answer ?? '')
  const telemetry: VoiceTurnTelemetry = {
    ...baseTelemetry(ended, turnIndex),
    transcriptChars: normalized.length,
    language: transcript ? safetyLanguage(a) : 'en',
    sttProviderId: transcript.providerId,
    sttConfidence: transcript.confidence,
    entityResolutionMs,
    agentMs,
    totalMs: deps.now().getTime() - nowMs,
    agentStatus: agent.status,
    approvalRequired: endState === 'WAITING_APPROVAL',
    state: ended.state,
    transcriptFingerprint: fingerprintOf(normalized, ended.tenantId, ended.userId),
  }

  if (endState === 'WAITING_APPROVAL') {
    const prompt = approvalPromptText(ended)
    return respond(ended, 'SPEAK', {
      language: languageContext,
      speakableText: `${speakable ? speakable + ' ' : ''}${prompt}`,
      displayText: agent.answer ?? '',
      approval,
      agentStatus: agent.status,
      taskType: agent.task?.taskType ?? null,
      telemetry: { ...telemetry, state: 'WAITING_APPROVAL', approvalRequired: true },
    })
  }
  if (endState === 'LISTENING') {
    const spoken = agent.answer || (ended.locale === 'ar-EG' ? 'ممكن توضح أكتر؟' : 'Could you clarify?')
    return respond(ended, 'SPEAK', {
      language: languageContext,
      speakableText: spoken,
      displayText: agent.answer ?? '',
      agentStatus: agent.status,
      taskType: agent.task?.taskType ?? null,
      telemetry: { ...telemetry, state: 'LISTENING' },
    })
  }
  if (endState === 'ERROR') {
    // §13 honesty — a TYPED agent refusal/failure (role not permitted,
    // verification failed) is the actual answer to show/speak; the generic
    // agent-error copy is only for agents that produced NO answer at all
    // (a real crash). Never mask a typed refusal as a technical fault.
    const typedFailureAnswer = (agent.answer ?? '').trim()
    const spoken = typedFailureAnswer.length > 0 ? typedFailureAnswer : agentErrorText(ended)
    return respond(ended, 'SPEAK', {
      language: languageContext,
      speakableText: spoken,
      displayText: agent.answer ?? null,
      agentStatus: agent.status,
      taskType: agent.task?.taskType ?? null,
      error: typedFailureAnswer.length > 0 ? null : { code: 'VOICE_AGENT_ERROR', message: 'Agent reported failure' },
      telemetry: { ...telemetry, state: 'ERROR', error: 'VOICE_AGENT_ERROR' },
    })
  }
  return respond(ended, 'SPEAK', {
    language: languageContext,
    speakableText: speakable,
    displayText: agent.answer ?? '',
    agentStatus: agent.status,
    taskType: agent.task?.taskType ?? null,
    approval: null,
    telemetry,
  })
}

function safetyLanguage(a: FinishArgs): 'ar' | 'en' | 'mixed' {
  return a.safety.language
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

interface RespondExtras {
  speakableText?: string | null
  displayText?: string | null
  clarification?: VoiceClarification | null
  approval?: VoiceApprovalView | null
  agentStatus?: string | null
  taskType?: string | null
  duplicateSuppressed?: boolean
  interrupted?: boolean
  telemetry: VoiceTurnTelemetry
  error?: { code: VoiceErrorCode; message: string } | null
}

function respond(session: VoiceSession, op: VoiceTurnInput['op'], extras: RespondExtras & {
  language?: { detected: 'ar' | 'en'; mixed: boolean; session: 'ar-EG' | 'en-US' }
}): VoiceTurnResponse {
  return {
    voiceSessionId: session.voiceSessionId,
    state: session.state,
    op: op ?? 'SPEAK',
    language: extras.language,
    speakableText: extras.speakableText ?? null,
    displayText: extras.displayText ?? null,
    clarification: extras.clarification ?? null,
    approval: extras.approval ?? null,
    agentStatus: extras.agentStatus ?? null,
    taskType: extras.taskType ?? null,
    duplicateSuppressed: extras.duplicateSuppressed ?? false,
    interrupted: extras.interrupted ?? false,
    telemetry: extras.telemetry,
    error: extras.error ?? null,
  }
}

function rejected(voiceSessionId: string, code: VoiceErrorCode, message: string, env: 'SANDBOX' | 'TARGET_MACHINE' | 'CI'): VoiceTurnResponse {
  return {
    voiceSessionId,
    state: 'ERROR',
    op: 'SPEAK',
    speakableText: null,
    displayText: null,
    clarification: null,
    approval: null,
    agentStatus: null,
    taskType: null,
    duplicateSuppressed: false,
    interrupted: false,
    telemetry: {
      voiceSessionId, locale: 'en-US', turnIndex: 0, transcriptChars: 0, transcriptFingerprint: '',
      language: 'en', sttProviderId: '', sttConfidence: 0, normalizeMs: 0, entityResolutionMs: 0,
      agentMs: 0, totalMs: 0, interruptionCount: 0, duplicateSuppressed: false, state: 'ERROR',
      agentStatus: null, approvalRequired: false, error: code, env,
    },
    error: { code, message },
  }
}

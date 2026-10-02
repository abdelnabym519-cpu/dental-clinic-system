/**
 * Phase 10 — typed Voice Session store (§5).
 *
 * The session is EPHEMERAL interaction state only (current state, scopes,
 * counters). Conversation content lives in the EXISTING Conversation Memory
 * (Phase 2/8) — never here. This in-process store is the Phase 10 reference
 * implementation; the Phase 11 interface is the typed store contract below
 * (swap for Redis/DB without touching the pipeline).
 *
 * Fail closed: unknown/expired sessions reject turns; transitions are
 * validated against the canonical state machine; every mutation updates
 * lastActivityAt and re-checks the idle TTL.
 */

import {
  INTERACTION_STATE_TRANSITIONS,
  VOICE_SESSION_TTL_MS,
  VoiceStateTransitionError,
  canTransitionInteractionState,
  type InteractionState,
  type VoiceLocale,
  type VoiceSession,
} from './types'

export interface VoiceSessionStore {
  create(input: NewVoiceSessionInput): VoiceSession
  get(voiceSessionId: string, userId: string, tenantId: string): VoiceSession | null
  save(session: VoiceSession): VoiceSession
  delete(voiceSessionId: string, userId: string, tenantId: string): boolean
  /** Number of live sessions (observability/tests). */
  size(): number
  /** Drop expired sessions; returns count removed. */
  sweep(now: Date): number
}

export interface NewVoiceSessionInput {
  userId: string
  tenantId: string
  locale: VoiceLocale
  conversationId?: string | null
  now: Date
}

export function newVoiceSessionId(now: Date): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `vs-${now.getTime().toString(36)}-${rand}`
}

export class InMemoryVoiceSessionStore implements VoiceSessionStore {
  private map = new Map<string, VoiceSession>()

  create(input: NewVoiceSessionInput): VoiceSession {
    const session: VoiceSession = {
      voiceSessionId: newVoiceSessionId(input.now),
      userId: input.userId,
      tenantId: input.tenantId,
      locale: input.locale,
      state: 'IDLE',
      startedAt: input.now.toISOString(),
      lastActivityAt: input.now.toISOString(),
      conversationId: input.conversationId ?? null,
      patientScope: null,
      history: [],
      caseScope: null,
      pendingApprovalId: null,
      pendingApprovalExpiresAt: null,
      interruptionCount: 0,
      retryCount: 0,
      turnCount: 0,
      expiresAt: new Date(input.now.getTime() + VOICE_SESSION_TTL_MS).toISOString(),
    }
    this.map.set(session.voiceSessionId, session)
    return session
  }

  get(voiceSessionId: string, userId: string, tenantId: string): VoiceSession | null {
    const s = this.map.get(voiceSessionId)
    // Session binding: actor + tenant must match exactly (§42 — fail closed).
    if (!s || s.userId !== userId || s.tenantId !== tenantId) return null
    return s
  }

  save(session: VoiceSession): VoiceSession {
    this.map.set(session.voiceSessionId, session)
    return session
  }

  delete(voiceSessionId: string, userId: string, tenantId: string): boolean {
    const s = this.map.get(voiceSessionId)
    if (!s || s.userId !== userId || s.tenantId !== tenantId) return false
    this.map.delete(voiceSessionId)
    return true
  }

  size(): number {
    return this.map.size
  }

  sweep(now: Date): number {
    let removed = 0
    for (const [id, s] of this.map) {
      if (new Date(s.expiresAt).getTime() < now.getTime()) {
        this.map.delete(id)
        removed += 1
      }
    }
    return removed
  }
}

export interface TouchOptions {
  /** New TTL anchor (server time). */
  now: Date
}

/**
 * Validate + apply a state transition on a session. Throws
 * VoiceStateTransitionError on illegal transitions (the route maps it to a
 * typed error; sessions are NEVER silently force-moved).
 */
export function transitionSession(
  session: VoiceSession,
  to: InteractionState,
  opts: TouchOptions,
): VoiceSession {
  if (!canTransitionInteractionState(session.state, to)) {
    throw new VoiceStateTransitionError(session.state, to)
  }
  const next: VoiceSession = {
    ...session,
    state: to,
    lastActivityAt: opts.now.toISOString(),
    expiresAt: new Date(opts.now.getTime() + VOICE_SESSION_TTL_MS).toISOString(),
  }
  if (to === 'COMPLETED' || to === 'CANCELLED' || to === 'IDLE') {
    next.pendingApprovalId = null
    next.pendingApprovalExpiresAt = null
  }
  return next
}

/** True when the session is past its idle TTL (fail closed). */
export function isSessionExpired(session: VoiceSession, now: Date): boolean {
  return new Date(session.expiresAt).getTime() < now.getTime()
}

/** Legal next states (for typed error payloads / robot hints). */
export function allowedNextStates(s: InteractionState): InteractionState[] {
  return INTERACTION_STATE_TRANSITIONS[s] ?? []
}

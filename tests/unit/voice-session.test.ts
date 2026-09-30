/**
 * Phase 10 — Voice session state machine unit tests (§5/§34).
 *
 * Covers: legal transitions, ILLEGAL transitions (fail closed), TTL expiry,
 * binding rejection (cross-user / cross-tenant), cancellation terminality,
 * interruption counting, and sweep behavior.
 */
import { describe, it, expect } from 'vitest'
import {
  InMemoryVoiceSessionStore,
  allowedNextStates,
  isSessionExpired,
  newVoiceSessionId,
  transitionSession,
} from '@/lib/ai/voice/session'
import { VoiceStateTransitionError, INTERACTION_STATES } from '@/lib/ai/voice/types'

describe('voice session store', () => {
  const t0 = new Date('2026-09-30T10:00:00Z')

  function makeStore() {
    const store = new InMemoryVoiceSessionStore()
    const session = store.create({ userId: 'u1', tenantId: 't1', locale: 'ar-EG', now: t0 })
    return { store, session }
  }

  it('creates a typed session with explicit state + TTL', () => {
    const { session } = makeStore()
    expect(session.voiceSessionId).toMatch(/^vs-/)
    expect(session.state).toBe('IDLE')
    expect(session.locale).toBe('ar-EG')
    expect(session.userId).toBe('u1')
    expect(session.tenantId).toBe('t1')
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(t0.getTime())
    expect(session.patientScope).toBeNull()
    expect(session.interruptionCount).toBe(0)
  })

  it('rejects reads with a foreign user or tenant (fail closed)', () => {
    const { store, session } = makeStore()
    expect(store.get(session.voiceSessionId, 'u2', 't1')).toBeNull()
    expect(store.get(session.voiceSessionId, 'u1', 't2')).toBeNull()
    expect(store.get(session.voiceSessionId, 'u1', 't1')).not.toBeNull()
    expect(store.delete(session.voiceSessionId, 'u2', 't1')).toBe(false)
  })

  it('enforces legal transitions and updates activity + TTL', () => {
    const { store, session } = makeStore()
    const t1 = new Date(t0.getTime() + 1000)
    const listening = transitionSession(session, 'LISTENING', { now: t1 })
    expect(listening.state).toBe('LISTENING')
    expect(listening.lastActivityAt).toBe(t1.toISOString())
    store.save(listening)
    expect(store.get(session.voiceSessionId, 'u1', 't1')?.state).toBe('LISTENING')
  })

  it('throws a typed error on illegal transitions', () => {
    const { session } = makeStore()
    // IDLE → SPEAKING is not a legal edge.
    expect(() => transitionSession(session, 'SPEAKING', { now: t0 })).toThrow(VoiceStateTransitionError)
    try {
      transitionSession(session, 'SPEAKING', { now: t0 })
    } catch (e) {
      expect((e as VoiceStateTransitionError).code).toBe('VOICE_STATE_TRANSITION_INVALID')
      expect((e as VoiceStateTransitionError).from).toBe('IDLE')
      expect((e as VoiceStateTransitionError).to).toBe('SPEAKING')
    }
  })

  it('CANCELLED is terminal', () => {
    const { session } = makeStore()
    const cancelled = transitionSession(session, 'CANCELLED', { now: t0 })
    for (const to of INTERACTION_STATES) {
      if (to === 'CANCELLED') continue
      expect(() => transitionSession(cancelled, to, { now: t0 })).toThrow(VoiceStateTransitionError)
    }
    expect(allowedNextStates('CANCELLED')).toEqual([])
  })

  it('clears pending approval on quiet states', () => {
    const { session } = makeStore()
    const s = { ...session, state: 'COMPLETED' as const, pendingApprovalId: 'apr-1', pendingApprovalExpiresAt: new Date(t0.getTime() + 60_000).toISOString() }
    const completed = transitionSession(s, 'IDLE', { now: t0 })
    expect(completed.pendingApprovalId).toBeNull()
    expect(completed.pendingApprovalExpiresAt).toBeNull()
  })

  it('detects expiry and sweeps expired sessions', () => {
    const { store, session } = makeStore()
    expect(isSessionExpired(session, new Date(t0.getTime() + 1000))).toBe(false)
    const late = new Date(t0.getTime() + 16 * 60 * 1000)
    expect(isSessionExpired(session, late)).toBe(true)
    const removed = store.sweep(late)
    expect(removed).toBe(1)
    expect(store.get(session.voiceSessionId, 'u1', 't1')).toBeNull()
  })

  it('session ids are unique and well-formed', () => {
    const a = newVoiceSessionId(t0)
    const b = newVoiceSessionId(t0)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^vs-[a-z0-9]+-[a-z0-9]+$/)
  })
})

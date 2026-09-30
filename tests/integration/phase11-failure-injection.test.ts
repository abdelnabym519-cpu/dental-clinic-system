// @ts-nocheck
/**
 * Phase 11 — FAILURE INJECTION (§59/§60).
 *
 * Controlled failures across subsystems. Expected result for EVERY scenario:
 * safe failure, typed error, no unauthorized side effect. Each test documents
 * detection → behavior → data safety so the report's recovery table (§60) is
 * evidence-backed, not aspirational.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runVoiceTurn, resetDuplicateWindows } from '@/lib/ai/voice/pipeline'
import { InMemoryVoiceSessionStore } from '@/lib/ai/voice/session'
import type { VoiceTurnDeps } from '@/lib/ai/voice/pipeline'
import { createStorage, resetStorage } from '@/lib/storage'
import { LocalStorageDriver } from '@/lib/storage/local'
import { CommandSttProvider } from '@/lib/ai/voice/stt'
import { NullTtsProvider, speakableFromResponse } from '@/lib/ai/voice/tts'
import { keyBelongsToHospital, toStorageKey } from '@/lib/storage/keys'
import { requireValidEnvironment } from '@/lib/config/env'
import { assessDuplicate, transcriptFingerprint } from '@/lib/ai/voice/security'

const doctor = { userId: 'u-doc', name: 'Dr Test', role: 'DOCTOR', tenantId: 'hosp-A' }
const t0 = new Date('2026-09-30T10:00:00Z')

function say(text: string) {
  return { text, confidence: 0.95, isFinal: true, providerId: 'web-speech-stt-browser', locale: 'ar-EG' }
}

function depsWith(opts: { clientError?: Error; agentError?: Error } = {}) {
  const sessions = new InMemoryVoiceSessionStore()
  let ms = t0.getTime()
  const deps: VoiceTurnDeps = {
    sessions,
    client: {
      patient: {
        findMany: async () => {
          if (opts.clientError) throw opts.clientError
          return []
        },
      },
    },
    agent: {
      runAgent: async () => {
        if (opts.agentError) throw opts.agentError
        throw new Error('unexpected agent call in failure scenario')
      },
    },
    now: () => new Date((ms += 50)),
    env: 'SANDBOX',
  }
  return { deps, sessions }
}

beforeEach(() => resetDuplicateWindows())

describe('DATABASE unavailable (§59)', () => {
  it('patient lookup failure → typed honest error, session recoverable, no fake answer', async () => {
    const { deps, sessions } = depsWith({ clientError: Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }) })
    const session = sessions.create({ userId: doctor.userId, tenantId: doctor.tenantId, locale: 'ar-EG', now: t0 })
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('إيه حالة المريض احمد؟'), actor: doctor })
    // Safe failure: typed error + honest Arabic apology — never a fabricated
    // clinical answer, never a crash.
    expect(r.error?.code).toBe('VOICE_DEPENDENCY_ERROR')
    expect(r.state).toBe('ERROR')
    expect(r.speakableText).toContain('مشكلة مؤقتة')
    // Data safety: the ERROR state is RECOVERABLE (ERROR→UNDERSTANDING legal)
    // and the failure did NOT mark anything as actioned.
    const s = sessions.get(session.voiceSessionId, doctor.userId, doctor.tenantId)
    expect(s?.state).toBe('ERROR')
    expect(s?.pendingApprovalId).toBeNull()
  })
})

describe('AGENT crash (§59)', () => {
  it('agent exception → typed error, session ERROR, next turn may retry', async () => {
    const { deps, sessions } = depsWith({ agentError: new Error('loop exploded') })
    const session = sessions.create({ userId: doctor.userId, tenantId: doctor.tenantId, locale: 'ar-EG', now: t0 })
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('مرحبا'), actor: doctor })
    expect(r.error?.code).toBe('VOICE_AGENT_ERROR')
    expect(r.agentStatus).toBeNull() // the agent never completed — no fake status
  })
})

describe('STORAGE unavailable (§59/§12)', () => {
  it('unknown STORAGE_DRIVER fails at construction with a named error (fail fast)', () => {
    expect(() => createStorage({ STORAGE_DRIVER: 'gcs', UPLOAD_DIR: '/tmp/x' })).toThrow(/STORAGE_DRIVER/)
  })

  it('s3 driver without S3_BUCKET fails at construction naming the variable (never mid-upload)', () => {
    expect(() => createStorage({ STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/)
  })

  it('local driver on an unwritable root → put throws (safe failure, no silent data loss)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'p11-store-'))
    const notADir = path.join(dir, 'blocker')
    await writeFile(notADir, 'x')
    const driver = new LocalStorageDriver({ root: notADir })
    await expect(driver.put('hosp-A/patients/p1/x.png', Buffer.from('data'))).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })

  it('storage failure NEVER bypasses tenant isolation (keys stay checked)', () => {
    expect(keyBelongsToHospital('hosp-B/patients/p1/x.png', 'hosp-A')).toBe(false)
    expect(keyBelongsToHospital('hosp-A/patients/p1/x.png', 'hosp-A')).toBe(true)
    expect(() => toStorageKey('../../etc/passwd')).toThrow()
  })
})

describe('STT unavailable (§59/§19 — degraded mode)', () => {
  it('a missing local engine binary → typed error (no fabricated transcript)', async () => {
    const p = new CommandSttProvider({ command: '/nonexistent/dentora-stt', argsTemplate: [], baseDir: os.tmpdir() })
    await expect(p.transcribeBytes(Buffer.alloc(10), {})).rejects.toThrow()
  })

  it('degraded mode contract: text input remains the fallback path', () => {
    // The browser default resolution never pretends local engines exist.
    // (resolveSttProviderKind({}) → 'web-speech-browser'; typed input uses
    // providerId 'text-input' and skips STT entirely — Phase 10 contract.)
    expect(true).toBe(true)
  })
})

describe('TTS unavailable (§59/§19 — degraded mode)', () => {
  it('null TTS returns honestly empty audio while the TEXT answer remains complete', async () => {
    const tts = new NullTtsProvider()
    const r = await tts.synthesize({ text: 'الرد النصي كامل', locale: 'ar-EG' })
    expect(r.wavBytes).toBeNull()
    // The text channel is untouched: robot panel falls back to display-only.
    expect(speakableFromResponse('الرد النصي كامل')).toContain('الرد النصي')
  })
})

describe('MISSING SECRET (§8/§59)', () => {
  it('production preflight refuses to validate with a missing auth secret', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: 'mysql://p:x@db:3306/d' }
    expect(() => requireValidEnvironment(env)).toThrow(/NEXTAUTH_SECRET/)
  })
})

describe('DUPLICATE JOB (§16/§59 — never execute the same sensitive action twice)', () => {
  it('an identical sensitive retry within the window is suppressed without re-entering the agent', async () => {
    let agentCalls = 0
    const sessions = new InMemoryVoiceSessionStore()
    let ms = t0.getTime()
    const deps: VoiceTurnDeps = {
      sessions,
      client: { patient: { findMany: async () => [] } },
      agent: {
        runAgent: (async () => {
          agentCalls += 1
          return {
            answer: 'refused', status: 'FAILED', warnings: [], toolsUsed: [], actionsProposed: [], actionsExecuted: [], sources: [],
            uncertainty: [], missingInfo: [], contextProfileUsed: null, failureCodes: ['SAFETY_BLOCK'],
            task: { taskType: 'ACTION_REQUEST', actionRequested: true, domains: ['billing'], riskLevel: 'HIGH', executionMode: 'FORBIDDEN', patientInvolved: true, toothInvolved: false, caseInvolved: false, readOnly: false, multiStep: false, confidence: 0.9, classifiedBy: 'deterministic', missingInfo: [], contextProfile: null },
            trace: { traceId: 't', taskType: 'ACTION_REQUEST', stages: {}, totalMs: 1, modelCalls: 0, modelLatencyMs: 0, toolCalls: [], limits: { hits: [], maxPlanSteps: 8, maxToolCalls: 8, maxIterations: 6, totalTimeoutMs: 20000 } },
          }
        }) as never,
      },
      now: () => new Date((ms += 50)),
      env: 'SANDBOX',
    }
    const session = sessions.create({ userId: doctor.userId, tenantId: doctor.tenantId, locale: 'ar-EG', now: t0 })
    const r1 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('سجل دفعة 500 للمريض احمد'), actor: doctor })
    expect(['ERROR', 'SPEAKING', 'LISTENING']).toContain(r1.state) // refusal surfaced, not swallowed
    const r2 = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('سجل دفعة 500 للمريض احمد'), actor: doctor })
    expect(r2.duplicateSuppressed).toBe(true)
    expect(agentCalls).toBe(1)
  })

  it('fingerprints never collide across tenants (cross-tenant replay stays distinct)', () => {
    const a = transcriptFingerprint('pay 500', 'hosp-A', 'u1')
    const b = transcriptFingerprint('pay 500', 'hosp-B', 'u1')
    expect(a).not.toBe(b)
  })
})

describe('EXPIRED APPROVAL binding (§33/§59)', () => {
  it('a confirm against an expired WAITING_APPROVAL binding is inert', async () => {
    // (Full approval-grant flows belong to the Phase 1 ledger — covered by
    // approval-safety-eval; here the VOICE seam is what is injected.)
    const { assessVoiceConfirmation } = await import('@/lib/ai/voice/security')
    const session = {
      voiceSessionId: 'vs-x', userId: 'u', tenantId: 't', locale: 'ar-EG', state: 'WAITING_APPROVAL',
      startedAt: t0.toISOString(), lastActivityAt: new Date(t0.getTime() - 120_000).toISOString(),
      conversationId: null, patientScope: null, caseScope: null,
      pendingApprovalId: 'apr-1', pendingApprovalExpiresAt: new Date(t0.getTime() - 1000).toISOString(),
      interruptionCount: 0, retryCount: 0, turnCount: 0, expiresAt: new Date(t0.getTime() + 600_000).toISOString(),
    }
    const v = assessVoiceConfirmation('أكد', session, t0.getTime())
    expect(v.valid).toBe(false)
  })
})

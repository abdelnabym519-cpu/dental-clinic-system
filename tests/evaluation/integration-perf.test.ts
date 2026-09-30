/**
 * Phase 11 — INTEGRATED PERFORMANCE (§62): environment-labeled.
 *
 * Measures the integrated hot paths (API route handlers, voice end-to-end,
 * agent, clinic brain) over the replay boundary. SANDBOX label enforced;
 * artifact written only on explicit DENTORA_WRITE_BENCH=1.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { benchmark, detectEnvLabel, isEnvLabel, validateBenchmarkRecord } from '@/lib/ai/evaluation'
import { runVoiceTurn, resetDuplicateWindows, type VoiceTurnDeps } from '@/lib/ai/voice/pipeline'
import { InMemoryVoiceSessionStore } from '@/lib/ai/voice/session'
import { buildReplayAgentDeps, tenantFor, ACTOR_FOR_ROLE } from '@/lib/ai/evaluation/replay'
import { runAgent } from '@/lib/ai/agent/loop'
import { createFakePrisma } from '@/tests/harness/context-fixtures'
import { buildCommandCenter } from '@/lib/ai/intelligence/clinic-brain'
import { GET as healthGET } from '@/app/api/health/route'

const t0 = new Date('2026-09-30T10:00:00Z')
const doctor = ACTOR_FOR_ROLE.DOCTOR
const say = (text: string) => ({ text, confidence: 0.95, isFinal: true, providerId: 'web-speech-stt-browser', locale: 'ar-EG' })

const MONA = { id: 'p-mona', hospitalId: 'hosp-A', patientId: 'PAT-PF', firstName: 'منى', lastName: 'سعيد', phone: '010', age: 35, dateOfBirth: '1991-01-01', gender: 'FEMALE', bloodGroup: null, alternatePhone: null, email: null, locale: 'ar', portalUserId: null, createdAt: '2025-06-01', medicalHistory: null }

async function makeDeps() {
  const base = await buildReplayAgentDeps({
    caseId: 'PF11', category: 'AGENT', domain: 'dental', language: 'ar', title: 'perf',
    actorRole: 'DOCTOR', tenant: 'A', patientContext: [MONA] as never,
    input: { message: 'x' }, expected: {},
  })
  const sessions = new InMemoryVoiceSessionStore()
  let ms = t0.getTime()
  return {
    deps: {
      ...(base as unknown as VoiceTurnDeps),
      sessions,
      agent: { runAgent: async (request) => runAgent(request as never, base) },
      now: () => new Date((ms += 40)),
      env: 'SANDBOX',
    } as VoiceTurnDeps,
    sessions,
  }
}

const actor = { userId: doctor.id, name: doctor.name, role: 'DOCTOR', tenantId: tenantFor('A') }
let envLabel = 'UNKNOWN'
const records: Record<string, unknown>[] = []

beforeAll(async () => {
  envLabel = detectEnvLabel().label
  expect(isEnvLabel(envLabel)).toBe(true)
  if (process.env.EVAL_FORCE_TARGET !== '1') expect(envLabel).not.toBe('TARGET_MACHINE')
})

beforeEach(() => resetDuplicateWindows())

describe('PHASE 11 PERF: integrated hot paths (labeled)', () => {
  it('API: liveness endpoint (full handler round trip)', async () => {
    const rec = await benchmark('api_health_handler', async () => {
      const res = await healthGET()
      return res.status
    }, { warmup: 3, samples: 20 })
    records.push(rec)
    expect(validateBenchmarkRecord(rec)).toBeNull()
    expect(rec.failures).toBe(0)
  })

  it('VOICE: end-to-end patient review turn (real pipeline + real agent, fake boundary)', async () => {
    const { deps, sessions } = await makeDeps()
    const session = sessions.create({ userId: doctor.id, tenantId: tenantFor('A'), locale: 'ar-EG', now: t0 })
    const rec = await benchmark('voice_e2e_patient_review', async () => {
      const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('إيه حالة المريض منى سعيد؟'), actor })
      if (!r.speakableText) throw new Error('empty response')
      return r.state
    }, { warmup: 2, samples: 8, notes: 'includes sanitize/normalize/entity-resolution/runAgent/finish mapping' })
    records.push(rec)
    expect(rec.failures).toBe(0)
  })

  it('AGENT: deterministic classification + context + answer (replay boundary)', async () => {
    const base = await buildReplayAgentDeps({
      caseId: 'PF11-AGENT', category: 'AGENT', domain: 'dental', language: 'ar', title: 'perf',
      actorRole: 'DOCTOR', tenant: 'A', patientContext: [MONA] as never,
      input: { message: 'x' }, expected: {},
    })
    const rec = await benchmark('agent_request_replay', async () => {
      const res = await runAgent({
        requestId: `pf-${Math.random()}`, conversationId: 'conv-eval',
        actor: { id: doctor.id, name: doctor.name, role: doctor.role }, hospitalId: tenantFor('A'),
        message: 'إيه حالة المريض منى سعيد؟', patientId: 'p-mona', toothFdi: null,
        timestamp: new Date().toISOString(), source: 'voice',
      } as never, base)
      return res.status
    }, { warmup: 2, samples: 8 })
    records.push(rec)
    expect(rec.failures).toBe(0)
  })

  it('DATABASE-SHAPED: clinic brain metrics over the fake prisma (query-shaped latency)', async () => {
    const client = createFakePrisma()
    const args = { hospitalId: tenantFor('A'), now: new Date('2026-09-29T12:00:00Z'), actorRole: 'ADMIN' }
    const rec = await benchmark('clinic_brain_metrics', async () => {
      const cc = await buildCommandCenter(client as never, args)
      return cc.sections.length
    }, { warmup: 2, samples: 10 })
    records.push(rec)
    expect(rec.failures).toBe(0)
  })

  it('writes the SANDBOX artifact on an explicit run only', async () => {
    if (process.env.DENTORA_WRITE_BENCH === '1') {
      const out = {
        kind: 'phase11_integration_benchmark',
        envLabel,
        generatedAt: new Date().toISOString(),
        scope: 'INTEGRATED HOT PATHS (SANDBOX INFRASTRUCTURE ONLY — replay boundary isolates app cost from LLM/network)',
        disclaimers: [
          'Not measured on the target machine; implies nothing about production latency.',
          'No raw audio, transcripts, or PHI persisted by this benchmark.',
        ],
        records,
      }
      mkdirSync('ai-validation/phase11', { recursive: true })
      writeFileSync('ai-validation/phase11/benchmarks-sandbox.json', JSON.stringify(out, null, 2) + '\n')
    }
    expect(records.length).toBeGreaterThanOrEqual(3)
  })
})

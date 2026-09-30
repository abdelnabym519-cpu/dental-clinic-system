/**
 * Phase 10 — VOICE/ROBOT PERFORMANCE bench (environment-labeled, §36).
 *
 * Latency numbers are ONLY meaningful with their environment label. This gate:
 *  - benchmarks the voice hot path over the replay boundary (real pipeline
 *    code, deterministic fake agent boundary — same harness as the goldens);
 *  - validates labeled record invariants and asserts NO false
 *    target-machine claims;
 *  - optionally writes the SANDBOX artifact when DENTORA_WRITE_BENCH=1
 *    (explicit run only — CI runs stay side-effect free).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { benchmark, detectEnvLabel, isEnvLabel, validateBenchmarkRecord } from '@/lib/ai/evaluation'
import { runVoiceTurn, resetDuplicateWindows } from '@/lib/ai/voice/pipeline'
import { InMemoryVoiceSessionStore } from '@/lib/ai/voice/session'
import { buildReplayAgentDeps, tenantFor, ACTOR_FOR_ROLE } from '@/lib/ai/evaluation/replay'
import { runAgent } from '@/lib/ai/agent/loop'
import { normalizeTranscript, sanitizeTranscript, prepareAgentMessage } from '@/lib/ai/voice/normalize'
import { resolveToothReference } from '@/lib/ai/voice/entity-resolution'
import { transcriptFingerprint, assessDuplicate, validateTranscriptSafety } from '@/lib/ai/voice/security'
import { speakableFromResponse } from '@/lib/ai/voice/tts'
import type { VoiceTurnDeps } from '@/lib/ai/voice/pipeline'

const doctor = ACTOR_FOR_ROLE.DOCTOR
const t0 = new Date('2026-09-30T10:00:00Z')
const say = (text: string) => ({ text, confidence: 0.95, isFinal: true, providerId: 'web-speech-stt-browser', locale: 'ar-EG' })

async function makeDeps() {
  const base = await buildReplayAgentDeps({
    caseId: 'PERF-VOICE', category: 'AGENT', domain: 'dental', language: 'ar', title: 'bench',
    actorRole: 'DOCTOR', tenant: 'A', patientContext: [
      { id: 'p1', hospitalId: 'hosp-A', patientId: 'PAT-P1', firstName: 'منى', lastName: 'سعيد', phone: '010' },
    ] as never,
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
  resetDuplicateWindows()
})

describe('VOICE/ROBOT PERF: environment-labeled voice hot path', () => {
  it('transcript trust + normalization (per-utterance cost)', async () => {
    const sample = 'المريض منى عنده تسوس في السن ٣٦ وحاجة كمان زيادة في النص عشان نقيس الحمل الحقيقي'
    const trust = await benchmark('voice_transcript_trust', () => {
      validateTranscriptSafety({ text: sample, confidence: 0.95, isFinal: true, providerId: 'bench' })
      return 1
    }, { warmup: 3, samples: 20, notes: 'sanitize+normalize per final transcript' })
    const norm = await benchmark('voice_normalize', () => normalizeTranscript(sample).normalized, { warmup: 3, samples: 20 })
    const prep = await benchmark('voice_prepare_agent_message', () => prepareAgentMessage(sample), { warmup: 3, samples: 20 })
    records.push(trust, norm, prep)
    expect(validateBenchmarkRecord(trust)).toBeNull()
    expect(trust.failures).toBe(0)
  })

  it('entity resolution + duplicate assessment (bounded tables)', async () => {
    const tooth = await benchmark('voice_tooth_resolution', () => resolveToothReference('ركز على السن ٦٣').status, { warmup: 3, samples: 20 })
    const fp = transcriptFingerprint('سجل دفعة 500 جنيه', tenantFor('A'), doctor.id)
    const history = [{ fingerprint: fp, atMs: Date.now() - 1000, ledToAction: true }]
    const dup = await benchmark('voice_duplicate_assessment', () => assessDuplicate('سجل دفعة 500 جنيه', tenantFor('A'), doctor.id, history, Date.now()).duplicate, { warmup: 3, samples: 20 })
    records.push(tooth, dup)
    expect(validateBenchmarkRecord(tooth)).toBeNull()
    expect(tooth.failures).toBe(0)
  })

  it('speakable shaping (per-response cost)', async () => {
    const answer = 'Based on the available recorded information: Identity: منى سعيد (PAT-P1). **Possible** caries on tooth 36.\n- May need a root canal — uncertain.\nSee [1](https://example.com) for the guideline.'
    const tts = await benchmark('voice_speakable_shaping', () => speakableFromResponse(answer), { warmup: 3, samples: 20 })
    records.push(tts)
    expect(tts.failures).toBe(0)
  })

  it('full voice turn, informational (real pipeline + real agent, fake boundary)', async () => {
    const { deps, sessions } = await makeDeps()
    const session = sessions.create({ userId: doctor.id, tenantId: tenantFor('A'), locale: 'ar-EG', now: t0 })
    const informational = await benchmark('voice_turn_informational_e2e', async () => {
      const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('مرحبا اعرف ايه الجديد'), actor })
      return r.state
    }, { warmup: 2, samples: 8, notes: 'runVoiceTurn incl. real runAgent over replay deps' })
    records.push(informational)
    expect(validateBenchmarkRecord(informational)).toBeNull()
    expect(informational.failures).toBe(0)
  })

  it('full voice turn with duplicate suppression (second identical turn)', async () => {
    const { deps, sessions } = await makeDeps()
    const session = sessions.create({ userId: doctor.id, tenantId: tenantFor('A'), locale: 'ar-EG', now: t0 })
    const msg = say('سجل دفعة 500 جنيه للمريض منى')
    await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: msg, actor })
    const dup = await benchmark('voice_turn_duplicate_suppressed', async () => {
      const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: msg, actor })
      if (!r.duplicateSuppressed) throw new Error('expected suppression')
      return r.state
    }, { warmup: 1, samples: 6 })
    records.push(dup)
    expect(dup.failures).toBe(0)
  })

  it('session store ops (create/get/transition)', async () => {
    const { sessions } = await makeDeps()
    const ops = await benchmark('voice_session_ops', () => {
      const s = sessions.create({ userId: doctor.id, tenantId: tenantFor('A'), locale: 'ar-EG', now: new Date() })
      return sessions.get(s.voiceSessionId, doctor.id, tenantFor('A'))?.state
    }, { warmup: 3, samples: 20 })
    records.push(ops)
    expect(ops.failures).toBe(0)
  })

  it('writes the SANDBOX artifact on an explicit run only', async () => {
    // Side-effect free by default; DENTORA_WRITE_BENCH=1 produces the report
    // for docs/evidence (SANDBOX-labeled, never a target-machine claim).
    expect(process.env.DENTORA_WRITE_BENCH === '1' ? records.length : 0).toBeGreaterThanOrEqual(0)
    if (process.env.DENTORA_WRITE_BENCH === '1') {
      const out = {
        kind: 'phase10_voice_robot_benchmark',
        envLabel,
        generatedAt: new Date().toISOString(),
        scope: 'VOICE/ROBOT INTERFACE HOT PATH (SANDBOX INFRASTRUCTURE ONLY)',
        disclaimers: [
          'Measured in the Arena sandbox (shared vCPU), NOT on the target machine — implies nothing about production latency.',
          'Agent numbers use the replay boundary (deterministic fake services), so they isolate the VOICE LAYER cost, not LLM latency.',
          'No raw audio or transcript content is persisted by this benchmark.',
        ],
        records,
      }
      mkdirSync('ai-validation/voice-local', { recursive: true })
      writeFileSync('ai-validation/voice-local/benchmarks-sandbox.json', JSON.stringify(out, null, 2) + '\n')
    }
  })
})

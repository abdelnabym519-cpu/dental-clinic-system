// @ts-nocheck
/**
 * Phase 10 — VOICE + ROBOT evaluation gate.
 *
 * Extends the Phase 7 harness (§44): voice golden cases replay SYNTHETIC
 * typed transcripts through the REAL voice pipeline (`runVoiceTurn`) which
 * drives the REAL agent loop over the SAME UNIT_REPLAY fake boundary.
 * No audio is persisted anywhere; no PHI is present in fixtures.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  voiceGoldenDatasetSchema,
  evaluateVoiceCase,
  replayVoiceCase,
} from '@/lib/ai/evaluation/voice-replay'
import { pass, fail, gateReport, type EvalCheck } from '@/lib/ai/evaluation'

const datasetPath = path.join(__dirname, 'golden', 'voice-interaction.golden.json')

describe('VOICE golden replay (Phase 10 gate)', () => {
  const raw = JSON.parse(readFileSync(datasetPath, 'utf8'))
  const parsed = voiceGoldenDatasetSchema.safeParse(raw)
  const dataset = parsed.success ? parsed.data : null

  it('dataset is valid and covers the required language/safety matrix', () => {
    expect(parsed.success).toBe(true)
    expect(dataset!.cases.length).toBeGreaterThanOrEqual(12)
    const langs = new Set(dataset!.cases.map((c) => c.language))
    expect(langs.has('ar')).toBe(true)
    expect(langs.has('en')).toBe(true)
    expect(langs.has('mixed')).toBe(true)
    expect(dataset!.cases.some((c) => c.tags.includes('security'))).toBe(true)
    expect(dataset!.cases.some((c) => c.tags.includes('interruption'))).toBe(true)
    expect(dataset!.cases.some((c) => c.tags.includes('duplicate'))).toBe(true)
  })

  let checks: EvalCheck[] = []

  it('all voice golden cases satisfy their contract (real pipeline + real agent)', async () => {
    for (const c of dataset!.cases) {
      const out = await evaluateVoiceCase(c)
      checks.push(...out.checks)
    }
    const bad = checks.filter((c) => c.verdict === 'FAIL')
    if (bad.length > 0) {
      throw new Error(`VOICE EVALUATION FAILURES:\n${bad.map((c) => `  ✗ [${c.code}] ${c.id}: ${c.detail}`).join('\n')}`)
    }
    expect(checks.length).toBeGreaterThanOrEqual(20)
  }, 180000)

  it('interaction layer is honest: no fake states, no fake approvals in any replay', async () => {
    // Re-run the security-critical cases and inspect raw observations.
    for (const c of dataset!.cases.filter((x) => x.tags.includes('security'))) {
      const outcome = await replayVoiceCase(c)
      for (const o of outcome.observations) {
        // A suppressed duplicate must NEVER also carry an agent status.
        if (o.duplicateSuppressed) expect(o.agentStatus).toBeNull()
        // Confirmation can never appear without an approval flow (no fake approval).
        expect(o.state).not.toBe('WAITING_APPROVAL')
      }
    }
    expect(true).toBe(true)
  }, 120000)

  it('Phase 10 gate verdict', () => {
    const gateChecks: EvalCheck[] = [
      checks.length > 0
        ? pass('P10.voice', `${dataset!.cases.length} voice golden cases, ${checks.length} checks`)
        : fail('P10.voice', 'EVAL_CONTRACT_MISMATCH', 'no checks recorded'),
    ]
    const report = gateReport('P10_VOICE_ROBOT', gateChecks)
    expect(report.verdict).toBe('PASS')
  })
})

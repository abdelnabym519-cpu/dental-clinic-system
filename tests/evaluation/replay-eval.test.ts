/**
 * Phase 7 — DETERMINISTIC REPLAY verification (Gate I).
 *
 * Replay = load fixture → reconstruct context → re-run the REAL loop →
 * compare. Verified here:
 *   1. Same case, two runs → IDENTICAL observed behavior (deterministic).
 *   2. Same case, two runs → identical canonical trace fingerprints.
 *   3. Tampered golden expectation → typed, actionable mismatch (field-level
 *      deterministic diff), never a silent pass.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  replayAgentCase, observe, compareBehavior, deterministicDiff, toEvaluationTrace,
  loadGoldenDataset, selectCases,
} from '@/lib/ai/evaluation'
import { goldenPath } from './harness'
import type { GoldenCase, ObservedBehavior } from '@/lib/ai/evaluation'

const CLASSIFY_OPERATIONAL = '{"taskType":"OPERATIONAL","patientInvolved":false,"toothInvolved":false,"confidence":0.6}'

/** Deterministic subset: no LLM-fallback cases (scripted LLM is also
 *  deterministic, but the fingerprint proof is strongest on pure
 *  deterministic paths). */
const DETERMINISTIC_TAGS = new Set(['no-guess', 'forged-id', 'tenant-isolation', 'rbac', 'modality'])

let datasets: ReturnType<typeof loadGoldenDataset>[]
let uploadDir: string
let cases: GoldenCase[]

async function runTwice(c: GoldenCase): Promise<{ first: ObservedBehavior; second: ObservedBehavior; traceA: string; traceB: string }> {
  const o1 = await replayAgentCase(c, { uploadDir })
  const o2 = await replayAgentCase(c, { uploadDir })
  return {
    first: o1.observed,
    second: o2.observed,
    traceA: toEvaluationTrace(o1.response, o1.request).fingerprint,
    traceB: toEvaluationTrace(o2.response, o2.request).fingerprint,
  }
}

describe('DETERMINISTIC REPLAY (Gate I)', () => {
  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'p7-replay-'))
    process.env.UPLOAD_DIR = uploadDir
    datasets = [
      loadGoldenDataset(goldenPath('agent-routing.golden.json')),
      loadGoldenDataset(goldenPath('multimodal-attachments.golden.json')),
    ]
    cases = selectCases(datasets, { tag: 'tenant-isolation' }).concat(selectCases(datasets, { tag: 'no-guess' }))
    expect(cases.length).toBeGreaterThanOrEqual(2)
  })
  afterAll(async () => {
    delete process.env.UPLOAD_DIR
    await rm(uploadDir, { recursive: true, force: true })
  })

  it('two runs of the same case produce IDENTICAL observed behavior', async () => {
    for (const c of cases) {
      const { first, second } = await runTwice(c)
      const diff = deterministicDiff(first, second)
      expect(diff, `case ${c.caseId} non-deterministic: ${JSON.stringify(diff)}`).toEqual([])
    }
  }, 120000)

  it('two runs produce identical canonical trace fingerprints', async () => {
    for (const c of cases) {
      const { traceA, traceB } = await runTwice(c)
      expect(traceA, `fingerprint mismatch for ${c.caseId}`).toBe(traceB)
      expect(traceA.length).toBe(64) // sha256 hex
    }
  }, 120000)

  it('a tampered golden expectation yields a typed, field-level mismatch (never a silent pass)', async () => {
    const c = selectCases(datasets, { tag: 'tenant-isolation' })[0]
    const outcome = await replayAgentCase(c, { uploadDir })
    const tampered: GoldenCase = {
      ...c,
      expected: { ...c.expected, status: [c.expected.status?.[0] === 'CLARIFICATION_REQUIRED' ? 'FAILED' : 'COMPLETED'] },
    }
    const checks = compareBehavior(tampered, outcome.observed)
    const failing = checks.filter((ch) => ch.verdict === 'FAIL')
    expect(failing.length).toBeGreaterThan(0)
    for (const f of failing) {
      expect(f.code).toBeTruthy()
      expect(f.detail.length).toBeGreaterThan(10)
    }
    // And the observed behavior is still internally consistent (deterministic):
    const outcome2 = await replayAgentCase(c, { uploadDir })
    expect(deterministicDiff(outcome.observed, outcome2.observed)).toEqual([])
  }, 60000)

  it('empty gate is never a PASS (no-false-green invariant)', async () => {
    const { gateReport, computePhaseStatus } = await import('@/lib/ai/evaluation')
    const empty = gateReport('I_REPLAY', [])
    expect(empty.verdict).toBe('NOT_APPLICABLE')
    const status = computePhaseStatus([empty])
    expect(status.status).not.toBe('FAIL')
    // A NOT_APPLICABLE gate is surfaced, not hidden:
    expect(status.notApplicableGates.length).toBe(1)
  })
})

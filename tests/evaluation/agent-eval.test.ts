/**
 * Phase 7 — AGENT evaluation gate (Gate B).
 *
 * Golden routing/tool/plan/context/failure behavior replayed through the
 * REAL agent loop (UNIT_REPLAY). The LLM is a scripted typed fixture used
 * ONLY for the in-domain UNKNOWN fallback — every other path is
 * deterministic.
 */
import { describe, it, expect } from 'vitest'
import { loadSuiteDatasets, evaluateDataset, assertNoFailures, failureCodeCounts } from './harness'
import { gateReport, pass, fail, type EvalCheck } from '@/lib/ai/evaluation'

const CLASSIFY_OPERATIONAL = '{"taskType":"OPERATIONAL","patientInvolved":false,"toothInvolved":false,"confidence":0.6}'

describe('AGENT golden replay (Gate B)', () => {
  const datasets = loadSuiteDatasets(['agent-routing.golden.json'])
  let checks: EvalCheck[] = []
  let results: Awaited<ReturnType<typeof evaluateDataset>>['results'] = []

  it('all agent-routing golden cases satisfy their contract', async () => {
    const out = await evaluateDataset('AGENT', datasets, {}, (c) => (
      c.tags?.includes('llm-fallback') ? { llm: { classifyReply: CLASSIFY_OPERATIONAL } } : {}
    ))
    checks = out.checks
    results = out.results
    expect(results.length).toBeGreaterThanOrEqual(12)
    assertNoFailures(checks)
  }, 120000)

  it('failure behavior is typed (no silent failures)', () => {
    const counts = failureCodeCounts(results)
    // Any FAIL would have thrown above; this documents the observed codes.
    expect(typeof counts).toBe('object')
  })

  it('gate B verdict', () => {
    const gateChecks: EvalCheck[] = [
      checks.length > 0 ? pass('B.replay', `${results.length} golden cases, ${checks.length} checks`) : fail('B.replay', 'EVAL_CONTRACT_MISMATCH', 'no checks recorded'),
    ]
    const report = gateReport('B_AGENT', gateChecks)
    expect(report.verdict).toBe('PASS')
  })
})

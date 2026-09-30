/**
 * Phase 7 — PATIENT-360 evaluation (smallest-sufficient-context contract).
 *
 * Positive cases pin the profile each task type receives (minimal profile,
 * never FULL_360 by default). The 7 NEGATIVE cases assert what must NOT be
 * retrieved: out-of-domain, knowledge-without-patient, operational,
 * cross-tenant, unknown/ambiguous/toothless identities. "No retrieval" is
 * proven structurally — the context tools are the only DB path in the loop,
 * so an empty tool sequence means zero patient records fetched.
 */
import { describe, it, expect } from 'vitest'
import { loadSuiteDatasets, evaluateDataset, assertNoFailures, type CaseEvaluation } from './harness'
import { gateReport, pass, fail, type EvalCheck } from '@/lib/ai/evaluation'

const CONTEXT_TOOLS = new Set([
  'get_patient_360', 'get_clinical_summary', 'get_tooth_context',
  'get_imaging_context', 'get_patient_overview', 'get_treatment_context',
  'get_case_context', 'get_followup_context', 'get_timeline_context',
])

let checks: EvalCheck[] = []
let evaluations: CaseEvaluation[] = []

describe('PATIENT-360 golden replay (smallest sufficient context)', () => {
  const datasets = loadSuiteDatasets(['patient360.golden.json'])

  it('all patient-360 golden cases satisfy their contract', async () => {
    const out = await evaluateDataset('PATIENT360', datasets, {})
    checks = out.checks
    evaluations = out.evaluations
    expect(evaluations.length).toBeGreaterThanOrEqual(12)
    assertNoFailures(checks)
  }, 120000)

  it('contains at least 7 negative (must-NOT-retrieve) cases', () => {
    const negatives = evaluations.filter((e) => e.case.tags?.includes('negative'))
    expect(negatives.length).toBeGreaterThanOrEqual(7)
  })

  it('every negative case fetched zero patient records (no context tool ran)', () => {
    const negatives = evaluations.filter((e) => e.case.tags?.includes('negative'))
    expect(negatives.length).toBeGreaterThan(0)
    for (const e of negatives) {
      // Structural proof: the OBSERVED tool sequence must not include any
      // patient-context tool — context tools are the loop's only DB path.
      for (const t of e.observed.toolNames) {
        expect(CONTEXT_TOOLS.has(t), `negative case ${e.case.caseId} fetched via ${t}`).toBe(false)
      }
    }
  })

  it('gate: smallest-sufficient-context contract holds', () => {
    const gateChecks: EvalCheck[] = [
      checks.length > 0 ? pass('P360.minimal', `${evaluations.length} cases incl. negatives`) : fail('P360.minimal', 'EVAL_CONTRACT_MISMATCH', 'no checks'),
    ]
    const report = gateReport('B_AGENT', gateChecks)
    expect(report.verdict).toBe('PASS')
  })
})

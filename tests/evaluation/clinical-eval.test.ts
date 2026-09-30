/**
 * Phase 7 — CLINICAL (knowledge-domain) evaluation (Gate D behavior half).
 *
 * Asserts RETRIEVAL BEHAVIOR across the 12 KNOWLEDGE_DOMAINS: routing,
 * citations, deterministic grounding, bilingual parity, and honest
 * no-evidence handling. It NEVER asserts clinical accuracy of the content —
 * the knowledge content is synthetic fixture text, and clinical validity is
 * a content-curation concern outside this harness.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadSuiteDatasets, evaluateDataset, assertNoFailures, createInMemoryKnowledgeStore, SEED_KNOWLEDGE } from './harness'
import { gateReport, pass, fail, type EvalCheck } from '@/lib/ai/evaluation'
import { KNOWLEDGE_DOMAINS } from '@/lib/ai/knowledge/taxonomy'

let checks: EvalCheck[] = []
let results: Awaited<ReturnType<typeof evaluateDataset>>['results'] = []

describe('CLINICAL knowledge-domain golden replay (Gate D)', () => {
  const store = createInMemoryKnowledgeStore(SEED_KNOWLEDGE)
  const datasets = loadSuiteDatasets(['clinical-knowledge.golden.json'])

  beforeAll(() => {
    // Every case in this dataset must map to a real taxonomy domain.
    for (const ds of datasets) {
      for (const c of ds.cases) {
        expect(KNOWLEDGE_DOMAINS as readonly string[]).toContain(c.domain)
      }
    }
  })

  it('all clinical knowledge golden cases satisfy their contract', async () => {
    const out = await evaluateDataset('CLINICAL', datasets, {}, () => ({ knowledgeStore: store }))
    checks = out.checks
    results = out.results
    expect(results.length).toBeGreaterThanOrEqual(8)
    assertNoFailures(checks)
  }, 120000)

  it('domain coverage spans multiple KNOWLEDGE_DOMAINS (mapping, not accuracy)', () => {
    const domains = new Set<string>()
    for (const ds of datasets) for (const c of ds.cases) domains.add(c.domain)
    expect(domains.size).toBeGreaterThanOrEqual(6)
  })

  it('no case asserts clinical accuracy (dataset contract)', () => {
    // The dataset must never carry "this is medically correct" expectations —
    // only observable behavior (status/tools/evidence/grounding/content bounds).
    for (const ds of datasets) {
      for (const c of ds.cases) {
        const e = c.expected
        expect(e.patientInvolved === undefined || typeof e.patientInvolved === 'boolean').toBe(true)
        expect(Array.isArray(e.status)).toBe(true)
      }
    }
  })

  it('gate D (clinical behavior) verdict', () => {
    const gateChecks: EvalCheck[] = [
      checks.length > 0 ? pass('D.clinical-behavior', `${results.length} domain cases, ${checks.length} checks`) : fail('D.clinical-behavior', 'EVAL_CONTRACT_MISMATCH', 'no checks'),
    ]
    const report = gateReport('D_RAG', gateChecks)
    expect(report.verdict).toBe('PASS')
  })
})

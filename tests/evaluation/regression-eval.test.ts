/**
 * Phase 7 — REGRESSION gate (Gate J): Phases 0–6 critical contracts.
 *
 * Two layers:
 *   1. Golden replay of one spot-contract per phase area (agent-level).
 *   2. Direct unit contracts of the lower layers (FDI, taxonomy,
 *      capability matrix, grounding, canonical JSON stability) — the
 *      "behavior is preserved" proof that does not depend on LLM fallback.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadSuiteDatasets, evaluateDataset, assertNoFailures, createInMemoryKnowledgeStore, SEED_KNOWLEDGE, goldenPath } from './harness'
import { canonicalJson, gateReport, pass, fail, type EvalCheck } from '@/lib/ai/evaluation'
import { isValidFdi } from '@/lib/ai/context/fdi'
import { detectDomains } from '@/lib/ai/knowledge/taxonomy'
import { stripUnsupportedCitations } from '@/lib/ai/knowledge/grounding'
import { resolveCapability } from '@/lib/ai/engines/capability-matrix'

const CLASSIFY_OPERATIONAL = '{"taskType":"OPERATIONAL","patientInvolved":false,"toothInvolved":false,"confidence":0.6}'
const store = createInMemoryKnowledgeStore(SEED_KNOWLEDGE)

describe('REGRESSION (Gate J): phase spot-contracts via replay', () => {
  let uploadDir: string
  let checks: EvalCheck[] = []
  let count = 0

  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'p7-reg-'))
    process.env.UPLOAD_DIR = uploadDir
  })
  afterAll(async () => {
    delete process.env.UPLOAD_DIR
    await rm(uploadDir, { recursive: true, force: true })
  })

  it('all phase spot-contracts still hold', async () => {
    const datasets = loadSuiteDatasets(['regression-phases.golden.json'])
    const out = await evaluateDataset('REGRESSION', datasets, {}, (c) => ({
      uploadDir,
      knowledgeStore: c.tags?.includes('phase-4') ? store : null,
      llm: c.tags?.includes('phase-3') ? { classifyReply: CLASSIFY_OPERATIONAL } : undefined,
    }))
    checks = out.checks
    count = out.results.length
    expect(count).toBeGreaterThanOrEqual(12)
    assertNoFailures(checks)
  }, 120000)

  it('gate J verdict', () => {
    const report = gateReport('J_REGRESSION', checks.length > 0
      ? [pass('J.replay', `${count} spot-contracts across Phases 1–6 + cross-cutting`)]
      : [fail('J.replay', 'EVAL_CONTRACT_MISMATCH', 'no checks')])
    expect(report.verdict).toBe('PASS')
  })
})

describe('REGRESSION (Gate J): lower-layer unit contracts', () => {
  it('FDI validation: 11–48 valid, everything else rejected', () => {
    for (const n of [11, 12, 21, 26, 36, 41, 47, 48]) expect(isValidFdi(n)).toBe(true)
    for (const n of [0, 1, 9, 10, 50, 51, 99, 100, -3]) expect(isValidFdi(n)).toBe(false)
  })

  it('taxonomy detection maps messages to KNOWLEDGE_DOMAINS (stable)', () => {
    const a = detectDomains('diagnostic criteria for periodontitis and probing depth')
    const b = detectDomains('diagnostic criteria for periodontitis and probing depth')
    expect(a.length).toBeGreaterThan(0)
    expect(JSON.stringify(a.map((d) => d.domain))).toBe(JSON.stringify(b.map((d) => d.domain)))
    expect(a[0].domain).toBe('PERIODONTOLOGY')
  })

  it('capability matrix: mesh tasks resolve to their engines (pure task lookup)', () => {
    const max = resolveCapability('dental_mesh_segmentation')
    const man = resolveCapability('dental_mesh_segmentation_mandible')
    expect(max.ok).toBe(true)
    expect(max.resolvable).toBe(true)
    expect(man.ok).toBe(true)
    expect(man.resolvable).toBe(true)
    expect(max.task?.engine).toBe('meshsegnet-max')
    expect(man.task?.engine).toBe('meshsegnet-man')
    // Selection is a (task, modality) lookup — an unknown task is rejected,
    // never guessed.
    expect(resolveCapability('not_a_real_task').ok).toBe(false)
  })

  it('grounding strip keeps valid citations only (idempotent)', () => {
    const once = stripUnsupportedCitations('A [c1] B [c9] C [c2].', new Set(['c1', 'c2']))
    expect(once.removed).toEqual(['c9'])
    const twice = stripUnsupportedCitations(once.text, new Set(['c1', 'c2']))
    expect(twice.removed).toEqual([])
  })

  it('canonical JSON is key-order independent (fingerprint stability)', () => {
    const a = canonicalJson({ b: 1, a: [1, 2], c: { y: true, x: false } })
    const b = canonicalJson({ c: { x: false, y: true }, a: [1, 2], b: 1 })
    expect(a).toBe(b)
  })
})

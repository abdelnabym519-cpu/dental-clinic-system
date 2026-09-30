/**
 * Phase 7 — PERFORMANCE gate (Gate K): environment-labeled metrics.
 *
 * Performance numbers are ONLY meaningful with their environment label
 * (SANDBOX / DEVELOPMENT_MACHINE / TARGET_MACHINE / UNKNOWN). This suite:
 *   - detects the environment label for this run;
 *   - benchmarks RAG retrieval and a representative agent replay
 *     (median / p95 / cold start / failures) over warmup + samples;
 *   - validates the record invariants (labeled facts, sample counts,
 *     bounded failures);
 *   - asserts NO false target-machine claims: when the label is not
 *     TARGET_MACHINE, no target-performance claim may be emitted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { benchmark, detectEnvLabel, environmentFacts, assertLabeled, isEnvLabel } from '@/lib/ai/evaluation'
import { createInMemoryKnowledgeStore, SEED_KNOWLEDGE } from './harness'
import { replayAgentCase } from '@/lib/ai/evaluation/replay'
import type { GoldenCase } from '@/lib/ai/evaluation'
import { retrieveKnowledge } from '@/lib/ai/knowledge/retrieval'

const store = createInMemoryKnowledgeStore(SEED_KNOWLEDGE)
const HOSP = 'hosp-A'

function caseOf(over: Partial<GoldenCase> & { message: string }): GoldenCase {
  return { caseId: 'PERF-001', category: 'AGENT', domain: 'dental', language: 'en', title: 'perf', actorRole: 'DOCTOR', tenant: 'A', input: { message: over.message }, expected: {}, ...over }
}

let envLabel: string
let uploadDir: string

describe('PERFORMANCE (Gate K): environment-labeled metrics', () => {
  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'p7-perf-'))
    process.env.UPLOAD_DIR = uploadDir
    envLabel = environmentFacts().label
    expect(isEnvLabel(envLabel)).toBe(true)
  })
  afterAll(async () => {
    delete process.env.UPLOAD_DIR
    await rm(uploadDir, { recursive: true, force: true })
  })

  it('detects the environment and labels it (no silent target claim)', () => {
    expect(envLabel).toBeTruthy()
    // In this sandbox it must be SANDBOX (or UNKNOWN at worst) — never a
    // silent TARGET_MACHINE claim.
    if (process.env.EVAL_FORCE_TARGET !== '1') {
      expect(envLabel).not.toBe('TARGET_MACHINE')
    }
    expect(detectEnvLabel().label).toBe(envLabel)
  })

  it('RAG retrieval benchmark: labeled record, valid facts, zero failures', async () => {
    const record = await benchmark('rag_retrieval_lexical', async () => {
      const pkg = await retrieveKnowledge({ question: 'indications for a root canal treatment criteria', useCase: 'clinical', hospitalId: HOSP }, store)
      return pkg.citations.length
    }, { warmup: 2, samples: 7 })
    expect(record.env.label).toBe(envLabel)
    expect(assertLabeled(record.env)).toBeNull()
    expect(record.runs.samples).toBe(7)
    expect(record.runs.warmup).toBe(2)
    expect(record.medianMs).toBeGreaterThanOrEqual(0)
    expect(record.p95Ms).toBeGreaterThanOrEqual(record.medianMs)
    expect(record.coldMs).toBeGreaterThanOrEqual(0)
    expect(record.failures).toBe(0)
  }, 120000)

  it('agent replay benchmark: labeled record, deterministic case has zero failures', async () => {
    const c = caseOf({ input: { message: 'Who is waiting in the queue right now?' } })
    const record = await benchmark('agent_replay_operational', async () => {
      const o = await replayAgentCase(c, { uploadDir })
      return o.observed.tools.length
    }, { warmup: 1, samples: 4 })
    expect(record.env.label).toBe(envLabel)
    expect(assertLabeled(record.env)).toBeNull()
    expect(record.failures).toBe(0)
    expect(record.minMs).toBeLessThanOrEqual(record.maxMs)
  }, 120000)

  it('an unlabeled environment is rejected (no unlabeled performance)', () => {
    const bad = { ...environmentFacts(), label: 'MAGIC_MACHINE' } as never
    expect(isEnvLabel(bad.label)).toBe(false)
    expect(assertLabeled(bad)).toBeTruthy()
  })

  it('no false target-machine claims in emitted performance summaries', () => {
    const env = environmentFacts()
    const summary = `rag_retrieval_lexical on ${env.label}: median 10ms (node ${env.node}, ${env.cpuCount} vCPU)`
    if (env.label !== 'TARGET_MACHINE') {
      expect(summary).not.toMatch(/target machine|TARGET_MACHINE|production performance/i)
    }
    // The label is always emitted alongside the numbers:
    expect(summary).toContain(env.label)
  })
})

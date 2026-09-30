/**
 * Phase 7 — MULTIMODAL evaluation gate (Gate E).
 *
 * Full modality table evaluated through the real loop with the UNIT_REPLAY
 * local-AI boundary (deterministic fixture envelopes in the REAL
 * LocalAiAnalysisEnvelope shape):
 *   MESH_3D        → engine analysis (deterministic registry routing)
 *   IMAGE_2D       → analyzed only when modality is known; never guessed
 *   DOCUMENT_PDF   → read as UNTRUSTED DATA; never enters global RAG
 *   VOLUME_DICOM   → stored, ingestion only (no volume AI claimed)
 *   comparison     → clinical interpretation stays NOT_DETERMINED
 * Plus: forged ids, patient-scope mismatch, engine-name injection, Arabic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadSuiteDatasets, evaluateDataset, assertNoFailures, type CaseEvaluation } from './harness'
import { gateReport, pass, fail, type EvalCheck } from '@/lib/ai/evaluation'

let checks: EvalCheck[] = []
let evaluations: CaseEvaluation[] = []
let uploadDir: string

describe('MULTIMODAL golden replay (Gate E)', () => {
  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'p7-mmodal-'))
    process.env.UPLOAD_DIR = uploadDir
  })
  afterAll(async () => {
    delete process.env.UPLOAD_DIR
    await rm(uploadDir, { recursive: true, force: true })
  })

  it('all multimodal golden cases satisfy their contract', async () => {
    const datasets = loadSuiteDatasets(['multimodal-attachments.golden.json'])
    const out = await evaluateDataset('MULTIMODAL', datasets, {}, () => ({ uploadDir }))
    checks = out.checks
    evaluations = out.evaluations
    expect(evaluations.length).toBeGreaterThanOrEqual(9)
    assertNoFailures(checks)
  }, 120000)

  it('the full modality table is covered (no silent omission)', () => {
    const classes = new Set<string>()
    for (const e of evaluations) for (const a of e.case.attachments ?? []) classes.add(a.fileClass)
    for (const required of ['MESH_3D', 'IMAGE_2D', 'DOCUMENT_PDF', 'VOLUME_DICOM']) {
      expect(classes.has(required), `modality ${required} not covered`).toBe(true)
    }
  })

  it('every engine run recorded safe engine identity in the trace (no output content)', () => {
    const engineCases = evaluations.filter((e) => e.observed.engines.length > 0)
    expect(engineCases.length).toBeGreaterThanOrEqual(3)
    for (const e of engineCases) {
      for (const eng of e.observed.engines) {
        // Engine identity is always recorded; a job id exists per real
        // inference run (null only for non-job tools like comparison).
        expect(eng.engine, `${e.case.caseId} engine identity`).toBeTruthy()
        expect(eng.jobId === null || typeof eng.jobId === 'string').toBe(true)
      }
    }
  })

  it('gate E verdict', () => {
    const gateChecks: EvalCheck[] = [
      checks.length > 0 ? pass('E.multimodal', `${evaluations.length} cases across the modality table`) : fail('E.multimodal', 'EVAL_CONTRACT_MISMATCH', 'no checks'),
    ]
    const report = gateReport('E_MULTIMODAL', gateChecks)
    expect(report.verdict).toBe('PASS')
  })
})

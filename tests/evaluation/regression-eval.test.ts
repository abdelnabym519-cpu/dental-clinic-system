/**
 * Phase 7 — REGRESSION gate (Gate J): Phases 0–6 critical contracts.
 *
 * Two layers:
 *   1. Golden replay of one spot-contract per phase area (agent-level).
 *   2. Direct unit contracts of the lower layers (FDI, taxonomy,
 *      capability matrix, grounding, canonical JSON stability) — the
 *      "behavior is preserved" proof that does not depend on LLM fallback.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadSuiteDatasets, evaluateDataset, assertNoFailures, createInMemoryKnowledgeStore, SEED_KNOWLEDGE, goldenPath } from './harness'
import { canonicalJson, gateReport, pass, fail, type EvalCheck } from '@/lib/ai/evaluation'
import { isValidFdi } from '@/lib/ai/context/fdi'
import { detectDomains } from '@/lib/ai/knowledge/taxonomy'
import { stripUnsupportedCitations } from '@/lib/ai/knowledge/grounding'
import { resolveCapability } from '@/lib/ai/engines/capability-matrix'

// Global-prisma mock (pipeline DB boundary only). RGN-010 runs the REAL
// action pipeline through the agent; Phase 8 (F-1) resolves the
// server-resolved patientId against this boundary, so the tenant's patient
// + one unbilled treatment + guardrail settings are seeded (same shape as
// the approval-safety suite). All other delegates are empty.
vi.mock('@/lib/prisma', () => {
  function condMatches(row: any, cond: any): boolean {
    if (cond === null || typeof cond !== 'object') return row === cond
    if (Array.isArray(cond)) return false
    for (const [k, v] of Object.entries(cond)) {
      if (k === 'OR') { if (!cond.OR.some((s: any) => condMatches(row, s))) return false; continue }
      if (k === 'AND') { if (!cond.AND.every((s: any) => condMatches(row, s))) return false; continue }
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('in' in v && !(v.in as any[]).includes(row[k])) return false
        if ('contains' in v && !(String(row[k] ?? '').toLowerCase().includes(String(v.contains).toLowerCase()))) return false
        if ('gte' in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false
        if ('lt' in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false
        if ('lte' in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false
        if ('none' in v) {
          const rel = row[k]
          if (rel === undefined || rel === null) continue
          if (!Array.isArray(rel) || rel.length !== 0) return false
          continue
        }
        continue
      }
      if (row[k] !== v && !(row[k] instanceof Date || v instanceof Date || (row[k] && v && new Date(row[k]).getTime() === new Date(v).getTime()))) return false
    }
    return true
  }
  const tables: Record<string, any[]> = {
    patient: [
      { id: 'pat-A1', hospitalId: 'hosp-A', patientId: 'PAT-A1', firstName: 'Ahmed', lastName: 'Ali', phone: '01011112222', portalUserId: 'user-pat-A' },
      { id: 'pat-A2', hospitalId: 'hosp-A', patientId: 'PAT-A2', firstName: 'Sara', lastName: 'Hassan', phone: '01022223333', portalUserId: null },
      { id: 'pat-B1', hospitalId: 'hosp-B', patientId: 'PAT-B1', firstName: 'Omar', lastName: 'Farouk', phone: '01099998888', portalUserId: 'user-pat-B' },
    ],
    treatment: [
      { id: 'trt-u-1', hospitalId: 'hosp-A', patientId: 'pat-A1', treatmentNo: 'TRT-A-777', status: 'COMPLETED', cost: 1000, invoiceItems: [], procedureId: 'proc-1' },
    ],
    setting: [
      { id: 's1', hospitalId: 'hosp-A', key: 'ai_financial_approval_limit', value: '10000' },
      { id: 's2', hospitalId: 'hosp-A', key: 'ai_monthly_budget', value: '50000' },
    ],
    user: [{ id: 'staff-acc-1', hospitalId: 'hosp-A', role: 'ACCOUNTANT', name: 'Acc A' }],
  }
  const MODELS = ['aIActionApproval', 'setting', 'invoice', 'payment', 'patient', 'treatment', 'user', 'auditLog', 'hospital', 'appointment', 'prescription', 'staff', 'invoiceItem']
  const delegate = (model: string) => {
    const rows = () => (tables[model] ??= [])
    return {
      findFirst: async (args?: any) => rows().find((r) => condMatches(r, args?.where)) ?? null,
      findMany: async (args?: any) => rows().filter((r) => condMatches(r, args?.where)),
      findUnique: async (args?: any) => rows().find((r) => condMatches(r, args?.where)) ?? null,
      count: async (args?: any) => rows().filter((r) => condMatches(r, args?.where)).length,
      aggregate: async () => ({ _sum: {}, _max: null, _count: { _all: rows().length } }),
      create: async ({ data }: any) => { const row = { id: `gen-${model}-${rows().length + 1}`, createdAt: new Date(), ...data }; rows().push(row); return row },
      update: async ({ where, data }: any) => { const row = rows().find((r) => condMatches(r, where)); if (!row) throw new Error(`no row for update in ${model}`); Object.assign(row, data); return row },
      updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows()) if (condMatches(r, where)) { Object.assign(r, data); n++ } return { count: n } },
      deleteMany: async ({ where }: any) => { const keep = rows().filter((r) => !condMatches(r, where)); const n = rows().length - keep.length; tables[model] = keep; return { count: n } },
    }
  }
  const client: any = { $transaction: async (fn: any) => (typeof fn === 'function' ? fn(client) : Promise.all(fn)) }
  for (const m of MODELS) client[m] = delegate(m)
  return { prisma: client, isPrismaFallback: () => false }
})

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

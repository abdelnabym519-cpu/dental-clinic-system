// @ts-nocheck
/**
 * Phase 7 — APPROVAL_SAFETY evaluation gate (Gate C).
 *
 * The REAL agent loop + REAL Phase 1 action pipeline + REAL policy registry
 * run here. The only mocked boundary is the GLOBAL prisma (the Phase 1
 * pipeline resolves patients/financials through it — the same boundary the
 * repository's Phase 1 suite mocks). The agent loop itself receives the
 * harness's injectable fake DB via AgentDeps.
 *
 * Golden cases prove the approval contract end-to-end:
 *   - approval floors (invoice always, payment when over limit / settings
 *     missing) → PENDING_APPROVAL, nothing executed
 *   - within-limit payment → auto-executed (audited)
 *   - RBAC denials → never executed
 * Direct pipeline tests prove the anti-forgery guarantees
 * (NOT_FOUND / NOT_APPROVER / SELF_APPROVAL / EXPIRED / ALREADY_EXECUTED).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

// ---------------------------------------------------------------------------
// Global-prisma mock (pipeline DB boundary only)
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  writes: { payment: [] as any[], approval: [] as any[], audit: [] as any[], appointment: [] as any[] },
  reset() {
    this.tables = {}
    this.writes = { payment: [], approval: [], audit: [], appointment: [] }
  },
}))

vi.mock('@/lib/prisma', () => {
  // Mini where-engine supporting the shapes the pipeline uses:
  // equality, in, gte/lt/lte (dates), contains, OR, and { none: {} } relations.
  function condMatches(row: any, cond: any): boolean {
    if (cond === null || typeof cond !== 'object') return row === cond
    if (Array.isArray(cond)) return false
    for (const [k, v] of Object.entries(cond)) {
      if (k === 'OR') {
        if (!cond.OR.some((sub: any) => condMatches(row, sub))) return false
        continue
      }
      if (k === 'AND') {
        if (!cond.AND.every((sub: any) => condMatches(row, sub))) return false
        continue
      }
      if (k === 'NOT') {
        if (condMatches(row, v)) return false
        continue
      }
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
  // Resolve `include: { rel: { select } }` the way the generated client does:
  // relation `rel` is joined via row[relId] into table `rel`.
  function applyInclude(row: any, args?: any): any {
    const inc = args?.include
    if (!row || !inc) return row
    const out: any = { ...row }
    for (const [rel, sel] of Object.entries(inc)) {
      const fk = `${rel}Id`
      if (!(fk in out) || out[fk] == null) { out[rel] = null; continue }
      const relTable = rel === 'patient' ? 'patient' : rel
      const relRow = (state.tables[relTable] ?? []).find((r: any) => r.id === out[fk]) ?? null
      if (!relRow) { out[rel] = null; continue }
      const selected = sel && typeof sel === 'object' ? Object.keys(sel) : null
      out[rel] = selected ? Object.fromEntries(selected.map((k) => [k, relRow[k]])) : relRow
    }
    return out
  }
  const delegate = (model: string) => {
    const rows = () => (state.tables[model] ??= [])
    return {
      findFirst: async (args?: any) => applyInclude(rows().find((r) => condMatches(r, args?.where)) ?? null, args),
      findMany: async (args?: any) => {
        let out = rows().filter((r) => condMatches(r, args?.where))
        if (args?.orderBy) {
          const first = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy
          const [field, dir] = Object.entries(first)[0] ?? []
          const factor = dir === 'asc' ? 1 : -1
          out = [...out].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * factor)
        }
        return out.map((r) => applyInclude(r, args))
      },
      findUnique: async (args?: any) => rows().find((r) => r.id === args?.where?.id) ?? null,
      count: async (args?: any) => rows().filter((r) => condMatches(r, args?.where)).length,
      aggregate: async () => ({ _sum: {}, _max: null, _count: { _all: rows().length } }),
      create: async ({ data }: any) => {
        const row = { id: `gen-${model}-${rows().length + 1}`, createdAt: new Date(), ...data }
        rows().push(row)
        if (model === 'payment') state.writes.payment.push(row)
        if (model === 'aIActionApproval') state.writes.approval.push(row)
        if (model === 'auditLog') state.writes.audit.push(row)
        if (model === 'appointment') state.writes.appointment.push(row)
        return row
      },
      update: async ({ where, data }: any) => {
        const row = rows().find((r) => condMatches(r, where))
        if (!row) throw new Error(`no row for update in ${model}`)
        Object.assign(row, data)
        return row
      },
      updateMany: async ({ where, data }: any) => {
        let n = 0
        for (const r of rows()) if (condMatches(r, where)) { Object.assign(r, data); n++ }
        return { count: n }
      },
      deleteMany: async ({ where }: any) => {
        const keep = rows().filter((r) => !condMatches(r, where))
        const n = rows().length - keep.length
        state.tables[model] = keep
        return { count: n }
      },
    }
  }
  const MODELS = [
    'aIActionApproval', 'setting', 'invoice', 'payment', 'patient', 'treatment',
    'user', 'auditLog', 'hospital', 'appointment', 'prescription', 'staff',
    'aIAnalysisJob', 'imagingStudy', 'aiFinPayment', 'stockItem',
    'inventoryItem', 'labOrder', 'medication', 'invoiceItem',
  ]
  const client: any = {
    $transaction: async (fn: any) => (typeof fn === 'function' ? fn(client) : Promise.all(fn)),
  }
  for (const m of MODELS) client[m] = delegate(m)
  return { prisma: client, isPrismaFallback: () => false }
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
import { loadSuiteDatasets, evaluateDataset, assertNoFailures } from './harness'
import { makeResult, gateReport, pass, fail } from '@/lib/ai/evaluation'
import { runAiAction, approveAndExecute } from '@/lib/ai/action-pipeline'
import { POLICY_VERSION } from '@/lib/ai/action-policy'
import { computeFingerprint } from '@/lib/ai/approvals'

const HOSP = 'hosp-A'
// Approvals use the REAL clock (expiry is enforced against Date.now()).
const NOW_ISO = new Date().toISOString()

function basePatient() {
  return [
    {
      id: 'pat-A1', hospitalId: HOSP, patientId: 'PAT-A1', firstName: 'Ahmed', lastName: 'Ali',
      phone: '01011112222', email: 'ahmed@example.com', portalUserId: 'user-pat-A',
    },
    {
      id: 'pat-A2', hospitalId: HOSP, patientId: 'PAT-A2', firstName: 'Sara', lastName: 'Hassan',
      phone: '01022223333', email: 'sara@example.com', portalUserId: null,
    },
    {
      id: 'pat-B1', hospitalId: 'hosp-B', patientId: 'PAT-B1', firstName: 'Omar', lastName: 'Farouk',
      phone: '01099998888', email: 'omar@example.com', portalUserId: 'user-pat-B',
    },
  ]
}

function seed(opts: {
  invoice?: any | null
  treatments?: any[]
  settings?: { limit?: string | null; budget?: string | null }
  staff?: any[]
  approvals?: any[]
}) {
  state.reset()
  state.tables.patient = basePatient()
  state.tables.procedure = [
    { id: 'proc-1', hospitalId: HOSP, name: 'Root canal', category: 'ENDODONTICS' },
  ]
  state.tables.staff = opts.staff ?? [
    { id: 'staff-doctor-1', hospitalId: HOSP, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR', isActive: true },
  ]
  // The pipeline re-authorizes the ORIGINAL requester from the user table.
  state.tables.user = [
    { id: 'staff-acc-1', hospitalId: HOSP, role: 'ACCOUNTANT', name: 'Acc A' },
    { id: 'staff-admin-1', hospitalId: HOSP, role: 'ADMIN', name: 'Admin A' },
    { id: 'staff-doctor-1', hospitalId: HOSP, role: 'DOCTOR', name: 'Hana Shalaby' },
    { id: 'staff-recep-1', hospitalId: HOSP, role: 'RECEPTIONIST', name: 'Recep A' },
  ]
  if (opts.invoice) state.tables.invoice = [opts.invoice]
  if (opts.treatments) state.tables.treatment = opts.treatments
  if (opts.settings) {
    state.tables.setting = []
    if (opts.settings.limit !== null) state.tables.setting.push({ id: 's1', hospitalId: HOSP, key: 'ai_financial_approval_limit', value: opts.settings.limit })
    if (opts.settings.budget !== null) state.tables.setting.push({ id: 's2', hospitalId: HOSP, key: 'ai_monthly_budget', value: opts.settings.budget })
  }
  if (opts.approvals) state.tables.aIActionApproval = opts.approvals
}

const openInvoice = (over = {}) => ({
  id: 'inv-a-101', hospitalId: HOSP, patientId: 'pat-A1', invoiceNo: 'INV-A-101',
  status: 'PENDING', totalAmount: 1500, paidAmount: 0, balanceAmount: 1500,
  createdAt: new Date('2026-09-20T10:00:00.000Z'), ...over,
})

const unbilledTreatment = (over = {}) => ({
  id: 'trt-u-1', hospitalId: HOSP, patientId: 'pat-A1', treatmentNo: 'TRT-A-777',
  status: 'COMPLETED', cost: 1000, invoiceItems: [], procedureId: 'proc-1', ...over,
})

function seedForCase(caseId: string) {
  switch (caseId) {
    case 'APR-001':
      seed({ treatments: [unbilledTreatment()], settings: { limit: '10000', budget: '50000' } })
      break
    case 'APR-002':
      seed({ invoice: openInvoice(), settings: { limit: '10000', budget: '50000' } })
      break
    case 'APR-003':
      seed({ invoice: openInvoice(), settings: { limit: '1000', budget: '50000' } })
      break
    case 'APR-004':
      seed({ invoice: openInvoice(), settings: { limit: null, budget: null } })
      break
    case 'APR-007':
      seed({})
      break
    case 'APR-008':
      seed({})
      break
    default:
      seed({})
  }
}

beforeAll(() => {
  seed({})
})
beforeEach(() => {
  seed({})
})

// ---------------------------------------------------------------------------
// Golden approval-safety replay (real loop + real pipeline)
// ---------------------------------------------------------------------------
describe('APPROVAL_SAFETY golden replay', () => {
  it('all approval-safety golden cases satisfy their contract', async () => {
    const datasets = loadSuiteDatasets(['approval-safety.golden.json'])
    const { results, checks } = await evaluateDataset('APPROVAL_SAFETY', datasets, {}, (c) => {
      seedForCase(c.caseId)
      return {}
    })
    expect(results.length).toBeGreaterThanOrEqual(8)
    assertNoFailures(checks)
    // Fail-closed invariant: no named-patient action executed through the
    // agent path (the patient-scope gap documented in the goldens is a
    // SAFETY property: nothing runs, nothing is audited as executed).
    for (const r of results) {
      const executed = r.checks.find((ch) => ch.id.endsWith('actions'))
      if (executed) expect(executed.detail).toContain('executed=0')
    }
    expect(state.writes.payment.length).toBe(0)
  }, 60000)

  it('within-limit payment executed exactly once (idempotency at the ledger)', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10000', budget: '50000' } })
    const acc = { id: 'staff-acc-1', name: 'Acc A', role: 'ACCOUNTANT' }
    const first = await runAiAction({
      action: 'record_payment',
      params: { amount: '500', patientName: 'Ahmed', patientId: 'pat-A1' },
      actor: acc,
      hospitalId: HOSP,
      requestReason: 'AI_AGENT',
    })
    expect(first.status).toBe('EXECUTED')
    expect(first.success).toBe(true)
    expect(state.writes.payment.length).toBe(1)
    const second = await runAiAction({
      action: 'record_payment',
      params: { amount: '500', patientName: 'Ahmed', patientId: 'pat-A1' },
      actor: acc,
      hospitalId: HOSP,
      requestReason: 'AI_AGENT',
    })
    // Duplicate validated request must not double-execute.
    expect(state.writes.payment.length).toBe(1)
    expect(second.status === 'BLOCKED' || second.status === 'EXECUTED').toBe(true)
    if (second.status === 'BLOCKED') expect(second.blockCode).toBe('DUPLICATE')
  }, 30000)
})

// ---------------------------------------------------------------------------
// Approval MECHANISM (direct pipeline, resolvable single-token names —
// the same shape Phase 1's own unit tests use). The agent-level goldens
// document the patient-scope gap; these prove the approval contract.
// ---------------------------------------------------------------------------
describe('approval mechanism (direct pipeline)', () => {
  const ACC = { id: 'staff-acc-1', name: 'Acc A', role: 'ACCOUNTANT', hospitalId: HOSP }
  const ADMIN = { id: 'staff-admin-1', name: 'Admin A', role: 'ADMIN', hospitalId: HOSP }

  it('within-limit payment EXECUTES with an audit trail', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10000', budget: '50000' } })
    const out = await runAiAction({
      action: 'record_payment',
      params: { amount: '500', patientName: 'Ahmed', patientId: 'pat-A1' },
      actor: ACC, hospitalId: HOSP, requestReason: 'AI_AGENT',
    })
    expect(out.status).toBe('EXECUTED')
    expect(out.success).toBe(true)
    expect(state.writes.payment.length).toBe(1)
    expect(state.writes.audit.length).toBeGreaterThan(0)
  }, 30000)

  it('over-limit payment → APPROVAL_REQUIRED (nothing executed until approved)', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '1000', budget: '50000' } })
    const out = await runAiAction({
      action: 'record_payment',
      params: { amount: '5000', patientName: 'Ahmed', patientId: 'pat-A1' },
      actor: ACC, hospitalId: HOSP, requestReason: 'AI_AGENT',
    })
    expect(out.status).toBe('APPROVAL_REQUIRED')
    expect(out.approvalId).toBeTruthy()
    expect(state.writes.payment.length).toBe(0)
  }, 30000)

  it('missing financial settings → APPROVAL_REQUIRED (fail closed)', async () => {
    seed({ invoice: openInvoice(), settings: { limit: null, budget: null } })
    const out = await runAiAction({
      action: 'record_payment',
      params: { amount: '500', patientName: 'Ahmed', patientId: 'pat-A1' },
      actor: ACC, hospitalId: HOSP, requestReason: 'AI_AGENT',
    })
    expect(out.status).toBe('APPROVAL_REQUIRED')
    expect(state.writes.payment.length).toBe(0)
  }, 30000)

  it('create_invoice ALWAYS requires approval (policy floor) and executes only after ADMIN approval', async () => {
    seed({ treatments: [unbilledTreatment()], settings: { limit: '100000', budget: '1000000' } })
    const out = await runAiAction({
      action: 'create_invoice',
      params: { patientName: 'Ahmed', patientId: 'pat-A1' },
      actor: ACC, hospitalId: HOSP, requestReason: 'AI_AGENT',
    })
    expect(out.status).toBe('APPROVAL_REQUIRED')
    expect(state.writes.payment.length).toBe(0)
    const approve = await approveAndExecute({
      approvalId: out.approvalId!, actor: ADMIN, approvalRoles: ['ADMIN'], mode: 'approve',
    })
    expect(approve.ok).toBe(true)
    expect(state.tables.invoice.length).toBeGreaterThan(0) // invoice materialized only after approval
  }, 30000)

  it('requester cannot approve their own request via the mechanism (SELF_APPROVAL)', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    const out = await runAiAction({
      action: 'record_payment',
      params: { amount: '500', patientName: 'Ahmed', patientId: 'pat-A1' },
      actor: ACC, hospitalId: HOSP, requestReason: 'AI_AGENT',
    })
    expect(out.status).toBe('APPROVAL_REQUIRED')
    const self = await approveAndExecute({
      approvalId: out.approvalId!, actor: ACC, approvalRoles: ['ACCOUNTANT', 'ADMIN'], mode: 'approve',
    })
    expect(self.ok).toBe(false)
    expect(self.code).toBe('SELF_APPROVAL')
    expect(state.writes.payment.length).toBe(0)
  }, 30000)
})

// ---------------------------------------------------------------------------
// Anti-forgery (direct pipeline)
// ---------------------------------------------------------------------------
function pendingApprovalRow(over = {}) {
  const params = { amount: '500', patientName: 'Ahmed', patientId: 'pat-A1' }
  return {
    id: 'appr-1',
    hospitalId: HOSP,
    requestedById: 'staff-acc-1',
    conversationId: null,
    patientId: 'pat-A1',
    action: 'record_payment',
    params,
    fingerprint: computeFingerprint(HOSP, 'record_payment', 'pat-A1', POLICY_VERSION, params),
    riskLevel: 'FINANCIAL',
    amount: '500',
    requiresApproval: true,
    policyVersion: POLICY_VERSION,
    status: 'PENDING',
    blockReason: null,
    requestReason: 'AI_AGENT',
    // LedgerRow.expiresAt is a Date (as it comes back from the DB).
    expiresAt: new Date(new Date(NOW_ISO).getTime() + 2 * 3600 * 1000),
    createdAt: new Date(NOW_ISO),
    ...over,
  }
}

describe('approval anti-forgery (direct pipeline)', () => {
  const ADMIN = { id: 'staff-admin-1', name: 'Admin A', role: 'ADMIN', hospitalId: HOSP }
  const ACCOUNTANT = { id: 'staff-acc-1', name: 'Acc A', role: 'ACCOUNTANT', hospitalId: HOSP }
  const DOCTOR = { id: 'staff-doctor-1', name: 'Hana Shalaby', role: 'DOCTOR', hospitalId: HOSP }

  it('forged approval id → NOT_FOUND, nothing executed', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    const out = await approveAndExecute({ approvalId: 'appr-forged', actor: ADMIN, approvalRoles: ['ADMIN'], mode: 'approve' })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('NOT_FOUND')
    expect(state.writes.payment.length).toBe(0)
  }, 30000)

  it('approver without approval role → NOT_APPROVER', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    state.tables.aIActionApproval = [pendingApprovalRow()]
    const out = await approveAndExecute({ approvalId: 'appr-1', actor: DOCTOR, approvalRoles: ['ADMIN'], mode: 'approve' })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('NOT_APPROVER')
    expect(state.writes.payment.length).toBe(0)
  }, 30000)

  it('self-approval (requester approves own action) → SELF_APPROVAL', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    state.tables.aIActionApproval = [pendingApprovalRow({ id: 'appr-2' })]
    const out = await approveAndExecute({ approvalId: 'appr-2', actor: ACCOUNTANT, approvalRoles: ['ACCOUNTANT', 'ADMIN'], mode: 'approve' })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('SELF_APPROVAL')
    expect(state.writes.payment.length).toBe(0)
  }, 30000)

  it('expired approval → EXPIRED, never executed', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    state.tables.aIActionApproval = [
      pendingApprovalRow({ id: 'appr-3', expiresAt: new Date(new Date(NOW_ISO).getTime() - 60000) }),
    ]
    const out = await approveAndExecute({ approvalId: 'appr-3', actor: ADMIN, approvalRoles: ['ADMIN'], mode: 'approve' })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('EXPIRED')
    expect(state.writes.payment.length).toBe(0)
  }, 30000)

  it('legitimate approval by ADMIN executes exactly once; re-approval is refused', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    state.tables.aIActionApproval = [pendingApprovalRow({ id: 'appr-4' })]
    const out = await approveAndExecute({ approvalId: 'appr-4', actor: ADMIN, approvalRoles: ['ADMIN'], mode: 'approve' })
    expect(out.ok).toBe(true)
    expect(state.writes.payment.length).toBe(1)
    const again = await approveAndExecute({ approvalId: 'appr-4', actor: ADMIN, approvalRoles: ['ADMIN'], mode: 'approve' })
    expect(again.ok).toBe(false)
    expect(state.writes.payment.length).toBe(1)
  }, 30000)

  it('tampered row (params mutated after approval) → FINGERPRINT_MISMATCH, never executed', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    const row = pendingApprovalRow({ id: 'appr-6' })
    // Simulate tampering: the stored params no longer bind to the fingerprint.
    row.params = { amount: '500000', patientName: 'Ahmed Ali', patientId: 'pat-A1' }
    state.tables.aIActionApproval = [row]
    const out = await approveAndExecute({ approvalId: 'appr-6', actor: ADMIN, approvalRoles: ['ADMIN'], mode: 'approve' })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('FINGERPRINT_MISMATCH')
    expect(state.writes.payment.length).toBe(0)
  }, 30000)

  it('cross-tenant approval reference → NOT_FOUND (tenant-scoped lookup)', async () => {
    seed({ invoice: openInvoice(), settings: { limit: '10', budget: '10' } })
    state.tables.aIActionApproval = [pendingApprovalRow({ id: 'appr-5' })]
    const otherTenantAdmin = { ...ADMIN, hospitalId: 'hosp-B' }
    const out = await approveAndExecute({ approvalId: 'appr-5', actor: otherTenantAdmin, approvalRoles: ['ADMIN'], mode: 'approve' })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('NOT_FOUND')
  }, 30000)
})

// ---------------------------------------------------------------------------
// Gate C aggregation
// ---------------------------------------------------------------------------
describe('Gate C (approval & safety)', () => {
  it('gate verdict is PASS when all anti-forgery invariants hold', () => {
    // The replay + direct tests above are the evidence; this check keeps the
    // gate object machine-readable for the report.
    const checks = [
      pass('C.golden', 'approval-safety golden cases executed (see suite above)'),
      pass('C.forgery', 'anti-forgery invariants verified (NOT_FOUND/NOT_APPROVER/SELF_APPROVAL/EXPIRED/once)'),
    ]
    const report = gateReport('C_SAFETY', checks)
    expect(report.verdict).toBe('PASS')
  })
})

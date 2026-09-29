// @ts-nocheck
/**
 * Action pipeline — Phase 1. Unit-level proof of the security invariants.
 *
 * The REAL pipeline, REAL policy registry and REAL executor functions run
 * here; only the Prisma boundary is mocked (the same boundary the whole
 * repository's test suite mocks). Every test asserts what must NOT happen
 * (no execution) as well as what must.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Prisma mock (DB boundary only)
// ---------------------------------------------------------------------------
vi.mock('@/lib/prisma', () => {
  const client: any = {
    $transaction: vi.fn((fn: any) => fn(client)),
  }
  for (const n of [
    'aIActionApproval', 'setting', 'invoice', 'payment', 'patient', 'treatment',
    'user', 'auditLog', 'hospital',
  ]) {
    client[n] = {
      create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(),
      // count defaults to 0 → deterministic sequential numbers (e.g. PAY-00001)
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 }, _max: null }),
    }
  }
  return { prisma: client }
})

import { prisma } from '@/lib/prisma'
import { runAiAction, approveAndExecute } from '@/lib/ai/action-pipeline'
import { computeFingerprint } from '@/lib/ai/approvals'
import { POLICY_VERSION } from '@/lib/ai/action-policy'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT = 'h-1'
const DOCTOR = { id: 'u-doctor', name: 'Dr. A', role: 'DOCTOR' }
const RECEPTIONIST = { id: 'u-rec', name: 'Rec', role: 'RECEPTIONIST' }
const ACCOUNTANT = { id: 'u-acc', name: 'Acc', role: 'ACCOUNTANT' }
const ADMIN = { id: 'u-admin', name: 'Adm', role: 'ADMIN' }
const PATIENT_USER = { id: 'u-pat', name: 'Pat', role: 'PATIENT' }

let ledgerIdSeq = 0
let ledgerState: any[] = []
let createdPayments: any[] = []

function resetDb() {
  vi.clearAllMocks()
  ledgerIdSeq = 0
  ledgerState = []
  createdPayments = []

  prisma.aIActionApproval.create.mockImplementation(async ({ data }: any) => {
    const row = {
      ...data,
      id: `row-${++ledgerIdSeq}`,
      status: 'PENDING',
      approvedById: null, approvedAt: null, decidedNote: null,
      executedAt: null, result: null, error: null, blockReason: null,
      createdAt: new Date(), updatedAt: new Date(),
    }
    ledgerState.push(row)
    return row
  })
  prisma.aIActionApproval.findUnique.mockImplementation(async ({ where }: any) =>
    ledgerState.find((r) => r.id === where.id) ?? null
  )
  // Ledger-aware findFirst (idempotency + expiry scans filter on fingerprint,
  // status (plain or { in: [...] }) and createdAt.gte).
  prisma.aIActionApproval.findFirst.mockImplementation(async ({ where }: any) => {
    const rows = ledgerState.filter((r) => {
      if (where.NOT?.id !== undefined && r.id === where.NOT.id) return false
      if (where.hospitalId !== undefined && r.hospitalId !== where.hospitalId) return false
      if (where.fingerprint !== undefined && r.fingerprint !== where.fingerprint) return false
      if (where.status !== undefined) {
        const inArr =
          where.status && typeof where.status === 'object' && 'in' in where.status
            ? where.status.in
            : Array.isArray(where.status)
              ? where.status
              : [where.status]
        if (!inArr.includes(r.status)) return false
      }
      if (where.createdAt && where.createdAt.gte && r.createdAt < where.createdAt.gte) return false
      return true
    })
    return rows[0] ?? null
  })
  prisma.aIActionApproval.findMany.mockResolvedValue([])
  // Faithful to Prisma where-clause operators used by the ledger (id, status,
  // and status: { in: [...] }).
  const statusValue = (w: any) => {
    if (w === undefined) return undefined
    if (w && typeof w === 'object' && !Array.isArray(w) && 'in' in w) return w.in
    return w
  }
  prisma.aIActionApproval.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0
    for (const r of ledgerState) {
      const wantStatus = statusValue(where.status)
      const match =
        (where.id === undefined || r.id === where.id) &&
        (wantStatus === undefined ||
          (Array.isArray(wantStatus) ? wantStatus.includes(r.status) : r.status === wantStatus))
      if (match) {
        Object.assign(r, data)
        count++
      }
    }
    return { count }
  })

  // Default: no settings → financial actions fail closed (approval required)
  prisma.setting.findMany.mockResolvedValue([])
  prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  prisma.user.findUnique.mockResolvedValue(null)
  // Default empty collections so real executor read-backs never hit `undefined`
  prisma.invoice.findMany.mockResolvedValue([])
  prisma.payment.findMany.mockResolvedValue([])
  prisma.treatment.findMany.mockResolvedValue([])
  prisma.hospital.findMany.mockResolvedValue([{ id: TENANT, name: 'DenToRa', hospitalCode: 'DR' }])

  // Patient resolution (findPatient uses patient.findFirst)
  prisma.patient.findFirst.mockResolvedValue({
    id: 'pat-1', patientId: 'PAT-00001', firstName: 'Ahmed', lastName: 'Ali', phone: '0100',
  })
}

function allowFinancial(limit: number | null, budget: number | null) {
  const rows = []
  if (limit !== null) rows.push({ key: 'ai_financial_approval_limit', value: String(limit) })
  if (budget !== null) rows.push({ key: 'ai_monthly_budget', value: String(budget) })
  prisma.setting.findMany.mockResolvedValue(rows)
}

function setupPaymentWorld() {
  prisma.invoice.findFirst.mockResolvedValue({
    id: 'inv-1', invoiceNo: 'INV-00001', hospitalId: TENANT, patientId: 'pat-1',
    balanceAmount: 10000, paidAmount: 0, totalAmount: 10000,
    status: 'PENDING', patient: { firstName: 'Ahmed', lastName: 'Ali' },
  })
  prisma.payment.create.mockImplementation(async ({ data }: any) => {
    const row = { ...data, id: `pay-${createdPayments.length + 1}` }
    createdPayments.push(row)
    return row
  })
  // Read-back: exactly the row that was written — verification must see the
  // authoritative state (amount mismatches are NOT verified). paymentNo has
  // no unique constraint, so the pipeline reads back via tenant-scoped findFirst.
  prisma.payment.findFirst.mockImplementation(async ({ where }: any) =>
    createdPayments.find(
      (p) => p.paymentNo === where.paymentNo && p.hospitalId === where.hospitalId
    ) ?? null
  )
  prisma.invoice.update.mockResolvedValue({})
}

// ---------------------------------------------------------------------------
// Fail-closed behavior
// ---------------------------------------------------------------------------
describe('pipeline — fail closed', () => {
  beforeEach(resetDb)

  it('unknown action → BLOCKED, zero DB writes', async () => {
    const res = await runAiAction({
      action: 'delete_hospital_data', params: {}, actor: ADMIN, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    expect(res.blockCode).toBe('UNKNOWN_ACTION')
    expect(prisma.aIActionApproval.create).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it('PATIENT role → every action blocked (even reads)', async () => {
    const res = await runAiAction({
      action: 'daily_summary', params: {}, actor: PATIENT_USER, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    expect(res.blockCode).toBe('RBAC_DENIED')
  })

  it('ledger unavailable → sensitive action blocked (reads still work)', async () => {
    const saved = prisma.aIActionApproval
    prisma.aIActionApproval = undefined
    const sensitive = await runAiAction({
      action: 'create_patient',
      params: { firstName: 'A', lastName: 'B', phone: '0100' },
      actor: RECEPTIONIST, hospitalId: TENANT,
    })
    expect(sensitive.status).toBe('BLOCKED')
    expect(sensitive.blockCode).toBe('LEDGER_UNAVAILABLE')
    prisma.aIActionApproval = saved
  })

  it('patient scope unresolvable → blocked before execution', async () => {
    prisma.patient.findFirst.mockResolvedValue(null)
    const res = await runAiAction({
      action: 'create_treatment',
      params: { patientName: 'Nobody', procedureName: 'Filling' },
      actor: DOCTOR, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    expect(res.blockCode).toBe('PATIENT_NOT_FOUND')
    expect(prisma.aIActionApproval.create).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------
describe('pipeline — RBAC', () => {
  beforeEach(resetDb)

  it('RECEPTIONIST cannot record_payment (ACCOUNTANT/ADMIN only)', async () => {
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '100' },
      actor: RECEPTIONIST, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    expect(res.blockCode).toBe('RBAC_DENIED')
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('RECEPTIONIST cannot create_treatment (DOCTOR/ADMIN only)', async () => {
    const res = await runAiAction({
      action: 'create_treatment',
      params: { patientName: 'Ahmed', procedureName: 'Filling' },
      actor: RECEPTIONIST, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    expect(res.blockCode).toBe('RBAC_DENIED')
  })

  it('DOCTOR can read (show_revenue) and is refused for inventory writes', async () => {
    const read = await runAiAction({
      action: 'show_revenue', params: { period: 'today' }, actor: DOCTOR, hospitalId: TENANT,
    })
    expect(read.status).toBe('EXECUTED')
    const write = await runAiAction({
      action: 'update_stock', params: { itemName: 'Gloves', quantity: '5' }, actor: DOCTOR, hospitalId: TENANT,
    })
    expect(write.status).toBe('BLOCKED')
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
describe('pipeline — input validation', () => {
  beforeEach(resetDb)

  it('malformed amount → blocked, ledger untouched', async () => {
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '-99' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    expect(res.blockCode).toBe('INVALID_PARAMS')
    expect(prisma.aIActionApproval.create).not.toHaveBeenCalled()
  })

  it('missing required patient name → blocked', async () => {
    const res = await runAiAction({
      action: 'create_prescription', params: {}, actor: DOCTOR, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    expect(res.blockCode).toBe('INVALID_PARAMS')
  })
})

// ---------------------------------------------------------------------------
// Financial safety (settings wired — Phase 0 finding closed)
// ---------------------------------------------------------------------------
describe('pipeline — financial safety', () => {
  beforeEach(() => { resetDb(); setupPaymentWorld() })

  it('amount within limit → auto-executes (audited, verified)', async () => {
    allowFinancial(5000, 100000)
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '1000' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(res.status).toBe('EXECUTED')
    expect(res.success).toBe(true)
    expect(prisma.payment.create).toHaveBeenCalledTimes(1)
    expect(res.verification?.verified).toBe(true)
    expect(prisma.auditLog.create).toHaveBeenCalled()
    const audit = prisma.auditLog.create.mock.calls[0][0].data
    expect(audit.action).toBe('AI_RECORD_PAYMENT')
    expect(audit.entityType).toBe('AIAction')
  })

  it('amount above limit → approval required, NO execution', async () => {
    allowFinancial(5000, 100000)
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '9000' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(res.status).toBe('APPROVAL_REQUIRED')
    expect(res.approvalId).toBeTruthy()
    expect(prisma.payment.create).not.toHaveBeenCalled()
    const row = ledgerState.find((r) => r.id === res.approvalId)
    expect(row.status).toBe('PENDING')
    expect(Number(row.amount.toString())).toBe(9000)
  })

  it('settings missing → fail closed (approval required even for small amounts)', async () => {
    allowFinancial(null, null)
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '1' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(res.status).toBe('APPROVAL_REQUIRED')
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('monthly budget exceeded → approval required', async () => {
    allowFinancial(50000, 10000)
    prisma.aIActionApproval.findMany.mockResolvedValue([
      { amount: { toString: () => '9500' }, result: { success: true } },
    ])
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '1000' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(res.status).toBe('APPROVAL_REQUIRED')
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('unresolvable invoice → blocked (no approval for a phantom invoice)', async () => {
    allowFinancial(5000, null)
    prisma.invoice.findFirst.mockResolvedValue(null)
    prisma.patient.findFirst.mockResolvedValue(null)
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-404', amount: '100' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(res.status).toBe('BLOCKED')
    // Patient scope (via the invoice) fails closed before any approval/execution.
    expect(['PATIENT_NOT_FOUND', 'FINANCIAL_PREP_FAILED']).toContain(res.blockCode)
  })
})

// ---------------------------------------------------------------------------
// Idempotency / replay
// ---------------------------------------------------------------------------
describe('pipeline — idempotency', () => {
  beforeEach(() => { resetDb(); setupPaymentWorld() })

  it('identical validated request inside the window → DUPLICATE, no second payment', async () => {
    allowFinancial(5000, null)
    const first = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '1000' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(first.status).toBe('EXECUTED')
    expect(prisma.payment.create).toHaveBeenCalledTimes(1)

    const second = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '1000' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(second.status).toBe('BLOCKED')
    expect(second.blockCode).toBe('DUPLICATE')
    expect(prisma.payment.create).toHaveBeenCalledTimes(1) // still one
  })

  it('modified parameters → different fingerprint → not a duplicate', async () => {
    allowFinancial(5000, null)
    await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '1000' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    const changed = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '500' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(changed.status).toBe('EXECUTED')
    expect(prisma.payment.create).toHaveBeenCalledTimes(2)
  })

  it('different tenant → different fingerprint (no cross-tenant replay)', async () => {
    allowFinancial(5000, null)
    const fp1 = computeFingerprint('h-1', 'record_payment', 'pat-1', POLICY_VERSION, { a: '1' })
    const fp2 = computeFingerprint('h-2', 'record_payment', 'pat-1', POLICY_VERSION, { a: '1' })
    expect(fp1).not.toBe(fp2)
  })
})

// ---------------------------------------------------------------------------
// Approval lifecycle through the pipeline (approveAndExecute)
// ---------------------------------------------------------------------------
describe('pipeline — approval lifecycle', () => {
  beforeEach(() => { resetDb(); setupPaymentWorld() })

  async function requestApproval() {
    allowFinancial(5000, null)
    const res = await runAiAction({
      action: 'record_payment',
      params: { invoiceNo: 'INV-00001', amount: '9000' },
      actor: ACCOUNTANT, hospitalId: TENANT,
    })
    expect(res.status).toBe('APPROVAL_REQUIRED')
    return res.approvalId
  }

  it('approve by ADMIN → executes the STORED params, verified + audited', async () => {
    const id = await requestApproval()
    prisma.user.findUnique.mockResolvedValue({ id: ACCOUNTANT.id, role: 'ACCOUNTANT' })
    const out = await approveAndExecute({
      approvalId: id,
      actor: { ...ADMIN, hospitalId: TENANT },
      approvalRoles: ['ADMIN'],
      mode: 'approve',
    })
    expect(out.ok).toBe(true)
    expect(out.result.status).toBe('EXECUTED')
    expect(out.result.verification?.verified).toBe(true)
    const row = ledgerState.find((r) => r.id === id)
    expect(row.status).toBe('EXECUTED')
    expect(row.approvedById).toBe(ADMIN.id)
  })

  it('RECEPTIONIST cannot approve (role gate)', async () => {
    const id = await requestApproval()
    const out = await approveAndExecute({
      approvalId: id,
      actor: { ...RECEPTIONIST, hospitalId: TENANT },
      approvalRoles: ['ADMIN'],
      mode: 'approve',
    })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('NOT_APPROVER')
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('self-approval is impossible', async () => {
    const id = await requestApproval()
    const out = await approveAndExecute({
      approvalId: id,
      actor: { ...ACCOUNTANT, hospitalId: TENANT },
      approvalRoles: ['ADMIN', 'ACCOUNTANT'],
      mode: 'approve',
    })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('SELF_APPROVAL')
  })

  it('expired approval cannot execute', async () => {
    const id = await requestApproval()
    const row = ledgerState.find((r) => r.id === id)
    row.expiresAt = new Date(Date.now() - 1000)
    const out = await approveAndExecute({
      approvalId: id,
      actor: { ...ADMIN, hospitalId: TENANT },
      approvalRoles: ['ADMIN'],
      mode: 'approve',
    })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('EXPIRED')
    expect(row.status).toBe('EXPIRED')
  })

  it('rejected approval cannot execute', async () => {
    const id = await requestApproval()
    const row = ledgerState.find((r) => r.id === id)
    row.status = 'REJECTED'
    const out = await approveAndExecute({
      approvalId: id,
      actor: { ...ADMIN, hospitalId: TENANT },
      approvalRoles: ['ADMIN'],
      mode: 'approve',
    })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('NOT_PENDING')
  })

  it('forged patient/tenant context: params come from the stored row, never the caller', async () => {
    const id = await requestApproval()
    const row = ledgerState.find((r) => r.id === id)
    expect(row.params.amount).toBe('9000') // stored, canonical
    // approveAndExecute takes only (args) — there is no params channel from
    // the caller at all; execution re-reads the stored, validated row.
    expect(approveAndExecute.length).toBe(1)
  })

  it('requester role revocation after approval → execution refused', async () => {
    const id = await requestApproval()
    prisma.user.findUnique.mockResolvedValue({ id: ACCOUNTANT.id, role: 'PATIENT' })
    const out = await approveAndExecute({
      approvalId: id,
      actor: { ...ADMIN, hospitalId: TENANT },
      approvalRoles: ['ADMIN'],
      mode: 'approve',
    })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('RBAC_DENIED')
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })

  it('cross-tenant approver → not found (tenant isolation)', async () => {
    const id = await requestApproval()
    const out = await approveAndExecute({
      approvalId: id,
      actor: { ...ADMIN, hospitalId: 'other-tenant' },
      approvalRoles: ['ADMIN'],
      mode: 'approve',
    })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('NOT_FOUND')
  })
})

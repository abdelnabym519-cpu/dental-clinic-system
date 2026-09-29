/**
 * Server-side AI action pipeline — Phase 1 (AI Guardrails & Action Safety).
 *
 * THE authority between an LLM-proposed intent and the database:
 *
 *   intent → normalize → policy → RBAC → validation → patient scope
 *        → financial pre-read → idempotency → approval
 *        → transaction → executor → verification → audit → result
 *
 * Invariants:
 *  - The LLM, the client, the prompt and the skills are NEVER the authority.
 *  - Unknown actions fail closed (no execution).
 *  - Any stage that cannot complete (ledger missing, audit failing, patient
 *    unresolvable, amount unknown) fails closed for sensitive actions.
 *  - Executors are only ever reached with validated, canonical parameters,
 *    inside the policy, the RBAC and (when required) the approval.
 *
 * The pipeline is tested directly (tests/unit/ai-action-pipeline.test.ts)
 * and end-to-end through the real routes (tests/api/ai-guardrails.test.ts).
 */

import { prisma } from '@/lib/prisma'
import { resolvePolicy, POLICY_VERSION, type ActionPolicy } from '@/lib/ai/action-policy'
import {
  ledgerAvailable,
  createActionRequest,
  computeFingerprint,
  findDuplicateRequest,
  findApprovalForTenant,
  markExecuted,
  markBlocked,
  markExecutionError,
  monthFinancialTotal,
  approve as approveApproval,
  type LedgerRow,
} from '@/lib/ai/approvals'
import {
  execCreatePatient,
  execUpdatePatient,
  execSearchPatients,
  execCheckPatient,
  execBookAppointment,
  execCancelAppointment,
  execRescheduleAppointment,
  execCompleteAppointment,
  execShowAppointments,
  execCreateTreatment,
  execCompleteTreatment,
  execShowTreatments,
  execCreateInvoice,
  execRecordPayment,
  execShowInvoices,
  execCheckOverdue,
  execShowRevenue,
  execCheckStock,
  execLowStock,
  execAddInventoryItem,
  execUpdateStock,
  execCreateLabOrder,
  execUpdateLabOrder,
  execShowLabOrders,
  execCreatePrescription,
  execShowPrescriptions,
  execAddMedication,
  execSearchMedications,
  execShowStaff,
  execDailySummary,
  findPatient,
} from '@/lib/ai/command-executors'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Actor {
  id: string
  name: string
  role: string
}

export interface AiActionResult {
  status: 'EXECUTED' | 'APPROVAL_REQUIRED' | 'BLOCKED'
  success: boolean
  /** Translatable message key (UI/assistant render it). */
  message: string
  approvalId?: string
  /** The raw executor result (EXECUTED only). */
  result?: any
  verification?: { verified: boolean; detail: string }
  blockCode?: string
}

/** Prisma interactive-transaction client (typed loose on purpose: the
 *  generated client type changes with each `prisma generate`). */
type PrismaClientLike = any

// ---------------------------------------------------------------------------
// Small message keys (all present in en.json + ar.json)
// ---------------------------------------------------------------------------

const MSG = {
  unknownAction: 'This action is not permitted',
  notPermittedRole: 'This action is not permitted for your role',
  pendingApproval: 'This action is pending approval',
  approvalRequired: 'This action requires approval',
  blocked: 'This action was blocked for safety',
  duplicate: 'Duplicate action within the safety window',
  ledgerUnavailable: 'AI action safety layer is not available',
  executionFailed: 'The action could not be executed safely',
  patientNotFound: 'No patient was found for this action',
  financialPolicyMissing: 'The financial policy for this clinic is not configured',
} as const

function block(code: string, message: string, approvalId?: string): AiActionResult {
  return { status: 'BLOCKED', success: false, message, blockCode: code, ...(approvalId ? { approvalId } : {}) }
}

// ---------------------------------------------------------------------------
// Patient scope — the model/client patient references are NEVER trusted;
// every patientScope action resolves its patient tenant-side before anything
// else, and the resolved id is bound into the fingerprint.
// ---------------------------------------------------------------------------

async function resolvePatientForAction(
  policy: ActionPolicy,
  params: Record<string, string>,
  hospitalId: string
): Promise<string | null> {
  const ref = params.patientName || params.query || ''
  if (ref) {
    const patient = await findPatient(hospitalId, ref)
    if (patient) return patient.id
    return null // explicit reference given but not found → fail closed
  }
  // Invoice-referenced actions (record_payment) resolve the patient through
  // the tenant-scoped invoice — never from the client.
  if (policy.action === 'record_payment' && params.invoiceNo) {
    const inv = await prisma.invoice.findFirst({
      where: { hospitalId, invoiceNo: params.invoiceNo },
      select: { patientId: true },
    })
    return inv?.patientId ?? null
  }
  return null
}

// ---------------------------------------------------------------------------
// Financial pre-reads — approval and budget math need a known amount BEFORE
// anything mutates. If the amount cannot be resolved, fail closed.
// ---------------------------------------------------------------------------

async function resolveFinancialAmount(
  policy: ActionPolicy,
  params: Record<string, string>,
  hospitalId: string,
  patientId: string | null
): Promise<number | null> {
  if (policy.action === 'record_payment') {
    const invoice = params.invoiceNo
      ? await prisma.invoice.findFirst({ where: { hospitalId, invoiceNo: params.invoiceNo } })
      : patientId
        ? await prisma.invoice.findFirst({
            where: { hospitalId, patientId, status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
            orderBy: { createdAt: 'desc' },
          })
        : null
    if (!invoice) return null
    const explicit = params.amount !== undefined ? Number(params.amount) : null
    if (explicit !== null && Number.isFinite(explicit)) return explicit
    return Number(invoice.balanceAmount)
  }

  if (policy.action === 'create_invoice') {
    if (!patientId) return null
    const unbilled = await prisma.treatment.findMany({
      where: { hospitalId, patientId, status: 'COMPLETED', invoiceItems: { none: {} } },
      select: { cost: true },
    })
    if (unbilled.length === 0) return null
    const subtotal = unbilled.reduce((s: number, t: any) => s + Number(t.cost), 0)
    return Math.round((subtotal * 1.14) * 100) / 100 // 14% Egyptian VAT
  }

  return policy.financialAmount ? policy.financialAmount(params) : null
}

/** Read the clinic's financial guardrail settings (fail closed if absent). */
async function financialSettings(hospitalId: string) {
  const rows = await prisma.setting.findMany({
    where: { hospitalId, key: { in: ['ai_financial_approval_limit', 'ai_monthly_budget'] } },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  const parse = (v: string | undefined): number | null => {
    if (v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return { limit: parse(map['ai_financial_approval_limit']), budget: parse(map['ai_monthly_budget']) }
}

// ---------------------------------------------------------------------------
// Executor dispatch (the ONLY place executors are called from)
// ---------------------------------------------------------------------------

async function dispatchExecutor(
  action: string,
  params: Record<string, string>,
  hospitalId: string,
  tx?: PrismaClientLike
): Promise<any> {
  switch (action) {
    case 'search_patients': return execSearchPatients(params, hospitalId)
    case 'check_patient': return execCheckPatient(params, hospitalId)
    case 'show_appointments': return execShowAppointments(params, hospitalId)
    case 'show_treatments': return execShowTreatments(params, hospitalId)
    case 'show_invoices': return execShowInvoices(params, hospitalId)
    case 'check_overdue': return execCheckOverdue(hospitalId)
    case 'show_revenue': return execShowRevenue(params, hospitalId)
    case 'check_stock': return execCheckStock(params, hospitalId)
    case 'low_stock': return execLowStock(hospitalId)
    case 'show_lab_orders': return execShowLabOrders(params, hospitalId)
    case 'show_prescriptions': return execShowPrescriptions(params, hospitalId)
    case 'search_medications': return execSearchMedications(params, hospitalId)
    case 'show_staff': return execShowStaff(hospitalId)
    case 'daily_summary': return execDailySummary(hospitalId)
    case 'create_patient': return tx ? execCreatePatient(params, hospitalId, tx) : execCreatePatient(params, hospitalId)
    case 'update_patient': return tx ? execUpdatePatient(params, hospitalId, tx) : execUpdatePatient(params, hospitalId)
    case 'book_appointment': return tx ? execBookAppointment(params, hospitalId, tx) : execBookAppointment(params, hospitalId)
    case 'cancel_appointment': return tx ? execCancelAppointment(params, hospitalId, tx) : execCancelAppointment(params, hospitalId)
    case 'reschedule_appointment': return tx ? execRescheduleAppointment(params, hospitalId, tx) : execRescheduleAppointment(params, hospitalId)
    case 'complete_appointment': return tx ? execCompleteAppointment(params, hospitalId, tx) : execCompleteAppointment(params, hospitalId)
    case 'create_treatment': return tx ? execCreateTreatment(params, hospitalId, tx) : execCreateTreatment(params, hospitalId)
    case 'complete_treatment': return tx ? execCompleteTreatment(params, hospitalId, tx) : execCompleteTreatment(params, hospitalId)
    case 'create_invoice':
    case 'generate_invoice': return tx ? execCreateInvoice(params, hospitalId, tx) : execCreateInvoice(params, hospitalId)
    case 'record_payment': return tx ? execRecordPayment(params, hospitalId, tx) : execRecordPayment(params, hospitalId)
    case 'add_inventory_item': return tx ? execAddInventoryItem(params, hospitalId, tx) : execAddInventoryItem(params, hospitalId)
    case 'update_stock': return tx ? execUpdateStock(params, hospitalId, tx) : execUpdateStock(params, hospitalId)
    case 'create_lab_order': return tx ? execCreateLabOrder(params, hospitalId, tx) : execCreateLabOrder(params, hospitalId)
    case 'update_lab_order': return tx ? execUpdateLabOrder(params, hospitalId, tx) : execUpdateLabOrder(params, hospitalId)
    case 'create_prescription': return tx ? execCreatePrescription(params, hospitalId, tx) : execCreatePrescription(params, hospitalId)
    case 'add_medication': return tx ? execAddMedication(params, hospitalId, tx) : execAddMedication(params, hospitalId)
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Verification — "executor said success" is not the same as "it happened".
// Read the authoritative state back and check the expected change.
// ---------------------------------------------------------------------------

async function verifyAction(action: string, result: any, hospitalId: string): Promise<{ verified: boolean; detail: string }> {
  try {
    switch (action) {
      case 'record_payment': {
        if (!result?.paymentNo) return { verified: false, detail: 'no payment reference returned' }
        const payment = await prisma.payment.findFirst({ where: { paymentNo: result.paymentNo, hospitalId } })
        if (!payment) return { verified: false, detail: 'payment row not found' }
        const amountOk = result.amount === undefined || Number(payment.amount) === Number(result.amount)
        const ok = payment.hospitalId === hospitalId && payment.status === 'COMPLETED' && amountOk
        return { verified: ok, detail: `payment ${payment.paymentNo} status=${payment.status}` }
      }
      case 'create_invoice': {
        if (!result?.invoiceNo) return { verified: false, detail: 'no invoice reference returned' }
        const invoice = await prisma.invoice.findUnique({ where: { hospitalId, invoiceNo: result.invoiceNo } })
        if (!invoice) return { verified: false, detail: 'invoice row not found' }
        const ok = invoice.hospitalId === hospitalId && invoice.status === 'PENDING'
        return { verified: ok, detail: `invoice ${invoice.invoiceNo} status=${invoice.status}` }
      }
      case 'book_appointment': {
        if (!result?.appointmentNo) return { verified: false, detail: 'no appointment reference returned' }
        const appt = await prisma.appointment.findUnique({ where: { hospitalId, appointmentNo: result.appointmentNo } })
        if (!appt) return { verified: false, detail: 'appointment row not found' }
        const ok = appt.hospitalId === hospitalId && appt.status === 'SCHEDULED'
        return { verified: ok, detail: `appointment ${appt.appointmentNo} status=${appt.status}` }
      }
      case 'create_patient': {
        if (!result?.patientId) return { verified: false, detail: 'no patient reference returned' }
        const p = await prisma.patient.findUnique({ where: { hospitalId, patientId: result.patientId } })
        const ok = Boolean(p && p.hospitalId === hospitalId)
        return { verified: ok, detail: `patient ${result.patientId} ${ok ? 'exists' : 'missing'}` }
      }
      case 'create_treatment': {
        if (!result?.treatmentNo) return { verified: false, detail: 'no treatment reference returned' }
        const t = await prisma.treatment.findUnique({ where: { hospitalId, treatmentNo: result.treatmentNo } })
        if (!t) return { verified: false, detail: 'treatment row not found' }
        const ok = t.hospitalId === hospitalId && t.status === 'IN_PROGRESS'
        return { verified: ok, detail: `treatment ${t.treatmentNo} status=${t.status}` }
      }
      case 'create_prescription': {
        if (!result?.prescriptionNo) return { verified: false, detail: 'no prescription reference returned' }
        const rx = await prisma.prescription.findUnique({ where: { hospitalId, prescriptionNo: result.prescriptionNo } })
        if (!rx) return { verified: false, detail: 'prescription row not found' }
        // AI-created prescriptions must remain DRAFT — never authoritative.
        const ok = rx.hospitalId === hospitalId && rx.status === 'DRAFT'
        return { verified: ok, detail: `prescription ${rx.prescriptionNo} status=${rx.status}` }
      }
      case 'update_stock': {
        if (!result?.itemName) return { verified: false, detail: 'no item reference returned' }
        const item = await prisma.inventoryItem.findFirst({ where: { hospitalId, name: { contains: result.itemName } } })
        if (!item) return { verified: false, detail: 'inventory item not found' }
        const ok = result.newStock === undefined || item.currentStock === Number(result.newStock)
        return { verified: ok, detail: `stock ${item.name}=${item.currentStock}` }
      }
      case 'create_lab_order': {
        if (!result?.orderNumber) return { verified: false, detail: 'no lab order reference returned' }
        const o = await prisma.labOrder.findUnique({ where: { hospitalId, orderNumber: result.orderNumber } })
        if (!o) return { verified: false, detail: 'lab order row not found' }
        const ok = o.hospitalId === hospitalId && o.status === 'CREATED'
        return { verified: ok, detail: `lab order ${o.orderNumber} status=${o.status}` }
      }
      default:
        return { verified: true, detail: 'trusted executor result (no read-back defined)' }
    }
  } catch (err) {
    return { verified: false, detail: `verification query failed: ${err instanceof Error ? err.message : 'unknown'}` }
  }
}

// ---------------------------------------------------------------------------
// Audit — one AuditLog row per sensitive action (redacted: ids, amounts,
// status — no free-text PHI, no secrets, no prompts).
// ---------------------------------------------------------------------------

async function writeActionAudit(args: {
  hospitalId: string
  actorId: string
  ledgerId: string
  policy: ActionPolicy
  actorRole: string
  fingerprint: string
  status: string
  verified?: boolean
  amount?: number | null
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        hospitalId: args.hospitalId,
        userId: args.actorId,
        action: `AI_${args.policy.action.toUpperCase()}`,
        entityType: 'AIAction',
        entityId: args.ledgerId,
        oldValues: JSON.stringify({
          policyVersion: POLICY_VERSION,
          riskLevel: args.policy.riskLevel,
          role: args.actorRole,
          fingerprint: args.fingerprint,
          approvalRequired: args.policy.approvalRequired,
        }),
        newValues: JSON.stringify({
          status: args.status,
          verified: args.verified ?? null,
          amount: args.amount ?? null,
        }),
      },
    })
  } catch (err) {
    // The ledger row (created pre-execution) is the durable safety record;
    // an AuditLog failure after execution is surfaced, not hidden.
    console.error('AI action audit write failed:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export interface RunAiActionArgs {
  action: string
  params: Record<string, string>
  actor: Actor
  hospitalId: string
  conversationId?: string | null
  requestReason?: string
}

/**
 * The single entry point for AI-driven actions. Replaces direct
 * `executeIntent` calls in the routes.
 */
export async function runAiAction(args: RunAiActionArgs): Promise<AiActionResult> {
  const { action, params, actor, hospitalId, conversationId, requestReason } = args
  const normalized = (params ?? {}) as Record<string, string>

  // 1 — Resolve action policy. Unknown action → fail closed.
  const policy = resolvePolicy(action)
  if (!policy) return block('UNKNOWN_ACTION', MSG.unknownAction)

  // 2 — RBAC (server-side; the LLM's self-reported role is ignored).
  if (!policy.roles.includes(actor.role)) return block('RBAC_DENIED', MSG.notPermittedRole)

  // 3 — Input validation (malformed input never reaches the DB).
  const invalid = policy.validate(normalized)
  if (invalid) return block('INVALID_PARAMS', invalid)

  const sensitive = policy.riskLevel !== 'READ'

  // 4 — Ledger availability: sensitive actions fail closed without it.
  if (sensitive && !ledgerAvailable()) return block('LEDGER_UNAVAILABLE', MSG.ledgerUnavailable)

  // 5 — Patient scope (tenant-resolved, bound into the fingerprint).
  let patientId: string | null = null
  if (policy.patientScope) {
    patientId = await resolvePatientForAction(policy, normalized, hospitalId)
    if (!patientId) return block('PATIENT_NOT_FOUND', MSG.patientNotFound)
  }

  // 6 — Financial pre-read + guardrail settings (fail closed if unknown).
  let amount: number | null = null
  let needsApproval = policy.approvalRequired
  if (policy.riskLevel === 'FINANCIAL') {
    amount = await resolveFinancialAmount(policy, normalized, hospitalId, patientId)
    if (amount === null) return block('FINANCIAL_PREP_FAILED', MSG.executionFailed)
    const { limit, budget } = await financialSettings(hospitalId)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const spent = await monthFinancialTotal(hospitalId, monthStart)
    const overLimit = limit === null || amount > limit
    const overBudget = budget !== null && spent + amount > budget
    // Missing limit setting → fail closed (approval required). The policy's
    // own approvalRequired is a FLOOR (e.g. create_invoice always needs a
    // human); the financial guardrails add approval on top of it.
    needsApproval = policy.approvalRequired || overLimit || overBudget
  }

  // 7 — Fingerprint (tenant + action + patient + policy version + params).
  const fingerprint = computeFingerprint(hospitalId, policy.action, patientId, POLICY_VERSION, normalized)

  // 8 — Approval gate (durable, bound to the exact validated request).
  // READ actions skip the ledger entirely (zero DB overhead per read).
  let ledgerId: string | null = null
  if (sensitive) {
    ledgerId = await createActionRequest({
      hospitalId,
      requestedById: actor.id,
      conversationId,
      patientId,
      action: policy.action,
      params: normalized,
      fingerprint,
      riskLevel: policy.riskLevel,
      amount,
      requiresApproval: needsApproval,
      policyVersion: POLICY_VERSION,
      requestReason,
    })

    if (needsApproval) {
      // No execution — the request is durable and waiting for an approver.
      await writeActionAudit({
        hospitalId, actorId: actor.id, ledgerId: ledgerId!, policy, actorRole: actor.role, fingerprint,
        status: 'PENDING_APPROVAL', amount,
      })
      return {
        status: 'APPROVAL_REQUIRED',
        success: false,
        message: MSG.pendingApproval,
        approvalId: ledgerId!,
      }
    }

    // 9 — Idempotency (same validated request inside the safety window).
    // Excludes this request's own row (it is PENDING and would match itself).
    const dup = await findDuplicateRequest(hospitalId, fingerprint, ledgerId)
    if (dup.blocked) {
      await markBlocked(ledgerId!, 'DUPLICATE')
      await writeActionAudit({
        hospitalId, actorId: actor.id, ledgerId: ledgerId!, policy, actorRole: actor.role, fingerprint,
        status: 'BLOCKED_DUPLICATE', amount,
      })
      return block('DUPLICATE', MSG.duplicate, ledgerId!)
    }
  }

  // 10 — Execute (transactional when the policy says so).
  let result: any
  try {
    result = policy.transactionRequired
      ? await prisma.$transaction(async (tx: any) => dispatchExecutor(policy.action, normalized, hospitalId, tx))
      : await dispatchExecutor(policy.action, normalized, hospitalId)
  } catch (err) {
    if (sensitive) {
      await markExecutionError(ledgerId!, err instanceof Error ? err.message : 'executor threw')
      await writeActionAudit({
        hospitalId, actorId: actor.id, ledgerId: ledgerId!, policy, actorRole: actor.role, fingerprint,
        status: 'EXECUTION_ERROR', amount,
      })
    }
    return block('EXECUTION_ERROR', MSG.executionFailed, ledgerId ?? undefined)
  }

  if (result === null) {
    if (sensitive) await markBlocked(ledgerId!, 'UNKNOWN_EXECUTOR')
    return block('UNKNOWN_EXECUTOR', MSG.unknownAction, ledgerId ?? undefined)
  }

  // 11 — Verification (read the authoritative state back).
  const verification = sensitive ? await verifyAction(policy.action, result, hospitalId) : undefined

  // 12 — Audit + ledger completion (atomic PENDING/APPROVED → EXECUTED).
  // READ actions: no ledger row, no audit row (auditRequired: false).
  if (sensitive) {
    await writeActionAudit({
      hospitalId, actorId: actor.id, ledgerId: ledgerId!, policy, actorRole: actor.role, fingerprint,
      status: result?.success ? 'EXECUTED' : 'EXECUTED_BUSINESS_FAILED', verified: verification?.verified, amount,
    })
    const completed = await markExecuted(
      ledgerId!,
      { ...(typeof result === 'object' && result ? result : { result }), ...(verification ? { verification } : {}) }
    )
    if (!completed) {
      // The atomic transition lost (e.g. concurrently cancelled) — fail closed.
      return block('STATE_RACE', MSG.executionFailed, ledgerId!)
    }
  }

  return {
    status: 'EXECUTED',
    success: Boolean(result?.success),
    message: (result as any)?.message ?? MSG.blocked,
    approvalId: ledgerId ?? undefined,
    result,
    verification,
  }
}

// ---------------------------------------------------------------------------
// Approval decision + execution (used by /api/ai/approvals/[id])
// ---------------------------------------------------------------------------

export type ApprovalDecisionOutcome =
  | { ok: true; result: AiActionResult }
  | { ok: false; code: string; message: string }

/**
 * Approve (if PENDING) then execute an approved request. The parameters come
 * from the STORED row — never from the caller.
 */
export async function approveAndExecute(args: {
  approvalId: string
  actor: Actor & { hospitalId: string }
  approvalRoles: string[]
  note?: string
  /** 'execute' = re-run an already-APPROVED row (retry after a failed run). */
  mode: 'approve' | 'execute'
}): Promise<ApprovalDecisionOutcome> {
  const { approvalId, actor, approvalRoles, note, mode } = args

  const row = (await findApprovalForTenant(approvalId, actor.hospitalId)) as (LedgerRow & { requestedBy?: unknown }) | null
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Approval not found' }

  const policy = resolvePolicy(row.action)
  if (!policy) return { ok: false, code: 'UNKNOWN_ACTION', message: MSG.unknownAction }

  if (mode === 'approve') {
    if (!approvalRoles.includes(actor.role))
      return { ok: false, code: 'NOT_APPROVER', message: 'You do not have permission to approve this request' }
    const decision = await approveApproval(approvalId, { id: actor.id, hospitalId: actor.hospitalId }, note)
    if (!decision.ok) {
      const message =
        decision.code === 'EXPIRED' ? 'This approval has expired'
        : decision.code === 'SELF_APPROVAL' ? 'An approver cannot approve their own request'
        : decision.code === 'ALREADY_EXECUTED' ? 'This approval has already been executed'
        : decision.code === 'WRONG_TENANT' ? 'Approval not found'
        : 'This approval is no longer pending'
      return { ok: false, code: decision.code, message }
    }
  } else {
    // 'execute' on an APPROVED row: the caller (approver) re-runs after a
    // failed attempt. PENDING rows cannot be executed directly.
    if (row.status === 'EXPIRED') return { ok: false, code: 'EXPIRED', message: 'This approval has expired' }
    if (row.status !== 'APPROVED')
      return { ok: false, code: 'NOT_PENDING', message: 'This approval is no longer pending' }
    if (!approvalRoles.includes(actor.role) && actor.id !== row.requestedById)
      return { ok: false, code: 'NOT_APPROVER', message: 'You do not have permission to approve this request' }
  }

  // Fingerprint integrity: the stored row must still bind to exactly what it
  // claims (tamper detection).
  const fp = computeFingerprint(row.hospitalId, row.action, row.patientId, row.policyVersion, row.params)
  if (fp !== row.fingerprint) return { ok: false, code: 'FINGERPRINT_MISMATCH', message: MSG.executionFailed }

  // Re-authorize the ORIGINAL requester under the CURRENT policy (the actor's
  // role may have changed since the request).
  const requester = await prisma.user.findUnique({ where: { id: row.requestedById } })
  if (!requester || !policy.roles.includes(requester.role))
    return { ok: false, code: 'RBAC_DENIED', message: MSG.notPermittedRole }

  // Idempotency: never execute the same validated request twice in the window.
  // (Excludes this row itself.)
  const dup = await findDuplicateRequest(row.hospitalId, row.fingerprint, row.id)
  if (dup.blocked) return { ok: false, code: 'DUPLICATE', message: MSG.duplicate }

  // Execute + verify + audit, exactly like the auto path.
  let result: any
  try {
    result = policy.transactionRequired
      ? await prisma.$transaction(async (tx: any) => dispatchExecutor(row.action, row.params, row.hospitalId, tx))
      : await dispatchExecutor(row.action, row.params, row.hospitalId)
  } catch (err) {
    await markExecutionError(row.id, err instanceof Error ? err.message : 'executor threw')
    return { ok: false, code: 'EXECUTION_ERROR', message: MSG.executionFailed }
  }
  if (result === null) return { ok: false, code: 'UNKNOWN_EXECUTOR', message: MSG.unknownAction }

  const verification = await verifyAction(row.action, result, row.hospitalId)
  await writeActionAudit({
    hospitalId: row.hospitalId,
    actorId: row.requestedById,
    ledgerId: row.id,
    policy,
    actorRole: requester.role,
    fingerprint: row.fingerprint,
    status: 'EXECUTED_AFTER_APPROVAL',
    verified: verification.verified,
    amount: row.amount ? Number(row.amount.toString()) : null,
  })
  const completed = await markExecuted(row.id, {
    ...(typeof result === 'object' && result ? result : { result }),
    verification,
  })
  if (!completed) return { ok: false, code: 'STATE_RACE', message: MSG.executionFailed }

  return {
    ok: true,
    result: {
      status: 'EXECUTED',
      success: Boolean(result?.success),
      message: (result as any)?.message ?? MSG.blocked,
      approvalId: row.id,
      result,
      verification,
    },
  }
}

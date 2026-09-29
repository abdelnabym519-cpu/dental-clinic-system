/**
 * Approval service + action ledger — Phase 1 (AI Guardrails & Action Safety).
 *
 * Durable state machine for AI-requested sensitive actions, stored in the
 * AIActionApproval table (one row per requested action — it doubles as the
 * execution/idempotency ledger for auto-executed sensitive actions).
 *
 * Integrity rules enforced here:
 *  - an approval binds to (tenant, actor, action, VALIDATED params, policy
 *    version) through `fingerprint`; params are canonicalized (sorted keys);
 *  - every transition is an ATOMIC `updateMany` with the expected current
 *    status in the WHERE clause → duplicate approvals, approval replays and
 *    state races are impossible;
 *  - execution always re-reads the stored validated params — a client can
 *    never supply or modify parameters at execute time;
 *  - expired, rejected, cancelled and already-executed rows can never
 *    execute;
 *  - the approver must differ from the requester and carry an
 *    approval-eligible role (checked by the caller against the policy).
 *
 * FAIL CLOSED: if the ledger is not available (migration not applied /
 * client not generated), every sensitive operation throws
 * AI_ACTION_LEDGER_UNAVAILABLE instead of executing.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export const APPROVAL_TTL_HOURS = 24
export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000

export class LedgerUnavailableError extends Error {
  constructor() {
    super('AI_ACTION_LEDGER_UNAVAILABLE')
    this.name = 'LedgerUnavailableError'
  }
}

// ---------------------------------------------------------------------------
// Delegate adapter — the generated Prisma client exposes `aIActionApproval`.
// In environments where the client has not been regenerated for the Phase 1
// migration yet, the delegate is absent; we fail closed instead of executing
// sensitive actions against nothing.
// ---------------------------------------------------------------------------

export interface LedgerRow {
  id: string
  hospitalId: string
  requestedById: string
  conversationId: string | null
  patientId: string | null
  action: string
  params: Record<string, string>
  fingerprint: string
  riskLevel: string
  amount: { toString: () => string } | null
  requiresApproval: boolean
  policyVersion: number
  status: string
  blockReason: string | null
  requestReason: string | null
  expiresAt: Date
  approvedById: string | null
  approvedAt: Date | null
  decidedNote: string | null
  executedAt: Date | null
  result: any
  error: string | null
  createdAt: Date
}

type LedgerDelegate = {
  create: (args: { data: any }) => Promise<any>
  findUnique: (args: { where: { id: string } }) => Promise<any | null>
  findFirst: (args: any) => Promise<any | null>
  findMany: (args: any) => Promise<any[]>
  update: (args: { where: { id: string }; data: any }) => Promise<any>
  updateMany: (args: { where: any; data: any }) => Promise<{ count: number }>
}

function ledger(): LedgerDelegate {
  const d = (prisma as unknown as { aIActionApproval?: unknown }).aIActionApproval
  if (!d) throw new LedgerUnavailableError()
  return d as unknown as LedgerDelegate
}

export function ledgerAvailable(): boolean {
  return Boolean((prisma as unknown as { aIActionApproval?: unknown }).aIActionApproval)
}

// ---------------------------------------------------------------------------
// Fingerprint — the binding of an approval to the exact intended action.
// ---------------------------------------------------------------------------

/** Canonical JSON: sorted keys, string values only (validated params). */
export function canonicalizeParams(params: Record<string, string>): string {
  const out: Record<string, string> = {}
  for (const k of Object.keys(params).sort()) {
    const v = params[k]
    if (v !== undefined && v !== null) out[k] = String(v)
  }
  return JSON.stringify(out)
}

export function computeFingerprint(
  hospitalId: string,
  action: string,
  patientId: string | null,
  policyVersion: number,
  params: Record<string, string>
): string {
  return createHash('sha256')
    .update([hospitalId, action, patientId ?? '', String(policyVersion), canonicalizeParams(params)].join('|'))
    .digest('hex')
}

// ---------------------------------------------------------------------------
// Ledger operations
// ---------------------------------------------------------------------------

export interface NewActionRequest {
  hospitalId: string
  requestedById: string
  conversationId?: string | null
  patientId?: string | null
  action: string
  params: Record<string, string>
  fingerprint: string
  riskLevel: string
  amount?: number | null
  requiresApproval: boolean
  policyVersion: number
  requestReason?: string | null
  ttlHours?: number
}

/** Create a ledger row (status PENDING). Throws if the ledger is missing. */
export async function createActionRequest(req: NewActionRequest): Promise<string> {
  const row = await ledger().create({
    data: {
      hospitalId: req.hospitalId,
      requestedById: req.requestedById,
      conversationId: req.conversationId ?? null,
      patientId: req.patientId ?? null,
      action: req.action,
      params: req.params,
      fingerprint: req.fingerprint,
      riskLevel: req.riskLevel,
      amount: req.amount ?? null,
      requiresApproval: req.requiresApproval,
      policyVersion: req.policyVersion,
      status: 'PENDING',
      requestReason: req.requestReason ?? null,
      expiresAt: new Date(Date.now() + (req.ttlHours ?? APPROVAL_TTL_HOURS) * 3600 * 1000),
    },
  })
  return row.id
}

/**
 * Idempotency guard: a recent row with the same fingerprint means this exact
 * validated request was (or is) being executed. EXECUTED-with-success always
 * blocks; a fresh PENDING row (concurrent in-flight request) blocks too.
 */
export async function findDuplicateRequest(
  hospitalId: string,
  fingerprint: string,
  /** The current request's own row id — always excluded (else the request
   *  would match the PENDING row it just created and self-block). */
  excludeId?: string
): Promise<{ blocked: boolean; reason: 'SUCCESS' | 'IN_FLIGHT' | null; row: LedgerRow | null }> {
  const recent = await ledger().findFirst({
    where: {
      hospitalId,
      fingerprint,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      status: { in: ['EXECUTED', 'PENDING'] },
      createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!recent) return { blocked: false, reason: null, row: null }
  const r = recent as unknown as LedgerRow
  if (r.status === 'EXECUTED' && r.result?.success !== false) return { blocked: true, reason: 'SUCCESS', row: r }
  if (r.status === 'PENDING' && Date.now() - r.createdAt.getTime() < 5 * 60 * 1000)
    return { blocked: true, reason: 'IN_FLIGHT', row: r }
  return { blocked: false, reason: null, row: null }
}

async function fetchRow(id: string): Promise<LedgerRow | null> {
  const row = await ledger().findUnique({ where: { id } })
  return row ? (row as unknown as LedgerRow) : null
}

/** Lazy expiry: a PENDING row past expiresAt becomes EXPIRED (atomic). */
export async function enforceExpiry(row: LedgerRow): Promise<LedgerRow> {
  if (row.status === 'PENDING' && row.expiresAt.getTime() < Date.now()) {
    const r = await ledger().updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })
    if (r.count > 0) return { ...row, status: 'EXPIRED' }
  }
  return row
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type DecisionResult =
  | { ok: true; row: LedgerRow }
  | { ok: false; code: 'NOT_FOUND' | 'WRONG_TENANT' | 'NOT_PENDING' | 'EXPIRED' | 'NOT_APPROVER' | 'SELF_APPROVAL' | 'ALREADY_EXECUTED' | 'REJECTED' | 'CANCELLED' }

async function decide(
  id: string,
  actor: { id: string; hospitalId: string },
  toStatus: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  opts: { approver: boolean; note?: string }
): Promise<DecisionResult> {
  const row = await fetchRow(id)
  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (row.hospitalId !== actor.hospitalId) return { ok: false, code: 'WRONG_TENANT' }

  const fresh = await enforceExpiry(row)
  if (fresh.status === 'EXPIRED') return { ok: false, code: 'EXPIRED' }
  if (fresh.status === 'EXECUTED') return { ok: false, code: 'ALREADY_EXECUTED' }
  if (toStatus === 'CANCELLED') {
    if (actor.id !== fresh.requestedById) return { ok: false, code: 'NOT_APPROVER' }
    if (fresh.status !== 'PENDING') return { ok: false, code: 'NOT_PENDING' }
  } else {
    if (fresh.status !== 'PENDING') return { ok: false, code: 'NOT_PENDING' }
  }

  // Atomic transition — exactly one caller can win.
  const r = await ledger().updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: toStatus,
      approvedById: toStatus === 'CANCELLED' ? null : actor.id,
      approvedAt: toStatus === 'CANCELLED' ? null : new Date(),
      decidedNote: opts.note ?? null,
    },
  })
  if (r.count === 0) return { ok: false, code: 'NOT_PENDING' }

  const updated = await fetchRow(id)
  return { ok: true, row: updated! }
}

/** Approve — caller has already verified role eligibility + not-self. */
export async function approve(id: string, actor: { id: string; hospitalId: string }, note?: string): Promise<DecisionResult> {
  const row = await fetchRow(id)
  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (row.hospitalId !== actor.hospitalId) return { ok: false, code: 'WRONG_TENANT' }
  if (actor.id === row.requestedById) return { ok: false, code: 'SELF_APPROVAL' }
  return decide(id, actor, 'APPROVED', { approver: true, note })
}

export async function reject(id: string, actor: { id: string; hospitalId: string }, note?: string): Promise<DecisionResult> {
  const row = await fetchRow(id)
  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (row.hospitalId !== actor.hospitalId) return { ok: false, code: 'WRONG_TENANT' }
  if (actor.id === row.requestedById) return { ok: false, code: 'SELF_APPROVAL' }
  return decide(id, actor, 'REJECTED', { approver: true, note })
}

export async function cancel(id: string, actor: { id: string; hospitalId: string }): Promise<DecisionResult> {
  return decide(id, actor, 'CANCELLED', { approver: false })
}

// ---------------------------------------------------------------------------
// Execution completion
// ---------------------------------------------------------------------------

/**
 * Mark an executed action. Only PENDING (auto-executed, still in flight) or
 * APPROVED rows may transition to EXECUTED — an atomic guard against replay.
 */
export async function markExecuted(id: string, result: unknown): Promise<boolean> {
  const r = await ledger().updateMany({
    where: { id, status: { in: ['PENDING', 'APPROVED'] } },
    data: { status: 'EXECUTED', executedAt: new Date(), result, error: null },
  })
  return r.count > 0
}

export async function markBlocked(id: string, reason: string): Promise<boolean> {
  const r = await ledger().updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'BLOCKED', blockReason: reason },
  })
  return r.count > 0
}

/** Record a failed execution attempt (stays APPROVED/PENDING for retry). */
export async function markExecutionError(id: string, error: string): Promise<void> {
  await ledger().updateMany({
    where: { id, status: { in: ['PENDING', 'APPROVED'] } },
    data: { error },
  })
}

/** Fetch a row for the UI, scoped to a tenant. */
export async function findApprovalForTenant(id: string, hospitalId: string): Promise<LedgerRow | null> {
  const row = await fetchRow(id)
  if (!row || row.hospitalId !== hospitalId) return null
  return enforceExpiry(row)
}

export async function listApprovalsForTenant(hospitalId: string): Promise<LedgerRow[]> {
  const pending = await ledger().findMany({
    where: { hospitalId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const decided = await ledger().findMany({
    where: { hospitalId, status: { in: ['EXECUTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'BLOCKED'] }, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const all = [...(pending as LedgerRow[]), ...(decided as LedgerRow[])]
  // Lazily expire stale PENDING rows (fire and forget — list stays readable)
  for (const row of all) if (row.status === 'PENDING' && row.expiresAt.getTime() < Date.now()) void enforceExpiry(row)
  return all
}

/** Sum of EXECUTED financial amounts this calendar month (budget check). */
export async function monthFinancialTotal(hospitalId: string, since: Date): Promise<number> {
  const rows = (await ledger().findMany({
    where: { hospitalId, riskLevel: 'FINANCIAL', status: 'EXECUTED', executedAt: { gte: since } },
    select: { amount: true, result: true },
  })) as { amount: { toString: () => string } | null; result: any }[]
  return rows.reduce((sum, r) => (r.result?.success !== false && r.amount ? sum + Number(r.amount.toString()) : sum), 0)
}

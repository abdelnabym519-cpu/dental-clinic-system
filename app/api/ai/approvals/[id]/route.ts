import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import {
  reject as rejectApproval,
  cancel as cancelApproval,
  findApprovalForTenant,
} from '@/lib/ai/approvals'
import { approveAndExecute } from '@/lib/ai/action-pipeline'
import { resolvePolicy } from '@/lib/ai/action-policy'

type Decision = 'approve' | 'reject' | 'cancel' | 'execute'

const VALID_DECISIONS: Decision[] = ['approve', 'reject', 'cancel', 'execute']

/**
 * POST /api/ai/approvals/[id] — Phase 1 approval decisions.
 *
 *   { decision: 'approve' }  — approver (policy approvalRoles, ≠ requester)
 *   { decision: 'execute' }  — approver re-runs an APPROVED request
 *   { decision: 'reject' }   — approver
 *   { decision: 'cancel' }   — the original requester
 *
 * The parameters of the action come from the STORED ledger row — the client
 * can never attach or modify them here. All error strings are dictionary
 * keys (i18n).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { decision?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const decision = body.decision as Decision
  if (!VALID_DECISIONS.includes(decision)) {
    return NextResponse.json({ error: 'The requested decision is not valid' }, { status: 400 })
  }

  const { id } = await params
  const row = await findApprovalForTenant(id, hospitalId)
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

  const policy = resolvePolicy(row.action)
  if (!policy) return NextResponse.json({ error: 'This action is not permitted' }, { status: 400 })

  const actor = { id: user.id, name: user.name || 'User', role: user.role, hospitalId }

  // ── Cancel: the requester withdraws their own pending request ───────────
  if (decision === 'cancel') {
    const res = await cancelApproval(id, actor)
    if (!res.ok) {
      const message =
        res.code === 'NOT_PENDING' ? 'This approval is no longer pending'
        : res.code === 'EXPIRED' ? 'This approval has expired'
        : 'You do not have permission to approve this request'
      const status = res.code === 'NOT_PENDING' || res.code === 'EXPIRED' ? 409 : 403
      return NextResponse.json({ error: message }, { status })
    }
    return NextResponse.json({ status: 'CANCELLED', id })
  }

  // ── Reject: an approver denies the request ──────────────────────────────
  if (decision === 'reject') {
    if (!policy.approvalRoles.includes(user.role)) {
      return NextResponse.json(
        { error: 'You do not have permission to approve this request' },
        { status: 403 }
      )
    }
    const res = await rejectApproval(id, actor, body.note)
    if (!res.ok) {
      const message =
        res.code === 'EXPIRED' ? 'This approval has expired'
        : res.code === 'SELF_APPROVAL' ? 'An approver cannot approve their own request'
        : 'This approval is no longer pending'
      const status = res.code === 'SELF_APPROVAL' ? 403 : 409
      return NextResponse.json({ error: message }, { status })
    }
    return NextResponse.json({ status: 'REJECTED', id })
  }

  // ── Approve (then execute) / Execute (retry an approved row) ────────────
  const outcome = await approveAndExecute({
    approvalId: id,
    actor,
    approvalRoles: policy.approvalRoles,
    note: body.note,
    mode: decision === 'approve' ? 'approve' : 'execute',
  })

  if (!outcome.ok) {
    const map: Record<string, { message: string; status: number }> = {
      NOT_FOUND: { message: 'Approval not found', status: 404 },
      WRONG_TENANT: { message: 'Approval not found', status: 404 },
      NOT_APPROVER: { message: 'You do not have permission to approve this request', status: 403 },
      SELF_APPROVAL: { message: 'An approver cannot approve their own request', status: 403 },
      RBAC_DENIED: { message: 'This action is not permitted for your role', status: 403 },
      EXPIRED: { message: 'This approval has expired', status: 409 },
      NOT_PENDING: { message: 'This approval is no longer pending', status: 409 },
      ALREADY_EXECUTED: { message: 'This approval has already been executed', status: 409 },
      STATE_RACE: { message: 'This approval is no longer pending', status: 409 },
      FINGERPRINT_MISMATCH: { message: 'The action could not be executed safely', status: 409 },
      DUPLICATE: { message: 'Duplicate action within the safety window', status: 409 },
      UNKNOWN_ACTION: { message: 'This action is not permitted', status: 400 },
      UNKNOWN_EXECUTOR: { message: 'This action is not permitted', status: 400 },
      EXECUTION_ERROR: { message: 'The action could not be executed safely', status: 502 },
    }
    const m = map[outcome.code] ?? { message: 'The action could not be executed safely', status: 500 }
    return NextResponse.json({ error: m.message, code: outcome.code }, { status: m.status })
  }

  return NextResponse.json({
    status: 'EXECUTED',
    id,
    success: outcome.result.success,
    message: outcome.result.message,
    verification: outcome.result.verification,
    result: outcome.result.result,
  })
}

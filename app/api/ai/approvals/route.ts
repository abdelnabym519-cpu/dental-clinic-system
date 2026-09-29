import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { listApprovalsForTenant } from '@/lib/ai/approvals'
import { resolvePolicy } from '@/lib/ai/action-policy'

/**
 * GET /api/ai/approvals — Phase 1 approval dashboard data.
 *
 * Returns the tenant's pending AI action requests plus recently decided
 * ones. Every field is tenant-scoped by the authenticated session's
 * hospitalId — the client cannot list another clinic's requests.
 */
export async function GET(req: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await listApprovalsForTenant(hospitalId)

    const ids = [...new Set(rows.map((r) => r.requestedById))]
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : []
    const names: Record<string, string | null> = {}
    for (const u of users) names[u.id] = u.name

    const patients: Record<string, { firstName: string; lastName: string } | null> = {}
    const patientIds = [...new Set(rows.map((r) => r.patientId).filter(Boolean))] as string[]
    if (patientIds.length) {
      const ps = await prisma.patient.findMany({
        where: { id: { in: patientIds }, hospitalId },
        select: { id: true, firstName: true, lastName: true },
      })
      for (const p of ps) patients[p.id] = p
    }

    return NextResponse.json({
      approvals: rows.map((r) => {
        const policy = resolvePolicy(r.action)
        const pending = r.status === 'PENDING'
        return {
          id: r.id,
          action: r.action,
          params: r.params,
          riskLevel: r.riskLevel,
          amount: r.amount ? Number(r.amount.toString()) : null,
          status: r.status,
          requestReason: r.requestReason,
          blockReason: r.blockReason,
          patient: r.patientId ? patients[r.patientId] ?? null : null,
          requestedById: r.requestedById,
          requestedByName: names[r.requestedById] ?? null,
          requestedAt: r.createdAt,
          expiresAt: r.expiresAt,
          approvedById: r.approvedById,
          approvedAt: r.approvedAt,
          executedAt: r.executedAt,
          result: r.result,
          error: r.error,
          // Client-side affordances (server re-checks everything on POST).
          canApprove:
            pending && (policy?.approvalRoles ?? []).includes(user.role) && user.id !== r.requestedById,
          canReject:
            pending && (policy?.approvalRoles ?? []).includes(user.role) && user.id !== r.requestedById,
          canCancel: pending && user.id === r.requestedById,
          canExecute:
            r.status === 'APPROVED' &&
            ((policy?.approvalRoles ?? []).includes(user.role) || user.id === r.requestedById),
          approvalRoles: policy?.approvalRoles ?? [],
        }
      }),
    })
  } catch (err) {
    console.error('list AI approvals failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'AI action safety layer is not available' },
      { status: 503 }
    )
  }
}

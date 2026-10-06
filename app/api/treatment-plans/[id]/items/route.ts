import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * POST /api/treatment-plans/[id]/items (Phase 11) — add a procedure item to
 * a plan. DOCTOR/ADMIN. The procedure must exist in the tenant's catalog
 * (the repo's TreatmentPlanItem design links to Procedure, not free text).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, user } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const plan = await prisma.treatmentPlan.findFirst({ where: { id, hospitalId } })
    if (!plan) {
      return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
    }
    if (plan.status === 'COMPLETED' || plan.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Completed or cancelled plans cannot accept new items' },
        { status: 409 }
      )
    }

    const body = await request.json()
    const { procedureId, toothNumbers, priority, estimatedCost, status, notes } = body

    if (!procedureId) {
      return NextResponse.json({ error: 'procedureId is required' }, { status: 400 })
    }
    const procedure = await prisma.procedure.findFirst({
      where: { id: procedureId, hospitalId },
      select: { id: true, basePrice: true, defaultDuration: true },
    })
    if (!procedure) {
      return NextResponse.json({ error: 'Procedure not found' }, { status: 404 })
    }
    // The estimatedCost column is NOT NULL — a null cost used to crash the
    // create with a raw Prisma 500. The certified Phase-11 contract is that a
    // procedure item created without an explicit cost is priced from the
    // procedure catalog (basePrice) — the fallback the plan totals already use.
    const explicitCost = estimatedCost === undefined || estimatedCost === null ? null : Number(estimatedCost)
    if (explicitCost !== null && (Number.isNaN(explicitCost) || explicitCost < 0)) {
      return NextResponse.json({ error: 'التكلفة المقدرة يجب أن تكون رقمًا غير سالب' }, { status: 400 })
    }
    if (explicitCost !== null && explicitCost > 99999999.99) {
      return NextResponse.json({ error: 'التكلفة المقدرة أكبر من الحد المسموح' }, { status: 400 })
    }
    const cost = explicitCost ?? Number(procedure.basePrice)

    const item = await prisma.treatmentPlanItem.create({
      data: {
        treatmentPlanId: plan.id,
        procedureId,
        toothNumbers: toothNumbers ?? null,
        priority: typeof priority === 'number' ? priority : 1,
        estimatedCost: cost,
        status: status ?? 'PENDING',
        notes: notes ?? null,
      },
      include: { procedure: { select: { id: true, code: true, name: true, category: true } } },
    })
  // Audit trail (master spec Stage K) — procedures assigned from the
  // dental chart (or anywhere) are audited with tooth linkage.
  await prisma.auditLog.create({
    data: {
      hospitalId,
      userId: user.id,
      action: 'PROCEDURE_ASSIGNED',
      entityType: 'TreatmentPlanItem',
      entityId: item.id,
      newValues: JSON.stringify({
        treatmentPlanId: item.treatmentPlanId,
        procedureId: item.procedureId,
        toothNumbers: item.toothNumbers,
        status: item.status,
        estimatedCost: String(item.estimatedCost),
      }),
    },
  })

return NextResponse.json({ success: true, data: item }, { status: 201 })
  } catch (err: unknown) {
    console.error('Error adding treatment plan item:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to add treatment plan item' },
      { status: 500 }
    )
  }
}

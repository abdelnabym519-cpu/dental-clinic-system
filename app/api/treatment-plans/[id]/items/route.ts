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
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
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
    const cost = estimatedCost === undefined || estimatedCost === null ? null : Number(estimatedCost)
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) {
      return NextResponse.json({ error: 'estimatedCost must be >= 0' }, { status: 400 })
    }

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

    // Keep the plan totals in sync (same rule as the legacy PUT: an item
    // without its own cost falls back to the procedure's base price).
    const allItems = await prisma.treatmentPlanItem.findMany({
      where: { treatmentPlanId: plan.id },
      include: { procedure: { select: { basePrice: true, defaultDuration: true } } },
    })
    let totalCost = 0
    let totalDuration = 0
    for (const it of allItems) {
      totalCost += Number(it.estimatedCost) > 0 ? Number(it.estimatedCost) : Number(it.procedure.basePrice) || 0
      totalDuration += Number(it.procedure.defaultDuration) || 0
    }
    await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: { estimatedCost: totalCost, estimatedDuration: totalDuration },
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

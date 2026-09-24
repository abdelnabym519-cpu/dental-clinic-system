import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * PATCH /api/treatment-plans/[id]/items/[itemId] (Phase 11) — update a plan
 * item (status toggle is the main use case: the panel's "complete" button).
 * DOCTOR/ADMIN. Item must belong to a plan in the same tenant.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id, itemId } = await params
    const plan = await prisma.treatmentPlan.findFirst({ where: { id, hospitalId } })
    if (!plan) {
      return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 })
    }
    const item = await prisma.treatmentPlanItem.findFirst({
      where: { id: itemId, treatmentPlanId: plan.id },
    })
    if (!item) {
      return NextResponse.json({ error: 'Plan item not found' }, { status: 404 })
    }

    const body = await request.json()
    const data: Record<string, unknown> = {}

    if (body.status !== undefined) {
      const allowed = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
      if (!allowed.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid item status' }, { status: 400 })
      }
      data.status = body.status
    }
    if (body.toothNumbers !== undefined) data.toothNumbers = body.toothNumbers
    if (body.priority !== undefined && typeof body.priority === 'number') data.priority = body.priority
    if (body.estimatedCost !== undefined) {
      const cost = Number(body.estimatedCost)
      if (Number.isNaN(cost) || cost < 0) {
        return NextResponse.json({ error: 'estimatedCost must be >= 0' }, { status: 400 })
      }
      data.estimatedCost = cost
    }
    if (body.notes !== undefined) data.notes = body.notes

    const updated = await prisma.treatmentPlanItem.update({
      where: { id: item.id },
      data: data as never,
      include: { procedure: { select: { id: true, code: true, name: true, category: true } } },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (err: unknown) {
    console.error('Error updating treatment plan item:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update treatment plan item' },
      { status: 500 }
    )
  }
}

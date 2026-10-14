import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { isValidFdi } from '@/lib/dental-chart/fdi'

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
    // Clinical data integrity: toothNumbers is a Tooth REFERENCE. The chart
    // write path (POST /api/dental-chart) whitelists FDI numbers; this path
    // must not be the loophole that stores an unidentifiable tooth ("99",
    // "abc") in a clinical record. Accept the documented comma-separated
    // form, require every token to be a valid FDI number.
    let normalizedToothNumbers: string | null = null
    if (toothNumbers !== undefined && toothNumbers !== null && String(toothNumbers).trim() !== '') {
      const teeth: number[] = []
      for (const raw of String(toothNumbers).split(',')) {
        const t = raw.trim()
        if (t === '') continue // empty tokens (',,' / trailing commas) are noise, not data
        // STRICT integer check BEFORE parseInt: '16.5' / '16;17' / '16x' all
        // parseInt() to a valid-looking prefix — they must never enter a
        // clinical record. FDI numbers are unsigned digit strings, nothing else.
        if (!/^\d+$/.test(t) || !isValidFdi(Number.parseInt(t, 10))) {
          return NextResponse.json(
            { error: 'أرقام الأسنان غير صالحة — استخدم ترقيم FDI (11-18، 21-28، 31-38، 41-48)' },
            { status: 400 }
          )
        }
        const n = Number.parseInt(t, 10)
        if (!teeth.includes(n)) teeth.push(n) // duplicates normalize away
      }
      if (teeth.length === 0) {
        return NextResponse.json(
          { error: 'أرقام الأسنان غير صالحة — استخدم ترقيم FDI (11-18، 21-28، 31-38، 41-48)' },
          { status: 400 }
        )
      }
      normalizedToothNumbers = teeth.join(',')
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
        toothNumbers: normalizedToothNumbers,
        priority: typeof priority === 'number' ? priority : 1,
        estimatedCost: cost,
        status: status ?? 'PENDING',
        notes: notes ?? null,
      },
      include: { procedure: { select: { id: true, code: true, name: true, category: true } } },
    })

    // Audit trail (master spec Stage K) — procedures assigned from the
    // dental chart (or anywhere) are audited with tooth linkage. Ordered
    // AFTER the create and BEFORE the totals sync; a failed audit write
    // surfaces as 500 (the trail is never silently skipped).
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

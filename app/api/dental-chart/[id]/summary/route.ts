import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { deriveStatusMap, type ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'

/**
 * GET /api/dental-chart/:patientId/summary
 *
 * One aggregate payload for the Interactive Dental Chart workspace:
 * findings (Phase 3) + treatment-plan procedures (Phase 11) + imaging/AI
 * tooth findings (Phase 19-20, READ-ONLY) + derived per-tooth statuses.
 *
 * RBAC: view roles = ADMIN, DOCTOR, RECEPTIONIST (mutations stay in the
 * existing endpoints, restricted to DOCTOR/ADMIN with audit).
 * Tenant isolation: the patient must belong to the caller's hospital,
 * otherwise 404 (never 403 — does not leak existence across tenants).
 * No writes, no AI engine calls, no schema dependency beyond existing models.
 */

const VIEW_ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'SUPER_ADMIN']

interface RawAiFinding {
  toothNumber: number | null
  label: string
  confidence: number | null
}

/** Tolerant extraction of tooth findings from reviewed AI output (JSON shape varies by engine). */
export function extractToothFindings(acceptedFindings: unknown): RawAiFinding[] {
  if (!Array.isArray(acceptedFindings)) return []
  const out: RawAiFinding[] = []
  for (const item of acceptedFindings) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const rawTooth = rec.toothNumber ?? rec.tooth ?? rec.tooth_number
    const toothNumber =
      typeof rawTooth === 'number'
        ? rawTooth
        : typeof rawTooth === 'string'
          ? Number.parseInt(rawTooth, 10)
          : NaN
    if (!Number.isInteger(toothNumber) || toothNumber < 11 || toothNumber > 48) continue
    const label =
      (typeof rec.condition === 'string' && rec.condition) ||
      (typeof rec.finding === 'string' && rec.finding) ||
      (typeof rec.label === 'string' && rec.label) ||
      'FINDING'
    let confidence: number | null = null
    const rawConf = rec.confidence ?? rec.score ?? rec.probability
    if (typeof rawConf === 'number' && isFinite(rawConf)) {
      // engines report 0..1 or 0..100 — normalize to 0..1
      confidence = rawConf > 1 ? rawConf / 100 : rawConf
      if (confidence > 1) confidence = 1
    }
    out.push({ toothNumber, label, confidence })
  }
  return out
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requireAuthAndRole(VIEW_ROLES)
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Route slug is [id] (codebase convention, shared with [id]/route.ts);
  // the function body keeps the domain name `patientId`.
  const { id: patientId } = await ctx.params

  try {
    // Tenant isolation: cross-hospital access must be indistinguishable
    // from a missing patient.
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    const [entries, planItems, activePlan, studies] = await Promise.all([
      prisma.dentalChartEntry.findMany({
        where: { patientId, hospitalId },
        orderBy: { diagnosedDate: 'desc' },
      }),
      prisma.treatmentPlanItem.findMany({
        where: {
          status: { not: 'CANCELLED' },
          treatmentPlan: { patientId, hospitalId, status: { not: 'CANCELLED' } },
        },
        include: {
          procedure: { select: { name: true } },
          treatmentPlan: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.treatmentPlan.findFirst({
        where: { patientId, hospitalId, status: { in: ['DRAFT', 'PROPOSED', 'ACCEPTED', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      }),
      prisma.imagingStudy.findMany({
        where: { patientId, hospitalId },
        include: {
          aiJobs: {
            select: { id: true, status: true, acceptedFindings: true, completedAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])

    const imaging = studies.flatMap((study) =>
      study.aiJobs.flatMap((job) =>
        extractToothFindings(job.acceptedFindings).map((f) => ({
          toothNumber: f.toothNumber,
          studyId: study.id,
          studyDate: study.studyDate ? study.studyDate.toISOString() : null,
          modality: study.modality as string,
          label: f.label,
          confidence: f.confidence,
        }))
      )
    )

    // Canonical per-tooth statuses (same pure module the client uses).
    const entriesByTooth = new Map<number, typeof entries>()
    for (const e of entries) {
      const list = entriesByTooth.get(e.toothNumber) ?? []
      list.push(e)
      entriesByTooth.set(e.toothNumber, list)
    }
    const procsByTooth = new Map<number, { status: string }[]>()
    for (const item of planItems) {
      for (const tooth of parseToothList(item.toothNumbers)) {
        const list = procsByTooth.get(tooth) ?? []
        list.push({ status: item.status })
        procsByTooth.set(tooth, list)
      }
    }
    const statusByTooth: Record<number, ToothTreatmentStatus> = deriveStatusMap(entriesByTooth, procsByTooth)

    // Procedure catalog for the panel's "add procedure" selector (read-only).
    const catalog = await prisma.procedure.findMany({
      where: { hospitalId, isActive: true },
      select: { id: true, name: true, basePrice: true },
      orderBy: { name: 'asc' },
      take: 200,
    })

    return NextResponse.json({
      patient: { id: patient.id, name: `${patient.firstName} ${patient.lastName}`.trim() },
      entries,
      procedures: planItems.map((item) => ({
        id: item.id,
        procedureName: item.procedure.name,
        status: item.status,
        estimatedCost: String(item.estimatedCost),
        planId: item.treatmentPlan.id,
        toothNumbers: item.toothNumbers,
      })),
      activePlan,
      imaging,
      statusByTooth,
      catalog: catalog.map((c) => ({ id: c.id, name: c.name, basePrice: String(c.basePrice) })),
    })
  } catch (err) {
    console.error('[dental-chart-summary]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load dental chart summary' }, { status: 500 })
  }
}

/** TreatmentPlanItem.toothNumbers is a comma-separated FDI string (defensive parse). */
function parseToothList(value: string | null): number[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 11 && n <= 48)
}

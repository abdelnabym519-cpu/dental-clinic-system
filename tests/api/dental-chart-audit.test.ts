import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// Stage K — clinical mutation audit trail (master spec):
//   POST /api/dental-chart              → DENTAL_FINDING_ADDED
//   PATCH /api/dental-chart/[id]        → TOOTH_STATE_CHANGED (old+new)
//   DELETE /api/dental-chart/[id]       → TOOTH_STATE_CHANGED (deleted)
//   POST /api/treatment-plans/[id]/items → PROCEDURE_ASSIGNED (tooth linkage)
// Mutations stay DOCTOR/ADMIN-only (existing inline checks preserved).

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

const listModule = await import('@/app/api/dental-chart/route')
const detailModule = await import('@/app/api/dental-chart/[id]/route')
const itemsModule = await import('@/app/api/treatment-plans/[id]/items/route')

function post(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as any
}
function patch(url: string, body: unknown) {
  return new Request(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as any
}

const AUTHED = {
  error: null,
  hospitalId: 'hospital-1',
  user: { id: 'user-1', role: 'DOCTOR' },
  session: { user: { id: 'user-1', role: 'DOCTOR' } },
}

const ENTRY = {
  id: 'entry-1', hospitalId: 'hospital-1', patientId: 'patient-1', toothNumber: 16,
  toothNotation: '16', condition: 'CARIES', severity: 'MODERATE',
  mesial: false, distal: false, occlusal: true, buccal: false, lingual: false,
  notes: null, resolvedDate: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.requireAuthAndRole.mockResolvedValue(AUTHED)
})

describe('dental chart mutation audit trail', () => {
  it('POST finding → auditLog DENTAL_FINDING_ADDED with actor/tooth/change', async () => {
    ;(prisma.patient.findFirst as any).mockResolvedValue({ id: 'patient-1' })
    ;(prisma.dentalChartEntry.create as any).mockResolvedValue({ ...ENTRY })
    const res = await listModule.POST(
      post('http://localhost/api/dental-chart', {
        patientId: 'patient-1', toothNumber: 16, condition: 'CARIES', severity: 'MODERATE', occlusal: true,
      }),
      {} as any
    )
    expect(res.status).toBe(201)
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    const call = (prisma.auditLog.create as any).mock.calls[0][0]
    expect(call.data).toMatchObject({
      hospitalId: 'hospital-1',
      userId: 'user-1',
      action: 'DENTAL_FINDING_ADDED',
      entityType: 'DentalChartEntry',
      entityId: 'entry-1',
    })
    const recorded = JSON.parse(call.data.newValues)
    expect(recorded).toMatchObject({ patientId: 'patient-1', toothNumber: 16, condition: 'CARIES' })
  })

  it('PUT entry update → auditLog TOOTH_STATE_CHANGED with old AND new values', async () => {
    ;(prisma.dentalChartEntry.findFirst as any).mockResolvedValue({ ...ENTRY })
    ;(prisma.dentalChartEntry.update as any).mockResolvedValue({ ...ENTRY, severity: 'SEVERE' })
    const res = await detailModule.PUT(
      patch('http://localhost/api/dental-chart/entry-1', { severity: 'SEVERE' }),
      { params: Promise.resolve({ id: 'entry-1' }) } as any
    )
    expect(res.status).toBe(200)
    const call = (prisma.auditLog.create as any).mock.calls[0][0]
    expect(call.data.action).toBe('TOOTH_STATE_CHANGED')
    expect(JSON.parse(call.data.oldValues)).toMatchObject({ condition: 'CARIES', severity: 'MODERATE' })
    expect(JSON.parse(call.data.newValues)).toMatchObject({ severity: 'SEVERE' })
  })

  it('DELETE entry → auditLog TOOTH_STATE_CHANGED with deleted flag', async () => {
    ;(prisma.dentalChartEntry.findFirst as any).mockResolvedValue({ ...ENTRY })
    ;(prisma.dentalChartEntry.delete as any).mockResolvedValue({ ...ENTRY })
    const res = await detailModule.DELETE(
      new Request('http://localhost/api/dental-chart/entry-1', { method: 'DELETE' }) as any,
      { params: Promise.resolve({ id: 'entry-1' }) } as any
    )
    expect(res.status).toBe(200)
    const call = (prisma.auditLog.create as any).mock.calls[0][0]
    expect(call.data.action).toBe('TOOTH_STATE_CHANGED')
    expect(JSON.parse(call.data.newValues)).toMatchObject({ deleted: true, toothNumber: 16 })
  })

  it('POST treatment plan item → auditLog PROCEDURE_ASSIGNED with tooth linkage', async () => {
    ;(prisma.treatmentPlan.findFirst as any).mockResolvedValue({ id: 'plan-1', status: 'ACCEPTED' })
    ;(prisma.procedure.findFirst as any).mockResolvedValue({ id: 'proc-1', basePrice: '350.00', defaultDuration: 30 })
    ;(prisma.treatmentPlanItem.create as any).mockResolvedValue({
      id: 'item-9', treatmentPlanId: 'plan-1', procedureId: 'proc-1',
      toothNumbers: '16', estimatedCost: '350', status: 'PENDING',
      procedure: { id: 'proc-1', code: 'P1', name: 'حشو مركب', category: 'RESTORATIVE' },
    })
    // the golden Phase-11 totals-sync block runs after the audit write
    ;(prisma.treatmentPlanItem.findMany as any).mockResolvedValue([
      { estimatedCost: '350', procedure: { basePrice: '350.00', defaultDuration: 30 } },
    ])
    ;(prisma.treatmentPlan.update as any).mockResolvedValue({ id: 'plan-1' })
    const res = await itemsModule.POST(
      post('http://localhost/api/treatment-plans/plan-1/items', { procedureId: 'proc-1', toothNumbers: '16' }),
      { params: Promise.resolve({ id: 'plan-1' }) } as any
    )
    expect(res.status).toBe(201)
    const call = (prisma.auditLog.create as any).mock.calls[0][0]
    expect(call.data).toMatchObject({
      hospitalId: 'hospital-1',
      userId: 'user-1',
      action: 'PROCEDURE_ASSIGNED',
      entityType: 'TreatmentPlanItem',
      entityId: 'item-9',
    })
    expect(JSON.parse(call.data.newValues)).toMatchObject({ toothNumbers: '16', procedureId: 'proc-1' })
  })

  it('audit failures do NOT silently swallow the mutation (mutation already committed → 500 surfaces)', async () => {
    ;(prisma.patient.findFirst as any).mockResolvedValue({ id: 'patient-1' })
    ;(prisma.dentalChartEntry.create as any).mockResolvedValue({ ...ENTRY })
    ;(prisma.auditLog.create as any).mockRejectedValue(new Error('audit write failed'))
    const res = await listModule.POST(
      post('http://localhost/api/dental-chart', { patientId: 'patient-1', toothNumber: 16, condition: 'CARIES' }),
      {} as any
    )
    // honest semantics: if the audit trail cannot be written, the request fails
    expect(res.status).toBe(500)
  })
})

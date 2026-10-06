import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// Stage K — aggregate summary API: RBAC, tenant isolation, aggregation
// correctness, and tolerant read-only extraction of Phase 19-20 AI findings.

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

const summaryModule = await import('@/app/api/dental-chart/[id]/summary/route')

function makeRequest() {
  return new Request('http://localhost/api/dental-chart/patient-1/summary', { method: 'GET' }) as any
}
const ctx = { params: Promise.resolve({ patientId: 'patient-1' }) }

const ENTRY_16 = {
  id: 'e1', hospitalId: 'hospital-1', patientId: 'patient-1', toothNumber: 16,
  toothNotation: '16', condition: 'CARIES', severity: 'MODERATE',
  mesial: false, distal: false, occlusal: true, buccal: false, lingual: false,
  notes: null, diagnosedDate: new Date('2026-02-01'), resolvedDate: null,
}

const ITEM_16 = {
  id: 'item-1', treatmentPlanId: 'plan-1', procedureId: 'proc-1',
  toothNumbers: '16', priority: 1, estimatedCost: '350.00', status: 'PENDING',
  procedure: { name: 'حشو مركب' }, treatmentPlan: { id: 'plan-1', status: 'ACCEPTED' },
}

function setupPrisma(opts: {
  patient?: unknown
  entries?: unknown[]
  items?: unknown[]
  activePlan?: unknown
  studies?: unknown[]
  catalog?: unknown[]
} = {}) {
  ;(prisma.patient.findFirst as any).mockResolvedValue(
    'patient' in opts ? opts.patient : { id: 'patient-1', firstName: 'أحمد', lastName: 'محمد' }
  )
  ;(prisma.dentalChartEntry.findMany as any).mockResolvedValue(opts.entries ?? [ENTRY_16])
  ;(prisma.treatmentPlanItem.findMany as any).mockResolvedValue(opts.items ?? [ITEM_16])
  ;(prisma.treatmentPlan.findFirst as any).mockResolvedValue(opts.activePlan ?? { id: 'plan-1', status: 'ACCEPTED' })
  ;(prisma.imagingStudy.findMany as any).mockResolvedValue(opts.studies ?? [])
  ;(prisma.procedure.findMany as any).mockResolvedValue(opts.catalog ?? [])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null, hospitalId: 'hospital-1', user: { id: 'user-1', role: 'DOCTOR' }, session: { user: { id: 'user-1', role: 'DOCTOR' } },
  })
})

describe('GET /api/dental-chart/[id]/summary', () => {
  it('restricts view access to ADMIN/DOCTOR/RECEPTIONIST/SUPER_ADMIN (RBAC arg pinned)', async () => {
    setupPrisma()
    await summaryModule.GET(makeRequest(), ctx)
    expect(mockAuth.requireAuthAndRole).toHaveBeenCalledWith(['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'SUPER_ADMIN'])
  })

  it('returns 404 for a patient of ANOTHER hospital (tenant isolation, no existence leak)', async () => {
    setupPrisma({ patient: null })
    const res = await summaryModule.GET(makeRequest(), ctx)
    expect(res.status).toBe(404)
  })

  it('aggregates entries + procedures + active plan + catalog with derived statuses', async () => {
    setupPrisma({ catalog: [{ id: 'proc-1', name: 'حشو مركب', basePrice: '350.00' }] })
    const res = await summaryModule.GET(makeRequest(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.patient).toEqual({ id: 'patient-1', name: 'أحمد محمد' })
    expect(body.entries).toHaveLength(1)
    expect(body.procedures[0]).toMatchObject({ id: 'item-1', procedureName: 'حشو مركب', status: 'PENDING', toothNumbers: '16' })
    expect(body.activePlan).toEqual({ id: 'plan-1', status: 'ACCEPTED' })
    // canonical derivation runs server-side with the SAME pure module: 16 = planned
    expect(body.statusByTooth[16]).toBe('planned')
    expect(body.catalog[0].basePrice).toBe('350.00')
  })

  it('extracts tooth findings from reviewed AI jobs (Phase 19-20, read-only)', async () => {
    setupPrisma({
      studies: [
        {
          id: 'study-9', modality: 'PERIAPICAL', studyDate: new Date('2026-02-10'),
          aiJobs: [
            { id: 'job-1', status: 'COMPLETED', acceptedFindings: [{ toothNumber: 16, condition: 'CARIES', confidence: 0.92 }] },
            { id: 'job-2', status: 'COMPLETED', acceptedFindings: [{ tooth: 26, finding: 'IMPACTED', score: 88 }] },
          ],
        },
      ],
    })
    const res = await summaryModule.GET(makeRequest(), ctx)
    const body = await res.json()
    expect(body.imaging).toHaveLength(2)
    expect(body.imaging[0]).toMatchObject({ toothNumber: 16, studyId: 'study-9', label: 'CARIES', confidence: 0.92 })
    expect(body.imaging[1]).toMatchObject({ toothNumber: 26, label: 'IMPACTED', confidence: 0.88 })
  })

  it('tolerates hostile/malformed acceptedFindings JSON without throwing', async () => {
    setupPrisma({
      studies: [
        {
          id: 'study-x', modality: 'PANORAMIC', studyDate: null,
          aiJobs: [{ id: 'job-z', status: 'COMPLETED', acceptedFindings: [null, 'garbage', { toothNumber: 99, condition: 'X' }, { toothNumber: '16', confidence: 'n/a' }] }],
        },
      ],
    })
    const res = await summaryModule.GET(makeRequest(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    // only the valid tooth 16 survives; invalid confidence → null
    expect(body.imaging).toHaveLength(1)
    expect(body.imaging[0]).toMatchObject({ toothNumber: 16, confidence: null })
  })

  it('missing tooth linkage in AI findings is simply absent (never fabricated)', async () => {
    expect(summaryModule.extractToothFindings(undefined)).toEqual([])
    expect(summaryModule.extractToothFindings({ toothNumber: 16 })).toEqual([])
  })
})

// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))

const mockStorage = vi.hoisted(() => ({
  uploadUrl: (k: string | null | undefined) => (k ? `/api/uploads/${k}` : ''),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/storage', () => mockStorage)

const { GET } = await import('@/app/api/imaging/studies/[id]/status/route')

const HOSPITAL = 'hosp-1'

function mockAuthed() {
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    user: { id: 'user-1', role: 'DOCTOR' },
    hospitalId: HOSPITAL,
    session: { user: { id: 'user-1' } },
  })
}

function makeStudy(over = {}) {
  return {
    id: 'study-1',
    hospitalId: HOSPITAL,
    patientId: 'pat-1',
    modality: 'PANORAMIC',
    originalKey: 'hosp-1/imaging/pat-1/study-1/original.png',
    status: 'UPLOADED',
    studyDate: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    patient: { id: 'pat-1', patientId: 'P-001', firstName: 'Amina', lastName: 'Ali' },
    aiJobs: [],
    ...over,
  }
}

function makeJob(over = {}) {
  return {
    id: 'job-1',
    engine: 'liodon',
    status: 'COMPLETED',
    findings: [],
    confidence: null,
    provenance: null,
    reviewedAt: null,
    reviewDecision: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/imaging/studies/:id/status — auth & tenancy', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: { status: 401 },
      user: null,
      hospitalId: null,
    })
    const res = await GET(new NextRequest('http://localhost/api/imaging/studies/x/status'), {
      params: Promise.resolve({ id: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('forwards the RBAC error from requireAuthAndRole (ACCOUNTANT excluded)', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: { status: 403 },
      user: null,
      hospitalId: null,
    })
    const res = await GET(new NextRequest('http://localhost/api/imaging/studies/x/status'), {
      params: Promise.resolve({ id: 'x' }),
    })
    expect(res.status).toBe(403)
  })

  it('404 for a foreign/missing study (no tenant oracle)', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/imaging/studies/other/status'), {
      params: Promise.resolve({ id: 'other' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Study not found')
  })

  it('queries tenant-scoped (id + hospitalId)', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(makeStudy())
    await GET(new NextRequest('http://localhost/api/imaging/studies/study-1/status'), {
      params: Promise.resolve({ id: 'study-1' }),
    })
    expect(prisma.imagingStudy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'study-1', hospitalId: HOSPITAL },
      })
    )
  })
})

describe('GET /api/imaging/studies/:id/status — derived status', () => {
  async function getStatus(study) {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(study)
    const res = await GET(
      new NextRequest('http://localhost/api/imaging/studies/study-1/status'),
      { params: Promise.resolve({ id: 'study-1' }) }
    )
    expect(res.status).toBe(200)
    return res.json()
  }

  it('ANALYZED study → ANALYZED', async () => {
    const body = await getStatus(makeStudy({ status: 'ANALYZED' }))
    expect(body.status).toBe('ANALYZED')
    expect(body.study.status).toBe('ANALYZED')
  })

  it('REVIEWED study → REVIEWED', async () => {
    const body = await getStatus(makeStudy({ status: 'REVIEWED' }))
    expect(body.status).toBe('REVIEWED')
  })

  it('UPLOADED study + PENDING job → PROCESSING', async () => {
    const body = await getStatus(makeStudy({ aiJobs: [makeJob({ status: 'PENDING' })] }))
    expect(body.status).toBe('PROCESSING')
    expect(body.latestJob.status).toBe('PENDING')
  })

  it('UPLOADED study + PROCESSING job → PROCESSING', async () => {
    const body = await getStatus(makeStudy({ aiJobs: [makeJob({ status: 'PROCESSING' })] }))
    expect(body.status).toBe('PROCESSING')
  })

  it('UPLOADED study + no job → UPLOADED', async () => {
    const body = await getStatus(makeStudy())
    expect(body.status).toBe('UPLOADED')
    expect(body.latestJob).toBeNull()
  })
})

describe('GET /api/imaging/studies/:id/status — payload mapping', () => {
  it('maps originalUrl/annotatedUrl and latest job data', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(
      makeStudy({
        status: 'ANALYZED',
        aiJobs: [
          makeJob({
            findings: [
              { condition: 'caries', confidence: 0.63, bounding_box: { x: 1, y: 2, width: 3, height: 4, x2: 4, y2: 6 } },
            ],
            provenance: { annotated_image_key: 'hosp-1/imaging/pat-1/study-1/annotated.png' },
          }),
        ],
      })
    )
    const res = await GET(new NextRequest('http://localhost/api/imaging/studies/study-1/status'), {
      params: Promise.resolve({ id: 'study-1' }),
    })
    const body = await res.json()
    expect(body.study.originalUrl).toBe('/api/uploads/hosp-1/imaging/pat-1/study-1/original.png')
    expect(body.study.annotatedUrl).toBe('/api/uploads/hosp-1/imaging/pat-1/study-1/annotated.png')
    expect(body.latestJob.findings).toHaveLength(1)
    expect(body.latestJob.findings[0].condition).toBe('caries')
  })
})

// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))

const mockStorage = vi.hoisted(() => ({
  getStorage: vi.fn(() => ({ put: vi.fn() })),
  buildStorageKey: (h: string, ...rest: string[]) => [h, ...rest].join('/'),
  uploadUrl: (k: string | null | undefined) => (k ? `/api/uploads/${k}` : ''),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/storage', () => mockStorage)

const { GET } = await import('@/app/api/imaging/studies/route')

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
    modality: 'PANORAMIC',
    studyType: 'IMAGING',
    status: 'ANALYZED',
    createdAt: new Date('2026-09-01T09:00:00Z'),
    originalKey: 'hosp-1/imaging/pat-1/study-1/original.jpg',
    patient: { patientId: 'P-001', firstName: 'Amina', lastName: 'Ali' },
    aiJobs: [{ id: 'job-1', status: 'COMPLETED', engine: 'liodon', reviewedAt: null }],
    ...over,
  }
}

async function call(urlPath) {
  return GET(new NextRequest(urlPath))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/imaging/studies — Phase 20 filters (D7/D8)', () => {
  it('passes patientId into the tenant-scoped where clause', async () => {
    mockAuthed()
    prisma.imagingStudy.findMany.mockResolvedValue([makeStudy()])
    const res = await call('http://localhost/api/imaging/studies?patientId=pat-1')
    expect(res.status).toBe(200)
    expect(prisma.imagingStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hospitalId: HOSPITAL, patientId: 'pat-1' },
      })
    )
  })

  it('passes appointmentId into the where clause (appointment → imaging link)', async () => {
    mockAuthed()
    prisma.imagingStudy.findMany.mockResolvedValue([makeStudy()])
    await call('http://localhost/api/imaging/studies?appointmentId=appt-9')
    expect(prisma.imagingStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hospitalId: HOSPITAL, appointmentId: 'appt-9' },
      })
    )
  })

  it('combines patientId + appointmentId', async () => {
    mockAuthed()
    prisma.imagingStudy.findMany.mockResolvedValue([])
    await call('http://localhost/api/imaging/studies?patientId=pat-1&appointmentId=appt-9')
    expect(prisma.imagingStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hospitalId: HOSPITAL, patientId: 'pat-1', appointmentId: 'appt-9' },
      })
    )
  })

  it('ignores empty-string filters', async () => {
    mockAuthed()
    prisma.imagingStudy.findMany.mockResolvedValue([])
    await call('http://localhost/api/imaging/studies?patientId=&appointmentId=%20')
    expect(prisma.imagingStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hospitalId: HOSPITAL } })
    )
  })

  it('returns the hospital-wide list without filters (Phase 19A behavior intact)', async () => {
    mockAuthed()
    prisma.imagingStudy.findMany.mockResolvedValue([makeStudy(), makeStudy({ id: 'study-2' })])
    const res = await call('http://localhost/api/imaging/studies')
    const body = await res.json()
    expect(body.studies).toHaveLength(2)
    expect(body.studies[0].latestJob.status).toBe('COMPLETED')
  })

  it('exposes originalUrl (tenant-guarded /api/uploads path) on each item', async () => {
    mockAuthed()
    prisma.imagingStudy.findMany.mockResolvedValue([makeStudy()])
    const res = await call('http://localhost/api/imaging/studies?patientId=pat-1')
    const body = await res.json()
    expect(body.studies[0].originalUrl).toBe('/api/uploads/hosp-1/imaging/pat-1/study-1/original.jpg')
  })

  it('401 when unauthenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: { status: 401 }, user: null, hospitalId: null })
    const res = await call('http://localhost/api/imaging/studies')
    expect(res.status).toBe(401)
  })

  it('forwards the RBAC error (view roles only)', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: { status: 403 }, user: null, hospitalId: null })
    const res = await call('http://localhost/api/imaging/studies?patientId=pat-1')
    expect(res.status).toBe(403)
  })
})

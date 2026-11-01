// @ts-nocheck
/**
 * Tenant isolation for /api/dental-chart (R1a).
 *
 * The v2 chart reuses these existing routes, so their isolation is what keeps
 * patient data from leaking between hospitals. Every write path is gated on
 * `findFirst({ where: { id, hospitalId } })` / `{ patientId, hospitalId }`, which
 * means a record belonging to another hospital must be indistinguishable from a
 * record that does not exist: a 404, never a 200 and never a data-bearing error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// vi.mock factories are HOISTED above all top-level consts, so the shared mock
// objects must be created with vi.hoisted() or the factory hits a TDZ error.
const { state, prismaMock } = vi.hoisted(() => ({
  state: {
    hospitalId: 'hospital-A',
    role: 'DOCTOR' as string,
  },
  prismaMock: {
    patient: { findFirst: vi.fn() },
    dentalChartEntry: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(async () => ({
    error: null,
    hospitalId: state.hospitalId,
    session: { user: { role: state.role } },
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { GET, POST } from '@/app/api/dental-chart/route'
import { PUT, DELETE } from '@/app/api/dental-chart/[id]/route'

function req(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.hospitalId = 'hospital-A'
  state.role = 'DOCTOR'
  // Default: nothing in this hospital.
  prismaMock.patient.findFirst.mockResolvedValue(null)
  prismaMock.dentalChartEntry.findFirst.mockResolvedValue(null)
  prismaMock.dentalChartEntry.findMany.mockResolvedValue([])
  prismaMock.auditLog.create.mockResolvedValue({})
})

describe('POST /api/dental-chart — patient from another hospital', () => {
  it('returns 404 and writes nothing', async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null) // not in hospital-A
    const res = await POST(
      req('POST', 'http://localhost/api/dental-chart', {
        patientId: 'patient-B',
        toothNumber: 36,
        condition: 'CARIES',
      }),
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/Patient not found/i)
    expect(prismaMock.dentalChartEntry.create).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('scopes the patient lookup by BOTH id and hospitalId', async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await POST(
      req('POST', 'http://localhost/api/dental-chart', {
        patientId: 'patient-B',
        toothNumber: 36,
        condition: 'CARIES',
      }),
    )
    const where = prismaMock.patient.findFirst.mock.calls[0][0].where
    expect(where).toMatchObject({ id: 'patient-B', hospitalId: 'hospital-A' })
  })
})

describe('PUT /api/dental-chart/[id] — entry from another hospital', () => {
  it('returns 404 and updates nothing', async () => {
    prismaMock.dentalChartEntry.findFirst.mockResolvedValue(null)
    const res = await PUT(
      req('PUT', 'http://localhost/api/dental-chart/entry-from-hospital-B', {
        condition: 'FILLED',
      }),
      { params: Promise.resolve({ id: 'entry-from-hospital-B' }) },
    )
    expect(res.status).toBe(404)
    expect(prismaMock.dentalChartEntry.update).not.toHaveBeenCalled()
  })

  it('scopes the lookup by BOTH id and hospitalId', async () => {
    prismaMock.dentalChartEntry.findFirst.mockResolvedValue(null)
    await PUT(req('PUT', 'http://localhost/api/dental-chart/entry-from-hospital-B', {}), {
      params: Promise.resolve({ id: 'entry-from-hospital-B' }),
    })
    const where = prismaMock.dentalChartEntry.findFirst.mock.calls[0][0].where
    expect(where).toMatchObject({ id: 'entry-from-hospital-B', hospitalId: 'hospital-A' })
  })
})

describe('DELETE /api/dental-chart/[id] — entry from another hospital', () => {
  it('returns 404 and deletes nothing', async () => {
    prismaMock.dentalChartEntry.findFirst.mockResolvedValue(null)
    const res = await DELETE(
      req('DELETE', 'http://localhost/api/dental-chart/entry-from-hospital-B'),
      { params: Promise.resolve({ id: 'entry-from-hospital-B' }) },
    )
    expect(res.status).toBe(404)
    expect(prismaMock.dentalChartEntry.delete).not.toHaveBeenCalled()
  })
})

describe('GET /api/dental-chart — listing is hospital-scoped', () => {
  it('passes hospitalId into the query', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient-A' })
    prismaMock.dentalChartEntry.findMany.mockResolvedValue([])
    await GET(req('GET', 'http://localhost/api/dental-chart?patientId=patient-A'))
    const where = prismaMock.dentalChartEntry.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ patientId: 'patient-A', hospitalId: 'hospital-A' })
  })

  it('returns 404 for a patient in another hospital', async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    const res = await GET(req('GET', 'http://localhost/api/dental-chart?patientId=patient-B'))
    expect(res.status).toBe(404)
    expect(prismaMock.dentalChartEntry.findMany).not.toHaveBeenCalled()
  })
})

describe('RBAC on writes', () => {
  const writeRoles = [
    ['RECEPTIONIST', 403],
    ['SUPER_ADMIN', 403], // server gates on ADMIN|DOCTOR only
    ['NURSE', 403],
  ]

  it.each(writeRoles)('%s is refused with 403', async (role, expected) => {
    state.role = role as string
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient-A' })
    const res = await POST(
      req('POST', 'http://localhost/api/dental-chart', {
        patientId: 'patient-A',
        toothNumber: 36,
        condition: 'CARIES',
      }),
    )
    expect(res.status).toBe(expected)
    expect(prismaMock.dentalChartEntry.create).not.toHaveBeenCalled()
  })

  it('DOCTOR is allowed through the role gate', async () => {
    state.role = 'DOCTOR'
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient-A' })
    prismaMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        dentalChartEntry: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'new' }),
        },
      }),
    )
    const res = await POST(
      req('POST', 'http://localhost/api/dental-chart', {
        patientId: 'patient-A',
        toothNumber: 36,
        condition: 'CARIES',
      }),
    )
    expect(res.status).not.toBe(403)
  })
})

describe('tooth number validation', () => {
  it('rejects a primary tooth 51-85 with 400', async () => {
    state.role = 'DOCTOR'
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient-A' })
    const res = await POST(
      req('POST', 'http://localhost/api/dental-chart', {
        patientId: 'patient-A',
        toothNumber: 51,
        condition: 'CARIES',
      }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.dentalChartEntry.create).not.toHaveBeenCalled()
  })
})

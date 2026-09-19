// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks (mirrors tests/api/appointments.test.ts conventions)
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    patient: { findFirst: vi.fn() },
    staff: { findFirst: vi.fn() },
    videoConsultation: { create: vi.fn() },
  },
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(),
  requireRole: vi.fn(),
  PLAN_LIMITS: {
    FREE: { patientLimit: 100, staffLimit: 3, storageLimitMb: 500 },
    PROFESSIONAL: { patientLimit: -1, staffLimit: -1, storageLimitMb: -1 },
    ENTERPRISE: { patientLimit: -1, staffLimit: -1, storageLimitMb: -1 },
    SELF_HOSTED: { patientLimit: -1, staffLimit: -1, storageLimitMb: -1 },
  },
}))

vi.mock('@/lib/services/video.service', () => ({ createRoom: vi.fn() }))
vi.mock('@/lib/services/smart-scheduler', () => ({ handleCancellationWaitlist: vi.fn() }))

import { POST } from '@/app/api/appointments/route'
import { PUT } from '@/app/api/appointments/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const DAY = '2027-03-10'

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function putRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function existingAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apt-1',
    hospitalId: 'hospital-1',
    appointmentNo: 'APT20260001',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    scheduledDate: new Date(DAY),
    scheduledTime: '09:00',
    duration: 60,
    status: 'SCHEDULED',
    ...overrides,
  }
}

function authed(role = 'ADMIN') {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    user: { id: 'user-1', email: 'admin@test.com', role },
    hospitalId: 'hospital-1',
    session: { user: { id: 'user-1', role } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authed()
})

// ---------------------------------------------------------------------------
// RBAC — server-side scheduling role split
// ---------------------------------------------------------------------------

describe('Agenda RBAC — scheduling mutations are role-restricted server-side', () => {
  it('POST asks requireAuthAndRole for the scheduling roles', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'patient-1' })
    prisma.staff.findFirst.mockResolvedValue({ id: 'doctor-1' })
    prisma.appointment.findMany.mockResolvedValue([])
    prisma.appointment.findFirst.mockResolvedValue(null)
    prisma.appointment.create.mockResolvedValue({ id: 'apt-new' })

    await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '11:00',
        duration: 30,
      })
    )

    expect(requireAuthAndRole).toHaveBeenCalledWith(['ADMIN', 'DOCTOR', 'RECEPTIONIST'])
  })

  it('PUT asks requireAuthAndRole for the scheduling roles', async () => {
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment())
    prisma.appointment.update.mockResolvedValue(existingAppointment())

    await PUT(putRequest('http://localhost/api/appointments/apt-1', { notes: 'x' }), {
      params: Promise.resolve({ id: 'apt-1' }),
    })

    expect(requireAuthAndRole).toHaveBeenCalledWith(['ADMIN', 'DOCTOR', 'RECEPTIONIST'])
  })

  it('a 403 from the role guard is surfaced', async () => {
    authed('ACCOUNTANT')
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
      user: null,
      hospitalId: null,
      session: null,
    })

    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '11:00',
      })
    )
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Conflict detection — duration-aware, server-side
// ---------------------------------------------------------------------------

describe('Agenda conflict detection', () => {
  function setupValidEntities() {
    prisma.patient.findFirst.mockResolvedValue({ id: 'patient-1', hospitalId: 'hospital-1' })
    prisma.staff.findFirst.mockResolvedValue({ id: 'doctor-1', hospitalId: 'hospital-1' })
    prisma.appointment.findFirst.mockResolvedValue(null) // appointmentNo generator
    prisma.appointment.create.mockResolvedValue({ id: 'apt-new' })
  }

  it('rejects a booking that starts inside an existing longer appointment', async () => {
    setupValidEntities()
    // Existing 09:00–10:00; new 09:30–10:00 → overlap must 409
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'apt-1', appointmentNo: 'APT20260001', scheduledTime: '09:00', duration: 60 },
    ])

    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '09:30',
        duration: 30,
      })
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/APT20260001/)
  })

  it('rejects a longer booking that swallows an existing short one', async () => {
    setupValidEntities()
    // Existing 10:15–10:45; new 10:00–11:00 → overlap must 409
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'apt-2', appointmentNo: 'APT20260002', scheduledTime: '10:15', duration: 30 },
    ])

    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '10:00',
        duration: 60,
      })
    )
    expect(res.status).toBe(409)
  })

  it('allows back-to-back bookings (touching, not overlapping)', async () => {
    setupValidEntities()
    // Existing 09:00–09:30; new 09:30–10:00 → legal
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'apt-1', appointmentNo: 'APT20260001', scheduledTime: '09:00', duration: 30 },
    ])

    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '09:30',
        duration: 30,
      })
    )
    expect(res.status).toBe(201)
  })

  it('cancelled / no-show appointments never block the slot', async () => {
    setupValidEntities()
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'apt-9', appointmentNo: 'APT20260009', scheduledTime: '09:00', duration: 60 },
    ])

    // Service-level guarantee: the status filter is part of the query.
    // Assert the query we issue only targets active statuses.
    await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '09:30',
        duration: 30,
      })
    )
    const where = prisma.appointment.findMany.mock.calls[0][0].where
    expect(where.status.in).toEqual(
      expect.arrayContaining(['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'])
    )
    expect(where.status.in).not.toContain('CANCELLED')
  })

  it('runs the same overlap check when rescheduling (PUT)', async () => {
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment())
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'apt-2', appointmentNo: 'APT20260002', scheduledTime: '11:00', duration: 30 },
    ])

    const res = await PUT(
      putRequest('http://localhost/api/appointments/apt-1', {
        scheduledDate: DAY,
        scheduledTime: '11:15',
        duration: 30,
      }),
      { params: Promise.resolve({ id: 'apt-1' }) }
    )
    expect(res.status).toBe(409)
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('excludes the appointment being rescheduled from its own conflict window', async () => {
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment())
    prisma.appointment.findMany.mockResolvedValue([])
    prisma.appointment.update.mockResolvedValue(existingAppointment({ scheduledTime: '11:15' }))

    await PUT(
      putRequest('http://localhost/api/appointments/apt-1', {
        scheduledTime: '11:15',
      }),
      { params: Promise.resolve({ id: 'apt-1' }) }
    )

    const where = prisma.appointment.findMany.mock.calls[0][0].where
    expect(where.id.not).toBe('apt-1')
  })

  it('conflict lookup is tenant- and provider-scoped', async () => {
    setupValidEntities()
    prisma.appointment.findMany.mockResolvedValue([])

    await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '09:00',
        duration: 30,
      })
    )
    const where = prisma.appointment.findMany.mock.calls[0][0].where
    expect(where.hospitalId).toBe('hospital-1')
    expect(where.doctorId).toBe('doctor-1')
  })
})

// ---------------------------------------------------------------------------
// Validation & tenant isolation
// ---------------------------------------------------------------------------

describe('Agenda validation and tenant isolation', () => {
  it('rejects malformed time', async () => {
    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '9:am',
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects out-of-range duration', async () => {
    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '09:00',
        duration: 900,
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects a patient from another hospital (tenant isolation)', async () => {
    prisma.patient.findFirst.mockResolvedValue(null) // not in THIS hospital
    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-other-hospital',
        doctorId: 'doctor-1',
        scheduledDate: DAY,
        scheduledTime: '09:00',
      })
    )
    expect(res.status).toBe(404)
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('rejects a doctor from another hospital on create', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'patient-1', hospitalId: 'hospital-1' })
    prisma.staff.findFirst.mockResolvedValue(null)
    const res = await POST(
      jsonRequest('http://localhost/api/appointments', {
        patientId: 'patient-1',
        doctorId: 'doctor-other-hospital',
        scheduledDate: DAY,
        scheduledTime: '09:00',
      })
    )
    expect(res.status).toBe(404)
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('rejects a doctorId from another hospital on PUT (no cross-tenant reassignment)', async () => {
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment())
    prisma.staff.findFirst.mockResolvedValue(null) // doctor not in this hospital

    const res = await PUT(
      putRequest('http://localhost/api/appointments/apt-1', { doctorId: 'doctor-other' }),
      { params: Promise.resolve({ id: 'apt-1' }) }
    )
    expect(res.status).toBe(404)
    expect(prisma.appointment.update).not.toHaveBeenCalled()
  })

  it('rejects invalid status values on PUT (mass-assignment guard)', async () => {
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment())
    const res = await PUT(
      putRequest('http://localhost/api/appointments/apt-1', { status: 'NOT_A_STATUS' }),
      { params: Promise.resolve({ id: 'apt-1' }) }
    )
    expect(res.status).toBe(400)
  })

  it('rejects invalid time on PUT', async () => {
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment())
    const res = await PUT(
      putRequest('http://localhost/api/appointments/apt-1', { scheduledTime: '25:99' }),
      { params: Promise.resolve({ id: 'apt-1' }) }
    )
    expect(res.status).toBe(400)
  })

  it('cancellation persists status and timestamp', async () => {
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment())
    prisma.appointment.findMany.mockResolvedValue([])
    prisma.appointment.update.mockResolvedValue(existingAppointment({ status: 'CANCELLED' }))

    const res = await PUT(
      putRequest('http://localhost/api/appointments/apt-1', {
        status: 'CANCELLED',
        cancellationReason: 'Patient called in sick',
      }),
      { params: Promise.resolve({ id: 'apt-1' }) }
    )
    expect(res.status).toBe(200)
    const data = prisma.appointment.update.mock.calls[0][0].data
    expect(data.status).toBe('CANCELLED')
    expect(data.cancelledAt).toBeInstanceOf(Date)
    expect(data.cancellationReason).toBe('Patient called in sick')
  })
})

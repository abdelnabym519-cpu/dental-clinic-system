// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Agenda Phase-2 API surface: availability gate, recurrence, rooms, analytics,
// reminders, availability context and waitlist promote. All persistence is
// mocked; every asserted number comes from the mocked real records.
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    patient: { findFirst: vi.fn(), findUnique: vi.fn() },
    staff: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    treatment: { findMany: vi.fn() },
    staffShift: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    leave: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    holiday: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    hospital: { findUnique: vi.fn().mockResolvedValue({ workingHours: null }), findFirst: vi.fn() },
    room: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    appointmentReminder: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    waitlist: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(),
    doctorBreak: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    blockedSlot: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
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
import { GET as analyticsGET } from '@/app/api/appointments/analytics/route'
import { GET as roomsGET, POST as roomsPOST } from '@/app/api/rooms/route'
import {
  GET as remindersGET,
  POST as remindersPOST,
  DELETE as remindersDELETE,
} from '@/app/api/appointments/reminders/route'
import { GET as availabilityGET } from '@/app/api/appointments/availability/route'
import { POST as blockedSlotsPOST } from '@/app/api/blocked-slots/route'
import { POST as promotePOST } from '@/app/api/appointments/waitlist/[id]/promote/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { toDateKey } from '@/lib/agenda-utils'
import { prisma } from '@/lib/prisma'

const HOSPITAL = 'hospital-1'
const DOCTOR = 'dr-1'
const PATIENT = 'pat-1'
const DAY = '2027-06-15' // a Tuesday

function post(body: unknown) {
  return new NextRequest('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function put(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function authAs(role: string) {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: HOSPITAL,
    user: { id: 'u-1', role },
    session: { user: { id: 'u-1', role } },
  })
}

function seedValidPatientAndDoctor() {
  prisma.patient.findFirst.mockResolvedValue({ id: PATIENT, hospitalId: HOSPITAL })
  prisma.staff.findFirst.mockResolvedValue({ id: DOCTOR, hospitalId: HOSPITAL })
  prisma.appointment.findFirst.mockResolvedValue(null)
  prisma.appointment.findMany.mockResolvedValue([])
  prisma.hospital.findUnique.mockResolvedValue({ workingHours: null }) // default hours
  prisma.staffShift.findUnique.mockResolvedValue(null)
  prisma.holiday.findMany.mockResolvedValue([])
  prisma.leave.findMany.mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  // Re-apply the availability defaults cleared by clearAllMocks.
  prisma.staffShift.findUnique.mockResolvedValue(null)
  prisma.staffShift.findFirst.mockResolvedValue(null)
  prisma.staffShift.findMany.mockResolvedValue([])
  prisma.leave.findFirst.mockResolvedValue(null)
  prisma.leave.findMany.mockResolvedValue([])
  prisma.holiday.findFirst.mockResolvedValue(null)
  prisma.holiday.findMany.mockResolvedValue([])
  prisma.hospital.findUnique.mockResolvedValue({ workingHours: null })
  prisma.room.findFirst.mockResolvedValue(null)
  prisma.room.findMany.mockResolvedValue([])
  prisma.doctorBreak.findFirst.mockResolvedValue(null)
  prisma.doctorBreak.findMany.mockResolvedValue([])
  prisma.blockedSlot.findFirst.mockResolvedValue(null)
  prisma.blockedSlot.findMany.mockResolvedValue([])
  prisma.appointmentReminder.findMany.mockResolvedValue([])
  prisma.waitlist.findMany.mockResolvedValue([])
  prisma.waitlist.count.mockResolvedValue(0)
  return authAs('ADMIN')
})

describe('Agenda Phase-2 — booking-window enforcement (4A/4D)', () => {
  beforeEach(seedValidPatientAndDoctor)

  it('creates a booking inside default working hours (201, SCHEDULED)', async () => {
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30 }))
    expect(res.status).toBe(201)
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) })
    )
  })

  it('rejects a booking outside working hours with a coded 409', async () => {
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '23:00', duration: 30 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('OUTSIDE_WORKING_HOURS')
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('rejects a booking inside the default 13:00–14:00 lunch (DURING_BREAK)', async () => {
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '13:15', duration: 30 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('DURING_BREAK')
  })

  it('rejects a booking on an approved-leave day (DOCTOR_ON_LEAVE)', async () => {
    prisma.leave.findMany.mockResolvedValue([
      { startDate: new Date('2027-06-15'), endDate: new Date('2027-06-16'), leaveType: 'CASUAL', status: 'APPROVED' },
    ])
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('DOCTOR_ON_LEAVE')
  })

  it('rejects a booking on a clinic holiday (CLINIC_HOLIDAY)', async () => {
    prisma.holiday.findMany.mockResolvedValue([{ date: new Date('2027-06-15'), isRecurring: false }])
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('CLINIC_HOLIDAY')
  })

  it('honors the clinic week-schedule: closed day is rejected, open day accepted', async () => {
    prisma.hospital.findUnique.mockResolvedValue({
      workingHours: JSON.stringify({
        tuesday: { open: '09:00', close: '18:00', closed: false },
        sunday: { open: null, close: null, closed: true },
      }),
    })
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    const open = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30 }))
    expect(open.status).toBe(201)

    const closed = await POST(
      post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: '2027-06-20', scheduledTime: '10:00', duration: 30 }) // Sunday
    )
    expect(closed.status).toBe(409)
    expect((await closed.json()).code).toBe('OUTSIDE_WORKING_HOURS')
  })
})

describe('Agenda Phase-2 — room assignment (4E)', () => {
  beforeEach(seedValidPatientAndDoctor)

  it('books into a free room and stores the assignment', async () => {
    prisma.room.findFirst.mockResolvedValue({ id: 'room-1', hospitalId: HOSPITAL, name: 'Chair 1' })
    prisma.appointment.findMany.mockImplementation(async ({ where }) =>
      where?.roomId === 'room-1'
        ? [{ id: 'other', scheduledTime: '09:00', duration: 30 }]
        : []
    )
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    const res = await POST(
      post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30, roomId: 'room-1' })
    )
    expect(res.status).toBe(201)
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomId: 'room-1' }) })
    )
  })

  it('rejects a room double-booking with a 409', async () => {
    prisma.room.findFirst.mockResolvedValue({ id: 'room-1', hospitalId: HOSPITAL, name: 'Chair 1' })
    prisma.appointment.findMany.mockImplementation(async ({ where }) =>
      where?.roomId === 'room-1'
        ? [{ id: 'other', appointmentNo: 'APT1', scheduledTime: '10:00', duration: 60 }]
        : []
    )
    const res = await POST(
      post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:30', duration: 30, roomId: 'room-1' })
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/room/i)
  })

  it('never trusts a client roomId from another hospital (404)', async () => {
    prisma.room.findFirst.mockResolvedValue(null)
    const res = await POST(
      post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30, roomId: 'other-hospital-room' })
    )
    expect(res.status).toBe(404)
  })
})

describe('Agenda Phase-2 — recurrence series (4J)', () => {
  beforeEach(seedValidPatientAndDoctor)

  it('creates one REAL appointment per occurrence sharing a recurrenceGroupId', async () => {
    prisma.appointment.create
      .mockResolvedValueOnce({ id: 'apt-1' })
      .mockResolvedValueOnce({ id: 'apt-2' })
      .mockResolvedValueOnce({ id: 'apt-3' })

    const res = await POST(
      post({
        patientId: PATIENT,
        doctorId: DOCTOR,
        scheduledDate: DAY,
        scheduledTime: '10:00',
        duration: 30,
        recurrence: { pattern: 'WEEKLY', count: 3 },
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('apt-1') // first occurrence is the response body
    expect(prisma.appointment.create).toHaveBeenCalledTimes(3)
    const firstCall = prisma.appointment.create.mock.calls[0][0]
    expect(firstCall.data.recurrenceGroupId).toBeTruthy()
    const secondCall = prisma.appointment.create.mock.calls[1][0]
    expect(secondCall.data.recurrenceGroupId).toBe(firstCall.data.recurrenceGroupId)
    expect(toDateKey(new Date(secondCall.data.scheduledDate))).toBe('2027-06-22')
  })

  it('does not set recurrenceGroupId for a single (non-recurring) booking', async () => {
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30 }))
    expect(prisma.appointment.create.mock.calls[0][0].data.recurrenceGroupId).toBeNull()
  })

  it('rejects an unknown recurrence pattern (400)', async () => {
    const res = await POST(
      post({
        patientId: PATIENT,
        doctorId: DOCTOR,
        scheduledDate: DAY,
        scheduledTime: '10:00',
        duration: 30,
        recurrence: { pattern: 'HOURLY', count: 2 },
      })
    )
    expect(res.status).toBe(400)
  })

  it('conflict-checks each occurrence individually', async () => {
    // Week 2 (2027-06-22) is taken 10:00–10:30 — the series must be rejected.
    prisma.appointment.findMany.mockImplementation(async ({ where }) => {
      if (where?.scheduledDate && toDateKey(new Date(where.scheduledDate)) === '2027-06-22') {
        return [{ id: 'taken', scheduledTime: '10:00', duration: 30 }]
      }
      return []
    })
    const res = await POST(
      post({
        patientId: PATIENT,
        doctorId: DOCTOR,
        scheduledDate: DAY,
        scheduledTime: '10:00',
        duration: 30,
        recurrence: { pattern: 'WEEKLY', count: 2 },
      })
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/2027-06-22/)
  })
})

describe('Agenda Phase-2 — series editing scope (4J, PUT applyTo)', () => {
  beforeEach(seedValidPatientAndDoctor)

  it("'future' updates this and later occurrences only, shifting dates by the delta", async () => {
    prisma.appointment.findFirst.mockImplementation(async ({ where }) =>
      where?.id === 'apt-base'
        ? {
            id: 'apt-base',
            hospitalId: HOSPITAL,
            patientId: PATIENT,
            doctorId: DOCTOR,
            scheduledDate: new Date('2027-06-15T00:00:00'),
            scheduledTime: '10:00',
            duration: 30,
            status: 'SCHEDULED',
            roomId: null,
            recurrenceGroupId: 'grp-1',
          }
        : null
    )
    // The recurrence group as the DB stores it — including the edited base row.
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'apt-past', scheduledDate: new Date('2027-06-08T00:00:00'), scheduledTime: '10:00', duration: 30, status: 'COMPLETED', roomId: null },
      { id: 'apt-base', scheduledDate: new Date('2027-06-15T00:00:00'), scheduledTime: '10:00', duration: 30, status: 'SCHEDULED', roomId: null },
      { id: 'apt-future1', scheduledDate: new Date('2027-06-22T00:00:00'), scheduledTime: '10:00', duration: 30, status: 'SCHEDULED', roomId: null },
      { id: 'apt-future2', scheduledDate: new Date('2027-06-29T00:00:00'), scheduledTime: '10:00', duration: 30, status: 'CONFIRMED', roomId: null },
    ])
    prisma.appointment.update.mockResolvedValue({ id: 'updated' })

    const res = await PUT(
      put('http://localhost/api/appointments/apt-base', {
        scheduledTime: '11:00', // +60min
        applyTo: 'future',
      }),
      { params: Promise.resolve({ id: 'apt-base' }) }
    )
    expect(res.status).toBe(200)
    // base + 2 future occurrences updated in the series pass; the past
    // COMPLETED occurrence is left untouched.
    expect(prisma.appointment.update).toHaveBeenCalledTimes(3)
    const updatedIds = prisma.appointment.update.mock.calls.map((c) => c[0]?.where?.id)
    expect(updatedIds).toEqual(['apt-base', 'apt-future1', 'apt-future2'])
    expect(prisma.appointment.update.mock.calls.find((c) => c[0]?.where?.id === 'apt-past')).toBeUndefined()
    const future1 = prisma.appointment.update.mock.calls.find(
      (c) => c[0]?.where?.id === 'apt-future1'
    )
    expect(future1).toBeTruthy()
    expect(toDateKey(new Date(future1[0].data.scheduledDate))).toBe('2027-06-22')
    expect(future1[0].data.scheduledTime).toBe('11:00')
  })
})

describe('Agenda Phase-2b — per-doctor breaks & blocked slots (2B/2D)', () => {
  beforeEach(seedValidPatientAndDoctor)

  it('rejects a booking inside a recurring doctor break (DOCTOR_ON_BREAK)', async () => {
    prisma.doctorBreak.findMany.mockResolvedValue([
      { startTime: '12:30', endTime: '13:30', label: 'Lunch' },
    ])
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '12:45', duration: 30 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('DOCTOR_ON_BREAK')
    expect(body.error).toContain('Lunch')
  })

  it('rejects a booking overlapping an arbitrary blocked slot (SLOT_BLOCKED)', async () => {
    prisma.blockedSlot.findMany.mockResolvedValue([{ id: 'bs-1', reason: 'Equipment maintenance' }])
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '10:00', duration: 30 }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('SLOT_BLOCKED')
    expect(body.error).toContain('Equipment maintenance')
  })

  it('a different doctor is not blocked by another doctor’s private break', async () => {
    prisma.doctorBreak.findMany.mockResolvedValue([]) // queried per-doctor
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    // 15:00 avoids the default 13:00–14:00 clinic lunch on purpose.
    const res = await POST(post({ patientId: PATIENT, doctorId: DOCTOR, scheduledDate: DAY, scheduledTime: '15:00', duration: 30 }))
    expect(res.status).toBe(201)
  })

  it('blocked-slot creation rejects end before start (400)', async () => {
    const res = await blockedSlotsPOST(
      new NextRequest('http://localhost/api/blocked-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startAt: '2027-06-15T10:00:00.000Z', endAt: '2027-06-15T09:00:00.000Z' }),
      })
    )
    expect(res.status).toBe(400)
  })
})

describe('Agenda Phase-2 — rooms API (4E)', () => {
  it('lists rooms for the tenant (GET)', async () => {
    prisma.room.findMany.mockResolvedValue([{ id: 'room-1', name: 'Chair 1' }])
    const res = await roomsGET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rooms).toHaveLength(1)
    expect(prisma.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ hospitalId: HOSPITAL, isActive: true }) })
    )
  })

  it('creates a room (ADMIN only) and rejects duplicate names (409)', async () => {
    prisma.room.findFirst.mockResolvedValue(null)
    prisma.room.create.mockResolvedValue({ id: 'room-2', name: 'Surgery' })
    const created = await roomsPOST(
      new NextRequest('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Surgery' }),
      })
    )
    expect(created.status).toBe(201)

    prisma.room.findFirst.mockResolvedValue({ id: 'room-2' })
    const dup = await roomsPOST(
      new NextRequest('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Surgery' }),
      })
    )
    expect(dup.status).toBe(409)
  })

  it('blocks non-ADMIN roles from creating rooms (RBAC: rooms are ADMIN)', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: denied,
      hospitalId: null,
      user: null,
      session: null,
    })
    const res = await roomsPOST(
      new NextRequest('http://localhost/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
    )
    expect(res.status).toBe(401)
  })
})

describe('Agenda Phase-2 — scheduling analytics (4H/4L)', () => {
  it('computes month analytics from real records and RBAC-gates to ADMIN/DOCTOR', async () => {
    const june = (day: number) => new Date(2027, 5, day)
    prisma.appointment.findMany.mockResolvedValue([
      { status: 'COMPLETED', duration: 30, doctorId: DOCTOR, scheduledDate: june(2) },
      { status: 'COMPLETED', duration: 60, doctorId: DOCTOR, scheduledDate: june(3) },
      { status: 'CANCELLED', duration: 30, doctorId: DOCTOR, scheduledDate: june(4) },
      { status: 'NO_SHOW', duration: 30, doctorId: DOCTOR, scheduledDate: june(5) },
    ])
    prisma.staffShift.findMany.mockResolvedValue([
      { staffId: DOCTOR, startTime: '09:00', endTime: '17:00', isActive: true },
    ])

    const res = await analyticsGET(
      new NextRequest('http://localhost/api/appointments/analytics?from=2027-06-01&to=2027-06-30')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(4)
    expect(body.completed).toBe(2)
    expect(body.cancelled).toBe(1)
    expect(body.noShow).toBe(1)
    expect(body.completedRate).toBe(50)
    expect(body.noShowRate).toBe(25)
    expect(body.bookedMinutes).toBe(90) // cancelled + no-show excluded
    expect(body.doctorUtilization[0].doctorId).toBe(DOCTOR)
    expect(body.doctorUtilization[0].bookedMinutes).toBe(90)
    expect(body.clinic.capacityMinutes).toBeGreaterThan(0)
    expect(body.clinic.occupancyPercent).toBeGreaterThanOrEqual(0)
  })

  it('rejects ANALYSIS for non-ADMIN/DOCTOR roles (401)', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: denied,
      hospitalId: null,
      user: null,
      session: null,
    })
    const res = await analyticsGET(new NextRequest('http://localhost/api/appointments/analytics'))
    expect(res.status).toBe(401)
  })
})

describe('Agenda Phase-2 — reminder infrastructure (4M)', () => {
  it('queues a reminder for a tenant appointment (201, PENDING, no sending)', async () => {
    prisma.appointment.findFirst.mockResolvedValue({ id: 'apt-1' })
    prisma.appointmentReminder.create.mockResolvedValue({
      id: 'rem-1',
      status: 'PENDING',
      reminderType: 'WHATSAPP',
    })
    const res = await remindersPOST(
      new NextRequest('http://localhost/api/appointments/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: 'apt-1',
          channel: 'WHATSAPP',
          scheduledFor: new Date(Date.now() + 86400000).toISOString(),
        }),
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('PENDING')
  })

  it('validates the channel and requires a future timestamp (400)', async () => {
    const res = await remindersPOST(
      new NextRequest('http://localhost/api/appointments/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: 'apt-1', channel: 'FAX', scheduledFor: new Date().toISOString() }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('never schedules against another hospital’s appointment (404)', async () => {
    prisma.appointment.findFirst.mockResolvedValue(null)
    const res = await remindersPOST(
      new NextRequest('http://localhost/api/appointments/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: 'foreign-apt',
          channel: 'SMS',
          scheduledFor: new Date(Date.now() + 86400000).toISOString(),
        }),
      })
    )
    expect(res.status).toBe(404)
  })

  it('cancels a pending reminder but refuses to cancel a SENT one (400)', async () => {
    prisma.appointmentReminder.findFirst.mockResolvedValue({
      id: 'rem-1',
      status: 'PENDING',
      appointment: { hospitalId: HOSPITAL },
    })
    prisma.appointmentReminder.update.mockResolvedValue({ id: 'rem-1', status: 'CANCELLED' })
    const ok = await remindersDELETE(new NextRequest('http://localhost/api/appointments/reminders?id=rem-1', { method: 'DELETE' }))
    expect(ok.status).toBe(200)
    expect(prisma.appointmentReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } })
    )

    prisma.appointmentReminder.findFirst.mockResolvedValue({
      id: 'rem-2',
      status: 'SENT',
      appointment: { hospitalId: HOSPITAL },
    })
    const sent = await remindersDELETE(new NextRequest('http://localhost/api/appointments/reminders?id=rem-2', { method: 'DELETE' }))
    expect(sent.status).toBe(400)
  })
})

describe('Agenda Phase-2 — availability context endpoint (4A/4B/4C overlay)', () => {
  it('returns per-day windows for the doctor and 404s foreign doctors', async () => {
    prisma.staff.findFirst.mockResolvedValue({ id: DOCTOR, hospitalId: HOSPITAL })
    prisma.staffShift.findMany.mockResolvedValue([
      { dayOfWeek: 2, startTime: '10:00', endTime: '18:00', isActive: true }, // Tuesday
    ])
    const res = await availabilityGET(
      new NextRequest(`http://localhost/api/appointments/availability?doctorId=${DOCTOR}&date=${DAY}`)
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.windowsByDay[2]).toEqual({ startTime: '10:00', endTime: '18:00' })
    expect(Array.isArray(body.leaves)).toBe(true)
    expect(Array.isArray(body.holidays)).toBe(true)

    prisma.staff.findFirst.mockResolvedValue(null)
    const foreign = await availabilityGET(
      new NextRequest('http://localhost/api/appointments/availability?doctorId=foreign&date=' + DAY)
    )
    expect(foreign.status).toBe(404)
  })
})

describe('Agenda Phase-2 — waitlist promote (4G)', () => {
  it('books the next genuinely free slot and marks the entry BOOKED', async () => {
    prisma.waitlist.findFirst.mockResolvedValue({
      id: 'wl-1',
      hospitalId: HOSPITAL,
      patientId: PATIENT,
      doctorId: DOCTOR,
      status: 'ACTIVE',
      notes: 'wants morning',
    })
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT, hospitalId: HOSPITAL })
    prisma.staff.findMany.mockResolvedValue([{ id: DOCTOR }])
    prisma.appointment.findFirst.mockResolvedValue(null) // generateAppointmentNo: fresh
    prisma.appointment.findMany.mockResolvedValue([]) // no conflicts
    prisma.appointment.create.mockResolvedValue({ id: 'apt-new', appointmentNo: 'APT202706210001' })
    prisma.waitlist.update.mockResolvedValue({ id: 'wl-1', status: 'BOOKED' })

    const res = await promotePOST(
      new NextRequest('http://localhost/api/appointments/waitlist/wl-1/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'wl-1' }) }
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('BOOKED')
    expect(body.appointment.id).toBe('apt-new')
    // The booked slot must respect default working hours (>= 09:00, < 21:00)
    // and fall on a 30-minute grid.
    const bookedTime = prisma.appointment.create.mock.calls[0][0].data.scheduledTime
    expect(bookedTime).toMatch(/^([01][0-9]|2[0-1]):[0-5]0$/)
    expect(prisma.waitlist.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'BOOKED' }) })
    )
  })

  it('prefers the entry’s preferred doctor before other doctors', async () => {
    prisma.waitlist.findFirst.mockResolvedValue({
      id: 'wl-2',
      hospitalId: HOSPITAL,
      patientId: PATIENT,
      doctorId: 'dr-preferred',
      status: 'NOTIFIED',
    })
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT, hospitalId: HOSPITAL })
    prisma.staff.findMany.mockResolvedValue([{ id: 'dr-other' }, { id: 'dr-preferred' }])
    prisma.appointment.findFirst.mockResolvedValue(null)
    prisma.appointment.findMany.mockResolvedValue([])
    prisma.appointment.create.mockImplementation(async ({ data }) => ({ id: 'apt-x', ...data }))
    prisma.waitlist.update.mockResolvedValue({ id: 'wl-2', status: 'BOOKED' })

    const res = await promotePOST(
      new NextRequest('http://localhost/api/appointments/waitlist/wl-2/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'wl-2' }) }
    )
    expect(res.status).toBe(201)
    expect(prisma.appointment.create.mock.calls[0][0].data.doctorId).toBe('dr-preferred')
  })

  it('refuses an already-BOOKED entry (400) and a foreign entry (404)', async () => {
    prisma.waitlist.findFirst.mockResolvedValueOnce({
      id: 'wl-3',
      hospitalId: HOSPITAL,
      patientId: PATIENT,
      status: 'BOOKED',
    })
    const booked = await promotePOST(
      new NextRequest('http://localhost/api/appointments/waitlist/wl-3/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'wl-3' }) }
    )
    expect(booked.status).toBe(400)

    prisma.waitlist.findFirst.mockResolvedValueOnce(null)
    const foreign = await promotePOST(
      new NextRequest('http://localhost/api/appointments/waitlist/wl-x/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'wl-x' }) }
    )
    expect(foreign.status).toBe(404)
  })

  it('reports 409 when the horizon has no free slot at all', async () => {
    prisma.waitlist.findFirst.mockResolvedValue({
      id: 'wl-4',
      hospitalId: HOSPITAL,
      patientId: PATIENT,
      doctorId: null,
      status: 'ACTIVE',
    })
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT, hospitalId: HOSPITAL })
    prisma.staff.findMany.mockResolvedValue([{ id: DOCTOR }])
    prisma.appointment.findFirst.mockResolvedValue(null)
    // Every candidate slot collides.
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'wall', scheduledTime: '00:00', duration: 1440 },
    ])

    const res = await promotePOST(
      new NextRequest('http://localhost/api/appointments/waitlist/wl-4/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'wl-4' }) }
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/No free slot/)
  })
})

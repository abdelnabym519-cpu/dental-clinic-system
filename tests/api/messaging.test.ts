// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Messaging platform API: RBAC matrix (§4), tenant isolation, queue wiring
// (3C/3D/3E/3G/3H/3I/3J), masked message log (3L) and the cron processor (3B).
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    patient: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    staff: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    staffShift: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    leave: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    holiday: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    doctorBreak: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    blockedSlot: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn() },
    hospital: { findUnique: vi.fn().mockResolvedValue({ name: 'عيادة دنتورا', address: 'القاهرة', phone: null, workingHours: null }) },
    room: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    prescription: {
      findFirst: vi.fn(),
    },
    invoice: {
      findFirst: vi.fn(),
    },
    document: {
      findFirst: vi.fn(),
    },
    messageQueue: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    waitlist: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    videoConsultation: { create: vi.fn() },
    doctorBreakModel: {},
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
vi.mock('@/lib/storage', () => ({
  getStorage: () => storageMock,
  StorageNotFoundError: class StorageNotFoundError extends Error {},
}))
const storageMock = {
  get: vi.fn(async (key: string) => ({
    body: Buffer.from('fake-image-bytes'),
    contentType: 'image/jpeg',
    size: 17,
  })),
}

import { POST as createAppointment } from '@/app/api/appointments/route'
import { PUT as updateAppointment } from '@/app/api/appointments/[id]/route'
import { POST as sendPrescription } from '@/app/api/communications/prescriptions/[id]/send/route'
import { POST as sendInvoice } from '@/app/api/communications/invoices/[id]/send/route'
import { POST as sendRadiology } from '@/app/api/communications/documents/[id]/send/route'
import { GET as messageLog, POST as testMessage } from '@/app/api/communications/messages/route'
import { PATCH as messageAction } from '@/app/api/communications/messages/[id]/route'
import { GET as cronMessages } from '@/app/api/cron/messages/route'
import { POST as createBlockedSlot } from '@/app/api/blocked-slots/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const HOSPITAL = 'hospital-1'

function jsonReq(url: string, body: unknown, method = 'POST') {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function authAs(role: string, userId = 'u-1') {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: HOSPITAL,
    user: { id: userId, role },
    session: { user: { id: userId, role } },
  })
}

function authDenied() {
  const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: denied,
    hospitalId: null,
    user: null,
    session: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Re-prime availability defaults cleared by clearAllMocks.
  prisma.staffShift.findUnique.mockResolvedValue(null)
  prisma.staffShift.findMany.mockResolvedValue([])
  prisma.leave.findMany.mockResolvedValue([])
  prisma.holiday.findMany.mockResolvedValue([])
  prisma.doctorBreak.findMany.mockResolvedValue([])
  prisma.blockedSlot.findMany.mockResolvedValue([])
  prisma.hospital.findUnique.mockResolvedValue({
    name: 'عيادة دنتورا',
    address: 'القاهرة',
    phone: null,
    workingHours: null,
  })
  return authAs('ADMIN')
})

describe('appointment creation → message queue wiring (3C/3D/3E/3J, items 18–21)', () => {
  it('queues confirmation + doctor notice + 24h/1h reminders on booking', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1', hospitalId: HOSPITAL })
    prisma.staff.findFirst.mockResolvedValue({ id: 'dr-1', hospitalId: HOSPITAL })
    prisma.appointment.findFirst.mockResolvedValue(null)
    prisma.appointment.findMany.mockResolvedValue([])
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    prisma.patient.findUnique.mockResolvedValue({
      id: 'pat-1',
      firstName: 'أحمد',
      lastName: 'محمد',
      phone: '01012345678',
    })
    prisma.staff.findUnique.mockResolvedValue({
      id: 'dr-1',
      firstName: 'سمير',
      lastName: 'علي',
      phone: '+201198765432',
    })
    const created: Array<Record<string, unknown>> = []
    prisma.messageQueue.create.mockImplementation(async ({ data }) => {
      created.push(data)
      return { id: `mq-${created.length}` }
    })

    const res = await createAppointment(
      jsonReq('http://localhost/api/appointments', {
        patientId: 'pat-1',
        doctorId: 'dr-1',
        // 2027-06-15 10:00 Cairo ≈ 2027-06-15T08:00Z — more than 25h away,
        // so both reminders are scheduleable.
        scheduledDate: '2027-06-15',
        scheduledTime: '10:00',
        duration: 30,
      })
    )
    expect(res.status).toBe(201)
    const types = created.map((c) => c.messageType).sort()
    expect(types).toEqual([
      'APPOINTMENT_CONFIRMATION',
      'APPOINTMENT_REMINDER_1H',
      'APPOINTMENT_REMINDER_24H',
      'DOCTOR_NEW_APPOINTMENT',
    ])
    // Recipients normalized to E.164 (3K).
    const confirmation = created.find((c) => c.messageType === 'APPOINTMENT_CONFIRMATION')
    expect(confirmation.recipient).toBe('+201012345678')
    expect(confirmation.channel).toBe('WHATSAPP')
    const reminder24 = created.find((c) => c.messageType === 'APPOINTMENT_REMINDER_24H')
    // Exactly 24h before the appointment (2027-06-15 10:00) → 2027-06-14.
    expect(new Date(reminder24.scheduledAt).toISOString()).toContain('2027-06-14')
    // Doctor notice goes to the doctor, not the patient.
    const doctorMsg = created.find((c) => c.messageType === 'DOCTOR_NEW_APPOINTMENT')
    expect(doctorMsg.recipient).toBe('+201198765432')
  })

  it('queues a doctor cancellation notice and a review request on transitions (3I/3J, items 26/25)', async () => {
    prisma.appointment.findFirst.mockResolvedValue({
      id: 'apt-1',
      hospitalId: HOSPITAL,
      patientId: 'pat-1',
      doctorId: 'dr-1',
      scheduledDate: new Date('2027-06-15T00:00:00'),
      scheduledTime: '10:00',
      duration: 30,
      status: 'SCHEDULED',
      appointmentType: 'CONSULTATION',
      roomId: null,
    })
    prisma.appointment.update.mockResolvedValue({
      id: 'apt-1',
      status: 'CANCELLED',
      scheduledDate: new Date('2027-06-15T00:00:00'),
      scheduledTime: '10:00',
      duration: 30,
      patient: { id: 'pat-1', firstName: 'أحمد', lastName: 'محمد', phone: '+201012345678' },
      doctor: { id: 'dr-1', firstName: 'سمير', lastName: 'علي' },
    })
    prisma.staff.findUnique.mockResolvedValue({
      id: 'dr-1',
      firstName: 'سمير',
      lastName: 'علي',
      phone: '+201198765432',
    })
    prisma.waitlist.count.mockResolvedValue(0)
    const created: Array<Record<string, unknown>> = []
    prisma.messageQueue.create.mockImplementation(async ({ data }) => {
      created.push(data)
      return { id: `mq-${created.length}` }
    })

    const res = await updateAppointment(
      jsonReq('http://localhost/api/appointments/apt-1', { status: 'CANCELLED' }, 'PUT'),
      { params: Promise.resolve({ id: 'apt-1' }) }
    )
    expect(res.status).toBe(200)
    const types = created.map((c) => c.messageType)
    expect(types).toContain('DOCTOR_CANCELLATION')
    expect(created.find((c) => c.messageType === 'DOCTOR_CANCELLATION').recipient).toBe(
      '+201198765432'
    )
  })

  it('skips messaging silently when the patient number is invalid — booking still succeeds (3K)', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1', hospitalId: HOSPITAL })
    prisma.staff.findFirst.mockResolvedValue({ id: 'dr-1', hospitalId: HOSPITAL })
    prisma.appointment.findFirst.mockResolvedValue(null)
    prisma.appointment.findMany.mockResolvedValue([])
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    prisma.patient.findUnique.mockResolvedValue({
      id: 'pat-1',
      firstName: 'أحمد',
      lastName: 'محمد',
      phone: 'not-a-phone',
    })
    prisma.staff.findUnique.mockResolvedValue({
      id: 'dr-1',
      firstName: 'سمير',
      lastName: 'علي',
      phone: null,
    })

    const res = await createAppointment(
      jsonReq('http://localhost/api/appointments', {
        patientId: 'pat-1',
        doctorId: 'dr-1',
        scheduledDate: '2027-06-15',
        scheduledTime: '10:00',
        duration: 30,
      })
    )
    expect(res.status).toBe(201) // booking unaffected
    expect(prisma.messageQueue.create).not.toHaveBeenCalled()
  })

  it('supports the manual contact number override (3K)', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1', hospitalId: HOSPITAL })
    prisma.staff.findFirst.mockResolvedValue({ id: 'dr-1', hospitalId: HOSPITAL })
    prisma.appointment.findFirst.mockResolvedValue(null)
    prisma.appointment.findMany.mockResolvedValue([])
    prisma.appointment.create.mockResolvedValue({ id: 'apt-1' })
    prisma.patient.findUnique.mockResolvedValue({
      id: 'pat-1',
      firstName: 'أحمد',
      lastName: 'محمد',
      phone: '+201012345678',
    })
    prisma.staff.findUnique.mockResolvedValue({
      id: 'dr-1',
      firstName: 'سمير',
      lastName: 'علي',
      phone: null,
    })
    const created: Array<Record<string, unknown>> = []
    prisma.messageQueue.create.mockImplementation(async ({ data }) => {
      created.push(data)
      return { id: `mq-${created.length}` }
    })

    const res = await createAppointment(
      jsonReq('http://localhost/api/appointments', {
        patientId: 'pat-1',
        doctorId: 'dr-1',
        scheduledDate: '2027-06-15',
        scheduledTime: '10:00',
        duration: 30,
        contactPhone: '01234567890',
      })
    )
    expect(res.status).toBe(201)
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactPhone: '01234567890' }),
      })
    )
    const confirmation = created.find((c) => c.messageType === 'APPOINTMENT_CONFIRMATION')
    expect(confirmation.recipient).toBe('+201234567890') // override wins
  })
})

describe('prescription send (3F, item 22) — RBAC + tenant + PDF attachment', () => {
  const prescription = {
    id: 'rx-1',
    hospitalId: HOSPITAL,
    prescriptionNo: 'RX-0001',
    diagnosis: 'DDS',
    notes: null,
    patient: { id: 'pat-1', firstName: 'أحمد', lastName: 'محمد', phone: '+201012345678' },
    doctor: { id: 'dr-1', firstName: 'سمير', lastName: 'علي', phone: '+201198765432' },
    medications: [{ medicationName: 'Amoxicillin', dosage: '500mg', frequency: '3x/day', duration: '7 days' }],
  }

  it('DOCTOR can send: PDF attached, Arabic text, PENDING queue record', async () => {
    await authAs('DOCTOR')
    prisma.prescription.findFirst.mockResolvedValue(prescription)
    const created: Array<Record<string, unknown>> = []
    prisma.messageQueue.create.mockImplementation(async ({ data }) => {
      created.push(data)
      return { id: 'mq-1' }
    })

    const res = await sendPrescription(jsonReq('http://localhost/x', {}), {
      params: Promise.resolve({ id: 'rx-1' }),
    })
    expect(res.status).toBe(201)
    const row = created[0]
    expect(row.messageType).toBe('PRESCRIPTION')
    expect(row.recipient).toBe('+201012345678')
    const payload = row.payload as { text: string; attachment?: { data: string } }
    expect(payload.text).toContain('وصفتك الطبية من عيادة دنتورا 💊')
    expect(payload.attachment.mimeType).toBe('application/pdf')
    expect(Buffer.from(payload.attachment.data, 'base64').toString('latin1').startsWith('%PDF')).toBe(true)
  })

  it('RECEPTIONIST is denied (RBAC: DOCTOR, ADMIN only)', async () => {
    await authAs('RECEPTIONIST')
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: denied,
      hospitalId: HOSPITAL,
      user: { id: 'u-2', role: 'RECEPTIONIST' },
      session: { user: { id: 'u-2', role: 'RECEPTIONIST' } },
    })
    const res = await sendPrescription(jsonReq('http://localhost/x', {}), {
      params: Promise.resolve({ id: 'rx-1' }),
    })
    expect(res.status).toBe(401)
    expect(prisma.prescription.findFirst).not.toHaveBeenCalled()
  })

  it('foreign-hospital prescription → 404 (tenant isolation, item 28)', async () => {
    prisma.prescription.findFirst.mockResolvedValue(null)
    const res = await sendPrescription(jsonReq('http://localhost/x', {}), {
      params: Promise.resolve({ id: 'rx-other' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('invoice send (3G, item 23) — RBAC: ACCOUNTANT/ADMIN', () => {
  const invoice = {
    id: 'inv-1',
    hospitalId: HOSPITAL,
    invoiceNo: 'INV-0001',
    subtotal: 200,
    totalAmount: 250,
    paidAmount: 100,
    balanceAmount: 150,
    patient: { id: 'pat-1', firstName: 'أحمد', lastName: 'محمد', phone: '+201012345678' },
    items: [{ description: 'Cleaning', quantity: 1, amount: 250 }],
  }

  it('ACCOUNTANT can send: totals included, PDF attached', async () => {
    await authAs('ACCOUNTANT')
    prisma.invoice.findFirst.mockResolvedValue(invoice)
    const created: Array<Record<string, unknown>> = []
    prisma.messageQueue.create.mockImplementation(async ({ data }) => {
      created.push(data)
      return { id: 'mq-2' }
    })

    const res = await sendInvoice(jsonReq('http://localhost/x', {}), {
      params: Promise.resolve({ id: 'inv-1' }),
    })
    expect(res.status).toBe(201)
    const payload = created[0].payload as { text: string; attachment: { data: string } }
    expect(created[0].messageType).toBe('INVOICE')
    expect(payload.text).toContain('الإجمالي: 250.00 جنيه')
    expect(payload.attachment.mimeType).toBe('application/pdf')
  })

  it('DOCTOR is denied (RBAC: ACCOUNTANT, ADMIN)', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: denied,
      hospitalId: HOSPITAL,
      user: { id: 'u-3', role: 'DOCTOR' },
      session: { user: { id: 'u-3', role: 'DOCTOR' } },
    })
    const res = await sendInvoice(jsonReq('http://localhost/x', {}), {
      params: Promise.resolve({ id: 'inv-1' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('radiology send (3H, item 24) — reads patient-file storage, images only', () => {
  const doc = {
    id: 'doc-1',
    hospitalId: HOSPITAL,
    fileType: 'image/jpeg',
    filePath: 'uploads/xray-1.jpg',
    originalName: 'xray.jpg',
    fileName: 'xray.jpg',
    patient: { id: 'pat-1', firstName: 'أحمد', lastName: 'محمد', phone: '+201012345678' },
  }

  it('DOCTOR can send an image from the patient file', async () => {
    await authAs('DOCTOR')
    prisma.document.findFirst.mockResolvedValue(doc)
    const created: Array<Record<string, unknown>> = []
    prisma.messageQueue.create.mockImplementation(async ({ data }) => {
      created.push(data)
      return { id: 'mq-3' }
    })

    const res = await sendRadiology(jsonReq('http://localhost/x', {}), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(201)
    const payload = created[0].payload as { text: string; attachment: { data: string; mimeType: string } }
    expect(created[0].messageType).toBe('RADIOLOGY')
    expect(payload.text).toContain('نتيجة الأشعة من عيادة دنتورا 🦷')
    expect(payload.attachment.mimeType).toBe('image/jpeg')
    expect(payload.attachment.data).toBeTruthy()
  })

  it('rejects non-image documents (400)', async () => {
    await authAs('DOCTOR')
    prisma.document.findFirst.mockResolvedValue({ ...doc, fileType: 'application/pdf' })
    const res = await sendRadiology(jsonReq('http://localhost/x', {}), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('message log (3L, items 27/28) — ADMIN only, masked numbers', () => {
  it('returns masked recipients and never attachment bytes', async () => {
    prisma.messageQueue.findMany.mockResolvedValue([
      {
        id: 'mq-9',
        recipient: '+201012345678',
        channel: 'WHATSAPP',
        provider: 'mock-whatsapp',
        messageType: 'APPOINTMENT_CONFIRMATION',
        status: 'SENT',
        scheduledAt: new Date('2026-09-19T10:00:00Z'),
        sentAt: new Date('2026-09-19T10:00:05Z'),
        attempts: 1,
        lastError: null,
        payload: { text: 'مرحباً', attachment: { filename: 'a.pdf', mimeType: 'application/pdf', data: 'SECRETA' } },
        appointmentId: 'apt-1',
        patientId: 'pat-1',
      },
    ])
    prisma.messageQueue.count.mockResolvedValue(1)

    const res = await messageLog(new NextRequest('http://localhost/api/communications/messages'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0].recipientMasked).toBe('+2010****5678')
    expect(JSON.stringify(body)).not.toContain('SECRETA')
    expect(body.rows[0].hasAttachment).toBe(true)
    expect(body.total).toBe(1)
  })

  it('denies non-ADMIN roles (RBAC matrix)', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: denied,
      hospitalId: HOSPITAL,
      user: { id: 'u-4', role: 'DOCTOR' },
      session: { user: { id: 'u-4', role: 'DOCTOR' } },
    })
    const res = await messageLog(new NextRequest('http://localhost/api/communications/messages'))
    expect(res.status).toBe(401)
  })

  it('test message endpoint validates the number (ADMIN)', async () => {
    const bad = await testMessage(jsonReq('http://localhost/x', { to: 'nope' }))
    expect(bad.status).toBe(400)

    prisma.messageQueue.create.mockResolvedValue({ id: 'mq-t' })
    const ok = await testMessage(jsonReq('http://localhost/x', { to: '01012345678' }))
    expect(ok.status).toBe(201)
    expect(prisma.messageQueue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recipient: '+201012345678', messageType: 'TEST' }),
      })
    )
  })

  it('cancel/retry actions are ADMIN and tenant-scoped', async () => {
    // Mock respects the where clause so tenant scoping is actually exercised.
    prisma.messageQueue.findFirst.mockImplementation(async ({ where }) => {
      // The row only exists under hospital-OTHER — a where for hospital-1
      // must find nothing, exactly like the real tenant-scoped query.
      if (where.id === 'mq-9' && where.hospitalId === 'hospital-OTHER') {
        return { id: 'mq-9', hospitalId: 'hospital-OTHER', status: 'PENDING' }
      }
      return null
    })
    prisma.messageQueue.update.mockResolvedValue({ id: 'mq-9', status: 'CANCELLED' })
    // A message from another hospital is invisible to this tenant (item 28):
    // the scoped lookup finds nothing → cancel is refused.
    const foreign = await messageAction(jsonReq('http://localhost/x', { action: 'cancel' }, 'PATCH'), {
      params: Promise.resolve({ id: 'mq-9' }),
    })
    expect(foreign.status).toBe(400)

    // Same-tenant lookup succeeds.
    prisma.messageQueue.findFirst.mockImplementation(async ({ where }) =>
      where.id === 'mq-9' && where.hospitalId === HOSPITAL
        ? { id: 'mq-9', hospitalId: HOSPITAL, status: 'PENDING' }
        : null
    )
    const cancel = await messageAction(jsonReq('http://localhost/x', { action: 'cancel' }, 'PATCH'), {
      params: Promise.resolve({ id: 'mq-9' }),
    })
    expect(cancel.status).toBe(200)
  })
})

describe('cron processor (3B, item 19) — CRON_SECRET gated', () => {
  it('rejects without the secret and reports a summary with it', async () => {
    const denied = await cronMessages(new Request('http://localhost/api/cron/messages'))
    expect(denied.status).toBe(401)

    process.env.CRON_SECRET = 'test-secret'
    prisma.messageQueue.findMany.mockResolvedValue([])
    const ok = await cronMessages(
      new Request('http://localhost/api/cron/messages', {
        headers: { Authorization: 'Bearer test-secret' },
      })
    )
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body).toMatchObject({ ok: true, processed: 0, sent: 0 })
    delete process.env.CRON_SECRET
  })
})

describe('blocked slots management (2D) — ADMIN/DOCTOR-own RBAC', () => {
  it('ADMIN creates a clinic-wide block with validated times', async () => {
    prisma.blockedSlot.create.mockResolvedValue({ id: 'bs-1' })
    const ok = await createBlockedSlot(
      jsonReq('http://localhost/x', {
        startAt: '2027-06-15T07:00:00.000Z',
        endAt: '2027-06-15T09:00:00.000Z',
        reason: 'Meeting',
      })
    )
    expect(ok.status).toBe(201)
    const bad = await createBlockedSlot(
      jsonReq('http://localhost/x', { startAt: '2027-06-15T10:00:00.000Z', endAt: '2027-06-15T09:00:00.000Z' })
    )
    expect(bad.status).toBe(400)
  })
})

import { prisma } from '@/lib/prisma'
import { normalizeToE164, maskPhone } from '@/lib/phone'
import { sendWithFallback } from './factory'
import * as templates from './templates'
import type { MessagePayload } from './types'

/**
 * Message queue service (master prompt 3B, 3C–3J, 3L).
 * - Producers (appointment flows, prescription/invoice/radiology sends) only
 *   enqueue; the cron processor owns delivery with retry + dead-letter.
 * - All helpers are failure-isolated: messaging problems never break the
 *   clinical flow that triggered them.
 * - Recipients are normalized to E.164 before queueing; invalid numbers are
 *   logged (masked) and skipped without crashing.
 */

const MAX_ATTEMPTS = 3
/** Exponential backoff between attempts: 5 min, then 10 min. */
const backoffMs = (attempts: number) => 5 * 60_000 * Math.pow(2, Math.max(attempts - 1, 0))

type PrismaModel = typeof prisma.messageQueue

export interface QueueMessageInput {
  hospitalId: string
  appointmentId?: string | null
  patientId?: string | null
  recipient: string | null | undefined
  channel: 'WHATSAPP' | 'SMS'
  messageType:
    | 'APPOINTMENT_CONFIRMATION'
    | 'APPOINTMENT_REMINDER_24H'
    | 'APPOINTMENT_REMINDER_1H'
    | 'DOCTOR_NEW_APPOINTMENT'
    | 'DOCTOR_CANCELLATION'
    | 'DOCTOR_RESCHEDULE'
    | 'PRESCRIPTION'
    | 'INVOICE'
    | 'RADIOLOGY'
    | 'REVIEW_REQUEST'
    | 'TEST'
    | 'WELCOME' // Phase 13 — portal account activation (patient-facing)
  payload: MessagePayload
  scheduledAt?: Date
}

/** Enqueue one message. Returns the queue id, or null when skipped (invalid/missing recipient). */
export async function enqueueMessage(input: QueueMessageInput): Promise<string | null> {
  const e164 = normalizeToE164(input.recipient)
  if (!e164) {
    // Log invalid numbers without crashing (master prompt 3K) — masked only.
    console.warn(
      `[messaging] skipped ${input.messageType}: invalid recipient (${maskPhone(input.recipient ?? '')})`
    )
    return null
  }
  const row = await (prisma.messageQueue as PrismaModel).create({
    data: {
      hospitalId: input.hospitalId,
      appointmentId: input.appointmentId ?? null,
      patientId: input.patientId ?? null,
      recipient: e164,
      channel: input.channel,
      messageType: input.messageType,
      payload: input.payload as unknown as object,
      scheduledAt: input.scheduledAt ?? new Date(),
      status: 'PENDING',
    },
  })
  return row.id
}

export interface ClinicInfo {
  name: string
  address?: string | null
  phone?: string | null
}

async function getClinicInfo(hospitalId: string): Promise<ClinicInfo> {
  const hospital = await prisma.hospital.findUnique({
    where: { id: hospitalId },
    select: { name: true, address: true, phone: true },
  })
  return {
    name: hospital?.name || process.env.CLINIC_NAME || 'العيادة',
    address: hospital?.address || process.env.CLINIC_ADDRESS || null,
    phone: hospital?.phone || process.env.CLINIC_PHONE || null,
  }
}

function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface QueueableAppointment {
  id: string
  hospitalId: string
  scheduledDate: Date
  scheduledTime: string
  duration: number
  appointmentType?: string | null
  status?: string
  contactPhone?: string | null
  patient: { id: string; firstName: string; lastName: string; phone?: string | null }
  doctor: { id: string; firstName: string; lastName: string; phone?: string | null }
}

function templateAppointment(a: QueueableAppointment) {
  return {
    patientName: `${a.patient.firstName} ${a.patient.lastName}`,
    doctorName: `د. ${a.doctor.firstName} ${a.doctor.lastName}`,
    date: toDateKey(a.scheduledDate),
    time: a.scheduledTime,
    type: a.appointmentType,
  }
}

/**
 * Immediate messages on appointment creation (3C + 3J): patient confirmation,
 * doctor notification, plus the scheduled 24h/1h reminder pair (3D/3E).
 * Returns the number of messages actually queued.
 */
export async function queueAppointmentMessages(appointment: QueueableAppointment): Promise<number> {
  try {
    const [clinic, appointmentDate] = await Promise.all([
      getClinicInfo(appointment.hospitalId),
      Promise.resolve(new Date(appointment.scheduledDate)),
    ])
    const [hours, minutes] = appointment.scheduledTime.split(':').map(Number)
    const appointmentAt = new Date(appointmentDate)
    appointmentAt.setHours(hours || 0, minutes || 0, 0, 0)
    const ta = templateAppointment(appointment)

    let queued = 0

    // 3C — patient confirmation (immediate). Manual override number wins (3K).
    if (
      await enqueueMessage({
        hospitalId: appointment.hospitalId,
        appointmentId: appointment.id,
        patientId: appointment.patient.id,
        recipient: appointment.contactPhone || appointment.patient.phone,
        channel: 'WHATSAPP',
        messageType: 'APPOINTMENT_CONFIRMATION',
        payload: { text: templates.appointmentConfirmationPatient(clinic, ta) },
      })
    )
      queued++

    // 3J — doctor notification (immediate).
    if (
      await enqueueMessage({
        hospitalId: appointment.hospitalId,
        appointmentId: appointment.id,
        recipient: appointment.doctor.phone,
        channel: 'WHATSAPP',
        messageType: 'DOCTOR_NEW_APPOINTMENT',
        payload: { text: templates.appointmentConfirmationDoctor(ta) },
      })
    )
      queued++

    // 3D — 24h reminder (patient only).
    const at24 = new Date(appointmentAt.getTime() - 24 * 3600_000)
    if (
      at24.getTime() > Date.now() &&
      (await enqueueMessage({
        hospitalId: appointment.hospitalId,
        appointmentId: appointment.id,
        patientId: appointment.patient.id,
        recipient: appointment.contactPhone || appointment.patient.phone,
        channel: 'WHATSAPP',
        messageType: 'APPOINTMENT_REMINDER_24H',
        payload: { text: templates.reminder24h(clinic, ta) },
        scheduledAt: at24,
      }))
    )
      queued++

    // 3E — 1h reminder (patient only).
    const at1 = new Date(appointmentAt.getTime() - 3600_000)
    if (
      at1.getTime() > Date.now() &&
      (await enqueueMessage({
        hospitalId: appointment.hospitalId,
        appointmentId: appointment.id,
        patientId: appointment.patient.id,
        recipient: appointment.contactPhone || appointment.patient.phone,
        channel: 'WHATSAPP',
        messageType: 'APPOINTMENT_REMINDER_1H',
        payload: { text: templates.reminder1h(clinic, ta) },
        scheduledAt: at1,
      }))
    )
      queued++

    return queued
  } catch (err) {
    console.error('[messaging] queueAppointmentMessages failed (non-fatal):', err)
    return 0
  }
}

/** 3J — doctor notice when an appointment is cancelled. */
export async function queueDoctorCancellation(appointment: QueueableAppointment): Promise<number> {
  try {
    const ta = templateAppointment(appointment)
    return (await enqueueMessage({
      hospitalId: appointment.hospitalId,
      appointmentId: appointment.id,
      recipient: appointment.doctor.phone,
      channel: 'WHATSAPP',
      messageType: 'DOCTOR_CANCELLATION',
      payload: { text: templates.doctorCancellation(ta.patientName, ta.date) },
    }))
      ? 1
      : 0
  } catch (err) {
    console.error('[messaging] queueDoctorCancellation failed (non-fatal):', err)
    return 0
  }
}

/** 3J — doctor notice when an appointment is rescheduled. */
export async function queueDoctorReschedule(appointment: QueueableAppointment): Promise<number> {
  try {
    const ta = templateAppointment(appointment)
    return (await enqueueMessage({
      hospitalId: appointment.hospitalId,
      appointmentId: appointment.id,
      recipient: appointment.doctor.phone,
      channel: 'WHATSAPP',
      messageType: 'DOCTOR_RESCHEDULE',
      payload: { text: templates.doctorReschedule(ta.patientName, ta.date, ta.time) },
    }))
      ? 1
      : 0
  } catch (err) {
    console.error('[messaging] queueDoctorReschedule failed (non-fatal):', err)
    return 0
  }
}

/** 3I — post-visit review request, 24h after completion (infrastructure only). */
export async function queueReviewRequest(appointment: QueueableAppointment): Promise<number> {
  try {
    const clinic = await getClinicInfo(appointment.hospitalId)
    const patientName = `${appointment.patient.firstName} ${appointment.patient.lastName}`
    return (await enqueueMessage({
      hospitalId: appointment.hospitalId,
      appointmentId: appointment.id,
      patientId: appointment.patient.id,
      recipient: appointment.contactPhone || appointment.patient.phone,
      channel: 'WHATSAPP',
      messageType: 'REVIEW_REQUEST',
      payload: { text: templates.reviewRequest(clinic, patientName) },
      scheduledAt: new Date(Date.now() + 24 * 3600_000),
    }))
      ? 1
      : 0
  } catch (err) {
    console.error('[messaging] queueReviewRequest failed (non-fatal):', err)
    return 0
  }
}

export interface ProcessSummary {
  processed: number
  sent: number
  deadLettered: number
  retried: number
}

/**
 * Queue processor: claim due PENDING messages and deliver them with the
 * WhatsApp→SMS fallback strategy. Failure handling: attempts+1 with
 * exponential backoff; after MAX_ATTEMPTS the message dead-letters as FAILED
 * with the last error. Messages whose recipient is invalid at send time are
 * dead-lettered immediately with a clear error.
 */
export async function processDueMessages(limit = 50): Promise<ProcessSummary> {
  const summary: ProcessSummary = { processed: 0, sent: 0, deadLettered: 0, retried: 0 }
  const due = await prisma.messageQueue.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  })

  for (const row of due) {
    summary.processed++
    const payload = row.payload as unknown as MessagePayload
    if (!payload || typeof payload.text !== 'string' || !normalizeToE164(row.recipient)) {
      await prisma.messageQueue.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          lastError: 'Invalid message payload or recipient',
        },
      })
      summary.deadLettered++
      continue
    }

    const result = await sendWithFallback(row.recipient, payload, row.channel)
    const attempts = row.attempts + 1

    if (result.success) {
      await prisma.messageQueue.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          attempts,
          provider: result.providerUsed ?? null,
          lastError: null,
          // Phase 10 — provider correlation for webhook delivery tracking.
          providerMessageId: result.providerMessageId ?? null,
          deliveryStatus: 'SENT',
        },
      })
      summary.sent++
    } else if (attempts >= MAX_ATTEMPTS) {
      await prisma.messageQueue.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          attempts,
          lastError: result.attempts
            .map((a) => `${a.provider}: ${a.error}`)
            .join(' | ')
            .slice(0, 190),
          deliveryStatus: 'FAILED',
        },
      })
      summary.deadLettered++
    } else {
      await prisma.messageQueue.update({
        where: { id: row.id },
        data: {
          attempts,
          scheduledAt: new Date(Date.now() + backoffMs(attempts)),
          lastError: result.attempts
            .map((a) => `${a.provider}: ${a.error}`)
            .join(' | ')
            .slice(0, 190),
        },
      })
      summary.retried++
    }
  }

  return summary
}

export interface MaskedMessageLogRow {
  id: string
  recipientMasked: string
  channel: string
  provider: string | null
  providerMessageId: string | null
  deliveryStatus: string | null
  deliveredAt: Date | null
  readAt: Date | null
  messageType: string
  status: string
  scheduledAt: Date
  sentAt: Date | null
  attempts: number
  lastError: string | null
  textPreview: string
  hasAttachment: boolean
  appointmentId: string | null
  patientId: string | null
}

/**
 * 3L — message log for the ADMIN panel. Recipients are masked
 * (01x****xxxx style) and attachment bytes are never returned.
 */
export async function getMessageLog(options: {
  hospitalId: string
  status?: string
  channel?: string
  messageType?: string
  page?: number
  limit?: number
}): Promise<{ rows: MaskedMessageLogRow[]; total: number }> {
  const page = Math.max(options.page ?? 1, 1)
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100)
  const where: Record<string, unknown> = { hospitalId: options.hospitalId }
  if (options.status) where.status = options.status
  if (options.channel) where.channel = options.channel
  if (options.messageType) where.messageType = options.messageType

  const [rows, total] = await Promise.all([
    prisma.messageQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.messageQueue.count({ where }),
  ])

  return {
    total,
    rows: rows.map((row) => {
      const payload = row.payload as unknown as MessagePayload | null
      return {
        id: row.id,
        recipientMasked: maskPhone(row.recipient),
        channel: row.channel,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        deliveryStatus: row.deliveryStatus,
        deliveredAt: row.deliveredAt,
        readAt: row.readAt,
        messageType: row.messageType,
        status: row.status,
        scheduledAt: row.scheduledAt,
        sentAt: row.sentAt,
        attempts: row.attempts,
        lastError: row.lastError,
        textPreview: (payload?.text ?? '').slice(0, 120),
        hasAttachment: Boolean(payload?.attachment),
        appointmentId: row.appointmentId,
        patientId: row.patientId,
      }
    }),
  }
}

/** ADMIN: cancel a still-pending message (state transition, never a delete). */
export async function cancelQueuedMessage(id: string, hospitalId: string): Promise<boolean> {
  const row = await prisma.messageQueue.findFirst({ where: { id, hospitalId } })
  if (!row || row.status !== 'PENDING') return false
  await prisma.messageQueue.update({ where: { id }, data: { status: 'CANCELLED' } })
  return true
}

/** ADMIN: requeue a failed message for immediate retry. */
export async function retryQueuedMessage(id: string, hospitalId: string): Promise<boolean> {
  const row = await prisma.messageQueue.findFirst({ where: { id, hospitalId } })
  if (!row || row.status !== 'FAILED') return false
  await prisma.messageQueue.update({
    where: { id },
    data: { status: 'PENDING', attempts: 0, lastError: null, scheduledAt: new Date() },
  })
  return true
}

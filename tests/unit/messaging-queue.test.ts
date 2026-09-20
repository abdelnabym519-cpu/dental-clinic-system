// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Queue logic (3B) + fallback strategy (3A): retry with exponential backoff,
// dead-letter after 3 attempts, WhatsApp→SMS fallback, due-only processing.
// ---------------------------------------------------------------------------

const messageQueueRows: Map<string, Record<string, unknown>> = new Map()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageQueue: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        let rows = [...messageQueueRows.values()]
        if (where) {
          if (where.status) rows = rows.filter((r) => r.status === where.status)
          if (where.scheduledAt && typeof where.scheduledAt === 'object') {
            const lte = (where.scheduledAt as { lte?: Date }).lte
            if (lte) rows = rows.filter((r) => (r.scheduledAt as Date) <= lte)
          }
        }
        return rows
      }),
      count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        let rows = [...messageQueueRows.values()]
        if (where?.hospitalId) rows = rows.filter((r) => r.hospitalId === where.hospitalId)
        return rows.length
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messageQueueRows.get(where.id) ?? {}
        const merged = {
          ...row,
          ...data,
          attempts:
            typeof data.attempts === 'object' && data.attempts !== null && 'increment' in (data.attempts as object)
              ? (row.attempts as number) + (data.attempts as { increment: number }).increment
              : (data.attempts ?? row.attempts),
        }
        messageQueueRows.set(where.id, merged)
        return merged
      }),
      findFirst: vi.fn(async ({ where }) => messageQueueRows.get(where.id) ?? null),
      create: vi.fn(async ({ data }) => {
        const row = { id: `mq-${messageQueueRows.size + 1}`, ...data }
        messageQueueRows.set(row.id, row)
        return row
      }),
    },
    hospital: { findUnique: vi.fn(async () => ({ name: 'عيادة دنتورا', address: 'القاهرة', phone: '+201234567890' })) },
    patient: { findUnique: vi.fn(), findFirst: vi.fn() },
    staff: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}))

// Provider behavior is injected per test.
const providerBehavior = { failWhatsApp: false, failSms: false }
vi.mock('@/lib/messaging/factory', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    sendWithFallback: vi.fn(async (to: string, message: { text: string }, channel: string) => {
      const attempts: Array<Record<string, unknown>> = []
      if (channel !== 'SMS') {
        attempts.push({
          channel: 'WHATSAPP',
          provider: 'mock-whatsapp',
          success: !providerBehavior.failWhatsApp,
          error: providerBehavior.failWhatsApp ? 'whatsapp down' : undefined,
        })
        if (!providerBehavior.failWhatsApp) {
          return { success: true, attempts, providerUsed: 'mock-whatsapp', channelUsed: 'WHATSAPP' }
        }
      }
      attempts.push({
        channel: 'SMS',
        provider: 'mock-sms',
        success: !providerBehavior.failSms,
        error: providerBehavior.failSms ? 'sms gateway down' : undefined,
      })
      if (!providerBehavior.failSms) {
        return { success: true, attempts, providerUsed: 'mock-sms', channelUsed: 'SMS' }
      }
      return { success: false, attempts }
    }),
  }
})

import {
  processDueMessages,
  enqueueMessage,
  cancelQueuedMessage,
  retryQueuedMessage,
  getMessageLog,
} from '@/lib/messaging/service'
import { normalizeToE164 } from '@/lib/phone'

function seedRow(overrides: Record<string, unknown> = {}) {
  const row = {
    id: `mq-${messageQueueRows.size + 1}`,
    hospitalId: 'hospital-1',
    recipient: '+201012345678',
    channel: 'WHATSAPP',
    messageType: 'APPOINTMENT_REMINDER_24H',
    payload: { text: 'تذكير بموعدك 🔔' },
    scheduledAt: new Date(Date.now() - 60000), // due
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    sentAt: null,
    provider: null,
    ...overrides,
  }
  messageQueueRows.set(row.id, row)
  return row.id as string
}

beforeEach(() => {
  messageQueueRows.clear()
  providerBehavior.failWhatsApp = false
  providerBehavior.failSms = false
  vi.clearAllMocks()
})

describe('message queue processing (3B)', () => {
  it('sends a due message, stamps SENT with provider + timestamp', async () => {
    const id = seedRow()
    const summary = await processDueMessages()
    expect(summary.processed).toBe(1)
    expect(summary.sent).toBe(1)
    const row = messageQueueRows.get(id)
    expect(row.status).toBe('SENT')
    expect(row.provider).toBe('mock-whatsapp')
    expect(row.sentAt).toBeTruthy()
    expect(row.attempts).toBe(1)
  })

  it('ignores messages scheduled in the future', async () => {
    seedRow({ scheduledAt: new Date(Date.now() + 3600_000) })
    const summary = await processDueMessages()
    expect(summary.processed).toBe(0)
  })

  it('retries with exponential backoff and dead-letters after 3 attempts', async () => {
    providerBehavior.failWhatsApp = true
    providerBehavior.failSms = true
    const id = seedRow()

    const first = await processDueMessages()
    expect(first.retried).toBe(1)
    let row = messageQueueRows.get(id)
    const scheduledAfterFirst = (row.scheduledAt as Date).getTime()
    expect(scheduledAfterFirst).toBeGreaterThan(Date.now())

    // Bring it due again for attempts 2 and 3.
    ;(row as { scheduledAt: Date }).scheduledAt = new Date(Date.now() - 1000)
    await processDueMessages()
    row = messageQueueRows.get(id)
    expect(row.status).toBe('PENDING')
    expect(row.attempts).toBe(2)

    ;(row as { scheduledAt: Date }).scheduledAt = new Date(Date.now() - 1000)
    const third = await processDueMessages()
    expect(third.deadLettered).toBe(1)
    row = messageQueueRows.get(id)
    expect(row.status).toBe('FAILED')
    expect(row.attempts).toBe(3)
    expect(row.lastError).toContain('sms gateway down')
  })

  it('dead-letters immediately on an invalid payload/recipient', async () => {
    const id = seedRow({ recipient: 'not-a-phone' })
    const summary = await processDueMessages()
    expect(summary.deadLettered).toBe(1)
    expect(messageQueueRows.get(id).status).toBe('FAILED')
  })
})

describe('fallback strategy (3A): WhatsApp first, SMS on failure', () => {
  it('falls back to SMS when WhatsApp fails', async () => {
    providerBehavior.failWhatsApp = true
    const id = seedRow()
    await processDueMessages()
    const row = messageQueueRows.get(id)
    expect(row.status).toBe('SENT')
    expect(row.provider).toBe('mock-sms')
    expect(row.attempts).toBe(1)
  })
})

describe('enqueue + admin lifecycle', () => {
  it('normalizes the recipient at enqueue time (3K)', async () => {
    const id = await enqueueMessage({
      hospitalId: 'hospital-1',
      recipient: '01012345678',
      channel: 'WHATSAPP',
      messageType: 'TEST',
      payload: { text: 'مرحباً' },
    })
    expect(id).toBeTruthy()
    expect((messageQueueRows.get(id as string) as { recipient: string }).recipient).toBe(
      normalizeToE164('01012345678')
    )
  })

  it('skips invalid recipients, returning null (log-and-skip, no crash)', async () => {
    const id = await enqueueMessage({
      hospitalId: 'hospital-1',
      recipient: 'bad',
      channel: 'SMS',
      messageType: 'TEST',
      payload: { text: 'x' },
    })
    expect(id).toBeNull()
    expect(messageQueueRows.size).toBe(0)
  })

  it('cancel only affects PENDING rows; retry only FAILED rows', async () => {
    const pending = seedRow()
    expect(await cancelQueuedMessage(pending, 'hospital-1')).toBe(true)
    expect(messageQueueRows.get(pending).status).toBe('CANCELLED')
    expect(await cancelQueuedMessage(pending, 'hospital-1')).toBe(false) // already cancelled

    const failed = seedRow({ status: 'FAILED', attempts: 3, lastError: 'dead' })
    expect(await retryQueuedMessage(failed, 'hospital-1')).toBe(true)
    const row = messageQueueRows.get(failed)
    expect(row.status).toBe('PENDING')
    expect(row.attempts).toBe(0)

    const wrongHospital = seedRow({ hospitalId: 'hospital-2' })
    expect(await retryQueuedMessage(wrongHospital, 'hospital-1')).toBe(false) // tenant-scoped
  })

  it('the log masks recipients and never exposes attachment bytes (3L)', async () => {
    seedRow({
      recipient: '+201012345678',
      payload: { text: 'مرحباً', attachment: { filename: 'rx.pdf', mimeType: 'application/pdf', data: 'AAAA' } },
    })
    const { rows } = await getMessageLog({ hospitalId: 'hospital-1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].recipientMasked).not.toContain('12345678')
    expect(rows[0].recipientMasked).toContain('****')
    expect(JSON.stringify(rows[0])).not.toContain('AAAA')
    expect(rows[0].hasAttachment).toBe(true)
  })
})

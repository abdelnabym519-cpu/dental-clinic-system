// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// Issue 4 — the reports page showed "Could not parse your query. Try
// rephrasing." because the language model was not reachable, and any
// provider failure surfaced as a raw/technical message. The route must:
// (a) run PRESET reports without any LLM, (b) classify provider-down as
// AI_UNAVAILABLE (503) with Arabic guidance, (c) keep genuine parse
// failures distinct, (d) never leak raw payloads.

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
const mockComplete = vi.hoisted(() => ({ complete: vi.fn() }))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/ai/openrouter', () => ({ complete: mockComplete.complete, extractJSON: (s: string) => s }))
vi.mock('@/lib/ai/models', () => ({ getModelByTier: () => ({ model: 'test' }) }))
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

import { POST } from '@/app/api/ai/query/route'

function post(body: unknown) {
  return new Request('http://localhost/api/ai/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe('POST /api/ai/query — Issue 4 (LLM-down graceful degradation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null, user: { id: 'u1' }, hospitalId: 'h1',
    })
    prisma.aISkillExecution.create.mockResolvedValue({})
    mockComplete.complete.mockReset()
  })

  // ── presets run WITHOUT the LLM ──────────────────────────────────────────
  it('preset new_patients_monthly returns this-month patients, no LLM call', async () => {
    prisma.patient.findMany.mockResolvedValue([
      { firstName: 'أحمد', lastName: 'علي', patientId: 'P1', phone: '010', createdAt: new Date() },
    ])
    const res = await POST(post({ preset: 'new_patients_monthly' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.rowCount).toBe(1)
    expect(data.summary).toContain('المرضى الجدد')
    expect(mockComplete.complete).not.toHaveBeenCalled()
  })

  it('preset revenue_monthly sums collected invoices in Arabic', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { invoiceNo: 'INV-1', totalAmount: 500, paidAmount: 500, updatedAt: new Date(), patient: { firstName: 'س', lastName: 'م' } },
      { invoiceNo: 'INV-2', totalAmount: 300, paidAmount: 250, updatedAt: new Date(), patient: { firstName: 'ع', lastName: 'ل' } },
    ])
    const res = await POST(post({ preset: 'revenue_monthly' }))
    const data = await res.json()
    expect(data.summary).toContain('750.00')
    expect(data.summary).toContain('جنيه')
    expect(mockComplete.complete).not.toHaveBeenCalled()
  })

  it('preset top_procedures aggregates counts deterministically', async () => {
    prisma.treatment.findMany.mockResolvedValue([
      { procedure: { name: 'حشو' }, patient: {} },
      { procedure: { name: 'حشو' }, patient: {} },
      { procedure: { name: 'تنظيف' }, patient: {} },
    ])
    const res = await POST(post({ preset: 'top_procedures' }))
    const data = await res.json()
    expect(data.rows[0]).toEqual({ procedure: 'حشو', count: 2 })
    expect(data.rows[1]).toEqual({ procedure: 'تنظيف', count: 1 })
    expect(mockComplete.complete).not.toHaveBeenCalled()
  })

  it('an unknown preset is rejected honestly', async () => {
    const res = await POST(post({ preset: 'drop_table' }))
    expect(res.status).toBe(400)
  })

  // ── LLM failures are classified, never raw ──────────────────────────────
  it('provider unreachable → 503 AI_UNAVAILABLE with Arabic guidance', async () => {
    mockComplete.complete.mockRejectedValue(new TypeError('fetch failed'))
    const res = await POST(post({ query: 'إيرادات الشهر' }))
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.code).toBe('AI_UNAVAILABLE')
    expect(data.error).toContain('نموذج الذكاء الاصطناعي')
    expect(data.error).toContain('التقارير الجاهزة')
    expect(data.error).not.toContain('fetch failed')
  })

  it('missing API key → 503 AI_UNAVAILABLE (not "could not parse")', async () => {
    mockComplete.complete.mockRejectedValue(new Error('OPENROUTER_API_KEY is not set. Add it to your .env file.'))
    const res = await POST(post({ query: 'any' }))
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.code).toBe('AI_UNAVAILABLE')
  })

  it('a genuine unparseable model answer → 400 PARSE_FAILED in Arabic', async () => {
    mockComplete.complete.mockResolvedValue({ content: 'not json at all', usage: {}, model: 't' })
    const res = await POST(post({ query: 'سؤال معقد' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('PARSE_FAILED')
    expect(data.error).toMatch(/[\u0600-\u06FF]/)
    expect(data.error).not.toContain('Could not parse')
  })
})

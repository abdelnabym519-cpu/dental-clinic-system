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
vi.mock('@/lib/ai/gateway', () => ({ complete: mockComplete.complete, extractJSON: (s: string) => s }))
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
  it('provider unreachable on a NON-report query → 503 AI_UNAVAILABLE with Arabic guidance', async () => {
    // ('إيرادات الشهر' is now served deterministically — see the NL fallback
    // block below; this contract needs a query outside the four intents.)
    mockComplete.complete.mockRejectedValue(new TypeError('fetch failed'))
    const res = await POST(post({ query: 'من أقدم الأطباء في العيادة؟' }))
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.code).toBe('AI_UNAVAILABLE')
    expect(data.error).toContain('نموذج الذكاء الاصطناعي')
    expect(data.error).toContain('التقارير الجاهزة')
    expect(data.error).not.toContain('fetch failed')
  })

  it('missing API key → 503 AI_UNAVAILABLE (not "could not parse")', async () => {
    mockComplete.complete.mockRejectedValue(
      Object.assign(new Error('خدمة الذكاء الاصطناعي غير مهيأة — أضف بيانات Cloudflare AI Gateway إلى إعدادات الخادم.'), {
        name: 'AIUnavailableError',
        code: 'AI_NOT_CONFIGURED',
        correlationId: 'test-correlation',
      })
    )
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

  // ── Issue 4 hardening — NL intent routing (Egyptian Arabic) ─────────────
  // The six sample queries from the Issue 4 prompt must be served
  // deterministically (no LLM, no key needed) and labeled honestly.
  const SAMPLES: Array<[string, string, RegExp]> = [
    ['وريني عدد المرضى الجدد', 'patient', /المرضى الجدد/],
    ['قولي إيرادات العيادة', 'invoice', /الإيرادات/],
    ['وريني المواعيد الملغية', 'appointment', /المواعيد الملغاة/],
    ['إيه أكتر الإجراءات اللي اتعملت؟', 'treatment', /أكثر الإجراءات/],
    ['اعمل تقرير عن المرضى الجدد', 'patient', /المرضى الجدد/],
    ['اعمل تقرير عن الإيرادات', 'invoice', /الإيرادات/],
  ]
  for (const [query, prismaModel, summaryRe] of SAMPLES) {
    it(`NL fallback (no LLM): "${query}" → deterministic + honest labeling`, async () => {
      ;(prisma[prismaModel] as any).findMany.mockResolvedValue([])
      const res = await POST(post({ query }))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.mode).toBe('deterministic')
      expect(data.notice).toContain('بدون نموذج ذكاء اصطناعي')
      expect(data.summary).toMatch(summaryRe)
      // NEVER claims AI inference that did not happen
      expect(data.summary).not.toContain('الذكاء الاصطناعي')
      expect(mockComplete.complete).not.toHaveBeenCalled()
    })
  }

  it('NL fallback respects Cairo date words: النهارده → today window (gte AND lt)', async () => {
    prisma.patient.findMany.mockResolvedValue([])
    const res = await POST(post({ query: 'المرضى الجدد النهارده' }))
    expect(res.status).toBe(200)
    const where = prisma.patient.findMany.mock.calls[0][0].where
    expect(where.hospitalId).toBe('h1') // tenant isolation in the same where
    expect(where.createdAt.gte).toBeInstanceOf(Date)
    expect(where.createdAt.lt).toBeInstanceOf(Date)
    // [gte, lt) is exactly one Cairo day
    expect(where.createdAt.lt.getTime() - where.createdAt.gte.getTime()).toBe(24 * 3600_000)
  })

  it('NL fallback with امبارح → yesterday window (still exactly one day)', async () => {
    prisma.invoice.findMany.mockResolvedValue([])
    await POST(post({ query: 'إيرادات العيادة امبارح' }))
    const where = prisma.invoice.findMany.mock.calls[0][0].where
    expect(where.updatedAt.gte).toBeInstanceOf(Date)
    expect(where.updatedAt.lt.getTime() - where.updatedAt.gte.getTime()).toBe(24 * 3600_000)
    expect(where.status).toBe('PAID')
  })

  it('deterministic reports are audit-logged but never write domain data', async () => {
    prisma.patient.findMany.mockResolvedValue([])
    await POST(post({ query: 'وريني عدد المرضى الجدد' }))
    // only the skill-execution audit row is written
    expect(prisma.aISkillExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skill: 'nl_report_new_patients' }),
      })
    )
    expect(prisma.patient.create).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('tenant isolation: deterministic builders always scope by the caller hospitalId', async () => {
    prisma.appointment.findMany.mockResolvedValue([])
    await POST(post({ query: 'المواعيد الملغية' }))
    const where = prisma.appointment.findMany.mock.calls[0][0].where
    expect(where.hospitalId).toBe('h1')
    expect(where.status).toBe('CANCELLED')
  })

  it('unauthenticated users are rejected before any report logic (RBAC)', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      user: null,
      hospitalId: null,
    })
    const res = await POST(post({ query: 'وريني عدد المرضى الجدد' }))
    expect(res.status).toBe(401)
  })

  it('NL queries that match NO intent still reach the LLM path (MODE A preserved)', async () => {
    mockComplete.complete.mockResolvedValue({
      content: '{"model":"patient","filters":{},"limit":5,"summary":"أقدم المرضى"}',
      usage: {},
      model: 't',
    })
    prisma.patient.findMany.mockResolvedValue([])
    const res = await POST(post({ query: 'رتب المرضى بالعمر' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.mode).toBe('ai')
    expect(mockComplete.complete).toHaveBeenCalled()
  })

  it('DB failure inside a deterministic report → Arabic 500, no Prisma text', async () => {
    prisma.patient.findMany.mockRejectedValue(new Error('P2021: table does not exist at db.host'))
    const res = await POST(post({ query: 'وريني عدد المرضى الجدد' }))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toContain('تعذر إنشاء التقرير')
    expect(data.error).not.toContain('P2021')
    expect(data.error).not.toContain('db.host')
  })

  it('DB failure inside the LLM path → Arabic 500, no raw err.message', async () => {
    mockComplete.complete.mockResolvedValue({
      content: '{"model":"patient","filters":{},"limit":5}',
      usage: {},
      model: 't',
    })
    prisma.patient.findMany.mockRejectedValue(new Error('Invalid prisma.patient.findMany() invocation'))
    const res = await POST(post({ query: 'رتب المرضى بالعمر' }))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toContain('تعذر إنشاء التقرير')
    expect(data.error).not.toContain('prisma')
    expect(data.error).not.toContain('invocation')
  })

  it('unparseable model output naming an unknown source never echoes it back', async () => {
    mockComplete.complete.mockResolvedValue({
      content: '{"model":"DROP_TABLE Patients","filters":{}}',
      usage: {},
      model: 't',
    })
    const res = await POST(post({ query: 'رتب المرضى بالعمر' }))
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(JSON.stringify(data)).not.toContain('DROP_TABLE')
    expect(data.code).toBe('PARSE_FAILED')
  })
})

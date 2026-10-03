import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { complete, extractJSON } from '@/lib/ai/openrouter'
import { getModelByTier } from '@/lib/ai/models'

/**
 * Whitelisted query specs — maps "model" names to safe Prisma query builders.
 * The AI outputs a spec; we only execute if the model is in this whitelist.
 */
const QUERY_BUILDERS: Record<
  string,
  (hospitalId: string, filters: Record<string, any>, limit: number) => Promise<any>
> = {
  invoice: async (hospitalId, filters, limit) => {
    const where: any = { hospitalId }
    if (filters.status) where.status = filters.status
    if (filters.minBalance) where.balanceAmount = { gte: Number(filters.minBalance) }
    return prisma.invoice.findMany({
      where,
      include: { patient: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  },
  patient: async (hospitalId, filters, limit) => {
    const where: any = { hospitalId }
    if (filters.name) {
      where.OR = [
        { firstName: { contains: filters.name } },
        { lastName: { contains: filters.name } },
      ]
    }
    if (filters.minAge) where.age = { gte: Number(filters.minAge) }
    return prisma.patient.findMany({
      where,
      select: { firstName: true, lastName: true, patientId: true, age: true, phone: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  },
  appointment: async (hospitalId, filters, limit) => {
    const where: any = { hospitalId }
    if (filters.status) where.status = filters.status
    if (filters.date) {
      const d = new Date(filters.date + 'T00:00:00')
      if (!isNaN(d.getTime())) where.scheduledDate = d
    }
    return prisma.appointment.findMany({
      where,
      include: {
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledDate: 'desc' },
      take: limit,
    })
  },
  treatment: async (hospitalId, filters, limit) => {
    const where: any = { hospitalId }
    if (filters.status) where.status = filters.status
    return prisma.treatment.findMany({
      where,
      include: {
        patient: { select: { firstName: true, lastName: true } },
        procedure: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  },
  inventoryItem: async (hospitalId, filters, limit) => {
    const where: any = { hospitalId }
    if (filters.lowStock) where.currentStock = { lte: filters.reorderLevel || 20 }
    return prisma.inventoryItem.findMany({
      where,
      select: {
        name: true,
        currentStock: true,
        reorderLevel: true,
        minimumStock: true,
        unit: true,
      },
      take: limit,
    })
  },
}

const AVAILABLE_MODELS = Object.keys(QUERY_BUILDERS).join(', ')

function queryTranslatorPrompt(naturalQuery: string) {
  return `You translate natural-language questions into structured query specs for a dental clinic database.

Available models: ${AVAILABLE_MODELS}

Model fields reference:
- invoice:        status (DRAFT|PENDING|PARTIALLY_PAID|PAID|OVERDUE|CANCELLED), balanceAmount
- patient:        name, age
- appointment:    status (SCHEDULED|CONFIRMED|COMPLETED|CANCELLED|NO_SHOW), date
- treatment:      status (PLANNED|IN_PROGRESS|COMPLETED|CANCELLED)
- inventoryItem:  lowStock (boolean flag – set true to get items at or below reorder level)

Respond ONLY with JSON:
{
  "model": "<one of: ${AVAILABLE_MODELS}>",
  "filters": { ... },
  "limit": <number, max 50>,
  "summary": "<plain English restatement of the query>"
}

User query: "${naturalQuery}"`
}

// ── Issue 4 — pre-built reports (NO LLM needed) ────────────────────────────
// When the language model is not configured/reachable, the reports page must
// still work: these presets run whitelisted, tenant-scoped queries directly.
const startOfMonth = (now: Date) => new Date(now.getFullYear(), now.getMonth(), 1)

const PRESET_BUILDERS: Record<string, (hospitalId: string, now: Date) => Promise<{ summary: string; rows: any[] }>> = {
  new_patients_monthly: async (hospitalId, now) => {
    const since = startOfMonth(now)
    const rows = await prisma.patient.findMany({
      where: { hospitalId, createdAt: { gte: since } },
      select: { firstName: true, lastName: true, patientId: true, phone: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return { summary: `المرضى الجدد هذا الشهر: ${rows.length}`, rows }
  },
  revenue_monthly: async (hospitalId, now) => {
    const since = startOfMonth(now)
    const rows = await prisma.invoice.findMany({
      where: { hospitalId, status: 'PAID', updatedAt: { gte: since } },
      select: { invoiceNo: true, totalAmount: true, paidAmount: true, updatedAt: true, patient: { select: { firstName: true, lastName: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
    const total = rows.reduce((s: number, r: any) => s + Number(r.paidAmount ?? 0), 0)
    return { summary: `إيرادات هذا الشهر (فواتير محصّلة): ${total.toFixed(2)} جنيه من ${rows.length} فاتورة`, rows }
  },
  cancelled_appointments: async (hospitalId, now) => {
    const since = startOfMonth(now)
    const rows = await prisma.appointment.findMany({
      where: { hospitalId, status: 'CANCELLED', scheduledDate: { gte: since } },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledDate: 'desc' },
      take: 50,
    })
    return { summary: `المواعيد الملغاة هذا الشهر: ${rows.length}`, rows }
  },
  top_procedures: async (hospitalId, now) => {
    const since = startOfMonth(now)
    const rows = await prisma.treatment.findMany({
      where: { hospitalId, createdAt: { gte: since } },
      include: { procedure: { select: { name: true } }, patient: { select: { firstName: true, lastName: true } } },
      take: 200,
    })
    const counts = new Map<string, number>()
    for (const t of rows) {
      const name = t.procedure?.name ?? 'غير محدد'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const summary_rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([procedure, count]) => ({ procedure, count }))
    return { summary: `أكثر الإجراءات طلبًا هذا الشهر (من ${rows.length} علاجًا)`, rows: summary_rows }
  },
}

function aiUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as any)?.cause ?? '')}` : String(err)
  return (
    msg.includes('OPENROUTER_API_KEY') ||
    msg.includes('OpenRouter [') ||
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('abort')
  )
}

export async function POST(req: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { query?: string; preset?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { query, preset } = body

  // Issue 4 — preset reports run WITHOUT the language model (deterministic,
  // whitelisted, tenant-scoped). This is the fallback path that keeps the
  // reports page functional when the LLM is not configured or unreachable.
  if (typeof preset === 'string' && PRESET_BUILDERS[preset]) {
    try {
      const { summary, rows } = await PRESET_BUILDERS[preset](hospitalId, new Date())
      await prisma.aISkillExecution.create({
        data: { hospitalId, userId: user.id, skill: `preset_${preset}`, input: { preset } as any, output: { rowCount: rows.length } as any, status: 'COMPLETED' },
      })
      return NextResponse.json({ summary, model: preset, rowCount: rows.length, rows })
    } catch (err) {
      console.error('Preset report error:', err)
      return NextResponse.json({ error: 'حدث خطأ أثناء توليد التقرير — حاول مرة أخرى' }, { status: 500 })
    }
  }

  if (!query?.trim()) return NextResponse.json({ error: 'query is required' }, { status: 400 })

  // Step 1: translate to spec
  let spec: { model: string; filters: Record<string, any>; limit?: number; summary?: string }
  try {
    const { content } = await complete(
      [{ role: 'system', content: queryTranslatorPrompt(query) }],
      getModelByTier('query')
    )
    spec = JSON.parse(extractJSON(content))
  } catch (err) {
    // Issue 4 — the user must NEVER see a raw error or a misleading "rephrase"
    // hint when the real problem is that the model is not available.
    if (aiUnavailableError(err)) {
      return NextResponse.json(
        { error: 'خاصية التقارير الذكية تحتاج إلى تفعيل نموذج الذكاء الاصطناعي المحلي. استخدم التقارير الجاهزة بالأسفل — تعمل بدون نموذج.', code: 'AI_UNAVAILABLE' },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: 'لم نتمكن من تحليل سؤالك — جرّب إعادة صياغته أو استخدم التقارير الجاهزة بالأسفل.', code: 'PARSE_FAILED' },
      { status: 400 },
    )
  }

  // Step 2: validate model is whitelisted
  const builder = QUERY_BUILDERS[spec.model]
  if (!builder) {
    return NextResponse.json({ error: `Unsupported data source: ${spec.model}` }, { status: 400 })
  }

  // Step 3: execute
  const limit = Math.min(spec.limit || 10, 50)
  let rows: any[]
  try {
    rows = await builder(hospitalId, spec.filters || {}, limit)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Query execution error' },
      { status: 500 }
    )
  }

  // Log
  await prisma.aISkillExecution.create({
    data: {
      hospitalId,
      userId: user.id,
      skill: 'nl_query',
      input: { query, spec } as any,
      output: { rowCount: rows.length } as any,
      status: 'COMPLETED',
    },
  })

  return NextResponse.json({
    summary: spec.summary || query,
    model: spec.model,
    rowCount: rows.length,
    rows,
  })
}

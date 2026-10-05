// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'
import { validateEditablePrice, MAX_EDITABLE_PRICE } from '@/lib/money'

// ---------------------------------------------------------------------------
// Issue 7 — Editable Prices harness.
//
// Canonical current price = Procedure.basePrice (Decimal(10,2), per-tenant).
// Historical charged amounts = Treatment.cost (snapshot at treatment
// creation), InvoiceItem.unitPrice/amount (snapshot at invoicing),
// Payment.amount — none of which a price edit may touch.
//
// Covered write paths (the only three that mutate a price):
//   • PUT /api/settings/procedures/[id]  (ADMIN — the settings UI path)
//   • POST /api/settings/procedures      (ADMIN — create with a price)
//   • PUT /api/procedures/[id]           (ADMIN+DOCTOR — legacy path that
//     previously validated NOTHING)
//   • PUT /api/treatments/[id]           (ADMIN+DOCTOR — pre-invoice charge)
// ---------------------------------------------------------------------------

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

function req(method: string, body?: unknown, url = 'http://localhost/x') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never
}
const ctx = { params: Promise.resolve({ id: 'proc-1' }) }
const tctx = { params: Promise.resolve({ id: 'tr-1' }) }

const asRole = (role: string) =>
  mockAuth.requireAuthAndRole.mockImplementation(async (roles) => {
    if (roles && !roles.includes(role)) {
      return {
        error: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
        hospitalId: null,
        session: null,
      }
    }
    return { error: null, hospitalId: 'h1', session: { user: { id: 'u1', role } } }
  })

const unauthenticated = () =>
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    hospitalId: null,
    session: null,
  })

const existingProcedure = { id: 'proc-1', hospitalId: 'h1', code: 'PRV001', basePrice: 500 }

beforeEach(() => {
  vi.clearAllMocks()
  asRole('ADMIN')
  prisma.procedure.findUnique.mockResolvedValue({ ...existingProcedure })
  prisma.procedure.update.mockResolvedValue({ ...existingProcedure, basePrice: 650 })
  prisma.procedure.findFirst.mockResolvedValue(null)
  prisma.treatment.findUnique.mockResolvedValue({
    id: 'tr-1',
    hospitalId: 'h1',
    status: 'IN_PROGRESS',
    cost: 500,
  })
  prisma.treatment.update.mockResolvedValue({ id: 'tr-1', cost: 650 })
})

// ─── the canonical validator itself ────────────────────────────────────────

describe('validateEditablePrice (lib/money)', () => {
  it('accepts valid positive prices with at most 2 decimals', () => {
    expect(validateEditablePrice(650)).toEqual({ ok: true, value: 650 })
    expect(validateEditablePrice(650.5).ok).toBe(true)
    expect(validateEditablePrice(19.99).ok).toBe(true)
    expect(validateEditablePrice(0.01).ok).toBe(true)
    expect(validateEditablePrice(MAX_EDITABLE_PRICE).ok).toBe(true)
  })
  it('rejects non-numbers, NaN, Infinity and numeric strings', () => {
    for (const bad of ['650', null, undefined, NaN, Infinity, -Infinity, {}, true]) {
      expect(validateEditablePrice(bad).ok).toBe(false)
    }
  })
  it('rejects negatives and (by policy) zero', () => {
    expect(validateEditablePrice(-1).ok).toBe(false)
    expect(validateEditablePrice(0).ok).toBe(false)
    expect(validateEditablePrice(0, { allowZero: true }).ok).toBe(true)
  })
  it('rejects float artifacts and sub-cent precision', () => {
    expect(validateEditablePrice(0.1 + 0.2).ok).toBe(false)
    expect(validateEditablePrice(499.999).ok).toBe(false)
    expect(validateEditablePrice(1e21).ok).toBe(false)
  })
  it('rejects values beyond Decimal(10,2) capacity', () => {
    expect(validateEditablePrice(MAX_EDITABLE_PRICE + 0.01).ok).toBe(false)
  })
  it('always answers in Arabic', async () => {
    const { validateEditablePrice: v } = await import('@/lib/money')
    for (const bad of [-3, 'x', NaN, 1.999, 2e20]) {
      expect(v(bad).error).toMatch(/[\u0600-\u06FF]/)
    }
  })
})

// ─── P1/P8/P11/P12 — authorized update on the settings path ───────────────

describe('PUT /api/settings/procedures/[id] (canonical price edit)', () => {
  it('P1: ADMIN updates the catalog price; only the price changes', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    const res = await PUT(req('PUT', { basePrice: 650 }), ctx)
    expect(res.status).toBe(200)
    expect(prisma.procedure.update).toHaveBeenCalledTimes(1)
    expect(prisma.procedure.update.mock.calls[0][0].data.basePrice).toBe(650)
    const body = await res.json()
    expect(body.data.basePrice).toBe(650) // P11: the new price is echoed back
  })

  it('P12: a rejected update never reaches persistence (atomic by guard order)', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    const res = await PUT(req('PUT', { basePrice: -5 }), ctx)
    expect(res.status).toBe(400)
    expect(prisma.procedure.update).not.toHaveBeenCalled()
  })

  it('P2: DOCTOR and RECEPTIONIST are denied on the settings path', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    for (const role of ['DOCTOR', 'RECEPTIONIST']) {
      vi.clearAllMocks()
      asRole(role)
      const res = await PUT(req('PUT', { basePrice: 650 }), ctx)
      expect(res.status).toBe(403)
      expect(prisma.procedure.update).not.toHaveBeenCalled()
    }
  })

  it('P3: unauthenticated requests are rejected', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    unauthenticated()
    const res = await PUT(req('PUT', { basePrice: 650 }), ctx)
    expect(res.status).toBe(401)
  })

  it('P4/P5: another tenant’s price and an unknown id are NOT FOUND, never edited', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    prisma.procedure.findUnique.mockResolvedValue(null) // foreign id → no row in h1
    const res = await PUT(req('PUT', { basePrice: 650 }), ctx)
    expect(res.status).toBe(404)
    // the lookup itself was tenant-scoped
    expect(prisma.procedure.findUnique).toHaveBeenCalledWith({ where: { id: 'proc-1', hospitalId: 'h1' } })
    expect(prisma.procedure.update).not.toHaveBeenCalled()
  })

  it('P6/P7/P8/P9: invalid prices get an Arabic 400 and mutate nothing', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    for (const bad of [-1, 0, '650', 'abc', null, 499.999, 0.1 + 0.2, MAX_EDITABLE_PRICE + 1, 1e21]) {
      const res = await PUT(req('PUT', { basePrice: bad }), ctx)
      expect(res.status, `case ${String(bad)}`).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/[\u0600-\u06FF]/)
      expect(prisma.procedure.update).not.toHaveBeenCalled()
    }
  })

  it('P14: a malformed payload returns Arabic 400 without Zod internals; a DB failure a safe Arabic 500', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    const zodRes = await PUT(req('PUT', { defaultDuration: 'not-a-number' }), ctx)
    expect(zodRes.status).toBe(400)
    const zodBody = await zodRes.json()
    expect(zodBody.error).toMatch(/[\u0600-\u06FF]/)
    expect(zodBody.error).not.toContain('expected')
    expect(zodBody.error).not.toContain('Received')

    vi.clearAllMocks()
    asRole('ADMIN')
    prisma.procedure.findUnique.mockRejectedValue(new Error('PrismaClientKnownRequestError P2002'))
    const dbRes = await PUT(req('PUT', { basePrice: 650 }), ctx)
    expect(dbRes.status).toBe(500)
    const dbBody = await dbRes.json()
    expect(dbBody.error).toMatch(/[\u0600-\u06FF]/)
    expect(dbBody.error).not.toContain('Prisma')
  })
})

// ─── POST /api/settings/procedures (create with a price) ───────────────────

describe('POST /api/settings/procedures', () => {
  const payload = {
    code: 'PRV999',
    name: 'تنظيف',
    category: 'PREVENTIVE',
    defaultDuration: 30,
    basePrice: 350,
  }

  it('P1: a valid price persists; P8/P9 invalid prices are Arabic-400', async () => {
    const { POST } = await import('@/app/api/settings/procedures/route')
    prisma.procedure.findFirst.mockResolvedValue(null)
    prisma.procedure.create.mockResolvedValue({ id: 'new', ...payload })
    const ok = await POST(req('POST', payload))
    expect(ok.status).toBe(200)
    expect(prisma.procedure.create.mock.calls[0][0].data.basePrice).toBe(350)

    for (const bad of [-1, 0, 499.999, '350']) {
      const res = await POST(req('POST', { ...payload, basePrice: bad }))
      expect(res.status, `case ${String(bad)}`).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/[\u0600-\u06FF]/)
      expect(prisma.procedure.create).toHaveBeenCalledTimes(1) // only the valid one
    }
  })
})

// ─── legacy PUT /api/procedures/[id] — now under the same price rule ──────

describe('PUT /api/procedures/[id] (legacy path, RBAC unchanged)', () => {
  it('P1: DOCTOR may still update (existing RBAC) and a valid price persists', async () => {
    const { PUT } = await import('@/app/api/procedures/[id]/route')
    vi.clearAllMocks()
    asRole('DOCTOR')
    const res = await PUT(req('PUT', { basePrice: 700 }, 'http://localhost/api/procedures/proc-1'), ctx)
    expect(res.status).toBe(200)
    expect(prisma.procedure.update.mock.calls[0][0].data.basePrice).toBe(700)
  })

  it('P6/P7: the previously unvalidated path now rejects bad prices in Arabic', async () => {
    const { PUT } = await import('@/app/api/procedures/[id]/route')
    for (const bad of [-5, '500', NaN, 99.9999]) {
      const res = await PUT(req('PUT', { basePrice: bad }, 'http://localhost/api/procedures/proc-1'), ctx)
      expect(res.status, `case ${String(bad)}`).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/[\u0600-\u06FF]/)
      expect(prisma.procedure.update).not.toHaveBeenCalled()
    }
  })

  it('P2: RECEPTIONIST remains denied (existing 403 semantics)', async () => {
    const { PUT } = await import('@/app/api/procedures/[id]/route')
    vi.clearAllMocks()
    asRole('RECEPTIONIST')
    const res = await PUT(req('PUT', { basePrice: 700 }, 'http://localhost/api/procedures/proc-1'), ctx)
    expect(res.status).toBe(403)
  })
})

// ─── PUT /api/treatments/[id] — the pre-invoice charge ────────────────────

describe('PUT /api/treatments/[id] (treatment charge)', () => {
  it('P1: DOCTOR may adjust the charge while the treatment is open', async () => {
    const { PUT } = await import('@/app/api/treatments/[id]/route')
    vi.clearAllMocks()
    asRole('DOCTOR')
    const res = await PUT(req('PUT', { cost: 650 }, 'http://localhost/api/treatments/tr-1'), tctx)
    expect(res.status).toBe(200)
    expect(prisma.treatment.update.mock.calls[0][0].data.cost).toBe(650)
  })

  it('P6/P9: negative and zero charges are rejected in Arabic (zero was never a stored price)', async () => {
    const { PUT } = await import('@/app/api/treatments/[id]/route')
    for (const bad of [-1, 0, '500', 50.005]) {
      const res = await PUT(req('PUT', { cost: bad }, 'http://localhost/api/treatments/tr-1'), tctx)
      expect(res.status, `case ${String(bad)}`).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/[\u0600-\u06FF]/)
      expect(prisma.treatment.update).not.toHaveBeenCalled()
    }
  })

  it('P2: the existing completed/cancelled guard still wins over any price edit', async () => {
    const { PUT } = await import('@/app/api/treatments/[id]/route')
    vi.clearAllMocks()
    asRole('DOCTOR') // only ADMIN bypasses the completion lock
    prisma.treatment.findUnique.mockResolvedValue({
      id: 'tr-1',
      hospitalId: 'h1',
      status: 'COMPLETED',
      cost: 500,
    })
    const res = await PUT(req('PUT', { cost: 650 }, 'http://localhost/api/treatments/tr-1'), tctx)
    expect(res.status).toBe(400) // existing business guard, unchanged
    expect(prisma.treatment.update).not.toHaveBeenCalled()
  })
})

// ─── P10 — historical financial integrity (the mandatory test) ────────────

describe('P10 — editing the catalog price never mutates historical records', () => {
  it('a price edit writes ONLY to Procedure — no invoice/payment/treatment writes', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    const res = await PUT(req('PUT', { basePrice: 650 }), ctx)
    expect(res.status).toBe(200)

    expect(prisma.procedure.update).toHaveBeenCalledTimes(1)
    // the entire historical financial layer is untouched by this route:
    expect(prisma.invoice.update).not.toHaveBeenCalled()
    expect(prisma.invoiceItem.update).not.toHaveBeenCalled()
    expect(prisma.invoiceItem.create).not.toHaveBeenCalled()
    expect(prisma.payment.update).not.toHaveBeenCalled()
    expect(prisma.payment.create).not.toHaveBeenCalled()
    expect(prisma.treatment.update).not.toHaveBeenCalled()
    expect(prisma.treatmentPlan.update).not.toHaveBeenCalled()
    expect(prisma.treatmentPlanItem.update).not.toHaveBeenCalled()
  })

  it('data-flow proof: invoice lines snapshot unitPrice — they never read Procedure.basePrice', async () => {
    // Source-level invariant (mocked-DB evidence labeled as such):
    // InvoiceItem rows persist their own unitPrice/amount at invoice time;
    // unbilled-treatments prices lines from Treatment.cost (NOT the catalog),
    // and Treatment.cost is NOT NULL, set from the catalog at creation only.
    const invSrc = await import('node:fs').then((fs) =>
      fs.readFileSync('app/api/invoices/route.ts', 'utf8')
    )
    expect(invSrc).toMatch(/unitPrice:\s*item\.unitPrice/) // client-supplied snapshot persisted
    const unbilled = await import('node:fs').then((fs) =>
      fs.readFileSync('app/api/billing/unbilled-treatments/route.ts', 'utf8')
    )
    expect(unbilled).toContain('treatment.cost || treatment.procedure?.basePrice')
    const schema = await import('node:fs').then((fs) => fs.readFileSync('prisma/schema.prisma', 'utf8'))
    // Treatment.cost is NOT NULL — the basePrice fallback above is therefore
    // only for in-memory projections, never for stored treatments.
    expect(schema).toMatch(/model Treatment \{[\s\S]*?cost\s+Decimal\s+@db\.Decimal\(10, 2\)/)
  })
})

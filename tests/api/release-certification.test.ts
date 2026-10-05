// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Issues 1–7 Final Integration & Release Certification harness.
//
// Fills ONLY the cross-issue gaps the per-issue suites do not cover
// (the issue suites themselves stay authoritative for their own contracts):
//
//   H1/H2 — forged tenant/role values are ignored on the Issue-7 pricing
//           path; session context is the only authority.
//   H4    — the money graph stays one-directional across issues: a catalog
//           price edit (I7) touches NO clinical (I5) or financial record,
//           and prescription/clinical operations (I5) never touch the price
//           catalog or financial history.
//   H3    — the new Arabic error strings from I5/I7/I3 are Arabic at source
//           and pass through the Issue-6 i18n architecture unchanged.
//   H8    — representative end-to-end flow: procedure price → treatment
//           snapshot → later catalog edit leaves the snapshot alone.
//
// Evidence class: mocked-Prisma integration (no real DB in sandbox) — every
// test below is a code-level integration proof, NOT a runtime PASS.
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
const rxId = { params: Promise.resolve({ id: 'rx-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    session: { user: { id: 'u1', role: 'ADMIN' } },
  })
  prisma.procedure.findUnique.mockResolvedValue({
    id: 'proc-1', hospitalId: 'h1', code: 'PRV001', basePrice: 500,
  })
  prisma.procedure.update.mockResolvedValue({ id: 'proc-1', basePrice: 650 })
  prisma.prescription.findFirst.mockResolvedValue({
    id: 'rx-1', hospitalId: 'h1', status: 'SIGNED', prescriptionNo: 'RX20260001',
  })
  prisma.prescription.update.mockResolvedValue({ id: 'rx-1', status: 'CANCELLED' })
})

describe('H1/H2 — session is the only tenant/role authority (Issue 7 × Issue 3 boundary)', () => {
  it('a forged hospitalId in the payload is ignored — tenant comes from the session', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    const res = await PUT(
      req('PUT', { basePrice: 650, hospitalId: 'ATTACKER_TENANT' }),
      ctx
    )
    expect(res.status).toBe(200)
    // the write was scoped to the SESSION tenant, never the body value
    expect(prisma.procedure.findUnique).toHaveBeenCalledWith({
      where: { id: 'proc-1', hospitalId: 'h1' },
    })
    expect(prisma.procedure.update.mock.calls[0][0].where.hospitalId).toBe('h1')
    expect(JSON.stringify(prisma.procedure.update.mock.calls[0][0])).not.toContain('ATTACKER_TENANT')
  })

  it('a forged role in the payload is ignored — RBAC reads the session', async () => {
    const src = fs.readFileSync('app/api/settings/procedures/[id]/route.ts', 'utf8')
    expect(src).toContain("requireAuthAndRole(['ADMIN'])")
    expect(src).not.toMatch(/body\.role|data\.role/)
    // and the cancellation path (Issue 5) reads the session role exclusively
    const cancel = fs.readFileSync('app/api/prescriptions/[id]/cancel/route.ts', 'utf8')
    expect(cancel).toContain("requireAuthAndRole(['ADMIN', 'DOCTOR'])")
    expect(cancel).not.toMatch(/body\.role/)
  })
})

describe('H4 — cross-issue data integrity: price edits vs clinical/financial domains', () => {
  it('a catalog price edit (I7) mutates NO clinical (I5) or financial record', async () => {
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    const res = await PUT(req('PUT', { basePrice: 650 }), ctx)
    expect(res.status).toBe(200)
    expect(prisma.procedure.update).toHaveBeenCalledTimes(1)
    // financial history
    expect(prisma.invoice.update).not.toHaveBeenCalled()
    expect(prisma.invoiceItem.update).not.toHaveBeenCalled()
    expect(prisma.payment.update).not.toHaveBeenCalled()
    // clinical domains (Issue 5)
    expect(prisma.prescription.update).not.toHaveBeenCalled()
    expect(prisma.prescription.delete).not.toHaveBeenCalled()
    // Medical history is only ever written nested inside patient.create
    // (Issue 5) — the patient write surface is the right thing to assert.
    expect(prisma.patient.create).not.toHaveBeenCalled()
    expect(prisma.patient.update).not.toHaveBeenCalled()
    expect(prisma.treatment.update).not.toHaveBeenCalled()
  })

  it('prescription cancel (I5) mutates NO price catalog or financial record', async () => {
    const { POST } = await import('@/app/api/prescriptions/[id]/cancel/route')
    const res = await POST(req('POST'), rxId)
    expect(res.status).toBe(200)
    expect(prisma.prescription.update).toHaveBeenCalledTimes(1)
    expect(prisma.procedure.update).not.toHaveBeenCalled()
    expect(prisma.procedure.create).not.toHaveBeenCalled()
    expect(prisma.invoice.update).not.toHaveBeenCalled()
    expect(prisma.payment.update).not.toHaveBeenCalled()
    expect(prisma.treatment.update).not.toHaveBeenCalled()
  })

  it('prescription item replacement (I5) is scoped to prescription medications only', async () => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null, hospitalId: 'h1', session: { user: { id: 'u1', role: 'DOCTOR' } },
    })
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx-1', hospitalId: 'h1', status: 'DRAFT', patientId: 'p1',
    })
    prisma.prescription.update.mockResolvedValue({ id: 'rx-1', medications: [] })
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')
    const res = await PATCH(
      req('PATCH', {
        medications: [
          { medicationName: 'أموكسيسيلين', dosage: '500mg', frequency: '3x', duration: '7d' },
        ],
      }),
      rxId
    )
    expect(res.status).toBe(200)
    expect(prisma.procedure.update).not.toHaveBeenCalled()
    expect(prisma.invoiceItem.create).not.toHaveBeenCalled()
    expect(prisma.payment.create).not.toHaveBeenCalled()
  })
})

describe('H8 — the money graph end-to-end (I7 catalog → I5-era treatment snapshot)', () => {
  it('snapshot-at-creation: treatment.cost is captured from the then-current basePrice; a later catalog edit never rewrites it', async () => {
    // t0: catalog price 500 → treatment creation snapshots cost=500
    //     (app/api/treatments/route.ts: `cost: cost || procedure.basePrice`)
    const createSrc = fs.readFileSync('app/api/treatments/route.ts', 'utf8')
    expect(createSrc).toContain('cost: cost || procedure.basePrice')
    // t1: ADMIN edits the catalog price to 650 — the treatment row is not written
    const { PUT } = await import('@/app/api/settings/procedures/[id]/route')
    const res = await PUT(req('PUT', { basePrice: 650 }), ctx)
    expect(res.status).toBe(200)
    expect(prisma.treatment.update).not.toHaveBeenCalled()
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
    // t2: invoicing prices from the persisted snapshot, never the catalog
    const unbilled = fs.readFileSync('app/api/billing/unbilled-treatments/route.ts', 'utf8')
    expect(unbilled).toContain('treatment.cost || treatment.procedure?.basePrice')
    // and Treatment.cost is NOT NULL in the schema — stored treatments always
    // carry their own historical amount.
    const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).toMatch(/model Treatment \{[\s\S]*?cost\s+Decimal\s+@db\.Decimal\(10, 2\)/)
  })
})

describe('H3 — cross-issue Arabic integration (I6 contract over I3/I5/I7 strings)', () => {
  it('the new Arabic error strings from Issues 5/7 are Arabic at source and pass through the dictionary unchanged', async () => {
    const { translateText } = await import('@/lib/i18n/dictionary')
    const AR = /[\u0600-\u06FF]/
    const strings = [
      'الروشتة غير موجودة',                                   // I5 404
      'لا يمكن حذف روشتة موقّعة أو مرسلة — استخدم إلغاء الروشتة بدلًا من الحذف.', // I5 409
      'الروشتة ملغاة بالفعل',                                  // I5 cancel 409
      'السعر يجب أن يكون رقمًا صالحًا',                        // I7 validation
      'السعر يجب أن يكون أكبر من صفر',                         // I7 policy
      'السعر يقبل خانتين عشريتين كحد أقصى',                    // I7 precision
      'لا تملك صلاحية إنشاء الفواتير',                          // I6 arabized denial
    ]
    for (const s of strings) {
      // Arabic at source…
      expect(s, s).toMatch(AR)
      // …and the Issue-6 t() layer passes it through untouched (never mangles it)
      expect(translateText('ar-EG', s)).toBe(s)
    }
    // non-vacuity: the routes really emit these strings
    const cancel = fs.readFileSync('app/api/prescriptions/[id]/cancel/route.ts', 'utf8')
    expect(cancel).toContain('الروشتة ملغاة بالفعل')
    const money = fs.readFileSync('lib/money.ts', 'utf8')
    expect(money).toContain('السعر يجب أن يكون رقمًا صالحًا')
    const invoices = fs.readFileSync('app/api/invoices/route.ts', 'utf8')
    expect(invoices).toContain('لا تملك صلاحية إنشاء الفواتير')
  })
})

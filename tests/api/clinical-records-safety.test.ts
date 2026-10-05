// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// ---------------------------------------------------------------------------
// Issue 5 — clinical data safety harness for Medical History + Prescriptions.
// Contracts under test (all mocked-DB integration level; NOT runtime PASS):
//   • prescriptions: server-side medication validation (Arabic 400s),
//     tenant isolation, PATCH medication replacement is ATOMIC ($transaction),
//     cancel lifecycle (DRAFT/SIGNED/SENT → CANCELLED, irreversible),
//     hard delete restricted to DRAFT, RBAC, no raw internal errors.
//   • medical history: patient-create sanitization (no arbitrary-field
//     smuggling into the 1:1 history row), Arabic validation, tenant scope.
// ---------------------------------------------------------------------------

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
  checkPatientLimit: vi.fn(),
  requireRole: vi.fn(),
  PLAN_LIMITS: {
    FREE: { patientLimit: 100, staffLimit: 3, storageLimitMb: 500 },
    PROFESSIONAL: { patientLimit: -1, staffLimit: -1, storageLimitMb: -1 },
    ENTERPRISE: { patientLimit: -1, staffLimit: -1, storageLimitMb: -1 },
    SELF_HOSTED: { patientLimit: -1, staffLimit: -1, storageLimitMb: -1 },
  },
}))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

function makeReq(url: string, method = 'GET', body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never
}
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

const VALID_MED = {
  medicationName: 'أموكسيسيلين 500',
  dosage: '500mg',
  frequency: '3 مرات يوميًا',
  duration: '7 أيام',
}

describe('Issue 5 — prescription create validation & safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'h1',
      session: { user: { id: 'u1', role: 'DOCTOR' } },
    })
    prisma.patient.findFirst.mockResolvedValue({ id: 'p1', hospitalId: 'h1' })
    prisma.staff.findFirst.mockResolvedValue({ id: 'staff-1' })
    prisma.prescription.findFirst.mockResolvedValue(null)
    prisma.prescription.create.mockResolvedValue({ id: 'rx-1' })
    prisma.aISkillExecution?.create?.mockResolvedValue?.({})
  })

  it('C1: rejects a medication missing dosage with an Arabic 400 (was a raw Prisma 500)', async () => {
    const { POST } = await import('@/app/api/prescriptions/route')
    const res = await POST(
      makeReq('http://localhost/api/prescriptions', 'POST', {
        patientId: 'p1',
        medications: [{ medicationName: 'دواء بلا جرعة' }],
      })
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('كل دواء يحتاج')
    expect(data.error).toMatch(/[\u0600-\u06FF]/)
  })

  it('C2: rejects a medication missing frequency/duration with Arabic 400', async () => {
    const { POST } = await import('@/app/api/prescriptions/route')
    const res = await POST(
      makeReq('http://localhost/api/prescriptions', 'POST', {
        patientId: 'p1',
        medications: [{ ...VALID_MED, frequency: '' }],
      })
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('كل دواء يحتاج')
  })

  it('C3: rejects a non-positive quantity with Arabic 400', async () => {
    const { POST } = await import('@/app/api/prescriptions/route')
    const res = await POST(
      makeReq('http://localhost/api/prescriptions', 'POST', {
        patientId: 'p1',
        medications: [{ ...VALID_MED, quantity: 0 }],
      })
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('كمية الدواء')
  })

  it('C4: a valid prescription is created atomically (nested medication create)', async () => {
    const { POST } = await import('@/app/api/prescriptions/route')
    const res = await POST(
      makeReq('http://localhost/api/prescriptions', 'POST', {
        patientId: 'p1',
        diagnosis: 'تسوس',
        medications: [VALID_MED],
      })
    )
    expect(res.status).toBe(201)
    // patient verified within the tenant
    expect(prisma.patient.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', hospitalId: 'h1' },
    })
    const created = prisma.prescription.create.mock.calls[0][0]
    expect(created.data.hospitalId).toBe('h1')
    expect(created.data.doctorId).toBe('staff-1')
    // nested create ⇒ single atomic write, no orphan path
    expect(created.data.medications.create[0].medicationName).toBe(VALID_MED.medicationName)
  })

  it('C5: a patient from ANOTHER tenant is NOT FOUND (no existence leak)', async () => {
    prisma.patient.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/prescriptions/route')
    const res = await POST(
      makeReq('http://localhost/api/prescriptions', 'POST', {
        patientId: 'foreign-patient',
        medications: [VALID_MED],
      })
    )
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('المريض غير موجود')
  })

  it('C6: creation failure → Arabic 500 with no Prisma/internal text', async () => {
    prisma.prescription.create.mockRejectedValue(
      new Error('Invalid `prisma.prescription.create()` invocation at line 1')
    )
    const { POST } = await import('@/app/api/prescriptions/route')
    const res = await POST(
      makeReq('http://localhost/api/prescriptions', 'POST', {
        patientId: 'p1',
        medications: [VALID_MED],
      })
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toContain('تعذر إنشاء الروشتة')
    expect(data.error).not.toContain('prisma')
    expect(data.error).not.toContain('invocation')
  })

  it('C7: RBAC — creation requires ADMIN or DOCTOR', async () => {
    const { POST } = await import('@/app/api/prescriptions/route')
    await POST(
      makeReq('http://localhost/api/prescriptions', 'POST', {
        patientId: 'p1',
        medications: [VALID_MED],
      })
    )
    expect(mockAuth.requireAuthAndRole).toHaveBeenCalledWith(['ADMIN', 'DOCTOR'])
  })
})

describe('Issue 5 — PATCH atomic medication replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'h1',
      session: { user: { id: 'u1', role: 'DOCTOR' } },
    })
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
      patientId: 'p1',
    })
  })

  it('T1: medication replacement runs inside $transaction (no orphan path)', async () => {
    prisma.prescription.update.mockResolvedValue({ id: 'rx-1', medications: [] })
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')
    const res = await PATCH(
      makeReq('http://localhost/api/prescriptions/rx-1', 'PATCH', { medications: [VALID_MED] }),
      makeParams('rx-1')
    )
    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalled()
    // both writes happened inside the transaction (tx === mocked client)
    expect(prisma.prescriptionMedication.deleteMany).toHaveBeenCalled()
    expect(prisma.prescriptionMedication.createMany).toHaveBeenCalled()
  })

  it('T2: a mid-flight failure rolls back — Arabic 500, items NOT left deleted', async () => {
    prisma.prescriptionMedication.createMany.mockRejectedValue(new Error('write conflict at page'))
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route')
    const res = await PATCH(
      makeReq('http://localhost/api/prescriptions/rx-1', 'PATCH', { medications: [VALID_MED] }),
      makeParams('rx-1')
    )
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toContain('تعذر تحديث الروشتة')
    expect(data.error).not.toContain('write conflict')
    // the prescription header was never updated in the failed transaction
    expect(prisma.prescription.update).not.toHaveBeenCalled()
  })
})

describe('Issue 5 — cancel lifecycle + delete guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'h1',
      session: { user: { id: 'u1', role: 'DOCTOR' } },
    })
    prisma.prescription.update.mockResolvedValue({
      id: 'rx-1',
      status: 'CANCELLED',
      prescriptionNo: 'RX20260001',
    })
  })

  it('L1: DRAFT → CANCELLED succeeds (schema state finally reachable)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
      prescriptionNo: 'RX20260001',
    })
    const { POST } = await import('@/app/api/prescriptions/[id]/cancel/route')
    const res = await POST(makeReq('http://localhost/x', 'POST'), makeParams('rx-1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.data.status).toBe('CANCELLED')
    expect(prisma.prescription.update).toHaveBeenCalledWith({
      where: { id: 'rx-1' },
      data: { status: 'CANCELLED' },
      select: { id: true, status: true, prescriptionNo: true },
    })
  })

  it('L2: a SIGNED prescription can be cancelled (record preserved, not deleted)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'SIGNED',
      prescriptionNo: 'RX20260002',
    })
    const { POST } = await import('@/app/api/prescriptions/[id]/cancel/route')
    const res = await POST(makeReq('http://localhost/x', 'POST'), makeParams('rx-1'))
    expect(res.status).toBe(200)
    expect(prisma.prescription.delete).not.toHaveBeenCalled()
  })

  it('L3: already-cancelled → 409 Arabic (irreversible, no silent re-activation)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'CANCELLED',
      prescriptionNo: 'RX20260003',
    })
    const { POST } = await import('@/app/api/prescriptions/[id]/cancel/route')
    const res = await POST(makeReq('http://localhost/x', 'POST'), makeParams('rx-1'))
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toContain('ملغاة بالفعل')
  })

  it('L4: another tenant prescription is NOT FOUND', async () => {
    prisma.prescription.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/prescriptions/[id]/cancel/route')
    const res = await POST(makeReq('http://localhost/x', 'POST'), makeParams('rx-foreign'))
    expect(res.status).toBe(404)
    expect(prisma.prescription.update).not.toHaveBeenCalled()
  })

  it('L5: cancel is DOCTOR/ADMIN only', async () => {
    const { POST } = await import('@/app/api/prescriptions/[id]/cancel/route')
    await POST(makeReq('http://localhost/x', 'POST'), makeParams('rx-1'))
    expect(mockAuth.requireAuthAndRole).toHaveBeenCalledWith(['ADMIN', 'DOCTOR'])
  })

  it('L6: hard DELETE is refused for a SIGNED prescription (Arabic, use cancel)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'SIGNED',
    })
    const { DELETE } = await import('@/app/api/prescriptions/[id]/route')
    const res = await DELETE(makeReq('http://localhost/x', 'DELETE'), makeParams('rx-1'))
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toContain('إلغاء الروشتة')
    expect(prisma.prescription.delete).not.toHaveBeenCalled()
  })

  it('L7: hard DELETE still works for a DRAFT (never-issued document)', async () => {
    prisma.prescription.findFirst.mockResolvedValue({
      id: 'rx-1',
      hospitalId: 'h1',
      status: 'DRAFT',
    })
    prisma.prescription.delete.mockResolvedValue({ id: 'rx-1' })
    const { DELETE } = await import('@/app/api/prescriptions/[id]/route')
    const res = await DELETE(makeReq('http://localhost/x', 'DELETE'), makeParams('rx-1'))
    expect(res.status).toBe(200)
    expect(prisma.prescription.delete).toHaveBeenCalledWith({ where: { id: 'rx-1' } })
  })
})

describe('Issue 5 — medical history sanitization at patient creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'h1',
      session: { user: { id: 'u1', role: 'RECEPTIONIST' } },
    })
    prisma.patient.findFirst.mockResolvedValue(null)
    prisma.patient.create.mockResolvedValue({ id: 'p-new' })
    mockAuth.checkPatientLimit.mockResolvedValue({ allowed: true, current: 1, max: 100 })
  })

  it('H1: arbitrary/smuggled fields are stripped from the history row', async () => {
    const { POST } = await import('@/app/api/patients/route')
    const res = await POST(
      makeReq('http://localhost/api/patients', 'POST', {
        firstName: 'أحمد',
        lastName: 'سعيد',
        phone: '01001234567',
        medicalHistory: {
          hasAllergies: true,
          drugAllergies: 'بنسلين',
          // smuggled fields that must never reach Prisma:
          patientId: 'OTHER_PATIENT',
          hospitalId: 'OTHER_TENANT',
          id: 'forged-cuid',
          createdAt: '2001-01-01T00:00:00Z',
          dbStatement: 'DROP TABLE "MedicalHistory"',
        },
      })
    )
    expect(res.status).toBe(201)
    const created = prisma.patient.create.mock.calls[0][0]
    const history = created.data.medicalHistory.create
    expect(history.hasAllergies).toBe(true)
    expect(history.drugAllergies).toBe('بنسلين')
    expect(history.patientId).toBeUndefined()
    expect(history.hospitalId).toBeUndefined()
    expect(history.id).toBeUndefined()
    expect(history.createdAt).toBeUndefined()
    expect(history.dbStatement).toBeUndefined()
  })

  it('H2: typed coercion — invalid ints/enums dropped, valid ones kept', async () => {
    const { POST } = await import('@/app/api/patients/route')
    await POST(
      makeReq('http://localhost/api/patients', 'POST', {
        firstName: 'س',
        lastName: 'م',
        phone: '01111111111',
        medicalHistory: {
          pregnancyWeeks: 'not-a-number',
          dentalAnxietyLevel: 7,
          smokingStatus: 'CURRENT',
          alcoholConsumption: 'HACKED',
        },
      })
    )
    const history = prisma.patient.create.mock.calls[0][0].data.medicalHistory.create
    expect(history.pregnancyWeeks).toBeUndefined()
    expect(history.dentalAnxietyLevel).toBe(7)
    expect(history.smokingStatus).toBe('CURRENT')
    expect(history.alcoholConsumption).toBeUndefined()
  })

  it('H3: Arabic validation for missing required fields', async () => {
    const { POST } = await import('@/app/api/patients/route')
    const res = await POST(
      makeReq('http://localhost/api/patients', 'POST', { firstName: 'أ' })
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/[\u0600-\u06FF]/)
    expect(data.error).toContain('الهاتف')
  })

  it('H4: the history row is always created inside the caller tenant', async () => {
    const { POST } = await import('@/app/api/patients/route')
    await POST(
      makeReq('http://localhost/api/patients', 'POST', {
        firstName: 'أ',
        lastName: 'ب',
        phone: '01222222222',
        medicalHistory: { hasAllergies: true },
      })
    )
    const created = prisma.patient.create.mock.calls[0][0]
    expect(created.data.hospitalId).toBe('h1')
  })
})

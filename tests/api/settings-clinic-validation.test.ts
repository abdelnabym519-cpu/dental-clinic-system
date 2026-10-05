// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// Issue 3 — the clinic settings form showed the RAW Zod JSON array
// ([{"code":"invalid_format","format":"url",…},{"code":"too_small",…}]) in
// the toast. The API must return 400 + one friendly Arabic line, and the
// pincode must be 6–8 digits.

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

import { GET, POST } from '@/app/api/settings/clinic/route'

function post(body: unknown) {
  return new Request('http://localhost/api/settings/clinic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

const validClinic = {
  name: 'عيادة النيل لطب الأسنان',
  phone: '01012345678',
  address: '15 شارع التحرير',
  city: 'القاهرة',
  state: 'القاهرة',
  pincode: '115135',
}

describe('POST /api/settings/clinic — Issue 3 validation regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: null, hospitalId: 'h1' })
    prisma.hospital.update.mockResolvedValue({ id: 'h1' })
  })

  it('bad website URL + short pincode → 400 with ONE Arabic line, never raw Zod JSON', async () => {
    const res = await POST(post({ ...validClinic, website: 'not-a-url', pincode: '123' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(typeof data.error).toBe('string')
    expect(data.error).not.toMatch(/^\s*[\[{]/) // no raw JSON array/object
    expect(data.error).toContain('https://')
    expect(data.error).toContain('الرمز السري')
    expect(data.error).toMatch(/[\u0600-\u06FF]/)
  })

  it('non-numeric pincode is rejected with the Arabic message', async () => {
    const res = await POST(post({ ...validClinic, pincode: 'abc12345' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('أرقام')
  })

  it('pincode longer than 8 digits is rejected', async () => {
    const res = await POST(post({ ...validClinic, pincode: '123456789' }))
    expect(res.status).toBe(400)
  })

  it('empty website string is ACCEPTED (optional field)', async () => {
    const res = await POST(post({ ...validClinic, website: '' }))
    expect(res.status).toBe(200)
    expect(prisma.hospital.update).toHaveBeenCalledTimes(1)
  })

  it('a valid payload still saves (no over-blocking)', async () => {
    const res = await POST(post({ ...validClinic, website: 'https://dentora.example' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('unexpected (non-validation) failures keep the honest 500 path', async () => {
    prisma.hospital.update.mockRejectedValue(new Error('db down'))
    const res = await POST(post(validClinic))
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Issue 3 hardening — the full 25-contract matrix from the Issue 3 prompt.
// ---------------------------------------------------------------------------
describe('POST /api/settings/clinic — Issue 3 hardening (website/pincode/phone/error-safety)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: null, hospitalId: 'h1' })
    prisma.hospital.update.mockResolvedValue({ id: 'h1' })
  })

  // ── Website ────────────────────────────────────────────────────────────
  it('W1: empty website accepted (optional)', async () => {
    const res = await POST(post({ ...validClinic, website: '' }))
    expect(res.status).toBe(200)
  })

  it('W2: whitespace-only website normalized to not-provided and accepted', async () => {
    const res = await POST(post({ ...validClinic, website: '    ' }))
    expect(res.status).toBe(200)
    const saved = prisma.hospital.update.mock.calls[0][0].data
    expect(saved.website).toBeUndefined()
  })

  it('W3: valid https URL accepted', async () => {
    const res = await POST(post({ ...validClinic, website: 'https://dentora.example/clinic' }))
    expect(res.status).toBe(200)
  })

  it('W4: invalid URL rejected', async () => {
    const res = await POST(post({ ...validClinic, website: 'definitely not a url' }))
    expect(res.status).toBe(400)
  })

  it('W5: invalid URL error is Arabic and never raw validation JSON', async () => {
    const res = await POST(post({ ...validClinic, website: 'ftp://files.example' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(typeof data.error).toBe('string')
    expect(data.error).toContain('https://')
    expect(data.error).toMatch(/[\u0600-\u06FF]/)
    expect(data.error).not.toMatch(/\{.*code.*\}/)
  })

  // ── Pincode ────────────────────────────────────────────────────────────
  it('P1: six-digit pincode accepted', async () => {
    const res = await POST(post({ ...validClinic, pincode: '123456' }))
    expect(res.status).toBe(200)
  })

  it('P2: eight-digit pincode accepted', async () => {
    const res = await POST(post({ ...validClinic, pincode: '12345678' }))
    expect(res.status).toBe(200)
  })

  it('P3: five-digit pincode rejected', async () => {
    const res = await POST(post({ ...validClinic, pincode: '12345' }))
    expect(res.status).toBe(400)
  })

  it('P4: nine-digit pincode rejected', async () => {
    const res = await POST(post({ ...validClinic, pincode: '123456789' }))
    expect(res.status).toBe(400)
  })

  it('P5: alphabetic pincode rejected', async () => {
    const res = await POST(post({ ...validClinic, pincode: 'ABC123' }))
    expect(res.status).toBe(400)
  })

  it('P6: mixed alphanumeric pincode rejected', async () => {
    const res = await POST(post({ ...validClinic, pincode: '12345A' }))
    expect(res.status).toBe(400)
  })

  it('P7: pincode error is Arabic without raw validation details', async () => {
    const res = await POST(post({ ...validClinic, pincode: '12' }))
    const data = await res.json()
    expect(data.error).toContain('الرمز السري')
    expect(data.error).not.toMatch(/regex|Zod|invalid_string/)
  })

  // ── Phone (canonical Egyptian rule shared with the WhatsApp gateway) ───
  it('PH1: valid Egyptian mobile accepted', async () => {
    const res = await POST(post({ ...validClinic, phone: '01001234567' }))
    expect(res.status).toBe(200)
  })

  it('PH2: +20-prefixed Egyptian mobile accepted (Egyptianization-aware)', async () => {
    const res = await POST(post({ ...validClinic, phone: '+20 100 123 4567' }))
    expect(res.status).toBe(200)
  })

  it('PH3: Egyptian landline accepted (seeded clinic data stays editable)', async () => {
    const res = await POST(post({ ...validClinic, phone: '0222345678' }))
    expect(res.status).toBe(200)
  })

  it('PH4: invalid phone rejected with an Arabic message', async () => {
    const res = await POST(post({ ...validClinic, phone: '12345' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('رقم هاتف')
  })

  it('PH5: missing phone rejected', async () => {
    const { phone, ...withoutPhone } = validClinic as any
    const res = await POST(post(withoutPhone))
    expect(res.status).toBe(400)
  })

  it('PH6: whitespace-only phone rejected (was accepted by min(10)!)', async () => {
    const res = await POST(post({ ...validClinic, phone: '          ' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('رقم هاتف')
  })

  it('PH7: alphabetic phone rejected (was accepted by min(10)!)', async () => {
    const res = await POST(post({ ...validClinic, phone: 'abcdefghijk' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('رقم هاتف')
  })

  // ── Error safety ───────────────────────────────────────────────────────
  it('E1: validation failure can never leak raw JSON', async () => {
    const res = await POST(post({ name: '', phone: 'x', address: '', city: '', state: '', pincode: 'x' }))
    const data = await res.json()
    expect(typeof data.error).toBe('string')
    expect(data.error).not.toMatch(/^\s*[\[{]/)
  })

  it('E2: Prisma/database failure is normalized to one safe Arabic line', async () => {
    prisma.hospital.update.mockRejectedValue(
      new Error('Invalid `prisma.hospital.update()` invocation in /app/… P2002: Unique constraint failed')
    )
    const res = await POST(post(validClinic))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toContain('تعذر حفظ بيانات العيادة')
    expect(data.error).not.toContain('prisma')
    expect(data.error).not.toContain('P2002')
    expect(data.error).not.toContain('constraint')
  })

  it('E3: GET failure produces a safe Arabic message (no stack/Prisma text)', async () => {
    prisma.hospital.findUnique.mockRejectedValue(new Error('Connection terminated unexpectedly at Pool.connect'))
    const res = await GET(new Request('http://localhost/api/settings/clinic') as never)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toContain('تعذر تحميل بيانات العيادة')
    expect(data.error).not.toContain('Pool')
    expect(data.error).not.toContain('terminated')
  })

  it('E4: no stack trace reaches the client on any failure path', async () => {
    prisma.hospital.update.mockRejectedValue(
      new Error('boom\n    at Pool.connect (/app/node_modules/pg/lib/index.js:1:1)')
    )
    const res = await POST(post(validClinic))
    const data = await res.json()
    expect(data.error).not.toContain('at ')
    expect(data.error).not.toContain('node_modules')
  })

  // ── Regression / RBAC / tenancy ────────────────────────────────────────
  it('R1: valid save flow still works end-to-end', async () => {
    const res = await POST(post(validClinic))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(prisma.hospital.update).toHaveBeenCalledTimes(1)
  })

  it('R2: GET retrieval still works', async () => {
    prisma.hospital.findUnique.mockResolvedValue({ id: 'h1', name: 'عيادة النيل', phone: '0222345678' })
    const res = await GET(new Request('http://localhost/api/settings/clinic') as never)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.name).toBe('عيادة النيل')
  })

  it('R3: ADMIN authorization remains enforced (auth error is passed through)', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      hospitalId: null,
    })
    const res = await POST(post(validClinic))
    expect(res.status).toBe(401)
  })

  it('R4: tenant isolation — the update is always scoped to the caller hospitalId', async () => {
    await POST(post(validClinic))
    expect(prisma.hospital.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h1' } })
    )
  })
})

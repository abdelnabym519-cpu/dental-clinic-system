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

import { POST } from '@/app/api/settings/clinic/route'

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

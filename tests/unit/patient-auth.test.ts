import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import { generateOTP, setPatientCookie, clearPatientCookie, COOKIE_NAME } from '@/lib/patient-auth'
import { NextResponse } from 'next/server'

describe('generateOTP() — CSPRNG', () => {
  it('returns a 6-digit string matching /^\\d{6}$/', () => {
    const otp = generateOTP()
    expect(otp).toMatch(/^\d{6}$/)
  })

  it('is always 6 digits within numeric range [100000, 999999]', () => {
    for (let i = 0; i < 100; i++) {
      const otp = generateOTP()
      expect(otp).toHaveLength(6)
      const num = parseInt(otp, 10)
      expect(num).toBeGreaterThanOrEqual(100000)
      expect(num).toBeLessThan(1000000)
    }
  })

  it('generates varying OTPs across multiple invocations', () => {
    const otps = new Set(Array.from({ length: 50 }, () => generateOTP()))
    expect(otps.size).toBeGreaterThan(1)
  })
})

describe('Patient Cookie Management', () => {
  it('exports correct COOKIE_NAME', () => {
    expect(COOKIE_NAME).toBe('patient-portal-token')
  })

  it('sets secure httpOnly cookie on response', () => {
    const response = NextResponse.json({ success: true })
    setPatientCookie(response, 'sample-token')
    const cookie = response.cookies.get(COOKIE_NAME)
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('sample-token')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax')
    expect(cookie?.path).toBe('/')
  })

  it('clears patient cookie on logout with maxAge 0', () => {
    const response = NextResponse.json({ success: true })
    clearPatientCookie(response)
    const cookie = response.cookies.get(COOKIE_NAME)
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('')
    expect(cookie?.maxAge).toBe(0)
  })
})

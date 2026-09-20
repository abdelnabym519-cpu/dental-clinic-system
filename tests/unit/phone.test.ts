// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { normalizeToE164, isPlausibleE164, isEgyptianMobile, maskPhone } from '@/lib/phone'

// ---------------------------------------------------------------------------
// Phone number handling (master prompt 3K): E.164 normalization with Egypt
// default, validation before sending, masked logging.
// ---------------------------------------------------------------------------

describe('phone normalization (3K)', () => {
  it('normalizes Egyptian local mobile formats to +20 E.164', () => {
    expect(normalizeToE164('01012345678')).toBe('+201012345678')
    expect(normalizeToE164('+201012345678')).toBe('+201012345678')
    expect(normalizeToE164('00201012345678')).toBe('+201012345678')
    expect(normalizeToE164('201012345678')).toBe('+201012345678')
    expect(normalizeToE164('10 1234 5678')).toBe('+201012345678')
    expect(normalizeToE164('01012-345-678')).toBe('+201012345678')
  })

  it('keeps other country codes intact', () => {
    expect(normalizeToE164('+971501234567')).toBe('+971501234567')
    expect(normalizeToE164('00971501234567')).toBe('+971501234567')
  })

  it('accepts an explicit default country code', () => {
    expect(normalizeToE164('0501234567', '+966')).toBe('+966501234567')
  })

  it('rejects implausible numbers with null (never crashes)', () => {
    expect(normalizeToE164('')).toBeNull()
    expect(normalizeToE164(null)).toBeNull()
    expect(normalizeToE164(undefined)).toBeNull()
    expect(normalizeToE164('not-a-phone')).toBeNull()
    expect(normalizeToE164('12345')).toBeNull()
    expect(normalizeToE164('+')).toBeNull()
  })
})

describe('phone validation helpers', () => {
  it('checks E.164 shape', () => {
    expect(isPlausibleE164('+201012345678')).toBe(true)
    expect(isPlausibleE164('01012345678')).toBe(false)
    expect(isPlausibleE164('+20')).toBe(false)
  })

  it('recognizes Egyptian mobile prefixes', () => {
    expect(isEgyptianMobile('+201012345678')).toBe(true)
    expect(isEgyptianMobile('+201112345678')).toBe(true)
    expect(isEgyptianMobile('+201512345678')).toBe(true)
    expect(isEgyptianMobile('+209012345678')).toBe(false) // landline prefix
    expect(isEgyptianMobile('+971501234567')).toBe(false)
  })
})

describe('phone masking for logs/UI (3L)', () => {
  it('keeps the head and last 4 digits, masks the middle', () => {
    expect(maskPhone('+201012345678')).toBe('+2010****5678')
    expect(maskPhone('01012345678')).toBe('0101****5678')
  })

  it('handles degenerate input without crashing', () => {
    expect(maskPhone('')).toBe('')
    expect(maskPhone(null)).toBe('')
    expect(maskPhone('1234')).toBe('****')
  })
})

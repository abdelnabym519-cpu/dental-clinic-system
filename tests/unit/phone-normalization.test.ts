import { describe, expect, it } from 'vitest'
import { toProviderDigits, normalizeToE164, isEgyptianMobile } from '@/lib/phone'

/**
 * Phase 10 (D7) — phone normalization for the WhatsApp providers.
 * Both Meta (messages.to) and Baileys (JID) take international digits
 * WITHOUT "+"; this is the single shared rule.
 */
describe('toProviderDigits (Phase 10 provider digit form)', () => {
  it('converts Egyptian local 01X numbers to 20XXXXXXXXX', () => {
    expect(toProviderDigits('01012345678')).toBe('201012345678')
    expect(toProviderDigits('01112345678')).toBe('201112345678')
    expect(toProviderDigits('01234567890')).toBe('201234567890')
    expect(toProviderDigits('01512345678')).toBe('201512345678')
  })

  it('passes through numbers that already carry the country code', () => {
    expect(toProviderDigits('+201012345678')).toBe('201012345678')
    expect(toProviderDigits('201012345678')).toBe('201012345678')
    expect(toProviderDigits('00201012345678')).toBe('201012345678')
  })

  it('strips formatting characters (spaces, dashes, parens, dots)', () => {
    expect(toProviderDigits('010 1234 5678')).toBe('201012345678')
    expect(toProviderDigits('010-1234-5678')).toBe('201012345678')
    expect(toProviderDigits('(010) 1234.5678')).toBe('201012345678')
  })

  it('accepts the local style without trunk zero', () => {
    expect(toProviderDigits('1012345678')).toBe('201012345678')
  })

  it('returns null for implausible input (never sends to a malformed target)', () => {
    expect(toProviderDigits('abc')).toBeNull()
    expect(toProviderDigits('')).toBeNull()
    expect(toProviderDigits(null)).toBeNull()
    expect(toProviderDigits(undefined)).toBeNull()
    expect(toProviderDigits('01234')).toBeNull() // too short
  })

  it('agrees with normalizeToE164 minus the "+"', () => {
    for (const raw of ['01012345678', '+201012345678', '201012345678']) {
      const e164 = normalizeToE164(raw)
      expect(e164).not.toBeNull()
      expect(toProviderDigits(raw)).toBe(e164!.replace(/\D/g, ''))
    }
  })

  it('kept-provider results are Egyptian mobiles when input was', () => {
    for (const raw of ['01012345678', '+201012345678', '01112345678']) {
      expect(isEgyptianMobile(`+${toProviderDigits(raw)}`)).toBe(true)
    }
  })
})

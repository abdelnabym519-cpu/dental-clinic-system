/**
 * Phone number handling for the messaging platform (master prompt 3K).
 * - Normalize to E.164 with Egypt (+20) as the default country.
 * - Validate before sending; invalid numbers never crash a flow.
 * - Mask numbers for logs/UI — full numbers are never rendered.
 */

const DEFAULT_COUNTRY_CODE = '+20'

/** Digits only, with an optional leading +. */
function digitsOf(raw: string): { countryCode: string | null; subscriber: string } {
  const trimmed = raw.trim()
  let countryCode: string | null = null
  let rest = trimmed
  if (rest.startsWith('+')) {
    const match = rest.slice(1).match(/^(\d{1,3})/)
    if (match) {
      countryCode = `+${match[1]}`
      rest = rest.slice(1 + match[1].length)
    } else {
      rest = rest.slice(1)
    }
  } else if (rest.startsWith('00')) {
    const match = rest.slice(2).match(/^(\d{1,3})/)
    if (match) {
      countryCode = `+${match[1]}`
      rest = rest.slice(2 + match[1].length)
    } else {
      rest = rest.slice(2)
    }
  }
  const subscriber = rest.replace(/[\s\-().]/g, '')
  return { countryCode, subscriber: subscriber.replace(/\D/g, '') }
}

/**
 * Normalize any reasonable local/international representation to E.164.
 * Egypt-aware: 01X XXXX XXXX (11 digits starting 010/011/012/015) and
 * 1XXXXXXXXX (10 digits) become +20XXXXXXXXXX. Numbers that already carry a
 * country code pass through re-formatted. Returns null when implausible —
 * callers log-and-skip, never crash.
 */
export function normalizeToE164(
  raw: string | null | undefined,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  if (!raw || typeof raw !== 'string') return null
  const { countryCode, subscriber } = digitsOf(raw)
  if (!subscriber) return null

  let e164: string
  if (countryCode) {
    e164 = `${countryCode}${subscriber}`
  } else if (defaultCountryCode === '+20') {
    if (subscriber.startsWith('0')) {
      e164 = `+20${subscriber.replace(/^0+/, '')}`
    } else if (subscriber.length <= 10) {
      // Local style without trunk zero (e.g. 10XXXXXXXX)
      e164 = `+20${subscriber}`
    } else {
      e164 = `+${subscriber}`
    }
  } else {
    e164 = `${defaultCountryCode}${subscriber.replace(/^0+/, '')}`
  }

  return isPlausibleE164(e164) ? e164 : null
}

/** E.164 sanity: + and 8–15 digits (ITU-T E.164 sizing). */
export function isPlausibleE164(value: string): boolean {
  return /^\+\d{8,15}$/.test(value)
}

/**
 * Egyptian mobile plausibility: +20 followed by 10 digits whose subscriber
 * part starts with a known mobile prefix (10/11/12/15). Accepts any E.164
 * number for non-Egypt flows (validation only warns at the edge).
 */
export function isEgyptianMobile(e164: string): boolean {
  if (!e164.startsWith('+20')) return false
  return /^\+201[0125]\d{8}$/.test(e164)
}

/**
 * Mask a phone number for logs/UI (master prompt 3L): keep the country code
 * (when detectable) and the last 4 digits, mask the middle — e.g.
 * +201012345678 → +2010****5678, 01012345678 → 0101****5678.
 */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.length <= 4) return '****'
  const head = digits.startsWith('+') ? digits.slice(0, 5) : digits.slice(0, 4)
  const tail = digits.slice(-4)
  return `${head}****${tail}`
}

/**
 * Phase 10 — digits-only international form for the WhatsApp providers
 * (Meta Cloud API and Baileys JIDs take international digits without "+").
 * Reuses normalizeToE164, so invalid/implausible numbers yield null and the
 * provider fails with a clear error instead of sending to a malformed target.
 *   01012345678 → 201012345678 · +201012345678 → 201012345678 · 201012345678 → unchanged
 */
export function toProviderDigits(raw: string | null | undefined): string | null {
  const e164 = normalizeToE164(raw)
  return e164 ? e164.replace(/\D/g, '') : null
}

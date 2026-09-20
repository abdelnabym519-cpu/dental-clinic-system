import { describe, it, expect } from 'vitest'

import {
  defaultLocale,
  getLocaleDefaults,
  isRTL,
  isSupportedLocale,
  locales,
  resolveLocale,
} from '@/lib/i18n/config'
import {
  createFormatters,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
} from '@/lib/i18n/format'

describe('i18n config', () => {
  it('defaults to Egyptian Arabic', () => {
    expect(defaultLocale).toBe('ar-EG')
    expect(locales).toContain('ar-EG')
    expect(locales).not.toContain('en-IN')
  })

  it('recognises supported locales', () => {
    expect(isSupportedLocale('ar-EG')).toBe(true)
    expect(isSupportedLocale('en-EG')).toBe(true)
    expect(isSupportedLocale('en-US')).toBe(true)
    expect(isSupportedLocale('en-IN')).toBe(false)
    expect(isSupportedLocale('xx-XX')).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
  })

  // A stale or hand-edited Hospital.locale must never break formatting —
  // including legacy en-IN records from before the Egyptian pivot.
  it('falls back to the default for unknown or missing locales', () => {
    expect(resolveLocale('de-DE')).toBe('ar-EG')
    expect(resolveLocale('en-IN')).toBe('ar-EG')
    expect(resolveLocale(undefined)).toBe('ar-EG')
    expect(resolveLocale('en-US')).toBe('en-US')
  })

  it('maps each locale to its currency, country and timezone', () => {
    expect(getLocaleDefaults('ar-EG')).toEqual({
      currency: 'EGP',
      country: 'EG',
      timezone: 'Africa/Cairo',
    })
    expect(getLocaleDefaults('en-EG')).toEqual({
      currency: 'EGP',
      country: 'EG',
      timezone: 'Africa/Cairo',
    })
    expect(getLocaleDefaults('en-US').currency).toBe('USD')
  })

  it('marks Arabic as right-to-left and English as left-to-right', () => {
    expect(isRTL('ar-EG')).toBe(true)
    expect(isRTL('en-EG')).toBe(false)
    expect(isRTL('en-US')).toBe(false)
    expect(isRTL(null)).toBe(false)
  })
})

describe('formatCurrency', () => {
  it('defaults to Egyptian pounds in Arabic numerals', () => {
    const result = formatCurrency(1000)
    expect(result).toContain('ج.م')
    expect(result).toContain('١٬٠٠٠')
  })

  it('formats English (Egypt) as "EGP 1,500" with western digits', () => {
    const result = formatCurrency(1500, { locale: 'en-EG' })
    expect(result).toContain('EGP')
    expect(result).toContain('1,500')
    expect(result).not.toContain('ج.م')
  })

  it('does not leak Indian rupees anywhere', () => {
    expect(formatCurrency(1000)).not.toContain('₹')
    expect(formatCurrency(1000)).not.toMatch(/\bINR\b/)
    expect(formatCurrency(100000, { locale: 'en-EG' })).not.toContain('1,00,000')
  })

  it('uses western grouping and dollars for en-US', () => {
    const result = formatCurrency(100000, { locale: 'en-US' })
    expect(result).toContain('$')
    expect(result).toContain('100,000')
  })

  it('accepts numeric strings', () => {
    expect(formatCurrency('1234.56', { locale: 'en-EG' })).toContain('1,234.56')
  })

  it('returns a formatted zero for null, undefined and unparseable input', () => {
    expect(formatCurrency(null)).toContain('٠')
    expect(formatCurrency(undefined)).toContain('٠')
    expect(formatCurrency('not a number')).toContain('٠')
  })

  it('does not leak a pound sign into a non-EGP fallback', () => {
    expect(formatCurrency(null, { locale: 'en-US' })).not.toContain('ج.م')
  })

  it('honours an explicit fallback', () => {
    expect(formatCurrency(null, { fallback: '—' })).toBe('—')
  })

  it('respects fraction digit overrides', () => {
    expect(
      formatCurrency(500, {
        locale: 'en-EG',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    ).toContain('500.00')
  })

  it('formats negative amounts', () => {
    expect(formatCurrency(-1500, { locale: 'en-EG' })).toContain('1,500')
  })
})

describe('formatNumber', () => {
  it('groups by locale without a currency symbol', () => {
    expect(formatNumber(100000)).toBe('١٠٠٬٠٠٠')
    expect(formatNumber(100000, { locale: 'en-EG' })).toBe('100,000')
    expect(formatNumber(100000, { locale: 'en-US' })).toBe('100,000')
  })

  it('falls back for invalid input', () => {
    expect(formatNumber(null)).toBe('-')
    expect(formatNumber('abc', { fallback: 'n/a' })).toBe('n/a')
  })
})

describe('formatDate / formatDateTime', () => {
  it('formats a date consistently', () => {
    const result = formatDate(new Date('2026-01-15T00:00:00Z'))
    expect(result).toContain('٢٠٢٦')
  })

  it('accepts date strings', () => {
    expect(formatDate('2026-06-20T00:00:00Z')).toContain('٢٠٢٦')
  })

  it('returns the fallback for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate('not a date')).toBe('-')
    expect(formatDateTime(undefined)).toBe('-')
    expect(formatDate(null, { fallback: '—' })).toBe('—')
  })

  it('includes a time component in formatDateTime', () => {
    const result = formatDateTime(new Date('2026-01-15T13:30:00Z'))
    expect(result).toMatch(/\d{1,2}:\d{2}|[٠-٩]{1,2}:[٠-٩]{2}/)
  })

  it('orders the date parts per locale', () => {
    const date = new Date('2026-03-04T00:00:00Z')
    expect(formatDate(date, { locale: 'en-US', timeZone: 'UTC' })).toMatch(/Mar 04, 2026/)
    expect(formatDate(date, { locale: 'en-EG', timeZone: 'UTC' })).toMatch(/Mar 04, 2026/)
    expect(formatDate(date, { locale: 'ar-EG', timeZone: 'UTC' })).toContain('مارس')
  })
})

describe('createFormatters', () => {
  it('binds every formatter to one locale', () => {
    const us = createFormatters('en-US')
    expect(us.locale).toBe('en-US')
    expect(us.currency).toBe('USD')
    expect(us.formatCurrency(100000)).toContain('$')
    expect(us.formatNumber(100000)).toBe('100,000')
  })

  it('falls back to the default locale for unsupported input', () => {
    expect(createFormatters('fr-FR').locale).toBe('ar-EG')
    expect(createFormatters(null).currency).toBe('EGP')
  })
})

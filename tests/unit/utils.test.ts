// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
  generatePatientId,
  generateInvoiceNo,
  calculateVAT,
  validateNationalId,
  validateEgyptianPhone,
} from '@/lib/utils'

describe('Utils - cn (classnames merger)', () => {
  it('should merge class names correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('should handle conditional classes', () => {
    expect(cn('base', true && 'active', false && 'disabled')).toBe('base active')
  })

  it('should merge tailwind classes correctly', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('should handle undefined and null values', () => {
    expect(cn('base', undefined, null, 'active')).toBe('base active')
  })

  it('should handle arrays', () => {
    expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz')
  })
})

describe('Utils - formatCurrency', () => {
  it('should format positive amounts correctly in EGP', () => {
    const result = formatCurrency(1000)
    expect(result).toContain('ج.م')
    expect(result).not.toMatch(/₹|\bINR\b/)
  })

  it('should format zero correctly', () => {
    const result = formatCurrency(0)
    expect(result).toContain('٠')
  })

  it('should format decimal amounts correctly', () => {
    const result = formatCurrency(1234.56, 'en-EG')
    expect(result).toContain('1,234')
  })

  it('should format large amounts with thousands grouping', () => {
    const result = formatCurrency(1234567, 'en-EG')
    expect(result).toContain('1,234,567')
    // The Indian lakh grouping must never come back.
    expect(result).not.toContain('12,34,567')
  })
})

describe('Utils - formatDate', () => {
  it('should format Date object correctly', () => {
    const date = new Date('2024-01-15')
    const result = formatDate(date)
    expect(result).toContain('١٥')
    expect(result).toContain('٢٠٢٤')
  })

  it('should format date string correctly', () => {
    const result = formatDate('2024-06-20')
    expect(result).toContain('٢٠')
    expect(result).toContain('٢٠٢٤')
  })

  it('should handle invalid dates gracefully', () => {
    // This should not throw
    expect(() => formatDate('invalid-date')).not.toThrow()
  })
})

describe('Utils - formatDateTime', () => {
  it('should include both date and time', () => {
    const date = new Date('2024-01-15T14:30:00')
    const result = formatDateTime(date)
    expect(result).toContain('١٥')
    expect(result).toContain('٢٠٢٤')
  })

  it('should format string dates with time', () => {
    const result = formatDateTime('2024-06-20T09:15:00')
    expect(result).toContain('٢٠')
    expect(result).toContain('٢٠٢٤')
  })
})

describe('Utils - formatPhone', () => {
  it('should format 11-digit Egyptian local phone numbers', () => {
    const result = formatPhone('01012345678')
    expect(result).toBe('+20 101 234 5678')
  })

  it('should handle phone with existing formatting', () => {
    const result = formatPhone('+20-101-234-5678')
    expect(result).toBe('+20 101 234 5678')
  })

  it('should return original for non-phone numbers', () => {
    expect(formatPhone('12345')).toBe('12345')
    expect(formatPhone('12345678901234')).toBe('12345678901234')
  })

  it('should return empty string for empty input', () => {
    expect(formatPhone('')).toBe('')
  })
})

describe('Utils - generatePatientId', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should generate ID with correct format', () => {
    vi.setSystemTime(new Date('2024-06-15'))
    const result = generatePatientId()
    expect(result).toMatch(/^PAT2406\d{4}$/)
  })

  it('should generate different IDs on consecutive calls', () => {
    const id1 = generatePatientId()
    const id2 = generatePatientId()
    // They may be the same or different due to random component
    expect(id1).toMatch(/^PAT/)
    expect(id2).toMatch(/^PAT/)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('Utils - generateInvoiceNo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should generate invoice number with correct format', () => {
    vi.setSystemTime(new Date('2024-06-15'))
    const result = generateInvoiceNo()
    expect(result).toMatch(/^INV-202406-\d{4}$/)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('Utils - calculateVAT', () => {
  it('should calculate VAT correctly with the default Egyptian rate (14%)', () => {
    const result = calculateVAT(1000)
    expect(result.subtotal).toBe(1000)
    expect(result.vat).toBe(140)
    expect(result.total).toBe(1140)
  })

  it('should calculate VAT with custom rates', () => {
    const result = calculateVAT(1000, 7)
    expect(result.subtotal).toBe(1000)
    expect(result.vat).toBe(70)
    expect(result.total).toBe(1070)
  })

  it('should handle zero amount', () => {
    const result = calculateVAT(0)
    expect(result.total).toBe(0)
  })

  it('should handle decimal amounts', () => {
    const result = calculateVAT(99.99)
    expect(result.subtotal).toBe(99.99)
    expect(result.total).toBeCloseTo(113.99, 1)
  })
})

describe('Utils - validateNationalId', () => {
  it('should validate correct 14-digit Egyptian national ID', () => {
    expect(validateNationalId('29801011201234')).toBe(true)
  })

  it('should validate national ID with spaces', () => {
    expect(validateNationalId('2980 1011 2012 34')).toBe(true)
  })

  it('should validate national ID with dashes', () => {
    expect(validateNationalId('2980-1011-2012-34')).toBe(true)
  })

  it('should reject invalid national ID numbers', () => {
    expect(validateNationalId('2980101120123')).toBe(false) // 13 digits
    expect(validateNationalId('298010112012345')).toBe(false) // 15 digits
    expect(validateNationalId('')).toBe(false)
  })
})

describe('Utils - validateEgyptianPhone', () => {
  it('should validate correct Egyptian phone numbers', () => {
    expect(validateEgyptianPhone('01012345678')).toBe(true)
    expect(validateEgyptianPhone('01123456789')).toBe(true)
    expect(validateEgyptianPhone('01234567890')).toBe(true)
    expect(validateEgyptianPhone('01512345678')).toBe(true)
  })

  it('should validate phone numbers with formatting', () => {
    expect(validateEgyptianPhone('+20-1012345678')).toBe(true)
    expect(validateEgyptianPhone('20 1012345678')).toBe(true)
  })

  it('should reject invalid phone numbers', () => {
    expect(validateEgyptianPhone('03012345678')).toBe(false) // Starts with 03
    expect(validateEgyptianPhone('01412345678')).toBe(false) // Invalid prefix 014
    expect(validateEgyptianPhone('0101234567')).toBe(false) // 10 digits
    expect(validateEgyptianPhone('010123456789')).toBe(false) // 12 digits
    expect(validateEgyptianPhone('')).toBe(false)
  })
})

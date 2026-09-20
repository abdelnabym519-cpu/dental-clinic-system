// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'

vi.mock('@prisma/client', () => ({
  InvoiceStatus: {
    DRAFT: 'DRAFT',
    PENDING: 'PENDING',
    PARTIALLY_PAID: 'PARTIALLY_PAID',
    PAID: 'PAID',
    OVERDUE: 'OVERDUE',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
  },
  PaymentMethod: {
    CASH: 'CASH',
    CARD: 'CARD',
    UPI: 'UPI',
    BANK_TRANSFER: 'BANK_TRANSFER',
    CHEQUE: 'CHEQUE',
    INSURANCE: 'INSURANCE',
    WALLET: 'WALLET',
    ONLINE: 'ONLINE',
  },
  PaymentStatus: {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED',
    CANCELLED: 'CANCELLED',
  },
  InsuranceClaimStatus: {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    APPROVED: 'APPROVED',
    PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
    REJECTED: 'REJECTED',
    SETTLED: 'SETTLED',
  },
  DiscountType: { PERCENTAGE: 'PERCENTAGE', FIXED: 'FIXED' },
}))

import {
  formatCurrency,
  formatDate,
  formatPhone,
  validateNationalId,
  validateEgyptianPhone,
  validateTaxId,
} from '@/lib/utils'
import {
  vatConfig,
  calculateVAT,
  discountTypeConfig,
  formatCurrency as billingFormatCurrency,
  numberToWords,
  formatDateTime as billingFormatDateTime,
} from '@/lib/billing-utils'

describe('Section 10.1 — Current Locale (Egypt)', () => {
  // ─── Currency Display ───────────────────────────────────────────────

  describe('Currency Display', () => {
    it('formatCurrency from utils displays the Egyptian pound symbol', () => {
      const result = formatCurrency(500)
      expect(result).toContain('ج.م')
      expect(result).not.toContain('₹')
    })

    it('billingFormatCurrency displays EGP with 2 decimal places', () => {
      const result = billingFormatCurrency(500)
      expect(result).toContain('ج.م')
      expect(result).toMatch(/٥٠٠٫٠٠/)
    })

    it('formats 100,000 in Arabic-Indic numerals (ar-EG default)', () => {
      const result = formatCurrency(100000)
      expect(result).toContain('١٠٠٬٠٠٠')
      // No Indian lakh grouping may leak through.
      expect(result).not.toContain('1,00,000')
    })

    it('formats millions in the Egyptian (western-grouping) system', () => {
      const result = formatCurrency(10000000)
      expect(result).toContain('١٠٬٠٠٠٬٠٠٠')
    })

    it('zero amount renders as EGP 0', () => {
      const result = formatCurrency(0)
      expect(result).toContain('ج.م')
      expect(result).toMatch(/٠/)
    })

    it('large amounts group in thousands in billing', () => {
      const result = billingFormatCurrency(25000000)
      // ٢٥٬٠٠٠٬٠٠٠٫٠٠
      expect(result).toContain('٢٥٬٠٠٠٬٠٠٠')
    })

    it('negative amounts are handled', () => {
      const result = formatCurrency(-1500)
      expect(result).toContain('ج.م')
      expect(result).toContain('١٬٥٠٠')
    })

    it('discountTypeConfig.FIXED.symbol is the Egyptian pound', () => {
      expect(discountTypeConfig.FIXED.symbol).toBe('ج.م')
    })
  })

  // ─── Date Format ────────────────────────────────────────────────────

  describe('Date Format', () => {
    it('formatDate uses ar-EG locale', () => {
      const result = formatDate(new Date(2026, 2, 8)) // March 8, 2026
      // ar-EG with day:2-digit, month:short, year:numeric => "٠٨ مارس ٢٠٢٦"
      expect(result).toMatch(/٠٨/)
      expect(result).toContain('مارس')
      expect(result).toContain('٢٠٢٦')
    })

    it('output format is DD Mon YYYY (Arabic month names)', () => {
      const result = formatDate(new Date(2026, 0, 15)) // Jan 15, 2026
      expect(result).toMatch(/١٥.*يناير.*٢٠٢٦/)
    })

    it('invalid date returns "-"', () => {
      expect(formatDate('not-a-date')).toBe('-')
    })

    it('string date input works', () => {
      const result = formatDate('2026-03-08')
      expect(result).toContain('مارس')
      expect(result).toContain('٢٠٢٦')
    })

    it('Date object input works', () => {
      const result = formatDate(new Date(2025, 11, 25)) // Dec 25, 2025
      expect(result).toMatch(/٢٥/)
      expect(result).toContain('ديسمبر')
      expect(result).toContain('٢٠٢٥')
    })
  })

  // ─── Phone Number Format ────────────────────────────────────────────

  describe('Phone Number Format', () => {
    it('formatPhone formats Egyptian local numbers with the +20 country code', () => {
      const result = formatPhone('01012345678')
      expect(result).toBe('+20 101 234 5678')
    })

    it('formatPhone handles the 20-prefixed country-code form', () => {
      const result = formatPhone('201012345678')
      expect(result).toBe('+20 101 234 5678')
    })

    it('validateEgyptianPhone accepts the four Egyptian prefixes', () => {
      expect(validateEgyptianPhone('01012345678')).toBe(true)
      expect(validateEgyptianPhone('01112345678')).toBe(true)
      expect(validateEgyptianPhone('01212345678')).toBe(true)
      expect(validateEgyptianPhone('01512345678')).toBe(true)
    })

    it('validateEgyptianPhone accepts +20 country-code forms', () => {
      expect(validateEgyptianPhone('+201012345678')).toBe(true)
      expect(validateEgyptianPhone('+20 101 234 5678')).toBe(true)
    })

    it('validateEgyptianPhone rejects non-Egyptian prefixes', () => {
      expect(validateEgyptianPhone('03012345678')).toBe(false)
      expect(validateEgyptianPhone('01412345678')).toBe(false)
      expect(validateEgyptianPhone('06123456789')).toBe(false)
    })

    it('validateEgyptianPhone rejects wrong length', () => {
      expect(validateEgyptianPhone('0101234567')).toBe(false) // 10 digits
      expect(validateEgyptianPhone('010123456789')).toBe(false) // 12 digits
    })
  })

  // ─── GST Format ─────────────────────────────────────────────────────

  describe('VAT Format', () => {
    it('vatConfig uses the Egyptian standard rate of 14%', () => {
      expect(vatConfig.rate).toBe(14)
    })

    it('calculateVAT(1000) gives 140 tax, 1140 total', () => {
      const result = calculateVAT(1000)
      expect(result.vatAmount).toBe(140)
      expect(result.totalTax).toBe(140)
      expect(result.grandTotal).toBe(1140)
    })

    it('VAT is the single Egyptian rate (no split components)', () => {
      expect(vatConfig.defaultTaxable).toBe(true)
    })
  })

  // ─── Aadhaar Validation ─────────────────────────────────────────────

  describe('National ID Validation', () => {
    it('validateNationalId accepts 14-digit numbers', () => {
      expect(validateNationalId('29801011201234')).toBe(true)
    })

    it('rejects shorter numbers', () => {
      expect(validateNationalId('2980101120123')).toBe(false) // 13 digits
    })

    it('rejects longer numbers', () => {
      expect(validateNationalId('298010112012345')).toBe(false) // 15 digits
    })

    it('handles formatted input with spaces', () => {
      expect(validateNationalId('2980 1011 2012 34')).toBe(true)
    })

    it('handles formatted input with dashes', () => {
      expect(validateNationalId('2980-1011-2012-34')).toBe(true)
    })
  })

  // ─── Number to Words (Indian) ───────────────────────────────────────

  describe('Number to Words (Egyptian)', () => {
    it('numberToWords(1) returns "One Egyptian Pounds Only"', () => {
      expect(numberToWords(1)).toBe('One Egyptian Pounds Only')
    })

    it('numberToWords(100000) uses international grouping (no "Lakh")', () => {
      const result = numberToWords(100000)
      expect(result).toContain('Hundred Thousand')
      expect(result).not.toContain('Lakh')
    })

    it('numberToWords(10000000) contains "Million" (no "Crore")', () => {
      const result = numberToWords(10000000)
      expect(result).toContain('Million')
      expect(result).not.toContain('Crore')
    })

    it('numberToWords(1500.50) contains "Egyptian Pounds" and "Piasters"', () => {
      const result = numberToWords(1500.5)
      expect(result).toContain('Egyptian Pounds')
      expect(result).toContain('Piasters')
    })

    it('numberToWords(0) returns "Zero"', () => {
      expect(numberToWords(0)).toBe('Zero')
    })
  })

  // ─── GSTIN Validation ──────────────────────────────────────────────

  describe('Tax ID Validation', () => {
    it('accepts a 9-digit Egyptian tax registration number', () => {
      expect(validateTaxId('123456789')).toBe(true)
    })

    it('rejects shorter numbers', () => {
      expect(validateTaxId('12345678')).toBe(false)
    })

    it('rejects longer numbers', () => {
      expect(validateTaxId('1234567890')).toBe(false)
    })

    it('rejects non-numeric input', () => {
      expect(validateTaxId('12345A789')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(validateTaxId('')).toBe(false)
    })
  })

  // ─── Time Format ────────────────────────────────────────────────────

  describe('Time Format', () => {
    it('billingFormatDateTime uses 12-hour format with Arabic ص/م markers', () => {
      // 14:30 (2:30 PM)
      const date = new Date(2026, 2, 8, 14, 30, 0)
      const result = billingFormatDateTime(date)
      expect(result).toMatch(/[صم]/)
    })

    it('billingFormatDateTime includes date components', () => {
      const date = new Date(2026, 2, 8, 10, 15, 0)
      const result = billingFormatDateTime(date)
      expect(result).toContain('٠٨')
      expect(result).toContain('مارس')
      expect(result).toContain('٢٠٢٦')
    })
  })
})

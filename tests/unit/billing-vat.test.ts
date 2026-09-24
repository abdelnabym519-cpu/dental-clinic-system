import { describe, it, expect } from 'vitest'
import { calculateInvoiceTotals, calculateVAT, vatConfig } from '@/lib/billing-utils'

/**
 * Phase 12 — VAT 14% (Egypt) server-side computation (D3/D13).
 *
 * Legacy carrier naming is preserved: the full Egyptian VAT amount is stored
 * in `cgstAmount` while `sgstAmount` stays 0 (the `sgstRate`/`cgstRate`
 * fields on Invoice carry the 14% rate). The unit under test is the shared
 * server-side calculator every billing route uses — clients never send
 * totals.
 */
describe('billing-utils VAT 14% (Egypt)', () => {
  it('vatConfig carries the 14% Egyptian rate', () => {
    expect(vatConfig.rate).toBe(14)
  })

  it('applies a flat 14% VAT on the taxable base', () => {
    const r = calculateInvoiceTotals(
      [
        { quantity: 1, unitPrice: 1000, taxable: true },
        { quantity: 1, unitPrice: 500, taxable: true },
      ],
      'FIXED',
      0,
      14
    )
    expect(r.subtotal).toBe(1500)
    // no discount → taxable base = 1500
    expect(r.taxableAmount).toBe(1500)
    expect(r.cgstAmount).toBe(210) // 1500 * 14%
    expect(r.sgstAmount).toBe(0)
    expect(r.totalTax).toBe(210)
    expect(r.totalAmount).toBe(1710)
  })

  it('applies a percentage discount BEFORE VAT', () => {
    const r = calculateInvoiceTotals(
      [{ quantity: 1, unitPrice: 1000, taxable: true }],
      'PERCENTAGE',
      10,
      14
    )
    expect(r.discountAmount).toBe(100)
    expect(r.taxableAmount).toBe(900)
    expect(r.cgstAmount).toBe(126) // 900 * 14%
    expect(r.totalAmount).toBe(1026)
  })

  it('applies a fixed discount BEFORE VAT', () => {
    const r = calculateInvoiceTotals(
      [{ quantity: 1, unitPrice: 1000, taxable: true }],
      'FIXED',
      200,
      14
    )
    expect(r.taxableAmount).toBe(800)
    expect(r.cgstAmount).toBe(112)
    expect(r.totalAmount).toBe(912)
  })

  it('excludes non-taxable items from the VAT base (total still includes them)', () => {
    const r = calculateInvoiceTotals(
      [
        { quantity: 1, unitPrice: 1000, taxable: true },
        { quantity: 1, unitPrice: 400, taxable: false },
      ],
      'FIXED',
      0,
      14
    )
    expect(r.subtotal).toBe(1400)
    expect(r.taxableAmount).toBe(1000)
    expect(r.nonTaxableAmount).toBe(400)
    expect(r.cgstAmount).toBe(140)
    expect(r.totalAmount).toBe(1540)
  })

  it('pro-rates the discount between taxable and non-taxable parts', () => {
    const r = calculateInvoiceTotals(
      [
        { quantity: 1, unitPrice: 750, taxable: true },
        { quantity: 1, unitPrice: 250, taxable: false },
      ],
      'FIXED',
      100,
      14
    )
    // 75/25 split → taxable 750-75=675, non-taxable 250-25=225
    expect(r.taxableAmount).toBe(675)
    expect(r.nonTaxableAmount).toBe(225)
    expect(r.cgstAmount).toBe(94.5) // 675 * 14%
    expect(r.totalAmount).toBe(994.5)
  })

  it('a rate of 0 yields zero VAT and total = subtotal', () => {
    const r = calculateInvoiceTotals(
      [{ quantity: 1, unitPrice: 100, taxable: true }],
      'FIXED',
      0,
      0
    )
    expect(r.cgstAmount).toBe(0)
    expect(r.totalAmount).toBe(100)
  })

  it('calculateVAT returns the full Egyptian VAT amount for the base', () => {
    const vat = calculateVAT(1000, 14)
    expect(vat.vatAmount).toBe(140)
    expect(vat.grandTotal).toBe(1140)
  })
})

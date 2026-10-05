/**
 * Issue 7 — canonical editable-price validation (one rule, no framework —
 * the same precedent as lib/phone.ts for phones).
 *
 * Every persisted price in this product lives in a Prisma Decimal(10,2)
 * column (`Procedure.basePrice`, `Treatment.cost`, invoice lines, plan
 * estimates), so a valid editable price is:
 *
 *   • a real finite JSON number — strings, null, NaN and ±Infinity reject
 *     (the server never trusts `parseFloat` from any client),
 *   • positive — zero is NOT a persisted price in this product: treatment
 *     creation already coerces `cost || procedure.basePrice`, so `0` means
 *     "not provided", never "free",
 *   • at most 99,999,999.99 — the exact capacity of Decimal(10,2); anything
 *     larger would otherwise die inside Prisma as a raw 500,
 *   • at most 2 decimal places — verified on the string form so floating
 *     artifacts (`0.1 + 0.2`, `499.999`) can never sneak through and later
 *     resurface as display corruption.
 *
 * The returned error is an Arabic, user-safe message by contract (Issue 6):
 * it goes straight into `error` fields that the UI renders verbatim.
 */

/** Decimal(10,2) capacity — prices above this cannot be stored. */
export const MAX_EDITABLE_PRICE = 99_999_999.99

export interface PriceValidation {
  ok: boolean
  value?: number
  error?: string
}

export function validateEditablePrice(
  input: unknown,
  opts: { allowZero?: boolean } = {}
): PriceValidation {
  const { allowZero = false } = opts

  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return { ok: false, error: 'السعر يجب أن يكون رقمًا صالحًا' }
  }
  if (input < 0 || (!allowZero && input === 0)) {
    return { ok: false, error: 'السعر يجب أن يكون أكبر من صفر' }
  }
  if (input > MAX_EDITABLE_PRICE) {
    return { ok: false, error: 'السعر يجب ألا يتجاوز 99,999,999.99 جنيهًا' }
  }

  const s = String(input)
  if (s.includes('e') || s.includes('E')) {
    return { ok: false, error: 'السعر يقبل خانتين عشريتين كحد أقصى' }
  }
  const dot = s.indexOf('.')
  if (dot !== -1 && s.length - dot - 1 > 2) {
    return { ok: false, error: 'السعر يقبل خانتين عشريتين كحد أقصى' }
  }

  return { ok: true, value: input }
}

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
  formatCurrency as baseFormatCurrency,
  formatDate as baseFormatDate,
  formatDateTime as baseFormatDateTime,
} from '@/lib/i18n/format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, locale?: string): string {
  return baseFormatCurrency(amount, { locale })
}

export function formatDate(date: Date | string, locale?: string): string {
  return baseFormatDate(date, { locale })
}

export function formatDateTime(date: Date | string, locale?: string): string {
  return baseFormatDateTime(date, { locale })
}

/** Egyptian mobile display format: 01012345678 → +20 101 234 5678 */
export function formatPhone(phone: string): string {
  if (!phone) return ''
  const cleaned = phone.replace(/\D/g, '')
  // 01XXXXXXXXX (local) or 20 1XXXXXXXXX / 201XXXXXXXXX (country-code forms)
  if (cleaned.length === 11 && cleaned.startsWith('01')) {
    const rest = cleaned.slice(1) // 1XXXXXXXXX
    return `+20 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`
  }
  if (cleaned.length === 12 && cleaned.startsWith('20')) {
    const rest = cleaned.slice(2)
    return `+20 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`
  }
  if (cleaned.length === 13 && cleaned.startsWith('200')) {
    const rest = cleaned.slice(3)
    return `+20 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`
  }
  return phone
}

export function generatePatientId(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `PAT${year}${month}${random}`
}

export function generateInvoiceNo(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear())
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `INV-${year}${month}-${random}`
}

/** Egyptian VAT — standard rate 14% (ضريبة القيمة المضافة). */
export function calculateVAT(amount: number, rate: number = 14) {
  const vat = Math.round(((amount * rate) / 100) * 100) / 100
  return {
    subtotal: amount,
    vat,
    total: Math.round((amount + vat) * 100) / 100,
  }
}

/** Egyptian National ID: exactly 14 digits. */
export function validateNationalId(nationalId: string): boolean {
  const cleaned = nationalId.replace(/[\s-]/g, '')
  return /^\d{14}$/.test(cleaned)
}

/**
 * Egyptian mobile validation: 01XXXXXXXXX local, +20/00 20 country-code forms.
 * Valid prefixes: 010, 011, 012, 015.
 */
export function validateEgyptianPhone(phone: string): boolean {
  let cleaned = phone.replace(/[\s()-]/g, '')
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1)
  if (cleaned.startsWith('0020')) cleaned = '0' + cleaned.slice(4)
  else if (cleaned.startsWith('20') && cleaned.length === 12) cleaned = '0' + cleaned.slice(2)
  return /^01[0125]\d{8}$/.test(cleaned)
}

/** Egyptian Tax Registration Number: exactly 9 digits. */
export function validateTaxId(taxId: string): boolean {
  const cleaned = taxId.replace(/[\s-]/g, '')
  return /^\d{9}$/.test(cleaned)
}

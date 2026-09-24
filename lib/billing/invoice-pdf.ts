/**
 * Phase 12 — invoice PDF (D10).
 *
 * Arabic-first invoice document built on the existing PDF infrastructure
 * (`lib/pdf` + `lib/pdf-arabic` shaping + embedded Noto Naskh Arabic). The
 * document language follows the staff member's working locale, same rule as
 * the Phase 6 WhatsApp invoice (docs/LOCALIZATION.md §6) — so an Arabic-mode
 * clinic prints Arabic invoices with the 14% VAT breakdown.
 *
 * Layout:
 *   Header  : invoice no + clinic + issue date
 *   Patient : name + phone
 *   Dates   : issue / due
 *   Items   : description × quantity — amount (per line)
 *   Totals  : subtotal, discount, VAT (14%), total, paid, balance
 *   Status  : payment status line
 *   Footer  : thank-you line
 */
import { renderSimplePdf } from '@/lib/pdf'
import { getServerLocale } from '@/lib/i18n/server'
import { translateText } from '@/lib/i18n/dictionary'
import { formatDate, formatCurrency } from '@/lib/i18n/format'

export interface InvoicePdfData {
  invoiceNo: string
  status: string
  clinicName: string
  patientName: string
  patientPhone?: string | null
  issueDate: Date
  issuedAt: Date | null
  dueDate: Date | null
  items: Array<{ description: string; quantity: number; unitPrice: number | string; amount: number | string }>
  subtotal: number | string
  discountAmount: number | string
  vatRate: number | string
  vatAmount: number | string
  total: number | string
  paidAmount: number | string
  balanceAmount: number | string
  notes?: string | null
}

/** Localized currency, 2 decimals — matches the Phase 6 invoice caption rule. */
function money(value: number | string, locale: string): string {
  return formatCurrency(Number(value) || 0, { locale })
}

export async function generateInvoicePDF(inv: InvoicePdfData): Promise<Buffer> {
  const locale = await getServerLocale()
  const t = (key: string, vars?: Record<string, string | number>) => translateText(locale, key, vars)
  const moneyLocal = (v: number | string) => money(v, locale)
  const date = (d: Date) => formatDate(d, { locale })

  const lines: Array<{ text: string; bold?: boolean; gapAfter?: number }> = [
    {
      text: t('Patient: {v1}', { v1: inv.patientName }),
      bold: true,
      gapAfter: 2,
    },
  ]
  if (inv.patientPhone) {
    lines.push({ text: t('Phone: {v1}', { v1: inv.patientPhone }), gapAfter: 6 })
  }
  lines.push(
    { text: t('Issue date: {v1}', { v1: date(inv.issuedAt ?? inv.issueDate) }) },
    { text: t('Due date: {v1}', { v1: inv.dueDate ? date(inv.dueDate) : '—' }), gapAfter: 8 },
    { text: t('Items:'), bold: true, gapAfter: 4 }
  )
  for (const item of inv.items) {
    lines.push({
      text: `- ${item.description} × ${item.quantity} — ${moneyLocal(item.amount)}`,
      gapAfter: 2,
    })
  }
  lines.push({ text: '', gapAfter: 6 })
  lines.push({ text: t('Subtotal: {v1}', { v1: moneyLocal(inv.subtotal) }) })
  if (Number(inv.discountAmount) > 0) {
    lines.push({ text: t('Discount: {v1}', { v1: moneyLocal(inv.discountAmount) }) })
  }
  lines.push({
    text: t('VAT ({v1}%): {v2}', { v1: Number(inv.vatRate), v2: moneyLocal(inv.vatAmount) }),
  })
  lines.push({ text: t('Total: {v1}', { v1: moneyLocal(inv.total) }), bold: true, gapAfter: 4 })
  lines.push(
    { text: t('Paid: {v1}', { v1: moneyLocal(inv.paidAmount) }) },
    { text: t('Balance: {v1}', { v1: moneyLocal(inv.balanceAmount) }), gapAfter: 4 }
  )
  // Status label resolves through the dictionary reverse index (billing-utils labels)
  lines.push({ text: t('Payment status: {v1}', { v1: t(statusLabel(inv.status)) }) })
  if (inv.notes) {
    lines.push({ text: t('Notes: {v1}', { v1: inv.notes }), gapAfter: 6 })
  }

  return renderSimplePdf({
    title: t('Invoice {v1}', { v1: inv.invoiceNo }),
    subtitle: `${inv.clinicName} — ${date(inv.issueDate)}`,
    lines,
    footer: t('Thank you for choosing our clinic.'),
  })
}

/** English label for a status value — translatable via the reverse index. */
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    PENDING: 'Pending',
    ISSUED: 'Issued',
    PARTIALLY_PAID: 'Partially Paid',
    PAID: 'Paid',
    OVERDUE: 'Overdue',
    CANCELLED: 'Cancelled',
    REFUNDED: 'Refunded',
  }
  return labels[status] ?? status
}

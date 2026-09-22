import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { renderSimplePdf } from '@/lib/pdf'
import { formatCurrency, formatDate } from '@/lib/i18n/format'
import { getServerLocale } from '@/lib/i18n/server'
import { translateText } from '@/lib/i18n/dictionary'
import { enqueueMessage } from '@/lib/messaging/service'
import * as templates from '@/lib/messaging/templates'

/**
 * POST /api/communications/invoices/[id]/send — invoice via WhatsApp
 * (master prompt 3G). RBAC: ACCOUNTANT, ADMIN. Tenant-scoped.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole(['ACCOUNTANT', 'ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where: { id, hospitalId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        items: { select: { description: true, quantity: true, unitPrice: true, amount: true } },
      },
    })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const recipient =
      typeof body?.contactPhone === 'string' && body.contactPhone.trim()
        ? body.contactPhone.trim()
        : invoice.patient.phone

    // The document follows the language the staff member is working in, so an
    // Arabic-mode clinic sends Arabic invoices (see docs/LOCALIZATION.md §6).
    const locale = await getServerLocale()
    const t = (key: string, vars?: Record<string, string | number>) =>
      translateText(locale, key, vars)

    const clinicName =
      (await prisma.hospital.findUnique({ where: { id: hospitalId }, select: { name: true } }))?.name ??
      t('Clinic')
    // Caption values keep the message-template format that 3C–3J pins
    // (plain 2-decimal total, ISO date); the document itself is localized.
    const dateStr = new Date().toISOString().slice(0, 10)
    const total = Number(invoice.totalAmount).toFixed(2)
    const pdfDate = formatDate(new Date(), { locale })
    const money = (value: unknown) => formatCurrency(Number(value), { locale })

    const pdf = renderSimplePdf({
      title: t('Invoice {v1}', { v1: invoice.invoiceNo }),
      subtitle: `${clinicName} — ${pdfDate}`,
      lines: [
        {
          text: t('Patient: {v1}', {
            v1: `${invoice.patient.firstName} ${invoice.patient.lastName}`,
          }),
          bold: true,
          gapAfter: 10,
        },
        { text: t('Items:'), bold: true, gapAfter: 4 },
        ...invoice.items.map(
          (item: { description: string; quantity: number; amount: unknown }) => ({
            text: `- ${item.description} × ${item.quantity} — ${money(item.amount)}`,
            gapAfter: 2,
          })
        ),
        { text: '', gapAfter: 6 },
        { text: t('Subtotal: {v1}', { v1: money(invoice.subtotal) }) },
        { text: t('Total: {v1}', { v1: total }), bold: true },
        { text: t('Paid: {v1}', { v1: money(invoice.paidAmount) }) },
        { text: t('Balance: {v1}', { v1: money(invoice.balanceAmount) }) },
      ],
      footer: t('Thank you for choosing our clinic.'),
    })

    const queueId = await enqueueMessage({
      hospitalId,
      patientId: invoice.patient.id,
      recipient,
      channel: 'WHATSAPP',
      messageType: 'INVOICE',
      payload: {
        text: templates.invoiceSent({ name: clinicName }, invoice.invoiceNo, total, dateStr),
        attachment: {
          filename: `invoice-${invoice.invoiceNo}.pdf`,
          mimeType: 'application/pdf',
          data: pdf.toString('base64'),
        },
      },
    })

    if (!queueId) {
      return NextResponse.json(
        { error: 'No valid recipient phone number on file for this patient' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, queueId }, { status: 201 })
  } catch (err) {
    console.error('Error sending invoice:', err)
    return NextResponse.json({ error: 'Failed to queue invoice message' }, { status: 500 })
  }
}

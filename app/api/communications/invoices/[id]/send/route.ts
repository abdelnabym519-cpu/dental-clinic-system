import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { generateInvoicePDF } from '@/lib/billing/invoice-pdf'
import { getServerLocale } from '@/lib/i18n/server'
import { translateText } from '@/lib/i18n/dictionary'
import { enqueueMessage } from '@/lib/messaging/service'
import * as templates from '@/lib/messaging/templates'
import { getStorage } from '@/lib/storage'
import { buildStorageKey } from '@/lib/storage/keys'

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

    // Phase 12 — the full invoice layout (Arabic, 14% VAT breakdown, payment
    // status) instead of the minimal line list.
    const pdf = await generateInvoicePDF({
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      clinicName,
      patientName: `${invoice.patient.firstName} ${invoice.patient.lastName}`.trim(),
      patientPhone: invoice.patient.phone,
      issueDate: new Date(),
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      items: invoice.items,
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
      vatRate: invoice.cgstRate,
      vatAmount: invoice.cgstAmount,
      total: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      balanceAmount: invoice.balanceAmount,
      notes: invoice.notes,
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

    // Phase 12 — persist the sent PDF and mark the invoice (same rule as the
    // e-prescription send): the stored file is what the patient received.
    const storageKey = buildStorageKey(hospitalId, 'invoices', invoice.id, 'invoice.pdf')
    await getStorage().put(storageKey, pdf, { contentType: 'application/pdf' })
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { sentViaWhatsApp: true, pdfUrl: storageKey },
    })

    return NextResponse.json(
      { success: true, queueId, pdfUrl: storageKey },
      { status: 201 }
    )
  } catch (err) {
    console.error('Error sending invoice:', err)
    return NextResponse.json({ error: 'Failed to queue invoice message' }, { status: 500 })
  }
}

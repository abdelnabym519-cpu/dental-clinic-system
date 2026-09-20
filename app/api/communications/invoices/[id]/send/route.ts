import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { renderSimplePdf } from '@/lib/pdf'
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

    const clinicName = (await prisma.hospital.findUnique({ where: { id: hospitalId }, select: { name: true } }))?.name ?? 'Clinic'
    const dateStr = new Date().toISOString().slice(0, 10)
    const total = Number(invoice.totalAmount).toFixed(2)

    const pdf = renderSimplePdf({
      title: `Invoice ${invoice.invoiceNo}`,
      subtitle: `${clinicName} — ${dateStr}`,
      lines: [
        {
          text: `Patient: ${invoice.patient.firstName} ${invoice.patient.lastName}`,
          bold: true,
          gapAfter: 10,
        },
        { text: 'Items:', bold: true, gapAfter: 4 },
        ...invoice.items.map(
          (item: { description: string; quantity: number; amount: unknown }) => ({
            text: `- ${item.description} × ${item.quantity} — ${Number(item.amount).toFixed(2)} EGP`,
            gapAfter: 2,
          })
        ),
        { text: '', gapAfter: 6 },
        { text: `Subtotal: ${Number(invoice.subtotal).toFixed(2)} EGP` },
        { text: `Total: ${total} EGP`, bold: true },
        { text: `Paid: ${Number(invoice.paidAmount).toFixed(2)} EGP` },
        { text: `Balance: ${Number(invoice.balanceAmount).toFixed(2)} EGP` },
      ],
      footer: 'Thank you for choosing our clinic.',
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

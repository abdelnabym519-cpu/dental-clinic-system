import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { generateInvoicePDF } from '@/lib/billing/invoice-pdf'
import { getStorage } from '@/lib/storage'
import { StorageNotFoundError } from '@/lib/storage'

/**
 * GET /api/invoices/[id]/pdf (Phase 12) — the invoice PDF for the preview /
 * print button. Serves the stored document (what was issued/sent) when
 * present, renders on the fly otherwise (drafts). Any authenticated role in
 * the tenant may view the document body.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where: { id, hospitalId },
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true } },
        items: { orderBy: { id: 'asc' } },
      },
    })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const pdfHeaders = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoice.invoiceNo}.pdf"`,
      'Cache-Control': 'no-store',
    }

    // 1) Prefer the stored document (the one that was issued/sent).
    if (invoice.pdfUrl) {
      try {
        const stored = await getStorage().get(invoice.pdfUrl)
        return new Response(new Uint8Array(stored.body), { headers: pdfHeaders })
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) throw err
        // Stored object vanished (e.g. local storage wiped) — fall through.
      }
    }

    // 2) Render on the fly (same layout as the issue/send routes).
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true },
    })
    const pdf = await generateInvoicePDF({
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      clinicName: hospital?.name ?? '',
      patientName: `${invoice.patient.firstName} ${invoice.patient.lastName}`.trim(),
      patientPhone: invoice.patient.phone,
      issueDate: invoice.issuedAt ?? invoice.createdAt,
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

    return new Response(new Uint8Array(pdf), { headers: pdfHeaders })
  } catch (err: unknown) {
    console.error('Error rendering invoice PDF:', err)
    return NextResponse.json(
      { error: 'Failed to render invoice PDF' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requirePatientAuth } from '@/lib/patient-auth'
import { generateInvoicePDF } from '@/lib/billing/invoice-pdf'
import { getStorage, StorageNotFoundError } from '@/lib/storage'

/**
 * GET /api/patient-portal/bills/[id]/pdf (Phase 13, D10) — the invoice PDF
 * for the patient's own record. Same document as the staff/issue routes
 * (Phase 12 `generateInvoicePDF`, Arabic layout, 14% VAT line): stored-first
 * (invoice.pdfUrl), live-render fallback for drafts.
 *
 * SECURITY: looked up by { id, hospitalId, patientId } from the portal
 * token — another patient's invoice is a 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  try {
    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where: { id, hospitalId: patient!.hospitalId, patientId: patient!.id },
      include: { items: { orderBy: { id: 'asc' } } },
    })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const pdfHeaders = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoice.invoiceNo}.pdf"`,
      'Cache-Control': 'no-store',
    }

    if (invoice.pdfUrl) {
      try {
        const stored = await getStorage().get(invoice.pdfUrl)
        return new Response(new Uint8Array(stored.body), { headers: pdfHeaders })
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) throw err
        // Stored object vanished — fall through to re-render.
      }
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: patient!.hospitalId },
      select: { name: true },
    })

    const pdf = await generateInvoicePDF({
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      clinicName: hospital?.name ?? '',
      patientName: `${patient!.firstName} ${patient!.lastName}`.trim(),
      patientPhone: patient!.phone,
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
    console.error('Patient portal invoice PDF error:', err)
    return NextResponse.json({ error: 'Failed to render invoice PDF' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { generateInvoicePDF } from '@/lib/billing/invoice-pdf'
import { getStorage } from '@/lib/storage'
import { buildStorageKey } from '@/lib/storage/keys'

/**
 * POST /api/invoices/[id]/issue (Phase 12) — DRAFT → ISSUED.
 *
 * The issue action is the formal one: it stamps `issuedAt`, renders the
 * Arabic invoice PDF (14% VAT breakdown) and persists it (storage key in
 * `invoice.pdfUrl`) so previews/WhatsApp sends serve the exact issued
 * document. RBAC: ADMIN + ACCOUNTANT (RECEPTIONIST creates and takes cash,
 * per the billing RBAC matrix).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'ACCOUNTANT'])
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
    if (invoice.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Only DRAFT invoices can be issued' },
        { status: 409 }
      )
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true },
    })

    // cgstAmount is the Egyptian VAT amount (sgst stays 0 — see billing-utils)
    const pdf = await generateInvoicePDF({
      invoiceNo: invoice.invoiceNo,
      status: 'ISSUED',
      clinicName: hospital?.name ?? '',
      patientName: `${invoice.patient.firstName} ${invoice.patient.lastName}`.trim(),
      patientPhone: invoice.patient.phone,
      issueDate: new Date(),
      issuedAt: null,
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

    const storageKey = buildStorageKey(hospitalId, 'invoices', invoice.id, 'invoice.pdf')
    await getStorage().put(storageKey, pdf, { contentType: 'application/pdf' })

    const issued = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'ISSUED',
        issuedAt: new Date(),
        pdfUrl: storageKey,
      },
      include: { patient: true, items: true },
    })

    return NextResponse.json(
      { success: true, data: issued, actorId: session?.user?.id, pdfUrl: storageKey },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('Error issuing invoice:', err)
    return NextResponse.json(
      { error: 'Failed to issue invoice' },
      { status: 500 }
    )
  }
}

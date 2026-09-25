import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

import { prisma } from '@/lib/prisma'
import { requirePatientAuth } from '@/lib/patient-auth'

/**
 * POST /api/patient-portal/bills/[id]/pay (Phase 13, D10) — the patient
 * starts online payment for one of their own outstanding invoices.
 *
 * Mirrors the staff link generator (/api/payments/link) but is strictly
 * patient-scoped: the invoice must belong to the authenticated portal
 * patient (404 otherwise), a balance must remain, and the hospital's
 * payment gateway must be enabled. Creates a 48h single-use PaymentLink —
 * the checkout itself is the existing public /pay/[token] page.
 *
 * Body: (optional) { method: 'FAWRY' | 'PAYMOB' } — informational only;
 * the gateway page offers the configured methods.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  try {
    const { id } = await params

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        hospitalId: patient!.hospitalId,
        patientId: patient!.id,
      },
      select: { id: true, invoiceNo: true, balanceAmount: true, status: true },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const balance = Number(invoice.balanceAmount)
    if (balance <= 0) {
      return NextResponse.json({ error: 'Invoice is already fully paid' }, { status: 400 })
    }
    if (invoice.status === 'CANCELLED' || invoice.status === 'REFUNDED') {
      return NextResponse.json(
        { error: 'This invoice cannot be paid' },
        { status: 400 }
      )
    }

    const gatewayConfig = await prisma.paymentGatewayConfig.findUnique({
      where: { hospitalId: patient!.hospitalId },
      select: { isEnabled: true },
    })
    if (!gatewayConfig?.isEnabled) {
      return NextResponse.json(
        { error: 'Online payment is not available at this clinic' },
        { status: 400 }
      )
    }

    const token = randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

    await prisma.paymentLink.create({
      data: {
        hospitalId: patient!.hospitalId,
        invoiceId: invoice.id,
        token,
        amount: balance,
        expiresAt,
      },
    })

    const paymentUrl = `${process.env.NEXTAUTH_URL}/pay/${token}`

    return NextResponse.json(
      {
        success: true,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        amount: balance,
        expiresAt,
        paymentUrl,
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('Patient portal pay error:', err)
    return NextResponse.json({ error: 'Failed to start payment' }, { status: 500 })
  }
}

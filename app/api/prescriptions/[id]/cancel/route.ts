import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'

/**
 * POST /api/prescriptions/[id]/cancel (Issue 5) — the schema's canonical
 * CANCELLED lifecycle state, finally reachable. Cancelling preserves the
 * clinical record (auditable history) where hard-delete silently destroyed
 * signed/sent documents. DOCTOR/ADMIN only, tenant-scoped, irreversible —
 * a cancelled prescription never silently becomes active again (edit stays
 * DRAFT-only and sign stays DRAFT-only by construction).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requireAuthAndRole(['ADMIN', 'DOCTOR'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const prescription = await prisma.prescription.findFirst({
      where: { id, hospitalId },
      select: { id: true, status: true, prescriptionNo: true },
    })
    if (!prescription) {
      return NextResponse.json({ error: 'الروشتة غير موجودة' }, { status: 404 })
    }

    if (prescription.status === 'CANCELLED') {
      return NextResponse.json({ error: 'الروشتة ملغاة بالفعل' }, { status: 409 })
    }

    const cancelled = await prisma.prescription.update({
      where: { id: prescription.id },
      data: { status: 'CANCELLED' },
      select: { id: true, status: true, prescriptionNo: true },
    })

    void session

    return NextResponse.json({ success: true, data: cancelled })
  } catch (err: unknown) {
    console.error('Error cancelling prescription:', err)
    // Issue 5 — raw internal errors never reach the clinic user.
    return NextResponse.json({ error: 'تعذر إلغاء الروشتة. حاول مرة أخرى.' }, { status: 500 })
  }
}

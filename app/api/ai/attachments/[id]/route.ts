/**
 * Phase 6 — attachment retrieval / removal.
 *
 * GET  /api/ai/attachments/:id — safe metadata + a SIGNED, time-limited URL
 *      (the raw storage key is never returned). Authorization: the caller's
 *      tenant + (staff OR the attachment's own patient, server-verified).
 * DELETE — staff only, and only while no imaging study references the
 *      artifact (the imaging flow owns that lifecycle).
 */

import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { getStorage } from '@/lib/storage'
import { createAttachmentService } from '@/lib/ai/multimodal/attachments'
import { keyBelongsToHospital } from '@/lib/storage'

export const dynamic = 'force-dynamic'

const service = createAttachmentService(prisma)

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const record = await service.get(id, hospitalId)
  if (!record) return NextResponse.json({ error: 'Attachment not found', code: 'NOT_FOUND' }, { status: 404 })

  // Authorization: staff always; PATIENT only for their own attachment.
  if (user.role === 'PATIENT' && record.patientId) {
    const own = await prisma.patient.findFirst({
      where: { id: record.patientId, hospitalId, portalUserId: user.id },
      select: { id: true },
    })
    if (!own) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
  } else if (user.role === 'PATIENT' && !record.patientId) {
    // Conversation-scoped attachments are visible to their author only.
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
  }

  if (!keyBelongsToHospital(record.storageKey, hospitalId)) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
  }

  const url = await getStorage().getSignedUrl(record.storageKey, 300)
  return NextResponse.json({ attachment: service.toRef(record), url })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { error, user, hospitalId } = await requireAuthAndRole(['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'])
  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const record = await service.get(id, hospitalId)
  if (!record) return NextResponse.json({ error: 'Attachment not found', code: 'NOT_FOUND' }, { status: 404 })
  if (record.studyId) {
    return NextResponse.json(
      { error: 'This attachment is referenced by an imaging study', code: 'STILL_REFERENCED' },
      { status: 409 },
    )
  }
  await prisma.multimodalAttachment.delete({ where: { id: record.id } })
  try {
    await getStorage().delete(record.storageKey)
  } catch {
    /* idempotent — the row is gone, which is what matters */
  }
  return NextResponse.json({ ok: true })
}

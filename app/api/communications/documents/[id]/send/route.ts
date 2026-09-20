import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { getStorage, StorageNotFoundError } from '@/lib/storage'
import { enqueueMessage } from '@/lib/messaging/service'
import * as templates from '@/lib/messaging/templates'

/**
 * POST /api/communications/documents/[id]/send — send a radiology result /
 * patient-file image via WhatsApp (master prompt 3H). RBAC: DOCTOR, ADMIN.
 * Tenant-scoped. The image bytes come from the same storage the patient file
 * uses; nothing is re-uploaded anywhere else.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requireAuthAndRole(['DOCTOR', 'ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const document = await prisma.document.findFirst({
      where: { id, hospitalId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    })
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (!document.fileType.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image documents can be sent via WhatsApp from this action' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const recipient =
      typeof body?.contactPhone === 'string' && body.contactPhone.trim()
        ? body.contactPhone.trim()
        : document.patient.phone

    // Read the image from clinic storage (patient file source of truth).
    let attachment
    try {
      const stored = await getStorage().get(document.filePath)
      attachment = {
        filename: document.originalName || document.fileName,
        mimeType: stored.contentType || document.fileType,
        data: stored.body.toString('base64'),
      }
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        return NextResponse.json({ error: 'Stored image file is missing' }, { status: 410 })
      }
      throw err
    }

    const clinicName = (await prisma.hospital.findUnique({ where: { id: hospitalId }, select: { name: true } }))?.name ?? 'Clinic'
    const doctorRow = await prisma.staff.findFirst({
      where: { userId: session?.user?.id ?? '', hospitalId },
      select: { firstName: true, lastName: true },
    })
    const doctorName = doctorRow ? `Dr. ${doctorRow.firstName} ${doctorRow.lastName}` : 'فريق العيادة'
    const dateStr = new Date().toISOString().slice(0, 10)

    const queueId = await enqueueMessage({
      hospitalId,
      patientId: document.patient.id,
      recipient,
      channel: 'WHATSAPP',
      messageType: 'RADIOLOGY',
      payload: {
        text: templates.radiologySent({ name: clinicName }, doctorName, dateStr),
        attachment,
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
    console.error('Error sending radiology image:', err)
    return NextResponse.json({ error: 'Failed to queue radiology message' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { enqueueMessage } from '@/lib/messaging/service'
import { translateText } from '@/lib/i18n/dictionary'

/**
 * POST /api/portal/accounts (Phase 13, D3) — create a portal account for an
 * existing patient.
 *
 * Body: { patientId, password }
 * RBAC: ADMIN, RECEPTIONIST (the roles that manage patient records).
 *
 * Creates a User with role PATIENT linked from Patient.portalUserId
 * (D4) and enables the portal. The OTP flow keeps working independently —
 * a patient with a portal account can log in with phone + password at
 * /portal/login (see /api/patient-portal/auth/login) or with an OTP.
 * A welcome message is queued on the existing WhatsApp MessageQueue.
 */
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN', 'RECEPTIONIST'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { patientId, password } = body as { patientId?: string; password?: string }

    if (!patientId || !password) {
      return NextResponse.json(
        { error: 'Patient and password are required' },
        { status: 400 }
      )
    }

    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const patient = await prisma.patient.findUnique({
      where: { id: patientId, hospitalId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        locale: true,
        portalUserId: true,
      },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    if (patient.portalUserId) {
      return NextResponse.json(
        { error: 'Portal account already exists' },
        { status: 409 }
      )
    }

    // User.email is @unique and patients often have no email — derive a
    // deterministic, phone-based address so the portal account stays
    // addressable without colliding with a staff email.
    const portalEmail =
      patient.email || `patient-${patient.phone.replace(/[^0-9]/g, '')}@portal.dentora.local`

    const emailTaken = await prisma.user.findUnique({
      where: { email: portalEmail },
      select: { email: true },
    })
    if (emailTaken) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        hospitalId,
        email: portalEmail,
        password: hashedPassword,
        name: `${patient.firstName} ${patient.lastName}`.trim(),
        phone: patient.phone,
        role: 'PATIENT',
        isActive: true,
        locale: patient.locale,
      },
      select: { id: true, email: true },
    })

    await prisma.patient.update({
      where: { id: patient.id },
      data: { portalUserId: user.id, portalEnabled: true },
    })

    // Welcome message via the existing MessageQueue (Phase 10 infra).
    // `password` is deliberately NOT in the message — the patient already
    // chose it; the message only activates the portal.
    const locale = patient.locale || 'ar-EG'
    const welcomeText = `${translateText(locale, 'Your clinic account is ready')} ${patient.firstName} ${patient.lastName}`
    await enqueueMessage({
      hospitalId,
      patientId: patient.id,
      recipient: patient.phone,
      channel: 'WHATSAPP',
      messageType: 'WELCOME',
      payload: { text: welcomeText },
    })

    return NextResponse.json(
      {
        success: true,
        portalAccount: {
          patientId: patient.id,
          userId: user.id,
          email: user.email,
          portalEnabled: true,
        },
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('Portal account creation error:', err)
    return NextResponse.json({ error: 'Failed to create portal account' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

import { prisma } from '@/lib/prisma'
import { createPatientToken, setPatientCookie } from '@/lib/patient-auth'

/**
 * POST /api/patient-portal/auth/login (Phase 13, D3) — phone + password
 * login for patients with a linked portal account (created via
 * /api/portal/accounts). Issues the SAME patient cookie as the OTP flow,
 * so the rest of the portal (layout guard, /api/patient-portal/*) works
 * identically for both login modes.
 *
 * Body: { phone, password, hospitalSlug }
 * Fails with one generic 401 on any mismatch (no user/password
 * enumeration).
 */
export async function POST(req: NextRequest) {
  try {
    const { phone, password, hospitalSlug } = (await req.json()) as {
      phone?: string
      password?: string
      hospitalSlug?: string
    }

    if (!phone || !password || !hospitalSlug) {
      return NextResponse.json(
        { error: 'Phone, password, and clinic identifier are required' },
        { status: 400 }
      )
    }

    const hospital = await prisma.hospital.findUnique({
      where: { slug: hospitalSlug },
      select: { id: true },
    })

    if (!hospital) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    }

    const patient = await prisma.patient.findFirst({
      where: { hospitalId: hospital.id, phone, isActive: true, portalEnabled: true },
      include: {
        portalUser: {
          select: { id: true, password: true, isActive: true, name: true },
        },
      },
    })

    if (!patient?.portalUser || !patient.portalUser.isActive) {
      return NextResponse.json({ error: 'Invalid phone or password' }, { status: 401 })
    }

    const passwordMatch = await bcrypt.compare(password, patient.portalUser.password)
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Invalid phone or password' }, { status: 401 })
    }

    const token = await createPatientToken({
      patientId: patient.id,
      hospitalId: patient.hospitalId,
      phone: patient.phone,
    })

    const response = NextResponse.json({
      success: true,
      patient: {
        id: patient.id,
        name: patient.portalUser.name,
        phone: patient.phone,
      },
    })

    return setPatientCookie(response, token)
  } catch (err: unknown) {
    console.error('Portal password login error:', err)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}

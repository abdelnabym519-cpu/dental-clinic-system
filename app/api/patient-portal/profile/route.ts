import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { requirePatientAuth } from '@/lib/patient-auth'
import { isSupportedLocale, locales, resolveLocaleCascade, type Locale } from '@/lib/i18n/config'
import bcrypt from 'bcryptjs'

/**
 * The signed-in patient's own portal preferences.
 *
 * Scoped to the patient in the OTP cookie, never to an id from the request —
 * the portal is the one place where an authenticated caller is not staff, and
 * a patient must not be able to read or write another patient's row.
 */

const profileUpdateSchema = z
  .object({
    // `null` or an empty string clears the override and inherits the clinic's
    // locale. See lib/i18n/config.ts for why that is not the same as picking
    // the clinic's current value.
    locale: z
      .union([z.string(), z.null()])
      .refine((value) => value === null || value === '' || isSupportedLocale(value), {
        message: 'Unsupported locale',
      })
      .transform((value) => (value === null || value === '' ? null : (value as Locale)))
      // Phase 13 (D11): the spec body is fully optional ({ email?, language?,
      // currentPassword?, newPassword? }) — locale stays optional for
      // backward compatibility with the existing locale-only clients.
      .optional(),
    // Phase 13 (D11) — the patient may update their own email. Name and
    // phone stay read-only: the clinic manages those records.
    email: z
      .string()
      .email()
      .max(191)
      .optional()
      .or(z.literal('')),
    currentPassword: z.string().max(128).optional(),
    newPassword: z.string().min(8).max(128).optional(),
})

export async function GET(req: NextRequest) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  try {
    const record = await prisma.patient.findUnique({
      where: { id: patient!.id },
      select: {
        firstName: true,
        lastName: true,
        locale: true,
        hospital: { select: { locale: true } },
      },
    })

    if (!record) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    return NextResponse.json({
      firstName: record.firstName,
      lastName: record.lastName,
      locale: record.locale,
      hospitalLocale: record.hospital?.locale ?? null,
      effectiveLocale: resolveLocaleCascade(record.locale, record.hospital?.locale),
      supportedLocales: locales,
    })
  } catch (err: unknown) {
    console.error('Portal profile error:', err)
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  let locale: Locale | null | undefined
  let email: string | undefined
  let currentPassword: string | undefined
  let newPassword: string | undefined
  try {
    ;({ locale, email, currentPassword, newPassword } = profileUpdateSchema.parse(await req.json()))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: err.issues[0]?.message === 'Unsupported locale' ? 'Unsupported locale' : 'Invalid request body',
          details: err.issues,
        },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const wantsPasswordChange = newPassword !== undefined
  if (wantsPasswordChange && currentPassword === undefined) {
    return NextResponse.json(
      { error: 'Current password is required to change the password' },
      { status: 400 }
    )
  }

  try {
    const patientRow = await prisma.patient.findUnique({
      where: { id: patient!.id },
      select: {
        portalUserId: true,
        hospital: { select: { locale: true } },
      },
    })

    if (wantsPasswordChange) {
      if (!patientRow?.portalUserId) {
        return NextResponse.json(
          { error: 'Password can only be changed when a portal account exists' },
          { status: 400 }
        )
      }
      const portalUser = await prisma.user.findUnique({
        where: { id: patientRow.portalUserId },
        select: { id: true, password: true },
      })
      const currentOk = portalUser
        ? await bcrypt.compare(currentPassword as string, portalUser.password)
        : false
      if (!currentOk) {
        return NextResponse.json(
          { error: 'Current password is incorrect' },
          { status: 400 }
        )
      }
      await prisma.user.update({
        where: { id: patientRow.portalUserId },
        data: { password: await bcrypt.hash(newPassword as string, 10) },
      })
    }

    const updated = await prisma.patient.update({
      where: { id: patient!.id },
      data: {
        ...(locale !== undefined ? { locale } : {}),
        ...(email !== undefined ? { email: email === '' ? null : email } : {}),
      },
      select: { locale: true, email: true, hospital: { select: { locale: true } } },
    })

    const messages: string[] = []
    if (locale !== undefined) {
      messages.push(locale ? 'Language updated' : 'Language reset to the clinic default')
    }
    if (email !== undefined) {
      messages.push('Email updated')
    }
    if (wantsPasswordChange) {
      messages.push('Password updated')
    }

    return NextResponse.json({
      locale: updated.locale,
      email: updated.email,
      effectiveLocale: resolveLocaleCascade(updated.locale, updated.hospital?.locale),
      message: messages.join('; ') || 'Profile updated',
    })
  } catch (err: unknown) {
    console.error('Portal profile update error:', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

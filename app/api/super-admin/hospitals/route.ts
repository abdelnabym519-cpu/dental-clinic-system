import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Phase 9 licensing — SUPER_ADMIN only: list every hospital with its
 * subscription status and size counts. No hospitalId scoping by design:
 * the platform level is explicitly tenant-agnostic (the one place in the
 * system that is).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.isSuperAdmin && session?.user?.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const hospitals = await prisma.hospital.findMany({
    include: {
      subscription: {
        select: {
          id: true,
          plan: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          gracePeriodDays: true,
          autoRenew: true,
          notes: true,
        },
      },
      _count: {
        select: { users: true, patients: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(hospitals)
}

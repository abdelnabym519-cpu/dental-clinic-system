import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Phase 9 licensing — SUPER_ADMIN only: the license audit trail
 * (append-only LicenseAuditLog rows), newest first.
 *
 * Query params:
 *   hospitalId — filter by hospital (its subscription only)
 *   take / skip — simple pagination (take defaults to 100, max 500)
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isSuperAdmin && session?.user?.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const hospitalId = searchParams.get('hospitalId')
  const take = Math.min(parseInt(searchParams.get('take') || '100', 10) || 100, 500)
  const skip = parseInt(searchParams.get('skip') || '0', 10) || 0

  const logs = await prisma.licenseAuditLog.findMany({
    where: hospitalId ? { subscription: { hospitalId } } : undefined,
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  })

  return NextResponse.json(logs)
}

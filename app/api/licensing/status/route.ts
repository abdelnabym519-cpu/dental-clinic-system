import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkHospitalSubscription } from '@/lib/licensing/check-subscription'

/**
 * Phase 9 licensing — the current tenant's subscription status.
 *
 * Used by the in-app warning banner (ADMIN role) and available to any
 * authenticated hospital member for diagnostics. SUPER_ADMIN (no hospital)
 * gets 401 by design: the platform level has no subscription.
 */
export async function GET() {
  const session = await auth()

  if (!session?.user || !session.user.hospitalId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await checkHospitalSubscription(session.user.hospitalId)
  return NextResponse.json(result)
}

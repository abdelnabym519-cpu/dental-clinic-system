import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { SubscriptionExpiredClient } from './SubscriptionExpiredClient'

/**
 * Phase 9 licensing — the hard-block page for tenants whose subscription is
 * EXPIRED / SUSPENDED / CANCELLED (or missing). Reached by the dashboard
 * layout gate; listed as a public route in middleware.ts so an expired,
 * logged-in session can always land here (and a logged-out visitor is sent
 * to /login by the page itself, matching the rest of the app's flow).
 *
 * SUPER_ADMIN is never shown this page: the platform level bypasses all
 * subscription checks and is sent to /super-admin instead.
 */
export default async function SubscriptionExpiredPage() {
  const session = await auth()

  if (session?.user?.isSuperAdmin || session?.user?.role === 'SUPER_ADMIN') {
    redirect('/super-admin')
  }

  if (!session) {
    redirect('/login')
  }

  return <SubscriptionExpiredClient userEmail={session.user.email ?? ''} />
}

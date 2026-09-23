import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkHospitalSubscription } from '@/lib/licensing/check-subscription'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { SubscriptionWarningBanner } from '@/components/licensing/SubscriptionWarningBanner'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  // Phase 9 licensing gate. The Edge middleware is intentionally Prisma-free,
  // so the tenant-level subscription check lives here — the single Node-runtime
  // choke point every staff page passes through:
  //   - SUPER_ADMIN never enters a hospital workspace: /super-admin only.
  //   - A user with no hospital (and not super admin) is an invalid state:
  //     back to login rather than rendering an untenant-able shell.
  //   - Every other user must have a usable subscription (ACTIVE/TRIAL/
  //     GRACE_PERIOD); EXPIRED / SUSPENDED / CANCELLED / missing row
  //     (fail closed) goes to the /subscription-expired page.
  if (session.user.isSuperAdmin || session.user.role === 'SUPER_ADMIN') {
    redirect('/super-admin')
  }

  const hospitalId = session.user.hospitalId
  if (!hospitalId) {
    redirect('/login')
  }

  const subscription = await checkHospitalSubscription(hospitalId)
  if (!subscription.allowed) {
    redirect('/subscription-expired')
  }

  // Fetch hospital info
  const hospital = hospitalId
    ? await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: {
          name: true,
          plan: true,
          logo: true,
          onboardingCompleted: true,
        },
      })
    : null

  // Redirect to onboarding if not complete (except if already on onboarding page)
  if (hospital && !hospital.onboardingCompleted) {
    redirect('/onboarding')
  }

  const user = {
    name: session.user.name || 'User',
    email: session.user.email || '',
    role: session.user.role || 'RECEPTIONIST',
  }

  const hospitalInfo = hospital
    ? {
        name: hospital.name,
        plan: hospital.plan,
        logo: hospital.logo,
      }
    : undefined

  return (
    <DashboardShell user={user} hospital={hospitalInfo}>
      <SubscriptionWarningBanner />
      {children}
    </DashboardShell>
  )
}

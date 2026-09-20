import { AccessDenied } from '@/components/settings/access-denied'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { settingsSectionFromPath } from '@/lib/settings-access'

export const metadata = {
  title: 'Access Denied — 403',
}

/**
 * Forbidden destination for the settings area. middleware.ts rewrites
 * unauthorized /settings/* requests here (URL stays, no redirect), so users
 * get a proper forbidden screen instead of being bounced to /dashboard.
 */
export default async function SettingsAccessDeniedPage() {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }

  return <AccessDenied />
}

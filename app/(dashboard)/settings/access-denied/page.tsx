import { AccessDenied } from '@/components/settings/access-denied'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { settingsSectionFromPath } from '@/lib/settings-access'
import { getServerTranslator } from '@/lib/i18n/server'

export async function generateMetadata() {
  // Browser-tab title follows the selected locale, like the rendered UI.
  const { t } = await getServerTranslator()
  return { title: t('Access Denied — 403') }
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

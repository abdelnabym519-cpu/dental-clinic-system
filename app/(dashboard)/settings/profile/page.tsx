import { redirect } from 'next/navigation'

import { AccessDenied } from '@/components/settings/access-denied'
import { LanguagePreferenceCard } from '@/components/i18n/language-preference-card'
import { auth } from '@/lib/auth'
import { canAccessSettingsSection } from '@/lib/settings-access'
import { locales } from '@/lib/i18n/config'
import { getServerTranslator } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'

/**
 * Server component: the locale comes from `getServerTranslator()` (the
 * `dentora-locale` cookie) rather than a hook, so the title and subtitle are
 * already Arabic in the first byte of HTML — no English flash before hydration.
 */
export async function generateMetadata() {
  const { t } = await getServerTranslator()
  return { title: t('profile.title') }
}

export default async function ProfileSettingsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  // Defense in depth: middleware enforces the same rule for every /settings
  // route (rewriting unauthorized roles to the Access Denied page); this page
  // re-checks so authorization never depends on middleware alone.
  if (!canAccessSettingsSection('/settings/profile', session.user.role)) {
    return <AccessDenied section="profile" />
  }

  const { t } = await getServerTranslator()

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      locale: true,
      hospital: { select: { locale: true, currency: true } },
    },
  })

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
        <p className="text-muted-foreground">
          {t('profile.subtitle')} — {user.name} ({user.email})
        </p>
      </div>

      <LanguagePreferenceCard
        locale={user.locale}
        hospitalLocale={user.hospital?.locale ?? null}
        currency={user.hospital?.currency ?? 'EGP'}
        supportedLocales={locales}
        endpoint="/api/settings/profile"
      />
    </div>
  )
}

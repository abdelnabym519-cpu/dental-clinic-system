import { redirect } from 'next/navigation'

import { LanguagePreferenceCard } from '@/components/i18n/language-preference-card'
import { locales } from '@/lib/i18n/config'
import { getServerTranslator } from '@/lib/i18n/server'
import { getAuthenticatedPatient } from '@/lib/patient-auth'
import { prisma } from '@/lib/prisma'

export async function generateMetadata() {
  const { t } = await getServerTranslator()
  return { title: t('My Preferences') }
}

export default async function PortalProfilePage() {
  const { t } = await getServerTranslator()
  const authenticated = await getAuthenticatedPatient()
  if (!authenticated) {
    redirect('/portal/login')
  }

  const patient = await prisma.patient.findUnique({
    where: { id: authenticated.id },
    select: {
      locale: true,
      hospital: { select: { locale: true, currency: true } },
    },
  })

  if (!patient) {
    redirect('/portal/login')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('My Preferences')}</h1>
        <p className="text-muted-foreground">
          {t('These apply to your portal only. Your clinic does not see them.')}
        </p>
      </div>

      <LanguagePreferenceCard
        locale={patient.locale}
        hospitalLocale={patient.hospital?.locale ?? null}
        currency={patient.hospital?.currency ?? 'EGP'}
        supportedLocales={locales}
        endpoint="/api/patient-portal/profile"
        description={t('Choose how dates and amounts are shown to you in the portal.')}
      />
    </div>
  )
}

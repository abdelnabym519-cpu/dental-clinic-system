import { redirect } from 'next/navigation'

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

      {/* ISSUE 6 — Arabic-only: the language selector was removed. */}
      <div className="rounded-lg border p-4 space-y-1" data-testid="language-arabic-only">
        <p className="text-sm font-medium">{t('لغة النظام')}</p>
        <p className="text-sm text-muted-foreground">
          {t('النظام يعمل باللغة العربية فقط (من اليمين إلى اليسار).')}
        </p>
      </div>
    </div>
  )
}

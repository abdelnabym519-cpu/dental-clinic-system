import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getServerTranslator } from '@/lib/i18n/server'

/**
 * Phase 9 licensing — SUPER_ADMIN overview: subscription health across all
 * hospitals. Server component: the platform level reads the whole catalog
 * directly (the one tenant-agnostic read in the system).
 */
export default async function SuperAdminPage() {
  const { t } = await getServerTranslator()

  const [totalHospitals, byStatus] = await Promise.all([
    prisma.hospital.count(),
    prisma.subscription.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ])

  const countFor = (...statuses: string[]) =>
    byStatus
      .filter((row: { status: string }) => statuses.includes(row.status))
      .reduce((sum: number, r: { _count: { _all: number } }) => sum + r._count._all, 0)

  const cards = [
    { label: t('superAdmin.hospitalsTotal'), value: totalHospitals, tone: 'text-gray-100' },
    { label: t('superAdmin.active'), value: countFor('ACTIVE', 'TRIAL'), tone: 'text-green-400' },
    {
      label: t('superAdmin.gracePeriod'),
      value: countFor('GRACE_PERIOD'),
      tone: 'text-yellow-400',
    },
    { label: t('superAdmin.expired'), value: countFor('EXPIRED'), tone: 'text-red-400' },
    {
      label: t('superAdmin.suspended'),
      value: countFor('SUSPENDED', 'CANCELLED'),
      tone: 'text-orange-400',
    },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('superAdmin.title')}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className={`text-2xl font-bold ${card.tone}`}>{card.value}</div>
            <div className="mt-1 text-sm text-gray-400">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Link
          href="/super-admin/hospitals"
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-500"
        >
          {t('superAdmin.hospitals_link')}
        </Link>
        <Link
          href="/super-admin/audit"
          className="rounded-md border border-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-900"
        >
          {t('superAdmin.audit_link')}
        </Link>
      </div>
    </div>
  )
}

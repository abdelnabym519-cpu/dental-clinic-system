'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/components/providers/language-provider'

interface HospitalRow {
  id: string
  name: string
  createdAt: string
  subscription: {
    id: string
    plan: string
    status: string
    currentPeriodStart: string
    currentPeriodEnd: string
    gracePeriodDays: number
  } | null
  _count: { users: number; patients: number }
}

const STATUS_TONES: Record<string, string> = {
  ACTIVE: 'bg-green-900/40 text-green-300',
  TRIAL: 'bg-blue-900/40 text-blue-300',
  GRACE_PERIOD: 'bg-yellow-900/40 text-yellow-300',
  EXPIRED: 'bg-red-900/40 text-red-300',
  SUSPENDED: 'bg-orange-900/40 text-orange-300',
  CANCELLED: 'bg-gray-700/60 text-gray-300',
  PAST_DUE: 'bg-orange-900/40 text-orange-300',
  TRIALING: 'bg-blue-900/40 text-blue-300',
}

/**
 * Phase 9 licensing — SUPER_ADMIN: every hospital with its subscription
 * status. Data comes from /api/super-admin/hospitals (the only API that
 * lists across tenants).
 */
export default function SuperAdminHospitalsPage() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<HospitalRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/super-admin/hospitals')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(setRows)
      .catch(() => setError(t('superAdmin.error')))
  }, [t])

  if (error) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950 p-4 text-red-300">{error}</div>
    )
  }
  if (!rows) {
    return <div className="text-gray-400">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('superAdmin.hospitals_title')}</h1>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('superAdmin.hospital_name')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('superAdmin.users')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('superAdmin.patients')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('superAdmin.plan')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('superAdmin.status')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('superAdmin.period_end')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((h) => (
              <tr key={h.id} className="hover:bg-gray-900/50">
                <td className="px-4 py-3 font-medium">{h.name}</td>
                <td className="px-4 py-3 text-gray-400">{h._count.users}</td>
                <td className="px-4 py-3 text-gray-400">{h._count.patients}</td>
                <td className="px-4 py-3">
                  {h.subscription ? (
                    <span className="text-gray-300">
                      {t(`subscription.plan.${h.subscription.plan}`)}
                    </span>
                  ) : (
                    <span className="text-gray-500">{t('superAdmin.no_subscription')}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {h.subscription ? (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        STATUS_TONES[h.subscription.status] ?? 'bg-gray-800 text-gray-300'
                      }`}
                    >
                      {t(`subscription.status.${h.subscription.status}`)}
                    </span>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {h.subscription
                    ? new Date(h.subscription.currentPeriodEnd).toLocaleDateString()
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/super-admin/hospitals/${h.id}`}
                    className="rounded-md bg-red-600/90 px-3 py-1.5 text-xs font-medium hover:bg-red-500"
                  >
                    {t('superAdmin.manage')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

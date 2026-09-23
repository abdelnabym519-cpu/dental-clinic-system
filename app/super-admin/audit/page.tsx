'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/providers/language-provider'

interface AuditRow {
  id: string
  action: string
  previousStatus: string | null
  newStatus: string
  performedBy: string | null
  notes: string | null
  createdAt: string
}

/**
 * Phase 9 licensing — SUPER_ADMIN: the append-only license audit trail
 * (every status change, who did it, when). Read from /api/super-admin/audit-logs.
 */
export default function SuperAdminAuditPage() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/super-admin/audit-logs?take=200')
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
      <h1 className="text-xl font-semibold">{t('superAdmin.audit_title')}</h1>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">{t('common.noData')}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t('superAdmin.date')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('superAdmin.action')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('superAdmin.previous')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('superAdmin.new')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('superAdmin.by')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('superAdmin.notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-900/50">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium">{row.action}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {row.previousStatus ? t(`subscription.status.${row.previousStatus}`) : '—'}
                  </td>
                  <td className="px-4 py-3">{t(`subscription.status.${row.newStatus}`)}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {row.performedBy ?? t('superAdmin.system')}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-gray-400">{row.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

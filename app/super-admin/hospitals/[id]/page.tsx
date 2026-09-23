'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLanguage } from '@/components/providers/language-provider'

const PLANS = ['FREE', 'PROFESSIONAL', 'ENTERPRISE', 'SELF_HOSTED']
const STATUSES = ['TRIAL', 'ACTIVE', 'GRACE_PERIOD', 'EXPIRED', 'SUSPENDED', 'CANCELLED']

/**
 * Phase 9 licensing — SUPER_ADMIN: manage one hospital's subscription
 * (create it when missing, otherwise update plan/status/period/grace/notes
 * via PATCH). Every save is audit-logged server-side with the acting user.
 */
export default function SuperAdminHospitalPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useLanguage()

  const [hospital, setHospital] = useState<{ name: string } | null>(null)
  const [existing, setExisting] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    plan: 'PROFESSIONAL',
    status: 'ACTIVE',
    currentPeriodStart: '',
    currentPeriodEnd: '',
    gracePeriodDays: 3,
    autoRenew: false,
    notes: '',
  })

  const set = (key: keyof typeof form, value: string | number | boolean) =>
    setForm((f) => ({ ...f, [key]: value }))

  const load = useCallback(() => {
    fetch('/api/super-admin/hospitals')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((rows: Array<Record<string, unknown>>) => {
        const row = rows.find((r) => r.id === id)
        if (!row) {
          setError(t('superAdmin.error'))
          return
        }
        setHospital({ name: String(row.name) })
        const sub = row.subscription as Record<string, unknown> | null
        setExisting(sub)
        if (sub) {
          setForm({
            plan: String(sub.plan),
            status: String(sub.status),
            currentPeriodStart: String(sub.currentPeriodStart).slice(0, 10),
            currentPeriodEnd: String(sub.currentPeriodEnd).slice(0, 10),
            gracePeriodDays: Number(sub.gracePeriodDays) || 3,
            autoRenew: Boolean(sub.autoRenew),
            notes: sub.notes ? String(sub.notes) : '',
          })
        }
      })
      .catch(() => setError(t('superAdmin.error')))
      .finally(() => setLoading(false))
  }, [id, t])

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const isCreate = !existing
      const payload: Record<string, unknown> = {
        plan: form.plan,
        status: form.status,
        currentPeriodStart: form.currentPeriodStart
          ? new Date(`${form.currentPeriodStart}T00:00:00Z`).toISOString()
          : undefined,
        currentPeriodEnd: new Date(`${form.currentPeriodEnd}T23:59:59Z`).toISOString(),
        gracePeriodDays: form.gracePeriodDays,
        autoRenew: form.autoRenew,
        notes: form.notes || undefined,
      }
      const res = await fetch(`/api/super-admin/hospitals/${id}/subscription`, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to save')
      }
      setMessage(isCreate ? t('superAdmin.created') : t('superAdmin.updated'))
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('superAdmin.error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-gray-400">{t('common.loading')}</div>
  }
  if (!hospital) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950 p-4 text-red-300">{error}</div>
    )
  }

  const inputCls =
    'w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-red-500 focus:outline-none'

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{hospital.name}</h1>
        <p className="text-sm text-gray-400">
          {existing ? t('superAdmin.manage') : t('superAdmin.create_subscription')}
        </p>
      </div>

      {(message || error) && (
        <div
          role="alert"
          className={`rounded-md border p-3 text-sm ${
            error
              ? 'border-red-900 bg-red-950 text-red-300'
              : 'border-green-900 bg-green-950 text-green-300'
          }`}
        >
          {error || message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm text-gray-400" htmlFor="sa-plan">
            {t('superAdmin.plan')}
          </label>
          <select
            id="sa-plan"
            className={inputCls}
            value={form.plan}
            onChange={(e) => set('plan', e.target.value)}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {t(`subscription.plan.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-400" htmlFor="sa-status">
            {t('superAdmin.status')}
          </label>
          <select
            id="sa-status"
            className={inputCls}
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`subscription.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-400" htmlFor="sa-start">
            {t('superAdmin.period_start')}
          </label>
          <input
            id="sa-start"
            type="date"
            className={inputCls}
            value={form.currentPeriodStart}
            onChange={(e) => set('currentPeriodStart', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-400" htmlFor="sa-end">
            {t('superAdmin.period_end')}
          </label>
          <input
            id="sa-end"
            type="date"
            className={inputCls}
            value={form.currentPeriodEnd}
            onChange={(e) => set('currentPeriodEnd', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-400" htmlFor="sa-grace">
            {t('superAdmin.grace_days')}
          </label>
          <input
            id="sa-grace"
            type="number"
            min={0}
            max={30}
            className={inputCls}
            value={form.gracePeriodDays}
            onChange={(e) => set('gracePeriodDays', parseInt(e.target.value, 10) || 0)}
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-gray-300" htmlFor="sa-autorenew">
            <input
              id="sa-autorenew"
              type="checkbox"
              className="h-4 w-4"
              checked={form.autoRenew}
              onChange={(e) => set('autoRenew', e.target.checked)}
            />
            {t('superAdmin.auto_renew')}
          </label>
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-sm text-gray-400" htmlFor="sa-notes">
            {t('superAdmin.notes')}
          </label>
          <textarea
            id="sa-notes"
            rows={2}
            className={inputCls}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={saving || !form.currentPeriodEnd}
          className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium hover:bg-red-500 disabled:opacity-50"
        >
          {existing ? t('superAdmin.save') : t('superAdmin.create_subscription')}
        </button>
      </div>
    </div>
  )
}

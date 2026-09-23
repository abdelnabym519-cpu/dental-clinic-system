'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/components/providers/language-provider'

/**
 * Phase 9 licensing — in-app expiry warning for the clinic admin.
 *
 * Visible only to the ADMIN role, only when 7 or fewer days remain (or the
 * tenant is in the grace period after expiry). Fetches /api/licensing/status
 * once per mount; a fetch failure is silent by design — the banner must
 * never block the UI or turn a network blip into a locked-out admin.
 */
interface SubscriptionStatusPayload {
  allowed: boolean
  daysRemaining: number | null
  status: string
}

export function SubscriptionWarningBanner() {
  const { data: session } = useSession()
  const { t } = useLanguage()
  const [status, setStatus] = useState<SubscriptionStatusPayload | null>(null)

  useEffect(() => {
    // Only the clinic admin is responsible for renewals.
    if (session?.user?.role !== 'ADMIN') return

    fetch('/api/licensing/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || typeof data !== 'object' || !('daysRemaining' in data)) return
        const payload = data as SubscriptionStatusPayload
        const inGrace = payload.status === 'GRACE_PERIOD'
        const soon =
          payload.daysRemaining !== null &&
          payload.daysRemaining !== undefined &&
          payload.daysRemaining <= 7
        if (inGrace || soon) setStatus(payload)
      })
      .catch(() => {
        /* silent — never block the UI */
      })
  }, [session])

  if (!status) return null

  const isGrace = status.status === 'GRACE_PERIOD'
  const isUrgent = !isGrace && status.daysRemaining !== null && status.daysRemaining <= 1

  return (
    <div
      role="alert"
      className={`mb-4 w-full rounded-md px-4 py-3 text-center text-sm font-medium ${
        isGrace
          ? 'bg-red-600 text-white'
          : isUrgent
            ? 'bg-orange-500 text-white'
            : 'bg-yellow-400 text-yellow-900'
      }`}
    >
      {isGrace
        ? t('subscription.grace_warning', { days: Math.abs(status.daysRemaining ?? 0) })
        : t('subscription.expiry_warning', { days: status.daysRemaining ?? 0 })}{' '}
      <a href="mailto:support@dentora.com" className="font-bold underline">
        {t('subscription.contact_support')}
      </a>
    </div>
  )
}

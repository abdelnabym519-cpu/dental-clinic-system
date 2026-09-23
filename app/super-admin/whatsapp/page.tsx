'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useLanguage } from '@/components/providers/language-provider'

interface QrStatus {
  provider: 'meta' | 'baileys'
  qr: string | null
  connected: boolean | null
}

/**
 * Phase 10 — SUPER_ADMIN: Baileys WhatsApp pairing.
 *
 * Polls /api/super-admin/whatsapp/qr every 10s and renders the QR from Redis
 * (TTL 120s, so the image on screen is always the current one). Once the
 * phone scans it, the session persists in Redis — server restarts do NOT
 * require re-scanning.
 */
export default function SuperAdminWhatsAppPage() {
  const { t } = useLanguage()
  const [status, setStatus] = useState<QrStatus | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/whatsapp/qr', { cache: 'no-store' })
      if (!res.ok) {
        setError(t('superAdmin.error'))
        return
      }
      const data = (await res.json()) as QrStatus
      setError('')
      setStatus(data)
      setUpdatedAt(new Date())
      if (data.qr) {
        setQrDataUrl(await QRCode.toDataURL(data.qr, { width: 280, margin: 1 }))
      } else {
        setQrDataUrl(null)
      }
    } catch {
      setError(t('superAdmin.error'))
    }
  }, [t])

  useEffect(() => {
    void poll()
    timerRef.current = setInterval(() => void poll(), 10_000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [poll])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('superAdmin.whatsapp.title')}</h1>
        <p className="mt-1 text-sm text-gray-400">{t('superAdmin.whatsapp.subtitle')}</p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-900 bg-red-950 p-4 text-red-300">{error}</div>
      ) : !status ? (
        <div className="text-gray-400">{t('common.loading')}</div>
      ) : status.provider === 'meta' || status.connected === null ? (
        // Meta (or another non-Baileys) provider is active — nothing to pair.
        <div className="max-w-xl rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-300">
          <div className="mb-2 text-base font-semibold text-white">
            {t('superAdmin.whatsapp.metaActiveTitle')}
          </div>
          <p className="leading-relaxed">{t('superAdmin.whatsapp.metaActive')}</p>
        </div>
      ) : status.connected ? (
        // Session established — green state, no QR.
        <div className="max-w-xl rounded-lg border border-emerald-900 bg-emerald-950/60 p-6">
          <div className="mb-1 text-lg font-semibold text-emerald-300">
            ✓ {t('superAdmin.whatsapp.connected')}
          </div>
          <p className="text-sm text-emerald-200/80">{t('superAdmin.whatsapp.connectedHint')}</p>
        </div>
      ) : status.qr && qrDataUrl ? (
        // QR waiting to be scanned.
        <div className="max-w-xl rounded-lg border border-gray-800 bg-gray-900 p-6 text-center">
          <img
            src={qrDataUrl}
            alt={t('superAdmin.whatsapp.qrAlt')}
            className="mx-auto h-70 w-70 rounded bg-white p-2"
          />
          <p className="mt-4 text-sm font-medium text-white">
            {t('superAdmin.whatsapp.scanTitle')}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-gray-400">
            {t('superAdmin.whatsapp.scanHint')}
          </p>
          <button
            onClick={() => void poll()}
            className="mt-4 rounded-md border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700"
          >
            {t('superAdmin.whatsapp.refresh')}
          </button>
        </div>
      ) : (
        // QR not (yet) in Redis — session creating or Redis unreachable.
        <div className="max-w-xl rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-300">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />{' '}
          {t('superAdmin.whatsapp.connecting')}
        </div>
      )}

      {updatedAt && (
        <p className="text-xs text-gray-600" dir="ltr">
          {t('superAdmin.whatsapp.autoRefresh')} · {updatedAt.toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}

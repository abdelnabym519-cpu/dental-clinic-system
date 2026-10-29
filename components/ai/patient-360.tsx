'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect, useCallback } from 'react'

interface Summary {
  summary: string
  highlights?: string[]
  flags?: string[]
  lastVisit?: string
  nextAction?: string
}

/**
 * Patient360 — AI-generated 360° patient summary card.
 * Loads cached summary from DB on first render. Calls AI only when
 * no cache exists or user clicks Regenerate.
 */
export function Patient360({ patientId }: { patientId: string }) {
  const { t } = useLanguage()
  const [data, setData] = useState<Summary | null>(null)
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(false)
      setNotConfigured(false)
      try {
        const res = await fetch('/api/ai/clinical', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'patient_summary', patientId, refresh }),
        })
        const json = await res.json()
        if (json.success && json.data) {
          setData(json.data)
          setCached(!!json.cached)
        } else if (res.status === 503 || json.error === 'AI_NOT_CONFIGURED') {
          // The provider is simply not enabled for this deployment - a neutral
          // state, not a fault. Never surface the raw code to the user.
          setNotConfigured(true)
        } else {
          setError(true)
        }
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    },
    [patientId]
  )

  useEffect(() => {
    load(false)
  }, [load])

  /* ---- loading skeleton ---- */
  if (loading) {
    return (
      <div className="rounded-lg border p-4 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-semibold">{t('ui.ai_patient_summary')}</span>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full bg-muted rounded animate-pulse" />
          <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
        </div>
      </div>
    )
  }

  // Graceful degradation: provider not enabled -> neutral localized state,
  // no red error and no raw error code. Distinct from a genuine failure.
  if (notConfigured) {
    return (
      <div
        dir="rtl"
        data-testid="patient-360-not-configured"
        className="rounded-lg border p-4 bg-muted/30"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-semibold">{t('ui.ai_patient_summary')}</span>
        </div>
        <p className="text-sm font-medium text-muted-foreground">{t('ai.not_configured')}</p>
        <p className="text-xs text-muted-foreground mt-1">{t('ai.not_configured_body')}</p>
      </div>
    )
  }

  if (error || !data) return null

  return (
    <div className="rounded-lg border p-4 bg-gradient-to-r from-primary/5 to-transparent">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="text-sm font-semibold">{t('ui.ai_patient_summary')}</h3>
          {cached && (
            <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {t('cached')}
            </span>
          )}
        </div>
        <button
          onClick={() => load(true)}
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {t('↻ Regenerate')}
        </button>
      </div>

      {/* narrative */}
      <p className="text-sm leading-relaxed">{data.summary}</p>

      {/* highlights (chips) */}
      {data.highlights && data.highlights.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.highlights.map((h, i) => (
            <span key={i} className="text-xs bg-muted rounded-full px-2.5 py-1">
              {h}
            </span>
          ))}
        </div>
      )}

      {/* flags (warnings) */}
      {data.flags && data.flags.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.flags.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded px-2.5 py-1.5"
            >
              <span className="flex-shrink-0">⚠</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}

      {/* footer row */}
      <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
        {data.lastVisit && (
          <span>
            {t('Last visit:')} {data.lastVisit}
          </span>
        )}
        {data.nextAction && <span className="text-primary font-medium">→ {data.nextAction}</span>}
      </div>
    </div>
  )
}

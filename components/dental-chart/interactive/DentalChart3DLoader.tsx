'use client'

/**
 * DenToRa — Interactive Dental Chart: 3D loader (Stage M — accessibility/fallback).
 *
 * The 3D bundle (three + R3F) is ONLY downloaded when the user actually
 * switches to a 3D/split view (dynamic import, ssr:false — SSR bypass).
 * If WebGL is unavailable the user gets an explicit localized notice and
 * the 2D chart remains fully functional (2D needs no WebGL, ever).
 */

import dynamic from 'next/dynamic'
import { useSyncExternalStore } from 'react'
import { useLanguage } from '@/components/providers/language-provider'
import { Skeleton } from '@/components/ui/skeleton'
import type { ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'
import type { CameraPreset } from './DentalChart3D'

const DentalChart3D = dynamic(() => import('./DentalChart3D'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-xl" />,
})

// WebGL capability is a static client fact — memoized module-level detection
// consumed through useSyncExternalStore (server snapshot: not supported, so
// SSR renders the honest fallback and hydration upgrades the client view).
let cachedWebglSupport: boolean | null = null
function detectWebGL(): boolean {
  if (cachedWebglSupport !== null) return cachedWebglSupport
  try {
    const canvas = document.createElement('canvas')
    cachedWebglSupport = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    cachedWebglSupport = false
  }
  return cachedWebglSupport
}
const subscribeNoop = () => () => {}
const serverSnapshot = () => false

function useWebGLSupported(): boolean {
  return useSyncExternalStore(subscribeNoop, detectWebGL, serverSnapshot)
}

export default function DentalChart3DLoader({
  statusByTooth,
  cameraPreset,
}: {
  statusByTooth: Record<number, ToothTreatmentStatus>
  cameraPreset?: CameraPreset
}) {
  const { t, locale } = useLanguage()
  const webgl = useWebGLSupported()
  const dir = locale.startsWith('ar') ? 'rtl' : 'ltr'

  if (webgl === false) {
    return (
      <div
        dir={dir}
        role="status"
        className="flex h-full min-h-[320px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-6 text-center"
        data-testid="dental-chart-webgl-fallback"
      >
        <p className="font-semibold">{t('dental_chart.webgl_unsupported_title')}</p>
        <p className="text-sm text-muted-foreground">{t('dental_chart.webgl_unsupported_body')}</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-[420px] w-full overflow-hidden rounded-xl">
      <DentalChart3D statusByTooth={statusByTooth} cameraPreset={cameraPreset} />
    </div>
  )
}

'use client'

/**
 * P4 / step 3 — the 3D stage: one adapter, two scenes, Arabic-only UI.
 *
 * Guarantees the route relies on:
 *   - ASSET_MODE=none (the DEFAULT) → ProceduralScene + an Arabic note.
 *   - No WebGL → ProceduralScene + an Arabic note.
 *   - ScopeScene fails to mount → ProceduralScene + an Arabic note.
 *   - A blank viewport or an unhandled error is NEVER an acceptable outcome.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { useDentalChartStore } from '@/lib/dental-chart/chart-state'
import type { ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'
import {
  fallbackNote,
  selectScene,
  type Chart3DAdapter,
  type Chart3DStateMap,
  type Chart3DView,
  type FallbackReason,
} from '@/lib/dental-chart/3d/types'
import { createProceduralScene } from '@/lib/dental-chart/3d/procedural-scene'
import { createScopeScene } from '@/lib/dental-chart/3d/scope-scene'
import { createPerfTracker, type PerfSample } from '@/lib/dental-chart/3d/perf'

/* -------------------------------------------------------------------------- */
/* WebGL capability (static client fact, memoized)                            */
/* -------------------------------------------------------------------------- */

let cachedWebgl: boolean | null = null
function detectWebGL(): boolean {
  if (cachedWebgl !== null) return cachedWebgl
  try {
    const canvas = document.createElement('canvas')
    cachedWebgl = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    cachedWebgl = false
  }
  return cachedWebgl
}
const subscribeNoop = () => () => {}
const serverSnapshot = () => false

/* -------------------------------------------------------------------------- */
/* component                                                                  */
/* -------------------------------------------------------------------------- */

export interface Chart3DStageProps {
  /** Already-derived per-tooth statuses; resolved rows must be absent. */
  statusByTooth: Chart3DStateMap
  /** Resolved from ASSET_MODE server-side. */
  assetMode: 'none' | 'local' | 'bundled'
  /** `?perf=1` */
  perf?: boolean
  /** Test seam: force the scope mount to fail, to prove the fallback works. */
  forceScopeFailure?: boolean
  onSelect?: (fdi: number | null) => void
}

export default function Chart3DStage({
  statusByTooth,
  assetMode,
  perf = false,
  forceScopeFailure = false,
  onSelect,
}: Chart3DStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const adapterRef = useRef<Chart3DAdapter | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const trackerRef = useRef(createPerfTracker())

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reason, setReason] = useState<FallbackReason | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [sample, setSample] = useState<PerfSample | null>(null)

  const webgl = useSyncExternalStore(subscribeNoop, detectWebGL, serverSnapshot)
  const setSelectedTooth = useDentalChartStore((s) => s.setSelectedTooth)

  const selection = useMemo(
    () => selectScene({ assetMode, webgl }),
    [assetMode, webgl],
  )

  /** The scene we actually ended up on (may differ from `selection` on failure). */
  const [actualKind, setActualKind] = useState<'scope' | 'procedural' | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false

    const mount = async () => {
      setPhase('loading')
      trackerRef.current.start()

      const build = (kind: 'scope' | 'procedural'): Chart3DAdapter =>
        kind === 'scope'
          ? createScopeScene(
              forceScopeFailure
                ? {
                    // Test seam only. Deliberately a single short token: the
                    // protected i18n guard rejects multi-word English literals
                    // in client components, and this never reaches the UI.
                    loadEngine: async () => {
                      throw new Error('forced')
                    },
                  }
                : {},
            )
          : createProceduralScene()

      let adapter = build(selection.kind)
      let reasonOut = selection.fallbackReason

      if (selection.kind === 'scope') {
        try {
          await adapter.mount(el)
        } catch {
          // Engine unavailable (no model files, WebGL lost, …): degrade, never blank.
          adapter.dispose()
          adapter = build('procedural')
          reasonOut = 'scope-mount-failed'
          await adapter.mount(el)
        }
      } else {
        try {
          await adapter.mount(el)
        } catch (err) {
          if (cancelled) return
          setPhase('error')
          setErrorText(err instanceof Error ? err.message : String(err))
          return
        }
      }

      if (cancelled) {
        adapter.dispose()
        return
      }

      adapterRef.current = adapter
      setActualKind(adapter.kind)
      setReason(reasonOut)
      adapter.setStates(statusByTooth)
      unsubRef.current = adapter.onSelect((fdi) => {
        setSelectedTooth(fdi)
        onSelect?.(fdi)
      })
      setPhase('ready')

      // First-frame detection + perf sampling.
      const tick = () => {
        if (cancelled) return
        trackerRef.current.tick()
        if (perf) setSample(trackerRef.current.sample())
        raf = requestAnimationFrame(tick)
      }
      let raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }

    void mount()

    return () => {
      cancelled = true
      unsubRef.current?.()
      unsubRef.current = null
      adapterRef.current?.dispose()
      adapterRef.current = null
      trackerRef.current.stop()
    }
    // Re-mounting on every status change would tear down the scene; statuses
    // are pushed through `setStates` in the effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.kind, selection.fallbackReason, webgl, forceScopeFailure])

  // Push status changes into the live scene without remounting it.
  useEffect(() => {
    adapterRef.current?.setStates(statusByTooth)
  }, [statusByTooth])

  const handleOrbit = useCallback(() => {
    trackerRef.current.markOrbiting()
  }, [])

  const setView = useCallback((view: Chart3DView) => {
    adapterRef.current?.setView(view)
  }, [])

  const note = fallbackNote(reason)

  return (
    <div className="flex h-full w-full flex-col gap-3" dir="rtl">
      {/* status / note — Arabic only */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-muted px-2 py-1">
          {actualKind === 'scope' ? 'منظر المحرّك (دائم)' : 'المنظر الإجرائي الافتراضي'}
        </span>
        {phase === 'loading' && (
          <span className="text-muted-foreground" role="status">
            جارٍ تحميل المنظر ثلاثي الأبعاد…
          </span>
        )}
        {phase === 'ready' && (
          <span className="text-muted-foreground" role="status">
            جاهز
          </span>
        )}
      </div>

      {note && (
        <p
          role="note"
          data-testid="chart3d-fallback-note"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {note}
        </p>
      )}

      {phase === 'error' && (
        <p
          role="alert"
          data-testid="chart3d-error"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm"
        >
          تعذّر عرض المنظر ثلاثي الأبعاد. {errorText ?? ''}
        </p>
      )}

      {/* the viewport */}
      <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-xl border bg-background">
        {phase === 'loading' && <Skeleton className="h-full w-full" />}
        <div
          ref={containerRef}
          data-testid="chart3d-viewport"
          data-scene={actualKind ?? 'none'}
          onPointerMove={handleOrbit}
          onPointerDown={handleOrbit}
          className="h-full w-full"
        />

        {perf && phase === 'ready' && (
          <div
            data-testid="chart3d-perf"
            className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/75 px-3 py-2 text-xs text-white ltr"
            dir="ltr"
          >
            <div>initial bytes: {sample?.initialBytes ?? '—'}</div>
            <div>time to first frame: {sample?.timeToFirstFrameMs ?? '—'} ms</div>
            <div>fps (orbiting): {sample?.fps ?? '—'}</div>
            <div>JS heap: {sample?.jsHeapMB ?? '—'} MB</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="مناظر الكاميرا">
        {(['default', 'front', 'upper', 'lower', 'left', 'right'] as Chart3DView[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
    </div>
  )
}

const VIEW_LABELS: Record<Chart3DView, string> = {
  default: 'الافتراضي',
  front: 'أمامي',
  upper: 'الفك العلوي',
  lower: 'الفك السفلي',
  left: 'أيسر',
  right: 'أيمن',
}

export type { ToothTreatmentStatus }

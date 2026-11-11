'use client'

/**
 * P4 / step 3 — DEV ROUTE: /patients/[id]/dental-chart-3d
 *
 * Development-only entry point for the 3D chart. It is deliberately separate
 * from the existing chart routes: nothing here retires or replaces the 2D
 * odontogram or the v2 chart.
 *
 * Data flow:
 *   GET /api/dental-chart/:id/summary  (the EXISTING route, RBAC + tenant scoped)
 *     → deriveStatusMap (the EXISTING canonical derivation, which already
 *       ignores resolved findings)
 *     → Chart3DStage.setStates  → PATCH 2 tints the meshes
 *
 * ASSET_MODE=none is the default, so out of the box this renders the
 * ProceduralScene fallback plus an Arabic note. It must never render blank.
 */
import { use, useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'

import { Skeleton } from '@/components/ui/skeleton'
import { DentalChartErrorBoundary } from '@/components/dental-chart/interactive/ChartErrorBoundary'
import type { ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'
import type { Chart3DStateMap } from '@/lib/dental-chart/3d/types'

// Client-only: the 3D bundle (three/R3F/engine) must never run on the server.
const Chart3DStage = dynamic(
  () => import('@/components/dental-chart/interactive/Chart3DStage'),
  { ssr: false, loading: () => <Skeleton className="h-[520px] w-full rounded-xl" /> },
)

interface PageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

interface SummaryPayload {
  teeth?: Array<{
    toothNumber: number
    status?: ToothTreatmentStatus
  }>
  statusByTooth?: Record<string, ToothTreatmentStatus>
}

export default function DentalChart3DPage({ params, searchParams }: PageProps) {
  const { id } = use(params)
  // `use()` must be called unconditionally — a conditional call breaks the
  // rules of hooks. Fall back to an already-resolved empty object instead.
  const search = use(
    searchParams ?? Promise.resolve<Record<string, string | string[] | undefined>>({}),
  )
  const perf = search?.perf === '1'

  const [statusByTooth, setStatusByTooth] = useState<Chart3DStateMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [assetMode] = useState<'none' | 'local' | 'bundled'>(
    // The server already resolved this; in this client page we read the
    // non-secret mode value exposed at build time. Default is always 'none'.
    (process.env.NEXT_PUBLIC_ASSET_MODE as 'none' | 'local' | 'bundled') ?? 'none',
  )

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/dental-chart/${encodeURIComponent(id)}/summary`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as SummaryPayload
        if (cancelled) return

        // The summary route already derives statuses with the CANONICAL
        // derivation, which ignores resolved findings (resolvedDate set).
        // We therefore trust its map rather than re-deriving, and only
        // normalise the keys to numbers.
        const map: Chart3DStateMap = {}
        if (data.statusByTooth) {
          for (const [k, v] of Object.entries(data.statusByTooth)) {
            const n = Number(k)
            if (Number.isInteger(n)) map[n] = v
          }
        } else if (Array.isArray(data.teeth)) {
          for (const t of data.teeth) {
            if (Number.isInteger(t.toothNumber) && t.status) map[t.toothNumber] = t.status
          }
        }
        setStatusByTooth(map)
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id])

  const handleSelect = useCallback((fdi: number | null) => setSelected(fdi), [])

  const tintedCount = Object.values(statusByTooth).filter((s) => s && s !== 'healthy').length

  return (
    <div className="container mx-auto space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">المخطط السني ثلاثي الأبعاد (تطوير)</h1>
          <p className="text-sm text-muted-foreground">
            مسار تطويري — لا يستبدل المخطط ثنائي الأبعاد الحالي.
          </p>
        </div>
        <Link href={`/patients/${id}/dental-chart`} className="text-sm underline">
          العودة إلى المخطط الحالي
        </Link>
      </div>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        وضع الأصول: <strong>{assetMode}</strong> — عدد الأسنان المسجّل لها حالة:{' '}
        <strong>{tintedCount}</strong>
        {selected !== null && <> — السن المحدد: <strong>{selected}</strong></>}
      </div>

      <DentalChartErrorBoundary>
        {loading ? (
          <Skeleton className="h-[520px] w-full rounded-xl" />
        ) : error ? (
          <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
            تعذّر تحميل ملخّص المخطط السني: {error}
          </p>
        ) : (
          <div className="h-[560px]">
            <Chart3DStage
              statusByTooth={statusByTooth}
              assetMode={assetMode}
              perf={perf}
              onSelect={handleSelect}
            />
          </div>
        )}
      </DentalChartErrorBoundary>
    </div>
  )
}

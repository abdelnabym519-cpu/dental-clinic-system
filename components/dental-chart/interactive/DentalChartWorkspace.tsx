'use client'

/**
 * DenToRa — Interactive Dental Chart: workspace composition (Stages D/H/G/L/M).
 *
 * Single owner of the summary payload (Stage I/J integration): fetches the
 * aggregate API once, derives per-tooth statuses through the canonical
 * pure module, feeds 2D/3D/panel from the shared store, and performs ALL
 * mutations (existing Phase-3/Phase-11 APIs) with a single refetch point
 * so state is always reconstructed from the DB (sync rule 4).
 *
 * RBAC (mirrored client-side; enforced server-side): DOCTOR/ADMIN (+SUPER_ADMIN)
 * may mutate; RECEPTIONIST and other staff roles get read-only view.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Box, Grid3X3, Eye, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useLanguage } from '@/components/providers/language-provider'
import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'
import { useDentalChartStore } from '@/lib/dental-chart/chart-state'
import {
  TOOTH_COLORS,
  deriveStatusMap,
  type ToothTreatmentStatus,
} from '@/lib/dental-chart/clinical-status'
import { conditionLabel } from '@/lib/dental-chart/labels'
import DentalChart2D from './DentalChart2D'
import DentalChart3DLoader from './DentalChart3DLoader'
import {
  ToothContextPanel,
  type CatalogProcedure,
  type PanelImagingFinding,
  type PanelProcedure,
  type ToothContextPanelProps,
} from './ToothContextPanel'
import type { CameraPreset } from './DentalChart3D'

interface SummaryPayload {
  patient: { id: string; name: string }
  entries: DentalChartEntryRecord[]
  procedures: (Omit<PanelProcedure, 'procedureName'> & { procedureName?: string; procedure?: { name?: string }; toothNumbers: string | null })[]
  activePlan: { id: string; status: string } | null
  imaging: PanelImagingFinding[]
  statusByTooth: Record<number, ToothTreatmentStatus>
  catalog: CatalogProcedure[]
}

const MUTATOR_ROLES = new Set(['DOCTOR', 'ADMIN', 'SUPER_ADMIN'])
const VIEWER_ROLES = new Set(['DOCTOR', 'ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST'])

export function DentalChartWorkspace({ patientId }: { patientId: string }) {
  const { t, locale } = useLanguage()
  const { toast } = useToast()
  const { data: session } = useSession()

  const [summary, setSummary] = useState<SummaryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('default')

  const viewMode = useDentalChartStore((s) => s.viewMode)
  const setViewMode = useDentalChartStore((s) => s.setViewMode)
  const selectedToothNumber = useDentalChartStore((s) => s.selectedToothNumber)
  const setSelectedTooth = useDentalChartStore((s) => s.setSelectedTooth)
  const hoveredTooth = useDentalChartStore((s) => s.hoveredTooth)

  const role = session?.user?.role as string | undefined
  const canModify = Boolean(role && MUTATOR_ROLES.has(role))
  const canView = Boolean(role && VIEWER_ROLES.has(role))

  // ─── data: one summary fetch, single refetch point ────────────────────────
  const refetch = useCallback(async () => {
    try {
      // NOTE: no synchronous setState before the first await — the effect
      // that kicks off the initial fetch must not cascade renders.
      const res = await fetch(`/api/dental-chart/${patientId}/summary`, { cache: 'no-store' })
      if (!res.ok) throw new Error(res.status === 403 ? 'forbidden' : 'failed')
      setSummary((await res.json()) as SummaryPayload)
      setError(null)
    } catch {
      setError(t('dental_chart.error'))
    } finally {
      setLoading(false)
    }
  }, [patientId, t])

  useEffect(() => {
    // Phase-8 isolation: a patient switch must clear ALL interaction state
    // (selection, hover, view) so Patient B's chart never opens with
    // Patient A's selected tooth or hover chip. reset() is the store's
    // pristine state; the summary refetch below rebuilds clinical state
    // from the DB for the NEW patient (sync rule 4).
    useDentalChartStore.getState().reset()
    // Deferred one tick: keeps the initial fetch (whose completion sets
    // state) out of the effect's synchronous call graph — no cascading
    // renders during the commit phase.
    const id = setTimeout(refetch, 0)
    return () => clearTimeout(id)
  }, [refetch, patientId])

  // Sync rule 3: clinical status is DERIVED once (canonical pure module) and
  // fed to every consumer (2D legend colors, 3D materials, panel badge) — a
  // mutation refetch re-derives, so both views always agree. The store holds
  // interaction state only; derived data is never mirrored into it.
  const statusByTooth = useMemo(() => {
    if (!summary) return {} as Record<number, ToothTreatmentStatus>
    const entriesByTooth = groupByTooth(summary.entries, (e) => e.toothNumber)
    const procsByTooth = new Map<number, { status: string }[]>()
    for (const p of summary.procedures) {
      for (const tooth of parseToothNumbers(p.toothNumbers)) {
        const list = procsByTooth.get(tooth) ?? []
        list.push({ status: p.status })
        procsByTooth.set(tooth, list)
      }
    }
    return deriveStatusMap(entriesByTooth, procsByTooth)
  }, [summary])

  const proceduresForTooth = useMemo(() => {
    if (!summary || !selectedToothNumber) return [] as PanelProcedure[]
    return summary.procedures
      .filter((p) => parseToothNumbers(p.toothNumbers).includes(selectedToothNumber))
      .map((p) => ({
        id: p.id,
        procedureName: p.procedureName ?? p.procedure?.name ?? '—',
        status: p.status,
        estimatedCost: p.estimatedCost,
        planId: p.planId,
      }))
  }, [summary, selectedToothNumber])

  const entriesForTooth = useMemo(() => {
    if (!summary || !selectedToothNumber) return []
    return summary.entries.filter((e) => e.toothNumber === selectedToothNumber)
  }, [summary, selectedToothNumber])

  const imagingForTooth = useMemo(() => {
    if (!summary || !selectedToothNumber) return [] as PanelImagingFinding[]
    return summary.imaging.filter((im) => im.toothNumber === selectedToothNumber)
  }, [summary, selectedToothNumber])

  // ─── mutations (single refetch point; audit + RBAC server-side) ───────────
  const addFinding: ToothContextPanelProps['onAddFinding'] = async (payload) => {
    const res = await fetch('/api/dental-chart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId,
        toothNumber: selectedToothNumber,
        condition: payload.condition,
        severity: payload.severity,
        ...payload.surfaces,
        notes: payload.notes,
      }),
    })
    if (!res.ok) {
      toast({ title: t('dental_chart.save_failed'), variant: 'destructive' })
      return
    }
    toast({ title: t('dental_chart.saved') })
    await refetch()
  }

  const addProcedure = async (procedureId: string) => {
    if (!summary?.activePlan) return
    const proc = summary.catalog.find((c) => c.id === procedureId)
    const res = await fetch(`/api/treatment-plans/${summary.activePlan.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        procedureId,
        toothNumbers: String(selectedToothNumber),
        estimatedCost: proc?.basePrice ?? '0',
      }),
    })
    if (!res.ok) {
      toast({ title: t('dental_chart.save_failed'), variant: 'destructive' })
      return
    }
    toast({ title: t('dental_chart.saved') })
    await refetch()
  }

  const hoveredLabel =
    hoveredTooth != null
      ? `${t('dental_chart.tooth')} ${hoveredTooth} — ${
          summary?.entries.some((e) => e.toothNumber === hoveredTooth)
            ? conditionLabel(summary.entries.find((e) => e.toothNumber === hoveredTooth)!.condition, locale)
            : t('dental_chart.status.healthy')
        }`
      : null

  if (loading) {
    return (
      <div className="space-y-3" data-testid="dental-chart-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center text-sm" data-testid="dental-chart-error">
        {error}
      </div>
    )
  }

  const statusOf = (n: number): ToothTreatmentStatus => statusByTooth[n] ?? 'healthy'

  return (
    <div className="space-y-4" dir={locale.startsWith('ar') ? 'rtl' : 'ltr'} data-testid="dental-chart-workspace">
      {/* header: title + view toggle + camera presets */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('dental_chart.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {summary?.patient.name} · {t('dental_chart.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border" role="tablist" aria-label={t('dental_chart.view_mode')}>
            {(
              [
                ['2d', t('dental_chart.view_2d'), Grid3X3],
                ['3d', t('dental_chart.view_3d'), Box],
                ['split', t('dental_chart.view_split'), Eye],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                role="tab"
                aria-selected={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                  viewMode === mode ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          {viewMode !== '2d' && (
            <>
              <select
                aria-label={t('dental_chart.reset_camera')}
                className="rounded-md border bg-background p-1.5 text-sm"
                value={cameraPreset}
                onChange={(e) => setCameraPreset(e.target.value as CameraPreset)}
              >
                <option value="default">{t('dental_chart.preset_default')}</option>
                <option value="front">{t('dental_chart.preset_front')}</option>
                <option value="top">{t('dental_chart.preset_top')}</option>
                <option value="side">{t('dental_chart.preset_side')}</option>
              </select>
              <Button variant="outline" size="icon" aria-label={t('dental_chart.reset_camera')} onClick={() => setCameraPreset('default')}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* legend (always visible, localized) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2" aria-label={t('dental_chart.legend')}>
        {(Object.keys(TOOTH_COLORS) as ToothTreatmentStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: TOOTH_COLORS[s] }} />
            {t(`dental_chart.status.${s}`)}
          </span>
        ))}
      </div>

      {/* views */}
      <div className={viewMode === 'split' ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
        {viewMode !== '3d' && <DentalChart2D patientId={patientId} entries={summary?.entries ?? []} />}
        {viewMode !== '2d' && <DentalChart3DLoader statusByTooth={statusByTooth} cameraPreset={cameraPreset} />}
      </div>
      <p className="text-xs text-muted-foreground">{t('dental_chart.keyboard_hint')}</p>

      {/* hovered tooth chip (3D pointer feedback) */}
      {hoveredTooth != null && (
        <div className="pointer-events-none fixed bottom-6 start-6 z-50 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-lg" data-testid="dental-chart-hover-chip">
          {hoveredLabel}
        </div>
      )}

      {/* clinical context panel */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2" />
        <div>
          {selectedToothNumber != null && canView ? (
            <ToothContextPanel
              toothNumber={selectedToothNumber}
              patientId={patientId}
              status={statusOf(selectedToothNumber)}
              entries={entriesForTooth}
              procedures={proceduresForTooth}
              imaging={imagingForTooth}
              activePlan={summary?.activePlan ?? null}
              catalog={summary?.catalog ?? []}
              canModify={canModify}
              onAddFinding={addFinding}
              onAddProcedure={addProcedure}
              onClose={() => setSelectedTooth(null)}
            />
          ) : selectedToothNumber == null ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('dental_chart.no_tooth_selected')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function groupByTooth<T>(items: readonly T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return map
}

/** TreatmentPlanItem.toothNumbers is a comma-separated FDI string. */
export function parseToothNumbers(value: string | null | undefined): number[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 11 && n <= 48)
}

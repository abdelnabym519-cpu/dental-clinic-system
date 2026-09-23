'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  OdontogramProps,
  ToothViewModel,
  DentalChartEntryRecord,
  DentalCondition,
  SeverityLevel,
  ToothSurfaceKey,
} from '../types/odontogram'
import {
  buildToothViewModels,
  calculateOdontogramStats,
  ALL_FDI_TEETH,
} from '../adapters/dental-chart-adapter'
import { ArchGrid } from './ArchGrid'
import { SurfaceSelectorDialog } from './SurfaceSelectorDialog'
import { OdontogramLegend } from './OdontogramLegend'
import { OdontogramStats } from './OdontogramStats'
import { RefreshCw, CheckSquare, Sparkles } from 'lucide-react'
import { useLanguage } from '@/components/providers/language-provider'

export function Odontogram({
  patientId,
  chartData: externalChartData,
  entries: externalEntries,
  selectedTeeth = [],
  onToothClick,
  onTeethSelect,
  onEntrySaved,
  editable = true,
  interactive = true,
  showStats = true,
  showLegend = true,
  mode = 'clinical',
  title = 'Interactive Dental Chart',
}: OdontogramProps & { title?: string }) {
  const { t } = useLanguage()
  const { toast } = useToast()

  const [loading, setLoading] = useState(!externalChartData && !externalEntries)
  const [isSaving, setIsSaving] = useState(false)
  const [internalEntries, setInternalEntries] = useState<DentalChartEntryRecord[]>([])
  const [activeDialogTooth, setActiveDialogTooth] = useState<ToothViewModel | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeFilter, setActiveFilter] = useState<DentalCondition | 'ALL'>('ALL')

  // ─── 1. FETCH DENTAL CHART ENTRIES ─────────────────────────────────────────
  const fetchChartData = useCallback(async () => {
    if (!patientId) return

    try {
      setLoading(true)
      const response = await fetch(`/api/dental-chart?patientId=${patientId}&isActive=true`)
      if (!response.ok) {
        throw new Error('Failed to load dental chart entries')
      }
      const data = await response.json()
      if (data.entries) {
        setInternalEntries(data.entries)
      } else if (data.chartData) {
        setInternalEntries(
          (Array.isArray(data.chartData)
            ? data.chartData
            : Object.values(data.chartData).flat()) as DentalChartEntryRecord[]
        )
      } else {
        setInternalEntries([])
      }
    } catch (err: any) {
      console.error('Error loading dental chart:', err)
      toast({
        variant: 'destructive',
        title: t('Error'),
        description: err.message || 'Failed to load dental chart',
      })
    } finally {
      setLoading(false)
    }
  }, [patientId, toast])

  useEffect(() => {
    if (!externalChartData && !externalEntries) {
      fetchChartData()
    }
  }, [fetchChartData, externalChartData, externalEntries])

  // ─── 2. COMPOSE VIEW MODELS ────────────────────────────────────────────────
  const entriesToUse = useMemo(() => {
    if (externalEntries) return externalEntries
    if (externalChartData) {
      return Object.values(externalChartData).flat()
    }
    return internalEntries
  }, [externalEntries, externalChartData, internalEntries])

  const viewModels = useMemo(() => {
    return buildToothViewModels(entriesToUse)
  }, [entriesToUse])

  const stats = useMemo(() => {
    return calculateOdontogramStats(viewModels)
  }, [viewModels])

  // ─── 3. INTERACTION HANDLERS ───────────────────────────────────────────────
  const handleToothClick = (toothNumber: number) => {
    const tooth = viewModels[toothNumber]
    if (!tooth) return

    if (mode === 'selection' || onTeethSelect) {
      // Toggle selection for procedure planning
      const exists = selectedTeeth.includes(toothNumber)
      const updated = exists
        ? selectedTeeth.filter((t) => t !== toothNumber)
        : [...selectedTeeth, toothNumber]

      if (onTeethSelect) {
        onTeethSelect(updated)
      }
    } else {
      // Clinical diagnosis mode
      setActiveDialogTooth(tooth)
      setDialogOpen(true)

      if (onToothClick) {
        onToothClick(toothNumber, tooth.activeEntry)
      }
    }
  }

  const handleSurfaceClick = (
    toothNumber: number,
    surface: ToothSurfaceKey,
    e: React.MouseEvent
  ) => {
    // If clicked on specific surface, open dialog for that tooth
    handleToothClick(toothNumber)
  }

  // ─── 4. SAVE DIAGNOSTIC ENTRY ──────────────────────────────────────────────
  const handleSaveEntry = async (payload: {
    toothNumber: number
    condition: DentalCondition
    severity: SeverityLevel
    mesial: boolean
    distal: boolean
    occlusal: boolean
    buccal: boolean
    lingual: boolean
    notes?: string
  }) => {
    if (!patientId) return

    try {
      setIsSaving(true)

      const response = await fetch('/api/dental-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          ...payload,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update tooth condition')
      }

      toast({
        title: t('Success'),
        description: t('Tooth #{number} marked as {condition}', { number: payload.toothNumber, condition: payload.condition }),
      })

      setDialogOpen(false)

      if (onEntrySaved) {
        onEntrySaved()
      } else {
        await fetchChartData()
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: t('Save Failed'),
        description: err.message || 'Could not save tooth record',
      })
    } finally {
      setIsSaving(false)
    }
  }

  // ─── 5. LOADING SKELETON ───────────────────────────────────────────────────
  if (loading) {
    return (
      <Card className="rounded-2xl border-border shadow-xs">
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-52 mb-1" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-[340px] w-full rounded-2xl" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <span>{t(title)}</span>
                {mode === 'selection' && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <CheckSquare className="w-3 h-3 text-primary" /> {t("Selection Mode")} </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {mode === 'selection'
                  ? 'Click teeth to select or deselect them for planned treatment procedures.'
                  : 'Click on a tooth or individual surface to view and update clinical findings. (FDI notation)'}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              {!externalChartData && !externalEntries && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchChartData}
                  disabled={loading}
                  className="h-8 gap-1.5 text-xs rounded-lg"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  {t("Refresh")} </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* STATISTICAL SUMMARY */}
          {showStats && <OdontogramStats stats={stats} />}

          {/* MAIN INTERACTIVE ARCH GRID */}
          <ArchGrid
            viewModels={viewModels}
            selectedTeeth={selectedTeeth}
            onToothClick={handleToothClick}
            onSurfaceClick={handleSurfaceClick}
            interactive={interactive}
            mode={mode}
          />

          {/* SELECTED TEETH CHIPS (IN SELECTION MODE) */}
          {selectedTeeth.length > 0 && (
            <div className="p-3 bg-primary/5 rounded-xl border border-primary/20 flex items-center justify-between gap-3 animate-in fade-in">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">
                  {t("Selected Teeth (")}{selectedTeeth.length}):
                </span>
                {selectedTeeth
                  .sort((a, b) => a - b)
                  .map((num) => (
                    <Badge key={num} variant="default" className="text-xs px-2 py-0.5">
                      #{num}
                    </Badge>
                  ))}
              </div>
              {onTeethSelect && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onTeethSelect([])}
                  className="text-xs text-muted-foreground hover:text-foreground h-7"
                >
                  {t("Clear all")} </Button>
              )}
            </div>
          )}

          {/* INTERACTIVE LEGEND */}
          {showLegend && (
            <OdontogramLegend activeFilter={activeFilter} onFilterChange={setActiveFilter} />
          )}
        </CardContent>
      </Card>

      {/* SURFACE & CONDITION EDITOR DIALOG */}
      <SurfaceSelectorDialog
        tooth={activeDialogTooth}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSaveEntry}
        isSaving={isSaving}
      />
    </div>
  )
}

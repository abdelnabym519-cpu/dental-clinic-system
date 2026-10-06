'use client'

/**
 * DenToRa — Interactive Dental Chart: 2D view wrapper (Stage D).
 *
 * WRAPS the protected Phase-3 Odontogram (imported, never modified) and
 * connects it to the shared dental-chart store: selection flows one way
 * (Odontogram → store) while the selected-teeth prop flows back, so the
 * 2D view reflects selections made in 3D and in the clinical panel.
 *
 * Adds arrow-key navigation between adjacent/antagonist teeth (Stage M):
 * the protected ToothCell already provides Tab/Enter/Space + ARIA; this
 * wrapper layers ← → ↑ ↓ on top without touching protected code.
 */

import { useMemo } from 'react'
import { Odontogram } from '@/components/dental-chart/odontogram/Odontogram'
import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'
import { useDentalChartStore } from '@/lib/dental-chart/chart-state'
import { navigationTargets } from '@/lib/dental-chart/fdi'

export default function DentalChart2D({
  patientId,
  entries,
}: {
  patientId: string
  entries: DentalChartEntryRecord[]
}) {
  const selectedToothNumber = useDentalChartStore((s) => s.selectedToothNumber)
  const setSelectedTooth = useDentalChartStore((s) => s.setSelectedTooth)
  const toggleSelectedTooth = useDentalChartStore((s) => s.toggleSelectedTooth)

  const chartData = useMemo(() => {
    const map: Record<number, DentalChartEntryRecord[]> = {}
    for (const e of entries) {
      ;(map[e.toothNumber] ??= []).push(e)
    }
    return map
  }, [entries])

  // Arrow-key navigation: anchored on the current selection (11 when none).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const arrows: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    }
    const dir = arrows[e.key]
    if (e.key === 'Escape') {
      e.preventDefault()
      setSelectedTooth(null)
      return
    }
    if (!dir) return
    e.preventDefault()
    const anchor = selectedToothNumber ?? 11
    const next = navigationTargets(anchor)[dir]
    setSelectedTooth(next)
  }

  return (
    <div
      className="rounded-xl border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={handleKeyDown}
      data-testid="dental-chart-2d"
    >
      <Odontogram
        patientId={patientId}
        chartData={chartData}
        entries={entries}
        selectedTeeth={selectedToothNumber ? [selectedToothNumber] : []}
        onToothClick={(toothNumber) => toggleSelectedTooth(toothNumber)}
        editable={false}
        interactive
        showStats={false}
        showLegend={false}
        mode="clinical"
      />
    </div>
  )
}

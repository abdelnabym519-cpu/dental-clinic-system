'use client'

import React from 'react'
import { Odontogram } from '@/components/dental-chart/odontogram/Odontogram'
import { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'

export interface DentalChartEntry extends DentalChartEntryRecord {}

export interface DentalChartProps {
  patientId: string
  entries?: any[]
  onToothClick?: (toothNumber: number, entries: any[]) => void
  onEntryCreate?: (data: any) => Promise<void>
  onEntryUpdate?: (id: string, data: any) => Promise<void>
  editable?: boolean
  selectedTeeth?: number[]
  onTeethSelect?: (teeth: number[]) => void
}

export function DentalChart({
  patientId,
  entries,
  onToothClick,
  onEntryCreate,
  onEntryUpdate,
  editable = false,
  selectedTeeth = [],
  onTeethSelect,
}: DentalChartProps) {
  return (
    <Odontogram
      patientId={patientId}
      entries={entries}
      selectedTeeth={selectedTeeth}
      onTeethSelect={onTeethSelect}
      onToothClick={(toothNum, entry) => {
        if (onToothClick) {
          onToothClick(toothNum, entry ? [entry] : [])
        }
      }}
      editable={editable}
      mode={onTeethSelect ? 'selection' : 'clinical'}
      showStats={!onTeethSelect}
      showLegend={true}
    />
  )
}

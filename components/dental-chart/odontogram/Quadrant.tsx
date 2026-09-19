'use client'

import React from 'react'
import { ToothViewModel, ToothSurfaceKey } from '../types/odontogram'
import { ToothCell } from './ToothCell'

interface QuadrantProps {
  id: 'Q1' | 'Q2' | 'Q3' | 'Q4'
  title: string
  subtitle: string
  teethNumbers: readonly number[]
  viewModels: Record<number, ToothViewModel>
  selectedTeeth?: number[]
  onToothClick?: (toothNumber: number) => void
  onSurfaceClick?: (toothNumber: number, surface: ToothSurfaceKey, e: React.MouseEvent) => void
  interactive?: boolean
  mode?: 'clinical' | 'selection'
}

export function Quadrant({
  id,
  title,
  subtitle,
  teethNumbers,
  viewModels,
  selectedTeeth = [],
  onToothClick,
  onSurfaceClick,
  interactive = true,
  mode = 'clinical',
}: QuadrantProps) {
  return (
    <div className="flex flex-col items-center">
      {/* Quadrant Tooth Row */}
      <div className="flex items-center gap-1 sm:gap-1.5 justify-center">
        {teethNumbers.map((num) => {
          const tooth = viewModels[num]
          if (!tooth) return null

          return (
            <ToothCell
              key={num}
              tooth={tooth}
              isSelected={selectedTeeth.includes(num)}
              onClick={onToothClick}
              onSurfaceClick={(surface, e) => {
                if (onSurfaceClick) onSurfaceClick(num, surface, e)
              }}
              interactive={interactive}
              mode={mode}
            />
          )
        })}
      </div>
    </div>
  )
}

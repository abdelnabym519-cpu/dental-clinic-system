'use client'

import React from 'react'
import { ToothViewModel, ToothSurfaceKey } from '../types/odontogram'
import { ToothSVG } from './ToothSVG'
import { ToothTooltip } from './ToothTooltip'
import { DENTAL_CONDITION_CONFIG } from '../adapters/dental-chart-adapter'

interface ToothCellProps {
  tooth: ToothViewModel
  isSelected?: boolean
  isHovered?: boolean
  onClick?: (toothNumber: number) => void
  onSurfaceClick?: (surface: ToothSurfaceKey, e: React.MouseEvent) => void
  interactive?: boolean
  mode?: 'clinical' | 'selection'
}

export function ToothCell({
  tooth,
  isSelected = false,
  isHovered = false,
  onClick,
  onSurfaceClick,
  interactive = true,
  mode = 'clinical',
}: ToothCellProps) {
  const isUpper = tooth.position === 'upper'
  const conditionConfig = DENTAL_CONDITION_CONFIG[tooth.condition]

  const hasSurfaceInvolvement =
    tooth.surfaces.mesial ||
    tooth.surfaces.distal ||
    tooth.surfaces.occlusal ||
    tooth.surfaces.buccal ||
    tooth.surfaces.lingual

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && onClick) {
      e.preventDefault()
      onClick(tooth.number)
    }
  }

  const ariaDescription = `${tooth.number}: ${tooth.name}, Condition: ${conditionConfig?.label || tooth.condition}${
    tooth.severity !== 'MILD' ? ` (${tooth.severity})` : ''
  }${
    hasSurfaceInvolvement
      ? `, Surfaces: ${Object.entries(tooth.surfaces)
          .filter(([_, v]) => v)
          .map(([k]) => k.toUpperCase())
          .join(', ')}`
      : ''
  }`

  return (
    <ToothTooltip tooth={tooth}>
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        aria-label={ariaDescription}
        aria-pressed={isSelected}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (interactive && onClick) {
            onClick(tooth.number)
          }
        }}
        className={`
          relative flex flex-col items-center justify-between
          w-10 sm:w-11 md:w-12 lg:w-13 h-24 sm:h-28 md:h-30 p-1 rounded-xl
          transition-all duration-200 select-none
          outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
          ${
            isSelected
              ? 'ring-2 ring-primary bg-primary/10 shadow-md scale-105 z-10'
              : 'hover:bg-muted/70 hover:shadow-xs hover:scale-102'
          }
          ${tooth.isMissing ? 'opacity-40' : 'opacity-100'}
          ${interactive ? 'cursor-pointer' : 'cursor-default'}
        `}
      >
        {/* UPPER JAW: TOOTH NUMBER ON TOP */}
        {isUpper && (
          <span
            className={`
              text-[11px] sm:text-xs font-bold transition-colors
              ${isSelected ? 'text-primary font-black' : 'text-foreground/80'}
            `}
          >
            {tooth.number}
          </span>
        )}

        {/* TOOTH ANATOMY SVG CONTAINER */}
        <div className="relative w-full flex-1 flex items-center justify-center min-h-0 px-0.5">
          <ToothSVG
            tooth={tooth}
            onSurfaceClick={onSurfaceClick}
            interactive={interactive && mode === 'clinical'}
          />

          {/* Active Condition Micro-Badge / Indicator */}
          {tooth.condition !== 'HEALTHY' && !tooth.isMissing && (
            <div
              className={`
                absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background shadow-xs
              `}
              style={{ backgroundColor: conditionConfig?.fillColor || '#ef4444' }}
              title={conditionConfig?.label}
            />
          )}
        </div>

        {/* LOWER JAW: TOOTH NUMBER ON BOTTOM */}
        {!isUpper && (
          <span
            className={`
              text-[11px] sm:text-xs font-bold transition-colors
              ${isSelected ? 'text-primary font-black' : 'text-foreground/80'}
            `}
          >
            {tooth.number}
          </span>
        )}
      </button>
    </ToothTooltip>
  )
}

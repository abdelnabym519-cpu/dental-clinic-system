'use client'

import React from 'react'
import { DENTAL_CONDITION_CONFIG } from '../adapters/dental-chart-adapter'
import { DentalCondition } from '../types/odontogram'

interface OdontogramLegendProps {
  activeFilter?: DentalCondition | 'ALL'
  onFilterChange?: (condition: DentalCondition | 'ALL') => void
}

export function OdontogramLegend({ activeFilter = 'ALL', onFilterChange }: OdontogramLegendProps) {
  const conditions = Object.entries(DENTAL_CONDITION_CONFIG) as [
    DentalCondition,
    (typeof DENTAL_CONDITION_CONFIG)[DentalCondition],
  ][]

  return (
    <div className="bg-muted/30 rounded-xl p-3 border border-border/60">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Condition Legend
        </span>
        {activeFilter !== 'ALL' && onFilterChange && (
          <button
            onClick={() => onFilterChange('ALL')}
            className="text-[11px] text-primary hover:underline font-medium"
          >
            Reset filter
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {conditions.map(([key, config]) => {
          const isSelected = activeFilter === key

          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (onFilterChange) {
                  onFilterChange(isSelected ? 'ALL' : key)
                }
              }}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium
                border transition-all duration-150 outline-none
                ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                    : 'bg-background hover:bg-muted/80 text-foreground/80 border-border/80'
                }
              `}
              title={config.description}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                style={{ backgroundColor: config.fillColor }}
              />
              <span>{config.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

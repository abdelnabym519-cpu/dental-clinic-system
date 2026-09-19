'use client'

import React from 'react'
import { ToothViewModel, ToothSurfaceKey } from '../types/odontogram'
import { ToothGeometryPaths } from '../geometry/tooth-paths'
import { DENTAL_CONDITION_CONFIG } from '../adapters/dental-chart-adapter'

interface ToothSurfacesProps {
  tooth: ToothViewModel
  geometry: ToothGeometryPaths
  onSurfaceClick?: (surface: ToothSurfaceKey, e: React.MouseEvent) => void
  interactive?: boolean
}

const SURFACE_KEYS: ToothSurfaceKey[] = ['buccal', 'lingual', 'mesial', 'distal', 'occlusal']

export function ToothSurfaces({
  tooth,
  geometry,
  onSurfaceClick,
  interactive = true,
}: ToothSurfacesProps) {
  // Get active restorative / condition color
  const conditionConfig = DENTAL_CONDITION_CONFIG[tooth.condition]
  const fillColor = conditionConfig?.fillColor || '#ef4444'

  return (
    <g className="tooth-surfaces-group">
      {SURFACE_KEYS.map((surfaceKey) => {
        const pathData = geometry.surfaces[surfaceKey]
        const isAffected = tooth.surfaces[surfaceKey]

        // Fill logic:
        // If surface is specifically affected (e.g. Caries on Occlusal/Mesial), use condition color
        // If whole crown is Crowned/Restored, condition overlay handles or full fill
        let surfaceFill = 'transparent'
        let surfaceFillOpacity = 0

        if (isAffected && !tooth.isCrown && !tooth.isMissing) {
          surfaceFill = fillColor
          surfaceFillOpacity = tooth.condition === 'CARIES' ? 0.85 : 0.7
        }

        return (
          <path
            key={surfaceKey}
            d={pathData}
            fill={surfaceFill}
            fillOpacity={surfaceFillOpacity}
            stroke={isAffected ? conditionConfig.borderColor : 'transparent'}
            strokeWidth={isAffected ? 1.6 : 0.8}
            strokeDasharray={tooth.isMissing ? '2 2' : undefined}
            className={`
              transition-all duration-150
              ${
                interactive && !tooth.isMissing
                  ? 'hover:fill-primary/25 hover:fill-opacity-40 hover:stroke-primary/50 cursor-pointer'
                  : ''
              }
            `}
            onClick={(e) => {
              if (interactive && !tooth.isMissing && onSurfaceClick) {
                e.stopPropagation()
                onSurfaceClick(surfaceKey, e)
              }
            }}
          >
            <title>{`${tooth.name} - ${surfaceKey.toUpperCase()} surface`}</title>
          </path>
        )
      })}
    </g>
  )
}

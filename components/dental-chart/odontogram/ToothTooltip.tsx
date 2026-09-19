'use client'

import React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { ToothViewModel } from '../types/odontogram'
import { DENTAL_CONDITION_CONFIG } from '../adapters/dental-chart-adapter'

interface ToothTooltipProps {
  tooth: ToothViewModel
  children: React.ReactNode
}

export function ToothTooltip({ tooth, children }: ToothTooltipProps) {
  const conditionConfig = DENTAL_CONDITION_CONFIG[tooth.condition]

  const activeSurfaces = Object.entries(tooth.surfaces)
    .filter(([_, active]) => active)
    .map(([surface]) => surface.toUpperCase())

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="top"
          className="p-3 max-w-xs shadow-lg rounded-xl border border-border bg-popover/95 backdrop-blur-xs"
        >
          <div className="space-y-1.5 text-xs">
            {/* Header: Number and Anatomical Name */}
            <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5">
              <span className="font-bold text-sm text-foreground">#{tooth.number}</span>
              <span className="text-muted-foreground font-medium truncate">{tooth.name}</span>
            </div>

            {/* Condition Badge & Category */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <Badge
                variant="outline"
                className={`text-[11px] font-semibold border ${conditionConfig?.bgColor} ${conditionConfig?.color}`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full mr-1.5"
                  style={{ backgroundColor: conditionConfig?.fillColor || '#10b981' }}
                />
                {conditionConfig?.label || tooth.condition}
              </Badge>

              {tooth.severity && tooth.severity !== 'MILD' && (
                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {tooth.severity}
                </span>
              )}
            </div>

            {/* Clinical Anatomy Spec */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/90 bg-muted/30 px-1.5 py-0.5 rounded">
              <span>Anatomy:</span>
              <span className="font-medium">
                {tooth.rootCount} Root{tooth.rootCount > 1 ? 's' : ''} &bull; {tooth.canalCount}{' '}
                Canal{tooth.canalCount > 1 ? 's' : ''}
              </span>
            </div>

            {/* Surfaces Involved */}
            {activeSurfaces.length > 0 && (
              <div className="text-[11px] text-muted-foreground pt-0.5">
                <span className="font-semibold text-foreground">Surfaces: </span>
                {activeSurfaces.join(', ')}
              </div>
            )}

            {/* Clinical Notes */}
            {tooth.activeEntry?.notes && (
              <p className="text-[11px] text-muted-foreground italic bg-muted/40 p-1.5 rounded border border-border/40">
                &ldquo;{tooth.activeEntry.notes}&rdquo;
              </p>
            )}

            {/* History Count */}
            {tooth.history.length > 1 && (
              <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40 flex justify-between">
                <span>Total records:</span>
                <span className="font-semibold">{tooth.history.length}</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

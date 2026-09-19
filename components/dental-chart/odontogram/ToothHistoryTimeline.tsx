'use client'

import React from 'react'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { DentalChartEntryRecord, DentalCondition } from '../types/odontogram'
import { DENTAL_CONDITION_CONFIG } from '../adapters/dental-chart-adapter'
import { CheckCircle2, Clock } from 'lucide-react'

interface ToothHistoryTimelineProps {
  entries: DentalChartEntryRecord[]
}

export function ToothHistoryTimeline({ entries }: ToothHistoryTimelineProps) {
  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-4 text-xs text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
        No prior historical records for this tooth.
      </div>
    )
  }

  // Sort descending by diagnosis date
  const sorted = [...entries].sort(
    (a, b) => new Date(b.diagnosedDate).getTime() - new Date(a.diagnosedDate).getTime()
  )

  return (
    <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
      {sorted.map((entry) => {
        const isResolved = !!entry.resolvedDate
        const conditionConfig = DENTAL_CONDITION_CONFIG[entry.condition as DentalCondition]

        const surfacesList = [
          entry.mesial && 'M',
          entry.distal && 'D',
          entry.occlusal && 'O',
          entry.buccal && 'B',
          entry.lingual && 'L',
        ]
          .filter(Boolean)
          .join(', ')

        return (
          <div
            key={entry.id}
            className={`
              p-2.5 rounded-lg border transition-colors text-xs
              ${
                isResolved
                  ? 'bg-muted/40 border-border/60 opacity-80'
                  : 'bg-primary/5 border-primary/30 shadow-2xs'
              }
            `}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={isResolved ? 'secondary' : 'default'}
                  className={`text-[10px] font-semibold ${
                    !isResolved && conditionConfig
                      ? `${conditionConfig.bgColor} ${conditionConfig.color} border`
                      : ''
                  }`}
                >
                  {conditionConfig?.label || entry.condition}
                </Badge>
                {surfacesList && (
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    [{surfacesList}]
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {isResolved ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" /> Resolved
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <Clock className="w-3 h-3" /> Active
                  </span>
                )}
                <span>•</span>
                <span>{format(new Date(entry.diagnosedDate), 'MMM d, yyyy')}</span>
              </div>
            </div>

            {entry.notes && (
              <p className="text-[11px] text-muted-foreground mt-1 bg-background/80 p-1.5 rounded border border-border/40">
                {entry.notes}
              </p>
            )}

            {entry.recordedBy && (
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                Recorded by Dr. {entry.recordedBy.firstName} {entry.recordedBy.lastName}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

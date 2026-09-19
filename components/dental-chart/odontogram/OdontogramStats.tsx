'use client'

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { OdontogramSummaryStats } from '../adapters/dental-chart-adapter'

interface OdontogramStatsProps {
  stats: OdontogramSummaryStats
}

export function OdontogramStats({ stats }: OdontogramStatsProps) {
  const cards = [
    {
      label: 'Present Teeth',
      value: stats.presentTeeth,
      total: 32,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
      border: 'border-emerald-200/50 dark:border-emerald-800/30',
    },
    {
      label: 'Caries (Decay)',
      value: stats.cariesTeeth,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50/50 dark:bg-red-950/20',
      border: 'border-red-200/50 dark:border-red-800/30',
    },
    {
      label: 'Restorations',
      value: stats.filledTeeth + stats.crownTeeth,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50/50 dark:bg-blue-950/20',
      border: 'border-blue-200/50 dark:border-blue-800/30',
    },
    {
      label: 'Missing / Extracted',
      value: stats.missingTeeth,
      color: 'text-slate-600 dark:text-slate-400',
      bg: 'bg-slate-50/50 dark:bg-slate-900/20',
      border: 'border-slate-200/50 dark:border-slate-800/30',
    },
    {
      label: 'Endodontic (RCT)',
      value: stats.rootCanalTeeth,
      color: 'text-pink-600 dark:text-pink-400',
      bg: 'bg-pink-50/50 dark:bg-pink-950/20',
      border: 'border-pink-200/50 dark:border-pink-800/30',
    },
    {
      label: 'Implants',
      value: stats.implantTeeth,
      color: 'text-cyan-600 dark:text-cyan-400',
      bg: 'bg-cyan-50/50 dark:bg-cyan-950/20',
      border: 'border-cyan-200/50 dark:border-cyan-800/30',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {cards.map((card) => (
        <Card key={card.label} className={`${card.bg} ${card.border} border shadow-2xs`}>
          <CardContent className="p-3">
            <div className={`text-xl font-black ${card.color}`}>
              {card.value}
              {card.total && (
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  /{card.total}
                </span>
              )}
            </div>
            <div className="text-[11px] font-medium text-muted-foreground truncate">
              {card.label}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

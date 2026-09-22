'use client'

import React from 'react'
import { ToothViewModel, ToothSurfaceKey } from '../types/odontogram'
import { FDI_QUADRANTS } from '../adapters/dental-chart-adapter'
import { Quadrant } from './Quadrant'
import { BridgeConnector } from './BridgeConnector'
import { useLanguage } from '@/components/providers/language-provider'

interface ArchGridProps {
  viewModels: Record<number, ToothViewModel>
  selectedTeeth?: number[]
  onToothClick?: (toothNumber: number) => void
  onSurfaceClick?: (toothNumber: number, surface: ToothSurfaceKey, e: React.MouseEvent) => void
  interactive?: boolean
  mode?: 'clinical' | 'selection'
}

export function ArchGrid({
  viewModels,
  selectedTeeth = [],
  onToothClick,
  onSurfaceClick,
  interactive = true,
  mode = 'clinical',
}: ArchGridProps) {
  const { t } = useLanguage()
  return (
    <div className="w-full overflow-x-auto pb-2" dir="ltr">
      <div className="min-w-[760px] max-w-5xl mx-auto bg-gradient-to-b from-slate-50/90 via-white to-slate-50/90 dark:from-slate-900/70 dark:via-slate-950 dark:to-slate-900/70 rounded-2xl p-5 sm:p-6 border border-border shadow-sm relative select-none">
        {/* QUADRANT CORNER CLINICAL LABELS */}
        <div className="absolute top-3 left-4 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          Q1 (UR)
        </div>
        <div className="absolute top-3 right-4 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          Q2 (UL)
          <span className="w-2 h-2 rounded-full bg-blue-500" />
        </div>
        <div className="absolute bottom-3 left-4 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          Q4 (LR)
        </div>
        <div className="absolute bottom-3 right-4 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          Q3 (LL)
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
        </div>

        {/* ─── 1. UPPER JAW (MAXILLARY ARCH) ──────────────────────────── */}
        <div className="relative pt-6 pb-2">
          <div className="text-center mb-3">
            <span className="text-xs font-bold tracking-wider uppercase text-muted-foreground/90 px-3 py-1 rounded-full bg-muted/80 border border-border/50">
              {t("Upper Jaw (Maxilla)")} </span>
          </div>

          <div className="relative flex justify-center items-center gap-2 sm:gap-4">
            {/* Quadrant 1 (18 -> 11) */}
            <Quadrant
              id="Q1"
              title={t("Upper Right")}
              subtitle="Q1 (UR)"
              teethNumbers={FDI_QUADRANTS.Q1}
              viewModels={viewModels}
              selectedTeeth={selectedTeeth}
              onToothClick={onToothClick}
              onSurfaceClick={onSurfaceClick}
              interactive={interactive}
              mode={mode}
            />

            {/* MIDLINE VERTICAL SEPARATOR */}
            <div className="h-32 w-[2px] bg-border relative flex items-center justify-center">
              <span className="absolute text-[9px] font-bold text-muted-foreground/70 rotate-90 whitespace-nowrap select-none bg-background px-1 py-0.5 rounded-sm">
                {t("Midline")} </span>
            </div>

            {/* Quadrant 2 (21 -> 28) */}
            <Quadrant
              id="Q2"
              title={t("Upper Left")}
              subtitle="Q2 (UL)"
              teethNumbers={FDI_QUADRANTS.Q2}
              viewModels={viewModels}
              selectedTeeth={selectedTeeth}
              onToothClick={onToothClick}
              onSurfaceClick={onSurfaceClick}
              interactive={interactive}
              mode={mode}
            />

            <BridgeConnector viewModels={viewModels} position="upper" />
          </div>
        </div>

        {/* ─── OCCLUSAL PLANE HORIZONTAL DIVIDER ───────────────────────── */}
        <div className="relative my-4 flex items-center justify-center">
          <div className="w-full border-t-2 border-dashed border-border" />
          <span className="absolute bg-background px-3 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider rounded-full border border-border shadow-xs">
            {t("Occlusal Plane")} </span>
        </div>

        {/* ─── 2. LOWER JAW (MANDIBULAR ARCH) ─────────────────────────── */}
        <div className="relative pt-2 pb-6">
          <div className="relative flex justify-center items-center gap-2 sm:gap-4">
            {/* Quadrant 4 (48 -> 41) */}
            <Quadrant
              id="Q4"
              title={t("Lower Right")}
              subtitle="Q4 (LR)"
              teethNumbers={FDI_QUADRANTS.Q4}
              viewModels={viewModels}
              selectedTeeth={selectedTeeth}
              onToothClick={onToothClick}
              onSurfaceClick={onSurfaceClick}
              interactive={interactive}
              mode={mode}
            />

            {/* MIDLINE VERTICAL SEPARATOR */}
            <div className="h-32 w-[2px] bg-border relative flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-border" />
            </div>

            {/* Quadrant 3 (31 -> 38) */}
            <Quadrant
              id="Q3"
              title={t("Lower Left")}
              subtitle="Q3 (LL)"
              teethNumbers={FDI_QUADRANTS.Q3}
              viewModels={viewModels}
              selectedTeeth={selectedTeeth}
              onToothClick={onToothClick}
              onSurfaceClick={onSurfaceClick}
              interactive={interactive}
              mode={mode}
            />

            <BridgeConnector viewModels={viewModels} position="lower" />
          </div>

          <div className="text-center mt-3">
            <span className="text-xs font-bold tracking-wider uppercase text-muted-foreground/90 px-3 py-1 rounded-full bg-muted/80 border border-border/50">
              {t("Lower Jaw (Mandible)")} </span>
          </div>
        </div>
      </div>
    </div>
  )
}

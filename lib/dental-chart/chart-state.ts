/**
 * DenToRa — Interactive Dental Chart: single source of truth (Stage G).
 *
 * One zustand store consumed by the 2D view (protected Odontogram wrapper),
 * the 3D view (React Three Fiber) and the clinical context panel.
 * Synchronization rules implemented here:
 *   1. Select tooth 11 in 2D  → tooth 11 selected for 3D (same store field).
 *   2. Select tooth 11 in 3D  → tooth 11 selected for 2D (same store field).
 *   3. Clinical state change  → setStatusByTooth once, both views re-render.
 *   4. Page reload            → workspace refetches the summary API and
 *                               reconstructs state from the DB (never memory).
 */

import { create } from 'zustand'
import type { ToothSurfaceKey } from '@/components/dental-chart/types/odontogram'
import type { ToothTreatmentStatus } from './clinical-status'

export type DentalChartViewMode = '2d' | '3d' | 'split'

export interface DentalChartStoreState {
  selectedToothNumber: number | null
  selectedSurface: ToothSurfaceKey | null
  hoveredTooth: number | null
  viewMode: DentalChartViewMode
  statusByTooth: Record<number, ToothTreatmentStatus>
  setSelectedTooth: (tooth: number | null, surface?: ToothSurfaceKey | null) => void
  toggleSelectedTooth: (tooth: number) => void
  setHoveredTooth: (tooth: number | null) => void
  setViewMode: (mode: DentalChartViewMode) => void
  setStatusByTooth: (map: Record<number, ToothTreatmentStatus>) => void
  reset: () => void
}

const initialState = {
  selectedToothNumber: null as number | null,
  selectedSurface: null as ToothSurfaceKey | null,
  hoveredTooth: null as number | null,
  viewMode: '2d' as DentalChartViewMode,
  statusByTooth: {} as Record<number, ToothTreatmentStatus>,
}

export const useDentalChartStore = create<DentalChartStoreState>((set, get) => ({
  ...initialState,
  setSelectedTooth: (tooth, surface = null) =>
    set({ selectedToothNumber: tooth, selectedSurface: surface ?? null }),
  toggleSelectedTooth: (tooth) => {
    const current = get().selectedToothNumber
    set({ selectedToothNumber: current === tooth ? null : tooth, selectedSurface: null })
  },
  setHoveredTooth: (tooth) => set({ hoveredTooth: tooth }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setStatusByTooth: (map) => set({ statusByTooth: { ...map } }),
  reset: () => set({ ...initialState }),
}))

/** Fresh isolated store for unit tests (never mutates the module singleton). */
export function createDentalChartStoreForTest() {
  return create<DentalChartStoreState>((set, get) => ({
    ...initialState,
    setSelectedTooth: (tooth, surface = null) =>
      set({ selectedToothNumber: tooth, selectedSurface: surface ?? null }),
    toggleSelectedTooth: (tooth) => {
      const current = get().selectedToothNumber
      set({ selectedToothNumber: current === tooth ? null : tooth, selectedSurface: null })
    },
    setHoveredTooth: (tooth) => set({ hoveredTooth: tooth }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setStatusByTooth: (map) => set({ statusByTooth: { ...map } }),
    reset: () => set({ ...initialState }),
  }))
}

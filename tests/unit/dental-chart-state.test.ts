import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDentalChartStoreForTest,
  type DentalChartStoreState,
} from '@/lib/dental-chart/chart-state'

// Stage G synchronization contract: ONE store consumed by 2D, 3D and the
// clinical panel — selection/status changes are visible to every consumer.

describe('dental chart shared store', () => {
  let store: ReturnType<typeof createDentalChartStoreForTest>
  beforeEach(() => {
    store = createDentalChartStoreForTest()
  })

  const readSelected = () => store.getState().selectedToothNumber

  it('select in 2D → visible in 3D (same single source of truth)', () => {
    // Both view consumers subscribe; any of them writing is visible to all.
    const seen: (number | null)[] = []
    store.subscribe((st: DentalChartStoreState) => seen.push(st.selectedToothNumber))
    store.getState().setSelectedTooth(11) // as the 2D wrapper does
    expect(readSelected()).toBe(11) // what the 3D scene reads
    expect(seen).toEqual([11])
  })

  it('select in 3D → visible in 2D, with optional surface', () => {
    store.getState().setSelectedTooth(26, 'occlusal')
    expect(store.getState().selectedToothNumber).toBe(26)
    expect(store.getState().selectedSurface).toBe('occlusal')
  })

  it('toggle deselects when re-selecting the same tooth', () => {
    store.getState().toggleSelectedTooth(16)
    expect(store.getState().selectedToothNumber).toBe(16)
    store.getState().toggleSelectedTooth(16)
    expect(store.getState().selectedToothNumber).toBeNull()
  })

  it('clinical state change updates every consumer simultaneously', () => {
    const seen: number[] = []
    store.subscribe((st) => {
      if (st.statusByTooth[36]) seen.push(st.statusByTooth[36])
    })
    store.getState().setStatusByTooth({ 36: 'missing' })
    expect(seen).toEqual(['missing'])
    expect(store.getState().statusByTooth[36]).toBe('missing')
  })

  it('view mode switch preserves selection (split view continuity)', () => {
    store.getState().setSelectedTooth(21)
    store.getState().setViewMode('split')
    expect(store.getState().selectedToothNumber).toBe(21)
    expect(store.getState().viewMode).toBe('split')
  })

  it('reset restores pristine state (reload semantics = refetch from DB)', () => {
    store.getState().setSelectedTooth(15)
    store.getState().setStatusByTooth({ 15: 'affected' })
    store.getState().reset()
    expect(store.getState().selectedToothNumber).toBeNull()
    expect(store.getState().statusByTooth).toEqual({})
  })
})

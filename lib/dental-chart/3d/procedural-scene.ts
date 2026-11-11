'use client'

/**
 * P4 / step 3 — ProceduralScene: the AUTOMATIC FALLBACK.
 *
 * This is NOT new 3D work. It adapts our existing React-Three-Fiber view
 * (`components/dental-chart/interactive/DentalChart3D`) to the Chart3DAdapter
 * interface by mounting it imperatively with `createRoot`.
 *
 * Why it is the fallback for everything:
 *   - ASSET_MODE=none (the default) → no engine meshes, so this is the scene;
 *   - no WebGL → nothing 3D runs, so we never even get here, but the contract
 *     still resolves to this;
 *   - ScopeScene fails to mount → we degrade to this rather than show an error.
 *
 * It is also where primary teeth (51-85) will be added later: this view builds
 * its geometry procedurally, so it is not blocked on the mesh licence.
 */
import { createRoot, type Root } from 'react-dom/client'
import { createElement, type ReactElement } from 'react'

import type { Chart3DAdapter, Chart3DStateMap, Chart3DView } from './types'
import { PERMANENT_FDI } from './types'
import type { ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'

/** Our view names → the existing component's camera presets. */
const VIEW_TO_PRESET: Record<Chart3DView, 'default' | 'front' | 'top' | 'side'> = {
  default: 'default',
  front: 'front',
  upper: 'top',
  lower: 'default',
  left: 'side',
  right: 'side',
}

/**
 * `DentalChart3D` is heavy (three + R3F). We keep the import dynamic so the
 * engine-free path never pulls it into the initial bundle.
 */
type DentalChart3DComponent = (props: {
  statusByTooth: Record<number, ToothTreatmentStatus>
  cameraPreset?: 'default' | 'front' | 'top' | 'side'
}) => ReactElement | null

let cachedComponent: DentalChart3DComponent | null = null

async function loadComponent(): Promise<DentalChart3DComponent> {
  if (cachedComponent) return cachedComponent
  const mod = await import('@/components/dental-chart/interactive/DentalChart3D')
  cachedComponent = mod.default as DentalChart3DComponent
  return cachedComponent
}

export interface ProceduralSceneOptions {
  /** Injectable for tests — avoids pulling three.js into a jsdom unit test. */
  load?: () => Promise<DentalChart3DComponent>
}

export function createProceduralScene(
  options: ProceduralSceneOptions = {},
): Chart3DAdapter {
  const load = options.load ?? loadComponent

  let root: Root | null = null
  let container: HTMLElement | null = null
  let states: Chart3DStateMap = {}
  let view: Chart3DView = 'default'
  let disposed = false
  const listeners = new Set<(fdi: number | null) => void>()

  const render = (Component: DentalChart3DComponent) => {
    if (!root || disposed) return
    root.render(
      createElement(Component, {
        statusByTooth: states,
        cameraPreset: VIEW_TO_PRESET[view],
      }),
    )
  }

  let component: DentalChart3DComponent | null = null

  return {
    kind: 'procedural',
    // Permanent teeth today; primary teeth land here later.
    teeth: PERMANENT_FDI,

    async mount(el: HTMLElement) {
      if (disposed) throw new Error('ProceduralScene: mounted after dispose')
      container = el
      component = await load()
      if (disposed) return // disposed while loading
      root = createRoot(el)
      render(component)
    },

    setStates(map: Chart3DStateMap) {
      states = { ...map }
      if (component) render(component)
    },

    onSelect(listener: (fdi: number | null) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    select(fdi: number | null) {
      // The R3F view drives selection through the shared chart store; this
      // adapter only has to notify its own listeners so the route stays in
      // sync with what the user clicked.
      listeners.forEach((l) => l(fdi))
    },

    setView(next: Chart3DView) {
      view = next
      if (component) render(component)
    },

    reset() {
      states = {}
      view = 'default'
      if (component) render(component)
    },

    dispose() {
      if (disposed) return
      disposed = true
      // React 19 warns if a root is unmounted synchronously from a lifecycle
      // hook; queueing it keeps the flush out of the render phase.
      const r = root
      root = null
      container = null
      listeners.clear()
      if (r) queueMicrotask(() => r.unmount())
    },
  }
}

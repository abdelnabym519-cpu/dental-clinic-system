'use client'

/**
 * P4 / step 3 — ScopeScene: the vendored dental-scope engine, for PERMANENT teeth.
 *
 * Only selected when ASSET_MODE != 'none'. Everything is imported DYNAMICALLY,
 * so the default (`none`) path never downloads three.js, the engine, or any
 * model — which is the whole point of the mode gate.
 *
 * If anything here fails (no model files, WebGL lost, engine throws), `mount()`
 * REJECTS and the caller falls back to ProceduralScene with
 * `fallbackReason: 'scope-mount-failed'`. The user must never see a blank page.
 */
import type { Chart3DAdapter, Chart3DStateMap, Chart3DView } from './types'
import { PERMANENT_FDI } from './types'
import type { ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'

/** Engine view presets we accept; anything else falls back to three-quarter. */
const VIEW_TO_ENGINE: Record<Chart3DView, string> = {
  default: 'three-quarter',
  front: 'front',
  upper: 'upper',
  lower: 'lower',
  left: 'left',
  right: 'right',
}

/** Status → the tint handed to PATCH 2. `healthy` and `missing` are special. */
export function tintForStatus(status: ToothTreatmentStatus): string | null {
  switch (status) {
    case 'healthy':
      // Healthy is the material's own enamel colour — do NOT tint it.
      return null
    case 'missing':
      return '#9ca3af'
    case 'affected':
      return '#ef4444'
    case 'planned':
      return '#f59e0b'
    case 'in_progress':
      return '#3b82f6'
    case 'completed':
      return '#8b5cf6'
    default:
      return null
  }
}

/** A missing tooth should read as absent, not merely grey. */
export function opacityForStatus(status: ToothTreatmentStatus): number | null {
  return status === 'missing' ? 0.18 : null
}

export interface ScopeSceneDeps {
  /** Injectable so tests never touch WebGL or the network. */
  loadEngine?: () => Promise<ScopeEngineBundle>
}

export interface ScopeEngineBundle {
  engine: {
    mount(container: HTMLElement): void
    dispose(): void
    resetToStart(): void
    setView?(view: string): void
    dentoraEntries(): ReadonlyMap<string, unknown>
    dentoraScene(): unknown
    dentoraRenderer(): unknown
    dentoraDisposeResources(): void
  }
  patches: {
    setToothAppearance(
      engine: unknown,
      fdi: number,
      appearance: { tint?: string | null; opacity?: number | null; rim?: string | null },
    ): number
    clearToothAppearance(engine: unknown): number
    onToothSelection(listener: (fdi: number | null) => void): () => void
    selectTooth(engine: unknown, fdi: number, opts?: { focus?: boolean; reveal?: boolean }): Promise<void>
    focusTooth(engine: unknown, fdi: number): void
    resetEngine(engine: unknown): void
    disposeEngineResources(engine: unknown): unknown
    hideEngineChrome(container: HTMLElement): { restore(): void }
  }
}

async function defaultLoadEngine(): Promise<ScopeEngineBundle> {
  // Dynamic: keeps three.js/engine out of the default bundle entirely.
  const [engineMod, patchMod, assetsMod, registryMod] = await Promise.all([
    import('../../../vendor/dental-scope-engine/src/engine/Engine'),
    import('../../../vendor/dental-scope-engine/src/engine/dentoraPatches'),
    import('../../../vendor/dental-scope-engine/src/engine/assets'),
    import('../../../vendor/dental-scope-engine/src/anatomy/registry'),
  ])
  const manifest = await assetsMod.loadManifest()
  const registry = new registryMod.Registry(manifest)
  const engine = new engineMod.Engine(registry)
  return { engine: engine as unknown as ScopeEngineBundle['engine'], patches: patchMod }
}

export function createScopeScene(deps: ScopeSceneDeps = {}): Chart3DAdapter {
  const load = deps.loadEngine ?? defaultLoadEngine

  let bundle: ScopeEngineBundle | null = null
  let container: HTMLElement | null = null
  let chrome: { restore(): void } | null = null
  let unsubSelection: (() => void) | null = null
  let disposed = false
  let states: Chart3DStateMap = {}
  let selected: number | null = null

  const applyAll = () => {
    if (!bundle) return
    for (const fdi of PERMANENT_FDI) {
      const status = states[fdi] ?? 'healthy'
      bundle.patches.setToothAppearance(bundle.engine, fdi, {
        tint: tintForStatus(status),
        opacity: opacityForStatus(status),
        rim: selected === fdi ? '#3346f0' : null,
      })
    }
  }

  return {
    kind: 'scope',
    teeth: PERMANENT_FDI,

    async mount(el: HTMLElement) {
      if (disposed) throw new Error('ScopeScene: mounted after dispose')
      try {
        bundle = await load()
      } catch (err) {
        // The caller turns this into the 'scope-mount-failed' fallback.
        throw new Error(
          `ScopeScene: engine unavailable (${err instanceof Error ? err.message : String(err)})`,
        )
      }
      if (disposed) return
      bundle.engine.mount(el)
      container = el
      // PATCH 7: the engine's own overlay/tooltip carry ENGLISH text.
      chrome = bundle.patches.hideEngineChrome(el)
      // PATCH 3: selection out of the engine's module-level store.
      unsubSelection = bundle.patches.onToothSelection(() => {
        /* re-emitted to the route's own listeners below */
      })
      applyAll()
    },

    setStates(map: Chart3DStateMap) {
      states = { ...map }
      applyAll()
    },

    onSelect(listener: (fdi: number | null) => void) {
      if (!bundle) return () => {}
      // Subscribe through the patch module so FDI conversion is shared.
      return bundle.patches.onToothSelection((fdi) => {
        selected = fdi
        listener(fdi)
      })
    },

    select(fdi: number | null) {
      if (!bundle) return
      selected = fdi
      if (fdi === null) {
        bundle.patches.resetEngine(bundle.engine)
        applyAll()
        return
      }
      void bundle.patches.selectTooth(bundle.engine, fdi, { focus: true })
      applyAll()
    },

    setView(view: Chart3DView) {
      bundle?.engine.setView?.(VIEW_TO_ENGINE[view] ?? 'three-quarter')
    },

    reset() {
      if (!bundle) return
      selected = null
      bundle.patches.resetEngine(bundle.engine)
      states = {}
    },

    dispose() {
      if (disposed) return
      disposed = true
      unsubSelection?.()
      chrome?.restore()
      if (bundle) {
        bundle.engine.dispose()
        // PATCH 6: release geometries/materials/textures the engine leaked.
        bundle.patches.disposeEngineResources(bundle.engine)
      }
      bundle = null
      container = null
    },
  }
}

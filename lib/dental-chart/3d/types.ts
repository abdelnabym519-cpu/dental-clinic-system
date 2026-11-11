/**
 * P4 / step 3 — the Chart3DAdapter contract.
 *
 * One imperative interface, two implementations:
 *
 *   - **ScopeScene**    — the vendored dental-scope engine (permanent teeth).
 *   - **ProceduralScene** — our existing React-Three-Fiber view. It is the
 *     AUTOMATIC FALLBACK (no assets, no WebGL, or a failed engine mount) and
 *     is where primary teeth will live later.
 *
 * The point of the interface is that the route never learns which one it got:
 * it calls `mount / setStates / onSelect / select / setView / reset / dispose`
 * and renders an Arabic note when `selectScene()` reports a fallback.
 */
import type { ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'

/** Camera presets we expose. Each implementation maps them to its own terms. */
export type Chart3DView = 'default' | 'front' | 'upper' | 'lower' | 'left' | 'right'

export const CHART3D_VIEWS: readonly Chart3DView[] = [
  'default',
  'front',
  'upper',
  'lower',
  'left',
  'right',
]

/** Per-tooth visual state handed to `setStates`. */
export type Chart3DStateMap = Record<number, ToothTreatmentStatus>

export interface Chart3DAdapter {
  /** Which implementation this is — surfaced in the UI and in tests. */
  readonly kind: 'scope' | 'procedural'

  /**
   * The FDI numbers this scene can actually draw.
   * ScopeScene = the 32 permanent teeth; ProceduralScene = everything we have
   * geometry for (permanent for now, primary later).
   */
  readonly teeth: readonly number[]

  /** Attach to a DOM container. Rejects if the underlying renderer cannot start. */
  mount(container: HTMLElement): Promise<void>

  /** Paint the recorded findings. `resolved` rows must already be filtered out. */
  setStates(map: Chart3DStateMap): void

  /** Selection OUT. Returns an unsubscribe function. */
  onSelect(listener: (fdi: number | null) => void): () => void

  /** Selection IN. `null` clears the selection. */
  select(fdi: number | null): void

  setView(view: Chart3DView): void

  /** Return to a clean state — called between patients. */
  reset(): void

  /** Release everything. Must be safe to call twice. */
  dispose(): void
}

/* -------------------------------------------------------------------------- */
/* scene selection                                                            */
/* -------------------------------------------------------------------------- */

export const PERMANENT_FDI: readonly number[] = [
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]

/** Why we are NOT using the engine. Every one has an Arabic note in the UI. */
export type FallbackReason =
  /** ASSET_MODE=none — the default, and a licence position, not an error. */
  | 'asset-mode-none'
  /** No WebGL context available at all — nothing 3D can run. */
  | 'webgl-unsupported'
  /** ASSET_MODE != none, but the engine failed to mount. */
  | 'scope-mount-failed'

export interface SceneSelection {
  kind: 'scope' | 'procedural'
  /**
   * Non-null when we fell back. The route MUST show an Arabic note and MUST
   * still render a scene — a blank page or an error is never an acceptable
   * outcome of having no model files.
   */
  fallbackReason: FallbackReason | null
}

export interface SelectSceneInput {
  /** Resolved from ASSET_MODE; `none` is the default. */
  assetMode: 'none' | 'local' | 'bundled'
  webgl: boolean
}

/**
 * Decide which scene to use.
 *
 * `ASSET_MODE=none` yields ProceduralScene **by design** — the licence for the
 * tooth meshes is unresolved (decision D1), so shipping without them is the
 * default, not a degraded state.
 */
export function selectScene(input: SelectSceneInput): SceneSelection {
  if (!input.webgl) {
    return { kind: 'procedural', fallbackReason: 'webgl-unsupported' }
  }
  if (input.assetMode === 'none') {
    return { kind: 'procedural', fallbackReason: 'asset-mode-none' }
  }
  // Assets are enabled: try the engine. If its mount fails, the caller falls
  // back and reports 'scope-mount-failed'.
  return { kind: 'scope', fallbackReason: null }
}

/** Arabic note shown when we are on the fallback. `null` = no note needed. */
export function fallbackNote(reason: FallbackReason | null): string | null {
  switch (reason) {
    case 'asset-mode-none':
      return 'وضع الأصول معطّل (ASSET_MODE=none): يتم عرض المنظر الإجرائي الافتراضي بدون نماذج ثلاثية الأبعاد.'
    case 'webgl-unsupported':
      return 'هذا المتصفح لا يدعم WebGL، لذلك يتم عرض المنظر الإجرائي الافتراضي.'
    case 'scope-mount-failed':
      return 'تعذّر تشغيل محرّك النماذج ثلاثية الأبعاد، وتم التبديل إلى المنظر الإجرائي الافتراضي.'
    default:
      return null
  }
}

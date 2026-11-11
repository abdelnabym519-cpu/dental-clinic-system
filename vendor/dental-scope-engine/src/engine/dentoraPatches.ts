/**
 * P4 / S3 — Dentora patches over the vendored dental-scope Engine (PATCHES 2–7).
 *
 * WHY A SEPARATE MODULE
 * Upstream `Engine.ts` is a ~1900-line file we do not want to fork. Everything
 * here is therefore additive: this module reaches the engine through the four
 * narrow accessors added to `Engine` (`dentoraEntries`, `dentoraScene`,
 * `dentoraRenderer`, `dentoraDisposeResources`) instead of casting into private
 * fields. `Engine` is imported **type-only**, so there is no runtime import
 * cycle.
 *
 * THE SIX PATCHES
 *   2. setToothAppearance(fdi, { tint, opacity, rim })
 *   3. selection OUT — subscribe to the module-level store, tooth-NN -> FDI
 *   4. selection IN  — selectFromUI / focus, FDI -> tooth-NN
 *   5. per-mount isolation / explicit reset between patients
 *   6. full dispose — upstream dispose() leaks geometries, materials, textures
 *   7. hide the engine's own chrome; no English text may reach the UI
 *
 * Contract tests: `tests/unit/dental-scope-patches.test.ts`.
 */
import * as THREE from 'three';
import type { Engine, MeshEntry } from './Engine';
import type { TissueMaterial } from './materials';
import { setMaterialOpacity } from './materials';
import { getState, setState, store } from '../state/store';

/* ========================================================================== */
/* PATCH 2 — tooth appearance                                                  */
/* ========================================================================== */

export interface ToothAppearance {
  /** Hex colour multiplied over the enamel's own colour (a tint, not a repaint). */
  tint?: string | null;
  /** 0..1. `null` restores the material's original opacity. */
  opacity?: number | null;
  /** Hex colour for a faint emissive rim, used to mark the selected tooth. */
  rim?: string | null;
}

/** How strongly the rim glows. Low enough to read as an outline, not a light. */
const RIM_INTENSITY = 0.35;

/**
 * Saved original material values, so an appearance can always be undone.
 * Kept on `userData` next to the material rather than in a side map, so it
 * can never outlive the material or leak across mounts.
 */
interface DentoraBase {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
  opacity: number;
}

const BASE_KEY = 'dentoraBase';

function baseOf(mat: TissueMaterial): DentoraBase {
  const ud = mat.userData as Record<string, unknown>;
  let base = ud[BASE_KEY] as DentoraBase | undefined;
  if (!base) {
    base = {
      color: mat.color.clone(),
      emissive: mat.emissive.clone(),
      emissiveIntensity: mat.emissiveIntensity,
      opacity: mat.opacity,
    };
    ud[BASE_KEY] = base;
  }
  return base;
}

function applyAppearance(entry: MeshEntry, a: ToothAppearance): void {
  const mat = entry.mesh.material as TissueMaterial;
  if (!mat) return;
  const base = baseOf(mat);

  if (a.tint !== undefined) {
    if (a.tint === null) mat.color.copy(base.color);
    // Multiply, not `set`: this keeps the material's own shading variation,
    // so a tinted tooth still looks like enamel rather than flat paint.
    else mat.color.copy(base.color).multiply(new THREE.Color(a.tint));
  }

  if (a.opacity !== undefined) {
    setMaterialOpacity(mat, a.opacity === null ? base.opacity : a.opacity);
  }

  if (a.rim !== undefined) {
    if (a.rim === null) {
      mat.emissive.copy(base.emissive);
      mat.emissiveIntensity = base.emissiveIntensity;
    } else {
      mat.emissive.set(a.rim);
      mat.emissiveIntensity = RIM_INTENSITY;
    }
  }
  mat.needsUpdate = true;
}

/**
 * Meshes belonging to one FDI tooth. `tooth-<fdi>` is the crown/enamel shell;
 * the root-side meshes (cementum, dentine, pulp) carry the SAME clinical
 * status, so they are tinted with it — otherwise a "caries on 36" chart entry
 * would light up the crown and leave its roots looking healthy.
 */
function keysForFdi(fdi: number): string[] {
  return [`tooth-${fdi}`, `cementum-${fdi}`, `dentine-${fdi}`, `pulp-${fdi}`];
}

/**
 * PATCH 2. Tint / fade / rim every mesh of one FDI tooth.
 * Returns how many meshes were actually changed (0 when the tooth is not
 * loaded yet — the caller can retry after `ensureTooth`).
 */
export function setToothAppearance(
  engine: Engine,
  fdi: number,
  appearance: ToothAppearance,
): number {
  const entries = engine.dentoraEntries();
  const prefixes = keysForFdi(fdi);
  let touched = 0;
  for (const [key, entry] of entries) {
    if (prefixes.some((p) => key.startsWith(p))) {
      applyAppearance(entry, appearance);
      touched++;
    }
  }
  return touched;
}

/** Restore every tinted material to its original colour/opacity/emissive. */
export function clearToothAppearance(engine: Engine): number {
  let restored = 0;
  for (const entry of engine.dentoraEntries().values()) {
    const mat = entry.mesh.material as TissueMaterial | undefined;
    if (!mat) continue;
    const ud = mat.userData as Record<string, unknown>;
    const base = ud[BASE_KEY] as DentoraBase | undefined;
    if (!base) continue;
    mat.color.copy(base.color);
    mat.emissive.copy(base.emissive);
    mat.emissiveIntensity = base.emissiveIntensity;
    setMaterialOpacity(mat, base.opacity);
    mat.needsUpdate = true;
    delete ud[BASE_KEY];
    restored++;
  }
  return restored;
}

/* ========================================================================== */
/* PATCH 3 — selection OUT                                                     */
/* ========================================================================== */

/**
 * Mesh keys are `tooth-<NN>` where **NN is already the FDI number** — verified
 * at `Engine.ts:313` and `DevelopmentScene.ts:62,305`. So the conversion is a
 * parse, not a lookup table.
 *
 * Returns `null` for anything that is not a tooth (nerves, bone, sinuses…),
 * because our chart only speaks FDI.
 */
export function fdiFromMeshKey(id: string | null | undefined): number | null {
  if (!id) return null;
  const m = /^tooth-(\d{2})$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

export type ToothSelectionListener = (fdi: number | null) => void;

/**
 * PATCH 3. Subscribe to the engine's **module-level** store (not a React
 * hook — this must work from a plain adapter). Fires immediately with the
 * current selection, then on every change; de-duplicated so a re-render that
 * does not change the tooth does not spam the caller.
 *
 * Returns the unsubscribe function.
 */
export function onToothSelection(listener: ToothSelectionListener): () => void {
  let last: number | null | undefined;
  const emit = (id: string | null) => {
    const fdi = fdiFromMeshKey(id);
    if (fdi === last) return;
    last = fdi;
    listener(fdi);
  };
  emit(getState().selectedId);
  // zustand vanilla: listener receives (state, prevState).
  return store.subscribe((s) => emit(s.selectedId));
}

/* ========================================================================== */
/* PATCH 4 — selection IN                                                      */
/* ========================================================================== */

/** PATCH 4. Select a tooth from our UI. `focus` frames it; `reveal` unhides it. */
export function selectTooth(
  engine: Engine,
  fdi: number,
  opts: { focus?: boolean; reveal?: boolean } = { focus: true },
): Promise<void> {
  return engine.selectFromUI(`tooth-${fdi}`, opts);
}

/** PATCH 4. Frame a tooth without changing the selection. */
export function focusTooth(engine: Engine, fdi: number): void {
  engine.focus(`tooth-${fdi}`);
}

/* ========================================================================== */
/* PATCH 5 — per-mount isolation / reset between patients                      */
/* ========================================================================== */

/**
 * PATCH 5. The store is a module-level singleton, so state survives a remount
 * and would leak one patient's selection into the next. This is the explicit
 * reset the adapter calls between patients (and before disposing).
 */
export function resetEngine(engine: Engine): void {
  clearToothAppearance(engine);
  setState({
    selectedId: null,
    selectionRequest: null,
    hoveredId: null,
    isolateId: null,
    isolateContext: false,
  });
  engine.resetToStart();
}

/* ========================================================================== */
/* PATCH 6 — full dispose                                                      */
/* ========================================================================== */

function disposeMaterial(mat: THREE.Material): void {
  // Textures are not reachable through `mat.dispose()`, so release them first.
  for (const value of Object.values(mat)) {
    if (value && typeof value === 'object' && 'isTexture' in value) {
      (value as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}

/**
 * PATCH 6. Upstream `dispose()` stops the render loop and drops the renderer,
 * but never releases geometries, materials or textures — every mount leaks GPU
 * memory. Call this AFTER `engine.dispose()` (or through
 * `engine.dentoraDisposeResources()`), once per mount.
 */
export function disposeEngineResources(engine: Engine): {
  geometries: number;
  materials: number;
} {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  const collect = (obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => materials.add(x));
      else materials.add(m);
    }
  };

  for (const entry of engine.dentoraEntries().values()) collect(entry.mesh);
  // Anything added outside `entries` (helpers, outlines, section tool…).
  engine.dentoraScene()?.traverse(collect);

  for (const mat of materials) disposeMaterial(mat);
  for (const geo of geometries) geo.dispose();

  return { geometries: geometries.size, materials: materials.size };
}

/* ========================================================================== */
/* PATCH 7 — hide the engine's own chrome; no English text                     */
/* ========================================================================== */

export interface ChromeHandle {
  /** Put the engine's chrome back (used only by tests / debugging). */
  restore(): void;
}

/**
 * PATCH 7. `Engine.mount()` builds its own DOM inside the container:
 *   - `div.ds-overlay`  (the label layer)
 *   - `div#ds-hover-info.ds-tip`  (a hover tooltip fed by `formatTooth`,
 *     `nameOf` and `SINUS_NOTE` — i.e. ENGLISH text)
 * Our UI is Arabic-only, so both are hidden and the label layer is switched
 * off in the store. The React chrome (search, language flags) lives in
 * `main.tsx`, which we never render — so it cannot appear at all.
 */
export function hideEngineChrome(container: HTMLElement): ChromeHandle {
  const overlay = container.querySelector<HTMLElement>('.ds-overlay');
  const tip = container.querySelector<HTMLElement>('#ds-hover-info, .ds-tip');
  const before = {
    overlay: overlay?.style.display ?? '',
    tip: tip?.style.display ?? '',
    labels: getState().labels,
  };
  if (overlay) overlay.style.display = 'none';
  if (tip) tip.style.display = 'none';
  if (before.labels) setState({ labels: false });

  return {
    restore() {
      if (overlay) overlay.style.display = before.overlay;
      if (tip) tip.style.display = before.tip;
      setState({ labels: before.labels });
    },
  };
}

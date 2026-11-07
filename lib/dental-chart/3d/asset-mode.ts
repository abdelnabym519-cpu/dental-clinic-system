/**
 * P4 / S2 — 3D asset modes.
 *
 * DEFAULT IS `none`, and that is a LICENCE position, not a limitation.
 * The tooth meshes are **CC BY-SA 2.1 JP** (BodyParts3D / DBCLS) according to
 * upstream `CREDITS.md`, while the DBCLS site states **CC BY 4.0** (updated
 * 2025-02-27) for what is described as the same source. ShareAlike is treated
 * as binding here. So until the user records decision **D1**, the application
 * ships no third-party mesh and the 3D view uses the procedural fallback.
 *
 * Modes:
 *   none     (DEFAULT) no mesh on disk; ProceduralScene always.
 *   local    models in a gitignored dir, served by an AUTHENTICATED route.
 *   bundled  models shipped with the build — BLOCKED until D1 is recorded.
 */
export type AssetMode = 'none' | 'local' | 'bundled'

export const DEFAULT_ASSET_MODE: AssetMode = 'none'

export const ASSET_MODES: readonly AssetMode[] = ['none', 'local', 'bundled']

/** Where `node scripts/3d-assets/fetch.mjs` places the models. Gitignored. */
export const LOCAL_ASSET_DIR = '.local-assets/3d'

/** The D1 record that `bundled` requires. */
export const D1_DECISION_FILE = 'docs/legal/3D-ASSETS-DECISION.md'

/** Marker the D1 file must contain once the user has actually decided. */
export const D1_DECISION_MARKER = 'D1-DECISION-RECORDED'

/**
 * Never fetched and never loaded, in ANY mode: it carries its own separate
 * CC BY-SA 4.0 (Z-Anatomy) terms and is not needed for the chart.
 */
export const FORBIDDEN_ASSETS: readonly string[] = ['neurovascular.glb']

export class BundledAssetsBlockedError extends Error {
  constructor() {
    super(
      `ASSET_MODE=bundled is blocked: ${D1_DECISION_FILE} is missing or does not ` +
        `contain the marker ${D1_DECISION_MARKER}. Distributing the CC BY-SA 2.1 JP ` +
        `tooth meshes is the user's legal decision (D1), not a build flag. ` +
        `Use ASSET_MODE=none (default) or ASSET_MODE=local.`,
    )
    this.name = 'BundledAssetsBlockedError'
  }
}

/**
 * Unknown or missing values fall back to the DEFAULT, never to a mode that
 * loads third-party meshes.
 */
export function parseAssetMode(raw: string | undefined): AssetMode {
  const value = (raw ?? '').trim().toLowerCase()
  return (ASSET_MODES as readonly string[]).includes(value) ? (value as AssetMode) : DEFAULT_ASSET_MODE
}

export interface AssetModeContext {
  decisionFileExists: boolean
  decisionFileContent?: string
}

/** Resolve the effective mode, throwing when `bundled` is not yet legal. */
export function resolveAssetMode(
  env: Record<string, string | undefined> = process.env,
  ctx?: AssetModeContext,
): AssetMode {
  const mode = parseAssetMode(env.ASSET_MODE)
  if (mode === 'bundled') {
    const recorded =
      ctx?.decisionFileExists === true &&
      (ctx.decisionFileContent ?? '').includes(D1_DECISION_MARKER)
    if (!recorded) throw new BundledAssetsBlockedError()
  }
  return mode
}

export function assetsEnabled(mode: AssetMode): boolean {
  return mode !== 'none'
}

/**
 * Guard for the asset route and the loader: a forbidden file is refused even
 * if it is somehow present on disk.
 */
export function isForbiddenAsset(pathOrName: string): boolean {
  const name = pathOrName.split(/[\\/]/).pop() ?? pathOrName
  return FORBIDDEN_ASSETS.includes(name)
}

/**
 * PATCH 8 (Dentora) — `ImportMetaEnv` augmentation needed by the vendored
 * dental-scope tree.
 *
 * WHY IT LIVES HERE AND NOT IN THE VENDOR TREE
 * The root `tsconfig.json` sets `exclude: ["vendor"]`, so the engine's own
 * `src/vite-env.d.ts` is NOT part of the app's type program. But
 * `vendor/.../src/app/router.ts` IS pulled in transitively (our
 * `lib/dental-chart/3d/scope-scene.ts` imports `Engine`, which imports the
 * router). So the file that needs the declaration is checked, while the file
 * that would supply it is excluded — hence TS2339 on `VITE_DS_URL`.
 *
 * `ImportMetaEnv` is a global interface, so declaring it in ANY included
 * declaration file merges into the same type. This file is included by the
 * root program, so the merge lands where it is needed.
 *
 * Declaration only: no behaviour change, and we never set these variables —
 * we do not use the engine's router or its repo links.
 */
interface ImportMetaEnv {
  /** Read by vendor `src/app/router.ts:34`; unset means "no external URL". */
  VITE_DS_URL?: string;
  /** Read by vendor `src/app/repo.ts`; unset means "don't link". */
  VITE_DS_REPO_URL?: string;
}

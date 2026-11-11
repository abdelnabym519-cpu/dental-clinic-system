/**
 * Build-time environment variables. vite declares `ImportMetaEnv` with a
 * string index signature, so unknown keys are `any`; declaring the keys we
 * read keeps `import.meta.env.*` accesses typed.
 */
interface ImportMetaEnv {
  /** Public repository URL; unset means "don't link" (see `app/repo.ts`). */
  VITE_DS_REPO_URL?: string;
  /**
   * PATCH 8 (Dentora): upstream `app/router.ts:34` READS `import.meta.env
   * .VITE_DS_URL` but never declared it, so any program that type-checks this
   * shim reports TS2339. Declaration only — no behaviour change, and we never
   * set the variable (we do not use the engine's router).
   */
  VITE_DS_URL?: string;
}

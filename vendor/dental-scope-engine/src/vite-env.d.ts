/**
 * Build-time environment variables. vite declares `ImportMetaEnv` with a
 * string index signature, so unknown keys are `any`; declaring the keys we
 * read keeps `import.meta.env.*` accesses typed.
 */
interface ImportMetaEnv {
  /** Public repository URL; unset means "don't link" (see `app/repo.ts`). */
  VITE_DS_REPO_URL?: string;
}

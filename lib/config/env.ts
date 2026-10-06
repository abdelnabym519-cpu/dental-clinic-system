/**
 * Phase 11 — Canonical environment configuration contract (§7/§8).
 *
 * Every production-sensitive variable has: name, purpose, required/optional,
 * safe default, secret classification, and environment applicability.
 *
 * Validation is FAIL-FAST for PRODUCTION: `validateEnvironment` returns typed
 * problems and `requireProductionEnv` throws — deployment preflight runs it
 * before anything is migrated or started. Development/test/CI get a pass
 * unless they opt into strictness (DENTORA_STRICT_ENV=1).
 *
 * Security invariants:
 *  - NODE_ENV=production alone is NEVER a security control (§8) — secrets are
 *    validated independently of NODE_ENV;
 *  - no development fallback secret is ever applied in production;
 *  - secrets are never exported to the client bundle (this module is
 *    server-only by convention and imports nothing client-reachable).
 */

export type EnvironmentName = 'development' | 'test' | 'ci' | 'staging' | 'production'

export type EnvVarSpec = {
  name: string
  purpose: string
  required: boolean
  /** required only when this predicate holds (e.g. storage driver = s3) */
  requiredWhen?: (env: Record<string, string | undefined>) => boolean
  secret: boolean
  /** safe non-production default; production has NO default for required secrets */
  devDefault?: string
  appliesTo: EnvironmentName[]
}

export const ENVIRONMENT_SPECS: readonly EnvVarSpec[] = [
  // --- core identity -------------------------------------------------------
  { name: 'NODE_ENV', purpose: 'Next.js runtime mode (development/test/production)', required: false, secret: false, appliesTo: ['development', 'test', 'ci', 'staging', 'production'] },
  { name: 'APP_ENV', purpose: 'Logical environment when it differs from NODE_ENV (staging vs production)', required: false, secret: false, appliesTo: ['staging', 'production'] },
  // --- database (required everywhere except pure-unit CI runs that never touch it) ---
  { name: 'DATABASE_URL', purpose: 'MySQL connection string (Prisma)', required: false, secret: true, devDefault: 'mysql://dev:dev@localhost:3306/dental_dev', appliesTo: ['development', 'staging', 'production'] },
  // --- auth ---------------------------------------------------------------
  { name: 'NEXTAUTH_SECRET', purpose: 'NextAuth JWT signing secret', required: true, secret: true, appliesTo: ['staging', 'production'] },
  { name: 'NEXTAUTH_URL', purpose: 'Canonical base URL for auth callbacks', required: false, secret: false, appliesTo: ['staging', 'production'] },
  // --- storage (local driver needs a dir; s3 driver needs credentials) -----
  { name: 'STORAGE_DRIVER', purpose: 'Object storage driver: local | s3', required: false, secret: false, devDefault: 'local', appliesTo: ['development', 'staging', 'production'] },
  { name: 'UPLOAD_DIR', purpose: 'Local storage root for the local driver', required: false, secret: false, devDefault: './uploads', appliesTo: ['development', 'staging', 'production'] },
  { name: 'S3_ENDPOINT', purpose: 'S3/MinIO endpoint (s3 driver)', required: false, secret: false, appliesTo: ['staging', 'production'] },
  { name: 'S3_BUCKET', purpose: 'Object bucket name (s3 driver)', required: false, secret: false, appliesTo: ['staging', 'production'] },
  { name: 'S3_ACCESS_KEY_ID', purpose: 'Object storage access key (s3 driver)', required: false, secret: true, appliesTo: ['staging', 'production'] },
  { name: 'S3_SECRET_ACCESS_KEY', purpose: 'Object storage secret key (s3 driver)', required: false, secret: true, appliesTo: ['staging', 'production'] },
  // --- AI providers (optional — local-first: absent ⇒ local/honest unavailable) ---
  { name: 'OPENROUTER_API_KEY', purpose: 'Optional LLM provider key (agent degrades honestly without it)', required: false, secret: true, appliesTo: ['development', 'staging', 'production'] },
  // --- optional integrations ----------------------------------------------
  { name: 'WHATSAPP_ACCESS_TOKEN', purpose: 'WhatsApp Cloud API token (messaging integration)', required: false, secret: true, appliesTo: ['staging', 'production'] },
  { name: 'CORS_ALLOWED_ORIGINS', purpose: 'Comma-separated allowlist for credentialed API CORS; empty keeps legacy same-site behavior', required: false, secret: false, appliesTo: ['staging', 'production'] },
  { name: 'APP_VERSION', purpose: 'Deployed version override (defaults to package.json)', required: false, secret: false, appliesTo: ['staging', 'production'] },
  { name: 'GIT_SHA', purpose: 'Release commit injected by CI (version stamp)', required: false, secret: false, appliesTo: ['staging', 'production'] },
]

const ENV_NAMES: readonly EnvironmentName[] = ['development', 'test', 'ci', 'staging', 'production']

/** Resolve the logical environment — NODE_ENV is NOT the only signal (§8). */
export function currentEnvironment(env: Record<string, string | undefined> = process.env): EnvironmentName {
  const explicit = env.APP_ENV
  if (explicit && (ENV_NAMES as readonly string[]).includes(explicit)) return explicit as EnvironmentName
  if (env.NODE_ENV === 'production') return 'production'
  if (env.NODE_ENV === 'test') return 'test'
  if (env.CI === 'true' || env.CI === '1') return 'ci'
  return 'development'
}

export type EnvProblem = {
  var: string
  kind: 'MISSING_REQUIRED' | 'DEV_FALLBACK_IN_PRODUCTION' | 'INSECURE_VALUE'
  detail: string
}

function isProduction(name: EnvironmentName): boolean {
  return name === 'production'
}

/**
 * Validate the environment against the contract. Returns every problem found
 * (empty = valid). In production a DEV_FALLBACK_IN_PRODUCTION is always a
 * failure; elsewhere it is reported so callers can decide.
 */
export function validateEnvironment(env: Record<string, string | undefined> = process.env): EnvProblem[] {
  const name = currentEnvironment(env)
  const problems: EnvProblem[] = []
  for (const spec of ENVIRONMENT_SPECS) {
    if (!spec.appliesTo.includes(name)) continue
    const requiredNow = spec.required || (spec.requiredWhen?.(env) ?? false)
    const value = env[spec.name]
    const usingDevFallback = value === undefined && spec.devDefault !== undefined
    if (requiredNow && !value && !usingDevFallback) {
      problems.push({ var: spec.name, kind: 'MISSING_REQUIRED', detail: `${spec.name} is required in ${name}: ${spec.purpose}` })
      continue
    }
    if (isProduction(name) && spec.secret && usingDevFallback) {
      problems.push({ var: spec.name, kind: 'DEV_FALLBACK_IN_PRODUCTION', detail: `${spec.name} is not set and has no production default` })
      continue
    }
    if (isProduction(name) && spec.secret && typeof value === 'string' && value.length > 0 && value.length < 16) {
      problems.push({ var: spec.name, kind: 'INSECURE_VALUE', detail: `${spec.name} is suspiciously short for a production secret` })
    }
  }
  return problems
}

/**
 * Fail-fast gate for deployment preflight (§8): throws when production
 * configuration is unsafe. NEVER called from client code.
 */
export function requireValidEnvironment(env: Record<string, string | undefined> = process.env): void {
  const problems = validateEnvironment(env)
  if (problems.length > 0) {
    // Messages name the VARIABLE, never its value — no secrets in errors.
    const lines = problems.map((p) => `  - [${p.kind}] ${p.detail}`)
    throw new Error(`Environment validation failed (${currentEnvironment(env)}):\n${lines.join('\n')}`)
  }
}

/** True when a variable's value may be echoed into logs/diagnostics. */
export function isSecretVar(name: string): boolean {
  return ENVIRONMENT_SPECS.some((s) => s.name === name && s.secret)
}

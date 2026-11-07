/**
 * SINGLE SOURCE OF TRUTH for storage environment variables.
 *
 * Why this module exists — the imaging `NoSuchKey` bug:
 * the imaging pipeline has TWO independent readers of the same objects.
 *
 *   1. the Next.js app, through `lib/storage` (`getStorage()`), and
 *   2. the FastAPI orchestrator, which reads MinIO/S3 directly.
 *
 * They silently disagreed. `STORAGE_DRIVER` defaults to `local`, so the app
 * wrote an imaging original to local disk and then handed the object key to
 * the orchestrator, which looked for it in MinIO and failed with a raw
 * `NoSuchKey`. Neither side could see the other's configuration, because the
 * variable names were never declared anywhere both could read.
 *
 * This module therefore names every storage variable exactly once, states
 * which driver the orchestrator can actually read, and is imported by BOTH:
 *   - the runtime factory (`lib/storage/index.ts`), and
 *   - the dev bootstrap (`scripts/lib/setup-dev.ts`), which now guarantees
 *     the names exist in `.env` so the two sides cannot drift apart again.
 *
 * No secret is ever logged or returned by anything here.
 */

export const STORAGE_ENV_KEYS = [
  'STORAGE_DRIVER',
  'UPLOAD_DIR',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'S3_FORCE_PATH_STYLE',
] as const

export type StorageEnvKey = (typeof STORAGE_ENV_KEYS)[number]

export const STORAGE_DRIVER_NAMES = ['local', 's3'] as const
export type StorageDriverName = (typeof STORAGE_DRIVER_NAMES)[number]

/**
 * Development defaults, deliberately identical to the values documented in the
 * commented S3 block of `.env.example` and to `docker-compose.dev.yml`.
 *
 * `.env.example` keeps that block COMMENTED on purpose: switching to object
 * storage must stay an explicit one-line decision (`STORAGE_DRIVER=s3`). What
 * the bootstrap guarantees is only that the NAMES are present and consistent,
 * which is exactly what was missing when the two readers disagreed.
 *
 * These are the local MinIO development credentials already published in this
 * repository. Real deployments override them in `.env`, never here.
 */
export const STORAGE_ENV_DEFAULTS: Record<StorageEnvKey, string> = {
  STORAGE_DRIVER: 'local',
  UPLOAD_DIR: './uploads',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'dentalerp',
  S3_SECRET_KEY: 'dentalerp123',
  S3_BUCKET: 'dental-erp-uploads',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
}

type Env = Record<string, string | undefined>

export function isValidStorageDriver(value: unknown): value is StorageDriverName {
  return typeof value === 'string' && (STORAGE_DRIVER_NAMES as readonly string[]).includes(value)
}

/**
 * The driver this process would use. Empty/unset/whitespace means `local`,
 * matching the long-standing default of `createStorage()` — a single clinic on
 * one small VPS must never be forced to run object storage.
 */
export function readStorageDriver(env: Env = process.env): StorageDriverName {
  const raw = (env.STORAGE_DRIVER ?? '').trim().toLowerCase()
  return raw === 's3' ? 's3' : 'local'
}

/**
 * The orchestrator reads object storage directly. It has no access to the
 * app's local disk, so anything written through the `local` driver is
 * invisible to it — that is the whole `NoSuchKey` failure mode.
 */
export function orchestratorCanReadDriver(driver: StorageDriverName): boolean {
  return driver === 's3'
}

/**
 * Whether the orchestrator side is wired up at all. `ORCHESTRATOR_SECRET` is
 * the gate: `lib/ai/engines/orchestrator-source.ts` throws without it and
 * `ai-compose.yml` fail-fasts on it (`${ORCHESTRATOR_SECRET:?}`).
 */
export function isOrchestratorConfigured(env: Env = process.env): boolean {
  return (env.ORCHESTRATOR_SECRET ?? '').trim() !== ''
}

/** Storage variables that are absent or blank in the given environment. */
export function missingStorageEnvKeys(env: Env = process.env): StorageEnvKey[] {
  return STORAGE_ENV_KEYS.filter((key) => (env[key] ?? '').trim() === '')
}

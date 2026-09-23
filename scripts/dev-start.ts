/**
 * Safe development startup for DenToRa.
 *
 *     npm run dev:start                  services -> database -> app
 *     npm run dev:start -- --db-only     services -> database, without starting the app
 *
 * Steps:
 *   1. Sanity check: .env exists (or DATABASE_URL is already in the environment).
 *   2. `docker compose -f docker-compose.dev.yml up -d mysql redis` — only the
 *      core services the application requires (MySQL, Redis; see
 *      CORE_SERVICES). Idempotent: running containers are reused, stopped
 *      ones are started, images are pulled when missing. The optional
 *      MinIO / createbuckets / Mailpit services stay available in the compose
 *      file for manual/future use but are intentionally NOT started here, so
 *      a broken optional image can never block core startup.
 *   3. Wait until MySQL is ACTUALLY ready — a real `SELECT 1` through the
 *      generated Prisma client, polled at a fixed interval until it succeeds
 *      or a timeout is hit. No fixed sleeps, no trust in "the container is up".
 *   4. `npx prisma migrate deploy` — applies pending migrations only; a safe
 *      no-op when the database is already in sync.
 *   5. Seed decision (scripts/seed-check.ts):
 *        - seeded admin user present -> SKIP. The database is not written to.
 *        - absent                    -> `npx prisma db seed`, exactly once.
 *   6. `npm run dev` (unless --db-only).
 *
 * Invariant: this workflow NEVER calls `prisma migrate reset --force` (or any
 * other destructive operation). That command drops and recreates the named
 * volume `dental-erp-dev_mysql-data`, deleting every patient, appointment,
 * invoice and so on stored in it. A laptop or container restart needs none of
 * that — the volume keeps the data, `migrate deploy` keeps the schema current,
 * and the seed only ever runs against a database that has never been
 * initialized.
 *
 * Failure policy: the first failing step aborts the startup with a non-zero
 * exit code and a message. The application is never started on a database
 * that failed to initialize, and nothing reports success it did not earn.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { isDatabaseSeeded, type SeedCheckClient } from './seed-check'

export const COMPOSE_FILE = 'docker-compose.dev.yml'

/**
 * The backing services the application actually requires at startup.
 *
 * docker-compose.dev.yml declares more services than this, on purpose:
 * `minio` (S3-compatible storage for a future phase), `createbuckets`
 * (a one-shot `minio/mc` container that initialises the bucket) and
 * `mailpit` (optional SMTP catcher). None of them is required for the
 * database startup path — and an optional service pulling a broken image
 * (e.g. `minio/mc:latest`) must never be able to block core startup.
 * The compose file's only `depends_on` edge is createbuckets -> minio, so
 * scoping `up -d` to these two names starts exactly these two services.
 */
export const CORE_SERVICES = ['mysql', 'redis']

/** 3 minutes: a cold image pull plus first-time volume init can exceed less.
 * The timeout exists so a broken setup fails instead of hanging forever. */
export const DEFAULT_READINESS_TIMEOUT_MS = 180_000
export const DEFAULT_READINESS_INTERVAL_MS = 2_000

export class StartupError extends Error {}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Pipe and capture stdout/stderr instead of streaming them to the terminal. */
  capture?: boolean
  cwd?: string
}

export type RunCommand = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>

/**
 * What the startup needs from the database. Structurally typed (see
 * lib/prisma.ts) so this module never imports the generated client.
 */
export interface DevStartPrisma extends SeedCheckClient {
  $queryRawUnsafe(query: string): Promise<unknown>
  $disconnect(): Promise<void>
}

export interface DevStartDeps {
  runCommand: RunCommand
  /**
   * Construct the app's own Prisma client (the generated one — NOT the
   * null-returning fallback from lib/prisma.ts, which would make the
   * readiness probe and the seed decision meaningless).
   */
  createPrisma: () => Promise<DevStartPrisma>
  sleep: (ms: number) => Promise<void>
}

export interface DevStartOptions {
  /** Project root. Defaults to process.cwd(). */
  root?: string
  composeFile?: string
  /** Stop after the database steps; do not start the Next.js server. */
  dbOnly?: boolean
  readinessTimeoutMs?: number
  readinessIntervalMs?: number
}

export interface DevStartOutcome {
  /** True on success: the database is migrated and (already or now) seeded. */
  initialized: boolean
  /** True when this run executed the seed. */
  seededNow: boolean
}

function log(message: string) {
  console.log(`[dentora] ${message}`)
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The full safe-startup sequence. Throws StartupError on any failure; a
 * resolved value means every step before it succeeded.
 */
export async function runSafeStartup(
  deps: DevStartDeps,
  opts: DevStartOptions = {}
): Promise<DevStartOutcome> {
  const root = path.resolve(opts.root ?? process.cwd())
  const composeFile = opts.composeFile ?? COMPOSE_FILE
  const timeoutMs = opts.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS
  const intervalMs = opts.readinessIntervalMs ?? DEFAULT_READINESS_INTERVAL_MS

  log('Safe development startup (no reset, no data loss)')

  // 1. Environment sanity — fail fast, before touching Docker.
  const envFile = path.join(root, '.env')
  if (!existsSync(envFile) && !process.env.DATABASE_URL) {
    throw new StartupError(
      [
        'No .env file and no DATABASE_URL in the environment.',
        '  Create one first:',
        '    cp .env.example .env',
        '  then set DATABASE_URL to match docker-compose.dev.yml:',
        '    DATABASE_URL="mysql://root:dental@localhost:3306/dental_erp"',
        '  and fill in NEXTAUTH_SECRET, ENCRYPTION_KEY and CRON_SECRET (see .env.example).',
      ].join('\n')
    )
  }

  if (!existsSync(path.join(root, composeFile))) {
    throw new StartupError(`Compose file not found: ${composeFile} (looked in ${root}).`)
  }

  // 2. Core backing services only. MinIO / createbuckets / Mailpit are
  //    optional development infrastructure (see CORE_SERVICES) and are
  //    deliberately NOT started here, so a broken optional image cannot
  //    block the database startup path.
  const compose = await resolveCompose(deps.runCommand)
  log(`Starting core backing services (${CORE_SERVICES.join(', ')})...`)
  const up = await deps.runCommand(
    compose[0],
    [...compose.slice(1), '-f', composeFile, 'up', '-d', ...CORE_SERVICES],
    {
      cwd: root,
    }
  )
  if (up.code !== 0) {
    throw new StartupError(
      [
        `docker compose up failed (exit ${up.code}).`,
        '  Is the Docker engine running (Docker Desktop / systemd service)?',
        '  Common cause: port 3306 or 6379 is already taken by another server.',
      ].join('\n')
    )
  }

  let seededNow = false
  const prisma = await deps.createPrisma()
  try {
    // 3. Readiness — verified with the app's own runtime, not with a sleep.
    await waitForMysqlReady(deps, prisma, composeFile, timeoutMs, intervalMs)
    log('MySQL is ready (a live SELECT 1 succeeded through Prisma).')

    // 4. Migrations — apply what is pending; a no-op when already in sync.
    log('Applying pending migrations (prisma migrate deploy)...')
    const migrate = await deps.runCommand('npx', ['prisma', 'migrate', 'deploy'], { cwd: root })
    if (migrate.code !== 0) {
      throw new StartupError(
        [
          `prisma migrate deploy failed (exit ${migrate.code}) — see output above.`,
          '  Startup aborted before any seeding or application start.',
          '  This workflow never resets the database — fix the migration',
          '  problem it reported and re-run the same command.',
        ].join('\n')
      )
    }

    // 5. Seed decision — deterministic (scripts/seed-check.ts).
    const seeded = await isDatabaseSeeded(prisma)
    if (seeded) {
      log('Database already initialized — skipping seed. Existing records are preserved.')
    } else {
      log('Database has never been seeded — running the development seed once...')
      const seed = await deps.runCommand('npx', ['prisma', 'db', 'seed'], { cwd: root })
      if (seed.code !== 0) {
        throw new StartupError(
          [
            `Seed failed (exit ${seed.code}) — see output above.`,
            '  The application will NOT start against a database that failed to seed.',
            '  The seed is upsert-based: once the error is fixed, re-running',
            '  `npm run dev:start` does not duplicate records.',
          ].join('\n')
        )
      }
      seededNow = true
      log('Seed completed.')
    }
  } finally {
    await prisma.$disconnect()
  }

  // 6. Application.
  if (opts.dbOnly) {
    log('Database is ready (--db-only). No application server started.')
    return { initialized: true, seededNow }
  }

  log('Starting the Next.js development server (npm run dev)...')
  const dev = await deps.runCommand('npm', ['run', 'dev'], { cwd: root })
  if (dev.code !== 0) {
    throw new StartupError(`next dev exited with code ${dev.code}.`)
  }
  return { initialized: true, seededNow }
}

async function waitForMysqlReady(
  deps: DevStartDeps,
  prisma: DevStartPrisma,
  composeFile: string,
  timeoutMs: number,
  intervalMs: number
) {
  log('Waiting for MySQL to accept connections...')
  await waitForDatabaseReady(prisma, deps.sleep, {
    timeoutMs,
    intervalMs,
    composeFile,
    log,
  })
  log('MySQL is ready (a live SELECT 1 succeeded through Prisma).')
}

/**
 * The client surface the readiness probe needs (a full Prisma client
 * satisfies it structurally).
 */
export interface DatabaseReadyProbe {
  $queryRawUnsafe(query: string): Promise<unknown>
}

export interface ReadyWaitOptions {
  timeoutMs: number
  intervalMs: number
  /** Named in the error message for `docker compose ... ps` / `logs` hints. */
  composeFile: string
  /** Receives the bounded wait's progress lines (attempt count + time left). */
  log?: (message: string) => void
}

/**
 * Bounded, observable readiness probe — the ONLY "is the database usable"
 * check in the startup/verification flow: poll a live `SELECT 1` through the
 * given client until it succeeds or `timeoutMs` is exhausted.
 *
 * `runSafeStartup` uses it right after the containers start;
 * `scripts/verify-persistence.ts` uses it with its own FRESH client after a
 * full stop/start cycle (a client whose engine was connected to the stopped
 * container cannot be trusted to reconnect — see that script's header).
 *
 * No fixed sleeps: every attempt is a real query, the wait is bounded
 * (a broken setup fails instead of hanging forever), and the last error is
 * reported with compose diagnostics.
 */
export async function waitForDatabaseReady(
  prisma: DatabaseReadyProbe,
  sleep: (ms: number) => Promise<void>,
  opts: ReadyWaitOptions
): Promise<void> {
  const logLine = opts.log ?? (() => {})
  const deadline = Date.now() + opts.timeoutMs
  let lastError = ''
  for (let attempt = 1; ; attempt++) {
    try {
      // Same client and same DATABASE_URL the application uses — if this
      // query succeeds, the application can reach its database.
      await prisma.$queryRawUnsafe('SELECT 1')
      return
    } catch (err) {
      lastError = errorOf(err)
      if (Date.now() >= deadline) break
      if (attempt === 1 || attempt % 15 === 0) {
        const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000))
        logLine(`  still waiting (${attempt} attempts, ~${secondsLeft}s left)...`)
      }
      await sleep(opts.intervalMs)
    }
  }
  throw new StartupError(
    [
      `MySQL did not become ready within ${Math.round(opts.timeoutMs / 1000)}s.`,
      `  Last error: ${lastError}`,
      '  Diagnostics:',
      `    docker compose -f ${opts.composeFile} ps`,
      `    docker compose -f ${opts.composeFile} logs mysql`,
      '  Common causes: the Docker engine just started and is still',
      '  initializing a fresh volume (re-run the same command); port 3306 is',
      '  taken by a different MySQL server; wrong DATABASE_URL in .env.',
    ].join('\n')
  )
}

/**
 * Compose v2 is a `docker` subcommand; v1 was a standalone binary.
 * Exported so scripts/verify-persistence.ts can stop the stack with the same
 * command form it would use to start it.
 */
export async function resolveCompose(runCommand: RunCommand): Promise<string[]> {
  const canRun = async (cmd: string, args: string[]) => {
    try {
      const result = await runCommand(cmd, args, { capture: true })
      return result.code === 0
    } catch {
      return false
    }
  }
  if (await canRun('docker', ['compose', 'version'])) return ['docker', 'compose']
  if (await canRun('docker-compose', ['version'])) return ['docker-compose']
  throw new StartupError(
    [
      'Docker Compose not found (tried "docker compose" and "docker-compose").',
      '  Install Docker (with the Compose plugin) and make sure the engine is running.',
    ].join('\n')
  )
}

function defaultRun(cmd: string, args: string[], opts?: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, {
        cwd: opts?.cwd,
        // On Windows `npm`/`npx` are .cmd shims that only start through a
        // shell. The arguments here never contain shell metacharacters, so
        // shelling out on win32 only is safe; POSIX keeps a true exec.
        shell: process.platform === 'win32',
        stdio: opts?.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      })
    } catch (err) {
      reject(new Error(`Could not start "${cmd} ${args.join(' ')}": ${errorOf(err)}`))
      return
    }

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === 'ENOENT' ? ` The command "${cmd}" was not found on this machine.` : ''
      reject(new Error(`Could not start "${cmd}": ${err.message}.${hint}`))
    })
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

type PrismaClientModule = {
  PrismaClient?: new (options?: Record<string, unknown>) => DevStartPrisma
}

async function createAppPrismaClient(): Promise<DevStartPrisma> {
  let mod: PrismaClientModule
  try {
    mod = (await import('@prisma/client')) as PrismaClientModule
  } catch {
    throw new StartupError(
      [
        'The generated Prisma client could not be loaded.',
        '  Run "npm install" (or "npx prisma generate") and try again.',
      ].join('\n')
    )
  }
  if (!mod.PrismaClient) {
    throw new StartupError(
      ['The loaded @prisma/client module has no PrismaClient — run "npx prisma generate".'].join(
        '\n'
      )
    )
  }
  try {
    return new mod.PrismaClient()
  } catch (err) {
    throw new StartupError(
      [
        'The generated Prisma client could not be constructed.',
        `  ${errorOf(err)}`,
        '  Run "npx prisma generate" and try again.',
      ].join('\n')
    )
  }
}

/**
 * The real set of dependencies (child processes, generated Prisma client).
 * Exported so scripts/verify-persistence.ts can drive the very same startup
 * path that `npm run dev:start` uses.
 */
export function defaultDeps(): DevStartDeps {
  return {
    runCommand: defaultRun,
    createPrisma: createAppPrismaClient,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
}

async function main(): Promise<void> {
  const dbOnly = process.argv.slice(2).includes('--db-only')
  await runSafeStartup(defaultDeps(), { dbOnly })
  log('Startup complete.')
}

// The orchestrator is importable for unit tests; only run the CLI when this
// file is the entry point (npx tsx scripts/dev-start.ts).
const entryPoint = process.argv[1]
if (entryPoint !== undefined && path.resolve(entryPoint) === path.resolve(__filename)) {
  main().catch((err) => {
    const message = err instanceof StartupError ? err.message : errorOf(err)
    console.error('')
    console.error(`[dentora] Startup FAILED: ${message}`)
    console.error(
      '[dentora] Nothing was reset or deleted — this workflow never destroys the database.'
    )
    process.exitCode = 1
  })
}

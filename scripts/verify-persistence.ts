/**
 * Practical proof of the central invariant of the safe development startup:
 *
 *     existing data BEFORE restart  ==  existing data AFTER restart
 *
 *     npm run verify:persistence                 snapshot + sentinel, no restart
 *     npm run verify:persistence -- --restart    full cycle:
 *         snapshot -> sentinel -> docker compose down (stop, keep data)
 *         -> the REAL safe startup (services -> readiness -> migrate deploy
 *            -> seed decision) -> re-verify
 *
 * Prisma client lifecycle — the subtle part, learned from a real failure:
 *   The BEFORE phase uses one Prisma client, explicitly DISCONNECTED before
 *   the stack is stopped, so no query engine keeps a connection into a dead
 *   container. The AFTER phase uses a FRESH client created only after the
 *   restart completed, and it is gated by a bounded live-query readiness
 *   wait (the same `waitForDatabaseReady` primitive dev-start uses).
 *
 *   Why: a client whose engine was connected to the stopped MySQL container
 *   cannot be trusted to reconnect after the container is replaced. The old
 *   verifier took its AFTER snapshot with the pre-restart client and died
 *   with "Can't reach database server at localhost:3306" even though the
 *   startup's own fresh client had, seconds earlier, queried the very same
 *   restarted database successfully. The database was fine; the stale client
 *   was not. So the stale client is never reused — no retry can hide or
 *   fix that, and no arbitrary sleep is added.
 *
 * What it does:
 *   - snapshots the row counts of the key tables (users, hospitals, patients,
 *     appointments, invoices) and checks that the seeded admin account
 *     (admin@dentora-dental.com) is present;
 *   - ensures one identifiable, harmless sentinel patient exists
 *     (upsert — created at most once, never touched afterwards);
 *   - with --restart: stops the stack (volumes preserved), runs exactly the
 *     same startup code path as `npm run dev:start` (scripts/dev-start.ts),
 *     then re-checks with a fresh client.
 *
 * Result: PASS only if no table lost rows, the sentinel and the seeded admin
 * survived, and the startup did not re-run the seed on a populated database.
 * Any regression exits non-zero. Nothing is ever deleted.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  COMPOSE_FILE,
  DEFAULT_READINESS_INTERVAL_MS,
  DEFAULT_READINESS_TIMEOUT_MS,
  StartupError,
  defaultDeps,
  resolveCompose,
  runSafeStartup,
  waitForDatabaseReady,
  type DevStartDeps,
} from './dev-start'
import { isDatabaseSeeded, SEEDED_ADMIN_EMAIL } from './seed-check'

export const SENTINEL_PATIENT_ID = 'PERS-SENTINEL-0001'

export interface Snapshot {
  users: number
  hospitals: number
  patients: number
  appointments: number
  invoices: number
  seededAdminPresent: boolean
  sentinelPresent: boolean
  seeded: boolean
}

export class PersistenceVerificationError extends Error {}

export interface VerifyOptions {
  /** Project root. Defaults to process.cwd(). */
  root?: string
  /** Perform the stop/start cycle through the real safe startup. */
  restart: boolean
  /** Bounded live-query readiness wait (startup probe and post-start probe). */
  readinessTimeoutMs?: number
  readinessIntervalMs?: number
}

export interface VerificationResult {
  before: Snapshot
  after: Snapshot
  /** What the real startup reported (--restart mode only). */
  startup?: { initialized: boolean; seededNow: boolean }
}

/**
 * Structural view of the generated client (same convention as lib/prisma.ts).
 * `user.findUnique` is wide enough that this type satisfies
 * SeedCheckClient, so isDatabaseSeeded() can be called without a cast.
 */
interface VerifyPrisma {
  user: {
    count(): Promise<number>
    findUnique(args: {
      where: { email: string }
      select?: { id?: true; hospitalId?: true }
    }): Promise<{ id: string; hospitalId: string } | null>
  }
  hospital: { count(): Promise<number> }
  patient: {
    count(): Promise<number>
    findUnique(args: {
      where: { hospitalId_patientId: { hospitalId: string; patientId: string } }
    }): Promise<{ id: string } | null>
    upsert(args: {
      where: { hospitalId_patientId: { hospitalId: string; patientId: string } }
      update: Record<string, never>
      create: Record<string, unknown>
    }): Promise<unknown>
  }
  appointment: { count(): Promise<number> }
  invoice: { count(): Promise<number> }
  $queryRawUnsafe(query: string): Promise<unknown>
  $disconnect(): Promise<void>
}

async function takeSnapshot(prisma: VerifyPrisma): Promise<Snapshot> {
  const [users, hospitals, patients, appointments, invoices] = await Promise.all([
    prisma.user.count(),
    prisma.hospital.count(),
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.invoice.count(),
  ])
  const admin = await prisma.user.findUnique({
    where: { email: SEEDED_ADMIN_EMAIL },
    select: { id: true, hospitalId: true },
  })
  const sentinel = admin
    ? await prisma.patient.findUnique({
        where: {
          hospitalId_patientId: { hospitalId: admin.hospitalId, patientId: SENTINEL_PATIENT_ID },
        },
      })
    : null
  return {
    users,
    hospitals,
    patients,
    appointments,
    invoices,
    seededAdminPresent: admin !== null,
    sentinelPresent: sentinel !== null,
    seeded: await isDatabaseSeeded(prisma),
  }
}

/** Creates the sentinel patient exactly once; returns the demo hospital id. */
async function ensureSentinel(prisma: VerifyPrisma): Promise<string> {
  const admin = await prisma.user.findUnique({
    where: { email: SEEDED_ADMIN_EMAIL },
    select: { id: true, hospitalId: true },
  })
  if (!admin) {
    throw new PersistenceVerificationError(
      'The seeded admin account is missing — this database has never been ' +
        'initialized. Run `npm run dev:start` once first, then re-run this check.'
    )
  }
  await prisma.patient.upsert({
    where: {
      hospitalId_patientId: { hospitalId: admin.hospitalId, patientId: SENTINEL_PATIENT_ID },
    },
    update: {},
    create: {
      hospitalId: admin.hospitalId,
      patientId: SENTINEL_PATIENT_ID,
      firstName: 'Persistence',
      lastName: 'Sentinel',
      phone: '01000000000',
      city: 'القاهرة',
    },
  })
  return admin.hospitalId
}

function printSnapshot(label: string, s: Snapshot) {
  console.log(`[verify] ${label}`)
  console.log(`[verify]   users=${s.users} hospitals=${s.hospitals} patients=${s.patients}`)
  console.log(`[verify]   appointments=${s.appointments} invoices=${s.invoices}`)
  console.log(`[verify]   seeded admin: ${s.seededAdminPresent ? 'present' : 'MISSING'}`)
  console.log(`[verify]   sentinel patient: ${s.sentinelPresent ? 'present' : 'missing'}`)
  console.log(
    `[verify]   seed decision: ${s.seeded ? 'initialized (seed will be skipped)' : 'uninitialized'}`
  )
}

/**
 * The full verification flow. Throws PersistenceVerificationError on any
 * failure; a resolved value means every invariant held. Never calls
 * process.exit (the CLI wrapper does), and never touches the database
 * destructively: the only write it performs is the one-time sentinel upsert.
 */
export async function runPersistenceVerification(
  deps: DevStartDeps,
  opts: VerifyOptions
): Promise<VerificationResult> {
  const root = path.resolve(opts.root ?? process.cwd())
  const timeoutMs = opts.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS
  const intervalMs = opts.readinessIntervalMs ?? DEFAULT_READINESS_INTERVAL_MS

  if (!existsSync(path.join(root, '.env')) && !process.env.DATABASE_URL) {
    throw new PersistenceVerificationError(
      'No .env file and no DATABASE_URL in the environment (see .env.example).'
    )
  }

  // --- BEFORE phase: one client, disconnected before the stack stops. ---
  // The same generated client the real startup constructs (deps.createPrisma
  // — see scripts/dev-start.ts), viewed through its structural interface.
  const beforeClient = (await deps.createPrisma()) as unknown as VerifyPrisma
  let before: Snapshot
  try {
    before = await takeSnapshot(beforeClient)
    printSnapshot('BEFORE', before)

    if (!before.seededAdminPresent) {
      throw new PersistenceVerificationError(
        'Seeded admin account missing — run `npm run dev:start` on a fresh database first.'
      )
    }
    await ensureSentinel(beforeClient)
  } finally {
    // Release this engine BEFORE the containers stop: a client that stays
    // connected across `docker compose down` holds a dead connection to the
    // old server instance and must never be reused afterwards (see header).
    await beforeClient.$disconnect()
  }

  let startup: { initialized: boolean; seededNow: boolean } | undefined
  if (opts.restart) {
    const compose = await resolveCompose(deps.runCommand)

    console.log('[verify] Stopping the stack (docker compose down — volumes are kept)...')
    const stop = await deps.runCommand(
      compose[0],
      [...compose.slice(1), '-f', COMPOSE_FILE, 'down'],
      {
        cwd: root,
      }
    )
    if (stop.code !== 0) {
      throw new PersistenceVerificationError(`docker compose down failed (exit ${stop.code}).`)
    }

    console.log('[verify] Running the REAL safe startup (same code path as npm run dev:start)...')
    try {
      startup = await runSafeStartup(deps, {
        root,
        dbOnly: true,
        readinessTimeoutMs: timeoutMs,
        readinessIntervalMs: intervalMs,
      })
      console.log(
        `[verify]   startup result: initialized=${startup.initialized} seededNow=${startup.seededNow}`
      )
      if (startup.seededNow) {
        throw new PersistenceVerificationError(
          'The startup RE-RAN the seed on a populated database — data safety violated.'
        )
      }
    } catch (err) {
      throw new PersistenceVerificationError(
        `Safe startup failed: ${err instanceof StartupError ? err.message : String(err)}`
      )
    }
  } else {
    console.log('[verify] (--restart not passed: no stop/start cycle performed)')
  }

  // --- AFTER phase: a FRESH client, proven live before the snapshot. ---
  const afterClient = (await deps.createPrisma()) as unknown as VerifyPrisma
  let after: Snapshot
  try {
    console.log('[verify] Waiting for MySQL to accept connections (fresh client)...')
    try {
      await waitForDatabaseReady(afterClient, deps.sleep, {
        timeoutMs,
        intervalMs,
        composeFile: COMPOSE_FILE,
        log: (message) => console.log(`[verify]${message}`),
      })
    } catch (err) {
      if (err instanceof StartupError) {
        // A bounded wait that gave up is a verification failure with known
        // causes — surface it as such, not as an "unexpected error".
        throw new PersistenceVerificationError(
          `The database was not reachable after startup (fresh client):\n${err.message}`
        )
      }
      throw err
    }
    after = await takeSnapshot(afterClient)
    printSnapshot('AFTER', after)
  } finally {
    await afterClient.$disconnect()
  }

  const problems: string[] = []
  const tables = [
    ['users', before.users, after.users],
    ['hospitals', before.hospitals, after.hospitals],
    ['patients', before.patients, after.patients],
    ['appointments', before.appointments, after.appointments],
    ['invoices', before.invoices, after.invoices],
  ] as const
  for (const [table, beforeCount, afterCount] of tables) {
    if (afterCount < beforeCount) {
      problems.push(`${table} lost rows (${beforeCount} -> ${afterCount})`)
    }
  }
  if (!after.seededAdminPresent) problems.push('seeded admin account disappeared')
  if (!after.sentinelPresent) problems.push('sentinel patient disappeared')

  if (problems.length) {
    throw new PersistenceVerificationError(problems.map((p) => `  - ${p}`).join('\n'))
  }
  return { before, after, startup }
}

async function main(): Promise<void> {
  const restart = process.argv.slice(2).includes('--restart')
  try {
    await runPersistenceVerification(defaultDeps(), {
      root: process.cwd(),
      restart,
    })
    console.log('[verify] RESULT: PASS — all existing records survived, seed was not re-run.')
  } catch (err) {
    if (err instanceof PersistenceVerificationError) {
      console.error('[verify] RESULT: FAIL')
      for (const line of err.message.split('\n')) console.error(`[verify] ${line}`)
    } else {
      console.error(`[verify] Unexpected error: ${err instanceof Error ? err.stack : String(err)}`)
    }
    process.exit(1)
  }
}

// The orchestrator is importable (scripts/dev-start.ts is imported by it);
// only run the CLI when this file is the entry point (npx tsx
// scripts/verify-persistence.ts).
const entryPoint = process.argv[1]
if (entryPoint !== undefined && path.resolve(entryPoint) === path.resolve(__filename)) {
  main()
}

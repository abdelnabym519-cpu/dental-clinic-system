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
 * What it does:
 *   - snapshots the row counts of the key tables (users, hospitals, patients,
 *     appointments, invoices) and checks that the seeded admin account
 *     (admin@dentora-dental.com) is present;
 *   - ensures one identifiable, harmless sentinel patient exists
 *     (upsert — created at most once, never touched afterwards);
 *   - with --restart: stops the stack (volumes preserved), runs exactly the
 *     same startup code path as `npm run dev:start` (scripts/dev-start.ts),
 *     then re-checks.
 *
 * Result: PASS only if no table lost rows, the sentinel and the seeded admin
 * survived, and the startup did not re-run the seed on a populated database.
 * Any regression exits non-zero. Nothing is ever deleted.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  COMPOSE_FILE,
  defaultDeps,
  resolveCompose,
  runSafeStartup,
  StartupError,
} from './dev-start'
import { isDatabaseSeeded, SEEDED_ADMIN_EMAIL } from './seed-check'

const SENTINEL_PATIENT_ID = 'PERS-SENTINEL-0001'

interface Snapshot {
  users: number
  hospitals: number
  patients: number
  appointments: number
  invoices: number
  seededAdminPresent: boolean
  sentinelPresent: boolean
  seeded: boolean
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
  $disconnect(): Promise<void>
}

function fail(message: string): never {
  console.error(`[verify] ${message}`)
  process.exit(1)
}

async function loadPrisma(): Promise<VerifyPrisma> {
  // Same guard as dev-start: the generated client, never a silent fallback.
  let mod: { PrismaClient?: new (options?: Record<string, unknown>) => unknown }
  try {
    mod = await import('@prisma/client')
  } catch {
    fail('The generated Prisma client could not be loaded. Run "npm install" first.')
  }
  if (!mod.PrismaClient) fail('Run "npx prisma generate" and try again.')
  try {
    return new mod.PrismaClient() as VerifyPrisma
  } catch (err) {
    fail(`The generated Prisma client could not be constructed: ${String(err)}`)
  }
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
    fail(
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

async function main(): Promise<void> {
  const restart = process.argv.slice(2).includes('--restart')
  const root = process.cwd()

  if (!existsSync(path.join(root, '.env')) && !process.env.DATABASE_URL) {
    fail('No .env file and no DATABASE_URL in the environment (see .env.example).')
  }

  const prisma = await loadPrisma()
  try {
    const before = await takeSnapshot(prisma)
    printSnapshot('BEFORE', before)

    if (!before.seededAdminPresent) {
      fail('Seeded admin account missing — run `npm run dev:start` on a fresh database first.')
    }
    await ensureSentinel(prisma)

    if (restart) {
      const deps = defaultDeps()
      const compose = await resolveCompose(deps.runCommand)

      console.log('[verify] Stopping the stack (docker compose down — volumes are kept)...')
      const stop = await deps.runCommand(
        compose[0],
        [...compose.slice(1), '-f', COMPOSE_FILE, 'down'],
        {
          cwd: root,
        }
      )
      if (stop.code !== 0) fail(`docker compose down failed (exit ${stop.code}).`)

      console.log('[verify] Running the REAL safe startup (same code path as npm run dev:start)...')
      try {
        const outcome = await runSafeStartup(deps, { root, dbOnly: true })
        console.log(
          `[verify]   startup result: initialized=${outcome.initialized} seededNow=${outcome.seededNow}`
        )
        if (outcome.seededNow) {
          fail('The startup RE-RAN the seed on a populated database — data safety violated.')
        }
      } catch (err) {
        fail(`Safe startup failed: ${err instanceof StartupError ? err.message : String(err)}`)
      }
    } else {
      console.log('[verify] (--restart not passed: no stop/start cycle performed)')
    }

    const after = await takeSnapshot(prisma)
    printSnapshot('AFTER', after)

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
      console.error('[verify] RESULT: FAIL')
      for (const p of problems) console.error(`[verify]   - ${p}`)
      process.exit(1)
    }
    console.log('[verify] RESULT: PASS — all existing records survived, seed was not re-run.')
  } finally {
    await prisma.$disconnect()
  }
}

// The orchestrator is importable (scripts/dev-start.ts is imported by it);
// only run the CLI when this file is the entry point (npx tsx
// scripts/verify-persistence.ts).
const entryPoint = process.argv[1]
if (entryPoint !== undefined && path.resolve(entryPoint) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(`[verify] Unexpected error: ${err instanceof Error ? err.stack : String(err)}`)
    process.exit(1)
  })
}

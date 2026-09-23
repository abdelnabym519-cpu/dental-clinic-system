/**
 * One-off, EXPLICIT correction for a development-only condition:
 * the seeded admin account's stored password no longer matches the
 * documented development value.
 *
 *     npm run db:restore-dev-admin
 *
 * How this happens in practice: the password was changed in the app (or an
 * older seed variant ran), so `bcrypt.compare(documented password, stored
 * hash)` is false and login fails — while the database, the user row, the
 * hospital and every other record are perfectly intact.
 *
 * What this script does — exactly one write, exactly one row, one column:
 *   - looks up the canonical seeded account (admin@dentora-dental.com);
 *   - if it does not exist: stops — there is nothing to restore, and a
 *     fresh database receives the documented account from the seed
 *     (`npm run dev:start` seeds exactly once);
 *   - if it exists: sets the password to the documented development value
 *     and touches NOTHING else (no re-activation, no other fields, no other
 *     users).
 *
 * Deliberate design boundaries:
 *   - This is NEVER part of `npm run dev:start`. Normal startup must not
 *     modify existing data, and it does not.
 *   - It does not use migrate reset, db push, drops, deletes or the seed.
 *   - It never prints the password or the hash.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'

import { SEEDED_ADMIN_EMAIL } from './seed-check'

// Documented development credential — kept in sync with prisma/seed.ts and
// the README "Default Credentials (after seeding)" table.
export const DEV_ADMIN_PASSWORD = 'Admin@123'

/**
 * Structural view of the generated client (same convention as lib/prisma.ts),
 * so this module never imports the generated client and stays testable.
 */
export interface RestoreTarget {
  user: {
    findUnique(args: {
      where: { email: string }
      select: { id: true; isActive: true }
    }): Promise<{ id: string; isActive: boolean } | null>
    update(args: { where: { id: string }; data: { password: string } }): Promise<unknown>
  }
}

export type RestoreResult =
  | { status: 'restored'; email: string; accountActive: boolean }
  | { status: 'missing'; email: string }

/**
 * The whole decision + the single write. Fail-closed: any database error
 * propagates to the caller. Returns a result object so the CLI (and tests)
 * can report exactly what happened without ever seeing the hash.
 */
export async function restoreDevAdminPassword(prisma: RestoreTarget): Promise<RestoreResult> {
  const admin = await prisma.user.findUnique({
    where: { email: SEEDED_ADMIN_EMAIL },
    select: { id: true, isActive: true },
  })
  if (!admin) return { status: 'missing', email: SEEDED_ADMIN_EMAIL }

  const hashed = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10)
  await prisma.user.update({ where: { id: admin.id }, data: { password: hashed } })
  return { status: 'restored', email: SEEDED_ADMIN_EMAIL, accountActive: admin.isActive }
}

function fail(message: string): never {
  console.error(`[restore-dev-admin] ${message}`)
  process.exit(1)
}

async function loadPrisma(): Promise<RestoreTarget & { $disconnect(): Promise<void> }> {
  // Same guard as dev-start: the generated client, never a silent fallback.
  let mod: { PrismaClient?: new (options?: Record<string, unknown>) => unknown }
  try {
    mod = await import('@prisma/client')
  } catch {
    fail('The generated Prisma client could not be loaded. Run "npm install" first.')
  }
  if (!mod.PrismaClient) fail('Run "npx prisma generate" and try again.')
  try {
    return new mod.PrismaClient() as RestoreTarget & { $disconnect(): Promise<void> }
  } catch (err) {
    fail(`The generated Prisma client could not be constructed: ${String(err)}`)
  }
}

async function main(): Promise<void> {
  const root = process.cwd()
  if (!existsSync(path.join(root, '.env')) && !process.env.DATABASE_URL) {
    fail('No .env file and no DATABASE_URL in the environment (see .env.example).')
  }

  const prisma = await loadPrisma()
  try {
    const result = await restoreDevAdminPassword(prisma)
    if (result.status === 'missing') {
      fail(
        `The seeded admin account (${result.email}) does not exist in this database. ` +
          'There is nothing to restore — run `npm run dev:start` on a fresh database; ' +
          'the seed creates the documented account.'
      )
    }
    console.log(
      `[restore-dev-admin] Restored the documented development password for ${result.email}.`
    )
    if (!result.accountActive) {
      console.log(
        '[restore-dev-admin] NOTE: this account is currently INACTIVE, so login will still be ' +
          'refused. If you deactivated it on purpose, re-activate it from the application; ' +
          'this script does not change isActive.'
      )
    }
    console.log('[restore-dev-admin] No other data was read or changed. You can log in now.')
  } finally {
    await prisma.$disconnect()
  }
}

// The orchestrator is importable for unit tests; only run the CLI when this
// file is the entry point (npx tsx scripts/restore-dev-admin.ts).
const entryPoint = process.argv[1]
if (entryPoint !== undefined && path.resolve(entryPoint) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(`[restore-dev-admin] ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}

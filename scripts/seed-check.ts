/**
 * Seed decision used by the safe development startup (scripts/dev-start.ts).
 *
 * Question answered: "has this project's development seed ever run against
 * this database?"
 *
 * Canonical answer: the seeded admin user. prisma/seed.ts upserts
 * `admin@dentora-dental.com` on every run (right after the demo hospital,
 * before anything else), and only the seed creates that user. Therefore:
 *
 *   - user exists   -> the seed has run  -> SKIP (the startup writes nothing)
 *   - user missing  -> uninitialized (fresh database, or the account was
 *                      deliberately deleted) -> run the seed exactly once
 *
 * Why not `User.count() === 0`: any user — including one created through the
 * signup flow — would suppress the seed and leave the database without its
 * baseline demo data (including the e2e payment link the test suite expects).
 * Why not "the tables are empty": a clinic that deleted its demo rows would
 * be re-seeded on every startup.
 *
 * The seed itself is idempotent (upsert-based), but the startup still skips
 * it on an initialized database: a re-run re-stamps the documented passwords
 * on the seeded accounts and force-activates every user and hospital (the
 * seed's "login guarantee"), which would overwrite real state a developer may
 * have changed on purpose.
 */

// Kept in sync with prisma/seed.ts.
export const SEEDED_ADMIN_EMAIL = 'admin@dentora-dental.com'

/**
 * Structurally typed on purpose: this module never imports the generated
 * Prisma client (same convention as lib/prisma.ts), so it stays importable
 * in any environment and trivially testable with fakes.
 */
export interface SeedCheckClient {
  user: {
    findUnique(args: {
      where: { email: string }
      select: { id: true }
    }): Promise<{ id: string } | null>
  }
}

/**
 * Deterministic "was the seed run?" check.
 *
 * Rejects on connection/SQL errors instead of resolving with a default:
 * a wrong `false` would re-seed a live database, and a wrong `true` would
 * skip seeding a fresh one. Let the caller fail loudly.
 */
export async function isDatabaseSeeded(prisma: SeedCheckClient): Promise<boolean> {
  const admin = await prisma.user.findUnique({
    where: { email: SEEDED_ADMIN_EMAIL },
    select: { id: true },
  })
  return admin !== null
}

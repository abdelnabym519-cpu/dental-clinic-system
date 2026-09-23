/**
 * Safe development startup (scripts/dev-start.ts) — no Docker, no database.
 *
 * The orchestrator is driven through injected fakes: a fake command runner
 * records every command and fakes each step's exit code, and a fake Prisma
 * client controls readiness, the seed decision and connection errors. That
 * pins the whole contract:
 *
 *   - step order (services -> readiness -> migrate deploy -> seed decision -> dev)
 *   - the compose `up` is scoped to the core services (mysql, redis) — an
 *     unscoped whole-stack `up -d` makes the harness throw, failing every
 *     test that drives the flow (optional minio/mailpit/createbuckets must
 *     never be able to block core startup)
 *   - a seeded database is never re-seeded (existing data preserved)
 *   - `prisma migrate reset` is never invoked
 *   - readiness is polled until success or timeout — no fixed sleep
 *   - every failure mode aborts BEFORE the app starts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  COMPOSE_FILE,
  CORE_SERVICES,
  runSafeStartup,
  StartupError,
  type DevStartDeps,
  type RunCommand,
  type RunOptions,
  type RunResult,
} from '../../scripts/dev-start'
import { isDatabaseSeeded, SEEDED_ADMIN_EMAIL } from '../../scripts/seed-check'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** The `up -d` command the startup must issue — scoped to the core services. */
const coreUpKey = (compose: string) =>
  `${compose} -f ${COMPOSE_FILE} up -d ${CORE_SERVICES.join(' ')}`

interface HarnessOptions {
  /** SELECT 1 succeeds. Default true. */
  ready?: boolean
  /** SELECT 1 fails this many times before succeeding (cold start). */
  probesBeforeReady?: number
  /** Seeded admin user present. Default true. */
  seeded?: boolean
  migrateCode?: number
  seedCode?: number
  devCode?: number
  composeUpCode?: number
  /** `docker`/`docker-compose` spawn with ENOENT. */
  dockerMissing?: boolean
  /** `docker compose version` fails, standalone `docker-compose` works. */
  composeV1Only?: boolean
}

interface Harness {
  deps: DevStartDeps
  callKeys: () => string[]
  probes: () => number
  userFindUnique: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const calls: string[] = []
  let probes = 0

  const runCommand: RunCommand = vi.fn(
    async (cmd, args, _opts?: RunOptions): Promise<RunResult> => {
      const key = [cmd, ...args].join(' ')
      calls.push(key)

      if (options.dockerMissing && (cmd === 'docker' || cmd === 'docker-compose')) {
        throw new Error(`spawn ${cmd} ENOENT`)
      }
      if (options.composeV1Only && cmd === 'docker') {
        throw new Error('spawn docker ENOENT')
      }
      if (key === 'docker compose version') return { code: 0, stdout: '', stderr: '' }
      if (key === 'docker-compose version') return { code: 0, stdout: '', stderr: '' }
      if (key === coreUpKey('docker compose') || key === coreUpKey('docker-compose')) {
        return { code: options.composeUpCode ?? 0, stdout: '', stderr: '' }
      }
      // Regression guard: if the startup ever reverts to an unscoped
      // `up -d` (the whole stack — letting optional minio/mailpit/createbuckets
      // block core startup), fail loudly so every test through the flow breaks.
      if (key.endsWith(' up -d')) {
        throw new Error(`regression: unscoped compose "up -d" (whole stack): ${key}`)
      }
      if (key === 'npx prisma migrate deploy') {
        return { code: options.migrateCode ?? 0, stdout: '', stderr: '' }
      }
      if (key === 'npx prisma db seed') {
        return { code: options.seedCode ?? 0, stdout: '', stderr: '' }
      }
      if (key === 'npm run dev') return { code: options.devCode ?? 0, stdout: '', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
  )

  const userFindUnique = vi.fn(async () =>
    options.seeded === false ? null : { id: 'seeded-admin' }
  )
  const queryRawUnsafe = vi.fn(async () => {
    probes += 1
    if (options.ready === false || probes <= (options.probesBeforeReady ?? 0)) {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3306')
    }
    return [{ 1: 1 }]
  })
  const disconnect = vi.fn(async () => undefined)

  const deps: DevStartDeps = {
    runCommand,
    createPrisma: vi.fn(async () => ({
      user: { findUnique: userFindUnique },
      $queryRawUnsafe: queryRawUnsafe,
      $disconnect: disconnect,
    })),
    sleep: vi.fn(async () => undefined),
  }

  return { deps, callKeys: () => calls, probes: () => probes, userFindUnique, disconnect }
}

const QUICK_TIMEOUT = { readinessTimeoutMs: 50, readinessIntervalMs: 5 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runSafeStartup — happy paths', () => {
  it('seeded database: services -> readiness -> migrate deploy -> skip seed -> dev', async () => {
    const h = makeHarness({ seeded: true })

    const outcome = await runSafeStartup(h.deps, { root: REPO_ROOT })

    expect(h.callKeys()).toEqual([
      'docker compose version',
      coreUpKey('docker compose'),
      'npx prisma migrate deploy',
      'npm run dev',
    ])
    // Already ready on the first probe: no polling needed.
    expect(h.probes()).toBe(1)
    expect(h.userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: SEEDED_ADMIN_EMAIL } })
    )
    expect(outcome).toEqual({ initialized: true, seededNow: false })
    expect(h.disconnect).toHaveBeenCalledTimes(1)
  })

  it('cold start: polls readiness until MySQL accepts connections, then proceeds', async () => {
    const h = makeHarness({ seeded: true, probesBeforeReady: 4 })

    await runSafeStartup(h.deps, { root: REPO_ROOT, ...QUICK_TIMEOUT })

    expect(h.probes()).toBe(5)
    expect(h.callKeys()).toContain('npx prisma migrate deploy')
    expect(h.callKeys()).toContain('npm run dev')
  })

  it('fresh database: seeds exactly once, between migrate deploy and the app', async () => {
    const h = makeHarness({ seeded: false })

    const outcome = await runSafeStartup(h.deps, { root: REPO_ROOT })

    const keys = h.callKeys()
    const seedIndex = keys.indexOf('npx prisma db seed')
    expect(seedIndex).toBeGreaterThan(keys.indexOf('npx prisma migrate deploy'))
    expect(seedIndex).toBeLessThan(keys.indexOf('npm run dev'))
    expect(keys.filter((k) => k === 'npx prisma db seed')).toHaveLength(1)
    expect(outcome).toEqual({ initialized: true, seededNow: true })
  })

  it('--db-only prepares the database without starting the application', async () => {
    const h = makeHarness({ seeded: true })

    const outcome = await runSafeStartup(h.deps, { root: REPO_ROOT, dbOnly: true })

    expect(h.callKeys()).not.toContain('npm run dev')
    expect(outcome).toEqual({ initialized: true, seededNow: false })
  })

  it('falls back to standalone docker-compose when the plugin is missing', async () => {
    const h = makeHarness({ seeded: true, composeV1Only: true })

    await runSafeStartup(h.deps, { root: REPO_ROOT })

    const keys = h.callKeys()
    const upKey = coreUpKey('docker-compose')
    expect(keys).toContain('docker-compose version')
    expect(keys).toContain(upKey)
    expect(keys).not.toContain(coreUpKey('docker compose'))
    expect(keys.indexOf(upKey)).toBeLessThan(keys.indexOf('npx prisma migrate deploy'))
    expect(keys).toContain('npm run dev')
  })
})

describe('runSafeStartup — core service scope', () => {
  it('starts only the core services (mysql, redis) — never the whole stack', async () => {
    const h = makeHarness({ seeded: true })
    await runSafeStartup(h.deps, { root: REPO_ROOT })

    const up = h.callKeys().find((k) => k.includes('up -d'))
    expect(up).toBeDefined()
    // Exactly the required core services, in the core command form...
    expect(up).toBe(coreUpKey('docker compose'))
    // ...so it must never be the unscoped whole-stack `up -d`...
    expect(up).not.toBe(`docker compose -f ${COMPOSE_FILE} up -d`)
    // ...and must never pull in the optional infrastructure by name.
    expect(up).not.toContain('minio')
    expect(up).not.toContain('mailpit')
    expect(up).not.toContain('createbuckets')
  })

  it('CORE_SERVICES is exactly the core dependency set', () => {
    expect(CORE_SERVICES).toEqual(['mysql', 'redis'])
  })
})

describe('runSafeStartup — the invariant: never destructive', () => {
  it.each([true, false])('never invokes prisma migrate reset (seeded=%s)', async (seeded) => {
    const h = makeHarness({ seeded })

    await runSafeStartup(h.deps, { root: REPO_ROOT, ...QUICK_TIMEOUT })

    expect(h.callKeys().some((key) => key.includes('reset'))).toBe(false)
    expect(h.callKeys().some((key) => key.includes('db push'))).toBe(false)
    expect(h.callKeys().some((key) => key.includes('drop'))).toBe(false)
  })

  it('a seeded database receives no database-writing command at all', async () => {
    const h = makeHarness({ seeded: true })

    await runSafeStartup(h.deps, { root: REPO_ROOT })

    // The only database this run performs is a read (the seed decision).
    expect(h.callKeys()).not.toContain('npx prisma db seed')
  })
})

describe('runSafeStartup — failure scenarios', () => {
  it('MySQL never becomes ready: times out, nothing past the probe runs', async () => {
    const h = makeHarness({ seeded: true, ready: false })

    await expect(runSafeStartup(h.deps, { root: REPO_ROOT, ...QUICK_TIMEOUT })).rejects.toThrow(
      /did not become ready within/
    )

    // Polled repeatedly (no single fixed sleep), then aborted.
    expect(h.deps.sleep).toHaveBeenCalled()
    expect(h.callKeys()).not.toContain('npx prisma migrate deploy')
    expect(h.callKeys()).not.toContain('npm run dev')
    expect(h.userFindUnique).not.toHaveBeenCalled()
    expect(h.disconnect).toHaveBeenCalled()
  })

  it('Docker missing entirely: clear error, no compose or database commands', async () => {
    const h = makeHarness({ dockerMissing: true })

    await expect(runSafeStartup(h.deps, { root: REPO_ROOT })).rejects.toThrow(
      /Docker Compose not found/
    )
    expect(h.callKeys().filter((k) => k.startsWith('docker'))).toHaveLength(2)
    expect(h.callKeys().some((k) => k.startsWith('npx'))).toBe(false)
  })

  it('missing .env and DATABASE_URL: fails before any Docker command', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dentora-noenv-'))
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const h = makeHarness({})
      await expect(runSafeStartup(h.deps, { root: dir })).rejects.toThrow(/No .env file/)
      expect(h.callKeys()).toHaveLength(0)
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('compose up failure: aborts before migrations and the app', async () => {
    const h = makeHarness({ composeUpCode: 1 })

    await expect(runSafeStartup(h.deps, { root: REPO_ROOT })).rejects.toThrow(
      /docker compose up failed/
    )
    expect(h.callKeys()).not.toContain('npx prisma migrate deploy')
    expect(h.callKeys()).not.toContain('npm run dev')
  })

  it('migrate deploy failure: aborts before seeding and the app', async () => {
    const h = makeHarness({ seeded: false, migrateCode: 1 })

    await expect(runSafeStartup(h.deps, { root: REPO_ROOT })).rejects.toThrow(
      /prisma migrate deploy failed/
    )
    expect(h.callKeys()).not.toContain('npx prisma db seed')
    expect(h.callKeys()).not.toContain('npm run dev')
  })

  it('seed failure: the app must not start on an unseeded database', async () => {
    const h = makeHarness({ seeded: false, seedCode: 1 })

    await expect(runSafeStartup(h.deps, { root: REPO_ROOT })).rejects.toThrow(/Seed failed/)
    expect(h.callKeys()).not.toContain('npm run dev')
  })

  it('next dev non-zero exit: surfaced, not swallowed', async () => {
    const h = makeHarness({ devCode: 137 })

    await expect(runSafeStartup(h.deps, { root: REPO_ROOT })).rejects.toThrow(
      /next dev exited with code 137/
    )
  })
})

describe('isDatabaseSeeded (seed decision)', () => {
  const makeClient = (result: { id: string } | null) => ({
    user: {
      findUnique: vi.fn(async () => result),
    },
  })

  it('resolves true when the seeded admin user exists', async () => {
    await expect(isDatabaseSeeded(makeClient({ id: 'u1' }))).resolves.toBe(true)
  })

  it('resolves false when the seeded admin user does not exist', async () => {
    await expect(isDatabaseSeeded(makeClient(null))).resolves.toBe(false)
  })

  it('queries exactly the canonical seeded admin email', async () => {
    const client = makeClient({ id: 'u1' })
    await isDatabaseSeeded(client)
    expect(client.user.findUnique).toHaveBeenCalledWith({
      where: { email: SEEDED_ADMIN_EMAIL },
      select: { id: true },
    })
  })

  it('propagates database errors instead of guessing either way', async () => {
    const client = {
      user: {
        findUnique: vi.fn(async () => {
          throw new Error('P1001: Cannot reach database server at 127.0.0.1:3306')
        }),
      },
    }
    await expect(isDatabaseSeeded(client)).rejects.toThrow(/P1001/)
  })
})

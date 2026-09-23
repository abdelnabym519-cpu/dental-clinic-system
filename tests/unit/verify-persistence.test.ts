/**
 * Persistence verifier (scripts/verify-persistence.ts) — no Docker, no DB.
 *
 * The harness models the real engine lifecycle that broke the old code:
 * a Prisma client is tied to the MySQL server INSTANCE it was created
 * against. `docker compose down` + `up -d` replaces that instance, and a
 * client born against the old instance can no longer reach the server
 * (P1001 "Can't reach database server at localhost:3306") — even though a
 * client created after the restart can. That is exactly the field failure:
 * Safe Startup's own fresh client had just queried the restarted database
 * successfully, and the verifier's pre-restart client died on the AFTER
 * snapshot. A disconnected client refuses queries too.
 *
 * Consequences for any implementation driven through this harness:
 *   - reusing a client across the stop/start cycle -> P1001 -> the test fails
 *   - `docker compose down -v` -> the harness throws (volume deletion)
 *   - unscoped `up -d` (whole stack) -> the harness throws
 *   - `migrate reset` / `db push` -> the harness throws
 *
 * The happy path additionally pins the fixed lifecycle: the BEFORE client is
 * disconnected BEFORE `down`, and the AFTER snapshot is taken only after a
 * fresh client (created after `up`) passes a live `SELECT 1` probe.
 */
import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

import {
  COMPOSE_FILE,
  CORE_SERVICES,
  StartupError,
  waitForDatabaseReady,
  type DevStartDeps,
  type RunCommand,
  type RunOptions,
  type RunResult,
} from '../../scripts/dev-start'
import {
  PersistenceVerificationError,
  SENTINEL_PATIENT_ID,
  runPersistenceVerification,
  type Snapshot,
} from '../../scripts/verify-persistence'
import { SEEDED_ADMIN_EMAIL } from '../../scripts/seed-check'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

const coreUpKey = `docker compose -f ${COMPOSE_FILE} up -d ${CORE_SERVICES.join(' ')}`
const downKey = `docker compose -f ${COMPOSE_FILE} down`

type TableName = 'users' | 'hospitals' | 'patients' | 'appointments' | 'invoices'

interface ServerData {
  users: number
  hospitals: number
  patients: number
  appointments: number
  invoices: number
  admin: { id: string; hospitalId: string } | null
  sentinelPresent: boolean
}

interface HarnessOptions {
  data?: Partial<ServerData>
  /** Rows silently lost when the stack comes back (destructive regression). */
  rowLoss?: Partial<Record<TableName, number>>
  /** The admin row vanishes during the cycle -> startup would re-seed. */
  dropAdminOnRestart?: boolean
  /** The client the verifier creates AFTER startup can never reach MySQL. */
  afterStartClientUnreachable?: boolean
}

interface Harness {
  deps: DevStartDeps
  callKeys: () => string[]
  events: () => string[]
}

const P1001 = `P1001: Can't reach database server at localhost:3306`

function makeHarness(options: HarnessOptions = {}): Harness {
  const commands: string[] = []
  const events: string[] = []

  const state = {
    instance: 1,
    available: true,
    upHappened: false,
    data: {
      users: 4,
      hospitals: 1,
      patients: 11,
      appointments: 18,
      invoices: 1,
      admin: { id: 'seeded-admin', hospitalId: 'hospital-demo' },
      sentinelPresent: false,
      ...options.data,
    } as ServerData,
  }

  interface FakeClient {
    index: number
    bornInstance: number
    unreachable: boolean
    disconnected: boolean
  }

  let nextIndex = 0
  let postUpClients = 0

  const buildClient = (c: FakeClient) => {
    const query = (kind: string, produce?: () => unknown) => {
      if (c.disconnected) {
        throw new Error(`Query engine was already stopped (client #${c.index})`)
      }
      events.push(`query:#${c.index}:${kind}`)
      if (!state.available || c.bornInstance !== state.instance || c.unreachable) {
        throw new Error(P1001)
      }
      return Promise.resolve(produce ? produce() : undefined)
    }
    return {
      user: {
        count: () => query('users', () => state.data.users),
        findUnique: (args: { where: { email: string } }) =>
          query('user.findUnique', () =>
            args.where.email === SEEDED_ADMIN_EMAIL ? state.data.admin : null
          ),
      },
      hospital: {
        count: () => query('hospitals', () => state.data.hospitals),
      },
      patient: {
        count: () => query('patients', () => state.data.patients),
        findUnique: (args: {
          where: { hospitalId_patientId: { hospitalId: string; patientId: string } }
        }) =>
          query('patient.findUnique', () =>
            state.data.sentinelPresent &&
            args.where.hospitalId_patientId.patientId === SENTINEL_PATIENT_ID
              ? { id: 'sentinel' }
              : null
          ),
        upsert: () =>
          query('patient.upsert', () => {
            if (!state.data.sentinelPresent) {
              state.data.sentinelPresent = true
              state.data.patients += 1
            }
            return { id: 'sentinel' }
          }),
      },
      appointment: {
        count: () => query('appointments', () => state.data.appointments),
      },
      invoice: {
        count: () => query('invoices', () => state.data.invoices),
      },
      $queryRawUnsafe: () => query('SELECT 1'),
      $disconnect: () => {
        if (c.disconnected) return Promise.resolve()
        c.disconnected = true
        events.push(`disconnect:#${c.index}`)
        return Promise.resolve()
      },
    }
  }

  const runCommand: RunCommand = vi.fn(
    async (cmd, args, _opts?: RunOptions): Promise<RunResult> => {
      const key = [cmd, ...args].join(' ')
      commands.push(key)

      // Regression guards — destructive/whole-stack shapes fail loudly.
      if (key.includes('down') && key.includes('-v')) {
        throw new Error(`regression: compose down with -v (volume deletion): ${key}`)
      }
      if (key.endsWith(' up -d')) {
        throw new Error(`regression: unscoped compose "up -d" (whole stack): ${key}`)
      }
      if (key.includes('migrate reset') || key.includes('db push')) {
        throw new Error(`regression: destructive prisma command: ${key}`)
      }

      if (key === 'docker compose version') return { code: 0, stdout: '', stderr: '' }
      if (key === downKey) {
        state.available = false
        events.push('down')
        return { code: 0, stdout: '', stderr: '' }
      }
      if (key === coreUpKey) {
        state.available = true
        state.instance += 1
        state.upHappened = true
        if (options.dropAdminOnRestart) {
          state.data.admin = null
          state.data.users -= 1
        }
        if (options.rowLoss) {
          for (const [table, lost] of Object.entries(options.rowLoss)) {
            state.data[table as TableName] -= lost
          }
        }
        events.push('up')
        return { code: 0, stdout: '', stderr: '' }
      }
      if (key === 'npx prisma migrate deploy') return { code: 0, stdout: '', stderr: '' }
      if (key === 'npx prisma db seed') return { code: 0, stdout: '', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
  )

  const createPrisma = vi.fn(async () => {
    nextIndex += 1
    const c: FakeClient = {
      index: nextIndex,
      bornInstance: state.instance,
      unreachable: false,
      disconnected: false,
    }
    if (state.upHappened) {
      postUpClients += 1
      // The first client after `up` is the real startup's own (it must stay
      // reachable — it is the evidence the database came back). The second
      // is the verifier's AFTER client.
      if (options.afterStartClientUnreachable && postUpClients >= 2) {
        c.unreachable = true
      }
    }
    events.push(`create:#${nextIndex}`)
    return buildClient(c) as unknown as Awaited<ReturnType<DevStartDeps['createPrisma']>>
  })

  return {
    deps: {
      runCommand,
      createPrisma,
      // Bounded to keep the readiness busy-loops fast and probe counts sane.
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    },
    callKeys: () => commands,
    events: () => events,
  }
}

const QUICK = { readinessTimeoutMs: 60, readinessIntervalMs: 5 }

describe('runPersistenceVerification — --restart on an initialized database', () => {
  it('BEFORE == AFTER: the full cycle passes and the lifecycle is stale-client-safe', async () => {
    const h = makeHarness()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const result = await runPersistenceVerification(h.deps, {
      root: REPO_ROOT,
      restart: true,
      ...QUICK,
    })

    // The dynamic oracle: counts come from the harness data, not literals.
    expect(result.before).toEqual<Snapshot>({
      users: 4,
      hospitals: 1,
      patients: 11,
      appointments: 18,
      invoices: 1,
      seededAdminPresent: true,
      sentinelPresent: false,
      seeded: true,
    })
    expect(result.after.patients).toBe(result.before.patients + 1) // sentinel upsert
    expect(result.after.sentinelPresent).toBe(true)
    for (const table of ['users', 'hospitals', 'appointments', 'invoices'] as const) {
      expect(result.after[table]).toBe(result.before[table])
    }
    expect(result.startup).toEqual({ initialized: true, seededNow: false })

    // Lifecycle: stop keeps the volumes, start is core-scoped, no reset.
    const keys = h.callKeys()
    expect(keys).toContain(downKey)
    expect(keys).not.toContain(`${downKey} -v`)
    expect(keys).toContain(coreUpKey)
    expect(keys).not.toContain(`docker compose -f ${COMPOSE_FILE} up -d`)
    expect(keys).not.toContain('npx prisma db seed') // initialized DB: no re-seed
    expect(keys).toContain('npx prisma migrate deploy')
    expect(keys.some((k) => k.includes('reset') || k.includes('db push'))).toBe(false)

    // Client lifecycle — the regression the old code had:
    const events = h.events()
    const downAt = events.indexOf('down')
    const upAt = events.indexOf('up')
    expect(downAt).toBeGreaterThan(-1)
    expect(upAt).toBeGreaterThan(downAt)
    // 1. BEFORE client created first, disconnected BEFORE the stack stops...
    expect(events.indexOf('create:#1')).toBe(0)
    expect(events.indexOf('disconnect:#1')).toBeGreaterThan(-1)
    expect(events.indexOf('disconnect:#1')).toBeLessThan(downAt)
    // 2. ...and is NEVER queried again after the restart (stale instance).
    expect(events.slice(downAt + 1).some((e) => e.startsWith('query:#1:'))).toBe(false)
    // 3. AFTER snapshot: a fresh client created after `up`...
    const afterCreate = events.indexOf('create:#3')
    expect(afterCreate).toBeGreaterThan(upAt)
    // 4. ...passes a live SELECT 1 probe before any AFTER snapshot query.
    const afterProbe = events.indexOf('query:#3:SELECT 1')
    const afterQuery = events.indexOf('query:#3:users')
    expect(afterProbe).toBeGreaterThan(upAt)
    expect(afterProbe).toBeLessThan(afterQuery)
    // 5. Clean shutdown of the AFTER client.
    expect(events).toContain('disconnect:#3')

    expect(log).toHaveBeenCalledWith(expect.stringContaining('seeded admin: present'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('sentinel patient: present'))
    log.mockRestore()
  })

  it('post-start readiness is bounded: an unreachable AFTER client fails before the snapshot', async () => {
    const h = makeHarness({ afterStartClientUnreachable: true })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const err = await runPersistenceVerification(h.deps, {
      root: REPO_ROOT,
      restart: true,
      ...QUICK,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(PersistenceVerificationError)
    expect(err.message).toContain('did not become ready within')

    // The real startup itself succeeded (its fresh client reached MySQL)...
    expect(h.callKeys()).toContain('npx prisma migrate deploy')
    // ...so the failure is the verifier's own bounded wait, which must not
    // take the AFTER snapshot and must release its client.
    const events = h.events()
    expect(events.some((e) => e.startsWith('query:#3:users'))).toBe(false)
    expect(events).toContain('disconnect:#3')
    log.mockRestore()
  })

  it('rows lost during the cycle fail the verification and name the table', async () => {
    const h = makeHarness({ rowLoss: { invoices: 1 } })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(
      runPersistenceVerification(h.deps, { root: REPO_ROOT, restart: true, ...QUICK })
    ).rejects.toThrow(/invoices lost rows \(1 -> 0\)/)
    log.mockRestore()
  })

  it('a re-run seed on a populated database is a data-safety violation and fails', async () => {
    const h = makeHarness({ dropAdminOnRestart: true })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(
      runPersistenceVerification(h.deps, { root: REPO_ROOT, restart: true, ...QUICK })
    ).rejects.toThrow(/RE-RAN the seed on a populated database/)
    // The startup did run the seed (admin missing at its seed decision)...
    expect(h.callKeys()).toContain('npx prisma db seed')
    // ...and the verifier stopped there, before the AFTER snapshot.
    expect(h.events().some((e) => e.startsWith('query:#3:'))).toBe(false)
    log.mockRestore()
  })
})

describe('runPersistenceVerification — without --restart', () => {
  it('snapshots, creates the sentinel if missing, and never touches compose', async () => {
    const h = makeHarness()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const result = await runPersistenceVerification(h.deps, {
      root: REPO_ROOT,
      restart: false,
      ...QUICK,
    })

    expect(h.callKeys().some((k) => k.includes('down') || k.includes('up -d'))).toBe(false)
    expect(result.after.patients).toBe(result.before.patients + 1) // sentinel
    expect(result.after.sentinelPresent).toBe(true)
    expect(result.after.users).toBe(result.before.users)
    expect(result.startup).toBeUndefined()
    // Two clients (BEFORE + AFTER), both cleanly disconnected.
    expect(h.events()).toContain('disconnect:#1')
    expect(h.events()).toContain('disconnect:#2')
    log.mockRestore()
  })

  it('an uninitialized database (no seeded admin) fails before any compose command', async () => {
    const h = makeHarness({ data: { admin: null } })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(
      runPersistenceVerification(h.deps, { root: REPO_ROOT, restart: true, ...QUICK })
    ).rejects.toThrow(/Seeded admin account missing/)

    expect(h.callKeys().some((k) => k.includes('down') || k.includes('up -d'))).toBe(false)
    expect(h.callKeys()).not.toContain('npx prisma db seed')
    expect(h.events()).toContain('disconnect:#1')
    log.mockRestore()
  })
})

describe('waitForDatabaseReady (shared bounded readiness primitive)', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1)))

  it('succeeds on the first live query, with no sleeping', async () => {
    const probe = vi.fn(async () => [{ 1: 1 }])
    const sleepFn = vi.fn(async () => undefined)
    const logFn = vi.fn()

    await waitForDatabaseReady({ $queryRawUnsafe: probe }, sleepFn, {
      timeoutMs: 50,
      intervalMs: 5,
      composeFile: COMPOSE_FILE,
      log: logFn,
    })

    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith('SELECT 1')
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('retries through failures until the live query succeeds, observably', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:3306'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:3306'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:3306'))
      .mockResolvedValueOnce([{ 1: 1 }])
    const sleepFn = vi.fn(async () => undefined)
    const logFn = vi.fn()

    await waitForDatabaseReady({ $queryRawUnsafe: probe }, sleepFn, {
      timeoutMs: 1000,
      intervalMs: 5,
      composeFile: COMPOSE_FILE,
      log: logFn,
    })

    expect(probe).toHaveBeenCalledTimes(4)
    expect(sleepFn).toHaveBeenCalledTimes(3)
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining('still waiting'))
  })

  it('is bounded: times out and reports the last error with compose diagnostics', async () => {
    const probe = vi.fn(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:3306')
    })
    const sleepFn = vi.fn(async () => undefined)

    const err = await waitForDatabaseReady({ $queryRawUnsafe: probe }, sleepFn, {
      timeoutMs: 50,
      intervalMs: 5,
      composeFile: COMPOSE_FILE,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(StartupError)
    expect(String(err)).toContain('did not become ready within')
    expect(String(err)).toContain('Last error: ECONNREFUSED 127.0.0.1:3306')
    expect(String(err)).toContain(`docker compose -f ${COMPOSE_FILE} ps`)
    expect(String(err)).toContain(`docker compose -f ${COMPOSE_FILE} logs mysql`)
    expect(sleepFn).toHaveBeenCalled()
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  parseEnvFileContent,
  loadDevEnvIntoProcess,
  assertDatabaseConfigured,
  EnvConfigError,
} from '@/scripts/lib/dev-env'
import { runSafeStartup, type DevStartDeps } from '@/scripts/dev-start'

// ROOT-FIX regression tests: plain tsx never loads .env, so scripts/dev-start.ts
// must load .env / .env.local itself (shell > .env.local > .env) BEFORE its own
// PrismaClient readiness probe — otherwise the probe looped on
// "Environment variable not found: DATABASE_URL" while MySQL was healthy.

describe('parseEnvFileContent (Next.js-style subset)', () => {
  it('parses KEY=VALUE with quotes, comments, export prefix and CRLF', () => {
    const out = parseEnvFileContent(
      [
        '# comment\r\n',
        '',
        'export DATABASE_URL="mysql://u:p@localhost:3306/db"',
        "AUTH_SECRET='abc'",
        'CRON_SECRET=xyz',
        'EMPTY=',
        '# trailing',
      ].join('\r\n')
    )
    expect(out.DATABASE_URL).toBe('mysql://u:p@localhost:3306/db')
    expect(out.AUTH_SECRET).toBe('abc')
    expect(out.CRON_SECRET).toBe('xyz')
    expect(out.EMPTY).toBeUndefined()
  })

  it('skips malformed lines and invalid key names', () => {
    const out = parseEnvFileContent('=nokey\n1BAD=x\nGOOD=1')
    expect(Object.keys(out)).toEqual(['GOOD'])
  })
})

describe('loadDevEnvIntoProcess (precedence: shell > .env.local > .env)', () => {
  let root: string
  let savedEnv: NodeJS.ProcessEnv
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'dentora-env-'))
    savedEnv = { ...process.env }
    delete process.env.DATABASE_URL
    delete process.env.AUTH_SECRET
  })
  afterEach(() => {
    process.env.DATABASE_URL = savedEnv.DATABASE_URL
    process.env.AUTH_SECRET = savedEnv.AUTH_SECRET
    rmSync(root, { recursive: true, force: true })
  })

  it('loads .env, then .env.local overriding it, never overwriting the shell', () => {
    writeFileSync(
      path.join(root, '.env'),
      'DATABASE_URL="mysql://from-env-file@localhost/db"\nSHARED=from-env\n'
    )
    writeFileSync(path.join(root, '.env.local'), 'DATABASE_URL="mysql://from-local@localhost/db"\n')
    const resolution = loadDevEnvIntoProcess(root)
    expect(resolution.databaseUrl).toBe('mysql://from-local@localhost/db')
    // shell always wins:
    process.env.DATABASE_URL = 'mysql://from-shell@localhost/db'
    const r2 = loadDevEnvIntoProcess(root)
    expect(r2.databaseUrl).toBe('mysql://from-shell@localhost/db')
  })

  it('missing files are simply absent (shell-only environments keep working)', () => {
    process.env.DATABASE_URL = 'mysql://shell-only@localhost/db'
    const resolution = loadDevEnvIntoProcess(root)
    expect(resolution.loaded).toEqual([])
    expect(resolution.databaseUrl).toBe('mysql://shell-only@localhost/db')
    expect(() => assertDatabaseConfigured(resolution)).not.toThrow()
  })

  it('empty/whitespace DATABASE_URL counts as missing (no placeholder credentials)', () => {
    writeFileSync(path.join(root, '.env'), 'DATABASE_URL="   "\n')
    const resolution = loadDevEnvIntoProcess(root)
    expect(() => assertDatabaseConfigured(resolution)).toThrow(EnvConfigError)
  })

  it('the actionable error names the sources and precedence but never secret values', () => {
    writeFileSync(
      path.join(root, '.env.local'),
      'DATABASE_URL="mysql://user:super-secret-value@localhost/db"\n'
    )
    const resolution = loadDevEnvIntoProcess(root)
    resolution.databaseUrl = undefined // force the failure path
    try {
      assertDatabaseConfigured(resolution)
      throw new Error('should have thrown')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toContain('.env.local')
      expect(message).toContain('Precedence')
      expect(message).not.toContain('super-secret-value')
    }
  })
})

describe('runSafeStartup — the orchestrator loads the environment before any database work', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'dentora-orch-'))
    delete process.env.DATABASE_URL // isolate from the vitest harness env
  })
  afterEach(() => {
    delete process.env.DATABASE_URL
    rmSync(root, { recursive: true, force: true })
  })

  function fakeDeps(): DevStartDeps & {
    seenDatabaseUrl: () => string | undefined
    probeUrl: () => string | undefined
  } {
    let seen: string | undefined
    let probeUrl: string | undefined
    let commands = 0
    return {
      runCommand: (async () => {
        // sequence: [1] `docker compose version` (resolveCompose), [2] compose
        // up; capture the process environment AT THE FIRST COMMAND.
        seen ??= process.env.DATABASE_URL
        commands += 1
        return commands <= 2
          ? { code: 0, stdout: '', stderr: '' }
          : { code: 1, stdout: '', stderr: 'unexpected extra command' }
      }) as DevStartDeps['runCommand'],
      createPrisma: (async (databaseUrl?: string) => {
        // record the EXPLICIT URL the orchestrator hands the probe client —
        // the real seam under investigation (loader -> resolution -> constructor).
        probeUrl = databaseUrl
        throw new Error('probe must not run before docker in this test')
      }) as DevStartDeps['createPrisma'],
      sleep: async () => {},
      seenDatabaseUrl: () => seen,
      probeUrl: () => probeUrl,
    }
  }

  it('hands the RESOLVED DATABASE_URL explicitly to the probe client constructor (no env-var indirection)', async () => {
    writeFileSync(
      path.join(root, '.env'),
      'DATABASE_URL="mysql://root:dental@localhost:3306/dental_erp"\n'
    )
    writeFileSync(path.join(root, 'docker-compose.dev.yml'), 'services: {}\n')
    const deps = fakeDeps()
    // the fake probe client throws its marker error the moment it is created —
    // proving the orchestrator passed the resolution straight to the constructor.
    await expect(
      runSafeStartup(deps, { root, readinessTimeoutMs: 10, intervalMs: 5 })
    ).rejects.toThrow(/probe must not run/)
    expect(deps.probeUrl()).toBe('mysql://root:dental@localhost:3306/dental_erp')
    expect(deps.seenDatabaseUrl()).toBe('mysql://root:dental@localhost:3306/dental_erp')
  })

  it('DATABASE_URL from .env is present in the process before the first command runs', async () => {
    writeFileSync(
      path.join(root, '.env'),
      'DATABASE_URL="mysql://root:dental@localhost:3306/dental_erp"\n'
    )
    writeFileSync(path.join(root, 'docker-compose.dev.yml'), 'services: {}\n')
    const deps = fakeDeps()
    // the fake docker succeeds -> the flow proceeds to the probe construction,
    // which the fake fails at its marker — past every environment-dependent step.
    await expect(
      runSafeStartup(deps, { root, readinessTimeoutMs: 10, intervalMs: 5 })
    ).rejects.toThrow(/probe must not run/)
    expect(deps.seenDatabaseUrl()).toBe('mysql://root:dental@localhost:3306/dental_erp')
  })

  it('fails fast with the actionable message when no configuration exists at all', async () => {
    const deps = fakeDeps()
    await expect(
      runSafeStartup(deps, { root, readinessTimeoutMs: 10, intervalMs: 5 })
    ).rejects.toThrow(/DATABASE_URL is not configured/)
    expect(deps.seenDatabaseUrl()).toBeUndefined() // never proceeded past the environment step
  })
})

/**
 * Failure classes that all PROVE the datasource URL was delivered to the
 * client. The point of this suite is that the URL reaches the constructor
 * without going through `process.env`, so any error in one of these classes is
 * evidence of success: the client got far enough to use the URL.
 *
 *   transport/connection .. prisma://, Can't reach, Connect, ECONNREFUSED,
 *                           getaddrinfo, protocol
 *   credential rejection .. Authentication failed, Access denied,
 *                           credentials ... not valid
 *
 * The credential-rejection alternatives were added 2026-10-28. Real message
 * recorded from a machine with a live MySQL on 127.0.0.1:3306:
 *   "Authentication failed against database server at `127.0.0.1`, the
 *    provided database credentials for `sentinel-user` are not valid."
 * That proves delivery just as well as a refused connection does — the client
 * parsed the URL and reached the server — but the original regex did not match
 * it, so the test failed for the wrong reason.
 *
 * Anything OUTSIDE this set (above all "Environment variable not found:
 * DATABASE_URL") means the seam regressed and must still fail.
 */
const DELIVERED_URL_FAILURE =
  /prisma:\/\/|Can't reach|Connect|ECONNREFUSED|getaddrinfo|protocol|Authentication failed|Access denied|credentials .* not valid/i

describe('the REAL PrismaClient receives the explicit datasource URL without process.env', () => {
  it('the accepted-failure pattern does NOT match an env-not-found message (negative case)', () => {
    // Guards the guard. Without this, someone could loosen DELIVERED_URL_FAILURE
    // to something like /.*/ and the test below would pass for the wrong
    // reason, silently hiding exactly the regression this suite exists to
    // catch. Stubbed string — no real client needed.
    const envNotFound = [
      'Invalid `prisma.$queryRawUnsafe()` invocation:',
      'error: Environment variable not found: DATABASE_URL.',
    ].join('\n')
    expect(envNotFound).toContain('Environment variable not found: DATABASE_URL')
    expect(DELIVERED_URL_FAILURE.test(envNotFound)).toBe(false)
  })

  it('the accepted-failure pattern DOES match a credential rejection (the 2026-10-28 case)', () => {
    // The real message that made the old assertion fail. Stubbed string — this
    // documents the contract without needing a live MySQL.
    const authRejected =
      'Authentication failed against database server at `127.0.0.1`, ' +
      'the provided database credentials for `sentinel-user` are not valid.'
    expect(authRejected).not.toContain('Environment variable not found: DATABASE_URL')
    expect(DELIVERED_URL_FAILURE.test(authRejected)).toBe(true)
  })

  it('constructing with { datasources: { db: { url } } } never fails with env-not-found', async () => {
    // Start from the exact failure state: DATABASE_URL absent from process.env.
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const { PrismaClient } = await import('@prisma/client')
      const client = new PrismaClient({
        datasources: {
          db: { url: 'mysql://sentinel-user:not-a-secret@127.0.0.1:3306/dental_erp' },
        },
      } as never)
      try {
        await client.$queryRawUnsafe('SELECT 1')
        expect(true).toBe(true) // a live MySQL would land here — also acceptable
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // UNCHANGED: the whole point of the test. The URL was DELIVERED, so the
        // failure can never be the missing environment variable.
        expect(msg).not.toContain('Environment variable not found: DATABASE_URL')
        // WIDENED 2026-10-28: also accept the server rejecting the delivered
        // credentials. See DELIVERED_URL_FAILURE for the justification and the
        // real message. The assertion above is untouched.
        expect(DELIVERED_URL_FAILURE.test(msg)).toBe(true)
      } finally {
        await client.$disconnect().catch(() => {})
      }
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
    }
  })
})

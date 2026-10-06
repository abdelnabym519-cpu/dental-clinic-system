/**
 * Development-environment resolution for the dev startup path.
 *
 * ROOT FIX (environment graph): a plain `tsx`/`node` process never loads
 * `.env` files — only the Prisma CLI and `next dev` do. scripts/dev-start.ts
 * validated that `.env` EXISTS but never loaded it, so its own PrismaClient
 * readiness probe ran with no DATABASE_URL and looped on
 * "Environment variable not found: DATABASE_URL" while MySQL was healthy.
 *
 * Canonical contract (deliberately identical to Next.js precedence):
 *
 *   real shell environment  >  .env.local  >  .env
 *
 * Values are injected ONLY into unset/empty process.env keys, so the shell
 * always wins and `.env.local` overrides `.env`. Secret VALUES are never
 * logged, returned, or embedded in errors — only file names and key counts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Actionable, secret-free configuration failure. */
export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvConfigError'
  }
}

/**
 * Parse the Next.js-style subset used by this repository's env files:
 * KEY=VALUE lines, `#` comments, surrounding single/double quotes, an
 * optional `export ` prefix, CRLF tolerance. Lines with empty values are
 * treated as absent (a placeholder credential is not a configuration).
 */
export function parseEnvFileContent(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trim()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    if (value.length === 0) continue
    out[key] = value
  }
  return out
}

export interface DevEnvResolution {
  /** Files actually applied, in application order, with applied-key counts. */
  loaded: Array<{ file: string; keys: number }>
  /** The effective DATABASE_URL (may come from the shell or an env file). */
  databaseUrl: string | undefined
}

/**
 * Load the canonical development environment into `env` (default
 * process.env) and report the effective DATABASE_URL. Shell keys are never
 * overwritten; `.env.local` is applied after `.env`, so it overrides it.
 */
export function loadDevEnvIntoProcess(
  root: string,
  env: NodeJS.ProcessEnv = process.env
): DevEnvResolution {
  // Snapshot the REAL shell keys first: the shell must always win over any
  // file, while `.env.local` must still be able to override `.env`
  // (file-vs-file precedence). Applying with this snapshot gives exactly
  // the Next.js order: shell > .env.local > .env.
  const shellKeys = new Set(Object.keys(env))
  const loaded: Array<{ file: string; keys: number }> = []
  for (const name of ['.env', '.env.local']) {
    const file = path.join(root, name)
    if (!existsSync(file)) continue
    const parsed = parseEnvFileContent(readFileSync(file, 'utf8'))
    let applied = 0
    for (const [key, value] of Object.entries(parsed)) {
      if (!shellKeys.has(key) || env[key] === '' || env[key] === undefined) {
        env[key] = value
        applied++
      }
    }
    loaded.push({ file: name, keys: applied })
  }
  const databaseUrl = (env.DATABASE_URL ?? '').trim() || undefined
  return { loaded, databaseUrl }
}

/**
 * Fail with a precise, actionable, secret-free error when the effective
 * configuration still has no DATABASE_URL.
 */
export function assertDatabaseConfigured(resolution: DevEnvResolution): void {
  if (resolution.databaseUrl) return
  throw new EnvConfigError(
    [
      'DATABASE_URL is not configured (checked the shell, .env and .env.local).',
      '  Create one first:',
      '    cp .env.example .env',
      '  then set DATABASE_URL to match docker-compose.dev.yml:',
      '    DATABASE_URL="mysql://root:dental@localhost:3306/dental_erp"',
      '  and fill in NEXTAUTH_SECRET, ENCRYPTION_KEY and CRON_SECRET (see .env.example).',
      '  Precedence: shell environment > .env.local > .env (Next.js-compatible).',
    ].join('\n')
  )
}

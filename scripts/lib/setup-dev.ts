/**
 * Local development environment bootstrap (pure core — see scripts/setup-dev.ts
 * for the CLI). One deterministic recovery path to a STARTABLE .env:
 *
 *   npm run setup:dev
 *
 * Guarantees (all pinned by tests/unit/setup-dev.test.ts):
 *   - creates .env from .env.example when missing (template = single source of truth)
 *   - NEVER overwrites existing non-empty values in an existing .env
 *   - fills ONLY the required keys that are absent/empty:
 *       DATABASE_URL      -> the compose-matching template value
 *       NEXTAUTH_SECRET   -> crypto-random base64 (32 bytes)
 *       ENCRYPTION_KEY    -> crypto-random hex (32 bytes = AES-256)
 *       CRON_SECRET       -> crypto-random hex (16 bytes)
 *   - generated values are written to .env ONLY — never logged, never returned
 *   - .env.local is never read for values here nor modified
 *   - idempotent: a second run changes nothing
 *   - never touches the database or Docker
 */
import { randomBytes } from 'node:crypto'
import { parseEnvFileContent } from './dev-env'

/** The required keys this bootstrap guarantees. */
export const REQUIRED_KEYS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'ENCRYPTION_KEY',
  'CRON_SECRET',
] as const

export type SecretGenerator = () => string

/** Generators matching the documented commands in .env.example verbatim. */
export const SECRET_GENERATORS: Record<string, SecretGenerator> = {
  NEXTAUTH_SECRET: () => randomBytes(32).toString('base64'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('hex'),
  CRON_SECRET: () => randomBytes(16).toString('hex'),
}

export interface SetupPlanEntry {
  key: string
  action: 'kept' | 'generated' | 'from-template'
}

export interface SetupPlan {
  /** ordered plan entries for the required keys */
  entries: SetupPlanEntry[]
  /** the full .env content to write (existing content preserved + additions) */
  content: string
  /** true when the .env did not exist and was created from the template */
  createdFresh: boolean
}

function generatedValueFor(key: string, generate: SecretGenerator): string {
  if (key === 'DATABASE_URL') throw new Error('DATABASE_URL is not a generated secret')
  return SECRET_GENERATORS[key] ? generate() : 'GENERATED'
}

/**
 * Build the setup plan from the template and the (optional) existing .env.
 * `generate` is injectable for deterministic tests.
 */
export function planDevEnv(
  templateContent: string,
  existingContent: string | undefined,
  generate: SecretGenerator = () => 'GENERATED'
): SetupPlan {
  const template = parseEnvFileContent(templateContent)
  const existing = existingContent === undefined ? undefined : parseEnvFileContent(existingContent)
  const entries: SetupPlanEntry[] = []

  // A value counts as present only when non-empty (same semantics as the
  // loader: empty = placeholder = absent — never boot on empty credentials).
  const present = (key: string) => existing !== undefined && (existing[key] ?? '').trim() !== ''

  // The raw value of an ACTIVE `KEY=...` line (comments skipped), or undefined
  // when the key does not appear. Unlike parseEnvFileContent (which drops
  // empty values — correct for the loader), this SEES `KEY=""` so the
  // bootstrap can fill placeholders. Returns the raw right-hand side.
  function rawActiveValue(content: string, key: string): string | undefined {
    for (const rawLine of content.split(/\r?\n/)) {
      let line = rawLine.trim()
      if (line === '' || line.startsWith('#')) continue
      if (line.startsWith('export ')) line = line.slice(7).trim()
      const m = new RegExp(`^${key}=(.*)$`).exec(line)
      if (!m) continue
      let value = m[1].trim()
      // Strip one pair of matching quotes so `KEY=""` is seen as EMPTY
      // (same semantics as the parser's value handling).
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1)
      }
      return value
    }
    return undefined
  }

  // Fresh creation: the template is the single source of truth. Scan RAW
  // lines (the parser drops empty values by design, but the bootstrap must
  // see `NEXTAUTH_SECRET=""` to fill it).
  if (existing === undefined) {
    let content = templateContent
    for (const key of REQUIRED_KEYS) {
      const rawValue = rawActiveValue(templateContent, key)
      if (rawValue === undefined) continue // key not part of this template
      if (rawValue.trim() !== '') {
        entries.push({ key, action: 'kept' })
        continue
      }
      if (key === 'DATABASE_URL') {
        entries.push({ key, action: 'from-template' })
        continue
      }
      content = content.replace(
        new RegExp(`^${key}=""\\s*$`, 'm'),
        `${key}="${generatedValueFor(key, generate)}"`
      )
      entries.push({ key, action: 'generated' })
    }
    // The template's DATABASE_URL is already the compose-matching value.
    return { entries, content, createdFresh: true }
  }

  // Existing .env: preserve verbatim; append ONLY missing required keys.
  for (const key of REQUIRED_KEYS) {
    if (present(key)) {
      entries.push({ key, action: 'kept' })
    } else {
      entries.push({
        key,
        action: key === 'DATABASE_URL' ? 'from-template' : 'generated',
      })
    }
  }
  const additions = entries.filter((e) => e.action !== 'kept')
  let content = existingContent ?? ''
  if (additions.length > 0) {
    if (!content.endsWith('\n')) content += '\n'
    content += '\n# ── added by `npm run setup:dev` (missing required keys) ──\n'
    for (const e of additions) {
      const value =
        e.action === 'from-template'
          ? (template.DATABASE_URL ?? '').trim()
          : generatedValueFor(e.key, generate)
      if (value === '') {
        throw new Error(
          'No DATABASE_URL available: .env.example has no active DATABASE_URL and .env does not define one.'
        )
      }
      content += `${e.key}="${value}"\n`
    }
  }
  return { entries, content, createdFresh: false }
}

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
 *       DATABASE_URL        -> the compose-matching template value
 *       NEXTAUTH_SECRET     -> crypto-random base64 (32 bytes)
 *       ENCRYPTION_KEY      -> crypto-random hex (32 bytes = AES-256)
 *       CRON_SECRET         -> crypto-random hex (16 bytes)
 *       ORCHESTRATOR_SECRET -> crypto-random hex (32 bytes; app<->orchestrator)
 *   - generated values are written to .env ONLY — never logged, never returned
 *   - .env.local is never read for values here nor modified
 *   - idempotent: a second run changes nothing
 *   - never touches the database or Docker
 */
import { randomBytes } from 'node:crypto'
import { parseEnvFileContent } from './dev-env'
import { STORAGE_ENV_KEYS } from '../../lib/storage/env'
import type { StorageEnvKey } from '../../lib/storage/env'
import { readComposeStorageDefaultsFromRoot } from './compose-storage'
import type { ComposeStorageValues } from './compose-storage'

/** The required keys this bootstrap guarantees. */
export const REQUIRED_KEYS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'ENCRYPTION_KEY',
  'CRON_SECRET',
  'ORCHESTRATOR_SECRET',
] as const

/**
 * Storage variables the bootstrap guarantees to exist BY NAME.
 *
 * P9.1: the imaging `NoSuchKey` was a disagreement between two readers of the
 * same objects - the app (lib/storage, whose driver defaults to `local`) and
 * the orchestrator (which reads MinIO/S3 directly). Neither side could see the
 * other's configuration because the variable names were never declared
 * anywhere both read. The list is imported from the SAME module the runtime
 * factory uses, so the bootstrap and the factory cannot drift apart again.
 *
 * Deliberately NOT part of REQUIRED_KEYS: these are filled from the template
 * (or from the documented dev defaults) and are never crypto-generated, so the
 * existing "exactly four generated secrets" contract is untouched.
 */
export const STORAGE_KEYS: readonly string[] = STORAGE_ENV_KEYS

export type SecretGenerator = (key: string) => string

/** Generators matching the documented commands in .env.example verbatim. */
export const SECRET_GENERATORS: Record<string, SecretGenerator> = {
  NEXTAUTH_SECRET: () => randomBytes(32).toString('base64'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('hex'),
  CRON_SECRET: () => randomBytes(16).toString('hex'),
  // Internal app↔orchestrator shared secret (X-Orchestrator-Secret). The AI
  // compose stack fail-fasts without it (ai-compose.yml ${ORCHESTRATOR_SECRET:?})
  // and the app's agent/imaging routes throw when it is unset — so the
  // bootstrap must guarantee it like the other secrets.
  ORCHESTRATOR_SECRET: () => randomBytes(32).toString('hex'),
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
  return SECRET_GENERATORS[key] ? generate(key) : 'GENERATED'
}

/**
 * Build the setup plan from the template and the (optional) existing .env.
 * `generate` is injectable for deterministic tests.
 */
export function planDevEnv(
  templateContent: string,
  existingContent: string | undefined,
  // Default: the REAL crypto generators (the CLI relies on this — it never
  // passes its own). Tests inject a deterministic generator instead.
  generate: SecretGenerator = (key) => SECRET_GENERATORS[key]?.(key) ?? 'GENERATED',
  // Storage values the template does not carry. Derived from
  // docker-compose.dev.yml by default — NEVER hardcoded in source.
  storageDefaults: ComposeStorageValues = readComposeStorageDefaultsFromRoot()
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

    /**
     * P9.1: guarantee the storage variable NAMES exist, so the app and the
     * orchestrator are configured from one vocabulary. An existing non-empty
     * value is NEVER overwritten.
     */
    function ensureStorageKeys(content: string): {
      content: string
      actions: Array<{ key: string; action: SetupPlanEntry['action'] }>
    } {
      const actions: Array<{ key: string; action: SetupPlanEntry['action'] }> = []
      const missing = STORAGE_KEYS.filter((key) => {
        const raw = rawActiveValue(content, key)
        return raw === undefined || raw.trim() === ''
      })
      if (missing.length === 0) {
        for (const key of STORAGE_KEYS) actions.push({ key, action: 'kept' })
        return { content, actions }
      }
      let out = content
      if (!out.endsWith('\n')) out += '\n'
      out += '\n# -- storage: added by `npm run setup:dev` (single source of truth: lib/storage/env.ts) --\n'
      for (const key of STORAGE_KEYS) {
        const existing = rawActiveValue(out, key)
        if (existing !== undefined && existing.trim() !== '') {
          actions.push({ key, action: 'kept' })
          continue
        }
        const fromTemplate = (template[key] ?? '').trim()
        const value =
          fromTemplate !== '' ? fromTemplate : (storageDefaults[key as StorageEnvKey] ?? '')
        if (value === '') {
          // Fail loud rather than write an empty credential: an empty S3_*
          // would silently leave the app on local disk while the orchestrator
          // reads MinIO — the exact drift this step exists to prevent.
          throw new Error(
            `No value for storage key ${key}: it is not in .env.example and could not be derived from docker-compose.dev.yml.`
          )
        }
        out += `${key}="${value}"\n`
        actions.push({ key, action: 'from-template' })
      }
      return { content: out, actions }
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
    const withStorage = ensureStorageKeys(content)
    for (const a of withStorage.actions) entries.push(a)
    return { entries, content: withStorage.content, createdFresh: true }
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
  const stor = ensureStorageKeys(content)
  for (const a of stor.actions) entries.push(a)
  return { entries, content: stor.content, createdFresh: false }
}

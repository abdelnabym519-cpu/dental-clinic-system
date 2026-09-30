/**
 * Phase 11 — Version contract (§57).
 *
 * ONE version source: package.json. `GIT_SHA` may be injected at build/deploy
 * time for the exact commit; nothing else may define an application version.
 * Consumed by /api/health, /api/ready, logs, and diagnostics.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

let cached: { version: string; gitSha: string | null } | null = null

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** The single canonical application version (semver from package.json). */
export function appVersion(): string {
  if (!cached) {
    cached = {
      version: process.env.APP_VERSION || readPackageVersion(),
      gitSha: process.env.GIT_SHA ? String(process.env.GIT_SHA).slice(0, 12) : null,
    }
  }
  return cached.version
}

/** Best-effort release commit (injected by CI/deploy; never guessed). */
export function releaseRevision(): string | null {
  return appVersion() === cached?.version ? cached?.gitSha ?? null : null
}

/** One-line version stamp for logs and diagnostics. */
export function versionStamp(): string {
  const sha = releaseRevision()
  return sha ? `${appVersion()}+${sha}` : appVersion()
}

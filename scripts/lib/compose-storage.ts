/**
 * Storage defaults DERIVED from docker-compose.dev.yml.
 *
 * Why this module exists: NO credential may be hardcoded in source. The local
 * MinIO credentials live in exactly one place — the compose file — and this
 * module reads them from there at bootstrap time. If the compose file changes,
 * the bootstrap follows automatically; if a value cannot be derived, the
 * bootstrap FAILS LOUDLY rather than inventing one.
 *
 * Nothing here logs a value, and no value is ever returned into a report or a
 * commit message. Callers write these straight into `.env`, which is gitignored.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Protocol facts that are NOT credentials and do not appear in compose:
 * MinIO's default region, and the fact that MinIO (like most non-AWS S3
 * implementations) requires path-style addressing.
 */
export const STORAGE_PROTOCOL_DEFAULTS = {
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
} as const

/** The storage values this module is responsible for deriving. */
export const COMPOSE_DERIVED_KEYS = [
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
] as const

export type ComposeStorageValues = Record<string, string>

function required(src: string, re: RegExp, what: string): string {
  const m = re.exec(src)
  if (!m || !m[1]) {
    throw new Error(
      `Cannot derive ${what} from docker-compose.dev.yml — refusing to invent a storage value. ` +
        `Add it to the minio service in docker-compose.dev.yml, or set it yourself in .env.`,
    )
  }
  return m[1].trim()
}

/**
 * Isolate one top-level compose service block by name, so that a later
 * service that merely *mentions* MinIO can never be picked up by mistake.
 */
function serviceBlock(composeYml: string, name: string): string {
  const header = new RegExp(`^ {2}${name}:\\s*$`, 'm')
  const start = composeYml.search(header)
  if (start === -1) throw new Error(`docker-compose.dev.yml has no "${name}" service`)
  const after = composeYml.slice(start)
  const rel = after.slice(2).search(/^ {2}[A-Za-z0-9_-]+:\s*$/m)
  return rel === -1 ? after : after.slice(0, rel + 2)
}

/**
 * Parse the compose file into the storage values the app needs.
 * Throws with a precise, actionable message when a value cannot be derived.
 */
export function readComposeStorageDefaults(composeYml: string): ComposeStorageValues {
  const minio = serviceBlock(composeYml, 'minio')

  const accessKey = required(minio, /MINIO_ROOT_USER:\s*(\S+)/, 'S3_ACCESS_KEY')
  const secretKey = required(minio, /MINIO_ROOT_PASSWORD:\s*(\S+)/, 'S3_SECRET_KEY')
  const hostPort = required(minio, /-\s*['"]?(\d+):9000['"]?/, 'S3_ENDPOINT host port')

  // The bucket is created by the one-shot `createbuckets` service, so it is
  // read from the whole file rather than from the minio block.
  const bucket = required(
    composeYml,
    /mc\s+mb\s+(?:--ignore-existing\s+)?local\/([A-Za-z0-9._-]+)/,
    'S3_BUCKET',
  )

  return {
    S3_ENDPOINT: `http://localhost:${hostPort}`,
    S3_ACCESS_KEY: accessKey,
    S3_SECRET_KEY: secretKey,
    S3_BUCKET: bucket,
    ...STORAGE_PROTOCOL_DEFAULTS,
  }
}

/** Convenience for the CLI: read the real compose file at the repository root. */
export function readComposeStorageDefaultsFromRoot(
  root: string = path.resolve(__dirname, '../..'),
): ComposeStorageValues {
  return readComposeStorageDefaults(readFileSync(path.join(root, 'docker-compose.dev.yml'), 'utf8'))
}

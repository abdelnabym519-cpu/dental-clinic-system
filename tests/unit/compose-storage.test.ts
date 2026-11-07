import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

import {
  COMPOSE_DERIVED_KEYS,
  STORAGE_PROTOCOL_DEFAULTS,
  readComposeStorageDefaults,
  readComposeStorageDefaultsFromRoot,
} from '../../scripts/lib/compose-storage'

/**
 * P9.1 follow-up — NO credential may be hardcoded in source.
 *
 * Every storage value that is a credential or a deployment detail is read out
 * of `docker-compose.dev.yml` at bootstrap time. If it cannot be read, the
 * bootstrap fails loudly instead of inventing a value, because an invented (or
 * empty) S3_* is exactly what let the app write to local disk while the
 * orchestrator read MinIO.
 */
const root = path.resolve(__dirname, '../..')
const compose = () => readFileSync(path.join(root, 'docker-compose.dev.yml'), 'utf8')

describe('storage defaults are DERIVED from docker-compose.dev.yml', () => {
  it('derives every credential-bearing key from the real compose file', () => {
    const values = readComposeStorageDefaultsFromRoot(root)
    for (const key of COMPOSE_DERIVED_KEYS) {
      expect(typeof values[key], `${key} derived`).toBe('string')
      expect(values[key].length, `${key} non-empty`).toBeGreaterThan(0)
    }
  })

  it('S3_ACCESS_KEY comes from MINIO_ROOT_USER', () => {
    const yml = compose()
    const user = /MINIO_ROOT_USER:\s*(\S+)/.exec(yml)![1]
    expect(readComposeStorageDefaults(yml).S3_ACCESS_KEY).toBe(user)
  })

  it('S3_SECRET_KEY comes from MINIO_ROOT_PASSWORD', () => {
    const yml = compose()
    const pass = /MINIO_ROOT_PASSWORD:\s*(\S+)/.exec(yml)![1]
    expect(readComposeStorageDefaults(yml).S3_SECRET_KEY).toBe(pass)
  })

  it('S3_ENDPOINT is built from the published 9000 port', () => {
    const values = readComposeStorageDefaults(compose())
    expect(values.S3_ENDPOINT).toMatch(/^http:\/\/localhost:\d+$/)
    expect(values.S3_ENDPOINT).toBe('http://localhost:9000')
  })

  it('S3_BUCKET comes from the one-shot createbuckets service', () => {
    const yml = compose()
    const bucket = /mc\s+mb\s+(?:--ignore-existing\s+)?local\/([A-Za-z0-9._-]+)/.exec(yml)![1]
    expect(readComposeStorageDefaults(yml).S3_BUCKET).toBe(bucket)
  })

  it('adds the non-secret protocol constants', () => {
    const values = readComposeStorageDefaults(compose())
    expect(values.S3_REGION).toBe(STORAGE_PROTOCOL_DEFAULTS.S3_REGION)
    expect(values.S3_FORCE_PATH_STYLE).toBe(STORAGE_PROTOCOL_DEFAULTS.S3_FORCE_PATH_STYLE)
  })
})

describe('the derivation fails loud rather than inventing a value', () => {
  it('throws when there is no minio service', () => {
    expect(() => readComposeStorageDefaults('services:\n  other:\n    image: x\n')).toThrow(
      /no "minio" service/,
    )
  })

  it('throws when MINIO_ROOT_USER is missing (never guesses an access key)', () => {
    const yml = compose().replace(/^\s*MINIO_ROOT_USER:.*$/m, '')
    expect(() => readComposeStorageDefaults(yml)).toThrow(/S3_ACCESS_KEY/)
  })

  it('throws when MINIO_ROOT_PASSWORD is missing (never guesses a secret)', () => {
    const yml = compose().replace(/^\s*MINIO_ROOT_PASSWORD:.*$/m, '')
    expect(() => readComposeStorageDefaults(yml)).toThrow(/S3_SECRET_KEY/)
  })

  it('throws when the bucket command is missing', () => {
    const yml = compose().replace(/mc\s+mb\s+--ignore-existing\s+local\/\S+/, '')
    expect(() => readComposeStorageDefaults(yml)).toThrow(/S3_BUCKET/)
  })
})

describe('service isolation', () => {
  it('ignores a LATER service that also mentions MINIO_ROOT_*', () => {
    const yml =
      compose() +
      '\n  decoy:\n    image: x\n    environment:\n      MINIO_ROOT_USER: WRONG\n      MINIO_ROOT_PASSWORD: WRONG\n'
    const values = readComposeStorageDefaults(yml)
    expect(values.S3_ACCESS_KEY).not.toBe('WRONG')
    expect(values.S3_SECRET_KEY).not.toBe('WRONG')
  })
})

describe('the single-source rule holds across the whole storage path', () => {
  it('no MinIO credential literal exists in lib/ or scripts/', () => {
    for (const f of [
      'lib/storage/env.ts',
      'lib/storage/index.ts',
      'scripts/lib/compose-storage.ts',
      'scripts/lib/setup-dev.ts',
      'scripts/setup-dev.ts',
    ]) {
      const src = readFileSync(path.join(root, f), 'utf8')
      expect(src, `${f} must not contain a MinIO credential`).not.toMatch(/dentalerp123/)
      expect(src, `${f} must not contain a MinIO user`).not.toMatch(/dentalerp\b/)
    }
  })

  it('...but the compose file itself still declares them (that is the source)', () => {
    const yml = compose()
    expect(yml).toMatch(/MINIO_ROOT_USER:/)
    expect(yml).toMatch(/MINIO_ROOT_PASSWORD:/)
  })
})

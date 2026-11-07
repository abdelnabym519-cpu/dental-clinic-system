import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  STORAGE_ENV_KEYS,
  STORAGE_PROTOCOL_DEFAULTS,
  STORAGE_DRIVER_NAMES,
  isValidStorageDriver,
  readStorageDriver,
  orchestratorCanReadDriver,
  isOrchestratorConfigured,
  missingStorageEnvKeys,
} from '@/lib/storage/env'

/**
 * P9.1 — the storage variables have exactly ONE definition, and the code can
 * answer the question that produced the imaging `NoSuchKey`: can the
 * orchestrator actually read what this process just wrote?
 */
describe('storage env — single source of truth', () => {
  it('names all eight storage variables', () => {
    expect([...STORAGE_ENV_KEYS]).toEqual([
      'STORAGE_DRIVER',
      'UPLOAD_DIR',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_BUCKET',
      'S3_REGION',
      'S3_FORCE_PATH_STYLE',
    ])
  })

  it('ships NO credential in source — secrets come from compose or .env', () => {
    const src = readFileSync(path.resolve(__dirname, '../../lib/storage/env.ts'), 'utf8')
    expect(src, 'no dev MinIO credential may live here').not.toMatch(/dentalerp/)
    expect(src).not.toMatch(/MINIO_ROOT_(USER|PASSWORD)\s*:/)
    for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET']) {
      expect(src, `${key} must not be assigned a value here`).not.toMatch(
        new RegExp(`${key}:\\s*['"]`),
      )
    }
  })

  it('ships only the non-secret protocol constants', () => {
    expect(STORAGE_PROTOCOL_DEFAULTS).toEqual({
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: 'true',
    })
    // Protocol facts, not credentials: short and structureless.
    for (const v of Object.values(STORAGE_PROTOCOL_DEFAULTS)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeLessThan(20)
    }
  })

  it('exposes exactly the drivers the factory implements', () => {
    expect([...STORAGE_DRIVER_NAMES]).toEqual(['local', 's3'])
    expect(isValidStorageDriver('local')).toBe(true)
    expect(isValidStorageDriver('s3')).toBe(true)
    expect(isValidStorageDriver('minio')).toBe(false)
    expect(isValidStorageDriver('LOCAL')).toBe(false) // case-sensitive
    expect(isValidStorageDriver(undefined)).toBe(false)
  })
})

describe('readStorageDriver', () => {
  it('defaults to local when the variable is absent, empty or blank', () => {
    expect(readStorageDriver({})).toBe('local')
    expect(readStorageDriver({ STORAGE_DRIVER: '' })).toBe('local')
    expect(readStorageDriver({ STORAGE_DRIVER: '   ' })).toBe('local')
  })

  it('reads s3 case-insensitively and tolerates surrounding whitespace', () => {
    expect(readStorageDriver({ STORAGE_DRIVER: 's3' })).toBe('s3')
    expect(readStorageDriver({ STORAGE_DRIVER: 'S3' })).toBe('s3')
    expect(readStorageDriver({ STORAGE_DRIVER: ' s3 ' })).toBe('s3')
  })

  it('falls back to local for an unknown driver rather than throwing', () => {
    expect(readStorageDriver({ STORAGE_DRIVER: 'minio' })).toBe('local')
  })
})

describe('orchestratorCanReadDriver — the NoSuchKey rule', () => {
  it('can read s3', () => {
    expect(orchestratorCanReadDriver('s3')).toBe(true)
  })

  it('CANNOT read local disk — this is the bug being guarded', () => {
    expect(orchestratorCanReadDriver('local')).toBe(false)
  })

  it('the default driver is therefore NOT orchestrator-readable', () => {
    // Regression pin: a fresh install writes to local disk, so an out-of-the-box
    // deployment can never successfully analyze an imaging study until the
    // operator sets STORAGE_DRIVER=s3. The pre-flight must say so in Arabic.
    expect(orchestratorCanReadDriver(readStorageDriver({}))).toBe(false)
  })
})

describe('isOrchestratorConfigured', () => {
  it('is false without ORCHESTRATOR_SECRET', () => {
    expect(isOrchestratorConfigured({})).toBe(false)
    expect(isOrchestratorConfigured({ ORCHESTRATOR_SECRET: '' })).toBe(false)
    expect(isOrchestratorConfigured({ ORCHESTRATOR_SECRET: '  ' })).toBe(false)
  })

  it('is true when the shared secret is set', () => {
    expect(isOrchestratorConfigured({ ORCHESTRATOR_SECRET: 'abc' })).toBe(true)
  })
})

describe('missingStorageEnvKeys', () => {
  it('reports every key when the environment is empty', () => {
    expect(missingStorageEnvKeys({})).toEqual([...STORAGE_ENV_KEYS])
  })

  it('reports nothing when all keys are set', () => {
    const env = Object.fromEntries(STORAGE_ENV_KEYS.map((k) => [k, 'x']))
    expect(missingStorageEnvKeys(env)).toEqual([])
  })

  it('treats a blank value as missing (never boot on empty credentials)', () => {
    const env = Object.fromEntries(STORAGE_ENV_KEYS.map((k) => [k, 'x']))
    expect(missingStorageEnvKeys({ ...env, S3_BUCKET: '   ' })).toEqual(['S3_BUCKET'])
  })
})

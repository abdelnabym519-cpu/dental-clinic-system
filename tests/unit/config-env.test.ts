/**
 * Phase 11 — environment configuration contract (§7/§8) + version (§57).
 */
import { describe, it, expect } from 'vitest'
import {
  currentEnvironment,
  isSecretVar,
  requireValidEnvironment,
  validateEnvironment,
} from '@/lib/config/env'
import { appVersion, versionStamp } from '@/lib/config/version'

const PROD: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://prod:strong@db:3306/dental',
  NEXTAUTH_SECRET: 'a-very-long-production-secret-value',
  NEXTAUTH_URL: 'https://clinic.example.com',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://minio:9000',
  S3_BUCKET: 'dentora',
  S3_ACCESS_KEY_ID: 'AKIA-example-key-0001',
  S3_SECRET_ACCESS_KEY: 's3-secret-that-is-long-enough',
}

describe('currentEnvironment (§8 — NODE_ENV is not the only control)', () => {
  it('resolves the explicit APP_ENV first', () => {
    expect(currentEnvironment({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe('staging')
  })
  it('maps NODE_ENV and CI', () => {
    expect(currentEnvironment({ NODE_ENV: 'production' })).toBe('production')
    expect(currentEnvironment({ NODE_ENV: 'test' })).toBe('test')
    expect(currentEnvironment({ CI: 'true' })).toBe('ci')
    expect(currentEnvironment({})).toBe('development')
  })
})

describe('validateEnvironment (fail fast, never silently unsafe)', () => {
  it('a complete production environment has no problems', () => {
    expect(validateEnvironment(PROD)).toEqual([])
  })

  it('a missing production secret is a MISSING_REQUIRED problem', () => {
    const broken = { ...PROD }
    delete broken.NEXTAUTH_SECRET
    const problems = validateEnvironment(broken)
    expect(problems.map((p) => p.var)).toContain('NEXTAUTH_SECRET')
    expect(problems[0].kind).toBe('MISSING_REQUIRED')
  })

  it('s3 credentials are required ONLY when the s3 driver is selected', () => {
    const localDriver = { ...PROD, STORAGE_DRIVER: 'local' }
    delete localDriver.S3_ACCESS_KEY_ID
    delete localDriver.S3_SECRET_ACCESS_KEY
    expect(validateEnvironment(localDriver)).toEqual([])
  })

  it('short production secrets are flagged as INSECURE_VALUE', () => {
    expect(validateEnvironment({ ...PROD, NEXTAUTH_SECRET: 'short' }).map((p) => p.kind)).toContain('INSECURE_VALUE')
  })

  it('development may omit production-only vars entirely', () => {
    expect(validateEnvironment({ NODE_ENV: 'development' })).toEqual([])
  })
})

describe('requireValidEnvironment (deployment preflight gate)', () => {
  it('passes silently for a valid production env', () => {
    expect(() => requireValidEnvironment(PROD)).not.toThrow()
  })

  it('throws naming the VARIABLE but never its value (no secret leakage)', () => {
    const broken = { ...PROD }
    delete broken.DATABASE_URL
    try {
      requireValidEnvironment(broken)
      expect.unreachable('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('DATABASE_URL')
      expect(msg).not.toContain('mysql://')
    }
  })
})

describe('secret classification', () => {
  it('credential variables are classified secret', () => {
    expect(isSecretVar('DATABASE_URL')).toBe(true)
    expect(isSecretVar('NEXTAUTH_SECRET')).toBe(true)
    expect(isSecretVar('S3_SECRET_ACCESS_KEY')).toBe(true)
    expect(isSecretVar('NEXTAUTH_URL')).toBe(false)
    expect(isSecretVar('APP_VERSION')).toBe(false)
  })
})

describe('version contract (§57 — one source)', () => {
  it('exposes the package.json version everywhere', () => {
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/)
    expect(versionStamp()).toContain(appVersion())
  })
})

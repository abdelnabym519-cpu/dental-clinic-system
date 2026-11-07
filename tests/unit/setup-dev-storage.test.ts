import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseEnvFileContent } from '../../scripts/lib/dev-env'
import { planDevEnv, REQUIRED_KEYS, STORAGE_KEYS } from '../../scripts/lib/setup-dev'
import { STORAGE_ENV_KEYS } from '@/lib/storage/env'

/**
 * P9.1 — `npm run setup:dev` must guarantee the storage variable NAMES, so the
 * app and the orchestrator are configured from one vocabulary.
 *
 * The imaging `NoSuchKey` happened because `.env.example` ships the whole S3
 * block COMMENTED OUT, so a bootstrap that only fills keys present in the
 * template could never emit those names — leaving the app on local disk while
 * the orchestrator read MinIO.
 */
const root = path.resolve(__dirname, '../..')
const template = () => readFileSync(path.join(root, '.env.example'), 'utf8')
const gen = () => 'generated-secret'

describe('the storage vocabulary is declared exactly once', () => {
  it('setup:dev exposes the same keys lib/storage/env.ts declares', () => {
    expect([...STORAGE_KEYS]).toEqual([...STORAGE_ENV_KEYS])
    expect(STORAGE_KEYS).toContain('STORAGE_DRIVER')
    expect(STORAGE_KEYS).toContain('UPLOAD_DIR')
    expect(STORAGE_KEYS).toContain('S3_BUCKET')
    expect(STORAGE_KEYS).toContain('S3_FORCE_PATH_STYLE')
  })

  it('storage keys are NOT in the generated-secret set', () => {
    // Regression guard: the long-standing contract "exactly four crypto-
    // generated secrets" must keep holding.
    for (const key of STORAGE_KEYS) expect(REQUIRED_KEYS).not.toContain(key)
  })

  it('the runtime factory reads the very names the bootstrap writes', () => {
    const factory = readFileSync(path.join(root, 'lib/storage/index.ts'), 'utf8')
    for (const key of [
      'STORAGE_DRIVER',
      'UPLOAD_DIR',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_REGION',
      'S3_FORCE_PATH_STYLE',
    ]) {
      expect(factory, `factory must read ${key}`).toContain(key)
    }
  })
})

describe('planDevEnv guarantees the storage names', () => {
  it('a fresh .env ends up with a non-empty value for every storage key', () => {
    const plan = planDevEnv(template(), undefined, gen)
    const parsed = parseEnvFileContent(plan.content)
    for (const key of STORAGE_KEYS) {
      expect((parsed[key] ?? '').length, `value present for ${key}`).toBeGreaterThan(0)
    }
    // ...and the four secrets are still generated (existing contract intact)
    expect(plan.entries.filter((e) => e.action === 'generated')).toHaveLength(4)
  })

  it('fills the S3 names the template only ships COMMENTED OUT', () => {
    // This is the precise defect: the template's S3 block is all comments, so
    // nothing downstream ever saw these names.
    const commented = template()
      .split(/\r?\n/)
      .filter((l) => /^#\s*S3_/.test(l))
      .map((l) => l.replace(/^#\s*/, '').split('=')[0])
    expect(commented.length).toBeGreaterThan(0)
    const parsed = parseEnvFileContent(planDevEnv(template(), undefined, gen).content)
    for (const key of commented) {
      expect((parsed[key] ?? '').length, `bootstrap must supply ${key}`).toBeGreaterThan(0)
    }
  })

  it('never overwrites an existing non-empty STORAGE_DRIVER', () => {
    const userEnv = [
      'DATABASE_URL="mysql://root:x@localhost:3306/dental_erp"',
      'STORAGE_DRIVER="s3"',
      '',
    ].join('\n')
    const plan = planDevEnv(template(), userEnv, gen)
    expect(parseEnvFileContent(plan.content).STORAGE_DRIVER).toBe('s3')
    expect(plan.entries.find((e) => e.key === 'STORAGE_DRIVER')?.action).toBe('kept')
  })

  it('is idempotent — a second run changes nothing', () => {
    const plan1 = planDevEnv(template(), undefined, gen)
    const plan2 = planDevEnv(template(), plan1.content, gen)
    expect(plan2.content).toBe(plan1.content)
    expect(
      plan2.entries.filter((e) => STORAGE_KEYS.includes(e.key)).every((e) => e.action === 'kept'),
    ).toBe(true)
  })
})

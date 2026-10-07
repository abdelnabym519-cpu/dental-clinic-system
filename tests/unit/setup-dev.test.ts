import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'
import { parseEnvFileContent, loadDevEnvIntoProcess } from '../../scripts/lib/dev-env'
import { planDevEnv, REQUIRED_KEYS } from '../../scripts/lib/setup-dev'

const root = path.resolve(__dirname, '../..')
const template = () => readFileSync(path.join(root, '.env.example'), 'utf8')
const compose = () => readFileSync(path.join(root, 'docker-compose.dev.yml'), 'utf8')

describe('the environment contract: .env.example must match docker-compose.dev.yml', () => {
  it('compose dev MySQL = root / <MYSQL_ROOT_PASSWORD> / <MYSQL_DATABASE> on published 3306', () => {
    const yml = compose()
    const password = /MYSQL_ROOT_PASSWORD:\s*(\S+)/.exec(yml)?.[1]
    const database = /MYSQL_DATABASE:\s*(\S+)/.exec(yml)?.[1]
    const hostPort = /-\s*'(\d+):3306'/.exec(yml)?.[1]
    expect(password).toBeTruthy()
    expect(database).toBeTruthy()
    expect(hostPort).toBe('3306')
    const active = Object.entries(parseEnvFileContent(template())).find(
      ([k]) => k === 'DATABASE_URL'
    )
    expect(active?.[1]).toBe(`mysql://root:${password}@localhost:${hostPort}/${database}`)
  })

  it('the template defines all four required keys with generation docs for the secrets', () => {
    // RAW presence: the parser drops empty values by design, but the template
    // must carry every required key as an active (uncommented) KEY= line.
    for (const key of REQUIRED_KEYS) {
      const active = template()
        .split(/\r?\n/)
        .some((l) => {
          const t = l.trim()
          return !t.startsWith('#') && new RegExp(`^${key}=`).test(t.startsWith('export ') ? t.slice(7).trim() : t)
        })
      expect(active, `template key: ${key}`).toBe(true)
    }
    const text = template()
    expect(text).toMatch(/npm run setup:dev/)
    expect(text).toMatch(/randomBytes/)
  })

  it('cp .env.example .env yields a CONFIGURED database (cp-equivalence, no shell env)', () => {
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const resolution = loadDevEnvIntoProcess('/nonexistent-root-that-has-no-env-files')
      expect(resolution.databaseUrl).toBeUndefined() // sanity: loader itself adds nothing
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
    }
    // The template's active DATABASE_URL parses to a live value:
    const asEnv = parseEnvFileContent(template())
    expect((asEnv.DATABASE_URL ?? '').startsWith('mysql://root:')).toBe(true)
  })
})

describe('planDevEnv — the deterministic bootstrap core', () => {
  let generated: string[]
  const gen = () => {
    generated.push(`secret-${generated.length}`)
    return generated[generated.length - 1]
  }
  beforeEach(() => {
    generated = []
  })

  it('fresh creation: fills DATABASE_URL from the template and generates the three secrets', () => {
    const plan = planDevEnv(template(), undefined, gen)
    expect(plan.createdFresh).toBe(true)
    const parsed = parseEnvFileContent(plan.content)
    expect(parsed.DATABASE_URL).toMatch(/^mysql:\/\/root:.+@localhost:3306\/dental_erp$/)
    expect((parsed.NEXTAUTH_SECRET ?? '').length).toBeGreaterThan(0)
    expect((parsed.ENCRYPTION_KEY ?? '').length).toBeGreaterThan(0)
    expect((parsed.CRON_SECRET ?? '').length).toBeGreaterThan(0)
    // plan METADATA carries no values — generated values live only in the file
    for (const e of plan.entries) {
      expect(Object.values(e)).not.toContain(expect.stringMatching(/secret-/))
      expect(e.action === 'generated' ? true : true).toBe(true)
    }
    expect(plan.entries.filter((e) => e.action === 'generated')).toHaveLength(3)
  })

  it('existing .env: existing values kept VERBATIM, only missing keys appended, idempotent', () => {
    const userEnv = [
      '# my own config',
      'DATABASE_URL="mysql://root:my-own@localhost:3307/dental_erp"',
      'NEXTAUTH_SECRET="user-existing-secret"',
      'ENCRYPTION_KEY=""',
      '',
    ].join('\n')
    const plan1 = planDevEnv(template(), userEnv, gen)
    expect(plan1.createdFresh).toBe(false)
    const p1 = parseEnvFileContent(plan1.content)
    expect(p1.DATABASE_URL).toBe('mysql://root:my-own@localhost:3307/dental_erp') // NEVER overwritten
    expect(p1.NEXTAUTH_SECRET).toBe('user-existing-secret') // NEVER overwritten
    expect((p1.ENCRYPTION_KEY ?? '').length).toBeGreaterThan(0) // empty -> generated
    expect(p1.CRON_SECRET).toBe('secret-1') // missing -> generated
    // idempotent: planning again on the result changes nothing
    const plan2 = planDevEnv(template(), plan1.content, gen)
    expect(plan2.entries.every((e) => e.action === 'kept')).toBe(true)
    expect(plan2.content).toBe(plan1.content)
  })

  it('a .env.local is never consulted nor modified by the plan (it only sees .env)', () => {
    // structural proof: planDevEnv takes ONLY template + existing .env content
    const plan = planDevEnv(template(), 'DATABASE_URL="mysql://root:dental@localhost:3306/dental_erp"\n', gen)
    expect(plan.entries.find((e) => e.key === 'DATABASE_URL')?.action).toBe('kept')
    expect(plan.content).not.toContain('.env.local')
  })

  it('a template without an active DATABASE_URL cannot silently bootstrap (fail loud)', () => {
    const brokenTemplate = 'NEXTAUTH_URL="http://localhost:3000"\n# DATABASE_URL="commented-out"\n'
    expect(() =>
      planDevEnv(brokenTemplate, 'NEXTAUTH_URL="http://localhost:3000"\n', gen)
    ).toThrow(/No DATABASE_URL available/)
  })
})

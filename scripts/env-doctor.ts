/**
 * Environment diagnostic for the dev-start path (secret-safe).
 * Reports ONLY presence/source metadata — never values.
 *   npx tsx scripts/env-doctor.ts
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadDevEnvIntoProcess } from './lib/dev-env'

const root = process.cwd()
const sources: string[] = []
if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') sources.push('shell')
if (existsSync(path.join(root, '.env.local'))) sources.push('.env.local(candidate)')
if (existsSync(path.join(root, '.env'))) sources.push('.env(candidate)')

const before = (process.env.DATABASE_URL ?? '').trim() !== ''
const resolution = loadDevEnvIntoProcess(root)
const after = (resolution.databaseUrl ?? '') !== ''

console.log('DATABASE_URL present =', after)
console.log('DATABASE_URL source  =', before ? 'shell' : resolution.loaded.map((l) => l.file).join(' > ') || 'unknown/none')
console.log('loaded               =', resolution.loaded.map((l) => `${l.file}(+${l.keys} keys)`).join(', ') || '(none)')
console.log('NODE_ENV             =', process.env.NODE_ENV ?? '(unset)')
console.log('cwd                  =', root)
console.log('execPath             =', process.execPath)
console.log('argv                 =', process.argv.join(' '))
console.log('candidates on disk   =', sources.join(', ') || '(no env files found)')
if (!after) {
  console.log('VERDICT: NOT CONFIGURED — create .env (cp .env.example .env) with DATABASE_URL.')
} else {
  console.log('VERDICT: CONFIGURED — the dev-start readiness probe will receive this URL explicitly.')
}

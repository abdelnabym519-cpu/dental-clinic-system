/**
 * Local development bootstrap — the canonical first command after `npm install`:
 *
 *   npm run setup:dev
 *
 * Creates .env from .env.example when missing, generates the required dev
 * secrets (NEXTAUTH_SECRET, ENCRYPTION_KEY, CRON_SECRET), fills DATABASE_URL
 * with the docker-compose.dev.yml-matching value, and NEVER overwrites
 * existing values, never touches .env.local, never touches the database.
 * Run again any time — it is idempotent and repairs only what is missing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadDevEnvIntoProcess } from './lib/dev-env'
import { planDevEnv } from './lib/setup-dev'

function main(): void {
  const root = process.cwd()
  const templatePath = path.join(root, '.env.example')
  const envPath = path.join(root, '.env')

  if (!existsSync(templatePath)) {
    console.error('[setup] .env.example is missing — cannot bootstrap (it is the canonical template).')
    process.exit(1)
  }
  const templateContent = readFileSync(templatePath, 'utf8')
  const existed = existsSync(envPath)
  const existingContent = existed ? readFileSync(envPath, 'utf8') : undefined

  const plan = planDevEnv(templateContent, existingContent)
  writeFileSync(envPath, plan.content, 'utf8')

  console.log(`[setup] .env ${existed ? 'updated (missing keys only — nothing overwritten)' : 'created from .env.example'}`)
  for (const e of plan.entries) {
    const detail =
      e.action === 'kept'
        ? 'kept (already set — value never read or printed)'
        : e.action === 'generated'
          ? 'generated (crypto-random, written to .env only)'
          : 'filled from template (matches docker-compose.dev.yml)'
    console.log(`[setup]   ${e.key}: ${detail}`)
  }

  // Validate with the SAME resolution the startup uses (secret-free output).
  const resolution = loadDevEnvIntoProcess(root)
  if (resolution.databaseUrl) {
    const source = resolution.loaded.map((l) => l.file).join(' > ') || 'shell/.env'
    console.log(`[setup] VERDICT: CONFIGURED — DATABASE_URL resolves via ${source}.`)
    console.log('[setup] Next: npm run dev:start')
  } else {
    console.error('[setup] VERDICT: NOT CONFIGURED — .env still lacks DATABASE_URL.')
    process.exit(1)
  }
}

// Run only when executed directly (never on import — keeps the CLI test-safe).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

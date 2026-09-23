/**
 * Phase 10 (D1) — Meta WhatsApp environment validation.
 *
 *   npx tsx scripts/validate-whatsapp-env.ts      (or: npm run whatsapp:validate)
 *
 * Validates that the Meta WhatsApp credentials the runtime code actually reads
 * are present and non-empty. Variable names follow this repository's
 * canonical set (lib/messaging/providers.ts + the Phase 10 webhook), which
 * differs from the Phase 10 spec's draft names:
 *
 *   spec draft                          repo canonical (checked here)
 *   ---------------------------------   ---------------------------------
 *   META_WHATSAPP_ACCESS_TOKEN          META_WHATSAPP_TOKEN
 *   META_WHATSAPP_PHONE_NUMBER_ID       META_WHATSAPP_PHONE_NUMBER_ID
 *   META_WHATSAPP_BUSINESS_ACCOUNT_ID   META_WHATSAPP_BUSINESS_ACCOUNT_ID
 *   META_WHATSAPP_WEBHOOK_VERIFY_TOKEN  META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
 *
 * Reads .env from the repository root when present (Node >= 20.12
 * process.loadEnvFile); values already set in the environment win.
 *
 * Exit codes: 0 = all required credentials present, 1 = something missing.
 */

import path from 'node:path'

const REQUIRED = [
  'META_WHATSAPP_TOKEN',
  'META_WHATSAPP_PHONE_NUMBER_ID',
  'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
  'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
] as const

// Informational — the app still runs without these (mock provider / no SMS
// fallback), so they are reported but never fail the validation.
const INFO = ['MESSAGING_ENABLED', 'WHATSAPP_PROVIDER', 'MESSAGING_FALLBACK_TO_SMS'] as const

const envPath = path.join(__dirname, '..', '.env')
let hasEnvFile = false
try {
  process.loadEnvFile(envPath)
  hasEnvFile = true
} catch {
  // No .env in the repository root — everything is read from the
  // environment alone. The report says so explicitly.
}

const isSet = (key: string): boolean => Boolean((process.env[key] ?? '').trim())

const missing = REQUIRED.filter((key) => !isSet(key))

console.log('Meta WhatsApp environment validation (Phase 10 D1)')
console.log(`  .env: ${hasEnvFile ? 'found at repository root' : 'NOT FOUND (repository root)'}`)
for (const key of REQUIRED) {
  console.log(
    `  ${isSet(key) ? '✓' : '✗'} ${key}${isSet(key) ? ' = <set, redacted>' : ' = (missing or empty)'}`
  )
}
for (const key of INFO) {
  const value = (process.env[key] ?? '').trim()
  console.log(`  · ${key} = ${value ? JSON.stringify(value) : '(unset)'}`)
}

if (missing.length > 0) {
  console.error('\n✗ Missing WhatsApp credentials:')
  for (const key of missing) console.error(`   - ${key}`)
  console.error(
    '\nAdd these to your .env file — see the "Phase 10: Meta WhatsApp" section of .env.example for where each value comes from.'
  )
  process.exit(1)
}

if (process.env.MESSAGING_ENABLED !== 'true') {
  console.warn(
    '\n! MESSAGING_ENABLED is not "true" — the mock provider is active and no real WhatsApp call will be made.'
  )
}

console.log('\n✓ All WhatsApp credentials present')

/**
 * Phase 10 — send a REAL WhatsApp test message through whichever provider is
 * active in .env (Meta Cloud API or Baileys), bypassing the queue on purpose
 * (queue semantics — retries, backoff, dead-letter — are exercised separately).
 *
 * Usage:
 *   npm run whatsapp:test -- 201012345678
 *   npm run whatsapp:test -- 01012345678     (Egyptian mobile; normalized)
 *
 * Exit codes: 0 = delivered to the provider, 1 = usage/config/send failure.
 * For Baileys without an established session the script prints the pairing
 * instructions instead of crashing (the session persists in Redis once
 * scanned at /super-admin/whatsapp).
 */
import { getWhatsAppProvider } from '../lib/messaging/factory'
import { toProviderDigits } from '../lib/phone'

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env')
  } catch {
    // no .env — proceed with the ambient environment (CI / systemd units)
  }
}

async function main(): Promise<void> {
  loadDotEnv()

  const phone = process.argv[2]
  if (!phone) {
    console.error('Usage: npm run whatsapp:test -- <phone>')
    console.error('  e.g. npm run whatsapp:test -- 01012345678')
    process.exit(1)
  }

  const digits = toProviderDigits(phone)
  if (!digits) {
    console.error(`Invalid phone number: ${phone}`)
    process.exit(1)
  }

  const provider = getWhatsAppProvider()

  if (provider.name.includes('mock')) {
    console.error('Mock provider is active — no real message will be sent.')
    console.error(
      'Set MESSAGING_ENABLED="true" and choose WHATSAPP_PROVIDER="meta" (credentials in .env)'
    )
    console.error('or WHATSAPP_PROVIDER="baileys" (+ Redis) — see .env.example, Phase 10 section.')
    process.exit(1)
  }

  console.log(`Provider : ${provider.name}`)
  console.log(`To       : ${digits}`)

  const result = await provider.sendMessage(digits, {
    text: '🧪 رسالة تجريبية من نظام العيادة (DenToRa) — Phase 10. / Test message from the clinic system — Phase 10.',
  })

  console.log('Result   :', JSON.stringify(result, null, 2))

  if (!result.success) {
    if (provider.name === 'baileys-whatsapp' && /not connected/i.test(result.error ?? '')) {
      console.error('')
      console.error('No active Baileys session. To pair:')
      console.error('  1. Start Redis (docker compose up -d redis or equivalent).')
      console.error('  2. Open /super-admin/whatsapp in the browser (logged in as SUPER_ADMIN).')
      console.error('  3. WhatsApp on your phone → Settings → Linked Devices → Link a Device.')
      console.error('  4. Re-run this command — the session is kept in Redis.')
    }
    process.exit(1)
  }

  console.log('✔ Message accepted by the provider.')
  if (result.providerMessageId) {
    console.log(`  providerMessageId: ${result.providerMessageId}`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})

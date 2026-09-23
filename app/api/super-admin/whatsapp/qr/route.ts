import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getBaileysProvider } from '@/lib/messaging/baileys-provider'

/**
 * Phase 10 — SUPER_ADMIN only: Baileys QR pairing status.
 *
 * The /super-admin/whatsapp page polls this endpoint (10s). The QR itself
 * lives in Redis (`baileys:qr`, TTL 120s) — it disappears once the phone
 * scans it (the socket's `open` event deletes it). `qr: null` + `connected:
 * true` means the session is already established; no scan needed.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.isSuperAdmin && session?.user?.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only meaningful when Baileys is the active WhatsApp provider — otherwise
  // don't even construct the provider (no Redis churn for Meta deployments).
  if (process.env.WHATSAPP_PROVIDER !== 'baileys') {
    return NextResponse.json({
      provider: 'meta',
      qr: null,
      connected: null,
    })
  }

  const provider = getBaileysProvider()
  const [connected, qr] = await Promise.all([
    Promise.resolve(provider.isReady()),
    provider.getQRCode(),
  ])

  return NextResponse.json({
    provider: 'baileys',
    connected,
    qr,
  })
}

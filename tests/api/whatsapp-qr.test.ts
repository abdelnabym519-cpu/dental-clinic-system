import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/messaging/baileys-provider', () => ({
  getBaileysProvider: vi.fn(),
}))

import { GET } from '@/app/api/super-admin/whatsapp/qr/route'
import { auth } from '@/lib/auth'
import { getBaileysProvider } from '@/lib/messaging/baileys-provider'

/**
 * Phase 10 (D4) — super-admin QR endpoint: SUPER_ADMIN-only guard, Meta
 * short-circuit (no Baileys provider constructed), Baileys status passthrough.
 */
function session(over: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'sa-1',
      email: 'super@dentora.com',
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
      ...over,
    },
  }
}

describe('GET /api/super-admin/whatsapp/qr', () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset()
    vi.mocked(getBaileysProvider).mockReset()
    delete process.env.WHATSAPP_PROVIDER
  })

  afterEach(() => {
    delete process.env.WHATSAPP_PROVIDER
  })

  it('returns 403 for non-super-admin users', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'h1', role: 'ADMIN', isSuperAdmin: false },
    } as never)
    const res = await GET()
    expect(res.status).toBe(403)
    expect(getBaileysProvider).not.toHaveBeenCalled()
  })

  it('returns 403 when logged out', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('short-circuits for the Meta provider without touching Baileys', async () => {
    vi.mocked(auth).mockResolvedValue(session() as never)
    process.env.WHATSAPP_PROVIDER = 'meta'
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ provider: 'meta', qr: null, connected: null })
    expect(getBaileysProvider).not.toHaveBeenCalled()
  })

  it('returns provider state for Baileys (connected session → qr null)', async () => {
    vi.mocked(auth).mockResolvedValue(session() as never)
    process.env.WHATSAPP_PROVIDER = 'baileys'
    vi.mocked(getBaileysProvider).mockReturnValue({
      isReady: () => true,
      getQRCode: async () => null,
    } as never)
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ provider: 'baileys', connected: true, qr: null })
  })

  it('returns the QR from Redis for a pending Baileys session', async () => {
    vi.mocked(auth).mockResolvedValue(session() as never)
    process.env.WHATSAPP_PROVIDER = 'baileys'
    vi.mocked(getBaileysProvider).mockReturnValue({
      isReady: () => false,
      getQRCode: async () => 'QR-STRING',
    } as never)
    const res = await GET()
    const data = await res.json()
    expect(data).toEqual({ provider: 'baileys', connected: false, qr: 'QR-STRING' })
  })

  it('accepts the legacy role spelling without the isSuperAdmin flag', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'sa-2', email: 'x@y.z', role: 'SUPER_ADMIN', isSuperAdmin: undefined },
    } as never)
    process.env.WHATSAPP_PROVIDER = 'meta'
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

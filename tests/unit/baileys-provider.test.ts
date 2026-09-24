import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BaileysProvider,
  type BaileysSocketLike,
  type RedisLike,
} from '@/lib/messaging/baileys-provider'
import { DisconnectReason } from '@whiskeysockets/baileys'

/**
 * Phase 10 (D3/D4) — Baileys provider lifecycle, fully DI-driven:
 * fake Redis + fake socket. No network, no real WhatsApp, no real Redis.
 */

type Handler = (...args: unknown[]) => void

interface FakeSocket extends BaileysSocketLike {
  handlers: Record<string, Handler[]>
  emit(event: string, ...args: unknown[]): void
  sendMessage: ReturnType<typeof vi.fn>
}

function makeFakeSocket(): FakeSocket {
  const handlers: Record<string, Handler[]> = {}
  const socket = {
    handlers,
    ev: {
      on: (event: string, handler: Handler) => {
        ;(handlers[event] ??= []).push(handler)
      },
    },
    sendMessage: vi.fn(async () => ({ key: { id: 'BAILEYS-MSG-1' } })),
    end: vi.fn(async () => {}),
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) h(...args)
    },
  }
  return socket
}

function makeFakeRedis(): {
  redis: RedisLike
  store: Map<string, string>
  connect: ReturnType<typeof vi.fn>
} {
  const store = new Map<string, string>()
  const connect = vi.fn(async () => {})
  const redis: RedisLike = {
    connect,
    disconnect: vi.fn(async () => {}),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
    setEx: vi.fn(async (k: string, _ttl: number, v: string) => {
      store.set(k, v)
    }),
    del: vi.fn(async (k: string) => {
      store.delete(k)
    }),
  }
  return { redis, store, connect }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('BaileysProvider (Phase 10, DI-driven)', () => {
  let redisFixture: ReturnType<typeof makeFakeRedis>
  let socket: FakeSocket
  let sockets: FakeSocket[]
  let provider: BaileysProvider

  let factory: ReturnType<typeof vi.fn>

  beforeEach(() => {
    redisFixture = makeFakeRedis()
    sockets = []
    socket = makeFakeSocket()
    sockets.push(socket)
    // Every socketFactory call = one makeWASocket() = one (re)connect attempt.
    // First call returns the shared fake; later calls create fresh ones.
    factory = vi.fn(() => {
      if (sockets.length === 1) return sockets[0]
      const next = makeFakeSocket()
      sockets.push(next)
      return next
    })
    // loggedOutCode mirrors production: the real code is always known by the
    // time a socket exists (set from the loaded baileys module).
    provider = new BaileysProvider({
      redis: redisFixture.redis,
      socketFactory: factory,
      loggedOutCode: DisconnectReason.loggedOut,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('toJid builds the Egyptian s.whatsapp.net JID', () => {
    expect(provider.toJid('201012345678')).toBe('201012345678@s.whatsapp.net')
    expect(provider.toJid('+201012345678')).toBe('201012345678@s.whatsapp.net')
  })

  it('stores the QR in Redis (TTL 120s) on the qr event', async () => {
    await provider.initialize()
    socket.emit('qr', 'QR-PAYLOAD-1')
    await flush()
    expect(redisFixture.redis.setEx).toHaveBeenCalledWith('baileys:qr', 120, 'QR-PAYLOAD-1')
    await expect(provider.getQRCode()).resolves.toBe('QR-PAYLOAD-1')
  })

  it('marks connected on open and clears the stored QR', async () => {
    await provider.initialize()
    expect(provider.isReady()).toBe(false)
    socket.emit('qr', 'QR-PAYLOAD-2')
    socket.emit('connection.update', { connection: 'open' })
    await flush()
    expect(provider.isReady()).toBe(true)
    expect(provider.connected).toBe(true)
    expect(redisFixture.redis.del).toHaveBeenCalledWith('baileys:qr')
    await expect(provider.getQRCode()).resolves.toBeNull()
  })

  it('reconnects after 5s on a non-loggedOut close', async () => {
    vi.useFakeTimers()
    await provider.initialize()
    socket.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 408 } } },
    })
    expect(provider.isReady()).toBe(false)

    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    // reconnect path fired makeWASocket a second time
    expect(factory).toHaveBeenCalledTimes(2)
    expect(provider.isReady()).toBe(false) // still not open until the new socket says so
  })

  it('does NOT reconnect on loggedOut — clears the session instead', async () => {
    vi.useFakeTimers()
    await provider.initialize()
    socket.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } },
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(redisFixture.redis.del).toHaveBeenCalledWith('baileys:session')
    // no reconnect happened within 30s
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('sendMessage while not connected → retryable failure, no crash', async () => {
    await provider.initialize() // redis ok, socket created, but never opens
    const result = await provider.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.retryable).toBe(true)
    expect(result.error).toMatch(/not connected/i)
  })

  it('sendMessage after open → success with providerMessageId + correct JID', async () => {
    await provider.initialize()
    socket.emit('connection.update', { connection: 'open' })
    await flush()

    const result = await provider.sendMessage('01012345678', { text: 'مرحباً' })
    expect(result.success).toBe(true)
    expect(result.providerMessageId).toBe('BAILEYS-MSG-1')
    expect(socket.sendMessage).toHaveBeenCalledWith('201012345678@s.whatsapp.net', {
      text: 'مرحباً',
    })
  })

  it('sendMessage with an invalid phone → terminal failure (not retryable)', async () => {
    await provider.initialize()
    socket.emit('connection.update', { connection: 'open' })
    await flush()
    const result = await provider.sendMessage('not-a-phone', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.retryable).toBe(false)
    expect(socket.sendMessage).not.toHaveBeenCalled()
  })

  it('sendDocument uses the document content shape', async () => {
    await provider.initialize()
    socket.emit('connection.update', { connection: 'open' })
    await flush()
    const result = await provider.sendDocument(
      '01012345678',
      Buffer.from('pdf'),
      'invoice.pdf',
      'فاتورتك'
    )
    expect(result.success).toBe(true)
    expect(socket.sendMessage).toHaveBeenCalledWith('201012345678@s.whatsapp.net', {
      document: expect.any(Buffer),
      caption: 'فاتورتك',
      fileName: 'invoice.pdf',
      mimetype: 'application/pdf',
    })
  })

  it('fails soft when Redis is unreachable — no crash, retryable error', async () => {
    const badRedis = makeFakeRedis()
    badRedis.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const failing = new BaileysProvider({
      redis: badRedis.redis,
      socketFactory: () => {
        throw new Error('should not be called')
      },
    })
    await expect(failing.initialize()).resolves.toBeUndefined()
    expect(failing.isReady()).toBe(false)
    const result = await failing.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.retryable).toBe(true)
  })

  it('is idempotent — concurrent initialize() calls create one socket', async () => {
    await Promise.all([provider.initialize(), provider.initialize(), provider.initialize()])
    await flush()
    expect(factory).toHaveBeenCalledTimes(1)
  })
})

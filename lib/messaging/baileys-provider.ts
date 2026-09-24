/**
 * Phase 10 — Baileys (WhatsApp Web / multi-device) provider.
 *
 * Replaces the Phase 6 fail-fast stub. The session (auth state + QR) is
 * persisted in Redis so a server restart does not require re-scanning.
 *
 * Connection model:
 *   - `initialize()` loads the auth state from Redis, opens the socket and
 *     stores the QR at `baileys:qr` (TTL 120s) — the super-admin QR page
 *     polls it every 10s.
 *   - On `close` we reconnect after 5s unless the close reason is
 *     `loggedOut` (the phone was actively logged out → re-scan required).
 *   - `sendMessage` auto-initializes on first use (cron path).
 *
 * Fail-soft: a missing/unreachable Redis never crashes the process — sends
 * return a retryable SendResult error instead, and the page shows
 * "connecting" rather than a stack trace.
 *
 * SECURITY NOTE: Baileys is not an official Meta API. High-volume or
 * automated bulk sending from a single personal number can trigger a Meta
 * BAN — reserve it for low-volume clinic use (that is the Phase 10 intent).
 */
import pino from 'pino'
import { createClient } from 'redis'
import type { MessagingProvider, MessagePayload, SendResult } from './types'
import { toProviderDigits } from '../phone'

const SESSION_KEY = 'baileys:session'
const QR_KEY = 'baileys:qr'
const QR_TTL_SECONDS = 120
const RECONNECT_DELAY_MS = 5000

/**
 * `@whiskeysockets/baileys` is loaded lazily (dynamic import) so that
 * Meta-only deployments, the Next.js server bundle and CLI scripts never
 * evaluate its module graph (ESM-only + native bridge) unless Baileys is
 * actually the active provider.
 */
type BaileysModule = typeof import('@whiskeysockets/baileys')
let baileysModule: BaileysModule | null = null

async function loadBaileys(): Promise<BaileysModule> {
  if (!baileysModule) baileysModule = await import('@whiskeysockets/baileys')
  return baileysModule
}

/** Minimal Redis surface the provider needs (DI seam for tests). */
export interface RedisLike {
  connect(): Promise<void>
  disconnect(): Promise<void>
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  setEx(key: string, ttlSeconds: number, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
}

/** Minimal socket surface (DI seam — tests fake the socket lifecycle). */
export interface BaileysSocketLike {
  ev: { on(event: string, handler: (...args: unknown[]) => void): void }
  sendMessage(
    jid: string,
    content: Record<string, unknown>
  ): Promise<{ key?: { id?: string } } | null>
  end(reason?: unknown): Promise<void> | void
}

/** makeWASocket is async, so the factory may resolve lazily. */
export type BaileysSocketFactory = (
  opts: Record<string, unknown>
) => BaileysSocketLike | Promise<BaileysSocketLike>

interface StoredAuth {
  creds: Record<string, unknown>
  keys: Record<string, unknown>
}

/**
 * Redis-backed Baileys auth state (persists across restarts — no re-scan).
 * `creds` lives at `baileys:session`; individual crypto keys at
 * `baileys:session:<type>:<jid>` so hot keys never fight the session blob.
 */
async function baileysAuthState(
  redis: RedisLike
): Promise<{ creds: Record<string, unknown>; keys: unknown }> {
  const stored =
    (await redis.get(SESSION_KEY)) ||
    JSON.stringify({ creds: {}, keys: { preKeys: {}, sendingKeys: {} } })
  const { creds, keys } = JSON.parse(stored) as StoredAuth
  return {
    creds,
    keys: {
      get: async (type: string, id: Buffer): Promise<unknown> => {
        const jid = id.toString('base64')
        const storedKey = await redis.get(`${SESSION_KEY}:${type}:${jid}`)
        if (storedKey) return JSON.parse(storedKey)
        const inMemory = (keys[type] as Record<string, unknown> | undefined)?.[jid]
        if (inMemory) {
          const value = JSON.parse(JSON.stringify(inMemory))
          await redis.set(`${SESSION_KEY}:${type}:${jid}`, JSON.stringify(value))
          return value
        }
        return null
      },
      set: async (items: Array<{ type: string; id: Buffer; value: unknown }>) => {
        for (const item of items) {
          const jid = item.id.toString('base64')
          await redis.set(`${SESSION_KEY}:${item.type}:${jid}`, JSON.stringify(item.value))
        }
      },
    },
  }
}

export interface BaileysOptions {
  /** Inject a ready Redis (tests / future shared client). */
  redis?: RedisLike
  /** Inject the socket factory (tests). Defaults to makeWASocket. */
  socketFactory?: BaileysSocketFactory
  /**
   * Test seam: the numeric "logged out" close code (baileys's
   * DisconnectReason.loggedOut). Production sets it from the loaded module.
   */
  loggedOutCode?: number
}

export class BaileysProvider implements MessagingProvider {
  readonly name = 'baileys-whatsapp'
  readonly channel = 'WHATSAPP' as const

  private sock: BaileysSocketLike | null = null
  private redisClient: RedisLike | null
  private readonly socketFactory: BaileysSocketFactory
  private isConnected = false
  private initializing = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private loggedOutCode: number | null

  constructor(options: BaileysOptions = {}) {
    this.redisClient = options.redis ?? null
    this.loggedOutCode = options.loggedOutCode ?? null
    // Default factory: lazy-load baileys, then open the socket.
    this.socketFactory =
      options.socketFactory ??
      (async (opts) => {
        const m = await loadBaileys()
        this.loggedOutCode = this.loggedOutCode ?? m.DisconnectReason.loggedOut
        const socket = await m.default(opts as Parameters<BaileysModule['default']>[0])
        return socket as unknown as BaileysSocketLike
      })
  }

  get connected(): boolean {
    return this.isConnected
  }

  /** Open the socket (idempotent; safe to call from cron and the QR page). */
  async initialize(): Promise<void> {
    if (this.isConnected || this.initializing) return
    this.initializing = true
    try {
      const redis = this.redisClient ?? this.createDefaultRedis()
      await redis.connect()
      this.redisClient = redis

      const authState = await baileysAuthState(redis)
      const socket = await this.socketFactory({
        authState,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
      })
      this.sock = socket

      const storeQR = (qr: string) => {
        void redis.setEx(QR_KEY, QR_TTL_SECONDS, qr).catch(() => {})
      }
      socket.ev.on('qr', (qr: unknown) => storeQR(String(qr)))

      socket.ev.on('connection.update', (update: unknown) => {
        const { connection, lastDisconnect, qr } = update as {
          connection?: 'open' | 'close'
          lastDisconnect?: { error?: { output?: { statusCode?: number } } }
          qr?: string
        }
        if (qr) storeQR(qr)
        if (connection === 'open') {
          this.isConnected = true
          void redis.del(QR_KEY).catch(() => {})
        }
        if (connection === 'close') {
          this.isConnected = false
          const statusCode = lastDisconnect?.error?.output?.statusCode
          // Reconnect unless the session was explicitly logged out (re-scan needed).
          // loggedOutCode is known by the time a socket exists (set when the
          // socket was created); null only with a DI socket without a code,
          // where reconnecting is the safe default.
          if (this.loggedOutCode !== null && statusCode === this.loggedOutCode) {
            void redis.del(SESSION_KEY).catch(() => {})
          } else {
            this.scheduleReconnect()
          }
        }
      })

      // Persist the live creds whenever the session refreshes them. Keys are
      // already stored individually by `keys.set`, so only `creds` is merged
      // back into the session blob (preserving whatever it already held).
      socket.ev.on('creds.update', () => {
        void (async () => {
          try {
            const raw = await redis.get(SESSION_KEY)
            const prev = raw
              ? (JSON.parse(raw) as StoredAuth)
              : { creds: {}, keys: { preKeys: {}, sendingKeys: {} } }
            await redis.set(
              SESSION_KEY,
              JSON.stringify({
                creds: { ...authState.creds },
                keys: prev.keys ?? { preKeys: {}, sendingKeys: {} },
              })
            )
          } catch {
            // best-effort persistence — never break the socket
          }
        })()
      })
    } catch (err) {
      // Fail-soft: no Redis / network refused → not connected, no crash.
      this.isConnected = false
      console.error(
        '[Baileys] initialize failed (fail-soft):',
        err instanceof Error ? err.message : err
      )
    } finally {
      this.initializing = false
    }
  }

  /**
   * Default Redis client. `reconnectStrategy: false` makes connect() reject
   * quickly instead of retrying forever — sends must fail fast so the queue
   * can record the failure instead of hanging.
   */
  private createDefaultRedis(): RedisLike {
    const client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: { reconnectStrategy: false },
    })
    const withSetOptions = client as unknown as {
      set(key: string, value: string, options?: { EX?: number }): Promise<unknown>
    }
    return {
      // v4's connect() resolves to the client itself — normalize to void.
      connect: async () => {
        await client.connect()
      },
      disconnect: async () => {
        await client.disconnect()
      },
      get: (key) => client.get(key),
      set: (key, value) => client.set(key, value),
      // node-redis v4 has no setEx — same thing via the EX option.
      setEx: (key, ttlSeconds, value) => withSetOptions.set(key, value, { EX: ttlSeconds }),
      del: (key) => client.del(key),
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.initialize().catch(() => {})
    }, RECONNECT_DELAY_MS)
  }

  private async ensureReady(): Promise<SendResult | null> {
    if (!this.isConnected || !this.sock) {
      await this.initialize()
    }
    if (!this.isConnected || !this.sock) {
      return {
        success: false,
        error: 'Baileys not connected (QR not scanned or Redis unavailable)',
        retryable: true,
      }
    }
    return null
  }

  async sendMessage(to: string, message: MessagePayload): Promise<SendResult> {
    const notReady = await this.ensureReady()
    if (notReady) return notReady

    const digits = toProviderDigits(to)
    if (!digits) {
      return { success: false, error: `Invalid phone for Baileys: ${to}`, retryable: false }
    }
    const jid = this.toJid(digits)
    const socket = this.sock!

    try {
      if (message.attachment) {
        const buffer = Buffer.from(message.attachment.data, 'base64')
        const isImage = message.attachment.mimeType.startsWith('image/')
        const result = await socket.sendMessage(
          jid,
          isImage
            ? { image: buffer, caption: message.text, mimetype: message.attachment.mimeType }
            : {
                document: buffer,
                caption: message.text,
                fileName: message.attachment.filename,
                mimetype: message.attachment.mimeType,
              }
        )
        return { success: true, providerMessageId: result?.key?.id }
      }

      const result = await socket.sendMessage(jid, { text: message.text })
      return { success: true, providerMessageId: result?.key?.id }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Baileys send failed',
        retryable: true,
      }
    }
  }

  /** Spec D3 — direct text send (scripts / manual triggers). */
  async sendTextMessage(to: string, text: string): Promise<SendResult> {
    return this.sendMessage(to, { text })
  }

  /** Spec D3 — direct document send (raw buffer). */
  async sendDocument(
    to: string,
    buffer: Buffer,
    filename: string,
    caption: string
  ): Promise<SendResult> {
    const notReady = await this.ensureReady()
    if (notReady) return notReady
    const digits = toProviderDigits(to)
    if (!digits)
      return { success: false, error: `Invalid phone for Baileys: ${to}`, retryable: false }
    const socket = this.sock!
    try {
      const result = await socket.sendMessage(this.toJid(digits), {
        document: buffer,
        caption,
        fileName: filename,
        mimetype: 'application/pdf',
      })
      return { success: true, providerMessageId: result?.key?.id }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Baileys document send failed',
        retryable: true,
      }
    }
  }

  /** Current QR string (null → scanned or session already connected). */
  async getQRCode(): Promise<string | null> {
    if (!this.redisClient) return null
    try {
      return await this.redisClient.get(QR_KEY)
    } catch {
      return null
    }
  }

  isReady(): boolean {
    return this.isConnected
  }

  /** Egyptian numbers: 20XXXXXXXXX@ s.whatsapp.net. */
  toJid(e164: string): string {
    const digits = e164.replace(/\D/g, '')
    return `${digits}@s.whatsapp.net`
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    try {
      await this.sock?.end?.(this.loggedOutCode ?? undefined)
    } catch {
      // already closed
    }
    this.sock = null
    this.isConnected = false
    if (this.redisClient) await this.redisClient.disconnect().catch(() => {})
  }
}

let singleton: BaileysProvider | null = null

/** Process-wide Baileys session (shared by the QR page and the queue). */
export function getBaileysProvider(): BaileysProvider {
  if (!singleton) singleton = new BaileysProvider()
  return singleton
}

/**
 * Phase 11 — observability contracts (§36/§39) + API error contract (§40)
 * + retry/timeout policy (§17/§18) + rate limiter (§41) + CORS (§27).
 */
import { describe, it, expect } from 'vitest'
import { createLogger } from '@/lib/observability/logger'
import {
  correlationFromRequest,
  newCorrelationId,
  sanitizeCorrelationId,
} from '@/lib/observability/correlation'
import { apiError, API_ERROR_MESSAGES } from '@/lib/api/errors'
import { backoffSchedule, classifyError, TIMEOUT_CLASSES_MS } from '@/lib/config/limits'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { corsHeadersFor } from '@/lib/config/cors'

describe('structured logger (§39 — secret/PHI-free by construction)', () => {
  function capture(): { lines: unknown[]; write: (s: string) => void } {
    const lines: unknown[] = []
    return { lines, write: (s) => lines.push(JSON.parse(s)) }
  }
  const origWrite = process.stdout.write.bind(process.stdout)

  function withCaptured(fn: (cap: { lines: unknown[] }) => void) {
    const cap = capture()
    process.stdout.write = ((s: string) => (cap.write(s), true)) as typeof process.stdout.write
    try {
      fn(cap)
    } finally {
      process.stdout.write = origWrite
    }
  }

  it('emits JSON lines with level, ts, correlationId, component', () => {
    withCaptured((cap) => {
      const log = createLogger('c-abc-123', 'test')
      log.info('hello', { userId: 'u1' })
      const line = cap.lines[0] as Record<string, unknown>
      expect(line.level).toBe('INFO')
      expect(line.correlationId).toBe('c-abc-123')
      expect(line.component).toBe('test')
      expect(line.msg).toBe('hello')
      expect(typeof line.ts).toBe('string')
    })
  })

  it('redacts secret/PHI keys recursively', () => {
    withCaptured((cap) => {
      const log = createLogger(null, 'test')
      log.warn('attempt', { password: 'hunter2', nested: { apiKey: 'k', audio: 'bytes', ok: 1 } })
      const line = cap.lines[0] as { fields?: Record<string, unknown> }
      const nested = (line as Record<string, unknown>).nested as Record<string, unknown>
      expect((line as Record<string, unknown>).password).toBe('[redacted]')
      expect(nested.apiKey).toBe('[redacted]')
      expect(nested.audio).toBe('[redacted]')
      expect(nested.ok).toBe(1)
    })
  })

  it('ERRORs never serialize raw stack traces', () => {
    withCaptured((cap) => {
      const log = createLogger(null, 'test')
      log.error('failed', { err: new Error('boom at /srv/secret/path') })
      const line = JSON.stringify(cap.lines[0])
      expect(line).toContain('boom')
      expect(line).not.toContain('stack')
    })
  })
})

describe('correlation IDs (§36 — client strings never trusted)', () => {
  it('mints typed ids', () => {
    expect(newCorrelationId()).toMatch(/^c-[a-z0-9]+-[a-z0-9]+$/)
    expect(newCorrelationId()).not.toBe(newCorrelationId())
  })

  it('accepts well-formed client ids, replaces arbitrary ones', () => {
    expect(sanitizeCorrelationId('abcDEF123-456_789')).toBe('abcDEF123-456_789')
    expect(sanitizeCorrelationId('../../etc/passwd')).toMatch(/^c-/)
    expect(sanitizeCorrelationId("'; DROP TABLE--")).toMatch(/^c-/)
    expect(sanitizeCorrelationId(undefined)).toMatch(/^c-/)
  })

  it('reads x-correlation-id / x-request-id from requests', () => {
    const req = new Request('http://x/', { headers: { 'x-correlation-id': 'abc-123456' } })
    expect(correlationFromRequest(req)).toBe('abc-123456')
    const dirty = new Request('http://x/', { headers: { 'x-request-id': 'bad id with spaces' } })
    expect(correlationFromRequest(dirty)).toMatch(/^c-/)
  })
})

describe('API error contract (§40)', () => {
  it('produces code/message/requestId (+details) without internals', () => {
    const { status, body } = apiError('RATE_LIMITED', 'c-x', { details: { used: 60 } })
    expect(status).toBe(429)
    expect(body.error).toMatchObject({ code: 'RATE_LIMITED', requestId: 'c-x', details: { used: 60 } })
    expect(body.error.message).toBeTruthy()
  })

  it('messages are localized (Arabic + English) from the catalog', () => {
    expect(apiError('UNAUTHORIZED', 'c', { locale: 'ar-EG' }).body.error.message).toBe(API_ERROR_MESSAGES.UNAUTHORIZED.ar)
    expect(apiError('UNAUTHORIZED', 'c', { locale: 'en-US' }).body.error.message).toBe(API_ERROR_MESSAGES.UNAUTHORIZED.en)
  })

  it('status mapping covers every generic code', () => {
    expect(apiError('VALIDATION_ERROR', 'c').status).toBe(400)
    expect(apiError('DEPENDENCY_UNAVAILABLE', 'c').status).toBe(503)
    expect(apiError('TIMEOUT', 'c').status).toBe(504)
    expect(apiError('FORBIDDEN', 'c').status).toBe(403)
  })
})

describe('retry classification (§17 — never retry safety)', () => {
  it('security failures are NEVER retried', () => {
    for (const code of ['SAFETY_BLOCK', 'TENANT_MISMATCH', 'APPROVAL_REPLAY', 'FORGED_PROVENANCE', 'UNAUTHORIZED']) {
      expect(classifyError(code).maxRetries).toBe(0)
    }
  })

  it('user-action-required failures are never retried', () => {
    expect(classifyError('APPROVAL_REQUIRED').retryClass).toBe('USER_ACTION_REQUIRED')
    expect(classifyError('CLARIFICATION_REQUIRED').maxRetries).toBe(0)
  })

  it('transient infra errors get a bounded budget', () => {
    const c = classifyError('ECONNRESET')
    expect(c.retryClass).toBe('RETRYABLE')
    expect(c.maxRetries).toBeGreaterThan(0)
    expect(c.maxRetries).toBeLessThanOrEqual(3)
  })

  it('timeouts are canonical and finite (§18)', () => {
    for (const [klass, ms] of Object.entries(TIMEOUT_CLASSES_MS)) {
      expect(ms, klass).toBeGreaterThan(0)
      expect(ms, klass).toBeLessThan(10 * 60 * 1000)
    }
  })

  it('backoff schedules are bounded and exponential', () => {
    expect(backoffSchedule(3, 100)).toEqual([100, 200, 400])
  })
})

describe('audit-log rate limiter (§41)', () => {
  const fakeClient = (used: number) => ({
    auditLog: { count: async () => used },
  })

  it('allows under the limit and blocks at it', async () => {
    const scope = { hospitalId: 'h1', userId: 'u1', action: 'AI_VOICE_TURN' }
    expect((await checkRateLimit({ client: fakeClient(59) }, scope, 60)).allowed).toBe(true)
    expect((await checkRateLimit({ client: fakeClient(60) }, scope, 60)).allowed).toBe(false)
  })

  it('is scoped per tenant+user+action', async () => {
    let seen: Record<string, unknown> | null = null
    const client = { auditLog: { count: async (a: { where: unknown }) => ((seen = a.where as Record<string, unknown>), 0) } }
    await checkRateLimit({ client }, { hospitalId: 'h1', userId: 'u1', action: 'X' }, 5)
    expect(seen).toMatchObject({ hospitalId: 'h1', userId: 'u1', action: 'X' })
  })
})

describe('CORS policy (§27 — credentials never ride a wildcard)', () => {
  it('legacy mode: wildcard WITHOUT the credentials claim', () => {
    const h = corsHeadersFor('https://evil.example', {})
    expect(h['Access-Control-Allow-Origin']).toBe('*')
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined()
  })

  it('allowlist mode: matched origin gets credentials, others get nothing', () => {
    const env = { CORS_ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com' }
    const ok = corsHeadersFor('https://app.example.com', env)
    expect(ok['Access-Control-Allow-Origin']).toBe('https://app.example.com')
    expect(ok['Access-Control-Allow-Credentials']).toBe('true')
    expect(ok.Vary).toBe('Origin')
    const bad = corsHeadersFor('https://evil.example', env)
    expect(bad['Access-Control-Allow-Origin']).toBe('')
    expect(bad['Access-Control-Allow-Credentials']).toBeUndefined()
  })

  it('trailing slashes are normalized', () => {
    const env = { CORS_ALLOWED_ORIGINS: 'https://app.example.com/' }
    expect(corsHeadersFor('https://app.example.com', env)['Access-Control-Allow-Origin']).toBe('https://app.example.com')
  })
})

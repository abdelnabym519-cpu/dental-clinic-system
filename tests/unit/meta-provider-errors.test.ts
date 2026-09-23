import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetaWhatsAppProvider, metaErrorRetryable } from '@/lib/messaging/providers'

/**
 * Phase 10 (D2) — Meta Cloud API error mapping + phone normalization.
 * The queue's retry policy keys off SendResult.retryable; terminal Meta
 * errors (190 token expired, 131047 undeliverable, 131026 not on WhatsApp)
 * must NOT be retried, everything else retries (fail safe).
 */
function metaResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('MetaWhatsAppProvider (Phase 10 error mapping)', () => {
  let provider: MetaWhatsAppProvider

  beforeEach(() => {
    process.env.MESSAGING_ENABLED = 'true'
    process.env.META_WHATSAPP_TOKEN = 'test-token'
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '111222333'
    provider = new MetaWhatsAppProvider()
    vi.mocked(global.fetch).mockReset()
  })

  afterEach(() => {
    delete process.env.META_WHATSAPP_TOKEN
    delete process.env.META_WHATSAPP_PHONE_NUMBER_ID
    delete process.env.MESSAGING_ENABLED
  })

  it('sends success with the wamid as providerMessageId', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      metaResponse(200, { messages: [{ id: 'wamid.HBgLMTA' }] })
    )
    const result = await provider.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(true)
    expect(result.providerMessageId).toBe('wamid.HBgLMTA')
    expect(result.retryable).toBeUndefined()
  })

  it('normalizes the recipient to 20XXXXXXXXX in the request body', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(metaResponse(200, { messages: [{ id: 'w' }] }))
    await provider.sendMessage('010 1234 5678', { text: 'hi' })
    const call = vi.mocked(global.fetch).mock.calls[0]
    const url = String(call[0])
    const body = JSON.parse(String(call[1]?.body))
    expect(url).toBe('https://graph.facebook.com/v18.0/111222333/messages')
    expect(body.to).toBe('201012345678')
    expect(body.messaging_product).toBe('whatsapp')
  })

  it.each([
    [190, false, 'token expired'],
    [131047, false, 'undeliverable'],
    [131026, false, 'not on WhatsApp'],
  ] as const)('code %i → retryable %s (%s)', async (code, retryable, label) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      metaResponse(400, { error: { message: `fail ${label}`, code } })
    )
    const result = await provider.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe(code)
    expect(result.retryable).toBe(retryable)
    expect(result.error).toContain(label)
  })

  it('code 130429 (rate limit) is retryable — the queue backs off', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      metaResponse(429, { error: { message: 'rate limit', code: 130429 } })
    )
    const result = await provider.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe(130429)
    expect(result.retryable).toBe(true)
  })

  it('5xx without a code is retryable (server error)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('boom', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    )
    const result = await provider.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBeUndefined()
    expect(result.retryable).toBe(true)
  })

  it('unknown error without a code is retryable (fail safe)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      metaResponse(400, { error: { message: 'mystery failure' } })
    )
    const result = await provider.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.retryable).toBe(true)
  })

  it('sendTemplateMessage posts a template body with positional parameters', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(metaResponse(200, { messages: [{ id: 'w-t' }] }))
    const result = await provider.sendTemplateMessage(
      '01012345678',
      'appointment_confirmation',
      'ar',
      ['أحمد', '2026-09-30']
    )
    expect(result.success).toBe(true)
    expect(result.providerMessageId).toBe('w-t')
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body))
    expect(body.to).toBe('201012345678')
    expect(body.type).toBe('template')
    expect(body.template.name).toBe('appointment_confirmation')
    expect(body.template.language.code).toBe('ar')
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'أحمد' },
      { type: 'text', text: '2026-09-30' },
    ])
  })

  it('fails cleanly when unconfigured (no crash)', async () => {
    delete process.env.META_WHATSAPP_TOKEN
    const unconfigured = new MetaWhatsAppProvider()
    const result = await unconfigured.sendMessage('01012345678', { text: 'hi' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not configured/i)
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled()
  })
})

describe('metaErrorRetryable (pure mapping)', () => {
  it('maps known terminal codes to false, everything else to true', () => {
    expect(metaErrorRetryable(190)).toBe(false)
    expect(metaErrorRetryable(131047)).toBe(false)
    expect(metaErrorRetryable(131026)).toBe(false)
    expect(metaErrorRetryable(130429)).toBe(true)
    expect(metaErrorRetryable(999)).toBe(true)
    expect(metaErrorRetryable(undefined)).toBe(true)
  })
})

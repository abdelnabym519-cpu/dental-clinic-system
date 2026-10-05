import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  complete,
  streamResponse,
  extractJSON,
  AIUnavailableError,
  isGatewayConfigured,
  getGatewayConfig,
  gatewayBaseUrl,
  getAIHealth,
  type ChatMessage,
} from '@/lib/ai/gateway'

// Canonical Cloudflare AI Gateway runtime spec. The gateway composes
// https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/v1/chat/completions
// (OpenAI-compatible) from pattern-validated IDs, authenticates with the
// server-only token, enforces a timeout, falls back explicitly to the
// configured fallback model, and fails with typed Arabic-safe
// AIUnavailableError — never with raw provider/environment strings.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleMessages: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful dental assistant.' },
  { role: 'user', content: 'What is a root canal?' },
]

const ENV_SNAPSHOT = { ...process.env }
const GATEWAY_ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_AI_GATEWAY_ID',
  'DEN_TORA_AI_TIMEOUT_MS',
  'DEN_TORA_AI_MODEL',
  'DEN_TORA_AI_FALLBACK_MODEL',
]

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return { ok: true, body: readable } as unknown as Response
}

function jsonCompletion(overrides: Record<string, unknown> = {}, model = 'google/gemini-2.5-pro'): Response {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: 'parsed-content' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        model,
        ...overrides,
      }),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// extractJSON
// ---------------------------------------------------------------------------

describe('extractJSON', () => {
  it('extracts JSON from a ```json ... ``` code block', () => {
    expect(extractJSON('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('extracts JSON from a plain ``` block', () => {
    expect(extractJSON('```\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('returns trimmed plain text when no code block is present', () => {
    expect(extractJSON('  {"a":1}  ')).toBe('{"a":1}')
  })
  it('extracts only the first code block when multiple exist', () => {
    expect(extractJSON('```json\n{"first":true}\n```\n```json\n{"second":true}\n```')).toBe('{"first":true}')
  })
  it('returns empty string for whitespace-only input', () => {
    expect(extractJSON('   ')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// configuration & SSRF-safe URL composition
// ---------------------------------------------------------------------------

describe('gateway configuration', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset()
    for (const k of GATEWAY_ENV_KEYS) delete process.env[k]
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cert-account'
    process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'cert-gateway'
  })

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT }
  })

  it('isGatewayConfigured requires all three identifiers', () => {
    expect(isGatewayConfigured()).toBe(true)
    delete process.env.CLOUDFLARE_API_TOKEN
    expect(isGatewayConfigured()).toBe(false)
  })

  it('getGatewayConfig throws typed AI_NOT_CONFIGURED (Arabic-safe) when unset', () => {
    for (const k of GATEWAY_ENV_KEYS) delete process.env[k]
    try {
      getGatewayConfig()
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError)
      expect((err as AIUnavailableError).code).toBe('AI_NOT_CONFIGURED')
      expect((err as AIUnavailableError).message).toMatch(/[\u0600-\u06FF]/)
      expect((err as AIUnavailableError).correlationId).toBeTruthy()
    }
  })

  it('rejects identifier shapes that could alter the URL (SSRF-safe composition)', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = '../admin'
    expect(() => getGatewayConfig()).toThrow(AIUnavailableError)
    process.env.CLOUDFLARE_ACCOUNT_ID = 'ok-id'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'bad id'
    expect(() => getGatewayConfig()).toThrow(AIUnavailableError)
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'ok_gateway-1'
    expect(gatewayBaseUrl(getGatewayConfig())).toBe(
      'https://gateway.ai.cloudflare.com/v1/ok-id/ok_gateway-1'
    )
  })
})

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe('complete', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset()
    for (const k of GATEWAY_ENV_KEYS) delete process.env[k]
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cert-account'
    process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'cert-gateway'
  })

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT }
  })

  it('posts to the Cloudflare AI Gateway OpenAI-compatible endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages)
    const [url, options] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/cert-account/cert-gateway/v1/chat/completions')
    expect((options as RequestInit).method).toBe('POST')
  })

  it('authenticates with the server-only token and JSON content type', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages)
    const headers = (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-cf-token')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('sends the tier model, messages, max_tokens and temperature', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages, { model: 'anthropic/claude-opus-4.5', maxTokens: 1024, temperature: 0.2 })
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('anthropic/claude-opus-4.5')
    expect(body.messages).toEqual(sampleMessages)
    expect(body.max_tokens).toBe(1024)
    expect(body.temperature).toBe(0.2)
  })

  it('honors temperature 0 (no falsy fallback to the default)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages, { temperature: 0 })
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.temperature).toBe(0)
  })

  it('resolves the model from DEN_TORA_AI_MODEL when the config carries none', async () => {
    process.env.DEN_TORA_AI_MODEL = 'deepseek/deepseek-r1'
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion({}, 'deepseek/deepseek-r1'))
    await complete(sampleMessages)
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('deepseek/deepseek-r1')
  })

  it('Workers AI model ids (@cf/…) flow to the wire body unchanged', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion({}, '@cf/zai-org/glm-4.7-flash'))
    await complete(sampleMessages, { model: '@cf/zai-org/glm-4.7-flash' })
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('@cf/zai-org/glm-4.7-flash')
  })

  it('maps the OpenAI-compatible payload onto CompletionResponse', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    const out = await complete(sampleMessages)
    expect(out.content).toBe('parsed-content')
    expect(out.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 })
    expect(out.model).toBe('google/gemini-2.5-pro')
  })

  it('defaults missing content/usage fields (0-token usage never NaN)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonCompletion({ choices: [], usage: undefined }, 'm-1')
    )
    const out = await complete(sampleMessages)
    expect(out.content).toBe('')
    expect(out.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
    expect(out.model).toBe('m-1')
  })

  it('reasoning alongside content normalizes both without breaking extraction', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"model":"patient"}', reasoning_content: 'سأفحص جدول المرضى أولاً' } }],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
          model: '@cf/zai-org/glm-4.7-flash',
        }),
    } as unknown as Response)
    const out = await complete(sampleMessages)
    expect(out.content).toBe('{"model":"patient"}')
    expect(out.reasoning).toBe('سأفحص جدول المرضى أولاً')
    expect(out.model).toBe('@cf/zai-org/glm-4.7-flash')
  })

  it('reasoning-only response → truthful typed failure (never a successful empty report)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '', reasoning_content: 'سلسلة استدلال فقط' } }],
          usage: { prompt_tokens: 9, completion_tokens: 0, total_tokens: 9 },
          model: '@cf/zai-org/glm-4.7-flash',
        }),
    } as unknown as Response)
    try {
      await complete(sampleMessages)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError)
      expect((err as AIUnavailableError).code).toBe('AI_PROVIDER_ERROR')
      expect((err as AIUnavailableError).message).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('reasoning-only primary triggers the configured fallback and succeeds there', async () => {
    process.env.DEN_TORA_AI_FALLBACK_MODEL = 'google/gemini-2.5-flash'
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: '', reasoning_content: 'استدلال فقط' } }],
            usage: {},
            model: 'primary',
          }),
      } as unknown as Response)
      .mockResolvedValueOnce(jsonCompletion({}, 'google/gemini-2.5-flash'))
    const out = await complete(sampleMessages)
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const body2 = JSON.parse((vi.mocked(global.fetch).mock.calls[1][1] as RequestInit).body as string)
    expect(body2.model).toBe('google/gemini-2.5-flash')
    expect(out.content).toBe('parsed-content')
  })

  it('genuinely empty content (no reasoning) keeps the legacy normalized shape', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion({ choices: [] }))
    const out = await complete(sampleMessages)
    expect(out.content).toBe('')
    expect(out.reasoning).toBeUndefined()
  })

  it('provider rejection → typed AI_PROVIDER_ERROR with Arabic-safe message and correlation id', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'upstream boom' } as unknown as Response)
    try {
      await complete(sampleMessages)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError)
      const e = err as AIUnavailableError
      expect(e.code).toBe('AI_PROVIDER_ERROR')
      expect(e.correlationId).toBeTruthy()
      expect(e.message).toMatch(/[\u0600-\u06FF]/)
      // provider error bodies are never surfaced raw
      expect(e.message).not.toContain('upstream boom')
    }
  })

  it('falls back explicitly to DEN_TORA_AI_FALLBACK_MODEL once on primary failure', async () => {
    process.env.DEN_TORA_AI_FALLBACK_MODEL = 'google/gemini-2.5-flash'
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' } as unknown as Response)
      .mockResolvedValueOnce(jsonCompletion({}, 'google/gemini-2.5-flash'))
    const out = await complete(sampleMessages)
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const body1 = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    const body2 = JSON.parse((vi.mocked(global.fetch).mock.calls[1][1] as RequestInit).body as string)
    expect(body1.model).toBe('google/gemini-2.5-pro')
    expect(body2.model).toBe('google/gemini-2.5-flash')
    expect(out.model).toBe('google/gemini-2.5-flash')
  })

  it('no fallback configured → single attempt, typed failure propagates', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 500, text: async () => 'err' } as unknown as Response)
    await expect(complete(sampleMessages)).rejects.toBeInstanceOf(AIUnavailableError)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('both primary and fallback failing → typed failure (never a silent partial success)', async () => {
    process.env.DEN_TORA_AI_FALLBACK_MODEL = 'google/gemini-2.5-flash'
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 500, text: async () => 'err' } as unknown as Response)
    await expect(complete(sampleMessages)).rejects.toBeInstanceOf(AIUnavailableError)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('network failure → typed AI_PROVIDER_ERROR (Arabic-safe, no stack leak)', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('fetch failed'))
    try {
      await complete(sampleMessages)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError)
      expect((err as AIUnavailableError).code).toBe('AI_PROVIDER_ERROR')
      expect((err as AIUnavailableError).message).toMatch(/[\u0600-\u06FF]/)
      expect((err as AIUnavailableError).message).not.toContain('fetch failed')
    }
  })

  it('enforces DEN_TORA_AI_TIMEOUT_MS and maps abort to typed AI_TIMEOUT', async () => {
    vi.useFakeTimers()
    try {
      process.env.DEN_TORA_AI_TIMEOUT_MS = '50'
      vi.mocked(global.fetch).mockImplementationOnce(
        (_url, init) =>
          new Promise((_, reject) => {
            ;(init as RequestInit).signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            )
          })
      )
      const pending = complete(sampleMessages)
      const assertion = expect(pending).rejects.toBeInstanceOf(AIUnavailableError)
      await vi.advanceTimersByTimeAsync(80)
      await assertion
      // if the timeout had NOT fired, `pending` would never settle and the
      // expect above would hang until the test times out — an honest failure.
      await expect(pending).rejects.toMatchObject({ code: 'AI_TIMEOUT', name: 'AIUnavailableError' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('unconfigured gateway → typed AI_NOT_CONFIGURED before any network call', async () => {
    for (const k of GATEWAY_ENV_KEYS) delete process.env[k]
    await expect(complete(sampleMessages)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// streamResponse
// ---------------------------------------------------------------------------

describe('streamResponse', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset()
    for (const k of GATEWAY_ENV_KEYS) delete process.env[k]
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cert-account'
    process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'cert-gateway'
  })

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT }
  })

  async function drain(res: Response): Promise<string> {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out += decoder.decode(value, { stream: true })
    }
    return out
  }

  it('posts to the gateway with stream:true and returns an SSE Response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(sseResponse(['data: [DONE]\n\n']))
    const res = await streamResponse(sampleMessages)
    const [url, options] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/cert-account/cert-gateway/v1/chat/completions')
    const body = JSON.parse((options as RequestInit).body as string)
    expect(body.stream).toBe(true)
    expect(res).toBeInstanceOf(Response)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('transforms provider deltas into {"text"} events and ends with {"done":true}', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"مرحبًا"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" بك"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    const out = await drain(await streamResponse(sampleMessages))
    expect(out).toContain('data: {"text":"مرحبًا"}')
    expect(out).toContain('data: {"text":" بك"}')
    expect(out).toContain('data: {"done":true}')
  })

  it('skips non-data lines, empty deltas and malformed JSON chunks', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      sseResponse([
        ': comment\n',
        'event: ping\n',
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {broken json\n\n',
        'data: {"choices":[{"delta":{"content":"kept"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    )
    const out = await drain(await streamResponse(sampleMessages))
    expect(out).toContain('data: {"text":"kept"}')
    expect(out).toContain('data: {"done":true}')
    expect(out).not.toContain('comment')
    expect(out).not.toContain('ping')
    expect(out).not.toContain('broken')
    expect(out.match(/data: /g)).toHaveLength(2)
  })

  it('provider rejection on stream → typed AI_PROVIDER_ERROR (Arabic-safe)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'down' } as unknown as Response)
    try {
      await streamResponse(sampleMessages)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError)
      expect((err as AIUnavailableError).code).toBe('AI_PROVIDER_ERROR')
      expect((err as AIUnavailableError).message).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('empty response body → typed failure, not an empty 200 stream', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: true, body: null } as unknown as Response)
    await expect(streamResponse(sampleMessages)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('unconfigured gateway → typed AI_NOT_CONFIGURED before any network call', async () => {
    for (const k of GATEWAY_ENV_KEYS) delete process.env[k]
    await expect(streamResponse(sampleMessages)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// health (consumed by /api/ai/runtime-status)
// ---------------------------------------------------------------------------

describe('getAIHealth', () => {
  beforeEach(() => {
    for (const k of GATEWAY_ENV_KEYS) delete process.env[k]
  })

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT }
  })

  it('UNAVAILABLE without configuration — deterministic local engines stay local', () => {
    const h = getAIHealth()
    expect(h.status).toBe('UNAVAILABLE')
    expect(h.configured).toBe(false)
    expect(h.runtime).toBe('cloudflare-ai-gateway')
    expect(h.localEngines).toBe('local')
    expect(h.detail).toMatch(/[\u0600-\u06FF]/)
  })

  it('CONFIGURED with valid identifiers (no probe, no AVAILABLE fabrication)', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a1'
    process.env.CLOUDFLARE_API_TOKEN = 't'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'g1'
    const h = getAIHealth()
    expect(h.status).toBe('CONFIGURED')
    expect(h.status).not.toBe('AVAILABLE')
  })

  it('MISCONFIGURED when identifier shapes are invalid', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a1'
    process.env.CLOUDFLARE_API_TOKEN = 't'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'bad/id'
    const h = getAIHealth()
    expect(h.status).toBe('MISCONFIGURED')
  })
})

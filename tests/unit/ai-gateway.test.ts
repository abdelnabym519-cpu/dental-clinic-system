import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  complete,
  streamResponse,
  extractJSON,
  AIUnavailableError,
  isGatewayConfigured,
  getGatewayConfig,
  chatCompletionsEndpoint,
  getAIHealth,
  type ChatMessage,
} from '@/lib/ai/gateway'

// Canonical Cloudflare AI runtime spec. The gateway posts to the
// OpenAI-compatible Cloudflare REST AI endpoint
//   https://api.cloudflare.com/client/v4/{account}/ai/v1/chat/completions
// composed from pattern-validated IDs, authenticates with the server-only
// Cloudflare token, routes through the configured AI Gateway via the
// `cf-aig-gateway-id` header (required for @cf/ models), enforces a timeout,
// falls back explicitly to the configured fallback model, and fails with
// typed Arabic-safe AIUnavailableError — never with raw provider strings.

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

  it('TIMEOUT CONTRACT: default is the measured 120s (reasoning model ~19 tok/s); explicit env stays authoritative', () => {
    // no env set → measured default (the old 30s aborted mid-generation)
    const cfg = getGatewayConfig()
    expect(cfg.timeoutMs).toBe(120_000)
    // explicit env knob is authoritative (ops + tests win)
    process.env.DEN_TORA_AI_TIMEOUT_MS = '5000'
    expect(getGatewayConfig().timeoutMs).toBe(5000)
    delete process.env.DEN_TORA_AI_TIMEOUT_MS
  })

  it('isAIUnavailableError classifies the typed contract structurally (mock/bundle-safe)', async () => {
    const { isAIUnavailableError } = await import('@/lib/ai/gateway')
    for (const code of ['AI_NOT_CONFIGURED', 'AI_TIMEOUT', 'AI_PROVIDER_ERROR']) {
      expect(isAIUnavailableError(Object.assign(new Error('x'), { name: 'AIUnavailableError', code }))).toBe(true)
    }
    expect(isAIUnavailableError(new TypeError('fetch failed'))).toBe(false)
    expect(isAIUnavailableError('string error')).toBe(false)
    expect(isAIUnavailableError(null)).toBe(false)
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
    // Full pathname contract: /client/v4/accounts/{account}/ai/v1/chat/completions.
    // The gateway identifier rides in the cf-aig-gateway-id header, never the URL.
    expect(chatCompletionsEndpoint(getGatewayConfig())).toBe(
      'https://api.cloudflare.com/client/v4/accounts/ok-id/ai/v1/chat/completions'
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
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/cert-account/ai/v1/chat/completions')
    expect((options as RequestInit).method).toBe('POST')
  })

  it('WIRE PARITY (400 root-cause pin): conversation ends with a user turn, body has no null/extra fields', async () => {
    // The proven-working Cloudflare request shape is system… + user. A
    // system-only payload (conversation ending on role "system") is what the
    // provider rejects with HTTP 400. This pins the invariant absolutely.
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(
      [
        { role: 'system', content: 'INSTRUCTIONS' },
        { role: 'user', content: 'ما إجمالي الإيرادات هذا الشهر؟' },
      ],
      { model: '@cf/zai-org/glm-4.7-flash', maxTokens: 100 }
    )
    const [, options] = vi.mocked(global.fetch).mock.calls[0]
    const body = JSON.parse((options as RequestInit).body as string)
    const messages = body.messages
    expect(messages.at(-1).role).toBe('user') // ← the exact 400-causing invariant
    expect(messages[0].role).toBe('system')
    expect(messages.at(-1).content).toBe('ما إجمالي الإيرادات هذا الشهر؟')
    // no null / undefined / empty-string fields may ever serialize
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/:null|:""|:undefined/)
    // exactly the proven-curl body fields — no extra OpenAI params
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'temperature'])
    // model preserved exactly, @cf/ namespace included
    expect(body.model).toBe('@cf/zai-org/glm-4.7-flash')
  })

  it('system-only message arrays are normalized to end with a user turn (content carried verbatim)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete([{ role: 'system', content: 'TRANSLATOR-PROMPT + clinic question' }])
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]).toEqual({ role: 'user', content: 'TRANSLATOR-PROMPT + clinic question' })
    // nothing is invented: the payload content is the caller's, relocated
  })

  it('Cloudflare rejection reasons are captured server-side (typed client error unchanged, secrets redacted)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      process.env.CLOUDFLARE_API_TOKEN = 'super-secret-token-value'
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            success: false,
            errors: [{ code: 7423, message: 'invalid payload: last message must be from user' }],
          }),
      } as unknown as Response)
      try {
        await complete(sampleMessages, { model: '@cf/zai-org/glm-4.7-flash' })
        throw new Error('should have thrown')
      } catch (err) {
        // clients still receive the same typed Arabic-safe error…
        expect(err).toBeInstanceOf(AIUnavailableError)
        expect((err as AIUnavailableError).code).toBe('AI_PROVIDER_ERROR')
        expect((err as AIUnavailableError).message).toMatch(/[\u0600-\u06FF]/)
        expect((err as AIUnavailableError).message).not.toContain('7423')
        expect((err as AIUnavailableError).message).not.toContain('invalid payload')
      }
      // …while the exact Cloudflare rejection is diagnosable from server logs
      const logLine = infoSpy.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('provider_rejection'))
      expect(logLine).toBeTruthy()
      expect(logLine).toContain('"providerStatus":400')
      expect(logLine).toContain('"cfErrorCode":7423')
      expect(logLine).toContain('last message must be from user')
      // no secret material anywhere in the logs
      const allLogs = infoSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(allLogs).not.toContain('super-secret-token-value')
      expect(allLogs).not.toContain('Bearer super-secret')
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('provider rejections carry providerStatus (401 → AUTHENTICATION-classifiable)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid token' } as unknown as Response)
      try {
        await complete(sampleMessages)
        throw new Error('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AIUnavailableError)
        expect((err as AIUnavailableError).code).toBe('AI_PROVIDER_ERROR')
        expect((err as AIUnavailableError).providerStatus).toBe(401)
      }
      // the structural check still holds for the enriched error
      const { isAIUnavailableError } = await import('@/lib/ai/gateway')
      vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'forbidden' } as unknown as Response)
      const e403 = await complete(sampleMessages).catch((e) => e)
      expect(isAIUnavailableError(e403)).toBe(true)
      expect(e403.providerStatus).toBe(403)
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('a bearer-shaped string inside provider error text is redacted before logging', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'oops Bearer abc.def.ghi leaked-shape',
      } as unknown as Response)
      await expect(complete(sampleMessages)).rejects.toBeInstanceOf(AIUnavailableError)
      const allLogs = infoSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(allLogs).toContain('Bearer [redacted]')
      expect(allLogs).not.toContain('abc.def.ghi')
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('URI CONTRACT (CF-7000 regression pin): /client/v4/accounts/{account}/ai/v1/chat/completions, byte-exact', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages)
    const [rawUrl, options] = vi.mocked(global.fetch).mock.calls[0]
    const u = new URL(String(rawUrl))
    // exact pathname — asserts the literal /accounts segment and the account
    // id in the ONLY position that routes (missing it = Cloudflare 7000)
    expect(u.protocol).toBe('https:')
    expect(u.hostname).toBe('api.cloudflare.com')
    expect(u.pathname).toBe('/client/v4/accounts/cert-account/ai/v1/chat/completions')
    expect(u.pathname.startsWith('/client/v4/accounts/')).toBe(true)
    expect(u.pathname).not.toMatch(/accounts\/.*\/accounts\//) // no duplication
    expect(u.pathname.endsWith('/')).toBe(false) // no trailing slash
    expect(u.search).toBe('') // no query mutation
    // gateway id must NEVER appear in the path — header-only routing
    expect(u.pathname).not.toContain('cert-gateway')
    const headers = (options as RequestInit).headers as Record<string, string>
    expect(headers['cf-aig-gateway-id']).toBe('cert-gateway')
    // Authorization stays header-based and is not serialized into the URL
    expect(String(rawUrl)).not.toContain('Bearer')
    expect(headers['Authorization']).toMatch(/^Bearer /)
  })

  it('authenticates with the server-only token, JSON content type, and the gateway header', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages)
    const headers = (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-cf-token')
    expect(headers['Content-Type']).toBe('application/json')
    // AI Gateway routing — REQUIRED for @cf/ models, selects the gateway otherwise
    expect(headers['cf-aig-gateway-id']).toBe('cert-gateway')
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

  it('defaults missing usage fields (0-token usage never NaN; content present)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonCompletion({ choices: [{ message: { content: 'النتيجة جاهزة' }, finish_reason: 'stop' }], usage: undefined }, 'm-1')
    )
    const out = await complete(sampleMessages)
    expect(out.content).toBe('النتيجة جاهزة')
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

  it('no usable assistant content at all → truthful typed failure (never empty success)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion({ choices: [] }))
    try {
      await complete(sampleMessages)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError)
      expect((err as AIUnavailableError).code).toBe('AI_PROVIDER_ERROR')
      expect((err as AIUnavailableError).message).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('finish_reason length with empty content → budget-exhaustion typed failure naming the knob', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: null }, finish_reason: 'length' }],
          usage: { prompt_tokens: 20, completion_tokens: 4096, total_tokens: 4116 },
          model: '@cf/zai-org/glm-4.7-flash',
        }),
    } as unknown as Response)
    try {
      await complete(sampleMessages)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError)
      expect((err as AIUnavailableError).code).toBe('AI_PROVIDER_ERROR')
      expect((err as AIUnavailableError).message).toContain('DEN_TORA_AI_MAX_TOKENS')
    }
  })

  it('budget-exhausted primary still triggers the configured fallback (explicit, observable)', async () => {
    process.env.DEN_TORA_AI_FALLBACK_MODEL = 'google/gemini-2.5-flash'
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: null, reasoning_content: 'تفكير طويل' }, finish_reason: 'length' }],
            usage: {},
            model: 'primary',
          }),
      } as unknown as Response)
      .mockResolvedValueOnce(jsonCompletion({}, 'google/gemini-2.5-flash'))
    const out = await complete(sampleMessages)
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(out.content).toBe('parsed-content')
  })

  it('DEN_TORA_AI_MAX_TOKENS overrides the budget when the tier config carries none', async () => {
    process.env.DEN_TORA_AI_MAX_TOKENS = '777'
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages)
    let body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.max_tokens).toBe(777)
    // explicit tier config still wins over the env knob
    vi.mocked(global.fetch).mockClear()
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonCompletion())
    await complete(sampleMessages, { maxTokens: 2048 })
    body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.max_tokens).toBe(2048)
  })

  it('a malformed configured model fails fast and truthfully before any network call', async () => {
    process.env.DEN_TORA_AI_MODEL = 'bad model\nwith-newline'
    await expect(complete(sampleMessages)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    expect(global.fetch).not.toHaveBeenCalled()
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
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/cert-account/ai/v1/chat/completions')
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

/**
 * DenToRa canonical external-LLM runtime — Cloudflare AI Gateway.
 *
 * EVERY external LLM call in the application resolves through this module:
 *
 *   DenToRa feature
 *     → lib/ai/gateway (this file: routing, fallback, timeout, observability)
 *       → Cloudflare REST AI API (OpenAI-compatible), routed through the
 *         configured AI Gateway via the `cf-aig-gateway-id` header
 *           POST https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions
 *         → configured model (@cf/… Workers AI, or openai/…, anthropic/…, google/…)
 *
 * Feature code never sees account IDs, gateway URLs, tokens, or provider
 * endpoints — only `complete()` / `streamResponse()` / `extractJSON()` and
 * the shared message/usage types. The provider-prefixed model strings that
 * the repository already uses (`google/gemini-2.5-pro`,
 * `anthropic/claude-opus-4.5`) are exactly the model identifiers the
 * AI-Gateway OpenAI-compatible endpoint routes by, so tier defaults carry
 * over unchanged and stay configuration-driven.
 *
 * Migration contract (this module replaced the retired single-provider
 * client 1:1 — same exported names and shapes, so feature logic is
 * untouched): no production feature may reference a direct provider
 * endpoint or a provider-specific API key; the architectural audit in
 * tests/ai/cloudflare-migration.test.ts enforces this absolutely.
 *
 * Cloudflare surface contract (per official docs, AI Gateway → REST API):
 * /accounts/{account}/ai/v1/chat/completions serves BOTH Workers AI
 * (`@cf/…`) and third-party (`author/model`) models with a Cloudflare token
 * (Workers AI Read permission); the `cf-aig-gateway-id` header selects the
 * gateway and is REQUIRED for `@cf/` requests. The previously used
 * host-routed `gateway.ai.cloudflare.com/v1/{acct}/{gw}/…` surface rejects
 * these requests (HTTP 400) — do not reintroduce it.
 *
 * Fallback policy (explicit, observable — never silent):
 *   primary tier model → configured fallback model → typed AIUnavailableError
 *   (no silent provider switching, no silent local↔cloud crossing; the local
 *   dental engines keep their own transport in lib/ai-orchestrator).
 *
 * Security: server-only credentials; SSRF-safe URL composition (IDs are
 * pattern-validated, never user input); timeouts enforced; errors are
 * Arabic-safe and never carry tokens or authorization headers; logs carry
 * correlation IDs and usage metadata only.
 */

import type { ModelConfig } from './models'

// ── Public contract (identical shapes to the retired module) ───────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface CompletionResponse {
  content: string
  /** Chain-of-thought/reasoning channel when the provider returns one separately. */
  reasoning?: string
  usage: CompletionUsage
  model: string
}

/** Typed failure so features can distinguish "LLM unavailable" from bugs. */
export class AIUnavailableError extends Error {
  readonly code: 'AI_NOT_CONFIGURED' | 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR'
  readonly correlationId: string
  constructor(
    message: string,
    code: 'AI_NOT_CONFIGURED' | 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR',
    correlationId: string
  ) {
    super(message)
    this.name = 'AIUnavailableError'
    this.code = code
    this.correlationId = correlationId
  }
}

// ── Configuration (server-only; never imported by client code) ─────────────

/** `[A-Za-z0-9_-]+` — composed into the gateway URL; rejects injection shapes. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export interface GatewayConfig {
  accountId: string
  apiToken: string
  gatewayId: string
  timeoutMs: number
}

/** True when the Cloudflare AI Gateway is configured (presence only — no values). */
export function isGatewayConfigured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_API_TOKEN &&
      process.env.CLOUDFLARE_AI_GATEWAY_ID
  )
}

/**
 * Resolve and validate the gateway configuration.
 * Throws AIUnavailableError('AI_NOT_CONFIGURED'|…) with an Arabic-safe message
 * when invalid — configuration errors must be diagnosable without leaking any
 * value (IDs are echoed only when they match the safe pattern, else omitted).
 */
export function getGatewayConfig(): GatewayConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || ''
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID || ''
  const timeoutMs = Number(process.env.DEN_TORA_AI_TIMEOUT_MS) || 30_000

  if (!accountId || !apiToken || !gatewayId) {
    throw new AIUnavailableError(
      'خدمة الذكاء الاصطناعي غير مهيأة — أضف بيانات Cloudflare AI Gateway إلى إعدادات الخادم.',
      'AI_NOT_CONFIGURED',
      newCorrelationId()
    )
  }
  if (!SAFE_ID.test(accountId) || !SAFE_ID.test(gatewayId)) {
    throw new AIUnavailableError(
      'إعدادات Cloudflare AI Gateway غير صالحة — راجع معرف الحساب والبوابة.',
      'AI_PROVIDER_ERROR',
      newCorrelationId()
    )
  }
  return { accountId, apiToken, gatewayId, timeoutMs }
}

function newCorrelationId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `llm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

/**
 * The OpenAI-compatible Cloudflare REST AI endpoint (composed from
 * validated IDs only). The gateway rides in the `cf-aig-gateway-id`
 * request header — never in the URL.
 */
export function chatCompletionsEndpoint(cfg: GatewayConfig): string {
  // /accounts/ is a REQUIRED literal path segment (Cloudflare error 7000
  // "No route for that URI" is emitted for /client/v4/{account}/ai/...).
  return `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/v1/chat/completions`
}

// ── Model routing (configuration-driven; no hard-coded provider choice) ────

/**
 * Model names travel inside the request body only, but a malformed env value
 * (whitespace/newline) must fail fast and truthfully — never serialize.
 */
const MODEL_SAFE = /^[A-Za-z0-9@._/-]{1,128}$/

/**
 * Model resolution: callers normally pass a tier-resolved ModelConfig from
 * lib/ai/models (which already applies the DEN_TORA_AI_* env overrides at the
 * single tier-resolution point). Explicit config.model always wins.
 * The value is sent to Cloudflare EXACTLY as configured (`@cf/…` included).
 */
function resolveModel(config: Partial<ModelConfig>): string {
  const model =
    config.model ||
    process.env.DEN_TORA_AI_MODEL ||
    'google/gemini-2.5-pro' // last-resort default, identical to the legacy client
  if (!MODEL_SAFE.test(model)) {
    throw new AIUnavailableError(
      'إعدادات نموذج الذكاء الاصطناعي غير صالحة — راجع DEN_TORA_AI_MODEL.',
      'AI_NOT_CONFIGURED',
      newCorrelationId()
    )
  }
  return model
}

/** Completion token budget: tier config first, then the DEN_TORA_AI_MAX_TOKENS env knob, then 4096. */
function resolveMaxTokens(config: Partial<ModelConfig>): number {
  const envBudget = Number(process.env.DEN_TORA_AI_MAX_TOKENS)
  return config.maxTokens || (Number.isFinite(envBudget) && envBudget > 0 ? envBudget : 4096)
}

// ── Observability (structured, secret-free, correlation-ID-bearing) ────────

interface RequestMeta {
  correlationId: string
  model: string
  startedAt: number
}

function logLLM(
  event: 'attempt' | 'success' | 'fallback' | 'failure',
  meta: RequestMeta,
  extra: Record<string, unknown> = {}
): void {
  // Never: tokens, authorization headers, prompts, or patient data.
  console.info(
    `[ai-gateway] ${event}`,
    JSON.stringify({
      correlationId: meta.correlationId,
      model: meta.model,
      latencyMs: Date.now() - meta.startedAt,
      ...extra,
    })
  )
}

// ── Core request path ──────────────────────────────────────────────────────

/**
 * OpenAI-compatible generation requires the conversation to END with a
 * user/assistant turn. Providers reject system-only payloads with HTTP 400
 * (invalid payload) — the proven-working request shape is system… + user.
 * Feature code that passes instruction-only (system) message arrays is
 * normalized here, in the one canonical client: the LAST system message is
 * demoted to the user turn (content is carried verbatim — nothing is
 * invented, removed, or reordered beyond this demotion).
 */
export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.length || messages.some((m) => m.role !== 'system')) return messages
  const last = messages[messages.length - 1]
  return [...messages.slice(0, -1), { role: 'user' as const, content: last.content }]
}

/**
 * Server-side, secret-safe capture of a provider rejection (e.g. HTTP 400).
 * Extracts ONLY the Cloudflare error code and a truncated message so the
 * exact rejection reason is diagnosable from server logs. Never returns or
 * logs the request body, prompts, patient data, or the authorization token;
 * any bearer-shaped string in provider text is redacted. Clients keep
 * receiving the same typed Arabic-safe error as before.
 */
async function describeProviderRejection(res: Response): Promise<Record<string, unknown>> {
  const raw = await res.text().catch(() => '')
  if (!raw) return { providerStatus: res.status }
  const redacted = raw.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
  try {
    const parsed = JSON.parse(redacted) as { errors?: Array<{ code?: unknown; message?: unknown }> }
    const first = Array.isArray(parsed.errors) ? parsed.errors[0] : undefined
    return {
      providerStatus: res.status,
      cfErrorCode: first && (typeof first.code === 'number' || typeof first.code === 'string') ? first.code : undefined,
      cfErrorMessage:
        first && typeof first.message === 'string'
          ? first.message.replace(/\s+/g, ' ').slice(0, 300)
          : undefined,
    }
  } catch {
    return { providerStatus: res.status, cfErrorExcerpt: redacted.replace(/\s+/g, ' ').slice(0, 200) }
  }
}

function getHeaders(cfg: GatewayConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiToken}`,
    'Content-Type': 'application/json',
    // Routes the request through the configured AI Gateway. REQUIRED for
    // Workers AI (`@cf/…`) models; selects the gateway for third-party
    // models. Value is SAFE_ID-validated (no header injection).
    'cf-aig-gateway-id': cfg.gatewayId,
  }
}

async function postChat(
  cfg: GatewayConfig,
  body: Record<string, unknown>,
  meta: RequestMeta
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  try {
    return await fetch(chatCompletionsEndpoint(cfg), {
      method: 'POST',
      headers: getHeaders(cfg),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    const aborted = controller.signal.aborted
    logLLM('failure', meta, { reason: aborted ? 'timeout' : 'network' })
    throw new AIUnavailableError(
      aborted ? 'انتهت مهلة الاتصال بخدمة الذكاء الاصطناعي.' : 'تعذر الاتصال بخدمة الذكاء الاصطناعي.',
      aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR',
      meta.correlationId
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Non-streaming chat completion through the gateway, with the configured
 * fallback model on primary failure. Errors are typed AIUnavailableError
 * with Arabic-safe messages and a correlation id for server-side tracing.
 */
export async function complete(
  messages: ChatMessage[],
  config: Partial<ModelConfig> = {}
): Promise<CompletionResponse> {
  const cfg = getGatewayConfig()
  const correlationId = newCorrelationId()
  const primaryModel = resolveModel(config)
  const fallbackModel = process.env.DEN_TORA_AI_FALLBACK_MODEL
  const wireMessages = normalizeMessages(messages)

  const attempt = async (model: string): Promise<CompletionResponse> => {
    const meta: RequestMeta = { correlationId, model, startedAt: Date.now() }
    logLLM('attempt', meta)
    const res = await postChat(
      cfg,
      {
        model,
        messages: wireMessages,
        max_tokens: resolveMaxTokens(config),
        temperature: config.temperature ?? 0.7,
      },
      meta
    )
    if (!res.ok) {
      // Provider hints stay server-side (structured, secret-safe) — clients
      // keep receiving the same typed Arabic-safe error.
      const rejection = await describeProviderRejection(res)
      logLLM('failure', meta, { reason: 'provider_rejection', ...rejection })
      throw new AIUnavailableError(
        'خدمة الذكاء الاصطناعي رفضت الطلب مؤقتًا. حاول مرة أخرى.',
        'AI_PROVIDER_ERROR',
        correlationId
      )
    }
    const data = await res.json()
    const finishReason: string | undefined = data.choices?.[0]?.finish_reason || undefined
    const out: CompletionResponse = {
      content: data.choices?.[0]?.message?.content || '',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: data.model || model,
    }
    // Reasoning models (e.g. GLM/DeepSeek families through the gateway) may
    // return their chain-of-thought in a separate `reasoning_content` field.
    // Normalize it, but NEVER present a reasoning-only response as a
    // successful empty report: genuinely absent content is a truthful typed
    // failure (and triggers the configured fallback path like any other
    // provider failure) instead of fabricated output.
    const reasoning: string | undefined = data.choices?.[0]?.message?.reasoning_content
    if (reasoning) out.reasoning = reasoning
    // Truthful content handling: reasoning models may exhaust the token
    // budget before emitting content (finish_reason 'length'), or return
    // nothing usable at all. None of these may masquerade as a successful
    // empty answer — each is a typed failure that still triggers the
    // configured fallback path.
    if (!out.content && out.reasoning) {
      logLLM('failure', meta, { reason: 'reasoning_only_response', finishReason })
      throw new AIUnavailableError(
        'أعاد النموذج استدلالًا دون محتوى قابل للعرض. حاول مرة أخرى.',
        'AI_PROVIDER_ERROR',
        correlationId
      )
    }
    if (!out.content && finishReason === 'length') {
      logLLM('failure', meta, { reason: 'output_budget_exhausted', finishReason })
      throw new AIUnavailableError(
        'وصل النموذج إلى حد المخرجات قبل إنتاج محتوى — ارفع حد الرموز عبر DEN_TORA_AI_MAX_TOKENS.',
        'AI_PROVIDER_ERROR',
        correlationId
      )
    }
    if (!out.content) {
      logLLM('failure', meta, { reason: 'empty_content', finishReason })
      throw new AIUnavailableError(
        'لم يُرجع النموذج محتوى قابلًا للاستخدام. حاول مرة أخرى.',
        'AI_PROVIDER_ERROR',
        correlationId
      )
    }
    logLLM('success', meta, { totalTokens: out.usage.totalTokens, finishReason })
    return out
  }

  try {
    return await attempt(primaryModel)
  } catch (err) {
    if (fallbackModel && fallbackModel !== primaryModel) {
      const meta: RequestMeta = { correlationId, model: fallbackModel, startedAt: Date.now() }
      logLLM('fallback', meta, { from: primaryModel })
      return attempt(fallbackModel)
    }
    throw err
  }
}

/**
 * Streaming SSE completion. Client receives `data: {"text":"…"}` events and a
 * final `data: {"done":true}` — the exact stream shape features already use.
 */
export async function streamResponse(
  messages: ChatMessage[],
  config: Partial<ModelConfig> = {}
): Promise<Response> {
  const cfg = getGatewayConfig()
  const correlationId = newCorrelationId()
  const model = resolveModel(config)
  const meta: RequestMeta = { correlationId, model, startedAt: Date.now() }
  logLLM('attempt', meta, { stream: true })

  const res = await postChat(
    cfg,
    {
      model,
      messages: normalizeMessages(messages),
      max_tokens: resolveMaxTokens(config),
      temperature: config.temperature ?? 0.7,
      stream: true,
    },
    meta
  )

  if (!res.ok) {
    const rejection = await describeProviderRejection(res)
    logLLM('failure', meta, { reason: 'provider_rejection', ...rejection })
    throw new AIUnavailableError(
      'خدمة الذكاء الاصطناعي رفضت الطلب مؤقتًا. حاول مرة أخرى.',
      'AI_PROVIDER_ERROR',
      correlationId
    )
  }
  const body = res.body
  if (!body) {
    throw new AIUnavailableError('تعذر بدء بث استجابة الذكاء الاصطناعي.', 'AI_PROVIDER_ERROR', correlationId)
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const output = body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true })
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const payload = trimmed.slice(6)
          if (payload === '[DONE]') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
            return
          }
          try {
            const parsed = JSON.parse(payload)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`))
            }
          } catch {
            // skip malformed SSE chunks
          }
        }
      },
    })
  )

  return new Response(output, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Extract JSON from AI output that may be wrapped in markdown code blocks.
 */
export function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return match ? match[1].trim() : text.trim()
}

// ── Health / status (consumed by /api/ai/runtime-status; cached there) ─────

export type AIStatus = 'CONFIGURED' | 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'MISCONFIGURED'

export interface AIHealth {
  runtime: 'cloudflare-ai-gateway'
  configured: boolean
  status: AIStatus
  model: string | undefined
  localEngines: 'local' // dental vision/3D engines remain local by architecture
  detail?: string
}

/**
 * Configuration-only health probe (no expensive LLM round-trip; the route
 * caches on top of this). `AVAILABLE` is reported by a real minimal request
 * elsewhere — never fabricated here.
 */
export function getAIHealth(): AIHealth {
  const configured = isGatewayConfigured()
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID || ''
  const idsSafe = SAFE_ID.test(accountId) && SAFE_ID.test(gatewayId)
  let status: AIStatus = configured ? 'CONFIGURED' : 'UNAVAILABLE'
  let detail = configured
    ? undefined
    : 'لم يتم تكوين Cloudflare AI Gateway — المسارات الحتمية تعمل بدون نموذج.'
  if (configured && !idsSafe) {
    status = 'MISCONFIGURED'
    detail = 'معرفات Cloudflare AI Gateway غير صالحة.'
  }
  return {
    runtime: 'cloudflare-ai-gateway',
    configured,
    status,
    model: process.env.DEN_TORA_AI_MODEL,
    localEngines: 'local',
    detail,
  }
}

/** The currently configured default model (presence-safe, configuration-driven). */
export function getAIModel(): string | undefined {
  return process.env.DEN_TORA_AI_MODEL
}

/**
 * DenToRa canonical external-LLM runtime — Cloudflare AI Gateway.
 *
 * EVERY external LLM call in the application resolves through this module:
 *
 *   DenToRa feature
 *     → lib/ai/gateway (this file: routing, fallback, timeout, observability)
 *       → Cloudflare AI Gateway (OpenAI-compatible endpoint)
 *         → configured provider/model (openai/…, anthropic/…, google/…, …)
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

/** The OpenAI-compatible AI-Gateway base URL (composed from validated IDs only). */
export function gatewayBaseUrl(cfg: GatewayConfig): string {
  return `https://gateway.ai.cloudflare.com/v1/${cfg.accountId}/${cfg.gatewayId}`
}

// ── Model routing (configuration-driven; no hard-coded provider choice) ────

/**
 * Model resolution: callers normally pass a tier-resolved ModelConfig from
 * lib/ai/models (which already applies the DEN_TORA_AI_* env overrides at the
 * single tier-resolution point). Explicit config.model always wins.
 */
function resolveModel(config: Partial<ModelConfig>): string {
  return (
    config.model ||
    process.env.DEN_TORA_AI_MODEL ||
    'google/gemini-2.5-pro' // last-resort default, identical to the legacy client
  )
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

function getHeaders(cfg: GatewayConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiToken}`,
    'Content-Type': 'application/json',
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
    return await fetch(`${gatewayBaseUrl(cfg)}/v1/chat/completions`, {
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

  const attempt = async (model: string): Promise<CompletionResponse> => {
    const meta: RequestMeta = { correlationId, model, startedAt: Date.now() }
    logLLM('attempt', meta)
    const res = await postChat(
      cfg,
      {
        model,
        messages,
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      },
      meta
    )
    if (!res.ok) {
      // Error text may contain provider hints — never surfaced raw.
      await res.text().catch(() => '')
      throw new AIUnavailableError(
        'خدمة الذكاء الاصطناعي رفضت الطلب مؤقتًا. حاول مرة أخرى.',
        'AI_PROVIDER_ERROR',
        correlationId
      )
    }
    const data = await res.json()
    const out: CompletionResponse = {
      content: data.choices?.[0]?.message?.content || '',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: data.model || model,
    }
    logLLM('success', meta, { totalTokens: out.usage.totalTokens })
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
      messages,
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
      stream: true,
    },
    meta
  )

  if (!res.ok) {
    await res.text().catch(() => '')
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

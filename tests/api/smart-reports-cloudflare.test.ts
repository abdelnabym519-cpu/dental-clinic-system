// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// Smart Reports × Cloudflare AI Gateway — repair regression suite (§6).
//
// The Smart Reports path is: report-builder.tsx → POST /api/ai/query →
// intent/preset (deterministic, no LLM) → lib/ai/gateway.ts → Cloudflare
// AI Gateway → configured model. These tests pin the repaired contract:
// no local-general-model requirement, no OpenRouter, canonical gateway
// routing, truthful typed failures, and working prebuilt reports without AI.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(),
}))

const mockGateway = vi.hoisted(() => ({
  complete: vi.fn(),
  extractJSON: vi.fn((t: string) => t),
  streamResponse: vi.fn(),
  AIUnavailableError: class AIUnavailableError extends Error {
    code: string
    correlationId: string
    constructor(message: string, code: string, correlationId: string) {
      super(message)
      this.name = 'AIUnavailableError'
      this.code = code
      this.correlationId = correlationId
    }
  },
}))
vi.mock('@/lib/ai/gateway', () => mockGateway)

import { POST as queryPOST } from '@/app/api/ai/query/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Dr Admin', role: 'ADMIN' },
    session: { user: { id: 'u1', role: 'ADMIN' } },
    hospitalId: 'h1',
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/query', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const ROOT = join(__dirname, '..', '..')
const ROUTE_SRC = readFileSync(join(ROOT, 'app', 'api', 'ai', 'query', 'route.ts'), 'utf-8')
const UI_SRC = readFileSync(join(ROOT, 'components', 'ai', 'report-builder.tsx'), 'utf-8')

// A non-report question the deterministic intent router will NOT claim
// (goes to the LLM spec path).
const LLM_QUERY = 'من الموظفين المسجلين في النظام هذا الأسبوع؟'

describe('Smart Reports — Cloudflare configuration (A)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
    for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_GATEWAY_ID', 'OPENROUTER_API_KEY']) {
      delete process.env[k]
    }
  })

  it('recognizes the Cloudflare configuration — no OPENROUTER_API_KEY, no local model env', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
    process.env.CLOUDFLARE_API_TOKEN = 'token'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'gw'
    mockGateway.complete.mockResolvedValue({ content: '{"model":"patient","filters":{}}', usage: {}, model: 'm' })
    prisma.patient.findMany.mockResolvedValue([])

    const res = await queryPOST(post({ query: LLM_QUERY }))
    expect(res.status).toBe(200)
    // the gateway was invoked — configuration was accepted without any
    // OpenRouter/local-model requirement
    expect(mockGateway.complete).toHaveBeenCalled()
  })

  it('OPENROUTER_API_KEY is never consulted anywhere in the Smart Reports path', () => {
    process.env.OPENROUTER_API_KEY = 'irrelevant-legacy-key'
    expect(ROUTE_SRC).not.toContain('OPENROUTER')
    expect(UI_SRC).not.toContain('OPENROUTER')
    // no production file may consult the legacy key (architectural, not env)
  })
})

describe('Smart Reports — architecture (B)', () => {
  it('the query route uses the canonical gateway module', () => {
    expect(ROUTE_SRC).toContain("from '@/lib/ai/gateway'")
  })

  it('no OpenRouter import or direct provider call exists in the Smart Reports path', () => {
    expect(ROUTE_SRC).not.toMatch(/openrouter|api\.openai\.com|api\.anthropic\.com/i)
    expect(UI_SRC).not.toMatch(/openrouter/i)
  })

  it('the UI has no local-general-model requirement anywhere', () => {
    expect(UI_SRC).not.toContain('نموذج الذكاء الاصطناعي المحلي')
    expect(UI_SRC).not.toMatch(/ollama/i)
  })
})

describe('Smart Reports — success (C)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  it('generates a report through the gateway and normalizes the response', async () => {
    mockGateway.complete.mockResolvedValue({
      content: '{"model":"invoice","filters":{"status":"PENDING"},"limit":10,"summary":"فواتير معلقة"}',
      usage: { promptTokens: 5, completionTokens: 9, totalTokens: 14 },
      model: '@cf/zai-org/glm-4.7-flash',
    })
    prisma.invoice.findMany.mockResolvedValue([{ id: 'inv1', totalAmount: 250 }])

    const res = await queryPOST(post({ query: LLM_QUERY }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.summary).toBe('فواتير معلقة')
    expect(body.mode).toBe('ai')
    // the tier model config was handed to the gateway (configuration-driven)
    const cfg = mockGateway.complete.mock.calls[0][1]
    expect(cfg).toBeTruthy()
  })

  it('the translator request matches the proven provider shape: system instructions + user question', async () => {
    mockGateway.complete.mockResolvedValue({
      content: '{"model":"invoice","filters":{}}',
      usage: {},
      model: 'm',
    })
    prisma.invoice.findMany.mockResolvedValue([])

    await queryPOST(post({ query: LLM_QUERY })) // a non-report question (report questions take the deterministic path)

    const messages = mockGateway.complete.mock.calls[0][0]
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).not.toContain(LLM_QUERY) // instructions only, question is not embedded
    expect(messages.at(-1)).toEqual({ role: 'user', content: LLM_QUERY })
    // the conversation must always end with a user/assistant turn (HTTP 400 pin)
    expect(messages.at(-1).role).not.toBe('system')
  })

  it('model selection flows through the configuration-driven tier routing', async () => {
    // getModelByTier('query') must apply DEN_TORA_AI_MODEL when set
    process.env.DEN_TORA_AI_MODEL = '@cf/zai-org/glm-4.7-flash'
    const { getModelByTier } = await import('@/lib/ai/models')
    expect(getModelByTier('query').model).toBe('@cf/zai-org/glm-4.7-flash')
    delete process.env.DEN_TORA_AI_MODEL
  })
})

describe('Smart Reports — reasoning-only responses (D)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  it('never treats a reasoning-only response as a successful empty report', async () => {
    // reasoning present, content empty → the gateway contract turns this
    // into a truthful typed failure (AI_PROVIDER_ERROR), which the route
    // classifies as AI unavailability (503), never as a fabricated report.
    mockGateway.complete.mockRejectedValue(
      new mockGateway.AIUnavailableError(
        'أعاد النموذج استدلالًا دون محتوى قابل للعرض. حاول مرة أخرى.',
        'AI_PROVIDER_ERROR',
        'corr-1'
      )
    )
    const res = await queryPOST(post({ query: LLM_QUERY }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('AI_UNAVAILABLE')
    expect(body.error).toMatch(/[\u0600-\u06FF]/)
  })

  it('a reasoning channel alongside real content does not break extraction', async () => {
    // integration-level via the route: content + reasoning both present —
    // extraction uses content only, the reasoning channel rides along
    mockGateway.complete.mockResolvedValue({
      content: '{"model":"patient","filters":{}}',
      reasoning: 'سأبحث في جدول المرضى…',
      usage: {},
      model: 'm',
    })
    prisma.patient.findMany.mockResolvedValue([])
    const res = await queryPOST(post({ query: LLM_QUERY }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toEqual([])
    expect(mockGateway.extractJSON).toHaveBeenCalledWith('{"model":"patient","filters":{}}')
  })
})

describe('Smart Reports — typed failure semantics (E)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  async function expectUnavailable(code: string) {
    mockGateway.complete.mockRejectedValue(
      new mockGateway.AIUnavailableError(
        code === 'AI_NOT_CONFIGURED'
          ? 'خدمة الذكاء الاصطناعي غير مهيأة — أضف بيانات Cloudflare AI Gateway إلى إعدادات الخادم.'
          : code === 'AI_TIMEOUT'
            ? 'انتهت مهلة الاتصال بخدمة الذكاء الاصطناعي.'
            : 'خدمة الذكاء الاصطناعي رفضت الطلب مؤقتًا. حاول مرة أخرى.',
        code,
        'corr-2'
      )
    )
    const res = await queryPOST(post({ query: LLM_QUERY }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('AI_UNAVAILABLE')
    // the CURRENT requirement is named — retired infrastructure never is
    expect(body.error).toContain('بوابة Cloudflare')
    expect(body.error).not.toContain('المحلي')
    expect(body.error).not.toContain('OPENROUTER')
    expect(body.error).toMatch(/استخدم التقارير الجاهزة/)
  }

  it('AI_NOT_CONFIGURED → 503 with Cloudflare-oriented Arabic guidance', () => expectUnavailable('AI_NOT_CONFIGURED'))
  it('AI_TIMEOUT → 503 with Cloudflare-oriented Arabic guidance', () => expectUnavailable('AI_TIMEOUT'))
  it('AI_PROVIDER_ERROR → 503 with Cloudflare-oriented Arabic guidance', () => expectUnavailable('AI_PROVIDER_ERROR'))

  it('the message never mentions a local general model or OpenRouter (route source audit)', () => {
    expect(ROUTE_SRC).not.toContain('نموذج الذكاء الاصطناعي المحلي')
    expect(ROUTE_SRC).not.toContain('OPENROUTER')
  })
})

describe('Smart Reports — UI contract (F)', () => {
  it('the activation hint names the current Cloudflare configuration requirements', () => {
    expect(UI_SRC).toContain('Cloudflare AI Gateway')
    expect(UI_SRC).toContain('DEN_TORA_AI_MODEL')
    expect(UI_SRC).toContain('أعد تشغيل النظام')
    expect(UI_SRC).toMatch(/[\u0600-\u06FF]/)
  })

  it('prebuilt reports are labeled as AI-free', () => {
    expect(UI_SRC).toContain('تقارير جاهزة (بدون ذكاء اصطناعي):')
  })
})

describe('Smart Reports — prebuilt reports without AI (G)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  it('preset reports keep working even when the gateway is completely unconfigured', async () => {
    // the LLM boundary fails hard — presets must not touch it
    mockGateway.complete.mockRejectedValue(
      new mockGateway.AIUnavailableError('غير مهيأة', 'AI_NOT_CONFIGURED', 'corr-3')
    )
    prisma.patient.findMany.mockResolvedValue([{ id: 'p1' }])
    prisma.patient.count.mockResolvedValue(1)

    const res = await queryPOST(post({ preset: 'new_patients_monthly' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('deterministic')
    expect(mockGateway.complete).not.toHaveBeenCalled()
  })
})

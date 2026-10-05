// @ts-nocheck
// Phase 8 (F-1) — chat route: LLM-EMITTED params are untrusted model output.
// Reserved server-privilege keys (patientId, __resolvedPatientId) must be
// stripped BEFORE the action pipeline runs — patient scope is only ever
// authoritative when SERVER-resolved (tenant-scoped). Same contract as the
// command route; the pipeline re-injects only its own tenant-validated id.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    hospital: { findUnique: vi.fn() },
    auditLog: { count: vi.fn(), create: vi.fn() },
    aIConversation: { create: vi.fn() },
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(),
}))

vi.mock('@/lib/ai/gateway', () => ({
  complete: vi.fn(),
  streamResponse: vi.fn(),
  extractJSON: vi.fn((text: string) => text),
}))

vi.mock('@/lib/ai/context-builder', () => ({
  buildContext: vi.fn().mockResolvedValue({
    hospital: { id: 'h1', name: 'Test Clinic', plan: 'PROFESSIONAL' },
    user: { id: 'u1', name: 'Test User', role: 'ADMIN' },
  }),
  serializeContext: vi.fn().mockReturnValue('Hospital: Test Clinic'),
}))

vi.mock('@/lib/ai/models', () => ({
  getModelByTier: vi.fn().mockReturnValue({ model: 'test/model', maxTokens: 1024, temperature: 0.7 }),
}))

vi.mock('@/lib/ai/action-pipeline', () => ({
  runAiAction: vi.fn(),
}))

import { POST as chatPOST } from '@/app/api/ai/chat/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { complete } from '@/lib/ai/gateway'
import { runAiAction } from '@/lib/ai/action-pipeline'

function setup() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    user: { id: 'u1', name: 'Test User', role: 'ADMIN' },
    hospitalId: 'h1',
  } as any)
  vi.mocked(prisma.auditLog.count).mockResolvedValue(0)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-1' } as any)
  vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
    name: 'Test Clinic',
    plan: 'PROFESSIONAL',
  } as any)
  vi.mocked(prisma.aIConversation.create).mockResolvedValue({ id: 'conv-1' } as any)
}

/** Two `complete` calls: intent detection, then the final answer. */
function mockLlm(intent: unknown) {
  vi.mocked(complete)
    .mockResolvedValueOnce({
      content: JSON.stringify(intent),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'test/model',
    } as any)
    .mockResolvedValueOnce({
      content: 'FINAL ANSWER',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'test/model',
    } as any)
}

function chatReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'check patient John Doe' }], stream: false, ...body }),
  })
}

describe('POST /api/ai/chat — F-1 param strip (LLM-emitted params are untrusted)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(runAiAction).mockResolvedValue({
      success: true,
      status: 'EXECUTED',
      message: 'Patient found',
      result: { summary: { name: 'John Doe' } },
    } as any)
  })

  it('NEG — strips LLM-emitted patientId and __resolvedPatientId before the pipeline', async () => {
    setup()
    mockLlm({
      action: 'check_patient',
      params: { query: 'John Doe', patientId: 'pat-OTHER-TENANT-999', __resolvedPatientId: 'pat-FORGED' },
      complexity: 'simple',
    })

    const res = await chatPOST(chatReq({}))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.response).toBe('FINAL ANSWER')
    expect(runAiAction).toHaveBeenCalledTimes(1)
    const call = vi.mocked(runAiAction).mock.calls[0][0]
    // The reserved privilege keys must NOT reach the pipeline…
    expect(call.params).not.toHaveProperty('patientId')
    expect(call.params).not.toHaveProperty('__resolvedPatientId')
    // …while the legitimate, non-privileged params pass through untouched:
    expect(call.params).toEqual({ query: 'John Doe' })
    expect(call.action).toBe('check_patient')
    expect(call.hospitalId).toBe('h1')
    expect(call.actor).toEqual({ id: 'u1', name: 'Test User', role: 'ADMIN' })
  })

  it('POS — legitimate params (no reserved keys) reach the pipeline unchanged', async () => {
    setup()
    mockLlm({
      action: 'update_patient',
      params: { query: 'John Doe', phone: '01012345678' },
      complexity: 'simple',
    })

    const res = await chatPOST(chatReq({}))

    expect(res.status).toBe(200)
    expect(runAiAction).toHaveBeenCalledTimes(1)
    const call = vi.mocked(runAiAction).mock.calls[0][0]
    expect(call.action).toBe('update_patient')
    expect(call.params).toEqual({ query: 'John Doe', phone: '01012345678' })
  })

  it('POS — missing params default to an empty object (still sanitized)', async () => {
    setup()
    mockLlm({ action: 'check_overdue', complexity: 'simple' })

    const res = await chatPOST(chatReq({}))

    expect(res.status).toBe(200)
    expect(runAiAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runAiAction).mock.calls[0][0].params).toEqual({})
  })
})

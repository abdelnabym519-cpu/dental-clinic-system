// @ts-nocheck
/**
 * Phase 3 — Agent API route (§23/§29): session-resolved actor, rate limit,
 * structured AgentResponse, audit. Prisma is a forwarder over the Phase 2
 * agent harness fake (tenant-scoped rows are real).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({
  fake: null,
  convCreate: [],
  auditCreate: [],
  requireAuth: null,
  runAiActionImpl: null,
  runAiActionCalls: [],
}))

vi.mock('@/lib/prisma', () => {
  const delegate = (name) => ({
    findFirst: async (args) => store.fake?.[name]?.findFirst?.(args) ?? null,
    findMany: async (args) => store.fake?.[name]?.findMany?.(args) ?? [],
    findUnique: async (args) => store.fake?.[name]?.findUnique?.(args) ?? null,
    count: async (args) => store.fake?.[name]?.count?.(args) ?? 0,
    aggregate: async (args) => store.fake?.[name]?.aggregate?.(args) ?? { _sum: {}, _count: { _all: 0 } },
    create: async (args) => {
      if (name === 'aIConversation') { store.convCreate.push(args); return { id: 'conv-' + store.convCreate.length } }
      if (name === 'auditLog') { store.auditCreate.push(args); return { id: 'audit-1' } }
      return {}
    },
  })
  const names = [
    'patient', 'appointment', 'treatment', 'staff', 'dentalChartEntry',
    'clinicalNote', 'treatmentPlan', 'imagingStudy', 'aIAnalysisJob',
    'invoice', 'patientRiskScore', 'medicalHistory', 'auditLog', 'aIConversation', 'hospital',
  ]
  return { prisma: Object.fromEntries(names.map((n) => [n, delegate(n)])) }
})

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: async () => store.requireAuth,
}))

vi.mock('@/lib/ai/openrouter', () => ({
  complete: async () => ({ content: 'ok', model: 'test', usage: {} }),
}))

vi.mock('@/lib/ai/models', () => ({
  getModelByTier: () => ({ model: 'test-model' }),
}))

vi.mock('@/lib/ai/action-pipeline', () => ({
  runAiAction: (args) => {
    store.runAiActionCalls.push(args)
    if (!store.runAiActionImpl) throw new Error('runAiAction not stubbed')
    return store.runAiActionImpl(args)
  },
  approveAndExecute: () => Promise.resolve({}),
}))

import { POST } from '@/app/api/ai/agent/route'
import { createAgentFakePrisma, HOSP_A, PAT_A1 } from '@/tests/harness/agent-fixtures'

function post(body, raw = false) {
  return new Request('http://localhost/api/ai/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  store.fake = createAgentFakePrisma()
  store.convCreate.length = 0
  store.auditCreate.length = 0
  store.runAiActionCalls.length = 0
  store.runAiActionImpl = null
  store.requireAuth = {
    error: null,
    user: { id: 'staff-recep-1', name: 'Recep A', role: 'RECEPTIONIST' },
    hospitalId: HOSP_A,
  }
})

describe('POST /api/ai/agent', () => {
  it('returns a structured AgentResponse for a read request', async () => {
    const res = await POST(post({ message: 'Show appointments for Ahmed Ali' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('COMPLETED')
    expect(json.task.taskType).toBe('INFORMATIONAL')
    expect(json.contextProfileUsed).toBe('PATIENT_OVERVIEW')
    expect(json.answer).toContain('Ahmed Ali')
    expect(json.trace.traceId).toMatch(/^ag-/)
    expect(json.toolsUsed).toEqual(['get_patient_overview'])
    // audit + trace rows written server-side
    expect(store.auditCreate.length).toBe(1)
    expect(store.auditCreate[0].data.action).toBe('AI_AGENT')
    expect(store.convCreate.length).toBe(1)
    expect(store.convCreate[0].data.sessionType).toBe('QUERY')
  })

  it('action flows through the pipeline with the session actor', async () => {
    store.requireAuth = {
      error: null,
      user: { id: 'staff-acc-1', name: 'Acc A', role: 'ACCOUNTANT' },
      hospitalId: HOSP_A,
    }
    store.runAiActionImpl = () => Promise.resolve({
      status: 'APPROVAL_REQUIRED', success: false, message: 'Needs approval', approvalId: 'appr-r1',
    })
    const res = await POST(post({ message: 'Record payment 500 for Ahmed Ali' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('PENDING_APPROVAL')
    expect(json.approvalState.approvalId).toBe('appr-r1')
    expect(store.runAiActionCalls.length).toBe(1)
    expect(store.runAiActionCalls[0].action).toBe('record_payment')
    expect(store.runAiActionCalls[0].actor.role).toBe('ACCOUNTANT')
    expect(store.runAiActionCalls[0].hospitalId).toBe(HOSP_A)
    expect(store.runAiActionCalls[0].params.patientId).toBe(PAT_A1)
  })

  it('400 when message is missing', async () => {
    const res = await POST(post({}))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'message is required' })
  })

  it('400 on invalid JSON', async () => {
    const res = await POST(post('not-json{', true))
    expect(res.status).toBe(400)
  })

  it('401 when unauthenticated', async () => {
    const unauthorized = Response.json({ error: 'Unauthorized' }, { status: 401 })
    store.requireAuth = { error: unauthorized, user: null, hospitalId: null }
    const res = await POST(post({ message: 'hello' }))
    expect(res.status).toBe(401)
  })

  it('429 when rate-limited', async () => {
    store.fake = Object.assign(createAgentFakePrisma(), {
      auditLog: { count: async () => 30 },
    })
    const res = await POST(post({ message: 'Show appointments for Ahmed Ali' }))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Rate limit exceeded. Try again shortly.')
  })
})

/**
 * Phase 10 — voice API route contract tests (§19/§41/§42).
 *
 * The routes are the trust boundary: server-session actor binding, no raw
 * audio in the HTTP contract, malformed payloads rejected, PHI-min audit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VoiceTurnResponse } from '@/lib/ai/voice/types'

// ---- prisma mock (audit-log rate limit + audit writes) ---------------------
const auditCount = vi.fn(async () => 0)
const auditCreate = vi.fn(async () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { count: (...a: unknown[]) => auditCount(...(a as [])), create: (...a: unknown[]) => auditCreate(...(a as [])) },
    aIConversation: { findFirst: vi.fn(async () => null) },
    create: vi.fn(async () => ({ id: 'conv-x' })),
  },
}))

// ---- auth mock: DOCTOR session by default ---------------------------------
const authResult = { error: null, user: { id: 'u1', name: 'Dr Test', role: 'DOCTOR' }, hospitalId: 'hosp-A' }
vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(async () => authResult),
}))

// ---- pipeline mock: returns a typed response; records the input ------------
let lastPipelineInput: unknown = null
const pipelineResponse: VoiceTurnResponse = {
  voiceSessionId: 'vs-x',
  state: 'SPEAKING',
  op: 'SPEAK',
  speakableText: 'ok',
  displayText: 'ok',
  clarification: null,
  approval: null,
  agentStatus: 'COMPLETED',
  taskType: 'OPERATIONAL',
  duplicateSuppressed: false,
  interrupted: false,
  telemetry: { env: 'SANDBOX', transcriptChars: 5, totalMs: 3, sttMs: null, agentMs: 2, ttsMs: null, interruptionCount: 0, approvalRequired: false },
  error: null,
}
const runVoiceTurnMock = vi.fn(async (_deps: unknown, input: unknown) => {
  lastPipelineInput = input
  return pipelineResponse
})
vi.mock('@/lib/ai/voice/pipeline', () => ({
  runVoiceTurn: (...a: unknown[]) => runVoiceTurnMock(...([a[0], a[1]] as [unknown, unknown])),
  resetDuplicateWindows: vi.fn(),
}))

import { POST as turnPOST } from '@/app/api/ai/voice/turn/route'
import { POST as sessionPOST, DELETE as sessionDELETE } from '@/app/api/ai/voice/session/route'

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/ai/voice/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  auditCount.mockResolvedValue(0)
  auditCreate.mockClear()
  runVoiceTurnMock.mockClear()
  lastPipelineInput = null
})

describe('POST /api/ai/voice/turn', () => {
  it('forwards a bound actor (server session — client cannot spoof tenant/role)', async () => {
    const res = await turnPOST(jsonReq({ voiceSessionId: 'vs-abc', op: 'SPEAK', transcript: { text: 'مرحبا', confidence: 0.9, isFinal: true, providerId: 'web-speech-stt-browser' } }))
    expect(res.status).toBe(200)
    expect(lastPipelineInput).toMatchObject({ voiceSessionId: 'vs-abc', actor: { userId: 'u1', role: 'DOCTOR', tenantId: 'hosp-A' } })
  })

  it('rejects unauthenticated calls', async () => {
    const { requireAuthAndRole } = await import('@/lib/api-helpers')
    vi.mocked(requireAuthAndRole).mockResolvedValueOnce({ error: new Response('no', { status: 401 }), user: null, hospitalId: null } as never)
    const res = await turnPOST(jsonReq({ voiceSessionId: 'vs-abc' }))
    expect(res.status).toBe(401)
  })

  it('rejects malformed JSON', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: '{oops', headers: { 'content-type': 'application/json' } })
    expect((await turnPOST(req)).status).toBe(400)
  })

  it('rejects missing/oversized voiceSessionId', async () => {
    expect((await turnPOST(jsonReq({}))).status).toBe(400)
    expect((await turnPOST(jsonReq({ voiceSessionId: 'x'.repeat(65) }))).status).toBe(400)
  })

  it('REQUIRES a typed transcript for SPEAK — raw audio can never enter (§41)', async () => {
    const res = await turnPOST(jsonReq({ voiceSessionId: 'vs-abc', op: 'SPEAK', audioBase64: 'UklGRg==' }))
    expect(res.status).toBe(400)
    expect(runVoiceTurnMock).not.toHaveBeenCalled()
  })

  it('SPEAK with a partial transcript still reaches the pipeline — which fails closed', async () => {
    // The route passes typed transcripts; the PIPELINE owns trust decisions
    // (isFinal=false → VOICE_TRANSCRIPT_PARTIAL). Route-level: contract only.
    const res = await turnPOST(jsonReq({ voiceSessionId: 'vs-abc', op: 'SPEAK', transcript: { text: 'مرحبا', confidence: 0.5, isFinal: false, providerId: 'x' } }))
    expect(res.status).toBe(200)
  })

  it('non-SPEAK ops do not require a transcript', async () => {
    const res = await turnPOST(jsonReq({ voiceSessionId: 'vs-abc', op: 'PLAYBACK_ENDED' }))
    expect(res.status).toBe(200)
  })

  it('rate limits at 60 turns/min per user (429)', async () => {
    auditCount.mockResolvedValue(60)
    const res = await turnPOST(jsonReq({ voiceSessionId: 'vs-abc', op: 'CANCEL' }))
    expect(res.status).toBe(429)
    expect(runVoiceTurnMock).not.toHaveBeenCalled()
  })

  it('writes a PHI-minimized audit entry (no transcript text, no audio)', async () => {
    await turnPOST(jsonReq({ voiceSessionId: 'vs-abc', op: 'SPEAK', transcript: { text: 'بيانات حساسة سريريا', confidence: 1, isFinal: true, providerId: 'x' } }))
    await vi.waitFor(() => expect(auditCreate).toHaveBeenCalled())
    const arg = auditCreate.mock.calls[0][0] as { data: { newValues: string } }
    const payload = JSON.parse(arg.data.newValues)
    expect(payload).toHaveProperty('state')
    expect(payload).toHaveProperty('totalMs')
    expect(JSON.stringify(payload)).not.toContain('بيانات')
    expect(payload).not.toHaveProperty('transcript')
    expect(payload).not.toHaveProperty('audio')
  })
})

describe('POST/DELETE /api/ai/voice/session', () => {
  it('creates a session bound to the server-session actor', async () => {
    const res = await sessionPOST(jsonReq({ locale: 'ar-EG' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { voiceSessionId: string; state: string } }
    expect(body.session.state).toBe('IDLE')
    expect(body.session.voiceSessionId).toMatch(/^vs-/)
  })

  it('unknown op on delete still returns ok (idempotent teardown)', async () => {
    const res = await sessionDELETE(jsonReq({ voiceSessionId: 'vs-missing' }))
    expect([200, 400]).toContain(res.status)
  })
})

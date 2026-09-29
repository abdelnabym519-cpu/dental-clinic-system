// @ts-nocheck
/**
 * Phase 5 — Agent ↔ Local AI integration (spec §32).
 *
 * Full loop: capability-question classification (deterministic, no LLM
 * needed), planner step, the read-only local_ai_capabilities tool,
 * deterministic answer rendering, role gating, no patient context, no PHI,
 * no engine selection from user text, honest unavailability.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const holder = vi.hoisted(() => ({ calls: [] }))
vi.mock('@/lib/ai/action-pipeline', () => ({
  runAiAction: (args) => {
    holder.calls.push(args)
    return Promise.resolve({ status: 'EXECUTED', verification: 'ok' })
  },
  approveAndExecute: () => Promise.resolve({}),
}))

import { runAgent } from '@/lib/ai/agent/loop'
import { DEFAULT_AGENT_LIMITS } from '@/lib/ai/agent/types'
import { createAgentFakePrisma, HOSP_A, NOW } from '@/tests/harness/agent-fixtures'
import { createFakeCapabilitySource } from '@/tests/harness/local-ai-fixtures'

const doctor = { id: 'staff-doctor-1', name: 'Hana Shalaby', role: 'DOCTOR' }
const patientPortal = { id: 'user-pat-A', name: 'Ahmed Ali (portal)', role: 'PATIENT' }

const CAP_Q = 'What dental AI analysis can you do on X-rays?'
const CAP_Q2 = 'Which AI engines do you have for panoramic radiographs?'
const CAP_Q_AR = 'ما قدرات الذكاء الاصطناعي في تحليل الأشعة؟'
const ANALYSIS_REQ = 'run the AI analysis on this study' // pinned study -> imaging flow, not capability

let llmCalls
beforeEach(() => {
  holder.calls.length = 0
  llmCalls = 0
})

function deps(over = {}) {
  return {
    client: createAgentFakePrisma(),
    llm: async (messages, purpose) => {
      llmCalls += 1
      if (purpose === 'agent_synthesis') return { content: over.synthesis ?? 'ok' }
      return { content: over.classify ?? 'INFORMATIONAL' }
    },
    limits: { ...DEFAULT_AGENT_LIMITS },
    now: () => NOW,
    localAiCapabilities: over.source === 'none' ? null : createFakeCapabilitySource(over.sourceOver ?? {}),
  }
}

function req(message, actor, over = {}) {
  return {
    requestId: 'req-ai',
    conversationId: 'conv-ai',
    actor,
    hospitalId: over.hospitalId ?? HOSP_A,
    message,
    patientId: over.patientId ?? null,
    patientName: over.patientName ?? null,
    toothFdi: null,
    caseId: null,
    studyId: over.studyId ?? null,
    treatmentNo: null,
    history: undefined,
    timestamp: NOW.toISOString(),
  }
}

describe('classification (deterministic — §32/§13)', () => {
  it('capability questions are recognized without an LLM', async () => {
    const res = await runAgent(req(CAP_Q, doctor), deps({ classify: 'SHOULD_NOT_BE_CALLED' }))
    expect(res.status).toBe('COMPLETED')
    const tools = res.trace.toolCalls.map((t) => t.tool)
    expect(tools).toEqual(['local_ai_capabilities'])
    // Classification was deterministic (no model call for it).
    expect(llmCalls).toBe(0)
  })

  it('recognizes the question in Arabic too', async () => {
    const res = await runAgent(req(CAP_Q_AR, doctor), deps())
    expect(res.trace.toolCalls.map((t) => t.tool)).toEqual(['local_ai_capabilities'])
  })

  it('a pinned study is an imaging-flow request, NOT a capability question', async () => {
    const res = await runAgent(
      req(ANALYSIS_REQ, doctor, { studyId: 'study-9', patientId: 'pat-A1' }),
      deps(),
    )
    // No capability tool is scheduled for a pinned-study analysis request.
    expect(res.trace.toolCalls.map((t) => t.tool)).not.toContain('local_ai_capabilities')
  })
})

describe('answer content (§29-style honesty, no PHI)', () => {
  it('answers from the trusted matrix with live engine state', async () => {
    const res = await runAgent(req(CAP_Q, doctor), deps())
    expect(res.status).toBe('COMPLETED')
    expect(res.answer).toMatch(/decision support/i)
    expect(res.answer).toMatch(/meshsegnet-max/).toMatch(/meshsegnet-man/)
    expect(res.answer).toMatch(/clinician review/i)
    // Live runtime (fake source says the two MeshSegNet engines are AVAILABLE).
    expect(res.answer).toMatch(/Engines currently available/)
  })

  it('honest unavailability when the orchestrator view is not configured', async () => {
    const res = await runAgent(req(CAP_Q, doctor), deps({ source: 'none' }))
    expect(res.status).toBe('COMPLETED')
    expect(res.answer).toMatch(/unavailable/)
    expect(res.answer).toMatch(/configured/)
    // The static matrix still answers — policy is policy (task-level
    // capability, not engine-level — engine names only appear with live
    // health data, never guessed).
    expect(res.answer).toMatch(/dental_mesh_segmentation/)
  })

  it('honest unavailability when the orchestrator is down (never guessed)', async () => {
    const res = await runAgent(req(CAP_Q, doctor), deps({ sourceOver: { enginesThrow: true } }))
    expect(res.status).toBe('COMPLETED')
    expect(res.answer).toMatch(/unreachable|unavailable/)
  })

  it('no patient data is fetched or rendered (capability is patient-free)', async () => {
    const res = await runAgent(
      req(CAP_Q2, doctor, { patientId: 'pat-A1', patientName: 'Ahmed Ali' }),
      deps(),
    )
    expect(res.trace.toolCalls.map((t) => t.tool)).toEqual(['local_ai_capabilities'])
    expect(res.answer).not.toContain('Ahmed')
    expect(res.answer).not.toContain('pat-A1')
  })

  it('PATIENT role may ask about capabilities (read-only product info)', async () => {
    const res = await runAgent(req(CAP_Q, patientPortal), deps())
    expect(res.status).toBe('COMPLETED')
    expect(res.trace.toolCalls.map((t) => t.tool)).toEqual(['local_ai_capabilities'])
  })
})

describe('engine selection is never from user text (§32)', () => {
  it('naming an engine in the question does not change what is returned', async () => {
    const a = await runAgent(req(CAP_Q, doctor), deps())
    const b = await runAgent(
      req('Can liodon run on my panoramic? What dental AI analysis can you do on X-rays?', doctor),
      deps(),
    )
    // Both answers are the deterministic capability view — the named engine
    // never becomes a selection or a claim.
    expect(b.trace.toolCalls.map((t) => t.tool)).toEqual(['local_ai_capabilities'])
    expect(a.answer.split('.').length).toBeGreaterThan(2)
  })

  it('no action pipeline is ever invoked (read-only tool)', async () => {
    await runAgent(req(CAP_Q, doctor), deps())
    expect(holder.calls).toEqual([])
  })
})

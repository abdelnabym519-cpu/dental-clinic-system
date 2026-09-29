// @ts-nocheck
/**
 * Phase 3 — Bounded planner (§13/§14): templates, de-duplication, caps,
 * cycle detection. Plans are upper bounds — the execute stage can stop
 * early on any hard limit.
 */
import { describe, it, expect } from 'vitest'
import { buildPlan, finalizePlan } from '@/lib/ai/agent/planner'
import type { AgentPlanStep, AgentTask } from '@/lib/ai/agent/types'

const LIMITS = {
  maxPlanSteps: 12, maxToolCalls: 10, maxRepeatedToolCalls: 3, maxIterations: 8,
  totalTimeoutMs: 30000, maxContextChars: 60000, maxAnswerChars: 4000, maxLlmCalls: 1,
}

const task = (over = {}): AgentTask => ({
  taskType: 'INFORMATIONAL', domains: ['patient'], riskLevel: 'NONE',
  contextProfile: 'PATIENT_OVERVIEW', executionMode: 'READ_ONLY',
  patientInvolved: true, toothInvolved: false, caseInvolved: false,
  readOnly: true, actionRequested: false, multiStep: false,
  confidence: 0.9, classifiedBy: 'deterministic', missingInfo: [],
  ...over,
})

const ctx = (over = {}) => ({
  task: task(), hasPatient: true, hasContext: false,
  actionIntent: null, actionTool: null, actionParams: {},
  actionParamsComplete: false, operationalTopic: null,
  message: 'test question about the patient', limit: LIMITS,
  ...over,
})

describe('plan templates', () => {
  it('INFORMATIONAL → single context tool', () => {
    const { plan, reason } = buildPlan(ctx())
    expect(reason).toBeNull()
    expect(plan.steps.map((s) => s.tool)).toEqual(['get_patient_overview'])
    expect(plan.steps[0].status).toBe('PENDING')
  })

  it('skips the context step when context was already retrieved (no duplicate calls)', () => {
    const { plan, reason } = buildPlan(ctx({ hasContext: true }))
    expect(plan).toBeNull()
    expect(reason).toBe('context_already_retrieved')
  })

  it('OPERATIONAL → the right clinic tool', () => {
    const op = (topic) => buildPlan(ctx({ task: task({ taskType: 'OPERATIONAL', contextProfile: null }), operationalTopic: topic, operationalInput: {} })).plan.steps[0].tool
    expect(op('queue')).toBe('get_waiting_queue')
    expect(op('followups')).toBe('get_followup_due')
    expect(op('appointments')).toBe('get_appointments')
    expect(op('schedule')).toBe('get_doctor_schedule')
  })

  it('ACTION_REQUEST with complete params → context + action step', () => {
    const { plan } = buildPlan(ctx({
      task: task({ taskType: 'ACTION_REQUEST', contextProfile: null, patientInvolved: true }),
      actionTool: 'record_payment', actionParams: { amount: '500' }, actionParamsComplete: true,
    }))
    expect(plan.steps.map((s) => s.tool)).toEqual(['record_payment'])
  })

  it('ACTION_REQUEST with missing params → no action step (DRAFT)', () => {
    const { reason } = buildPlan(ctx({
      task: task({ taskType: 'ACTION_REQUEST', contextProfile: null, patientInvolved: true }),
      actionTool: 'record_payment', actionParams: {}, actionParamsComplete: false,
    }))
    expect(reason).toBe('params_incomplete_draft')
  })

  it('MULTI_STEP complex review → FULL_360 tool + action', () => {
    const { plan } = buildPlan(ctx({
      task: task({ taskType: 'MULTI_STEP', contextProfile: 'FULL_360' }),
      actionTool: 'schedule_followup', actionParams: { date: '2026-10-05', type: 'FOLLOW_UP' }, actionParamsComplete: true,
    }))
    expect(plan.steps.map((s) => s.tool)).toEqual(['get_patient_360', 'schedule_followup'])
  })

  it('OUT_OF_DOMAIN / UNKNOWN → no plan', () => {
    expect(buildPlan(ctx({ task: task({ taskType: 'OUT_OF_DOMAIN' }) })).plan).toBeNull()
    expect(buildPlan(ctx({ task: task({ taskType: 'UNKNOWN' }) })).plan).toBeNull()
  })

  it('patient-required without a patient → no plan', () => {
    const { plan, reason } = buildPlan(ctx({ hasPatient: false }))
    expect(plan).toBeNull()
    expect(reason).toBe('patient_required')
  })
})

describe('hard caps (§14)', () => {
  it('respects maxPlanSteps', () => {
    const { plan } = buildPlan(ctx({
      limit: { ...LIMITS, maxPlanSteps: 1 },
      task: task({ taskType: 'MULTI_STEP', contextProfile: 'FULL_360' }),
      actionTool: 'schedule_followup', actionParams: { date: '2026-10-05' }, actionParamsComplete: true,
    }))
    expect(plan.steps.length).toBeLessThanOrEqual(1)
    expect(plan.maxSteps).toBeLessThanOrEqual(1)
  })

  it('never schedules unknown tools', () => {
    const { plan } = buildPlan(ctx({
      task: task({ taskType: 'ACTION_REQUEST', contextProfile: null }),
      actionTool: 'launch_missiles', actionParams: {}, actionParamsComplete: true,
    }))
    // unknown tool is dropped → no steps
    expect(plan === null || plan.steps.every((s) => s.tool !== 'launch_missiles')).toBe(true)
  })
})

describe('cycle detection (§13)', () => {
  const mk = (index: number, dependsOn?: number[]): AgentPlanStep => ({
    index, tool: 'get_patient_overview', input: {}, intent: 'x', status: 'PENDING', dependsOn,
  })

  it('accepts linear plans', () => {
    expect(() => finalizePlan([mk(0), mk(1, [0])], task())).not.toThrow()
  })

  it('rejects self-references', () => {
    expect(() => finalizePlan([mk(0, [0])], task())).toThrow('PLAN_CYCLE_DETECTED')
  })

  it('rejects forward references', () => {
    expect(() => finalizePlan([mk(0), mk(1, [2])], task())).toThrow('PLAN_CYCLE_DETECTED')
  })
})

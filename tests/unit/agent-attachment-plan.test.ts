// @ts-nocheck
/**
 * Phase 6 — attachment planning + compare intent (deterministic, EN + AR,
 * §14/§15/§29/§30/§39). The planner emits TEMPLATES with server-resolved
 * attachment ids only; engine selection is never a planning decision.
 */
import { describe, it, expect } from 'vitest'
import { buildPlan } from '@/lib/ai/agent/planner'
import { detectCompareIntent, classifyAgentTask, extractToothMentions } from '@/lib/ai/agent/classifier'

const LIMITS = {
  maxPlanSteps: 12, maxToolCalls: 10, maxRepeatedToolCalls: 3, maxIterations: 8,
  totalTimeoutMs: 30000, maxContextChars: 60000, maxAnswerChars: 4000, maxLlmCalls: 1,
}

const task = (over = {}) => ({
  taskType: 'ATTACHMENT_ANALYSIS', domains: ['imaging'], riskLevel: 'LOW',
  contextProfile: null, executionMode: 'READ_ONLY',
  patientInvolved: true, toothInvolved: false, caseInvolved: false,
  readOnly: true, actionRequested: false, multiStep: false,
  confidence: 0.9, classifiedBy: 'deterministic', missingInfo: [],
  attachmentTask: { compare: false },
  ...over,
})

const att = (id, fileClass, dentalModality = null, patientId = 'pat-A1') => ({
  id, fileClass, dentalModality, patientId,
})

const ctx = (over = {}) => ({
  task: task(), hasPatient: true, hasContext: true,
  actionIntent: null, actionTool: null, actionParams: {},
  actionParamsComplete: false, operationalTopic: null, operationalInput: {},
  message: 'test', limit: LIMITS,
  attachmentRefs: null,
  ...over,
})

const tools = (r) => (r.plan ? r.plan.steps.map((s) => s.tool) : null)

describe('detectCompareIntent (deterministic, EN + AR)', () => {
  it('Arabic before/after phrases', () => {
    expect(detectCompareIntent('قارن الصورتين')).toBe(true)
    expect(detectCompareIntent('ما الفرق بين الصورتين؟')).toBe(true)
    expect(detectCompareIntent('أريد مقارنة قبل وبعد العلاج')).toBe(true)
  })

  it('English before/after phrases', () => {
    expect(detectCompareIntent('Compare the two images')).toBe(true)
    expect(detectCompareIntent('what is the difference between before and after?')).toBe(true)
  })

  it('single-image requests are NOT comparison', () => {
    expect(detectCompareIntent('حلل الصورة دي')).toBe(false)
    expect(detectCompareIntent('analyze this scan')).toBe(false)
    expect(detectCompareIntent('اقرلي الملف')).toBe(false)
  })
})

describe('buildPlan — ATTACHMENT_ANALYSIS templates (§14/§15)', () => {
  it('no attachments → null plan (never invents steps)', () => {
    const r = buildPlan(ctx())
    expect(r.plan).toBeNull()
    expect(r.reason).toBe('no_attachments')
  })

  it('one classified 2D image → one analyze_attachment (no tooth in input)', () => {
    const r = buildPlan(ctx({
      attachmentRefs: [att('att-1', 'IMAGE_2D', 'IMAGE_2D')],
      task: task(),
    }))
    expect(tools(r)).toEqual(['analyze_attachment'])
    expect(r.plan.steps[0].input).toEqual({ attachmentId: 'att-1' })
  })

  it('tooth focus is passed as FDI when exactly one tooth was named', () => {
    const r = buildPlan(ctx({
      attachmentRefs: [att('att-1', 'IMAGE_2D', 'IMAGE_2D')],
      toothFdi: 36,
    }))
    expect(r.plan.steps[0].input).toEqual({ attachmentId: 'att-1', toothFdi: 36 })
  })

  it('two meshes + compare → ONE compare step (A/B), no per-item steps', () => {
    const r = buildPlan(ctx({
      attachmentRefs: [att('att-a', 'MESH_3D', 'THREE_D_SCAN'), att('att-b', 'MESH_3D', 'THREE_D_SCAN')],
      task: task({ attachmentTask: { compare: true } }),
    }))
    expect(tools(r)).toEqual(['compare_attachments'])
    expect(r.plan.steps[0].input).toEqual({ attachmentIdA: 'att-a', attachmentIdB: 'att-b' })
  })

  it('three meshes + compare → compare(A,B) + analyze(C) (extras stay individual)', () => {
    const r = buildPlan(ctx({
      attachmentRefs: [
        att('att-a', 'MESH_3D', 'THREE_D_SCAN'),
        att('att-b', 'MESH_3D', 'THREE_D_SCAN'),
        att('att-c', 'MESH_3D', 'THREE_D_SCAN'),
      ],
      task: task({ attachmentTask: { compare: true } }),
    }))
    expect(tools(r)).toEqual(['compare_attachments', 'analyze_attachment'])
    expect(r.plan.steps[1].input).toEqual({ attachmentId: 'att-c' })
  })

  it('compare requested with only ONE attachment → individual analysis (compare ignored)', () => {
    const r = buildPlan(ctx({
      attachmentRefs: [att('att-1', 'MESH_3D', 'THREE_D_SCAN')],
      task: task({ attachmentTask: { compare: true } }),
    }))
    expect(tools(r)).toEqual(['analyze_attachment'])
  })

  it('DICOM volume only → null plan: ingestion-only, no engine step (§26)', () => {
    const r = buildPlan(ctx({ attachmentRefs: [att('att-d', 'VOLUME_DICOM', 'CBCT')] }))
    expect(r.plan).toBeNull()
    expect(r.reason).toBe('no_analyzable_attachments')
  })

  it('unclassified 2D image (modality null) → NOT scheduled for analysis (§11/§18)', () => {
    const r = buildPlan(ctx({ attachmentRefs: [att('att-x', 'IMAGE_2D', null)] }))
    expect(r.plan).toBeNull()
    expect(r.reason).toBe('no_analyzable_attachments')
  })

  it('mesh with null modality IS scheduled (MESH_3D defaults to THREE_D_SCAN)', () => {
    const r = buildPlan(ctx({ attachmentRefs: [att('att-m', 'MESH_3D', null)] }))
    expect(tools(r)).toEqual(['analyze_attachment'])
  })

  it('document only → read_document_attachment (data path, not engine path)', () => {
    const r = buildPlan(ctx({ attachmentRefs: [att('att-doc', 'DOCUMENT_PDF')] }))
    expect(tools(r)).toEqual(['read_document_attachment'])
  })

  it('mixed set (image + DICOM + document) → only the analyzable/readable steps', () => {
    const r = buildPlan(ctx({
      attachmentRefs: [
        att('att-img', 'IMAGE_2D', 'IMAGE_2D'),
        att('att-d', 'VOLUME_DICOM', 'CBCT'),
        att('att-doc', 'DOCUMENT_TEXT'),
      ],
    }))
    expect(tools(r)).toEqual(['analyze_attachment', 'read_document_attachment'])
    expect(r.plan.steps.map((s) => s.input.attachmentId)).toEqual(['att-img', 'att-doc'])
  })
})

describe('classifier — attachment messages stay in the dental domain', () => {
  const base = {
    hasPatientId: false, patientNameHint: null, patientToothFdi: null,
    caseId: null, studyId: null, treatmentNo: null, now: new Date('2026-09-30T12:00:00Z'),
  }

  it('“ركز على السن 36” extracts FDI 36 (never guesses other teeth)', () => {
    expect(extractToothMentions('ركز على السن 36 في الصورة')).toEqual([36])
    const out = classifyAgentTask({ ...base, message: 'ركز على السن 36 في الصورة' })
    expect(out.teeth).toEqual([36])
  })

  it('attachment prompts classify without error (the loop overrides to ATTACHMENT_ANALYSIS)', () => {
    for (const msg of ['حلل الصورة دي', 'قارن الصورتين', 'ما في الملف ده؟', 'compare the two scans']) {
      const out = classifyAgentTask({ ...base, message: msg })
      expect(out.task).toBeTruthy()
      expect(out.teeth).toEqual([])
    }
  })
})

/**
 * Phase 9 — bounded workflow definitions (§22).
 *
 * Four canonical workflows. Each is a fixed, versioned, typed step program —
 * replayable and deterministic in ordering. Sensitive steps (PROPOSE_ACTION)
 * are marked approval-required; the engine routes them through the existing
 * action pipeline and NEVER mutates sensitive records directly (§25).
 */

import type { WorkflowDefinition } from './types'

export const WORKFLOW_CASE_REVIEW: WorkflowDefinition = {
  workflowId: 'case_review',
  version: 1,
  nameKey: 'wf.caseReview.name',
  allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'],
  allowedTools: ['get_followup_context', 'get_clinical_context', 'search_knowledge', 'get_attachment_analysis'],
  maxSteps: 9,
  maxToolCalls: 8,
  timeoutMs: 30_000,
  retry: { maxRetries: 1, retryOn: ['RETRIEVAL_TIMEOUT'] },
  approvalRequiredSteps: [],
  failureBehavior: 'STOP',
  verificationRequired: true,
  audit: { action: 'AI_WORKFLOW_CASE_REVIEW' },
  steps: [
    { id: 'resolve_patient', kind: 'RESOLVE_PATIENT', titleKey: 'wf.step.resolvePatient' },
    { id: 'build_case_graph', kind: 'BUILD_CASE_GRAPH', titleKey: 'wf.step.buildCaseGraph', usesTool: 'get_clinical_context' },
    { id: 'retrieve_memory', kind: 'RETRIEVE_MEMORY', titleKey: 'wf.step.retrieveMemory' },
    { id: 'retrieve_imaging', kind: 'RETRIEVE_IMAGING', titleKey: 'wf.step.retrieveImaging' },
    { id: 'retrieve_ai_findings', kind: 'RETRIEVE_AI_FINDINGS', titleKey: 'wf.step.retrieveAiFindings', usesTool: 'get_attachment_analysis' },
    { id: 'retrieve_knowledge', kind: 'RETRIEVE_KNOWLEDGE', titleKey: 'wf.step.retrieveKnowledge', usesTool: 'search_knowledge' },
    { id: 'summarize', kind: 'SUMMARIZE', titleKey: 'wf.step.summarize' },
    { id: 'identify_missing', kind: 'IDENTIFY_MISSING', titleKey: 'wf.step.identifyMissing' },
    { id: 'build_review_package', kind: 'BUILD_REVIEW_PACKAGE', titleKey: 'wf.step.buildReviewPackage' },
  ],
}

export const WORKFLOW_IMAGING_REVIEW: WorkflowDefinition = {
  workflowId: 'imaging_review',
  version: 1,
  nameKey: 'wf.imagingReview.name',
  allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'LAB_TECH'],
  // 'create_finding' is NOT an executable tool: the engine maps it to the
  // Phase-1 pipeline (which has NO finding-creation policy) → the step fails
  // closed (NO_PIPELINE_ACTION). A confirmed finding is only ever written
  // through the existing clinician review route — the workflow points at it,
  // never bypasses it (§25/§27).
  allowedTools: ['get_attachment_analysis', 'get_clinical_context', 'create_finding'],
  maxSteps: 7,
  maxToolCalls: 7,
  timeoutMs: 120_000,
  retry: { maxRetries: 1, retryOn: ['ENGINE_TIMEOUT'] },
  approvalRequiredSteps: ['create_finding'],
  failureBehavior: 'STOP',
  verificationRequired: true,
  audit: { action: 'AI_WORKFLOW_IMAGING_REVIEW' },
  steps: [
    { id: 'resolve_patient', kind: 'RESOLVE_PATIENT', titleKey: 'wf.step.resolvePatient' },
    { id: 'retrieve_imaging', kind: 'RETRIEVE_IMAGING', titleKey: 'wf.step.retrieveImaging', usesTool: 'get_attachment_analysis' },
    { id: 'retrieve_ai_findings', kind: 'RETRIEVE_AI_FINDINGS', titleKey: 'wf.step.retrieveAiFindings', usesTool: 'get_attachment_analysis' },
    { id: 'validate_output', kind: 'IDENTIFY_MISSING', titleKey: 'wf.step.validateOutput' },
    { id: 'build_review_package', kind: 'BUILD_REVIEW_PACKAGE', titleKey: 'wf.step.clinicianReview' },
    { id: 'create_finding', kind: 'PROPOSE_ACTION', titleKey: 'wf.step.createFinding', usesTool: 'create_finding' },
  ],
}

export const WORKFLOW_FOLLOW_UP: WorkflowDefinition = {
  workflowId: 'follow_up',
  version: 1,
  nameKey: 'wf.followUp.name',
  allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'],
  allowedTools: ['get_followup_context', 'get_clinical_context', 'schedule_followup'],
  maxSteps: 7,
  maxToolCalls: 6,
  timeoutMs: 30_000,
  retry: { maxRetries: 1, retryOn: ['RETRIEVAL_TIMEOUT'] },
  // Scheduling a follow-up is a SENSITIVE action → approval pipeline
  // (the engine maps 'schedule_followup' → the Phase-1 'book_appointment'
  // action; the pipeline re-resolves the patient tenant-side, validates,
  // checks RBAC + idempotency, and parks the run in WAITING_APPROVAL).
  approvalRequiredSteps: ['propose_action'],
  failureBehavior: 'STOP',
  verificationRequired: true,
  audit: { action: 'AI_WORKFLOW_FOLLOW_UP' },
  steps: [
    { id: 'resolve_patient', kind: 'RESOLVE_PATIENT', titleKey: 'wf.step.resolvePatient' },
    { id: 'build_case_graph', kind: 'BUILD_CASE_GRAPH', titleKey: 'wf.step.buildCaseGraph', usesTool: 'get_clinical_context' },
    { id: 'determine_state', kind: 'DETERMINE_FOLLOW_UP_STATE', titleKey: 'wf.step.determineFollowUpState', usesTool: 'get_followup_context' },
    { id: 'prepare_recommendation', kind: 'PREPARE_RECOMMENDATION', titleKey: 'wf.step.prepareRecommendation' },
    { id: 'propose_action', kind: 'PROPOSE_ACTION', titleKey: 'wf.step.proposeAction', usesTool: 'schedule_followup' },
    { id: 'verify', kind: 'BUILD_REVIEW_PACKAGE', titleKey: 'wf.step.verifyAudit' },
  ],
}

export const WORKFLOW_DAILY_CLINIC: WorkflowDefinition = {
  workflowId: 'daily_clinic_review',
  version: 1,
  nameKey: 'wf.dailyClinic.name',
  allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR'],
  allowedTools: ['get_clinical_context'],
  maxSteps: 7,
  maxToolCalls: 5,
  timeoutMs: 20_000,
  retry: { maxRetries: 0, retryOn: [] },
  approvalRequiredSteps: [],
  failureBehavior: 'STOP',
  verificationRequired: true,
  audit: { action: 'AI_WORKFLOW_DAILY_CLINIC' },
  steps: [
    { id: 'load_clinic_state', kind: 'LOAD_CLINIC_STATE', titleKey: 'wf.step.loadClinicState', usesTool: 'get_clinical_context' },
    { id: 'identify_pending', kind: 'RANK_DETERMINISTIC', titleKey: 'wf.step.identifyPending' },
    { id: 'identify_bottlenecks', kind: 'RANK_DETERMINISTIC', titleKey: 'wf.step.identifyBottlenecks' },
    { id: 'identify_review_required', kind: 'RANK_DETERMINISTIC', titleKey: 'wf.step.identifyReviewRequired' },
    { id: 'rank_severity', kind: 'RANK_DETERMINISTIC', titleKey: 'wf.step.rankSeverity' },
    { id: 'generate_explanation', kind: 'GENERATE_EXPLANATION', titleKey: 'wf.step.generateExplanation' },
    { id: 'present_command_center', kind: 'BUILD_REVIEW_PACKAGE', titleKey: 'wf.step.presentCommandCenter' },
  ],
}

export const WORKFLOWS: Record<string, WorkflowDefinition> = {
  [WORKFLOW_CASE_REVIEW.workflowId]: WORKFLOW_CASE_REVIEW,
  [WORKFLOW_IMAGING_REVIEW.workflowId]: WORKFLOW_IMAGING_REVIEW,
  [WORKFLOW_FOLLOW_UP.workflowId]: WORKFLOW_FOLLOW_UP,
  [WORKFLOW_DAILY_CLINIC.workflowId]: WORKFLOW_DAILY_CLINIC,
}

export function getWorkflow(id: string): WorkflowDefinition | null {
  return WORKFLOWS[id] ?? null
}

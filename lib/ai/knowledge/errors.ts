/**
 * Phase 4 — Typed knowledge failures (spec §36).
 * The agent must never claim "I checked the guidelines" when retrieval
 * actually failed — these codes drive honest reporting.
 */
import type { KnowledgeFailure, KnowledgeFailureCode } from './types'

export function knowledgeFailure(code: KnowledgeFailureCode, message: string): KnowledgeFailure {
  return { code, message }
}

/**
 * Human-readable, HONEST phrasing per failure code. Used by the agent loop
 * so a failed/empty retrieval is reported exactly as what happened.
 */
export function failureAnswerText(failure: KnowledgeFailure): string {
  switch (failure.code) {
    case 'KNOWLEDGE_NOT_AVAILABLE':
      return 'The dental knowledge base is currently unavailable, so no evidence was retrieved. I have not checked any guidelines.'
    case 'NO_RESULTS':
      return 'I searched the dental knowledge base but found no matching evidence for this question.'
    case 'INVALID_QUERY':
      return `I could not search the knowledge base for this question (${failure.message}). Please rephrase it.`
    case 'SOURCE_NOT_FOUND':
      return 'The requested knowledge source is not available.'
    case 'INDEX_FAILURE':
      return 'The knowledge index could not be loaded, so no evidence was retrieved.'
    case 'RETRIEVAL_TIMEOUT':
      return 'The knowledge search timed out, so no evidence was retrieved. Please try again.'
    case 'EVIDENCE_INSUFFICIENT':
      return 'The retrieved evidence is insufficient to answer this safely. I am not making unsupported claims.'
    case 'CONFLICTING_EVIDENCE':
      return 'The available evidence sources disagree on this topic. I am presenting the conflict explicitly rather than inventing a consensus.'
    case 'UNSUPPORTED_DOMAIN':
      return 'This topic is outside the dental knowledge domains covered by the knowledge base.'
    case 'SECURITY_FILTERED':
      return 'This request was blocked by a knowledge security filter.'
    default:
      return 'The knowledge search did not complete successfully, so no evidence was retrieved.'
  }
}

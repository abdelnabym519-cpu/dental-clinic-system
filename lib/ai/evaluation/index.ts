/**
 * Phase 7 — DenToRa AI evaluation, observability & replay harness.
 *
 * Single canonical framework (no second agent / brain / RAG /
 * observability store). Consumes the existing AI modules:
 *   - agent loop      → runAgent (replayed, observed, fingerprinted)
 *   - knowledge layer → retrieveKnowledge / grounding (evaluated directly)
 *   - multimodal      → attachment classification/routing (evaluated)
 *   - local AI        → artifact identity + provenance evidence
 *
 * Everything is typed, deterministic, PHI-minimized, and fail-closed.
 */
export * from './types'
export * from './environment'
export * from './results'
export * from './trace'
export * from './dataset'
export * from './replay'
export * from './benchmark'
export * from './gate'
export * from './local-ai'

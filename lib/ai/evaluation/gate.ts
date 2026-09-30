/**
 * Phase 7 — acceptance gate aggregation (§27/§28).
 *
 * One canonical gate registry (Gates A–L). Each gate aggregates typed
 * checks from the suites; the phase status follows the strict rules:
 *
 *   PASS                      — every applicable gate PASS.
 *   PASS_WITH_EXPLICIT_BLOCKERS — implementation complete; only
 *                                 BLOCKED_ENVIRONMENT (with reasons) remain.
 *   FAIL                      — any FAIL (implementation defects are never
 *                                 reclassified as environmental).
 */
import type { EvalCheck, GateId, GateReport, PhaseStatus } from './types'
import { GATE_IDS } from './types'

export const GATE_TITLES: Record<GateId, string> = {
  A_ARCHITECTURE: 'One canonical framework; no duplicate Agent/RAG/brain; reuse proven',
  B_AGENT: 'Routing / tools / plan / context / failure behavior evaluated',
  C_SAFETY: 'Approval, policy, execution, and verification boundaries tested',
  D_RAG: 'Retrieval, grounding, citations, no-evidence behavior evaluated',
  E_MULTIMODAL: 'Classification, routing, unsupported behavior, provenance evaluated',
  F_LOCAL_AI: 'Artifact identity, provenance, real-vs-capability evidence separated',
  G_SECURITY: 'Adversarial suite executed; no known critical bypass',
  H_OBSERVABILITY: 'Traces available; PHI minimized; failures diagnosable; no CoT storage',
  I_REPLAY: 'Golden cases replay deterministically; mismatches actionable',
  J_REGRESSION: 'Phases 0–6 critical contracts covered; behavior preserved',
  K_PERFORMANCE: 'Environment labeled; measurements reproducible; no false target claims',
  L_DOCUMENTATION: 'Report complete; commands documented; engine registration documented',
}

export function gateReport(gate: GateId, checks: EvalCheck[]): GateReport {
  const blockedReasons = checks
    .filter((c) => c.verdict === 'BLOCKED_ENVIRONMENT' && c.reason)
    .map((c) => c.reason as string)
  const hasFail = checks.some((c) => c.verdict === 'FAIL')
  const allBlocked = checks.length > 0 && checks.every((c) => c.verdict === 'BLOCKED_ENVIRONMENT')
  // An empty gate is never green — there is no evidence to pass on.
  const verdict = checks.length === 0
    ? 'NOT_APPLICABLE'
    : hasFail
      ? 'FAIL'
      : allBlocked
        ? 'BLOCKED_ENVIRONMENT'
        : 'PASS'
  return {
    gate,
    title: GATE_TITLES[gate],
    checks,
    verdict,
    blockedReasons: checks.length === 0
      ? ['no checks recorded — gate not exercised (never reported as PASS)']
      : [...new Set(blockedReasons)],
  }
}

export function allGateReports(reports: GateReport[]): GateReport[] {
  const byId = new Map(reports.map((r) => [r.gate, r]))
  return GATE_IDS.map((g) => byId.get(g) ?? gateReport(g, []))
}

export function computePhaseStatus(reports: GateReport[]): {
  status: PhaseStatus
  blockedGates: { gate: GateId; reasons: string[] }[]
  notApplicableGates: { gate: GateId; reasons: string[] }[]
  failedGates: GateId[]
} {
  const failedGates = reports.filter((r) => r.verdict === 'FAIL').map((r) => r.gate)
  const blockedGates = reports
    .filter((r) => r.verdict === 'BLOCKED_ENVIRONMENT')
    .map((r) => ({ gate: r.gate, reasons: r.blockedReasons }))
  const notApplicableGates = reports
    .filter((r) => r.verdict === 'NOT_APPLICABLE')
    .map((r) => ({ gate: r.gate, reasons: r.blockedReasons }))
  if (failedGates.length > 0) {
    return { status: 'FAIL', blockedGates, notApplicableGates, failedGates }
  }
  return {
    status: blockedGates.length > 0 ? 'PASS_WITH_EXPLICIT_BLOCKERS' : 'PASS',
    blockedGates,
    notApplicableGates,
    failedGates: [],
  }
}

/** Emoji rendering for reports (§28). */
export function statusEmoji(status: PhaseStatus): string {
  if (status === 'PASS') return '🟢'
  if (status === 'PASS_WITH_EXPLICIT_BLOCKERS') return '🟡'
  return '🔴'
}

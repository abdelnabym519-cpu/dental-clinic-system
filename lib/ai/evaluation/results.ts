/**
 * Phase 7 — evaluation results, checks, and metrics builders.
 *
 * Every evaluator fails with typed, actionable information (§21) — a
 * `EvalCheck` always carries a typed code (on FAIL) and a PHI-free detail.
 */
import type {
  EvalCheck, EvalFailureCode, EvaluationMetric, EvaluationResult, EvalVerdict,
} from './types'

export function pass(id: string, detail: string): EvalCheck {
  return { id, verdict: 'PASS', code: null, detail, reason: null }
}

export function fail(id: string, code: EvalFailureCode, detail: string): EvalCheck {
  return { id, verdict: 'FAIL', code, detail, reason: null }
}

/** SKIPPED / BLOCKED_ENVIRONMENT / NOT_APPLICABLE all REQUIRE a reason (§24). */
export function skipped(id: string, reason: string, verdict: EvalVerdict = 'SKIPPED'): EvalCheck {
  if (!reason || !reason.trim()) throw new Error(`skipped check ${id} requires a reason`)
  return { id, verdict, code: null, detail: reason, reason }
}

export function blockedEnv(id: string, reason: string): EvalCheck {
  return skipped(id, reason, 'BLOCKED_ENVIRONMENT')
}

export function notApplicable(id: string, reason: string): EvalCheck {
  return skipped(id, reason, 'NOT_APPLICABLE')
}

/** Aggregate a case's checks into a verdict + typed failure codes. */
export function aggregateCheckVerdict(checks: EvalCheck[]): {
  verdict: EvalVerdict
  failureCodes: EvalFailureCode[]
} {
  const failureCodes: EvalFailureCode[] = []
  for (const c of checks) {
    if (c.verdict === 'FAIL') failureCodes.push(c.code as EvalFailureCode)
  }
  if (failureCodes.length > 0) return { verdict: 'FAIL', failureCodes }
  // A result with only blocked/not-applicable checks is not a pass of the
  // behavior — it is blocked. (SKIPPED alone = deferred, not blocked.)
  const blocked = checks.some((c) => c.verdict === 'BLOCKED_ENVIRONMENT')
  if (checks.length > 0 && blocked && checks.every((c) => c.verdict !== 'PASS')) {
    return { verdict: 'BLOCKED_ENVIRONMENT', failureCodes }
  }
  if (checks.length === 0) return { verdict: 'FAIL', failureCodes: ['EVAL_CONTRACT_MISMATCH'] }
  const allNonPass = checks.every((c) => c.verdict === 'SKIPPED' || c.verdict === 'NOT_APPLICABLE')
  if (allNonPass) return { verdict: 'NOT_APPLICABLE', failureCodes }
  return { verdict: 'PASS', failureCodes }
}

export function makeResult(
  suite: string,
  caseId: string | null,
  checks: EvalCheck[],
  durationMs: number,
): EvaluationResult {
  const agg = aggregateCheckVerdict(checks)
  return {
    suite,
    caseId,
    verdict: agg.verdict,
    checks,
    failureCodes: agg.failureCodes,
    reason: checks.find((c) => c.verdict === 'BLOCKED_ENVIRONMENT')?.reason ?? null,
    durationMs,
  }
}

// ---------------------------------------------------------------------------
// Metrics (§17) — canonical, computed only from observed outcomes.
// ---------------------------------------------------------------------------

export function ratioMetric(name: string, numerator: number, denominator: number): EvaluationMetric {
  return {
    name,
    value: denominator > 0 ? numerator / denominator : 0,
    numerator,
    denominator,
    unit: 'ratio',
  }
}

export function countMetric(name: string, count: number): EvaluationMetric {
  return { name, value: count, numerator: count, denominator: 1, unit: 'count' }
}

export function msMetric(name: string, ms: number): EvaluationMetric {
  return { name, value: ms, numerator: Math.round(ms), denominator: 1, unit: 'ms' }
}

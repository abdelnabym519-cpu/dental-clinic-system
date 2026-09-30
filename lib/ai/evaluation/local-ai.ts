/**
 * Phase 7 — LOCAL AI evaluation (§10/§11).
 *
 * Strict separation of evidence levels — the core no-false-green rule:
 *
 *   CAPABILITY      — the engine code + registry path exist (static).
 *   WEIGHTS         — model artifact bytes are present on disk.
 *   INFERENCE       — a real forward pass produced output.
 *   REAL_VERIFIED   — committed, schema-valid evidence report whose claimed
 *                     SHAs, runtime (CPU) and output schema all check out.
 *
 * The 4-state classification:
 *   REAL_INFERENCE_VERIFIED — committed report verified AND weights present
 *                             AND (live health OK OR live not required).
 *   CAPABILITY_VERIFIED     — code/registry verified, weights or report
 *                             missing in this environment.
 *   UNAVAILABLE             — engine code itself not present.
 *   ENVIRONMENT_BLOCKED     — the required evidence exists but CANNOT be
 *                             produced/checked here (reason recorded).
 *
 * Live replay is OPT-IN via EVAL_REAL_ENGINE=1 (offline default).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EnvLabel } from './types'

export type LocalAiEvidenceState =
  | 'REAL_INFERENCE_VERIFIED'
  | 'CAPABILITY_VERIFIED'
  | 'UNAVAILABLE'
  | 'ENVIRONMENT_BLOCKED'

export interface LocalAiEvidenceCheck {
  engine: string
  state: LocalAiEvidenceState
  reason: string
  reportPath: string | null
  reportStatus: string | null
  weightsPresent: boolean
  weightsShaVerified: boolean
  liveAvailable: boolean | null
  environment: EnvLabel
  liveOptIn: boolean
}

/** Validate one committed Phase 5/6 real-inference report. */
export function verifyInferenceReport(path: string): {
  ok: boolean
  status: string | null
  engine: string | null
  modelSha: string | null
  inputSha: string | null
  cpuOnly: boolean
  reason: string
} {
  if (!existsSync(path)) return { ok: false, status: null, engine: null, modelSha: null, inputSha: null, cpuOnly: false, reason: `report file missing: ${path}` }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    return { ok: false, status: null, engine: null, modelSha: null, inputSha: null, cpuOnly: false, reason: `report unreadable: ${e instanceof Error ? e.message : String(e)}` }
  }
  let r: any
  try {
    r = JSON.parse(raw)
  } catch {
    return { ok: false, status: null, engine: null, modelSha: null, inputSha: null, cpuOnly: false, reason: 'report is not valid JSON' }
  }
  const status = typeof r.status === 'string' ? r.status : null
  const engine = typeof r.engine === 'string' ? r.engine : null
  const modelSha = typeof r.model?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.model.sha256) ? r.model.sha256 : null
  const inputSha = typeof r.input?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.input.sha256) ? r.input.sha256 : null
  const cpuOnly = r.runtime?.cuda_available === false && /CPU/i.test(String(r.runtime?.execution_provider ?? ''))
  const outputOk = Number.isFinite(r.output?.total_cells) && Array.isArray(r.output?.segments) && r.output.segments.length > 0
  if (!status) return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: 'report has no status field' }
  if (status !== 'REAL_INFERENCE_VERIFIED') return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: `report status is ${status}, not REAL_INFERENCE_VERIFIED` }
  if (!engine) return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: 'report has no engine name' }
  if (!modelSha) return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: 'report model sha256 missing or malformed' }
  if (!inputSha) return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: 'report input sha256 missing or malformed' }
  if (!cpuOnly) return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: 'report runtime is not CPU-only (master mandate)' }
  if (!outputOk) return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: 'report output schema invalid (no cells/segments)' }
  if (r.engine_modified === true) return { ok: false, status, engine, modelSha, inputSha, cpuOnly, reason: 'report claims engine code was modified' }
  return { ok: true, status, engine, modelSha, inputSha, cpuOnly, reason: 'report schema verified (status/engine/SHAs/CPU/output)' }
}

/**
 * Classify the evidence state for one engine in this environment.
 * `artifactOk` = weights + input mesh present on disk with matching SHAs.
 * `liveOk` = a live /health probe (only when opt-in).
 */
export function classifyLocalAiEvidence(args: {
  engine: string
  codePresent: boolean
  reportPath: string | null
  artifactOk: boolean
  artifactReason: string
  liveOk: boolean | null
  liveReason: string
  environment: EnvLabel
  liveOptIn: boolean
}): LocalAiEvidenceCheck {
  const { engine, codePresent, reportPath, artifactOk, artifactReason, liveOk, liveReason, environment, liveOptIn } = args
  const base = { engine, reportPath, liveAvailable: liveOk, environment, liveOptIn }
  if (!codePresent) {
    return { ...base, state: 'UNAVAILABLE', weightsPresent: false, weightsShaVerified: false, reportStatus: null, reason: 'engine code not present in this workspace' }
  }
  const report = reportPath ? verifyInferenceReport(reportPath) : { ok: false, status: null, engine: null, modelSha: null, inputSha: null, cpuOnly: false, reason: 'no committed report path' }
  // Report verified but artifacts absent from THIS environment: the
  // environment-blocked state (not a pass, not a fail of the engine).
  if (report.ok && !artifactOk) {
    return { ...base, state: 'ENVIRONMENT_BLOCKED', weightsPresent: false, weightsShaVerified: false, reportStatus: report.status, reason: `committed evidence report verified, but ${artifactReason}` }
  }
  // Report verified AND artifacts present on disk:
  if (report.ok && artifactOk) {
    if (!liveOptIn) {
      return { ...base, state: 'REAL_INFERENCE_VERIFIED', weightsPresent: true, weightsShaVerified: true, reportStatus: report.status, reason: 'committed REAL_INFERENCE_VERIFIED report + on-disk artifacts; live replay not required (offline default)' }
    }
    if (liveOk === true) {
      return { ...base, state: 'REAL_INFERENCE_VERIFIED', weightsPresent: true, weightsShaVerified: true, reportStatus: report.status, reason: 'report verified + artifacts present + live engine healthy' }
    }
    return { ...base, state: 'ENVIRONMENT_BLOCKED', weightsPresent: true, weightsShaVerified: true, reportStatus: report.status, reason: `live engine check blocked: ${liveReason}` }
  }
  // Code + report path exist but the report did not verify (or no report):
  if (artifactOk) {
    return { ...base, state: 'CAPABILITY_VERIFIED', weightsPresent: true, weightsShaVerified: true, reportStatus: report.status, reason: `artifacts present but evidence report not verified: ${report.reason}` }
  }
  return { ...base, state: 'CAPABILITY_VERIFIED', weightsPresent: false, weightsShaVerified: false, reportStatus: report.status, reason: `capability (code + registry) only — ${artifactReason}; ${report.ok ? 'report verified' : `report not verified: ${report.reason}`}` }
}

/** sha256 hex of a file (null when absent). */
export function sha256OfFile(path: string): string | null {
  if (!existsSync(path)) return null
  const h = createHash('sha256')
  h.update(readFileSync(path))
  return h.digest('hex')
}

/**
 * Locate the Phase 5/6 evidence tree for an engine under the repo root.
 * Returns null when the engine validation directory is not present.
 */
export function findEngineEvidenceRoot(repoRoot: string, engine: string): string | null {
  const candidates = [
    join(repoRoot, 'ai-validation', engine === 'meshsegnet-max' ? 'meshsegnet' : engine, 'reports'),
    join(repoRoot, 'ai-validation', engine, 'reports'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

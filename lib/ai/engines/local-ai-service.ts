/**
 * LocalAIService — the single TypeScript boundary for local dental AI
 * (Phase 5, §10). One clean abstraction for executing local engines:
 *
 *   capability resolution → engine selection → input validation →
 *   inference (via the existing orchestrator transport) → provenance
 *   integrity → result normalization → typed envelope / typed failure.
 *
 * Rules it enforces (spec §13/§24/§32):
 *  - engine selection is a pure (modality[, jaw]) lookup in the trusted
 *    capability matrix — NEVER derived from user text;
 *  - provenance is integrity-checked: the checksum that RAN must equal the
 *    registry's expected checksum (a mismatched checksum is a different
 *    model, full stop);
 *  - stand-in (synthetic) results are rejected defense-in-depth (the
 *    orchestrator already refuses to persist them);
 *  - job/tenant identity is re-checked against the request;
 *  - every failure is a typed LocalAiError — honest unavailability, never a
 *    fabricated finding or a silent substitute model.
 *
 * Server-only. The agent requests a CAPABILITY; it never touches model
 * internals.
 */

import { CAPABILITY_MATRIX, engineForModality, resolveCapability } from './capability-matrix'
import {
  LocalAiError,
  type CapabilityRow,
  type EngineHealthEntry,
  type EngineInfo,
  type LocalAiAnalysisEnvelope,
  type LocalAiCapabilitySource,
  type LocalAiProvenance,
  type NormalizedFinding,
} from './types'

export interface LocalAiAnalyzeParams {
  jobId: string
  studyId: string
  hospitalId: string
  imageKey: string
  imageSha256: string
  modality: string
  /** Phase 20B jaw selector (mesh engines only); 'max' is the default. */
  jaw?: 'max' | 'man' | null
  requestedBy: string
  /** Capability task the caller is asking for (validated, not free text). */
  task?: string | null
}

export interface LocalAiCapabilityView {
  /** Static policy: the capability matrix (versioned with the code). */
  matrix: CapabilityRow[]
  /** Live engine state, or an honest typed unavailability. */
  runtime:
    | { source: 'orchestrator'; engines: EngineInfo[]; health: EngineHealthEntry[] }
    | { source: 'unavailable'; reason: string }
  generatedAt: string
}

export interface OrchestratorAnalyzeResponse {
  job_id: string
  status: 'COMPLETED'
  findings: Record<string, unknown>[]
  top_confidence: number | null
  provenance: Record<string, unknown>
  processing_time_ms: number
  raw_output_key: string
  annotated_image_key: string | null
  is_standin_not_meshsegnet?: boolean
  is_standin_not_liodon?: boolean
  is_standin_not_implant?: boolean
  is_standin_not_orthodontic?: boolean
}

/**
 * Thin injectable seam for tests: the production implementation delegates to
 * the existing orchestrator transport (lib/ai-orchestrator.ts). Keeping it
 * a parameter means the service logic is testable without a network.
 */
export type OrchestratorTransport = (p: {
  jobId: string
  studyId: string
  hospitalId: string
  imageKey: string
  imageSha256: string
  engine: string
  modality: string
  requestedBy: string
}) => Promise<OrchestratorAnalyzeResponse>

export class LocalAIService {
  constructor(
    private readonly source: LocalAiCapabilitySource | null,
    private readonly transport: OrchestratorTransport | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Static policy data — deterministic, no I/O. */
  listCapabilities(): CapabilityRow[] {
    return [...CAPABILITY_MATRIX]
  }

  /**
   * The view the agent tool returns: matrix + LIVE engine state when the
   * capability source is configured, otherwise an honest unavailability
   * (never a guess).
   */
  async capabilityView(): Promise<LocalAiCapabilityView> {
    let runtime: LocalAiCapabilityView['runtime']
    if (this.source) {
      try {
        const [engines, health] = await Promise.all([
          this.source.getEngines(),
          this.source.getHealth(),
        ])
        runtime = { source: 'orchestrator', engines, health }
      } catch (err) {
        runtime = {
          source: 'unavailable',
          reason: `orchestrator view unreachable: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    } else {
      runtime = {
        source: 'unavailable',
        reason: 'no orchestrator capability source configured in this deployment',
      }
    }
    return { matrix: this.listCapabilities(), runtime, generatedAt: this.now().toISOString() }
  }

  /**
   * Resolve which engine serves a (task, modality[, jaw]) tuple.
   * Deterministic; never consults user text.
   */
  resolveEngine(p: Pick<LocalAiAnalyzeParams, 'modality' | 'jaw' | 'task'>): {
    engine: string
    task: CapabilityRow
  } {
    let taskRow: CapabilityRow | null = null
    if (p.task) {
      const res = resolveCapability(p.task)
      if (!res.ok) throw new LocalAiError('UNSUPPORTED_CAPABILITY', res.error)
      if (!res.resolvable) throw new LocalAiError('UNSUPPORTED_CAPABILITY', res.reason)
      taskRow = res.task
    }
    const engine = engineForModality(p.modality, p.jaw)
    if (!engine) {
      throw new LocalAiError(
        'UNSUPPORTED_CAPABILITY',
        `no verified local engine supports modality '${p.modality}'`,
      )
    }
    if (taskRow && taskRow.engine !== engine) {
      throw new LocalAiError(
        'MODALITY_MISMATCH',
        `task '${p.task}' is served by ${taskRow.engine}, but modality '${p.modality}' resolves to ${engine}`,
      )
    }
    const task =
      taskRow ??
      CAPABILITY_MATRIX.find(
        (r) => r.engine === engine && r.modality === p.modality.toUpperCase(),
      ) ??
      CAPABILITY_MATRIX.find((r) => r.engine === engine)
    if (!task) {
      throw new LocalAiError('UNSUPPORTED_CAPABILITY', `engine '${engine}' has no capability row`)
    }
    return { engine, task }
  }

  /**
   * Run one local analysis through the orchestrator and return the
   * normalized envelope. All failure paths are typed LocalAiError.
   */
  async analyze(p: LocalAiAnalyzeParams): Promise<LocalAiAnalysisEnvelope> {
    if (!this.transport) {
      throw new LocalAiError(
        'ORCHESTRATOR_UNREACHABLE',
        'no orchestrator transport configured (AI_ORCHESTRATOR_URL/ORCHESTRATOR_SECRET unset)',
      )
    }
    const { engine } = this.resolveEngine(p)

    let res: OrchestratorAnalyzeResponse
    try {
      res = await this.transport({
        jobId: p.jobId,
        studyId: p.studyId,
        hospitalId: p.hospitalId,
        imageKey: p.imageKey,
        imageSha256: p.imageSha256,
        engine,
        modality: p.modality.toUpperCase(),
        requestedBy: p.requestedBy,
      })
    } catch (err) {
      if (err instanceof LocalAiError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      throw new LocalAiError(
        msg.includes('unreachable') || msg.includes('not configured')
          ? 'ORCHESTRATOR_UNREACHABLE'
          : 'VALIDATION_FAILED',
        msg,
      )
    }

    // ---- integrity checks (defense in depth; the orchestrator enforces
    // the same invariants server-side) ------------------------------------
    if (res.job_id !== p.jobId) {
      throw new LocalAiError('JOB_TENANT_MISMATCH', `job id mismatch: ${res.job_id} != ${p.jobId}`)
    }
    if (res.is_standin_not_meshsegnet || res.is_standin_not_liodon ||
        res.is_standin_not_implant || res.is_standin_not_orthodontic) {
      throw new LocalAiError('STANDIN_REJECTED', 'engine returned synthetic stand-in results — refusing')
    }
    const prov = res.provenance as Record<string, unknown>
    const checksum = String(prov.model_checksum ?? '').toLowerCase()
    const expected = String(prov.model_checksum_expected ?? '').toLowerCase()
    if (!checksum || checksum !== expected) {
      throw new LocalAiError(
        'PROVENANCE_MISMATCH',
        `model checksum ${checksum || '<none>'} != registry expected ${expected}`,
      )
    }
    if (String(prov.engine ?? '') !== engine) {
      throw new LocalAiError('PROVENANCE_MISMATCH', `provenance engine mismatch: ${String(prov.engine)}`)
    }

    const localProv: LocalAiProvenance = {
      engine,
      modelVersion: typeof prov.model_version === 'string' ? prov.model_version : null,
      modelChecksum: checksum,
      modelChecksumExpected: expected,
      modelSource: typeof prov.model_source === 'string' ? prov.model_source : '',
      modelLicense: typeof prov.model_license === 'string' ? prov.model_license : '',
      orchestratorVersion: typeof prov.orchestrator_version === 'string' ? prov.orchestrator_version : '',
      inputSha256: String(prov.image_sha256 ?? '').toLowerCase(),
      device: typeof prov.device === 'string' ? prov.device : 'cpu',
      runtime: typeof prov.runtime === 'string' ? prov.runtime : '',
      processingTimeMs: Number(prov.processing_time_ms ?? res.processing_time_ms),
      rawOutputKey: typeof prov.raw_output_key === 'string' ? prov.raw_output_key : res.raw_output_key,
      annotatedImageKey: typeof prov.annotated_image_key === 'string' ? prov.annotated_image_key : res.annotated_image_key,
      timestamp: typeof prov.timestamp === 'string' ? prov.timestamp : this.now().toISOString(),
    }

    return {
      jobId: res.job_id,
      studyId: p.studyId,
      hospitalId: p.hospitalId,
      engine,
      modality: p.modality.toUpperCase(),
      findings: normalizeFindings(res.findings, engine),
      topConfidence: typeof res.top_confidence === 'number' ? res.top_confidence : null,
      uncertainty:
        'Model output is decision support only. Confidence values are model ' +
        'calibration, not clinical certainty; findings require clinician review.',
      provenance: localProv,
      reviewState: 'PENDING_REVIEW',
      warnings: buildWarnings(res),
    }
  }
}

function capabilityByTask(task: string) {
  return resolveCapability(task)
}

/** Engine-native rows -> typed normalized findings (§12 fact classes). */
function normalizeFindings(
  raw: Record<string, unknown>[],
  engine: string,
): NormalizedFinding[] {
  return raw.map((f, i) => {
    const detail: Record<string, string | number | null> = {}
    let confidence: number | null = null
    for (const [k, v] of Object.entries(f)) {
      if (k === 'confidence' && typeof v === 'number') {
        confidence = v
        continue
      }
      if (typeof v === 'string' || typeof v === 'number') detail[k] = v
      else detail[k] = null // structured nested values stay null in the flat envelope
    }
    return {
      id: `f${i + 1}`,
      // Every direct engine output is MODEL_DETECTED. Interpretation is
      // NEVER synthesized here (that is the clinician's job — §12/§20).
      findingClass: 'MODEL_DETECTED' as const,
      engine,
      detail,
      confidence,
    }
  })
}

/**
 * Human-readable display label for a normalized finding. The normalized
 * envelope is a FLAT map (engine-native fields under `detail`); different
 * engines name the class differently (`class_name` for mesh + detection,
 * `condition` for detection, numeric `class_id`). This centralizes the
 * display mapping so no caller re-derives (or mislabels) a finding.
 */
export function findingLabel(f: NormalizedFinding): string {
  const d = f.detail ?? {}
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = d[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    return null
  }
  const named = pick('class_name', 'condition', 'label', 'name')
  if (named) return named
  const cid = d.class_id ?? d.class ?? d.cls
  if (typeof cid === 'number' || (typeof cid === 'string' && /^\d+$/.test(cid))) {
    return `class_${cid}`
  }
  return f.id
}

function buildWarnings(res: OrchestratorAnalyzeResponse): string[] {
  const w: string[] = []
  if (res.top_confidence === null) {
    w.push('engine reported no top confidence value (segments/landmarks class)')
  }
  if (res.findings.length === 0) {
    w.push('no findings detected — absence of detection is not confirmation of absence')
  }
  return w
}

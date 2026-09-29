/**
 * Local AI — typed contracts (Phase 5, spec §8/§12/§26).
 *
 * The authoritative registry lives in the Python orchestrator
 * (ai/orchestrator/app/registry.py + capability_matrix.py). This file is the
 * CLIENT CONTRACT: the shapes the agent side consumes. There is deliberately
 * NO second registry here — engine identity (checksum, source, license) is
 * either fetched from the orchestrator (live) or mirrored from the committed
 * capability matrix (static policy data, contract-tested in
 * tests/unit/engines-capability-matrix.test.ts so the two cannot drift).
 *
 * No `any` anywhere in this layer (§7).
 */

// ---------------------------------------------------------------------------
// Lifecycle (spec §16) — mirrors ai/orchestrator/app/lifecycle.py
// ---------------------------------------------------------------------------

export const ENGINE_LIFECYCLE_STATES = [
  'DISCOVERED',
  'VERIFIED',
  'REGISTERED',
  'HEALTHY',
  'AVAILABLE',
  'DEGRADED',
  'BLOCKED',
  'RETIRED',
] as const
export type EngineLifecycleStatus = (typeof ENGINE_LIFECYCLE_STATES)[number]

/** Live per-engine health observation (orchestrator /health). */
export interface EngineHealthEntry {
  /** Registered engine name (the orchestrator maps it from engines_health). */
  name: string
  reachable: boolean
  modelLoaded: boolean
  status?: string | null
  error?: string | null
  /** The checksum the engine itself computed over the loaded artifact. */
  modelChecksum?: string | null
  /** True only for a self-declared synthetic stand-in (never production). */
  isStandin?: boolean
  lifecycleStatus: EngineLifecycleStatus
  lifecycleReason: string
}

// ---------------------------------------------------------------------------
// Engine view (orchestrator /engines) — identity data, no secrets
// ---------------------------------------------------------------------------

export const ENGINE_RESULT_KINDS = ['findings', 'segments', 'landmarks'] as const
export type EngineResultKind = (typeof ENGINE_RESULT_KINDS)[number]

export interface EngineInfo {
  name: string
  displayName: string
  modelVersion: string
  /** SHA-256 of the validated artifact — the identity of the model. */
  modelChecksum: string
  modelSource: string
  modelLicense: string
  runtime: string
  device: 'cpu'
  gpuOptional: boolean
  cudaRequired: boolean
  classes: Record<string, string>
  supportedModalities: string[]
  resultKind: EngineResultKind
  lifecycleStatus: EngineLifecycleStatus
  lifecycleNote?: string
}

// ---------------------------------------------------------------------------
// Capability matrix (spec §9) — mirrors the orchestrator matrix
// ---------------------------------------------------------------------------

export const CAPABILITY_OVERALL = ['SUPPORTED', 'PARTIAL', 'UNVERIFIED', 'UNAVAILABLE'] as const
export type CapabilityOverall = (typeof CAPABILITY_OVERALL)[number]

/**
 * The SIX distinct evidence states (§9). A capability may exist while the
 * weights are absent, or the model may exist while no inference evidence
 * does — each level is separate and evidence-backed.
 */
export interface CapabilityLevels {
  capabilityDeclared: boolean
  modelExists: boolean
  weightsVerified: boolean
  localInferenceVerified: boolean
  cpuInferenceVerified: boolean
  productionIntegrated: boolean
}

export interface CapabilityRow {
  /** Stable task id, e.g. "panoramic_caries_detection". */
  task: string
  modality: string
  /** Registered engine name, or null when the task has no engine (honest gap). */
  engine: string | null
  requiredInput: string
  outputType: string
  /** What happens instead — never a silent substitute. */
  fallback: string
  /** AI output is decision support: human review is always required. */
  humanReview: 'REQUIRED'
  levels: CapabilityLevels
  overall: CapabilityOverall
  /** Evidence note — what is proven and what is missing, concretely. */
  note: string
}

export type CapabilityResolution =
  | { ok: true; task: CapabilityRow; resolvable: true; reason: null }
  | { ok: true; task: CapabilityRow; resolvable: false; reason: string }
  | { ok: false; task: null; resolvable: false; reason: null; error: string }

// ---------------------------------------------------------------------------
// Analysis envelope (spec §12) — normalized local-AI output
// ---------------------------------------------------------------------------

/**
 * Fact classes for what a finding IS (§12): the model's direct output is
 * never auto-promoted to a clinical interpretation, and missing information
 * is first-class instead of silently assumed.
 */
export const FINDING_CLASSES = [
  'MODEL_DETECTED',
  'CLINICAL_INTERPRETATION',
  'MISSING_INFORMATION',
] as const
export type FindingClass = (typeof FINDING_CLASSES)[number]

export interface NormalizedFinding {
  /** Server-assigned stable id (f1..fN). */
  id: string
  findingClass: FindingClass
  engine: string
  /** Engine-native payload (class id, box/segment/landmark fields). */
  detail: Record<string, string | number | null>
  /** Model confidence in [0,1] where the engine reports one, else null. */
  confidence: number | null
}

export interface LocalAiProvenance {
  engine: string
  modelVersion: string | null
  modelChecksum: string
  modelChecksumExpected: string
  modelSource: string
  modelLicense: string
  orchestratorVersion: string
  inputSha256: string
  device: string
  runtime: string
  processingTimeMs: number
  rawOutputKey: string
  annotatedImageKey: string | null
  timestamp: string
}

/**
 * The canonical output envelope every local-AI result passes through.
 * `reviewState` is always PENDING_REVIEW at production time — model output
 * is decision support, never an autonomous physician decision (spec §20).
 */
export interface LocalAiAnalysisEnvelope {
  jobId: string
  studyId: string
  hospitalId: string
  engine: string
  modality: string
  findings: NormalizedFinding[]
  topConfidence: number | null
  uncertainty: string
  provenance: LocalAiProvenance
  reviewState: 'PENDING_REVIEW'
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Typed failures (spec §24/§36) — honest, never "I checked and it's fine"
// ---------------------------------------------------------------------------

export const LOCAL_AI_ERROR_CODES = [
  'UNSUPPORTED_CAPABILITY',
  'MODALITY_MISMATCH',
  'UNKNOWN_ENGINE',
  'ORCHESTRATOR_UNREACHABLE',
  'PROVENANCE_MISMATCH',
  'STANDIN_REJECTED',
  'JOB_TENANT_MISMATCH',
  'TIMEOUT',
  'VALIDATION_FAILED',
] as const
export type LocalAiErrorCode = (typeof LOCAL_AI_ERROR_CODES)[number]

export class LocalAiError extends Error {
  constructor(
    public readonly code: LocalAiErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'LocalAiError'
  }
}

// ---------------------------------------------------------------------------
// Machine-readable validation artifact (spec §26)
// ---------------------------------------------------------------------------

export interface EngineEvidence {
  evidence: string
  generatedAt: string
  engine: string
  model: {
    filename: string
    sha256: string
    sizeBytes: number
    source: string
  }
  input: {
    filename: string
    sha256: string
    sizeBytes: number
    source: string
  }
  runtime: {
    python: string
    torch: string | null
    executionProvider: string
    cudaAvailable: false
    host: string
  }
  healthGate: {
    status: string
    modelLoaded: boolean
    modelChecksum: string | null
    modelChecksumExpected: string | null
    isStandin: boolean
  }
  output: {
    schema: string
    totalCells: number | null
    topClasses: { classId: number; className: string; pointCount: number }[]
  }
  performanceMs: {
    coldFirstInference: number
    warmMedian: number
  }
  memory: { engineProcessPeakRssMb: number | null }
  status: 'REAL_INFERENCE_VERIFIED' | 'FAILED'
}

/** A capability source: where the agent gets its engine view from. */
export interface LocalAiCapabilitySource {
  /** Engine identities + static registry lifecycle (GET /engines). */
  getEngines(): Promise<EngineInfo[]>
  /** Live per-engine state (GET /health → engines_health). */
  getHealth(): Promise<EngineHealthEntry[]>
}

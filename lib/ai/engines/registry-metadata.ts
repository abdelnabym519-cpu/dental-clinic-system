/**
 * Phase 8 — canonical engine registry metadata (committed audit data).
 *
 * NOT a second registry: the LIVE registry stays in the Python orchestrator
 * (ai/orchestrator/app/registry.py — code-pinned engines + checksums). This
 * module is the Phase 8 evidence/identity table: the §5 structured metadata
 * and the §6 EVIDENCE STATES (which are deliberately never collapsed — a
 * model can be REAL_INFERENCE_VERIFIED while TARGET_HARDWARE_VERIFIED=false
 * and CLINICAL_EVIDENCE_AVAILABLE=false).
 *
 * The values below are audit data for the current environment
 * (re-audited 2026-09-30, Phase 8). Each state is backed by a named
 * evidence artifact; the contract test (tests/unit/engines-registry-
 * metadata.test.ts) pins this table against the capability matrix and the
 * committed inference-evidence JSON so nothing drifts silently.
 */

import { CAPABILITY_MATRIX, engineForModality } from './capability-matrix'

// ---------------------------------------------------------------------------
// §6 — evidence states (never collapsed)
// ---------------------------------------------------------------------------

export const ENGINE_EVIDENCE_STATES = [
  'DISCOVERED',
  'ARTIFACT_VERIFIED',
  'RUNTIME_VERIFIED',
  'REAL_INFERENCE_VERIFIED',
  'TARGET_HARDWARE_VERIFIED',
  'CLINICAL_EVIDENCE_AVAILABLE',
  'UNAVAILABLE',
  'BLOCKED',
] as const
export type EngineEvidenceState = (typeof ENGINE_EVIDENCE_STATES)[number]

export const ENGINE_AVAILABILITY = [
  'AVAILABLE',
  'PARTIAL',
  'RESOURCE_BLOCKED',
  'UNAVAILABLE',
  'BLOCKED',
] as const
export type EngineAvailability = (typeof ENGINE_AVAILABILITY)[number]

/**
 * Per-engine evidence profile: each state is independent. `evidenceRef`
 * points at the artifact that justifies the state (a report file, an audit
 * md, or a named absence).
 */
export interface EngineEvidenceProfile {
  discovered: boolean
  artifactVerified: boolean
  runtimeVerified: boolean
  realInferenceVerified: boolean
  targetHardwareVerified: boolean
  clinicalEvidenceAvailable: boolean
  availability: EngineAvailability
  /** Exact blocker when availability is not AVAILABLE/PARTIAL. */
  blocker: string | null
  lastVerifiedAt: string
}

// ---------------------------------------------------------------------------
// §5 — full registry metadata
// ---------------------------------------------------------------------------

export interface EngineRegistryEntry {
  engineId: string
  name: string
  version: string
  tasks: string[]
  modality: string
  domain: 'DENTAL'
  runtime: string
  device: 'cpu'
  status: EngineEvidenceProfile
  availability: EngineAvailability
  weightSource: string
  weightVersion: string
  weightSha256: string
  weightSizeBytes: number
  artifactProvenance: string
  inputContract: string
  outputContract: string
  resourceRequirements: { cpuOnly: true; ramGb: number | null; note: string }
  latencyEvidence: { coldMs: number | null; warmMedianMs: number | null; env: string; ref: string }
  memoryEvidence: { peakRssMb: number | null; env: string; ref: string }
  clinicalEvidence: { available: boolean; ref: string }
  limitations: string[]
  failureModes: string[]
  securityConstraints: string[]
  licenseMetadata: { license: string; commercialUse: boolean; note?: string }
  verificationStatus: string
  lastVerifiedAt: string
}

// ---------------------------------------------------------------------------
// The table (audit of 2026-09-30 — Phase 8 re-validation pass)
// ---------------------------------------------------------------------------

const A = '2026-09-30'

export const ENGINE_REGISTRY: readonly EngineRegistryEntry[] = [
  {
    engineId: 'liodon',
    name: 'Liodon Dental Panoramic Detector',
    version: '1.0.0',
    tasks: ['panoramic_caries_detection', 'panoramic_impacted_tooth_detection'],
    modality: 'PANORAMIC',
    domain: 'DENTAL',
    runtime: 'onnxruntime',
    device: 'cpu',
    status: {
      discovered: true,
      artifactVerified: false, // SHA pinned from the HF registry; the artifact itself is not in the validation env
      runtimeVerified: true, // engine container + health gate built and mechanism-tested
      realInferenceVerified: false,
      targetHardwareVerified: false,
      clinicalEvidenceAvailable: false,
      availability: 'BLOCKED',
      blocker: 'weights (best.onnx, SHA 4cee38b5…) publish only on Hugging Face — unreachable from the validation environment; operator-verified path exists (ai-validation/liodon)',
      lastVerifiedAt: A,
    },
    availability: 'BLOCKED',
    weightSource: 'https://huggingface.co/liodon-ai/dental-panoramic-detector@8bef2036b099e80e51f93f24de4b0c0edd366256',
    weightVersion: '8bef2036b099e80e51f93f24de4b0c0edd366256',
    weightSha256: '4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71',
    weightSizeBytes: 10_605_711,
    artifactProvenance: 'ai-validation/liodon/MODEL_PROVENANCE.md (read from the publisher registry 2026-09-17)',
    inputContract: 'JPEG/PNG panoramic dental X-ray → (1,3,640,640) tensor',
    outputContract: 'findings: bounding boxes; classes {0:caries, 1:periapical_lesion, 2:impacted_tooth}',
    resourceRequirements: { cpuOnly: true, ramGb: null, note: 'ONNX CPU session; small model (10.6 MB)' },
    latencyEvidence: { coldMs: null, warmMedianMs: null, env: 'NOT_MEASURED (weights absent)', ref: 'ai-validation/liodon/README.md' },
    memoryEvidence: { peakRssMb: null, env: 'NOT_MEASURED (weights absent)', ref: 'ai-validation/liodon/README.md' },
    clinicalEvidence: { available: false, ref: 'publisher model card (no validation study published)' },
    limitations: [
      'panoramic modality only',
      '3 classes — no severity, no measurement',
      'CC-BY-NC-4.0 (non-commercial)',
    ],
    failureModes: [
      'STANDIN_REJECTED (synthetic onnx refused by the health gate)',
      'PROVENANCE_MISMATCH (checksum gate)',
      'ORCHESTRATOR_UNREACHABLE',
    ],
    securityConstraints: [
      'model path is registry-pinned (never scanned from disk)',
      'checksum = identity; mismatch = different model',
      'stand-in artifacts are detected and refused',
    ],
    licenseMetadata: { license: 'CC-BY-NC-4.0', commercialUse: false, note: 'non-commercial — deployment policy must respect this' },
    verificationStatus: 'RUNTIME_VERIFIED (no real-inference evidence without the weights)',
    lastVerifiedAt: A,
  },
  {
    engineId: 'meshsegnet-max',
    name: 'MeshSegNet (maxilla) — 15-class dental surface segmentation',
    version: '1.0.0',
    tasks: ['dental_mesh_segmentation', 'cbct_surface_segmentation'],
    modality: 'THREE_D_SCAN',
    domain: 'DENTAL',
    runtime: 'torch (CPU)',
    device: 'cpu',
    status: {
      discovered: true,
      artifactVerified: true, // SHA-256 verified from the official repository in the validation env
      runtimeVerified: true,
      realInferenceVerified: true,
      targetHardwareVerified: false, // run on the validation sandbox, not the i9-13900H target
      clinicalEvidenceAvailable: false,
      availability: 'AVAILABLE',
      blocker: null,
      lastVerifiedAt: A,
    },
    availability: 'AVAILABLE',
    weightSource: 'https://github.com/Tai-Hsien/MeshSegNet@master (models/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip)',
    weightVersion: 'master@72samples_lr1e-2_best',
    weightSha256: '727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2',
    weightSizeBytes: 28_860_102,
    artifactProvenance: 'ai-validation/meshsegnet/MODEL_PROVENANCE.md (official repository, SHA-verified 2026-09-29)',
    inputContract: 'triangular surface mesh (obj/stl/vtk/ply), millimetre units, ≤10,000 cells (official decimation rule)',
    outputContract: 'segments: per-cell class histogram, 15 classes (Gingiva + Tooth_1..14, neutral names)',
    resourceRequirements: { cpuOnly: true, ramGb: 4, note: 'measured peak on the validation sandbox (2 vCPU / ~3.9 GB host)' },
    latencyEvidence: { coldMs: null, warmMedianMs: null, env: 'SANDBOX (validation machine, not target)', ref: 'ai-validation/meshsegnet/reports/phase5_benchmark_summary.json' },
    memoryEvidence: { peakRssMb: null, env: 'SANDBOX', ref: 'ai-validation/meshsegnet/reports/phase5_benchmark_summary.json' },
    clinicalEvidence: { available: false, ref: 'no clinical validation study — decision support only' },
    limitations: [
      'surface-mesh model — a CBCT volume must be surfaced first (raw-volume segmentation is NOT claimed)',
      'neutral class names (no official label→tooth map is published)',
      'jaw is fixed per engine (maxilla)',
    ],
    failureModes: ['PROVENANCE_MISMATCH', 'MODALITY_MISMATCH (volume input)', 'TIMEOUT (large meshes)'],
    securityConstraints: ['checksum-verified weights', 'model path pinned', 'output schema validated server-side'],
    licenseMetadata: { license: 'MIT', commercialUse: true },
    verificationStatus: 'REAL_INFERENCE_VERIFIED (Phase 5/6 evidence; target hardware not verified)',
    lastVerifiedAt: A,
  },
  {
    engineId: 'meshsegnet-man',
    name: 'MeshSegNet (mandible) — 15-class dental surface segmentation',
    version: '1.0.0',
    tasks: ['dental_mesh_segmentation_mandible'],
    modality: 'THREE_D_SCAN',
    domain: 'DENTAL',
    runtime: 'torch (CPU)',
    device: 'cpu',
    status: {
      discovered: true,
      artifactVerified: true,
      runtimeVerified: true,
      realInferenceVerified: true,
      targetHardwareVerified: false,
      clinicalEvidenceAvailable: false,
      availability: 'AVAILABLE',
      blocker: null,
      lastVerifiedAt: A,
    },
    availability: 'AVAILABLE',
    weightSource: 'https://github.com/Tai-Hsien/MeshSegNet@master (models/MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip)',
    weightVersion: 'master@72samples_lr1e-2_best',
    weightSha256: 'd74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf',
    weightSizeBytes: 28_866_886,
    artifactProvenance: 'ai-validation/meshsegnet/MODEL_PROVENANCE.md (official repository, SHA-verified 2026-09-29)',
    inputContract: 'triangular surface mesh (obj/stl/vtk/ply), millimetre units, ≤10,000 cells',
    outputContract: 'segments: per-cell class histogram, 15 classes (neutral names)',
    resourceRequirements: { cpuOnly: true, ramGb: 4, note: 'same class as meshsegnet-max (separate weights, separate run)' },
    latencyEvidence: { coldMs: null, warmMedianMs: null, env: 'SANDBOX (validation machine, not target)', ref: 'ai-validation/meshsegnet/reports/phase5_benchmark_summary.json' },
    memoryEvidence: { peakRssMb: null, env: 'SANDBOX', ref: 'ai-validation/meshsegnet/reports/phase5_benchmark_summary.json' },
    clinicalEvidence: { available: false, ref: 'no clinical validation study — decision support only' },
    limitations: ['surface-mesh model (CBCT must be surfaced)', 'neutral class names', 'jaw is fixed per engine (mandible)'],
    failureModes: ['PROVENANCE_MISMATCH', 'MODALITY_MISMATCH (volume input)', 'TIMEOUT'],
    securityConstraints: ['checksum-verified weights', 'model path pinned', 'output schema validated server-side'],
    licenseMetadata: { license: 'MIT', commercialUse: true },
    verificationStatus: 'REAL_INFERENCE_VERIFIED (Phase 5/6 evidence; target hardware not verified)',
    lastVerifiedAt: A,
  },
  {
    engineId: 'implant-ai',
    name: 'Implant AI — YOLOv8-seg dental radiograph findings (8 classes)',
    version: '1.0.0',
    tasks: ['periapical_lesion_detection', 'bitewing_caries_detection', 'implant_detection'],
    modality: 'PERIAPICAL',
    domain: 'DENTAL',
    runtime: 'ultralytics 8.4.155 (restricted loader) / torch (CPU)',
    device: 'cpu',
    status: {
      discovered: true,
      artifactVerified: false, // operator-verified SHA; the artifact is HF-only
      runtimeVerified: true,
      realInferenceVerified: false,
      targetHardwareVerified: false,
      clinicalEvidenceAvailable: false,
      availability: 'BLOCKED',
      blocker: 'weights (8024.pt, SHA e7cc1377…) publish only on Hugging Face — unreachable from the validation environment; operator-verified SHA recorded',
      lastVerifiedAt: A,
    },
    availability: 'BLOCKED',
    weightSource: 'https://huggingface.co/nsitnov/8024-yolov8-model@0304179670f4838bf0dec1053b963112a16a66cf (8024.pt)',
    weightVersion: '0304179670f4838bf0dec1053b963112a16a66cf',
    weightSha256: 'e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98',
    weightSizeBytes: 143_955_443,
    artifactProvenance: 'ai-validation/yolov8-8024/AUDIT.md (class labels read from the checkpoint bytes; SHA from the HF registry)',
    inputContract: 'JPEG/PNG dental X-ray (periapical / bitewing) → (1,3,640,640)',
    outputContract: 'findings: instance masks; 8 classes (Caries, Crown, Filling, Implant, Missing teeth, Periapical lesion, Root Piece, Root canal obturation — the file\u2019s own labels)',
    resourceRequirements: { cpuOnly: true, ramGb: null, note: 'YOLOv8-seg CPU inference; 144 MB checkpoint' },
    latencyEvidence: { coldMs: null, warmMedianMs: null, env: 'NOT_MEASURED (weights absent)', ref: 'ai-validation/yolov8-8024/AUDIT.md' },
    memoryEvidence: { peakRssMb: null, env: 'NOT_MEASURED (weights absent)', ref: 'ai-validation/yolov8-8024/AUDIT.md' },
    clinicalEvidence: { available: false, ref: 'no validation study published with the checkpoint' },
    limitations: [
      '2D radiographs only (periapical/bitewing)',
      'instance masks — no measurement, no diagnosis',
      'restricted loader: ultralytics 8.4.155 (AGPL-3.0) — license boundary recorded',
    ],
    failureModes: ['STANDIN_REJECTED', 'PROVENANCE_MISMATCH', 'ORCHESTRATOR_UNREACHABLE', 'MODALITY_MISMATCH (panoramic)'],
    securityConstraints: ['checksum-verified weights', 'restricted loader pins the version', 'class labels come from the checkpoint bytes, never the model card'],
    licenseMetadata: { license: 'Apache-2.0 (weights); ultralytics 8.4.155 loader AGPL-3.0', commercialUse: false, note: 'AGPL loader boundary — ai-validation/yolov8-8024/AUDIT.md' },
    verificationStatus: 'RUNTIME_VERIFIED (no real-inference evidence without the weights)',
    lastVerifiedAt: A,
  },
  {
    engineId: 'orthodontic-ai',
    name: 'Orthodontic AI — 38 cephalometric landmarks (CLDetection2023)',
    version: '1.0.0',
    tasks: ['cephalometric_landmark_detection', 'orthodontic_analysis'],
    modality: 'CEPHALOMETRIC',
    domain: 'DENTAL',
    runtime: 'mmpose 1.0.0 fork / mmcv-lite 2.1.0 / mmengine 0.10.7 / torch (CPU)',
    device: 'cpu',
    status: {
      discovered: true,
      artifactVerified: false, // operator-verified SHA; the checkpoint is Google-Drive-only
      runtimeVerified: true, // control run (random weights) proved the mechanism end-to-end
      realInferenceVerified: false,
      targetHardwareVerified: false,
      clinicalEvidenceAvailable: false,
      availability: 'BLOCKED',
      blocker: 'the real checkpoint (SHA fb1a781a…, 268,846,952 bytes) is distributed via Google Drive — unreachable from the validation environment; no real-weight output exists',
      lastVerifiedAt: A,
    },
    availability: 'BLOCKED',
    weightSource: 'https://github.com/5k5000/CLdetection2023@18d17d1934970016e7610c4849311900b8d1f191 (model/model_pretrained_on_train_and_val.pth)',
    weightVersion: '18d17d1934970016e7610c4849311900b8d1f191',
    weightSha256: 'fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc',
    weightSizeBytes: 268_846_952,
    artifactProvenance: 'ai-validation/cldetection2023/AUDIT.md (globals resolved with the mandated sequence; control run report committed)',
    inputContract: 'JPEG/PNG lateral cephalometric X-ray (whole-image, per the repository\u2019s own validation loop)',
    outputContract: 'landmarks: 38 cephalometric landmarks (numeric ids — no official anatomical label map is published)',
    resourceRequirements: { cpuOnly: true, ramGb: 4, note: 'control run: 1.82 GB peak (random weights, same architecture)' },
    latencyEvidence: { coldMs: null, warmMedianMs: null, env: 'SANDBOX (control run only — random weights, NOT model output)', ref: 'ai-validation/cldetection2023/reports/engine6_control_run.json' },
    memoryEvidence: { peakRssMb: 1820, env: 'SANDBOX (control run)', ref: 'ai-validation/cldetection2023/reports/engine6_control_run.json' },
    clinicalEvidence: { available: false, ref: 'no clinical validation study — landmarks only, interpretation stays with the clinician' },
    limitations: [
      'landmarks only — no angular measurements, no diagnosis',
      'numeric landmark ids (no published label map — never invented names)',
      'lateral cephalograms only',
    ],
    failureModes: ['PROVENANCE_MISMATCH', 'weights_only loader failure (bounded safe-globals allow-list)', 'ORCHESTRATOR_UNREACHABLE'],
    securityConstraints: [
      'torch.load with weights_only + bounded safe-globals allow-list (diagnostics committed)',
      'checksum-verified checkpoint identity',
      'restricted loader: mmcv-lite fork',
    ],
    licenseMetadata: { license: 'Apache-2.0 (repository)', commercialUse: true, note: 'checkpoint distribution is Google Drive (operator account)' },
    verificationStatus: 'RUNTIME_VERIFIED (mechanism only — no real-weight inference)',
    lastVerifiedAt: A,
  },
]

// ---------------------------------------------------------------------------
// §4.4/§4.5/§4.7 — candidates investigated in Phase 8 but NOT registered
// (honest states; they never appear in the live registry)
// ---------------------------------------------------------------------------

export interface EngineCandidate {
  candidateId: string
  name: string
  family: '2D_DENTAL' | 'PANORAMIC' | 'INTRAORAL_PHOTO' | 'CBCT' | 'DENTAL_VLM' | 'IMPLANT' | 'ORTHODONTIC' | '3D_DENTAL'
  classification: 'AVAILABLE' | 'PARTIAL' | 'RESOURCE_BLOCKED' | 'UNAVAILABLE' | 'BLOCKED'
  evidence: string
  blocker: string
}

export const ENGINE_CANDIDATES: readonly EngineCandidate[] = [
  {
    candidateId: 'dentalgemma-1.5-4b-it',
    name: 'DentalGemma 1.5 4B IT (MedGemma dental fine-tune, llama.cpp)',
    family: 'DENTAL_VLM',
    classification: 'RESOURCE_BLOCKED',
    evidence: 'ai-validation/dentalgemma (lab prepared: MODEL_PROVENANCE.md, runner, report schema, tests) — status UNKNOWN, never run',
    blocker: 'GGUF weights (3.47 GiB, git-ignored) absent from the repository; Hugging Face unreachable from the validation environment; no target-hardware (i9-13900H/16 GB) run exists',
  },
  {
    candidateId: 'toothfairy2-cbct',
    name: 'ToothFairy2 — CBCT multi-structure segmentation (42 classes, nnU-Net)',
    family: 'CBCT',
    classification: 'BLOCKED',
    evidence: 'ai-validation/toothfairy2 (lab prepared: audit, compatibility, checkpoint verification scripts) — status BLOCKED, never run',
    blocker: 'REAL_INPUT_REQUIRES_USER_AUTHENTICATION — the compatible volume route (ToothFairy4) requires an account and publishes no unauthenticated case; re-tested 2026-09-30 (still gated)',
  },
  {
    candidateId: 'generic-cv-intraoral',
    name: 'Generic computer-vision models for intraoral photography',
    family: 'INTRAORAL_PHOTO',
    classification: 'UNAVAILABLE',
    evidence: 'Phase 8 investigation 2026-09-30',
    blocker: 'no pretrained intraoral-dental model with verifiable weights in reachable sources — generic CV is excluded by policy (no dental capability claim without dental evidence)',
  },
]

// ---------------------------------------------------------------------------
// Lookup + consistency helpers (consumed by tests and the report)
// ---------------------------------------------------------------------------

export function getEngineEntry(engineId: string): EngineRegistryEntry | null {
  return ENGINE_REGISTRY.find((e) => e.engineId === engineId) ?? null
}

/** Every registered engine id (must match the orchestrator registry). */
export const ENGINE_REGISTRY_IDS: readonly string[] = ENGINE_REGISTRY.map((e) => e.engineId)

/**
 * Contract invariants (asserted by tests/unit/engines-registry-metadata):
 *  - every registry task exists in the capability matrix with the same engine
 *  - every matrix engine with a row exists in this table
 *  - SHA-256 is always 64 hex chars
 *  - modality lookup stays pure (engineForModality)
 */
export function matrixConsistencyIssues(): string[] {
  const issues: string[] = []
  for (const e of ENGINE_REGISTRY) {
    for (const task of e.tasks) {
      const row = CAPABILITY_MATRIX.find((r) => r.task === task)
      if (!row) {
        issues.push(`${e.engineId}: task '${task}' missing from the capability matrix`)
        continue
      }
      if (row.engine !== e.engineId) {
        issues.push(`${e.engineId}: task '${task}' maps to engine '${row.engine}' in the matrix`)
      }
    }
    if (!/^[0-9a-f]{64}$/.test(e.weightSha256)) {
      issues.push(`${e.engineId}: weightSha256 is not 64 hex chars`)
    }
    if (e.device !== 'cpu') issues.push(`${e.engineId}: device must be cpu`)
  }
  const matrixEngines = new Set(CAPABILITY_MATRIX.map((r) => r.engine).filter((e): e is string => e !== null))
  for (const id of ENGINE_REGISTRY_IDS) {
    if (!matrixEngines.has(id)) issues.push(`${id}: registered but absent from the capability matrix`)
  }
  return issues
}

/** Phase 8 §3 — the modality→engine selection stays a pure lookup. */
export { engineForModality }

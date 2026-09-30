/**
 * Phase 6 — Multimodal Dental AI: canonical contracts.
 *
 * One attachment contract (§7), one modality taxonomy (§6/§10), one result
 * envelope (§19), one error taxonomy (§35), one set of finding types (§20).
 *
 * Evidence discipline (§18): capability states are recorded as separate
 * levels — INGESTION / PREPROCESSING / AI_ANALYSIS / REAL_INFERENCE — so
 * "a file uploaded" can never be reported as "AI analyzed it".
 *
 * Trust discipline (§8/§9): every field that describes an attachment is
 * SERVER-derived (magic-byte MIME, computed checksum, sanitized filename).
 * Client-supplied values are hints at best and are never trusted.
 */

// ---------------------------------------------------------------------------
// Attachment contract (§7)
// ---------------------------------------------------------------------------

/** Deterministic file classes from magic-byte inspection (§10). */
export const MULTIMODAL_FILE_CLASSES = [
  'IMAGE_2D',
  'MESH_3D',
  'DOCUMENT_PDF',
  'DOCUMENT_TEXT',
  'VOLUME_DICOM',
  'UNKNOWN',
] as const
export type MultimodalFileClass = (typeof MULTIMODAL_FILE_CLASSES)[number]

/** Processing lifecycle — each transition is server-side and auditable. */
export const ATTACHMENT_STATUSES = ['RECEIVED', 'VALIDATED', 'PROCESSED', 'FAILED'] as const
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number]

/** Where the bytes came from. All sources are UNTRUSTED content. */
export const ATTACHMENT_SOURCES = ['CHAT_UPLOAD', 'CLINIC_DOCUMENT', 'SYSTEM'] as const
export type AttachmentSource = (typeof ATTACHMENT_SOURCES)[number]

/**
 * Dental sub-modality for 2D images (§11): CLASSIFIED when the value comes
 * from trusted metadata (a linked ImagingStudy or an uploader declaration by
 * a staff role), PROBABLE never exists without a validated classifier (we
 * have none — reported honestly), UNKNOWN_DENTAL_IMAGE when no reliable
 * classification is possible.
 */
export const DENTAL_IMAGE_STATES = ['CLASSIFIED', 'UNKNOWN_DENTAL_IMAGE'] as const
export type DentalImageState = (typeof DENTAL_IMAGE_STATES)[number]

/**
 * How a dental modality was established. Only `STUDY` is metadata-trusted;
 * `DECLARED` is the uploader's own assertion (staff roles only — the same
 * trust model as the existing imaging upload flow); `NONE` = unknown.
 */
export const MODALITY_ORIGINS = ['STUDY', 'DECLARED', 'NONE'] as const
export type ModalityOrigin = (typeof MODALITY_ORIGINS)[number]

/** The canonical attachment row (mirrors the MultimodalAttachment model). */
export interface AttachmentRecord {
  id: string
  hospitalId: string
  /** Server-resolved patient; null = conversation-scoped, NOT patient-attributed. */
  patientId: string | null
  caseId: string | null
  conversationId: string | null
  /** Sanitized display name (the original name is DATA, never a path). */
  originalName: string
  /** Server-generated storage name (uuid.ext) — the only address used internally. */
  fileName: string
  /** Server-detected MIME (magic bytes) — never the client value. */
  mediaType: string
  fileClass: MultimodalFileClass
  /** StudyModality value when reliably established (STUDY or DECLARED), else null. */
  dentalModality: string | null
  modalityOrigin: ModalityOrigin
  dentalImageState: DentalImageState | null
  size: number
  /** SHA-256 over the exact stored bytes. Identity, not metadata. */
  sha256: string
  /** Canonical tenant-prefixed storage key (NEVER exposed to clients verbatim). */
  storageKey: string
  source: AttachmentSource
  status: AttachmentStatus
  failureCode: string | null
  /** Image geometry (server-measured at processing). */
  width: number | null
  height: number | null
  pixelCount: number | null
  /** Document processing. */
  pageCount: number | null
  /** Storage key of the extracted, bounded, UNTRUSTED text (documents only). */
  extractedTextKey: string | null
  /** Linked imaging study when one was created for this attachment. */
  studyId: string | null
  /** Machine-readable provenance (§34). */
  provenance: AttachmentProvenance | null
  createdAt: Date
  updatedAt: Date
}

export interface AttachmentProvenance {
  /** Which preprocessing version produced the derivatives (if any). */
  preprocessVersion: string | null
  /** original → derivative checksum chain. */
  derivatives: { key: string; kind: string; sha256: string }[]
  /** Upload pipeline version. */
  pipelineVersion: string
  receivedAt: string
  validatedAt: string | null
  processedAt: string | null
}

/**
 * What the Agent/UI may ever see about an attachment: identity + metadata,
 * never the raw storage key, never the original filename bytes.
 */
export interface AttachmentRef {
  id: string
  originalName: string
  mediaType: string
  fileClass: MultimodalFileClass
  size: number
  dentalModality: string | null
  modalityOrigin: ModalityOrigin
  dentalImageState: DentalImageState | null
  status: AttachmentStatus
  patientId: string | null
  studyId: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Capability levels (§18 — separate states, never conflated)
// ---------------------------------------------------------------------------

export type CapabilityLevel =
  | 'INGESTION_SUPPORTED'
  | 'PREPROCESSING_SUPPORTED'
  | 'AI_ANALYSIS_SUPPORTED'
  | 'REAL_INFERENCE_VERIFIED'

/**
 * The honest capability record for a (fileClass, dentalModality) pair —
 * computed from the Phase 5 matrix + pipeline facts. UI/Agent must render
 * these levels, not a single boolean.
 */
export interface ModalityCapability {
  fileClass: MultimodalFileClass
  dentalModality: string | null
  ingestion: CapabilityLevel | 'INGESTION_UNSUPPORTED'
  preprocessing: CapabilityLevel | 'PREPROCESSING_UNSUPPORTED'
  aiAnalysis: CapabilityLevel | 'AI_ANALYSIS_UNSUPPORTED'
  engine: string | null
  reason: string
}

// ---------------------------------------------------------------------------
// Normalized multimodal result (§19/§20)
// ---------------------------------------------------------------------------

/** Finding geometry types — model-specific raw data stays behind these. */
export const FINDING_TYPES = [
  'BOUNDING_BOX',
  'POLYGON',
  'SEGMENTATION',
  'LANDMARK',
  'MEASUREMENT',
  'CLASSIFICATION',
  'REGION',
  'UNKNOWN',
] as const
export type FindingType = (typeof FINDING_TYPES)[number]

export interface NormalizedMultimodalFinding {
  type: FindingType
  /** Neutral condition/label (engine vocabulary — never a diagnosis). */
  label: string
  confidence: number | null
  /** Typed geometry per type (box/polygon/landmark/segment-row/...). */
  geometry: Record<string, unknown>
  /** Present only when the engine attributes a tooth — never invented. */
  toothFdi: number | null
}

export type ReviewState = 'PENDING_REVIEW' | 'REVIEWED' | 'REVIEW_ACCEPTED' | 'REVIEW_REJECTED'

/**
 * The canonical multimodal result envelope. A finding is a FINDING:
 * there is deliberately NO diagnosis field (§19/§22).
 */
export interface MultimodalResultEnvelope {
  resultId: string
  patientId: string | null
  caseId: string | null
  attachmentIds: string[]
  modality: string | null
  engine: string
  modelVersion: string | null
  weightsChecksum: string
  findings: NormalizedMultimodalFinding[]
  topConfidence: number | null
  /** Fixed honesty statement — model calibration, not clinical certainty. */
  uncertainty: string
  provenance: {
    jobId: string
    engine: string
    modelChecksum: string
    modelSource: string
    device: string
    runtime: string
    processingTimeMs: number
    inputSha256: string
    timestamp: string
  }
  reviewState: ReviewState
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Before/after comparison (§15)
// ---------------------------------------------------------------------------

export interface AttachmentComparison {
  attachmentA: AttachmentRef
  attachmentB: AttachmentRef
  /** Observable metadata differences (sizes, dimensions, dates, counts). */
  observedDifferences: string[]
  /** Engine-level finding differences, per attachment (when both analyzed). */
  modelDifferences: { attachmentId: string; label: string; confidence: number | null }[]
  /** ALWAYS 'NOT_DETERMINED' in Phase 6 — clinical interpretation is
   *  exclusively a clinician act. Never auto-conclude "treatment succeeded". */
  clinicalInterpretation: 'NOT_DETERMINED'
  uncertainty: string
}

// ---------------------------------------------------------------------------
// Error taxonomy (§35) — typed, PHI-free, no infrastructure leakage
// ---------------------------------------------------------------------------

export const MULTIMODAL_ERRORS = [
  'UNSUPPORTED_MODALITY',
  'INVALID_FILE',
  'INVALID_FORMAT',
  'OVERSIZED_INPUT',
  'PATH_TRAVERSAL_REJECTED',
  'MIME_MISMATCH',
  'PATIENT_SCOPE_MISMATCH',
  'TENANT_SCOPE_MISMATCH',
  'FORGED_ATTACHMENT_ID',
  'CAPABILITY_UNAVAILABLE',
  'ENGINE_UNAVAILABLE',
  'WEIGHTS_UNAVAILABLE',
  'ORCHESTRATOR_UNREACHABLE',
  'PREPROCESSING_FAILED',
  'INFERENCE_FAILED',
  'INFERENCE_TIMEOUT',
  'OUTPUT_INVALID',
  'REVIEW_REQUIRED',
  'DOCUMENT_EXTRACTION_FAILED',
] as const
export type MultimodalErrorCode = (typeof MULTIMODAL_ERRORS)[number]

export class MultimodalError extends Error {
  constructor(
    readonly code: MultimodalErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MultimodalError'
  }
}

// ---------------------------------------------------------------------------
// Preprocessing (§12) — original is immutable; derivatives carry provenance
// ---------------------------------------------------------------------------

export const PREPROCESS_VERSION = 'p6-v1'

export interface PreprocessResult {
  /** The ORIGINAL key is never rewritten. */
  originalKey: string
  originalSha256: string
  /** Server-measured geometry of the original. */
  width: number
  height: number
  pixelCount: number
  /** Derivative keys (model-input normalization) — empty when not applicable. */
  derivatives: { key: string; kind: string; sha256: string; width: number; height: number }[]
  version: string
}

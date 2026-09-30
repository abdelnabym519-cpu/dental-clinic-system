/**
 * Phase 6 — resource limits (§32). Explicit, typed, enforced server-side.
 * Every limit violation is an OVERSIZED_INPUT / INVALID_FILE failure —
 * never a hang, never a partial process.
 */

export const MULTIMODAL_LIMITS = {
  /** Max bytes per uploaded file, by file class (checked BEFORE full read). */
  maxBytes: {
    IMAGE_2D: 50 * 1024 * 1024, // mirrors the existing imaging upload limit
    MESH_3D: 200 * 1024 * 1024, // mirrors Phase 20B mesh upload
    DOCUMENT_PDF: 20 * 1024 * 1024,
    DOCUMENT_TEXT: 1 * 1024 * 1024,
    VOLUME_DICOM: 500 * 1024 * 1024, // stored, not parsed (no DICOM parser in Phase 6)
    UNKNOWN: 10 * 1024 * 1024,
  },
  /** Max decoded pixel count (guards decompression/pixel bombs). */
  maxPixelCount: 40_000_000,
  /** Max mesh cell count accepted for engine routing (the engine itself
   *  decimates to its official cap — this rejects pathological files early). */
  maxMeshCells: 5_000_000,
  /** Document extraction bounds. */
  maxPdfPages: 200,
  maxExtractedTextChars: 200_000,
  /** Max attachments per agent request (§14 structured attachment sets). */
  maxAttachmentsPerRequest: 4,
  /** Original name (display) length after sanitization. */
  maxOriginalNameLen: 200,
  /** Agent-facing extraction context budget (minimum necessary, §45). */
  maxAgentContextCharsPerAttachment: 8_000,
  /** Processing budget for one attachment (validation+preprocess+extraction). */
  processingTimeoutMs: 30_000,
  /** Inference budget: the orchestrator enforces its own; this is the agent
   *  tool timeout for one analyze_attachment call (Phase 5 mesh runs are
   *  ~12 s cold on sandbox hardware; 120 s is a wide, explicit bound). */
  analyzeTimeoutMs: 120_000,
} as const

export type FileClassLimitKey = 'IMAGE_2D' | 'MESH_3D' | 'DOCUMENT_PDF' | 'DOCUMENT_TEXT' | 'VOLUME_DICOM' | 'UNKNOWN'

export function maxBytesFor(fileClass: FileClassLimitKey): number {
  return MULTIMODAL_LIMITS.maxBytes[fileClass]
}

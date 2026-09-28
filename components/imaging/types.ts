// Phase 20 (D5/D7) — shared imaging types for the UI.
// Phase 19B (D14/D15) — extended to the three engines' result shapes:
//
//   Liodon / Implant AI  → box findings (original-image pixel coordinates,
//                          `coordinate_space: "original_image"`)
//   Orthodontic AI       → landmark findings (the 38 cephalometric points in
//                          the CROPPED original's pixel space — the
//                          repository's zero-padding crop trims the
//                          bottom/right only, so the top-left origin is
//                          unchanged and (x, y) place directly on the
//                          original image)
//   MeshSegNet           → segment findings (the 15-class per-cell histogram;
//                          3D input, no boxes)
//
// The wire contract is owned by the orchestrator
// (ai/orchestrator/app/validation.py); these types mirror it.

export interface FindingBoundingBox {
  x: number
  y: number
  width: number
  height: number
  x2: number
  y2: number
  coordinate_space?: string
  units?: string
}

export interface ImagingBoxFinding {
  condition: string
  tooth_number: number | string | null
  confidence: number
  bounding_box: FindingBoundingBox
}

export interface ImagingLandmarkFinding {
  landmark_id: number
  landmark_name: string
  x: number
  y: number
  score: number | null
  coordinate_space?: string
}

export interface ImagingSegmentFinding {
  class_id: number
  class_name: string
  point_count: number
}

/** Every finding shape an AI job can carry (19A + 19B). */
export type ImagingFinding =
  | ImagingBoxFinding
  | ImagingLandmarkFinding
  | ImagingSegmentFinding

export function isBoxFinding(f: ImagingFinding): f is ImagingBoxFinding {
  return typeof (f as ImagingBoxFinding).bounding_box === 'object' && (f as ImagingBoxFinding).bounding_box !== null
}

export function isLandmarkFinding(f: ImagingFinding): f is ImagingLandmarkFinding {
  return typeof (f as ImagingLandmarkFinding).landmark_id === 'number'
}

export function isSegmentFinding(f: ImagingFinding): f is ImagingSegmentFinding {
  return typeof (f as ImagingSegmentFinding).point_count === 'number'
}

/**
 * The 0..1 "certainty" a finding carries, for the viewer's minimum-
 * confidence filter: box findings expose confidence, landmarks their score,
 * segments carry none (15-class softmax labels — the 19B rule that no
 * confidence is invented where the model emits none).
 */
export function findingConfidence(f: ImagingFinding): number | null {
  if (isBoxFinding(f)) return f.confidence
  if (isLandmarkFinding(f)) return f.score
  return null
}

export interface ImagingJob {
  id: string
  engine: string
  status: string
  modelVersion: string | null
  modelChecksum: string | null
  processingTimeMs: number | null
  findings: ImagingFinding[] | null
  confidence: number | null
  errorMessage: string | null
  provenance: { annotated_image_key?: string } | null
  reviewedById: string | null
  reviewedAt: string | null
  reviewDecision: 'ACCEPTED' | 'MODIFIED' | 'REJECTED' | null
  reviewNotes: string | null
  acceptedFindings: ImagingFinding[] | null
  reviewedBy: { name: string } | null
  createdAt: string
  completedAt: string | null
}

export interface ImagingStudySummary {
  id: string
  patientId: string | null
  patientName: string | null
  modality: string
  studyType: string
  status: string
  createdAt: string
  originalUrl: string
  latestJob: {
    id: string
    status: string
    engine: string
    reviewedAt: string | null
    findingsCount: number
    reviewedByName: string | null
  } | null
}

export interface ImagingStudyDetail {
  id: string
  patientId: string
  modality: string
  studyType: string
  status: string
  createdAt: string
  studyDate: string | null
  description: string | null
  originalUrl: string
  annotatedUrl: string | null
  patient: { patientId: string; firstName: string; lastName: string } | null
  aiJobs: ImagingJob[]
}

/** Condition → overlay colour (spec D5). */
export const CONDITION_COLORS: Record<string, string> = {
  caries: '#ef4444', // red
  periapical_lesion: '#f97316', // orange
  impacted_tooth: '#8b5cf6', // purple
  // Phase 19B (Implant AI) — the 8 audited checkpoint class labels, same
  // vocabulary the engine reports (never renamed in the UI).
  Caries: '#ef4444',
  Crown: '#3b82f6',
  Filling: '#eab308',
  Implant: '#10b981',
  'Missing teeth': '#6b7280',
  'Periapical lesion': '#f97316',
  'Root Piece': '#a855f7',
  'Root canal obturation': '#14b8a6',
}

/** The single colour of the 38 cephalometric landmark dots (matches the
 * engine's own red overlay, BGR (0,0,255) → #ff0000). */
export const LANDMARK_COLOR = '#ef4444'

export const FALLBACK_COLOR = '#0ea5e9'

export function findingColor(condition: string): string {
  return CONDITION_COLORS[condition] ?? FALLBACK_COLOR
}

/**
 * Derived display status for a study (same rule as the status API endpoint):
 * REVIEWED/ANALYZED pass through; a pending/processing job on an UPLOADED
 * study reads as PROCESSING.
 */
export function derivedStudyStatus(
  studyStatus: string,
  latestJob: { status: string } | null | undefined
): 'UPLOADED' | 'PROCESSING' | 'ANALYZED' | 'REVIEWED' {
  if (studyStatus === 'ANALYZED' || studyStatus === 'REVIEWED') return studyStatus
  if (latestJob && (latestJob.status === 'PENDING' || latestJob.status === 'PROCESSING')) {
    return 'PROCESSING'
  }
  return 'UPLOADED'
}

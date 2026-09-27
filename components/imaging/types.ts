// Phase 20 (D5/D7) — shared imaging types for the UI.
//
// The finding shape mirrors the orchestrator's wire contract (19A):
// Liodon emits bounding boxes in ORIGINAL-IMAGE PIXEL coordinates
// (`coordinate_space: "original_image"`, `units: "pixels"`), and the review
// endpoint's schema enforces the same fields, so the viewer and the review
// panel can share one type.

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

export interface ImagingFinding {
  condition: string
  tooth_number: number | string | null
  confidence: number
  bounding_box: FindingBoundingBox
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
}

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

/**
 * Phase 6 — deterministic modality classification (§10/§11) and the honest
 * capability-level record (§18).
 *
 * Rules:
 * - File class comes from magic bytes (file-signature.ts) — never the client.
 * - Dental sub-modality for 2D images:
 *     STUDY link (trusted metadata)            → CLASSIFIED with the study's modality
 *     uploader declaration by a STAFF role     → CLASSIFIED, origin DECLARED
 *     anything else                            → UNKNOWN_DENTAL_IMAGE
 *   There is NO validated dental-image classifier in this repository, so an
 *   image without trusted metadata is NEVER guessed (§11: report UNKNOWN
 *   instead of inventing a modality).
 * - 3D mesh: DENTAL_3D_MESH via the THREE_D_SCAN modality family (jaw
 *   disambiguation is a separate, optional, validated input — Phase 20B).
 * - DICOM: detected, stored, NOT parsed (no parser in Phase 6) → four-state
 *   separation made explicit in the capability record (§26).
 */

import { resolveCapability, CAPABILITY_MATRIX } from '../engines/capability-matrix'
import type {
  DentalImageState,
  ModalityCapability,
  ModalityOrigin,
  MultimodalFileClass,
} from './types'

export const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT'] as const

/**
 * Establish the dental modality for an attachment.
 * Pure decision function — the caller supplies the (server-verified) facts.
 */
export function classifyDentalModality(input: {
  fileClass: MultimodalFileClass
  /** Modality of a LINKED imaging study (server-resolved; the trusted path). */
  linkedStudyModality: string | null
  /** Uploader's declaration — only honored for staff roles (see caller). */
  declaredModality: string | null
  actorIsStaff: boolean
}): {
  dentalModality: string | null
  modalityOrigin: ModalityOrigin
  dentalImageState: DentalImageState | null
} {
  if (input.fileClass === 'IMAGE_2D') {
    if (input.linkedStudyModality) {
      return {
        dentalModality: input.linkedStudyModality,
        modalityOrigin: 'STUDY',
        dentalImageState: 'CLASSIFIED',
      }
    }
    if (input.actorIsStaff && input.declaredModality && isKnownModality(input.declaredModality)) {
      return {
        dentalModality: input.declaredModality,
        modalityOrigin: 'DECLARED',
        dentalImageState: 'CLASSIFIED',
      }
    }
    // No validated classifier exists — honest UNKNOWN, never a guess.
    return { dentalModality: null, modalityOrigin: 'NONE', dentalImageState: 'UNKNOWN_DENTAL_IMAGE' }
  }
  if (input.fileClass === 'MESH_3D') {
    // Meshes are dental surface geometry; the modality family is THREE_D_SCAN
    // (a CBCT-sourced mesh stays CBCT when trusted metadata says so).
    const declared = input.actorIsStaff && input.declaredModality === 'CBCT' ? 'CBCT' : null
    return {
      dentalModality: declared ?? 'THREE_D_SCAN',
      modalityOrigin: declared ? 'DECLARED' : 'STUDY',
      dentalImageState: null,
    }
  }
  return { dentalModality: null, modalityOrigin: 'NONE', dentalImageState: null }
}

/** The modality vocabulary (mirrors the StudyModality enum). */
const KNOWN_MODALITIES = new Set([
  'PANORAMIC', 'PERIAPICAL', 'BITEWING', 'CBCT', 'THREE_D_SCAN', 'PHOTO', 'CEPHALOMETRIC',
])

function isKnownModality(m: string): boolean {
  return KNOWN_MODALITIES.has(m.toUpperCase())
}

/**
 * Capability tasks per modality — the ONLY bridge from a modality to the
 * Phase 5 matrix (no hard-coded engine selection in the Agent, §17).
 */
const TASK_BY_MODALITY: Record<string, string[]> = {
  PANORAMIC: ['panoramic_caries_detection', 'panoramic_impacted_tooth_detection'],
  PERIAPICAL: ['periapical_lesion_detection'],
  BITEWING: ['bitewing_caries_detection'],
  CEPHALOMETRIC: ['cephalometric_landmark_detection', 'orthodontic_analysis'],
  THREE_D_SCAN: ['dental_mesh_segmentation', 'dental_mesh_segmentation_mandible'],
  CBCT: ['cbct_surface_segmentation', 'cbct_multi_structure_segmentation'],
  PHOTO: [],
}

export function tasksForModality(modality: string | null): string[] {
  if (!modality) return []
  return TASK_BY_MODALITY[modality.toUpperCase()] ?? []
}

/**
 * The honest capability record for a (fileClass, modality) pair (§18).
 * `liveEngineAvailable` comes from the Phase 5 runtime view (orchestrator
 * health) — when the view is unavailable, aiAnalysis reflects the STATIC
 * matrix level and the reason says the live state is unknown (never guessed
 * as available, never guessed as down).
 */
export function capabilityForAttachment(input: {
  fileClass: MultimodalFileClass
  dentalModality: string | null
  /** Engine names that are live+AVAILABLE right now (Phase 5 health view). */
  liveEngines: string[] | null // null = live view unavailable
}): ModalityCapability {
  const { fileClass, dentalModality, liveEngines } = input

  // Ingestion: everything with a recognized signature is stored safely.
  const ingestion = fileClass === 'UNKNOWN' ? 'INGESTION_UNSUPPORTED' as const : 'INGESTION_SUPPORTED' as const

  // Preprocessing: 2D images (jimp pipeline) + documents (bounded extraction).
  const preprocessing =
    fileClass === 'IMAGE_2D' || fileClass === 'DOCUMENT_PDF' || fileClass === 'DOCUMENT_TEXT'
      ? 'PREPROCESSING_SUPPORTED'
      : 'PREPROCESSING_UNSUPPORTED'

  // AI analysis: only through the Phase 5 matrix (capability row + engine).
  let aiAnalysis: ModalityCapability['aiAnalysis'] = 'AI_ANALYSIS_UNSUPPORTED'
  let engine: string | null = null
  let reason: string
  if (fileClass === 'VOLUME_DICOM') {
    reason =
      'DICOM ingestion is detected and stored, but this deployment has no DICOM parser ' +
      '(ingestion ≠ parsing ≠ visualization ≠ AI analysis). CBCT volume AI is not claimed.'
  } else if (fileClass === 'MESH_3D') {
    const task = (dentalModality === 'CBCT' ? 'cbct_surface_segmentation' : 'dental_mesh_segmentation')
    const res = resolveCapability(task, dentalModality ?? undefined)
    const meshEngine = res.ok && res.resolvable && res.task ? res.task.engine : null
    if (meshEngine) {
      engine = meshEngine
      aiAnalysis = liveEngines === null ? 'AI_ANALYSIS_SUPPORTED'
        : liveEngines.includes(meshEngine) ? 'REAL_INFERENCE_VERIFIED'
        : 'AI_ANALYSIS_SUPPORTED'
      reason = liveEngines === null
        ? `Capability row '${task}' resolves to ${meshEngine}; live engine state unknown in this deployment.`
        : liveEngines.includes(meshEngine)
          ? `${meshEngine} is live with verified weights (REAL INFERENCE VERIFIED in this environment).`
          : `${meshEngine} is registered but not currently AVAILABLE (see runtime reason); no analysis is claimed.`
    } else {
      reason = res.ok ? (res.reason ?? 'no engine for this capability') : (res.error ?? 'capability unknown')
    }
  } else if (fileClass === 'IMAGE_2D') {
    if (!dentalModality) {
      reason = 'Dental modality is UNKNOWN_DENTAL_IMAGE — no engine can be selected for an unclassified image (no validated classifier exists; nothing is guessed).'
    } else {
      const tasks = tasksForModality(dentalModality)
      const supported = tasks.flatMap((t) => {
        const r = resolveCapability(t)
        return r.ok && r.resolvable && r.task ? [{ task: r.task }] : []
      })
      if (supported.length === 0) {
        reason =
          dentalModality === 'PHOTO'
            ? 'Clinical photos have no AI engine in this deployment (honest gap).'
            : `No verified local engine for modality ${dentalModality} in this deployment.`
      } else {
        const row = supported[0].task
        const imgEngine = row.engine
        if (!imgEngine) {
          reason = `Capability '${row.task}' has no engine in the registry — no analysis is claimed.`
        } else {
          engine = imgEngine
          aiAnalysis = liveEngines === null ? 'AI_ANALYSIS_SUPPORTED'
            : liveEngines.includes(imgEngine) ? 'REAL_INFERENCE_VERIFIED'
            : 'AI_ANALYSIS_SUPPORTED'
          reason = liveEngines === null
            ? `Capability '${row.task}' resolves to ${imgEngine}; live engine state unknown in this deployment.`
            : liveEngines.includes(imgEngine)
              ? `${imgEngine} is live with verified weights.`
              : `${imgEngine} is registered for ${row.task} but not currently AVAILABLE (weights/runtime not verified here); analysis is not claimed.`
        }
      }
    }
  } else {
    reason =
      fileClass === 'UNKNOWN'
        ? 'Unrecognized file type — nothing is stored as analyzable.'
        : 'Documents are read as text (untrusted content); no document AI engine exists in this deployment.'
  }

  return { fileClass, dentalModality, ingestion, preprocessing, aiAnalysis, engine, reason }
}

/** All capability rows, for the honest capability surface (mirrors Phase 5). */
export function allCapabilityRows() {
  return [...CAPABILITY_MATRIX]
}

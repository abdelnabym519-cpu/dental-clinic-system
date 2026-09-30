/**
 * Local AI — dental task → engine capability matrix (Phase 5, §9).
 *
 * MIRROR of ai/orchestrator/app/capability_matrix.py (the Python side is the
 * source of truth consumed by /engines). tests/unit/engines-capability-matrix.test.ts
 * contract-checks the two against each other on every structured field, so
 * they cannot drift silently.
 *
 * This is PRODUCT POLICY DATA, not a registry: it declares which dental
 * task maps to which registered engine, with the six evidence levels
 * recorded per task. It never selects an engine from free text — selection
 * is a pure (task, modality) lookup (spec §13/§32: the agent must never
 * pick an engine because a name appears in user-provided text).
 */

import type { CapabilityLevels, CapabilityRow, CapabilityResolution } from './types'

const _L = (over: Partial<CapabilityLevels> = {}): CapabilityLevels => ({
  capabilityDeclared: true,
  modelExists: true,
  weightsVerified: false,
  localInferenceVerified: false,
  cpuInferenceVerified: false,
  productionIntegrated: true,
  ...over,
})

function overall(l: CapabilityLevels): CapabilityRow['overall'] {
  if (l.capabilityDeclared && l.modelExists && l.weightsVerified &&
      l.localInferenceVerified && l.cpuInferenceVerified && l.productionIntegrated) {
    return 'SUPPORTED'
  }
  if (!l.capabilityDeclared && !l.modelExists && !l.productionIntegrated) {
    return 'UNAVAILABLE'
  }
  return l.productionIntegrated ? 'PARTIAL' : 'UNVERIFIED'
}

const row = (
  task: string,
  modality: string,
  engine: string | null,
  requiredInput: string,
  outputType: string,
  fallback: string,
  levels: CapabilityLevels,
  note: string,
): CapabilityRow => ({
  task, modality, engine, requiredInput, outputType, fallback,
  humanReview: 'REQUIRED', levels, overall: overall(levels), note,
})

/**
 * Audit of 2026-09-30 (validation sandbox). Structured fields are
 * contract-tested against the orchestrator matrix; `note` carries the
 * evidence pointer (files under ai-validation/**).
 */
export const CAPABILITY_MATRIX: readonly CapabilityRow[] = [
  row(
    'panoramic_caries_detection', 'PANORAMIC', 'liodon',
    'JPEG/PNG panoramic dental X-ray',
    'findings (bounding boxes; caries, periapical_lesion, impacted_tooth)',
    'none — honest unavailable; clinician reads the radiograph',
    _L(),
    'Weights (best.onnx, SHA 4cee38b5…) publish only on Hugging Face — unreachable from the validation environment; operator-verified path exists (ai-validation/liodon).',
  ),
  row(
    'panoramic_impacted_tooth_detection', 'PANORAMIC', 'liodon',
    'JPEG/PNG panoramic dental X-ray',
    'findings (bounding boxes; impacted_tooth)',
    'none — honest unavailable; clinician reads the radiograph',
    _L(),
    'Same engine/weights situation as panoramic_caries_detection.',
  ),
  row(
    'periapical_lesion_detection', 'PERIAPICAL', 'implant-ai',
    'JPEG/PNG periapical radiograph',
    'findings (instance masks; 8 classes incl. Periapical lesion, Caries)',
    'none — honest unavailable; clinician reads the radiograph',
    _L(),
    'Weights (8024.pt, SHA e7cc1377…) publish only on Hugging Face — unreachable from the validation environment; operator-verified SHA recorded.',
  ),
  row(
    'bitewing_caries_detection', 'BITEWING', 'implant-ai',
    'JPEG/PNG bitewing radiograph',
    'findings (instance masks; Caries)',
    'none — honest unavailable; clinician reads the radiograph',
    _L(),
    'Same engine/weights situation as periapical_lesion_detection.',
  ),
  row(
    'dental_mesh_segmentation', 'THREE_D_SCAN', 'meshsegnet-max',
    'triangular surface mesh (obj/stl/vtk/ply), mm units, upper jaw',
    'segments (15-class histogram; gingiva + 14 teeth, neutral names)',
    'meshsegnet-man for mandibular scans; otherwise none — honest unavailable',
    _L({ weightsVerified: true, localInferenceVerified: true, cpuInferenceVerified: true }),
    'Weights SHA-256 verified from the official Tai-Hsien/MeshSegNet repository; real CPU inference evidence: ai-validation/meshsegnet/reports/phase5_real_inference_max.json.',
  ),
  row(
    'dental_mesh_segmentation_mandible', 'THREE_D_SCAN', 'meshsegnet-man',
    'triangular surface mesh (obj/stl/vtk/ply), mm units, lower jaw',
    'segments (15-class histogram; neutral names)',
    'none beyond meshsegnet-max for maxillary scans — honest unavailable',
    _L({ weightsVerified: true, localInferenceVerified: true, cpuInferenceVerified: true }),
    'Same evidence as the maxillary variant (separate weights, separate run: phase5_real_inference_man.json).',
  ),
  row(
    'cbct_surface_segmentation', 'CBCT', 'meshsegnet-max',
    'triangular surface mesh extracted from CBCT (the engine consumes meshes, not volumes)',
    'segments (15 classes, neutral names)',
    'none for raw CBCT volume analysis — volume segmentation has no engine in this repository (deferred)',
    _L({ weightsVerified: true, localInferenceVerified: true, cpuInferenceVerified: true }),
    'MeshSegNet is a surface-mesh model; a CBCT volume must be surfaced first. Raw-volume segmentation is deliberately NOT claimed.',
  ),
  row(
    'cephalometric_landmark_detection', 'CEPHALOMETRIC', 'orthodontic-ai',
    'JPEG/PNG lateral cephalometric X-ray',
    'landmarks (38; numeric ids — no official anatomical label map is published)',
    'none — honest unavailable; clinician measures landmarks',
    _L(),
    'Mechanism proven on a random-weight control run (ai-validation/cldetection2023); the real checkpoint is distributed via Google Drive — unreachable from the validation environment, so no real-weight output exists yet.',
  ),
  row(
    'orthodontic_analysis', 'CEPHALOMETRIC', 'orthodontic-ai',
    'JPEG/PNG lateral cephalometric X-ray',
    'landmarks (38; numeric ids)',
    'none — honest unavailable; clinician analysis',
    _L(),
    'Exposed through the 38-landmark output; no angular measurements or diagnosis are computed — interpretation remains with the clinician.',
  ),
  row(
    'cbct_multi_structure_segmentation', 'CBCT', null,
    'CBCT voxel volume (.nii.gz / .mha)',
    'multi-structure segmentation mask (not implemented)',
    'none — UNAVAILABLE; the ToothFairy-class model is access-gated and has no engine in this repository',
    {
      capabilityDeclared: false, modelExists: false, weightsVerified: false,
      localInferenceVerified: false, cpuInferenceVerified: false,
      productionIntegrated: false,
    },
    'Honest gap (spec §9: do not claim unsupported capabilities). Deferred work — see docs/DENTORA_AI_PHASE5_LOCAL_AI_MODEL_STRATEGY.md §18/§19.',
  ),
  // ── Phase 8 engine-scope rows (2026-09-30 re-audit) ─────────────────────
  row(
    'implant_detection', 'PERIAPICAL', 'implant-ai',
    'JPEG/PNG periapical (or bitewing) radiograph',
    'findings (instance masks; class: Implant — checkpoint class id 3, label read from the checkpoint bytes)',
    'none — honest unavailable; implant PLANNING is not claimed (clinician planning)',
    _L(),
    'Phase 8 re-evaluation: the audited 8024.pt checkpoint (SHA e7cc1377…) detects implants among 8 radiograph classes; weights remain HF-only (unreachable from the validation environment). Same evidence class as periapical_lesion_detection.',
  ),
  row(
    'intraoral_photography_analysis', 'PHOTO', null,
    'JPEG/PNG intraoral photograph',
    'none — no verified dental intraoral model is registered',
    'none — UNAVAILABLE; generic CV is deliberately NOT claimed as dental capability',
    {
      capabilityDeclared: false, modelExists: false, weightsVerified: false,
      localInferenceVerified: false, cpuInferenceVerified: false,
      productionIntegrated: false,
    },
    'Phase 8 investigation (2026-09-30): no CPU/offline pretrained intraoral-dental model with verifiable weights was found in reachable sources; generic image models are excluded by policy (dental relevance + real evidence required).',
  ),
  row(
    'dental_vlm_image_qa', 'PHOTO', null,
    'JPEG/PNG dental image + question',
    'none — candidate only (no registered engine)',
    'none — UNAVAILABLE until the candidate is verified on target hardware',
    {
      capabilityDeclared: false, modelExists: false, weightsVerified: false,
      localInferenceVerified: false, cpuInferenceVerified: false,
      productionIntegrated: false,
    },
    'Phase 8 dental-VLM investigation: candidate DentalGemma 1.5 4B IT (MedGemma dental fine-tune, llama.cpp CPU) — lab prepared (ai-validation/dentalgemma: provenance, runner, report schema), status UNKNOWN; GGUF weights (3.47 GiB, git-ignored) absent and Hugging Face unreachable → RESOURCE_BLOCKED, not registered. A generic VLM is NOT classified as a dental VLM without this evidence.',
  ),
]

export const CAPABILITY_TASK_IDS: readonly string[] = CAPABILITY_MATRIX.map((r) => r.task)

export function getCapabilityTask(task: string): CapabilityRow | null {
  return CAPABILITY_MATRIX.find((r) => r.task === task) ?? null
}

/**
 * Deterministic capability resolution (spec §13 — no LLM involved).
 * Unknown task → typed UNSUPPORTED_CAPABILITY; modality mismatch → typed
 * MODALITY_MISMATCH; no-engine task → resolvable=false with the honest
 * fallback reason. Never a best effort.
 */
export function resolveCapability(task: string, modality?: string | null): CapabilityResolution {
  const r = getCapabilityTask(task)
  if (!r) {
    return {
      ok: false, task: null, resolvable: false, reason: null,
      error: `UNSUPPORTED_CAPABILITY: '${task}' is not in the capability matrix`,
    }
  }
  if (modality && modality.toUpperCase() !== r.modality) {
    return {
      ok: false, task: null, resolvable: false, reason: null,
      error: `MODALITY_MISMATCH: task '${task}' requires ${r.modality}, got '${modality}'`,
    }
  }
  if (r.engine === null) {
    return { ok: true, task: r, resolvable: false, reason: r.fallback }
  }
  return { ok: true, task: r, resolvable: true, reason: null }
}

/**
 * Engine for a study modality — the ONLY selection function the local-AI
 * path uses. Mirrors the orchestrator registry's supported_modalities
 * (extend-only) and app/api/imaging/studies/route.ts::ENGINE_BY_MODALITY.
 * A modality without a verified local engine resolves to null (the caller
 * then reports honest unavailability — never a substitute engine).
 */
export function engineForModality(modality: string, jaw?: 'max' | 'man' | null): string | null {
  const m = modality.toUpperCase()
  const known = new Set<string>(CAPABILITY_MATRIX.flatMap((r) => [r.modality]))
  if (!known.has(m)) return null
  switch (m) {
    case 'PANORAMIC': return 'liodon'
    case 'PERIAPICAL':
    case 'BITEWING': return 'implant-ai'
    case 'THREE_D_SCAN':
    case 'CBCT': return jaw === 'man' ? 'meshsegnet-man' : 'meshsegnet-max'
    case 'CEPHALOMETRIC': return 'orthodontic-ai'
    default: return null
  }
}

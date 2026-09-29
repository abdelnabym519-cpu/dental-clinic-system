// @ts-nocheck
/**
 * Phase 5 — Local AI fixtures.
 *
 * Fake capability source + fake orchestrator transport (deterministic,
 * in-memory) plus loaders for the COMMITTED real-inference evidence
 * artifacts under ai-validation/meshsegnet/reports (machine-readable
 * proof, spec §26). The evidence files are tracked in git; model weights
 * and mesh inputs are deliberately not.
 */
import fs from 'node:fs'
import path from 'node:path'

export const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** Official weight SHAs (ai-validation/meshsegnet/MODEL_PROVENANCE.md §2). */
export const MESHSEGNET_MAX_SHA = '727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2'
export const MESHSEGNET_MAN_SHA = 'd74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf'
/** Pinned challenge-mesh input SHAs (ai-validation/meshsegnet/scripts/download_artifacts.py). */
export const UPPER_MESH_SHA = '581b9a026e2ce734f6335f34aa900e8114dc33e2a83541ebd6bb26536382545e'
export const LOWER_MESH_SHA = 'b824f6822f4a6ada296eef6869e9341fa1e69ad6cd14862b53572198ae5e7a76'

const ENGINES = [
  {
    name: 'liodon',
    display_name: 'Liodon Dental Panoramic Detector',
    model_version: '1.0.0',
    model_checksum: '4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71',
    model_source: 'https://huggingface.co/liodon-ai/dental-panoramic-detector@8bef2036b099e80e51f93f24de4b0c0edd366256',
    model_license: 'CC-BY-NC-4.0',
    runtime: 'onnxruntime',
    device: 'cpu',
    classes: { 0: 'caries', 1: 'periapical_lesion', 2: 'impacted_tooth' },
    supported_modalities: ['PANORAMIC'],
    result_kind: 'findings',
    lifecycle_status: 'REGISTERED',
  },
  {
    name: 'meshsegnet-max',
    display_name: 'MeshSegNet (maxilla) — 15-class dental surface segmentation',
    model_version: '1.0.0',
    model_checksum: MESHSEGNET_MAX_SHA,
    model_source: 'https://github.com/Tai-Hsien/MeshSegNet@master (models/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip)',
    model_license: 'MIT',
    runtime: 'torch (CPU)',
    device: 'cpu',
    classes: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i, i === 0 ? 'Gingiva' : `Tooth_${i}`])),
    supported_modalities: ['THREE_D_SCAN', 'CBCT'],
    result_kind: 'segments',
    lifecycle_status: 'REGISTERED',
  },
  {
    name: 'meshsegnet-man',
    display_name: 'MeshSegNet (mandible) — 15-class dental surface segmentation',
    model_version: '1.0.0',
    model_checksum: MESHSEGNET_MAN_SHA,
    model_source: 'https://github.com/Tai-Hsien/MeshSegNet@master (models/MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip)',
    model_license: 'MIT',
    runtime: 'torch (CPU)',
    device: 'cpu',
    classes: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i, i === 0 ? 'Gingiva' : `Tooth_${i}`])),
    supported_modalities: ['THREE_D_SCAN', 'CBCT'],
    result_kind: 'segments',
    lifecycle_status: 'REGISTERED',
  },
  {
    name: 'implant-ai',
    display_name: 'Implant AI — YOLOv8-seg dental radiograph findings (8 classes)',
    model_version: '1.0.0',
    model_checksum: 'e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98',
    model_source: 'https://huggingface.co/nsitnov/8024-yolov8-model@0304179670f4838bf0dec1053b963112a16a66cf (8024.pt)',
    model_license: 'Apache-2.0 (weights as published); restricted loader',
    runtime: 'ultralytics 8.4.155 (restricted loader) / torch (CPU)',
    device: 'cpu',
    classes: { 0: 'Caries', 1: 'Crown', 2: 'Filling', 3: 'Implant', 4: 'Missing teeth', 5: 'Periapical lesion', 6: 'Root Piece', 7: 'Root canal obturation' },
    supported_modalities: ['PERIAPICAL', 'BITEWING'],
    result_kind: 'findings',
    lifecycle_status: 'REGISTERED',
  },
  {
    name: 'orthodontic-ai',
    display_name: 'Orthodontic AI — 38 cephalometric landmarks (CLDetection2023)',
    model_version: '1.0.0',
    model_checksum: 'fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc',
    model_source: 'https://github.com/5k5000/CLdetection2023@18d17d1934970016e7610c4849311900b8d1f191 (model/model_pretrained_on_train_and_val.pth)',
    model_license: 'Apache-2.0 (repository); restricted loader',
    runtime: 'mmpose 1.0.0 fork / mmcv-lite 2.1.0 / mmengine 0.10.7 / torch (CPU)',
    device: 'cpu',
    classes: Object.fromEntries(Array.from({ length: 38 }, (_, i) => [i, String(i)])),
    supported_modalities: ['CEPHALOMETRIC'],
    result_kind: 'landmarks',
    lifecycle_status: 'REGISTERED',
  },
]

/** Live health as the orchestrator would report it (2 engines available, rest blocked). */
const HEALTH = {
  liodon: {
    reachable: false,
    model_loaded: false,
    lifecycle_status: 'BLOCKED',
    lifecycle_reason: 'engine unreachable (weights not present in this deployment)',
  },
  'meshsegnet-max': {
    reachable: true,
    model_loaded: true,
    model_checksum: MESHSEGNET_MAX_SHA,
    is_standin_not_meshsegnet: false,
    lifecycle_status: 'AVAILABLE',
    lifecycle_reason: `model loaded and checksum ${MESHSEGNET_MAX_SHA} matches the registry`,
  },
  'meshsegnet-man': {
    reachable: true,
    model_loaded: true,
    model_checksum: MESHSEGNET_MAN_SHA,
    is_standin_not_meshsegnet: false,
    lifecycle_status: 'AVAILABLE',
    lifecycle_reason: `model loaded and checksum ${MESHSEGNET_MAN_SHA} matches the registry`,
  },
  'implant-ai': {
    reachable: false,
    model_loaded: false,
    lifecycle_status: 'BLOCKED',
    lifecycle_reason: 'engine unreachable (weights not present in this deployment)',
  },
  'orthodontic-ai': {
    reachable: false,
    model_loaded: false,
    lifecycle_status: 'BLOCKED',
    lifecycle_reason: 'engine unreachable (weights not present in this deployment)',
  },
}

export function createFakeCapabilitySource(over = {}) {
  return {
    async getEngines() {
      if (over.enginesThrow) throw new Error('orchestrator down')
      return ENGINES.map((e) => ({ ...e }))
    },
    async getHealth() {
      if (over.enginesThrow) throw new Error('orchestrator down')
      // Mirror the real source: the orchestrator speaks snake_case, the
      // client contract is camelCase.
      return Object.entries(HEALTH).map(([name, h]) => ({
        name,
        reachable: h.reachable === true,
        modelLoaded: h.model_loaded === true,
        modelChecksum: h.model_checksum ?? null,
        isStandin: Boolean(h.is_standin_not_meshsegnet),
        lifecycleStatus: h.lifecycle_status,
        lifecycleReason: h.lifecycle_reason,
      }))
    },
  }
}

/**
 * Fake orchestrator /analyze transport (deterministic).
 * `scenario` controls the returned shape for failure-path tests.
 */
export function createFakeTransport(scenario = 'segments', over = {}) {
  return async (p) => {
    const checksum =
      p.engine === 'meshsegnet-max' ? MESHSEGNET_MAX_SHA
        : p.engine === 'meshsegnet-man' ? MESHSEGNET_MAN_SHA
          : '4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71'
    const base = {
      job_id: p.jobId,
      status: 'COMPLETED',
      top_confidence: scenario === 'findings' ? 0.83 : null,
      findings:
        scenario === 'findings'
          ? [
              { condition: 'caries', tooth_number: null, confidence: 0.83,
                bounding_box: { x: 10, y: 20, width: 30, height: 40, x2: 40, y2: 60 } },
              { condition: 'periapical_lesion', tooth_number: null, confidence: 0.61,
                bounding_box: { x: 90, y: 80, width: 15, height: 25, x2: 105, y2: 105 } },
            ]
          : [
              { class_id: 1, class_name: 'Tooth_1', point_count: 1200 },
              { class_id: 0, class_name: 'Gingiva', point_count: 8799 },
            ],
      provenance: {
        engine: p.engine,
        model_version: '1.0.0',
        model_checksum: checksum,
        model_checksum_expected: checksum,
        model_source: 'https://github.com/Tai-Hsien/MeshSegNet@master',
        model_license: 'MIT',
        orchestrator_version: '19B.0.0',
        image_sha256: p.imageSha256,
        device: 'cpu',
        runtime: 'torch (CPU)',
        processing_time_ms: 1234,
        raw_output_key: `ai-output/${p.hospitalId}/${p.studyId}/${p.engine}/raw.json`,
        annotated_image_key: null,
        timestamp: '2026-09-30T12:00:00.000Z',
      },
      processing_time_ms: 1234,
      raw_output_key: `ai-output/${p.hospitalId}/${p.studyId}/${p.engine}/raw.json`,
      annotated_image_key: null,
      ...over.extra,
    }
    if (scenario === 'throw') throw new Error('orchestrator unreachable: connection refused')
    return base
  }
}

/** Load a committed Phase 5 real-inference evidence artifact (machine-readable, §26). */
export function loadPhase5Evidence(jaw: 'max' | 'man') {
  const file = path.join(REPO_ROOT, 'ai-validation', 'meshsegnet', 'reports', `phase5_real_inference_${jaw}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

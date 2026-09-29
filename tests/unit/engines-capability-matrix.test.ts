// @ts-nocheck
/**
 * Phase 5 — capability matrix (spec §9): schema validity, duplicate
 * detection, unsupported-capability rejection, version consistency,
 * deterministic selection, and the six-level evidence semantics.
 */
import { describe, it, expect } from 'vitest'
import {
  CAPABILITY_MATRIX,
  CAPABILITY_TASK_IDS,
  getCapabilityTask,
  resolveCapability,
  engineForModality,
} from '@/lib/ai/engines/capability-matrix'
import { CAPABILITY_OVERALL } from '@/lib/ai/engines/types'

const REGISTERED_ENGINES = ['liodon', 'meshsegnet-max', 'meshsegnet-man', 'implant-ai', 'orthodontic-ai']

describe('capability matrix — schema', () => {
  it('has no duplicate task ids', () => {
    expect(new Set(CAPABILITY_TASK_IDS).size).toBe(CAPABILITY_TASK_IDS.length)
  })

  it('every row is well-formed (overall, six levels, review always required)', () => {
    for (const r of CAPABILITY_MATRIX) {
      expect(CAPABILITY_OVERALL).toContain(r.overall)
      expect(Object.keys(r.levels).sort()).toEqual(
        ['capabilityDeclared', 'cpuInferenceVerified', 'localInferenceVerified',
          'modelExists', 'productionIntegrated', 'weightsVerified'],
      )
      expect(r.humanReview).toBe('REQUIRED')
      expect(r.fallback.length).toBeGreaterThan(0)
    }
  })

  it('declared engines are real registered engines (no phantom engines)', () => {
    for (const r of CAPABILITY_MATRIX) {
      if (r.engine) expect(REGISTERED_ENGINES).toContain(r.engine)
    }
  })

  it('modality matches the engine registry supported_modalities (mirror of the Python registry)', () => {
    const SUPPORTED = {
      liodon: ['PANORAMIC'],
      'meshsegnet-max': ['THREE_D_SCAN', 'CBCT'],
      'meshsegnet-man': ['THREE_D_SCAN', 'CBCT'],
      'implant-ai': ['PERIAPICAL', 'BITEWING'],
      'orthodontic-ai': ['CEPHALOMETRIC'],
    }
    for (const r of CAPABILITY_MATRIX) {
      if (!r.engine) continue
      expect(SUPPORTED[r.engine]).toContain(r.modality)
    }
  })
})

describe('capability matrix — deterministic resolution (§13)', () => {
  it('resolves known tasks deterministically', () => {
    const a = resolveCapability('panoramic_caries_detection')
    const b = resolveCapability('panoramic_caries_detection')
    expect(a).toEqual(b)
    expect(a.ok).toBe(true)
    expect(a.resolvable).toBe(true)
    expect(a.task.engine).toBe('liodon')
  })

  it('rejects unknown tasks with a typed UNSUPPORTED_CAPABILITY', () => {
    const r = resolveCapability('quantum_tooth_teleportation')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^UNSUPPORTED_CAPABILITY/)
  })

  it('rejects modality mismatch with a typed MODALITY_MISMATCH', () => {
    const r = resolveCapability('panoramic_caries_detection', 'CBCT')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^MODALITY_MISMATCH/)
  })

  it('no-engine tasks resolve resolvable=false with the honest fallback', () => {
    const r = resolveCapability('cbct_multi_structure_segmentation')
    expect(r.ok).toBe(true)
    expect(r.resolvable).toBe(false)
    expect(r.task.overall).toBe('UNAVAILABLE')
    expect(r.reason.length).toBeGreaterThan(0)
  })

  it('never guesses: PHOTO (no engine) is null, not a best effort', () => {
    expect(engineForModality('PHOTO')).toBeNull()
    expect(engineForModality('GARBAGE')).toBeNull()
  })
})

describe('capability matrix — engine selection (§32: never from user text)', () => {
  it('selection is a pure (modality[, jaw]) lookup', () => {
    expect(engineForModality('PANORAMIC')).toBe('liodon')
    expect(engineForModality('PERIAPICAL')).toBe('implant-ai')
    expect(engineForModality('BITEWING')).toBe('implant-ai')
    expect(engineForModality('CEPHALOMETRIC')).toBe('orthodontic-ai')
    expect(engineForModality('THREE_D_SCAN')).toBe('meshsegnet-max')
    expect(engineForModality('CBCT')).toBe('meshsegnet-max')
    expect(engineForModality('THREE_D_SCAN', 'man')).toBe('meshsegnet-man')
    expect(engineForModality('cbct')).toBe('meshsegnet-max') // case-insensitive
  })
})

describe('capability matrix — six-level evidence semantics (§9)', () => {
  it('SUPPORTED requires ALL six levels true', () => {
    for (const r of CAPABILITY_MATRIX) {
      if (r.overall === 'SUPPORTED') {
        expect(Object.values(r.levels).every(Boolean)).toBe(true)
      }
    }
    const supported = CAPABILITY_MATRIX.filter((r) => r.overall === 'SUPPORTED').map((r) => r.task).sort()
    // Evidence-backed in the validation environment (real weights + real
    // CPU runs committed under ai-validation/meshsegnet/reports/).
    expect(supported).toEqual([
      'cbct_surface_segmentation',
      'dental_mesh_segmentation',
      'dental_mesh_segmentation_mandible',
    ])
  })

  it('PARTIAL = integrated but some evidence level unmet — and it says which', () => {
    for (const r of CAPABILITY_MATRIX) {
      if (r.overall === 'PARTIAL') {
        expect(r.levels.productionIntegrated).toBe(true)
        expect(r.note.length).toBeGreaterThan(10)
      }
    }
    // Liodon: capability declared, model source-verified, weights NOT
    // verifiable here (HF unreachable) — exactly PARTIAL.
    const liodon = getCapabilityTask('panoramic_caries_detection')
    expect(liodon.overall).toBe('PARTIAL')
    expect(liodon.levels.weightsVerified).toBe(false)
    expect(liodon.levels.localInferenceVerified).toBe(false)
    expect(liodon.levels.productionIntegrated).toBe(true)
  })

  it('UNAVAILABLE is explicit (cbct multi-structure has no engine)', () => {
    const r = getCapabilityTask('cbct_multi_structure_segmentation')
    expect(r.overall).toBe('UNAVAILABLE')
    expect(r.engine).toBeNull()
    expect(r.levels.capabilityDeclared).toBe(false)
  })
})

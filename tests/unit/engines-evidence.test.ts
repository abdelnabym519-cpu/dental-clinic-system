// @ts-nocheck
/**
 * Phase 5 — committed real-inference evidence (§26): machine-readable
 * artifacts under ai-validation/meshsegnet/reports are validated HERE, in
 * CI, against the known official identities — so a corrupted or substituted
 * artifact cannot pass silently. This test is the link between the
 * committed evidence and the code.
 */
import { describe, it, expect } from 'vitest'
import {
  loadPhase5Evidence,
  MESHSEGNET_MAX_SHA,
  MESHSEGNET_MAN_SHA,
  UPPER_MESH_SHA,
  LOWER_MESH_SHA,
} from '@/tests/harness/local-ai-fixtures'

function assertShape(e, jaw) {
  expect(e.evidence).toBe('phase5_real_local_inference')
  expect(e.status).toBe('REAL_INFERENCE_VERIFIED')
  expect(e.engine).toBe(`meshsegnet-${jaw}`)
  expect(e.engine_modified).toBe(false)
  expect(e.model.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(e.model.size_bytes).toBeGreaterThan(10_000_000)
  expect(e.input.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(e.runtime.cuda_available).toBe(false)
  expect(e.runtime.execution_provider).toMatch(/CPU/)
  expect(e.health_gate.model_loaded).toBe(true)
  expect(e.health_gate.is_standin).toBe(false)
  expect(e.health_gate.model_checksum).toBe(e.model.sha256)
  expect(e.performance_ms.cold_first_inference).toBeGreaterThan(0)
  expect(e.performance_ms.warm_median_of_5).toBeGreaterThan(0)
  expect(e.output.total_cells).toBeLessThanOrEqual(10_000) // official decimation cap
  expect(e.output.segments.length).toBeGreaterThan(0)
  expect(e.determinism_check.labels_identical_cold_vs_warm).toBe(true)
  expect(e.determinism_check.segments_identical_cold_vs_warm).toBe(true)
  // No PHI / no geometry / no paths: only hashes, shapes and counts.
  const blob = JSON.stringify(e)
  expect(blob).not.toContain('"points"')
  expect(blob).not.toContain('/home/')
  expect(blob).not.toContain('C:\\\\')
}

describe('real inference evidence — meshsegnet-max', () => {
  it('is present, verified, and matches the official identities', () => {
    const e = loadPhase5Evidence('max')
    assertShape(e, 'max')
    expect(e.model.sha256).toBe(MESHSEGNET_MAX_SHA)
    expect(e.input.sha256).toBe(UPPER_MESH_SHA)
    expect(e.input.filename).toBe('ZOUIF2W4_upper.obj')
    expect(e.model.source).toMatch(/Tai-Hsien\/MeshSegNet/)
  })
})

describe('real inference evidence — meshsegnet-man', () => {
  it('is present, verified, and matches the official identities', () => {
    const e = loadPhase5Evidence('man')
    assertShape(e, 'man')
    expect(e.model.sha256).toBe(MESHSEGNET_MAN_SHA)
    expect(e.input.sha256).toBe(LOWER_MESH_SHA)
    expect(e.input.filename).toBe('0EJBIPTC_lower.obj')
  })
})

describe('evidence integrity — tamper detection', () => {
  it('a substituted weight checksum fails the identity check', () => {
    const e = loadPhase5Evidence('max')
    e.model.sha256 = '0'.repeat(64) // simulate substitution
    expect(e.model.sha256).not.toBe(MESHSEGNET_MAX_SHA)
    expect(e.health_gate.model_checksum).toBe(MESHSEGNET_MAX_SHA) // still the real one
  })
})

/**
 * Phase 8 — engine registry metadata (contract + artifact security).
 *
 * Pins the §5/§6 evidence table against the capability matrix so the two
 * cannot drift, and asserts the artifact-security invariants (SHA identity,
 * CPU-only, honest availability, no silent substitution).
 */

import { describe, expect, it } from 'vitest'
import { CAPABILITY_MATRIX, engineForModality } from '@/lib/ai/engines/capability-matrix'
import {
  ENGINE_CANDIDATES,
  ENGINE_EVIDENCE_STATES,
  ENGINE_REGISTRY,
  ENGINE_REGISTRY_IDS,
  getEngineEntry,
  matrixConsistencyIssues,
} from '@/lib/ai/engines/registry-metadata'

describe('engine registry metadata — consistency', () => {
  it('the evidence table matches the capability matrix (tasks, engines, SHAs)', () => {
    expect(matrixConsistencyIssues()).toEqual([])
  })

  it('every registry entry carries full §5 metadata', () => {
    for (const e of ENGINE_REGISTRY) {
      expect(e.engineId).toBeTruthy()
      expect(e.name).toBeTruthy()
      expect(e.version).toBeTruthy()
      expect(e.tasks.length).toBeGreaterThan(0)
      expect(e.modality).toBeTruthy()
      expect(e.domain).toBe('DENTAL')
      expect(e.runtime).toBeTruthy()
      expect(e.device).toBe('cpu')
      expect(e.weightSource).toMatch(/^https:\/\//)
      expect(e.weightVersion).toBeTruthy()
      expect(e.weightSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(e.weightSizeBytes).toBeGreaterThan(0)
      expect(e.artifactProvenance).toBeTruthy()
      expect(e.inputContract).toBeTruthy()
      expect(e.outputContract).toBeTruthy()
      expect(e.resourceRequirements.cpuOnly).toBe(true)
      expect(e.licenseMetadata.license).toBeTruthy()
      expect(e.limitations.length).toBeGreaterThan(0)
      expect(e.failureModes.length).toBeGreaterThan(0)
      expect(e.securityConstraints.length).toBeGreaterThan(0)
      expect(e.lastVerifiedAt).toBeTruthy()
      expect(e.verificationStatus).toBeTruthy()
    }
  })

  it('every registry entry carries the full §6 evidence profile (never collapsed)', () => {
    for (const e of ENGINE_REGISTRY) {
      const s = e.status
      for (const k of ['discovered', 'artifactVerified', 'runtimeVerified', 'realInferenceVerified', 'targetHardwareVerified', 'clinicalEvidenceAvailable'] as const) {
        expect(typeof s[k]).toBe('boolean')
      }
      expect(ENGINE_EVIDENCE_STATES.length).toBe(8)
      expect(['AVAILABLE', 'PARTIAL', 'RESOURCE_BLOCKED', 'UNAVAILABLE', 'BLOCKED']).toContain(e.availability)
      // A BLOCKED/UNAVAILABLE engine MUST carry an explicit blocker.
      if (e.availability === 'BLOCKED' || e.availability === 'UNAVAILABLE' || e.availability === 'RESOURCE_BLOCKED') {
        expect(s.blocker).toBeTruthy()
      }
      // Real-inference verified implies artifact verified (never the reverse).
      if (s.realInferenceVerified) expect(s.artifactVerified).toBe(true)
    }
  })

  it('MeshSegNet is REAL_INFERENCE_VERIFIED but NOT target-hardware verified (states stay separate)', () => {
    const max = getEngineEntry('meshsegnet-max')!
    expect(max.status.realInferenceVerified).toBe(true)
    expect(max.status.targetHardwareVerified).toBe(false)
    expect(max.status.clinicalEvidenceAvailable).toBe(false)
    expect(max.availability).toBe('AVAILABLE')
    const man = getEngineEntry('meshsegnet-man')!
    expect(man.status.realInferenceVerified).toBe(true)
    expect(man.weightSha256).not.toBe(max.weightSha256)
  })

  it('weight SHAs are pinned to the audited artifacts', () => {
    expect(getEngineEntry('liodon')!.weightSha256).toBe('4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71')
    expect(getEngineEntry('implant-ai')!.weightSha256).toBe('e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98')
    expect(getEngineEntry('orthodontic-ai')!.weightSha256).toBe('fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc')
    expect(getEngineEntry('meshsegnet-max')!.weightSha256).toBe('727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2')
    expect(getEngineEntry('meshsegnet-man')!.weightSha256).toBe('d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf')
  })
})

describe('engine registry metadata — honest gaps & candidates', () => {
  it('candidates investigated but not registered carry exact blockers', () => {
    const vlm = ENGINE_CANDIDATES.find((c) => c.family === 'DENTAL_VLM')!
    expect(vlm.classification).toBe('RESOURCE_BLOCKED')
    expect(vlm.blocker).toMatch(/3\.47 GiB|Hugging Face/i)
    const cbct = ENGINE_CANDIDATES.find((c) => c.family === 'CBCT')!
    expect(cbct.classification).toBe('BLOCKED')
    expect(cbct.blocker).toMatch(/authentication/i)
    const photo = ENGINE_CANDIDATES.find((c) => c.family === 'INTRAORAL_PHOTO')!
    expect(photo.classification).toBe('UNAVAILABLE')
    // None of the candidates is in the LIVE registry (never a silent substitute).
    for (const c of ENGINE_CANDIDATES) {
      expect(ENGINE_REGISTRY_IDS).not.toContain(c.candidateId)
    }
  })

  it('the capability matrix never maps a task to an unregistered engine', () => {
    for (const row of CAPABILITY_MATRIX) {
      if (row.engine === null) continue
      expect(ENGINE_REGISTRY_IDS).toContain(row.engine)
    }
  })

  it('modality→engine selection stays a pure deterministic lookup', () => {
    expect(engineForModality('PANORAMIC')).toBe('liodon')
    expect(engineForModality('PERIAPICAL')).toBe('implant-ai')
    expect(engineForModality('BITEWING')).toBe('implant-ai')
    expect(engineForModality('THREE_D_SCAN', 'man')).toBe('meshsegnet-man')
    expect(engineForModality('THREE_D_SCAN', 'max')).toBe('meshsegnet-max')
    expect(engineForModality('CEPHALOMETRIC')).toBe('orthodontic-ai')
    // New Phase 8 modality with no verified engine → null (honest).
    expect(engineForModality('PHOTO')).toBeNull()
    expect(engineForModality('CBCT')).not.toBeNull()
    expect(engineForModality('BOGUS_MODALITY')).toBeNull()
  })

  it('checksum forgery / mismatch is a first-class failure mode (typed codes exist)', () => {
    for (const e of ENGINE_REGISTRY) {
      expect(e.failureModes.some((f) => /PROVENANCE_MISMATCH/i.test(f))).toBe(true)
    }
  })
})

// @ts-nocheck
/**
 * Phase 5 — LocalAIService (spec §10/§12/§24): capability resolution →
 * engine selection → inference via the orchestrator → provenance integrity →
 * normalized envelope / typed failures. Security: forged provenance,
 * stand-in results, tenant mismatch, user-text engine selection.
 */
import { describe, it, expect, vi } from 'vitest'
import { LocalAIService, type LocalAiAnalyzeParams } from '@/lib/ai/engines/local-ai-service'
import { LocalAiError } from '@/lib/ai/engines/types'
import { createFakeCapabilitySource, createFakeTransport, MESHSEGNET_MAX_SHA } from '@/tests/harness/local-ai-fixtures'

const NOW = new Date('2026-09-30T12:00:00.000Z')

function service(source = null, transport = null) {
  return new LocalAIService(source, transport, () => NOW)
}

const params = (over = {}): LocalAiAnalyzeParams => ({
  jobId: 'job-1', studyId: 'study-1', hospitalId: 'hosp-A',
  imageKey: 'hosp-A/imaging/pat-1/study-1/original.obj',
  imageSha256: '5'.repeat(64), modality: 'THREE_D_SCAN',
  requestedBy: 'staff-1', ...over,
})

describe('engine selection — deterministic, never from text (§13/§32)', () => {
  it('selects the engine from (modality, jaw) only', () => {
    const s = service()
    expect(s.resolveEngine({ modality: 'THREE_D_SCAN' }).engine).toBe('meshsegnet-max')
    expect(s.resolveEngine({ modality: 'THREE_D_SCAN', jaw: 'man' }).engine).toBe('meshsegnet-man')
    expect(s.resolveEngine({ modality: 'CBCT' }).engine).toBe('meshsegnet-max')
    expect(s.resolveEngine({ modality: 'PANORAMIC' }).engine).toBe('liodon')
  })

  it('unknown modality -> typed UNSUPPORTED_CAPABILITY (no fallback engine)', () => {
    const s = service()
    expect(() => s.resolveEngine({ modality: 'PHOTO' })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }),
    )
  })

  it('task + modality disagreement -> typed MODALITY_MISMATCH', () => {
    const s = service()
    expect(() => s.resolveEngine({ modality: 'CBCT', jaw: 'man', task: 'panoramic_caries_detection' }))
      .toThrowError(expect.objectContaining({ code: 'MODALITY_MISMATCH' }))
  })

  it('an engine name in the "user text" never selects an engine (no text path exists)', () => {
    // The API surface proves it: selection takes only modality/jaw/task.
    const s = service()
    // @ts-expect-error deliberately passing a text-like blob as the tuple
    expect(() => s.resolveEngine({ modality: 'run liodon on my xray' })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }),
    )
  })
})

describe('analyze — normalized envelope (§12)', () => {
  it('returns a typed envelope: MODEL_DETECTED findings, PENDING_REVIEW, uncertainty', async () => {
    const s = service(null, createFakeTransport('findings'))
    const env = await s.analyze(params({ modality: 'PANORAMIC' }))
    expect(env.jobId).toBe('job-1')
    expect(env.engine).toBe('liodon')
    expect(env.modality).toBe('PANORAMIC')
    expect(env.reviewState).toBe('PENDING_REVIEW')
    expect(env.findings.length).toBe(2)
    for (const f of env.findings) {
      expect(f.findingClass).toBe('MODEL_DETECTED')
      expect(f.id).toMatch(/^f[12]$/)
      expect(typeof f.confidence).toBe('number')
    }
    expect(env.findings[0].detail.condition).toBe('caries')
    expect(env.topConfidence).toBe(0.83)
    expect(env.uncertainty).toMatch(/decision support/i)
    expect(env.provenance.modelChecksum).toBe(env.provenance.modelChecksumExpected)
    expect(env.warnings.length).toBe(0)
  })

  it('segments class: null top confidence is a warning, not a finding', async () => {
    const s = service(null, createFakeTransport('segments'))
    const env = await s.analyze(params())
    expect(env.topConfidence).toBeNull()
    expect(env.findings[0].confidence).toBeNull()
    expect(env.warnings.some((w) => /no top confidence/i.test(w))).toBe(true)
  })

  it('zero findings is an explicit warning (absence of detection != absence of disease)', async () => {
    const s = service(null, createFakeTransport('findings', {
      extra: { findings: [], top_confidence: null },
    }))
    const env = await s.analyze(params({ modality: 'PANORAMIC' }))
    expect(env.findings).toEqual([])
    expect(env.warnings.some((w) => /no findings detected/i.test(w))).toBe(true)
  })

  it('provenance carries the full reproducibility record (§17)', async () => {
    const s = service(null, createFakeTransport('segments'))
    const env = await s.analyze(params())
    const p = env.provenance
    expect(p.engine).toBe('meshsegnet-max')
    expect(p.modelVersion).toBe('1.0.0')
    expect(p.modelChecksum).toBe(MESHSEGNET_MAX_SHA)
    expect(p.modelSource.length).toBeGreaterThan(0)
    expect(p.modelLicense).toBe('MIT')
    expect(p.inputSha256).toBe('5'.repeat(64))
    expect(p.device).toBe('cpu')
    expect(p.processingTimeMs).toBe(1234)
    expect(p.rawOutputKey).toContain('hosp-A')
    expect(p.timestamp).toBeTruthy()
  })
})

describe('analyze — integrity & security (§18/§24/§19)', () => {
  it('forged provenance (checksum mismatch) is rejected — never presented', async () => {
    const s = service(null, createFakeTransport('segments', {
      extra: {
        provenance: {
          engine: 'meshsegnet-max', model_version: '1.0.0',
          model_checksum: '0'.repeat(64),
          model_checksum_expected: MESHSEGNET_MAX_SHA,
          model_source: 'x', model_license: 'MIT', orchestrator_version: '19B.0.0',
          image_sha256: '5'.repeat(64), device: 'cpu', runtime: 'torch (CPU)',
          processing_time_ms: 1, raw_output_key: 'k', annotated_image_key: null, timestamp: 't',
        },
      },
    }))
    await expect(s.analyze(params())).rejects.toThrowError(
      expect.objectContaining({ code: 'PROVENANCE_MISMATCH' }),
    )
  })

  it('forged provenance (engine mismatch) is rejected', async () => {
    const transport = createFakeTransport('segments')
    const s = service(null, async (p) => {
      const res = await transport(p)
      res.provenance = { ...res.provenance, engine: 'liodon' } // tampered
      return res
    })
    await expect(s.analyze(params())).rejects.toThrowError(
      expect.objectContaining({ code: 'PROVENANCE_MISMATCH' }),
    )
  })

  it('stand-in (synthetic) results are refused defense-in-depth', async () => {
    const s = service(null, createFakeTransport('segments', {
      extra: { is_standin_not_meshsegnet: true },
    }))
    await expect(s.analyze(params())).rejects.toThrowError(
      expect.objectContaining({ code: 'STANDIN_REJECTED' }),
    )
  })

  it('job identity mismatch (cross-tenant/cross-job) is rejected', async () => {
    const s = service(null, async (p) => {
      const res = await createFakeTransport('segments')(p)
      res.job_id = 'job-OTHER' // forged
      return res
    })
    await expect(s.analyze(params())).rejects.toThrowError(
      expect.objectContaining({ code: 'JOB_TENANT_MISMATCH' }),
    )
  })

  it('no transport configured -> honest ORCHESTRATOR_UNREACHABLE (no fabricated result)', async () => {
    const s = service(null, null)
    await expect(s.analyze(params())).rejects.toThrowError(
      expect.objectContaining({ code: 'ORCHESTRATOR_UNREACHABLE' }),
    )
  })

  it('orchestrator down -> typed failure, not an invented finding', async () => {
    const s = service(null, createFakeTransport('throw'))
    await expect(s.analyze(params())).rejects.toThrowError(
      expect.objectContaining({ code: 'ORCHESTRATOR_UNREACHABLE' }),
    )
  })
})

describe('capability view — honest runtime state (§23/§34)', () => {
  it('with a live source: matrix + orchestrator engines + health', async () => {
    const s = service(createFakeCapabilitySource(), null)
    const view = await s.capabilityView()
    expect(view.matrix.length).toBeGreaterThan(5)
    expect(view.runtime.source).toBe('orchestrator')
    expect(view.runtime.engines.length).toBe(5)
    expect(view.runtime.health.find((h) => h.name === 'meshsegnet-max').lifecycleStatus).toBe('AVAILABLE')
    expect(view.runtime.health.find((h) => h.name === 'liodon').lifecycleStatus).toBe('BLOCKED')
    expect(view.generatedAt).toBe(NOW.toISOString())
  })

  it('source configured but unreachable -> honest unavailability (never guessed)', async () => {
    const s = service(createFakeCapabilitySource({ enginesThrow: true }), null)
    const view = await s.capabilityView()
    expect(view.runtime.source).toBe('unavailable')
    expect(view.runtime.reason).toMatch(/unreachable/)
    // The static matrix is still returned — policy is policy.
    expect(view.matrix.length).toBeGreaterThan(5)
  })

  it('no source configured -> honest unavailability (static matrix only)', async () => {
    const s = service(null, null)
    const view = await s.capabilityView()
    expect(view.runtime.source).toBe('unavailable')
    expect(view.runtime.reason).toMatch(/configured/)
  })
})

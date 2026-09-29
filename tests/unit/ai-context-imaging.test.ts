/**
 * Phase 2 — Imaging context: study → analyses → findings normalization,
 * model provenance (version/checksum/orchestrator), review state.
 * AI findings are MODEL_FINDING with confidence + source — never diagnoses.
 */
import { describe, it, expect } from 'vitest'
import { buildClinicalContext } from '@/lib/ai/context/service'
import { normalizeAiFinding } from '@/lib/ai/context/builders'
import { serializeForPrompt } from '@/lib/ai/context/serialize'
import {
  createFakePrisma, makeRequest, PAT_B1, ACTORS,
} from '@/tests/harness/context-fixtures'

const db = () => createFakePrisma()

describe('Finding normalization (all engine shapes)', () => {
  it('box findings: condition + bbox summary, confirmed tooth link when valid FDI', () => {
    const f = normalizeAiFinding({ condition: 'caries', tooth_number: 36, confidence: 0.87, bounding_box: { x: 1, y: 2, width: 3, height: 4 } })
    expect(f.kind).toBe('box')
    expect(f.summary.condition).toBe('caries')
    expect(f.summary.box).toBe('1,2,3,4')
    expect(f.toothFdi).toBe(36)
    expect(f.toothLink).toBe('confirmed')
    expect(f.confidence).toBe(0.87)
    expect(f.category).toBe('MODEL_FINDING')
  })

  it('box finding with null tooth_number → tooth link UNKNOWN (never fabricated)', () => {
    const f = normalizeAiFinding({ condition: 'unknown', tooth_number: null, confidence: 0.31, bounding_box: { x: 10, y: 10, width: 8, height: 8 } })
    expect(f.kind).toBe('box')
    expect(f.toothFdi).toBeNull()
    expect(f.toothLink).toBe('unknown')
  })

  it('invalid tooth numbers are not presented as confirmed (99 → unknown)', () => {
    const f = normalizeAiFinding({ condition: 'x', tooth_number: 99, confidence: 0.5, bounding_box: { x: 0, y: 0, width: 1, height: 1 } })
    expect(f.toothLink).toBe('unknown')
    expect(f.toothFdi).toBeNull()
  })

  it('landmark and segment shapes normalize; garbage → unknown kind, still surfaced honestly', () => {
    const lm = normalizeAiFinding({ landmark_id: 3, landmark_name: 'cuspal tip', score: 0.91 })
    expect(lm.kind).toBe('landmark')
    expect(lm.summary.landmark_name).toBe('cuspal tip')
    expect(lm.confidence).toBe(0.91)

    const seg = normalizeAiFinding({ class_id: 2, class_name: 'enamel', point_count: 1450 })
    expect(seg.kind).toBe('segment')
    expect(seg.summary.class_name).toBe('enamel')

    const bad = normalizeAiFinding({ nonsense: true })
    expect(bad.kind).toBe('unknown')
    const empty = normalizeAiFinding(null)
    expect(empty.kind).toBe('unknown')
  })
})

describe('Imaging context (IMAGING profile)', () => {
  it('renders study + AI analysis with full model provenance and review state', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'IMAGING' }), db())
    expect(ctx.imaging.status).toBe('included')
    const s = (ctx.imaging as any).data.studies[0]
    expect(s.modality).toBe('DIGITAL_XRAY')
    expect(s.studyType).toBe('PERIAPICAL')
    expect(s.status).toBe('COMPLETED')
    expect(s.appointmentNo).toBe('APPT-A-1002')
    expect(s.provenance.sourceType).toBe('imaging_study')

    const j = s.analyses[0]
    expect(j.engine).toBe('clm')
    expect(j.modelVersion).toBe('v1.2.0')
    expect(j.modelChecksum).toBe('c0ffee0000000000000000000000000000000000')
    expect(j.orchestratorVersion).toBe('2.1.0')
    expect(j.findingCount).toBe(2)
    expect(j.findings.length).toBe(2)
    expect(j.findings[0].category).toBe('MODEL_FINDING')
    expect(j.findings[0].toothLink).toBe('confirmed')
    expect(j.findings[1].toothLink).toBe('unknown')
    expect(j.review.decision).toBe('ACCEPTED')
    expect(j.review.reviewerName).toBe('Hana Shalaby')
    expect(j.review.acceptedCount).toBe(1)
    expect(j.provenance.sourceType).toBe('ai_job')
    expect(j.provenance.entityType).toBe('AIAnalysisJob')

    const serialized = serializeForPrompt(ctx)
    expect(serialized).toContain('MODEL_FINDING (not a diagnosis)')
    expect(serialized).toContain('Doctor review: ACCEPTED')
    expect(serialized).toContain('v1.2.0')
    expect(serialized).toContain('c0ffee000000') // checksum prefix
  })

  it('pending review is explicit — findings are never presented as confirmed', async () => {
    const ctx = await buildClinicalContext(
      makeRequest({ profile: 'IMAGING', patientId: PAT_B1, hospitalId: 'hosp-B' }),
      db()
    )
    const j = (ctx.imaging as any).data.studies[0].analyses[0]
    expect(j.review).toBeNull()
    const serialized = serializeForPrompt(ctx)
    expect(serialized).toContain('Doctor review: PENDING')
    expect(serialized).toContain('must not be treated as confirmed diagnoses')
    // tenant B's data really came from tenant B's store
    expect(serialized).toContain('PANORAMIC')
    expect(serialized).not.toContain('Periapical view of lower left molars')
  })

  it('study scope: only the requested study is returned', async () => {
    const ctx = await buildClinicalContext(
      makeRequest({ profile: 'IMAGING', studyId: 'study-A1' }),
      db()
    )
    const d = (ctx.imaging as any).data
    expect(d.studies.length).toBe(1)
    expect(d.studies[0].studyId).toBe('study-A1')

    const missing = await buildClinicalContext(
      makeRequest({ profile: 'IMAGING', studyId: 'study-NOPE' }),
      db()
    )
    expect(missing.imaging.status).toBe('missing')
  })

  it('LAB_TECH may read imaging (with provenance); ACCOUNTANT may not', async () => {
    const lab = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.labTechA }, profile: 'IMAGING' }),
      db()
    )
    expect(lab.imaging.status).toBe('included')
    expect(lab.medical.status).toBe('excluded')
    expect(lab.dental.status).toBe('excluded')

    const acc = await buildClinicalContext(
      makeRequest({ actor: { ...ACTORS.accountantA }, profile: 'FULL_360' }),
      db()
    )
    expect(acc.imaging.status).toBe('excluded')
    expect((acc.imaging as any).reason).toBe('not_permitted')
    expect(acc.financial.status).toBe('included')
  })

  it('findings are bounded (≤8 per analysis) — raw count preserved', async () => {
    const db2 = createFakePrisma({
      imagingStudy: [{
        id: 'study-MANY', hospitalId: 'hosp-A', patientId: 'pat-A1',
        studyType: 'CBCT', modality: 'CBCT', studyDate: new Date('2026-09-20'),
        status: 'COMPLETED', description: 'CBCT', appointmentId: null, appointment: null,
        uploadedById: 'staff-doctor-1', uploadedBy: { firstName: 'Hana', lastName: 'Shalaby' },
        createdAt: new Date('2026-09-20'),
        aiJobs: [{
          id: 'job-MANY', engine: 'clm', status: 'COMPLETED',
          modelVersion: 'v1.2.0', modelChecksum: null, orchestratorVersion: null,
          completedAt: new Date('2026-09-21'), createdAt: new Date('2026-09-20'),
          confidence: null,
          findings: Array.from({ length: 20 }, (_, i) => ({
            condition: `caries-${i}`, tooth_number: 11 + i, confidence: 0.5,
            bounding_box: { x: i, y: i, width: 2, height: 2 },
          })),
          reviewedById: null, reviewedAt: null, reviewDecision: null,
          reviewedBy: null, acceptedFindings: null,
        }],
      }],
    })
    const ctx = await buildClinicalContext(
      makeRequest({ profile: 'IMAGING', studyId: 'study-MANY' }),
      db2
    )
    const j = (ctx.imaging as any).data.studies[0].analyses[0]
    expect(j.findings.length).toBe(8) // capped
    expect(j.findingCount).toBe(20) // raw count preserved — nothing hidden
  })
})

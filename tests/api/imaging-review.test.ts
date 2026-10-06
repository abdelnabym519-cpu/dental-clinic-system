// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

const { POST } = await import('@/app/api/imaging/jobs/[id]/review/route')

const HOSPITAL = 'hosp-1'
const USER = { id: 'doc-1', name: 'Dr. A', role: 'DOCTOR', hospitalId: HOSPITAL }
const FINDINGS = [
  {
    condition: 'caries',
    tooth_number: null,
    confidence: 0.631,
    bounding_box: { x: 1, y: 2, width: 3, height: 4, x2: 4, y2: 6 },
  },
]

function mockAuthed() {
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    user: USER,
    hospitalId: HOSPITAL,
    session: { user: USER },
  })
}

function makeJob(status = 'COMPLETED', hospitalId = HOSPITAL) {
  return {
    id: 'job-1',
    hospitalId,
    studyId: 'study-1',
    engine: 'liodon',
    status,
    findings: FINDINGS,
    study: { id: 'study-1', status: 'ANALYZED' },
  }
}

function makeReq(decision = 'ACCEPTED', extra: any = {}) {
  const req = new NextRequest('http://localhost/api/imaging/jobs/job-1/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, reviewNotes: 'looks consistent', ...extra }),
  })
  // Next 15: route context carries params as a promise.
  const ctx = { params: Promise.resolve({ id: 'job-1' }) }
  return { req, ctx }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthed()
})

describe('auth & validation', () => {
  it('returns 401 unauthenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      hospitalId: null,
    })
    const a = makeReq(); expect((await POST(a.req, a.ctx)).status).toBe(401)
  })

  it('returns 403 for non-doctor roles', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
    })
    const a = makeReq(); expect((await POST(a.req, a.ctx)).status).toBe(403)
  })

  it('rejects invalid decision values', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(makeJob())
    const m = makeReq('MAYBE'); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(400)
  })

  it('returns 404 for jobs of other tenants (no oracle)', async () => {
    // findFirst is called with where {id, hospitalId: HOSPITAL}; a foreign job
    // simply does not match.
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(null)
    const m = makeReq(); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(404)
    expect(prisma.aIAnalysisJob.update).not.toHaveBeenCalled()
  })

  it('refuses review of non-completed jobs with 409', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(makeJob('PROCESSING'))
    const m = makeReq(); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(409)
  })

  it('requires acceptedFindings for MODIFIED', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(makeJob())
    const m = makeReq('MODIFIED'); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(400)
  })
})

const LANDMARKS = [
  { landmark_id: 0, landmark_name: '0', x: 100, y: 150, score: 0.91, coordinate_space: 'cropped_original_image' },
  { landmark_id: 1, landmark_name: '1', x: 220, y: 340, score: null, coordinate_space: 'cropped_original_image' },
  { landmark_id: 2, landmark_name: '2', x: 431.5, y: 87, score: 0.77, coordinate_space: 'cropped_original_image' },
]

const SEGMENTS = [
  { class_id: 0, class_name: 'Gingiva', point_count: 12345 },
  { class_id: 1, class_name: 'Tooth_1', point_count: 4567 },
  { class_id: 14, class_name: 'Tooth_14', point_count: 890 },
]

describe('review decisions (D11 + D12)', () => {
  it('ACCEPTED persists the AI findings as-is, moves study to REVIEWED, audits', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(makeJob())
    prisma.aIAnalysisJob.update.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      reviewDecision: 'ACCEPTED',
      reviewedAt: new Date(),
      reviewedById: USER.id,
      acceptedFindings: FINDINGS,
    })
    prisma.imagingStudy.update.mockResolvedValue({})
    prisma.auditLog.create.mockResolvedValue({})

    const m2 = makeReq('ACCEPTED'); const res = await POST(m2.req, m2.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job.reviewDecision).toBe('ACCEPTED')
    expect(body.study.status).toBe('REVIEWED')

    const upd = prisma.aIAnalysisJob.update.mock.calls[0][0]
    expect(upd.data.reviewedById).toBe(USER.id)
    expect(upd.data.reviewDecision).toBe('ACCEPTED')
    expect(upd.data.acceptedFindings).toEqual(FINDINGS)
    expect(upd.data.reviewNotes).toBe('looks consistent')

    expect(prisma.imagingStudy.update).toHaveBeenCalledWith({
      where: { id: 'study-1' },
      data: { status: 'REVIEWED' },
    })

    const audit = prisma.auditLog.create.mock.calls[0][0].data
    expect(audit.action).toBe('AI_FINDING_ACCEPTED')
    expect(audit.entityType).toBe('AIAnalysisJob')
    expect(audit.entityId).toBe('job-1')
    expect(audit.hospitalId).toBe(HOSPITAL)
    expect(audit.userId).toBe(USER.id)
    expect(JSON.parse(audit.newValues).decision).toBe('ACCEPTED')
  })

  it('MODIFIED stores the doctor-corrected findings', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(makeJob())
    const modified = [
      {
        condition: 'impacted_tooth',
        tooth_number: null,
        confidence: 0.9,
        bounding_box: { x: 10, y: 20, width: 30, height: 40, x2: 40, y2: 60 },
      },
    ]
    prisma.aIAnalysisJob.update.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      reviewDecision: 'MODIFIED',
      reviewedAt: new Date(),
      reviewedById: USER.id,
      acceptedFindings: modified,
    })
    prisma.imagingStudy.update.mockResolvedValue({})
    prisma.auditLog.create.mockResolvedValue({})

    const m = makeReq('MODIFIED', { acceptedFindings: modified }); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(200)

    const upd = prisma.aIAnalysisJob.update.mock.calls[0][0]
    expect(upd.data.acceptedFindings).toEqual(modified)
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('AI_FINDING_MODIFIED')
  })

  it('REJECTED stores no accepted findings and audits the rejection', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(makeJob())
    prisma.aIAnalysisJob.update.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      reviewDecision: 'REJECTED',
      reviewedAt: new Date(),
      reviewedById: USER.id,
      acceptedFindings: null,
    })
    prisma.imagingStudy.update.mockResolvedValue({})
    prisma.auditLog.create.mockResolvedValue({})

    const m = makeReq('REJECTED'); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(200)

    const upd = prisma.aIAnalysisJob.update.mock.calls[0][0]
    expect(upd.data.acceptedFindings).toBeNull()
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('AI_FINDING_REJECTED')
  })

  it('audits include engine + study context (who/when/tenant/what/resource)', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue(makeJob())
    prisma.aIAnalysisJob.update.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      reviewDecision: 'ACCEPTED',
      reviewedAt: new Date(),
      reviewedById: USER.id,
      acceptedFindings: FINDINGS,
    })
    prisma.imagingStudy.update.mockResolvedValue({})
    prisma.auditLog.create.mockResolvedValue({})

    const m2 = makeReq('ACCEPTED'); await POST(m2.req, m2.ctx)
    const nv = JSON.parse(prisma.auditLog.create.mock.calls[0][0].data.newValues)
    expect(nv.studyId).toBe('study-1')
    expect(nv.engine).toBe('liodon')
    expect(nv.acceptedFindingCount).toBe(1)
  })

  // Phase 20B — the doctor-review gate must accept the 19B finding shapes
  // (Orthodontic landmarks, MeshSegNet segments), not just 19A boxes.

  it('MODIFIED with Orthodontic landmark findings (38-point shape) persists them', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue({ ...makeJob(), engine: 'orthodontic-ai', findings: LANDMARKS })
    prisma.aIAnalysisJob.update.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      reviewDecision: 'MODIFIED',
      reviewedAt: new Date(),
      reviewedById: USER.id,
      acceptedFindings: LANDMARKS,
    })
    prisma.imagingStudy.update.mockResolvedValue({})
    prisma.auditLog.create.mockResolvedValue({})

    const { req, ctx } = makeReq('MODIFIED', { acceptedFindings: LANDMARKS })
    const res = await POST(req, ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job.reviewDecision).toBe('MODIFIED')
    expect(body.job.acceptedFindings).toHaveLength(3)
    expect(body.job.acceptedFindings[0]).toMatchObject({ landmark_id: 0, x: 100, y: 150 })
    expect(body.study.status).toBe('REVIEWED')
  })

  it('MODIFIED with MeshSegNet segment findings (15-class shape) persists them', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue({ ...makeJob(), engine: 'meshsegnet-max', findings: SEGMENTS })
    prisma.aIAnalysisJob.update.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      reviewDecision: 'MODIFIED',
      reviewedAt: new Date(),
      reviewedById: USER.id,
      acceptedFindings: SEGMENTS,
    })
    prisma.imagingStudy.update.mockResolvedValue({})
    prisma.auditLog.create.mockResolvedValue({})

    const { req, ctx } = makeReq('MODIFIED', { acceptedFindings: SEGMENTS })
    const res = await POST(req, ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job.acceptedFindings).toHaveLength(3)
    expect(body.job.acceptedFindings[0]).toMatchObject({ class_id: 0, class_name: 'Gingiva', point_count: 12345 })
  })

  it('ACCEPTED on a MeshSegNet segment job stores the segments as-is', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue({ ...makeJob(), engine: 'meshsegnet-man', findings: SEGMENTS })
    prisma.aIAnalysisJob.update.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      reviewDecision: 'ACCEPTED',
      reviewedAt: new Date(),
      reviewedById: USER.id,
      acceptedFindings: SEGMENTS,
    })
    prisma.imagingStudy.update.mockResolvedValue({})
    prisma.auditLog.create.mockResolvedValue({})

    const { req, ctx } = makeReq('ACCEPTED')
    const res = await POST(req, ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job.acceptedFindings).toHaveLength(3)
  })

  it('rejects malformed landmark findings (out-of-range landmark_id) with 400', async () => {
    prisma.aIAnalysisJob.findFirst.mockResolvedValue({ ...makeJob(), engine: 'orthodontic-ai', findings: LANDMARKS })

    const { req, ctx } = makeReq('MODIFIED', {
      acceptedFindings: [{ landmark_id: 38, landmark_name: 'x', x: 1, y: 2, score: null }],
    })
    const res = await POST(req, ctx)

    expect(res.status).toBe(400)
    expect(prisma.aIAnalysisJob.update).not.toHaveBeenCalled()
  })
})

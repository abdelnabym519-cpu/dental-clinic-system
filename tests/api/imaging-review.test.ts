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
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(makeJob())
    const m = makeReq('MAYBE'); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(400)
  })

  it('returns 404 for jobs of other tenants (no oracle)', async () => {
    // findFirst is called with where {id, hospitalId: HOSPITAL}; a foreign job
    // simply does not match.
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(null)
    const m = makeReq(); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(404)
    expect(prisma.aiAnalysisJob.update).not.toHaveBeenCalled()
  })

  it('refuses review of non-completed jobs with 409', async () => {
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(makeJob('PROCESSING'))
    const m = makeReq(); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(409)
  })

  it('requires acceptedFindings for MODIFIED', async () => {
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(makeJob())
    const m = makeReq('MODIFIED'); const res = await POST(m.req, m.ctx)
    expect(res.status).toBe(400)
  })
})

describe('review decisions (D11 + D12)', () => {
  it('ACCEPTED persists the AI findings as-is, moves study to REVIEWED, audits', async () => {
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(makeJob())
    prisma.aiAnalysisJob.update.mockResolvedValue({
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

    const upd = prisma.aiAnalysisJob.update.mock.calls[0][0]
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
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(makeJob())
    const modified = [
      {
        condition: 'impacted_tooth',
        tooth_number: null,
        confidence: 0.9,
        bounding_box: { x: 10, y: 20, width: 30, height: 40, x2: 40, y2: 60 },
      },
    ]
    prisma.aiAnalysisJob.update.mockResolvedValue({
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

    const upd = prisma.aiAnalysisJob.update.mock.calls[0][0]
    expect(upd.data.acceptedFindings).toEqual(modified)
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('AI_FINDING_MODIFIED')
  })

  it('REJECTED stores no accepted findings and audits the rejection', async () => {
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(makeJob())
    prisma.aiAnalysisJob.update.mockResolvedValue({
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

    const upd = prisma.aiAnalysisJob.update.mock.calls[0][0]
    expect(upd.data.acceptedFindings).toBeNull()
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('AI_FINDING_REJECTED')
  })

  it('audits include engine + study context (who/when/tenant/what/resource)', async () => {
    prisma.aiAnalysisJob.findFirst.mockResolvedValue(makeJob())
    prisma.aiAnalysisJob.update.mockResolvedValue({
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
})

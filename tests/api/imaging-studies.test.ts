// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))

const mockOrchestrator = vi.hoisted(() => ({
  requestOrchestratorAnalyze: vi.fn(),
  OrchestratorError: class OrchestratorError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

const mockStorage = vi.hoisted(() => ({
  put: vi.fn(),
  getStorage: vi.fn(() => ({ put: mockStorage.put })),
  buildStorageKey: (h: string, ...rest: string[]) => [h, ...rest].join('/'),
  uploadUrl: (k: string | null | undefined) => (k ? `/api/uploads/${k}` : ''),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/storage', () => mockStorage)
vi.mock('@/lib/ai-orchestrator', () => mockOrchestrator)

const { POST, GET } = await import('@/app/api/imaging/studies/route')

const HOSPITAL = 'hosp-1'
const USER = { id: 'user-1', name: 'Dr. A', role: 'DOCTOR', hospitalId: HOSPITAL }
const PATIENT = { id: 'pat-1' }
const IMAGE_BYTES = Buffer.from('fake-panoramic-xray-bytes')
const SHA = createHash('sha256').update(IMAGE_BYTES).digest('hex')

function mockAuthed() {
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    user: USER,
    hospitalId: HOSPITAL,
    session: { user: USER },
  })
}

// Repo convention for multipart tests: a fake request whose formData()
// resolves to a Map-backed object (see data-import-upload.test.ts).
function makeUploadForm(over: Record<string, string | File> = {}) {
  const file = {
    name: 'pano.png',
    type: 'image/png',
    size: IMAGE_BYTES.length,
    arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array(IMAGE_BYTES).buffer),
  }
  const data = new Map<string, any>()
  data.set('file', file)
  data.set('patientId', PATIENT.id)
  data.set('modality', 'PANORAMIC')
  for (const [k, v] of Object.entries(over)) data.set(k, v)
  return {
    formData: vi.fn().mockResolvedValue({
      get: (key: string) => data.get(key) ?? null,
    }),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthed()
  prisma.patient.findFirst.mockResolvedValue(PATIENT)
  prisma.appointment.findFirst.mockResolvedValue({ id: 'apt-1' })
})

// ──────────────────────────── delegate surface guard ───────────────────────

describe('prisma delegate surface (regression guard)', () => {
  it('exposes aIAnalysisJob (generated-client naming for model AIAnalysisJob) and NOT the typo aiAnalysisJob', () => {
    // The generated client for `model AIAnalysisJob` exposes delegate
    // `aIAnalysisJob`. The shared mock must mirror that surface exactly:
    // a lowercase alias would silently mask the 500 it once hid.
    expect(prisma).toHaveProperty('aIAnalysisJob')
    expect((prisma as any).aIAnalysisJob).toHaveProperty('create')
    expect(prisma).not.toHaveProperty('aiAnalysisJob')
  })
})

// ──────────────────────────── auth / validation ────────────────────────────

describe('POST /api/imaging/studies — auth & validation', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      hospitalId: null,
    })
    const res = await POST(makeUploadForm())
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-doctor roles', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      hospitalId: null,
    })
    const res = await POST(makeUploadForm())
    expect(res.status).toBe(403)
  })

  it('returns 400 when no file is provided', async () => {
    const req = {
      formData: vi.fn().mockResolvedValue({ get: () => null }),
    } as any
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects unsupported image types', async () => {
    const data = new Map<string, any>()
    data.set('file', {
      name: 'x.gif',
      type: 'image/gif',
      size: IMAGE_BYTES.length,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array(IMAGE_BYTES).buffer),
    })
    data.set('patientId', PATIENT.id)
    const req = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => data.get(key) ?? null,
      }),
    } as any
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects oversized files (50MB limit) before touching storage', async () => {
    const data = new Map<string, any>()
    data.set('file', {
      name: 'huge.png',
      type: 'image/png',
      size: 51 * 1024 * 1024,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array(0).buffer),
    })
    data.set('patientId', PATIENT.id)
    const req = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => data.get(key) ?? null,
      }),
    } as any
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('50MB')
    expect(mockStorage.put).not.toHaveBeenCalled()
    expect(prisma.imagingStudy.create).not.toHaveBeenCalled()
  })

  it('rejects patients from other tenants (no oracle)', async () => {
    prisma.patient.findFirst.mockResolvedValue(null)
    const res = await POST(makeUploadForm())
    expect(res.status).toBe(404)
    expect(prisma.imagingStudy.create).not.toHaveBeenCalled()
  })
})

// ──────────────────────────── success paths ────────────────────────────────

describe('POST /api/imaging/studies — upload', () => {
  it('stores the original under a tenant key, creates UPLOADED study, audits', async () => {
    prisma.imagingStudy.create.mockResolvedValue({
      id: 'study-1',
      hospitalId: HOSPITAL,
      patientId: PATIENT.id,
      status: 'UPLOADED',
      originalSize: IMAGE_BYTES.length,
      modality: 'PANORAMIC',
    })
    prisma.auditLog.create.mockResolvedValue({})

    const res = await POST(makeUploadForm())
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.job).toBeNull()

    // storage: tenant-scoped key, content type preserved
    expect(mockStorage.put).toHaveBeenCalledTimes(1)
    const [key, bytes, opts] = mockStorage.put.mock.calls[0]
    expect(key).toMatch(/^hosp-1\/imaging\/pat-1\/.+\/original\.png$/)
    expect(Buffer.compare(Buffer.from(bytes), IMAGE_BYTES)).toBe(0)
    expect(opts.contentType).toBe('image/png')

    // study row
    const data = prisma.imagingStudy.create.mock.calls[0][0].data
    expect(data.hospitalId).toBe(HOSPITAL)
    expect(data.patientId).toBe(PATIENT.id)
    expect(data.status).toBe('UPLOADED')
    expect(data.originalHash).toBe(SHA)
    expect(data.originalKey).toBe(key)
    expect(data.uploadedById).toBe(USER.id)
    expect(data.modality).toBe('PANORAMIC')

    // audit
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    const audit = prisma.auditLog.create.mock.calls[0][0].data
    expect(audit.action).toBe('IMAGING_STUDY_UPLOADED')
    expect(audit.entityType).toBe('ImagingStudy')
    expect(audit.entityId).toBe('study-1')
    expect(audit.userId).toBe(USER.id)
    const nv = JSON.parse(audit.newValues)
    expect(nv.originalHash).toBe(SHA)
    expect(nv.originalKey).toBe(key)
  })

  it('retry/duplicate upload (same patient + file, AI on) creates two independent studies + jobs — no corruption', async () => {
    const studyRow = { id: 'study-r1', hospitalId: HOSPITAL, patientId: PATIENT.id, status: 'UPLOADED', modality: 'PANORAMIC' }
    const studyRow2 = { id: 'study-r2', hospitalId: HOSPITAL, patientId: PATIENT.id, status: 'UPLOADED', modality: 'PANORAMIC' }
    prisma.imagingStudy.create
      .mockResolvedValueOnce(studyRow)
      .mockResolvedValueOnce(studyRow2)
    prisma.aIAnalysisJob.create
      .mockResolvedValueOnce({ ...studyRow, id: 'job-r1' })
      .mockResolvedValueOnce({ ...studyRow2, id: 'job-r2' })
    prisma.auditLog.create.mockResolvedValue({})
    prisma.imagingStudy.findUnique.mockResolvedValue({ id: 'study-r1', status: 'ANALYZED' })
    mockOrchestrator.requestOrchestratorAnalyze.mockResolvedValue({
      job_id: 'job-r1',
      status: 'COMPLETED',
      findings: [],
      provenance: { engine: 'liodon', model_version: '1.0.0', model_checksum: 'f'.repeat(64) },
      processing_time_ms: 100,
      raw_output_key: `${HOSPITAL}/imaging/pat-1/study-r1/ai/liodon/result.json`,
    })

    const res1 = await POST(makeUploadForm({ analyze: 'true' }))
    const res2 = await POST(makeUploadForm({ analyze: 'true' }))
    const body1 = await res1.json()
    const body2 = await res2.json()

    // Each attempt is a distinct study + job (UUID keys), both succeed.
    expect(res1.status).toBe(201)
    expect(res2.status).toBe(201)
    expect(body1.study.id).toBe('study-r1')
    expect(body2.study.id).toBe('study-r2')
    expect(body1.job.id).toBe('job-r1')
    expect(body2.job.id).toBe('job-r2')

    const key1 = mockStorage.put.mock.calls[0][0] as string
    const key2 = mockStorage.put.mock.calls[1][0] as string
    expect(key1).not.toBe(key2) // immutability: originals are never overwritten
    expect(prisma.imagingStudy.create).toHaveBeenCalledTimes(2)
    expect(prisma.aIAnalysisJob.create).toHaveBeenCalledTimes(2)
    // Every job is scoped to the caller's tenant and its own study.
    expect(prisma.aIAnalysisJob.create.mock.calls[0][0].data.studyId).toBe('study-r1')
    expect(prisma.aIAnalysisJob.create.mock.calls[1][0].data.studyId).toBe('study-r2')
  })
})

// ──────────────────────────── AI trigger ───────────────────────────────────

describe('POST /api/imaging/studies — AI trigger (19A D10.1 / 19B D14 engine map)', () => {
  it('routes BITEWING + analyze to implant-ai (19B D14: 2D non-panoramic radiographs)', async () => {
    const studyRow = { id: 'study-2', hospitalId: HOSPITAL, patientId: PATIENT.id, status: 'UPLOADED', modality: 'BITEWING' }
    prisma.imagingStudy.create.mockResolvedValue(studyRow)
    prisma.aIAnalysisJob.create.mockResolvedValue({ ...studyRow, id: 'job-2' })
    prisma.auditLog.create.mockResolvedValue({})
    prisma.imagingStudy.findUnique.mockResolvedValue({ id: 'study-2', status: 'ANALYZED' })
    mockOrchestrator.requestOrchestratorAnalyze.mockResolvedValue({
      job_id: 'job-2',
      status: 'COMPLETED',
      findings: [],
      top_confidence: null,
      provenance: { engine: 'implant-ai', model_version: '1.0.0', model_checksum: 'd'.repeat(64) },
      processing_time_ms: 910,
      raw_output_key: `${HOSPITAL}/imaging/pat-1/study-2/ai/implant-ai/result.json`,
      annotated_image_key: `${HOSPITAL}/imaging/pat-1/study-2/ai/implant-ai/annotated.png`,
    })

    const res = await POST(makeUploadForm({ modality: 'BITEWING', analyze: 'true' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.job.status).toBe('COMPLETED')

    const jobData = prisma.aIAnalysisJob.create.mock.calls[0][0].data
    expect(jobData.engine).toBe('implant-ai')

    const params = mockOrchestrator.requestOrchestratorAnalyze.mock.calls[0][0]
    expect(params.engine).toBe('implant-ai')
    expect(params.modality).toBe('BITEWING')
  })

  it('routes CEPHALOMETRIC + analyze to orthodontic-ai (19B D14: 38 cephalometric landmarks)', async () => {
    const studyRow = { id: 'study-5', hospitalId: HOSPITAL, patientId: PATIENT.id, status: 'UPLOADED', modality: 'CEPHALOMETRIC' }
    prisma.imagingStudy.create.mockResolvedValue(studyRow)
    prisma.aIAnalysisJob.create.mockResolvedValue({ ...studyRow, id: 'job-5' })
    prisma.auditLog.create.mockResolvedValue({})
    prisma.imagingStudy.findUnique.mockResolvedValue({ id: 'study-5', status: 'ANALYZED' })
    mockOrchestrator.requestOrchestratorAnalyze.mockResolvedValue({
      job_id: 'job-5',
      status: 'COMPLETED',
      findings: Array.from({ length: 38 }, (_, i) => ({
        landmark_id: i,
        landmark_name: String(i),
        x: 100 + i,
        y: 200 + i,
        score: 0.9,
        coordinate_space: 'cropped_original_image',
      })),
      top_confidence: 0.9,
      provenance: { engine: 'orthodontic-ai', model_version: '1.0.0', model_checksum: 'e'.repeat(64) },
      processing_time_ms: 19857,
      raw_output_key: `${HOSPITAL}/imaging/pat-1/study-5/ai/orthodontic-ai/result.json`,
      annotated_image_key: `${HOSPITAL}/imaging/pat-1/study-5/ai/orthodontic-ai/annotated.png`,
    })

    const res = await POST(makeUploadForm({ modality: 'CEPHALOMETRIC', analyze: 'true' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.job.status).toBe('COMPLETED')
    expect(body.job.findings).toHaveLength(38)
    expect(body.job.findings[0]).toMatchObject({ landmark_id: 0, landmark_name: '0' })

    const jobData = prisma.aIAnalysisJob.create.mock.calls[0][0].data
    expect(jobData.engine).toBe('orthodontic-ai')

    const params = mockOrchestrator.requestOrchestratorAnalyze.mock.calls[0][0]
    expect(params.engine).toBe('orthodontic-ai')
    expect(params.modality).toBe('CEPHALOMETRIC')
  })

  it('refuses AI for modalities without an image engine (PHOTO) with an explicit 422', async () => {
    prisma.imagingStudy.create.mockResolvedValue({
      id: 'study-6',
      status: 'UPLOADED',
      modality: 'PHOTO',
    })
    prisma.auditLog.create.mockResolvedValue({})

    const res = await POST(makeUploadForm({ modality: 'PHOTO', analyze: 'true' }))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toBe('AI analysis is not supported for this modality')
    expect(body.modality).toBe('PHOTO')
    expect(mockOrchestrator.requestOrchestratorAnalyze).not.toHaveBeenCalled()
    expect(prisma.aIAnalysisJob.create).not.toHaveBeenCalled()
  })

  it('refuses AI for 3D modalities on this image path (THREE_D_SCAN) with an explicit 422', async () => {
    // The MeshSegNet engines need surface-mesh uploads, which this
    // image-based upload path deliberately does not accept (19B D14).
    prisma.imagingStudy.create.mockResolvedValue({
      id: 'study-7',
      status: 'UPLOADED',
      modality: 'THREE_D_SCAN',
    })
    prisma.auditLog.create.mockResolvedValue({})

    const res = await POST(makeUploadForm({ modality: 'THREE_D_SCAN', analyze: 'true' }))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toBe('AI analysis is not supported for this modality')
    expect(body.modality).toBe('THREE_D_SCAN')
    expect(mockOrchestrator.requestOrchestratorAnalyze).not.toHaveBeenCalled()
  })

  it('creates PENDING job, audits, calls orchestrator, returns COMPLETED + findings', async () => {
    const studyRow = { id: 'study-3', hospitalId: HOSPITAL, patientId: PATIENT.id, status: 'UPLOADED', modality: 'PANORAMIC' }
    prisma.imagingStudy.create.mockResolvedValue(studyRow)
    prisma.aIAnalysisJob.create.mockResolvedValue({ ...studyRow, id: 'job-1' })
    prisma.auditLog.create.mockResolvedValue({})
    prisma.imagingStudy.findUnique.mockResolvedValue({ id: 'study-3', status: 'ANALYZED' })
    mockOrchestrator.requestOrchestratorAnalyze.mockResolvedValue({
      job_id: 'job-1',
      status: 'COMPLETED',
      findings: [
        {
          condition: 'caries',
          tooth_number: null,
          confidence: 0.631,
          bounding_box: { x: 1, y: 2, width: 3, height: 4, x2: 4, y2: 6 },
        },
      ],
      top_confidence: 0.631,
      provenance: { engine: 'liodon', model_version: '1.0.0', model_checksum: 'c'.repeat(64) },
      processing_time_ms: 420,
      raw_output_key: `${HOSPITAL}/imaging/pat-1/study-3/ai/liodon/result.json`,
      annotated_image_key: `${HOSPITAL}/imaging/pat-1/study-3/ai/liodon/annotated.png`,
    })

    const res = await POST(makeUploadForm({ analyze: 'true' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.job.status).toBe('COMPLETED')
    expect(body.job.findings[0].condition).toBe('caries')
    expect(body.study.status).toBe('ANALYZED')

    // job created PENDING by Next.js
    const jobData = prisma.aIAnalysisJob.create.mock.calls[0][0].data
    expect(jobData.status).toBe('PENDING')
    expect(jobData.engine).toBe('liodon')
    expect(jobData.hospitalId).toBe(HOSPITAL)
    expect(jobData.requestedById).toBe(USER.id)

    // AI_JOB_REQUESTED audit
    const actions = prisma.auditLog.create.mock.calls.map((c) => c[0].data.action)
    expect(actions).toContain('IMAGING_STUDY_UPLOADED')
    expect(actions).toContain('AI_JOB_REQUESTED')

    // orchestrator received session-derived context + recorded hash
    const params = mockOrchestrator.requestOrchestratorAnalyze.mock.calls[0][0]
    expect(params.jobId).toBe('job-1')
    expect(params.studyId).toBe('study-3')
    expect(params.hospitalId).toBe(HOSPITAL)
    expect(params.imageSha256).toBe(SHA)
    expect(params.engine).toBe('liodon')
    expect(params.modality).toBe('PANORAMIC')
    expect(params.requestedBy).toBe(USER.id)
  })

  it('marks the job FAILED + audits when the orchestrator is unreachable', async () => {
    const studyRow = { id: 'study-4', hospitalId: HOSPITAL, patientId: PATIENT.id, status: 'UPLOADED', modality: 'PANORAMIC' }
    prisma.imagingStudy.create.mockResolvedValue(studyRow)
    prisma.aIAnalysisJob.create.mockResolvedValue({ id: 'job-4' })
    prisma.auditLog.create.mockResolvedValue({})
    prisma.aIAnalysisJob.findUnique.mockResolvedValue({ id: 'job-4', status: 'PENDING' })
    prisma.aIAnalysisJob.update.mockResolvedValue({})
    mockOrchestrator.requestOrchestratorAnalyze.mockRejectedValue(
      new mockOrchestrator.OrchestratorError(503, 'orchestrator unreachable: connection refused')
    )

    const res = await POST(makeUploadForm({ analyze: 'true' }))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.job.status).toBe('FAILED')
    expect(body.error).toContain('unreachable')

    // fallback FAILED transition + audit from this route
    const upd = prisma.aIAnalysisJob.update.mock.calls[0][0]
    expect(upd.where.id).toBe('job-4')
    expect(upd.data.status).toBe('FAILED')
    expect(upd.data.errorMessage).toContain('unreachable')

    const actions = prisma.auditLog.create.mock.calls.map((c) => c[0].data.action)
    expect(actions).toContain('AI_JOB_FAILED')
  })
})

// ──────────────────────────── list (D11) ───────────────────────────────────

describe('GET /api/imaging/studies — list, tenant-guarded', () => {
  it('returns 401 unauthenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      hospitalId: null,
    })
    const res = await GET(new NextRequest('http://localhost/api/imaging/studies'))
    expect(res.status).toBe(401)
  })

  it('returns only this hospital’s studies, mapped', async () => {
    prisma.imagingStudy.findMany.mockResolvedValue([
      {
        id: 'study-9',
        patient: { patientId: 'PTN-1', firstName: 'Amina', lastName: 'Ali' },
        modality: 'PANORAMIC',
        studyType: 'IMAGING',
        status: 'ANALYZED',
        createdAt: new Date('2026-09-26T10:00:00Z'),
        aiJobs: [{ id: 'job-9', status: 'COMPLETED', engine: 'liodon', reviewedAt: null }],
      },
    ])
    const res = await GET(new NextRequest('http://localhost/api/imaging/studies'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(prisma.imagingStudy.findMany.mock.calls[0][0].where.hospitalId).toBe(HOSPITAL)
    expect(body.studies).toHaveLength(1)
    expect(body.studies[0].patientName).toBe('Amina Ali')
    expect(body.studies[0].latestJob.status).toBe('COMPLETED')
  })
})

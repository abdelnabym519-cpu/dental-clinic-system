// @ts-nocheck
/**
 * P9.1 — imaging analyze pre-flight.
 *
 * The bug this guards: the app writes an imaging original through
 * `lib/storage`, whose driver defaults to LOCAL DISK, and then hands the same
 * object key to the FastAPI orchestrator, which reads MinIO/S3 directly. The
 * object is not where the orchestrator looks, and the engine fails much later
 * with a raw `NoSuchKey`.
 *
 * The contract pinned here: when the orchestrator is configured, the route
 * refuses EARLY (503) with an Arabic message and a machine-readable `code` —
 * never a raw storage error, and never a job that pretends to be running.
 *
 * `@/lib/storage/env` is deliberately NOT mocked: the pre-flight must read the
 * REAL rule set, not a test double of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'

import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))

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
  exists: vi.fn(),
  getStorage: vi.fn(() => ({ put: mockStorage.put, exists: mockStorage.exists })),
  buildStorageKey: (h: string, ...rest: string[]) => [h, ...rest].join('/'),
  uploadUrl: (k: string | null | undefined) => (k ? `/api/uploads/${k}` : ''),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/storage', () => mockStorage)
vi.mock('@/lib/ai-orchestrator', () => mockOrchestrator)

const { POST } = await import('@/app/api/imaging/studies/route')

const HOSPITAL = 'hosp-1'
const USER = { id: 'user-1', name: 'Dr. A', role: 'DOCTOR', hospitalId: HOSPITAL }
const PATIENT = { id: 'pat-1' }
const IMAGE_BYTES = Buffer.from('fake-panoramic-xray-bytes')

const SAVED_ENV = {
  ORCHESTRATOR_SECRET: process.env.ORCHESTRATOR_SECRET,
  STORAGE_DRIVER: process.env.STORAGE_DRIVER,
}

function makeUploadForm(over: Record<string, string> = {}) {
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
  data.set('analyze', 'true')
  for (const [k, v] of Object.entries(over)) data.set(k, v)
  return {
    formData: vi.fn().mockResolvedValue({ get: (key: string) => data.get(key) ?? null }),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    user: USER,
    hospitalId: HOSPITAL,
    session: { user: USER },
  })
  prisma.patient.findFirst.mockResolvedValue(PATIENT)
  prisma.appointment.findFirst.mockResolvedValue({ id: 'apt-1' })
  // The route reads `study.modality` off the row it just created, so the mock
  // MUST include it — otherwise the engine lookup returns undefined and the
  // analyze path (and therefore the pre-flight) is never reached.
  prisma.imagingStudy.create.mockResolvedValue({ id: 'study-1', modality: 'PANORAMIC' })
  prisma.imagingStudy.findUnique.mockResolvedValue({ id: 'study-1', status: 'ANALYZED' })
  prisma.aIAnalysisJob.create.mockResolvedValue({ id: 'job-1' })
  prisma.aIAnalysisJob.findUnique.mockResolvedValue({ id: 'job-1', status: 'PENDING' })
  prisma.aIAnalysisJob.update.mockResolvedValue({})
  prisma.auditLog.create.mockResolvedValue({})
  mockStorage.put.mockResolvedValue(undefined)
  mockStorage.exists.mockResolvedValue(true)
  mockOrchestrator.requestOrchestratorAnalyze.mockResolvedValue({
    job_id: 'job-1',
    status: 'COMPLETED',
    findings: [],
    provenance: { engine: 'liodon', model_version: '1.0.0', model_checksum: 'f'.repeat(64) },
    processing_time_ms: 100,
    raw_output_key: `${HOSPITAL}/imaging/pat-1/study-1/ai/liodon/result.json`,
  })
})

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('P9.1 analyze pre-flight — local driver cannot be read by the orchestrator', () => {
  it('refuses with 503 + Arabic + code, and never calls the orchestrator', async () => {
    process.env.ORCHESTRATOR_SECRET = 'test-secret'
    process.env.STORAGE_DRIVER = 'local'

    const res = await POST(makeUploadForm())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('STORAGE_DRIVER_INCOMPATIBLE')
    expect(mockOrchestrator.requestOrchestratorAnalyze).not.toHaveBeenCalled()

    // Arabic, and never a raw storage error leaking to the user.
    expect(body.error).toMatch(/[؀-ۿ]/)
    expect(JSON.stringify(body)).not.toMatch(/NoSuchKey/i)
  })

  it('fires for an unset STORAGE_DRIVER too (the default is local)', async () => {
    process.env.ORCHESTRATOR_SECRET = 'test-secret'
    delete process.env.STORAGE_DRIVER

    const res = await POST(makeUploadForm())
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('STORAGE_DRIVER_INCOMPATIBLE')
  })
})

describe('P9.1 analyze pre-flight — the object must exist in the store', () => {
  it('refuses with 503 + IMAGING_OBJECT_MISSING when the object is absent', async () => {
    process.env.ORCHESTRATOR_SECRET = 'test-secret'
    process.env.STORAGE_DRIVER = 's3'
    mockStorage.exists.mockResolvedValue(false)

    const res = await POST(makeUploadForm())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('IMAGING_OBJECT_MISSING')
    expect(body.error).toMatch(/[؀-ۿ]/)
    expect(mockOrchestrator.requestOrchestratorAnalyze).not.toHaveBeenCalled()
  })

  it('turns a storage-driver throw into an Arabic 503 instead of a stack trace', async () => {
    process.env.ORCHESTRATOR_SECRET = 'test-secret'
    process.env.STORAGE_DRIVER = 's3'
    mockStorage.exists.mockRejectedValue(new Error('NoSuchKey: boom'))

    const res = await POST(makeUploadForm())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('STORAGE_PREFLIGHT_FAILED')
    expect(body.error).toMatch(/[؀-ۿ]/)
    expect(JSON.stringify(body)).not.toMatch(/NoSuchKey/i)
  })

  it('proceeds when the driver is s3 AND the object is present', async () => {
    process.env.ORCHESTRATOR_SECRET = 'test-secret'
    process.env.STORAGE_DRIVER = 's3'
    mockStorage.exists.mockResolvedValue(true)

    const res = await POST(makeUploadForm())

    expect(res.status).not.toBe(503)
    expect(mockStorage.exists).toHaveBeenCalled()
    expect(mockOrchestrator.requestOrchestratorAnalyze).toHaveBeenCalled()
  })
})

describe('P9.1 — the pre-flight stays out of the way when the orchestrator is not configured', () => {
  it('does not run, so the existing "not configured" path is unchanged', async () => {
    delete process.env.ORCHESTRATOR_SECRET
    process.env.STORAGE_DRIVER = 'local'

    const res = await POST(makeUploadForm())

    // The pre-flight must not fire: no 503 with one of our codes.
    const body = await res.json().catch(() => ({}))
    expect(body.code).not.toBe('STORAGE_DRIVER_INCOMPATIBLE')
    expect(body.code).not.toBe('IMAGING_OBJECT_MISSING')
    // The orchestrator is still attempted (and its own failure path applies).
    expect(mockOrchestrator.requestOrchestratorAnalyze).toHaveBeenCalled()
    expect(res.status).toBeDefined()
  })
})

// @ts-nocheck
/**
 * Phase 6 — attachment API routes (§23/§33/§35).
 *
 * Session-resolved actor; tenant-guarded list; signed retrieval (raw key
 * never leaves); PATIENT self-scope; DELETE is staff-only and 409 while an
 * imaging study references the artifact. Prisma is faked; storage is the
 * real local driver pointed at a tmp dir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const store = vi.hoisted(() => ({
  auth: null,
  attachments: [],
  studies: [],
  patients: [],
}))

vi.mock('@/lib/prisma', () => {
  const t = (rows) => ({
    findFirst: async (args) => rows.find((r) => Object.entries(args?.where ?? {}).every(([k, v]) => r[k] === v)) ?? null,
    findMany: async (args) => {
      const out = rows.filter((r) => Object.entries(args?.where ?? {}).every(([k, v]) => r[k] === v))
      return args?.take ? out.slice(0, args.take) : out
    },
    create: async (args) => {
      const row = { id: `gen-${Math.random().toString(36).slice(2, 10)}`, createdAt: new Date(), ...args.data }
      rows.push(row)
      return row
    },
    update: async (args) => {
      const row = rows.find((r) => r.id === args.where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, args.data)
      return row
    },
    delete: async (args) => {
      const i = rows.findIndex((r) => r.id === args.where.id)
      if (i >= 0) rows.splice(i, 1)
      return {}
    },
  })
  return {
    prisma: {
      patient: t(store.patients),
      imagingStudy: t(store.studies),
      multimodalAttachment: t(store.attachments),
      auditLog: t([]),
    },
  }
})

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: async (roles?: string[]) => {
    const a = store.auth
    if (a?.error) return a
    if (roles && a?.user && !roles.includes(a.user.role)) {
      return { error: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), user: null, hospitalId: null }
    }
    return a ?? { error: null, user: { id: 'staff-1', name: 'S', role: 'DOCTOR' }, hospitalId: 'hosp-a' }
  },
}))

// The live-engine view is not the subject under test; make it honest-null.
vi.mock('@/lib/ai/engines/orchestrator-source', () => ({
  createOrchestratorCapabilitySource: () => ({ getHealth: async () => { throw new Error('offline in test') } }),
}))

import { POST, GET } from '@/app/api/ai/attachments/route'
import { GET as GET_ID, DELETE } from '@/app/api/ai/attachments/[id]/route'
import { resetStorage } from '@/lib/storage'
import { pngBuffer, minimalPdfBuffer, dicomBuffer } from '@/tests/fixtures/multimodal-fixture-buffers'

const HOSP = 'hosp-a'
let uploadDir: string

beforeEach(async () => {
  store.auth = { error: null, user: { id: 'staff-1', name: 'S', role: 'DOCTOR' }, hospitalId: HOSP }
  store.attachments.length = 0
  store.studies.length = 0
  store.patients.length = 0
  store.patients.push({ id: 'pat-a1', hospitalId: HOSP, portalUserId: 'user-1', firstName: 'A', lastName: 'B' })
  uploadDir = await mkdtemp(path.join(tmpdir(), 'p6-route-'))
  process.env.UPLOAD_DIR = uploadDir
  process.env.STORAGE_DRIVER = 'local'
  resetStorage()
})

afterEach(async () => {
  resetStorage()
  delete process.env.UPLOAD_DIR
  await rm(uploadDir, { recursive: true, force: true })
})

// Stub multipart request (repo pattern — real File parts, no NextRequest
// body serialization, which hangs under jsdom). jsdom's File lacks
// arrayBuffer(); patch it per instance (the route reads via arrayBuffer).
function multipartFile(buffer: Buffer, name: string, type?: string): File {
  const f = new File([buffer], name, { type: type ?? 'application/octet-stream' })
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  ;(f as any).arrayBuffer = () => Promise.resolve(ab)
  return f
}

function multipart(fields: Record<string, string> = {}, file?: { buffer: Buffer; name: string; type?: string }) {
  const map = new Map<string, any>()
  if (file) map.set('file', multipartFile(file.buffer, file.name, file.type))
  for (const [k, v] of Object.entries(fields)) map.set(k, v)
  return { formData: async () => ({ get: (key: string) => map.get(key) ?? null }) } as any
}

describe('POST /api/ai/attachments', () => {
  it('201 + safe ref + honest capability for a staff-declared panoramic PNG', async () => {
    const res = await POST(multipart({ patientId: 'pat-a1', modality: 'PANORAMIC', conversationId: 'conv-9' }, { buffer: pngBuffer(), name: 'pano.png', type: 'image/png' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.attachment.id).toBeTruthy()
    expect(body.attachment.fileClass).toBe('IMAGE_2D')
    expect(body.attachment.dentalModality).toBe('PANORAMIC')
    expect(body.attachment.originalName).toBe('pano.png')
    // The raw storage key NEVER leaves the server.
    expect(JSON.stringify(body)).not.toContain('storageKey')
    expect(JSON.stringify(body)).not.toContain('sha256')
    // Honest capability: ingestion+preprocessing supported; AI unknown offline.
    expect(body.capability.ingestion).toBe('INGESTION_SUPPORTED')
    expect(body.capability.preprocessing).toBe('PREPROCESSING_SUPPORTED')
  })

  it('413 before buffering when the part size exceeds the global max', async () => {
    // The route checks file.size BEFORE reading the body into a Buffer. A
    // real >500MB multipart body is not constructible in a test, so the
    // guard is exercised through a stub whose formData() yields an oversized
    // File (size reflects the part's declared length in production).
    const big = new File([new Uint8Array(16)], 'big.dcm')
    Object.defineProperty(big, 'size', { value: 501 * 1024 * 1024 })
    const map = new Map<string, any>([['file', big]])
    const stubReq = { formData: async () => ({ get: (k: string) => map.get(k) ?? null }) } as any
    const res = await POST(stubReq)
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.code).toBe('OVERSIZED_INPUT')
    expect(body.error).toBe('File is too large') // translatable prose, not a code
  })

  it('400 when no file part is present', async () => {
    const res = await POST(multipart({ patientId: 'pat-a1' }))
    expect(res.status).toBe(400)
  })

  it('403 for traversal in the filename (typed, no infra leak)', async () => {
    const res = await POST(multipart({}, { buffer: pngBuffer(), name: '../../evil.png' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PATH_TRAVERSAL_REJECTED')
    expect(body.error).toBe('The file name is not allowed')
    expect(JSON.stringify(body)).not.toMatch(/ENOENT|\/home\/user|evil/)
  })

  it('403 when a PATIENT actor references another patient', async () => {
    store.auth = { error: null, user: { id: 'user-2', name: 'P', role: 'PATIENT' }, hospitalId: HOSP }
    store.patients.push({ id: 'pat-a2', hospitalId: HOSP, portalUserId: 'user-2', firstName: 'C', lastName: 'D' })
    const res = await POST(multipart({ patientId: 'pat-a1' }, { buffer: pngBuffer(), name: 'x.png' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('PATIENT_SCOPE_MISMATCH')
    expect(body.error).toBe('This attachment belongs to a different patient')
  })

  it('DICOM upload → 201 with ingestion-only capability (no AI claimed)', async () => {
    const res = await POST(multipart({ conversationId: 'conv-9' }, { buffer: dicomBuffer(), name: 'vol.dcm' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.attachment.fileClass).toBe('VOLUME_DICOM')
    expect(body.capability.aiAnalysis).toBe('AI_ANALYSIS_UNSUPPORTED')
  })
})

describe('GET /api/ai/attachments', () => {
  it('lists a conversation attachments, tenant-scoped', async () => {
    store.attachments.push(
      { id: 'att-1', hospitalId: HOSP, conversationId: 'conv-9', patientId: 'pat-a1', originalName: 'a.png', fileName: 'f1.png', mediaType: 'image/png', fileClass: 'IMAGE_2D', dentalModality: 'PANORAMIC', modalityOrigin: 'DECLARED', dentalImageState: 'CLASSIFIED', size: 10, sha256: 'x', storageKey: `${HOSP}/ai/attachments/u1/f1.png`, source: 'CHAT_UPLOAD', status: 'PROCESSED', studyId: null, createdAt: new Date() },
      { id: 'att-2', hospitalId: HOSP, conversationId: 'other', patientId: 'pat-a1', originalName: 'b.png', fileName: 'f2.png', mediaType: 'image/png', fileClass: 'IMAGE_2D', dentalModality: null, modalityOrigin: 'NONE', dentalImageState: 'UNKNOWN_DENTAL_IMAGE', size: 10, sha256: 'y', storageKey: `${HOSP}/ai/attachments/u2/f2.png`, source: 'CHAT_UPLOAD', status: 'PROCESSED', studyId: null, createdAt: new Date() },
      { id: 'att-3', hospitalId: 'hosp-b', conversationId: 'conv-9', patientId: null, originalName: 'c.png', fileName: 'f3.png', mediaType: 'image/png', fileClass: 'IMAGE_2D', dentalModality: null, modalityOrigin: 'NONE', dentalImageState: null, size: 10, sha256: 'z', storageKey: `hosp-b/ai/attachments/u3/f3.png`, source: 'CHAT_UPLOAD', status: 'PROCESSED', studyId: null, createdAt: new Date() },
    )
    const res = await GET(new NextRequest('http://localhost/api/ai/attachments?conversationId=conv-9'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attachments.map((a) => a.id)).toEqual(['att-1'])
  })

  it('400 without conversationId', async () => {
    const res = await GET(new NextRequest('http://localhost/api/ai/attachments'))
    expect(res.status).toBe(400)
  })
})

describe('GET/DELETE /api/ai/attachments/:id', () => {
  const base = {
    hospitalId: HOSP, patientId: 'pat-a1', conversationId: 'conv-9', originalName: 'a.png',
    fileName: 'f1.png', mediaType: 'image/png', fileClass: 'IMAGE_2D', dentalModality: 'PANORAMIC',
    modalityOrigin: 'DECLARED', dentalImageState: 'CLASSIFIED', size: 10, sha256: 'x',
    storageKey: `${HOSP}/ai/attachments/u1/f1.png`, source: 'CHAT_UPLOAD', status: 'PROCESSED',
  }

  it('staff GET → ref + route URL; the raw key is NOT exposed as a field', async () => {
    store.attachments.push({ id: 'att-1', studyId: null, createdAt: new Date(), ...base })
    const res = await GET_ID(new NextRequest('http://localhost/api/ai/attachments/att-1'), { params: Promise.resolve({ id: 'att-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attachment.id).toBe('att-1')
    expect(typeof body.url).toBe('string')
    expect(body).not.toHaveProperty('storageKey')
  })

  it('PATIENT GET on someone else patient-attributed attachment → 403', async () => {
    store.attachments.push({ id: 'att-1', studyId: null, createdAt: new Date(), ...base })
    store.auth = { error: null, user: { id: 'user-9', name: 'P', role: 'PATIENT' }, hospitalId: HOSP }
    const res = await GET_ID(new NextRequest('http://localhost/api/ai/attachments/att-1'), { params: Promise.resolve({ id: 'att-1' }) })
    expect(res.status).toBe(403)
  })

  it('PATIENT GET on their own attachment → 200', async () => {
    store.attachments.push({ id: 'att-1', studyId: null, createdAt: new Date(), ...base })
    store.auth = { error: null, user: { id: 'user-1', name: 'P', role: 'PATIENT' }, hospitalId: HOSP }
    const res = await GET_ID(new NextRequest('http://localhost/api/ai/attachments/att-1'), { params: Promise.resolve({ id: 'att-1' }) })
    expect(res.status).toBe(200)
  })

  it('forged id (different tenant / unknown) → 404', async () => {
    store.attachments.push({ ...base, id: 'att-a', studyId: null, createdAt: new Date(), storageKey: `${HOSP}/ai/attachments/ua/f.png`, fileName: 'f.png' })
    store.attachments.push({ ...base, id: 'att-b', hospitalId: 'hosp-b', studyId: null, createdAt: new Date(), storageKey: `hosp-b/ai/attachments/ub/f.png`, fileName: 'f.png' })
    const resA = await GET_ID(new NextRequest('http://localhost/api/ai/attachments/att-b'), { params: Promise.resolve({ id: 'att-b' }) })
    const resB = await GET_ID(new NextRequest('http://localhost/api/ai/attachments/nope'), { params: Promise.resolve({ id: 'nope' }) })
    expect(resA.status).toBe(404)
    expect(resB.status).toBe(404)
  })

  it('tampered storageKey pointing at another tenant → 403', async () => {
    store.attachments.push({ ...base, id: 'att-1', studyId: null, createdAt: new Date(), storageKey: `hosp-b/ai/attachments/stolen/f1.png` })
    const res = await GET_ID(new NextRequest('http://localhost/api/ai/attachments/att-1'), { params: Promise.resolve({ id: 'att-1' }) })
    expect(res.status).toBe(403)
  })

  it('DELETE with a referencing study → 409 (imaging owns the lifecycle)', async () => {
    store.attachments.push({ id: 'att-1', studyId: 'study-1', createdAt: new Date(), ...base })
    const res = await DELETE(new NextRequest('http://localhost/api/ai/attachments/att-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'att-1' }) })
    expect(res.status).toBe(409)
    expect(store.attachments).toHaveLength(1)
  })

  it('DELETE without study reference → 200 and row removed', async () => {
    store.attachments.push({ id: 'att-1', studyId: null, createdAt: new Date(), ...base })
    const res = await DELETE(new NextRequest('http://localhost/api/ai/attachments/att-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'att-1' }) })
    expect(res.status).toBe(200)
    expect(store.attachments).toHaveLength(0)
  })

  it('DELETE by a PATIENT actor → 401/403 (staff-only)', async () => {
    store.attachments.push({ id: 'att-1', studyId: null, createdAt: new Date(), ...base })
    store.auth = { error: null, user: { id: 'user-1', name: 'P', role: 'PATIENT' }, hospitalId: HOSP }
    const res = await DELETE(new NextRequest('http://localhost/api/ai/attachments/att-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'att-1' }) })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(store.attachments).toHaveLength(1)
  })
})

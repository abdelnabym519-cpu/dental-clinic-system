// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => ({
  requireAuthAndRole: vi.fn(),
}))

const mockStorage = vi.hoisted(() => ({
  get: vi.fn(),
  getStorage: vi.fn(() => ({ get: mockStorage.get })),
}))

const mockJimp = vi.hoisted(() => ({
  read: vi.fn(),
  Jimp: { read: null },
}))
mockJimp.Jimp.read = mockJimp.read

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/storage', () => mockStorage)
vi.mock('jimp', () => ({ Jimp: mockJimp.Jimp }))

const { GET } = await import('@/app/api/imaging/studies/[id]/report/route')

const HOSPITAL = 'hosp-1'

// 1x1 RGB JPEG (valid SOF0, 3 components).
const RGB_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APxfr/Kc/wC/g//Z',
  'base64'
)

function mockAuthed() {
  mockAuth.requireAuthAndRole.mockResolvedValue({
    error: null,
    user: { id: 'user-1', role: 'DOCTOR' },
    hospitalId: HOSPITAL,
    session: { user: { id: 'user-1' } },
  })
}

function makeStudy(over = {}) {
  return {
    id: 'study-1',
    hospitalId: HOSPITAL,
    patientId: 'pat-1',
    modality: 'PANORAMIC',
    originalKey: 'hosp-1/imaging/pat-1/study-1/original.jpg',
    mimeType: 'image/jpeg',
    studyDate: new Date('2026-09-01T09:00:00Z'),
    status: 'ANALYZED',
    createdAt: new Date('2026-09-01T09:00:00Z'),
    patient: { patientId: 'P-001', firstName: 'Amina', lastName: 'Ali' },
    aiJobs: [],
    ...over,
  }
}

function makeJob(over = {}) {
  return {
    id: 'job-1',
    engine: 'liodon',
    status: 'COMPLETED',
    findings: [
      { condition: 'caries', confidence: 0.63, tooth_number: null, bounding_box: { x: 1, y: 2, width: 3, height: 4, x2: 4, y2: 6 } },
      { condition: 'impacted_tooth', confidence: 0.54, tooth_number: null, bounding_box: { x: 7, y: 8, width: 9, height: 10, x2: 16, y2: 18 } },
    ],
    reviewDecision: null,
    reviewNotes: null,
    reviewedAt: null,
    acceptedFindings: null,
    reviewedBy: null,
    ...over,
  }
}

async function call(urlPath) {
  return GET(new NextRequest(urlPath), { params: Promise.resolve({ id: 'study-1' }) })
}

async function pdfText(res) {
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer()).toString('latin1')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/imaging/studies/:id/report — auth & tenancy', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: { status: 401 }, user: null, hospitalId: null })
    const res = await call('http://localhost/api/imaging/studies/study-1/report')
    expect(res.status).toBe(401)
  })

  it('forwards the RBAC error (ACCOUNTANT has no imaging access)', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: { status: 403 }, user: null, hospitalId: null })
    const res = await call('http://localhost/api/imaging/studies/study-1/report')
    expect(res.status).toBe(403)
  })

  it('404 for a foreign/missing study', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(null)
    const res = await call('http://localhost/api/imaging/studies/other/report')
    expect(res.status).toBe(404)
  })

  it('queries tenant-scoped', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(makeStudy())
    mockStorage.get.mockResolvedValue({ body: new Uint8Array(RGB_JPEG), contentType: 'image/jpeg', size: RGB_JPEG.length })
    await call('http://localhost/api/imaging/studies/study-1/report')
    expect(prisma.imagingStudy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'study-1', hospitalId: HOSPITAL } })
    )
  })
})

describe('GET /api/imaging/studies/:id/report — PDF content', () => {
  it('embeds a JPEG original via DCTDecode with PDF headers', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(makeStudy({ aiJobs: [makeJob()] }))
    mockStorage.get.mockResolvedValue({
      body: new Uint8Array(RGB_JPEG),
      contentType: 'image/jpeg',
      size: RGB_JPEG.length,
    })

    const res = await call('http://localhost/api/imaging/studies/study-1/report?lang=en-US')
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="imaging-report-study-1.pdf"'
    )

    const text = await pdfText(res)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/DCTDecode')
    // Patient + findings content (EN locale, ASCII-safe assertions).
    expect(text).toContain('Patient: Amina Ali')
    expect(text).toContain('Caries')
    expect(text).toContain('Impacted tooth')
    expect(text).toContain('63%')
  })

  it('marks a reviewed report with the review date and doctor', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(
      makeStudy({
        aiJobs: [
          makeJob({
            reviewDecision: 'ACCEPTED',
            reviewedAt: new Date('2026-09-27T12:00:00Z'),
            reviewedBy: { name: 'Dr. Ahmed' },
            acceptedFindings: [1, 2],
          }),
        ],
      })
    )
    mockStorage.get.mockResolvedValue({ body: new Uint8Array(RGB_JPEG), contentType: 'image/jpeg', size: RGB_JPEG.length })

    const text = await pdfText(await call('http://localhost/api/imaging/studies/study-1/report?lang=en-US'))
    expect(text).toContain('2026-09-27') // the reviewed-by line
    expect(text).toContain('Dr. Ahmed')
    expect(text).toContain('All findings accepted')
  })

  it('does NOT stamp an unreviewed report as reviewed', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(makeStudy({ aiJobs: [makeJob()] }))
    mockStorage.get.mockResolvedValue({ body: new Uint8Array(RGB_JPEG), contentType: 'image/jpeg', size: RGB_JPEG.length })

    const text = await pdfText(await call('http://localhost/api/imaging/studies/study-1/report?lang=en-US'))
    expect(text).not.toContain('2026-09-27')
    expect(text).toContain('Not yet reviewed')
    // Honest footer for the unreviewed state.
    expect(text).toContain('AI output pending doctor review')
  })

  it('renders a valid Arabic PDF (embedded font path)', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(makeStudy({ aiJobs: [makeJob()] }))
    mockStorage.get.mockResolvedValue({ body: new Uint8Array(RGB_JPEG), contentType: 'image/jpeg', size: RGB_JPEG.length })

    const text = await pdfText(await call('http://localhost/api/imaging/studies/study-1/report?lang=ar-EG'))
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/NotoNaskhArabic')
  })

  it('PNG studies convert through jimp (resize when wider than 1600)', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(
      makeStudy({ mimeType: 'image/png', originalKey: 'hosp-1/imaging/pat-1/study-1/original.png' })
    )
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    mockStorage.get.mockResolvedValue({ body: pngBytes, contentType: 'image/png', size: pngBytes.length })

    const resize = vi.fn()
    mockJimp.read.mockResolvedValue({
      width: 2000,
      height: 1500,
      resize,
      getBuffer: vi.fn().mockResolvedValue(RGB_JPEG),
    })

    const text = await pdfText(await call('http://localhost/api/imaging/studies/study-1/report?lang=en-US'))
    expect(mockJimp.read).toHaveBeenCalledWith(Buffer.from(pngBytes))
    expect(resize).toHaveBeenCalledWith({ w: 1600 })
    expect(text).toContain('/DCTDecode')
  })

  it('skips resize when the image is already within 1600px', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(
      makeStudy({ mimeType: 'image/png', originalKey: 'hosp-1/imaging/pat-1/study-1/original.png' })
    )
    mockStorage.get.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png', size: 3 })

    const resize = vi.fn()
    mockJimp.read.mockResolvedValue({
      width: 800,
      height: 600,
      resize,
      getBuffer: vi.fn().mockResolvedValue(RGB_JPEG),
    })

    await pdfText(await call('http://localhost/api/imaging/studies/study-1/report?lang=en-US'))
    expect(resize).not.toHaveBeenCalled()
  })

  it('degrades to a report without image when the codec fails (honest note line)', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(
      makeStudy({
        mimeType: 'image/webp',
        originalKey: 'hosp-1/imaging/pat-1/study-1/original.webp',
        aiJobs: [makeJob()],
      })
    )
    mockStorage.get.mockResolvedValue({ body: new Uint8Array([1]), contentType: 'image/webp', size: 1 })
    mockJimp.read.mockRejectedValue(new Error('unsupported codec'))

    const text = await pdfText(await call('http://localhost/api/imaging/studies/study-1/report?lang=en-US'))
    expect(text).not.toContain('/DCTDecode')
    expect(text).toContain('Original image could not be embedded')
    // The clinical content survives.
    expect(text).toContain('Caries')
  })

  it('degrades when the original object is missing from storage', async () => {
    mockAuthed()
    prisma.imagingStudy.findFirst.mockResolvedValue(makeStudy())
    mockStorage.get.mockRejectedValue(new Error('not found'))

    const text = await pdfText(await call('http://localhost/api/imaging/studies/study-1/report?lang=en-US'))
    expect(text).toContain('Original image could not be embedded')
  })
})

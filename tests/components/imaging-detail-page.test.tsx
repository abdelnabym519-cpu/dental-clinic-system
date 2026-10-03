// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { LanguageProvider } from '@/components/providers/language-provider'
import Page from '@/app/(dashboard)/imaging/[id]/page'

// Phase 20B — the study detail page must render MeshSegNet results as a
// 15-class segment table (percentage + total points, no image overlay) and a
// 3D study's original as a file card (mesh — no <img>), while keeping the
// doctor-review gate for mesh results.

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'study-3d' }),
}))

const SEGMENTS = [
  { class_id: 0, class_name: 'Gingiva', point_count: 12000 },
  ...Array.from({ length: 14 }, (_, i) => ({
    class_id: i + 1,
    class_name: `Tooth_${i + 1}`,
    point_count: 500,
  })),
]
// total = 12000 + 14*500 = 19000 → Gingiva 63.2%, each tooth 2.6%

const STUDY = {
  id: 'study-3d',
  patientId: 'pat-1',
  patient: { patientId: 'pat-1', firstName: 'Sara', lastName: 'A.' },
  modality: 'THREE_D_SCAN',
  status: 'ANALYZED',
  originalKey: 'hosp-1/imaging/pat-1/study-3d/original.obj',
  originalHash: 'ab'.repeat(32),
  originalSize: 4821337,
  originalUrl: '/api/uploads/hosp-1/imaging/pat-1/study-3d/original.obj',
  annotatedUrl: null,
  aiJobs: [
    {
      id: 'job-3d',
      engine: 'meshsegnet-max',
      status: 'COMPLETED',
      modelVersion: '1.0.0',
      modelChecksum: '727cd3c5'.padEnd(64, '0'),
      processingTimeMs: 8412,
      findings: SEGMENTS,
      confidence: null,
      errorMessage: null,
      provenance: {
        engine: 'meshsegnet-max',
        model_version: '1.0.0',
        model_checksum: '727cd3c5'.padEnd(64, '0'),
        image_sha256: 'ab'.repeat(32),
        processing_time_ms: 8412,
      },
      reviewedById: null,
      reviewedAt: null,
      reviewDecision: null,
      reviewNotes: null,
      acceptedFindings: null,
      reviewedBy: null,
      createdAt: '2026-09-29T10:00:00.000Z',
      completedAt: '2026-09-29T10:00:08.000Z',
    },
  ],
}

function mockFetchStudy() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ study: STUDY }) }))
  )
}

function renderPage() {
  return render(
    <LanguageProvider initialLocale="ar-EG">
      <Page />
    </LanguageProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Imaging study detail — MeshSegNet (Phase 20B)', () => {
  it('renders the 15-class segment table with share bars and total points', async () => {
    mockFetchStudy()
    renderPage()

    await waitFor(() => expect(screen.getByText('تحليل المسح ثلاثي الأبعاد')).toBeTruthy())

    // 15 classes, all names present (neutral vocabulary, verbatim).
    expect(screen.getByText('Gingiva')).toBeTruthy()
    expect(screen.getByText('Tooth_14')).toBeTruthy()

    // Point counts + computed shares (14 tooth classes share the same pct).
    expect(screen.getByText('12000')).toBeTruthy()
    expect(screen.getByText('63.2%')).toBeTruthy()
    expect(screen.getAllByText('2.6%')).toHaveLength(14)
    // The classes label + total share one <p> — match by substring.
    const summary = screen.getByText((content, el) =>
      el?.tagName === 'P' && content?.includes('إجمالي النقاط: 19000')
    )
    expect(summary.textContent).toContain('الأصناف المكتشفة: 15')
    expect(summary.textContent).toContain('إجمالي النقاط: 19000')
  })

  it('shows a file card (no <img>) for the 3D original + a download link', async () => {
    mockFetchStudy()
    renderPage()

    await waitFor(() => expect(screen.getByText('تنزيل الملف الأصلي')).toBeTruthy())
    expect(screen.getByText('ملف شبكة ثلاثي الأبعاد (لا توجد معاينة ثنائية الأبعاد)')).toBeTruthy()
    expect(screen.getByText(/original\.obj/)).toBeTruthy()

    // A mesh is not an image: no <img> anywhere on the page (the annotated
    // slot is empty for 3D too — the engines emit no annotated image).
    expect(document.querySelector('img')).toBeNull()
  })

  it('labels the modality through the dictionary and keeps the doctor-review gate', async () => {
    mockFetchStudy()
    renderPage()

    await waitFor(() => expect(screen.getByText('مسح ثلاثي الأبعاد · study-3d')).toBeTruthy())

    // Review controls are present for COMPLETED mesh jobs (ACCEPT/MODIFY/REJECT).
    expect(screen.getByRole('button', { name: 'قبول النتائج' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'تعديل النتائج' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'رفض النتائج' })).toBeTruthy()
    expect(screen.getByText('نتائج الذكاء الاصطناعي')).toBeTruthy()
  })
})

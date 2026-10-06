// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { DentalChartWorkspace, parseToothNumbers } from '@/components/dental-chart/interactive/DentalChartWorkspace'
import { useDentalChartStore } from '@/lib/dental-chart/chart-state'

// Toast + session mocks (same pattern as the odontogram component suite)
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const mockSession = { role: 'DOCTOR' }
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: mockSession }, status: 'authenticated' }),
}))

// jsdom has no fetch implementation guarantees for this flow — mock globally
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const ENTRY_16 = {
  id: 'e1',
  patientId: 'patient-1',
  hospitalId: 'hospital-1',
  toothNumber: 16,
  toothNotation: '16',
  condition: 'CARIES',
  severity: 'MODERATE',
  mesial: false,
  distal: false,
  occlusal: true,
  buccal: false,
  lingual: false,
  notes: null,
  diagnosedDate: new Date('2026-02-01'),
  resolvedDate: null,
}

const SUMMARY = {
  patient: { id: 'patient-1', name: 'أحمد محمد' },
  entries: [ENTRY_16],
  procedures: [
    {
      id: 'item-1',
      procedureName: 'حشو مركب',
      status: 'PENDING',
      estimatedCost: '350.00',
      planId: 'plan-1',
      toothNumbers: '16',
    },
  ],
  activePlan: { id: 'plan-1', status: 'ACCEPTED' },
  imaging: [
    {
      toothNumber: 16,
      studyId: 'study-9',
      studyDate: '2026-02-10T00:00:00.000Z',
      modality: 'PERIAPICAL',
      label: 'CARIES',
      confidence: 0.92,
    },
  ],
  statusByTooth: { 16: 'planned' },
  catalog: [{ id: 'proc-1', name: 'حشو مركب', basePrice: '350.00' }],
}

function mockSummaryFetch(ok = true, status = 200) {
  fetchMock.mockImplementation(async (url) => ({
    ok: ok ? true : false,
    status: ok ? status : 403,
    json: async () => (ok ? SUMMARY : { error: 'forbidden' }),
  }))
}

describe('DentalChartWorkspace (interactive 2D/3D + clinical panel)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession.role = 'DOCTOR'
    useDentalChartStore.getState().reset()
  })

  it('loads the summary and renders 2D + legend + empty-selection hint', async () => {
    mockSummaryFetch()
    render(<DentalChartWorkspace patientId="patient-1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/dental-chart/patient-1/summary', expect.anything()))
    expect(screen.getByTestId('dental-chart-2d')).toBeTruthy()
    expect(screen.getByText('Select a tooth to view its details')).toBeTruthy()
  })

  it('selection (from the shared store, e.g. via 3D) opens the clinical context panel', async () => {
    mockSummaryFetch()
    render(<DentalChartWorkspace patientId="patient-1" />)
    await waitFor(() => expect(screen.getByTestId('dental-chart-2d')).toBeTruthy())
    // as if the user had clicked tooth 16 in the 3D view:
    act(() => useDentalChartStore.getState().setSelectedTooth(16))
    const panel = await screen.findByTestId('tooth-context-panel')
    expect(panel).toBeTruthy()
    // findings + procedures + imaging for tooth 16 are all present
    expect(panel.textContent).toContain('Clinical findings (1)')
    expect(panel.textContent).toContain('Procedures (1)')
    expect(panel.textContent).toContain('Related X-rays (1)')
    // doctor can modify
    expect(panel.textContent).toContain('Add procedure')
  })

  it('clinical status is derived from the summary and shown on the panel badge (sync rule 3)', async () => {
    mockSummaryFetch()
    render(<DentalChartWorkspace patientId="patient-1" />)
    await waitFor(() => expect(screen.getByTestId('dental-chart-2d')).toBeTruthy())
    act(() => useDentalChartStore.getState().setSelectedTooth(16))
    const panel = await screen.findByTestId('tooth-context-panel')
    // summary says 16 = planned (pending procedure) → badge reflects it
    expect(panel.textContent).toContain('Planned')
  })

  it('RECEPTIONIST is read-only: no mutation controls in the panel', async () => {
    mockSummaryFetch()
    mockSession.role = 'RECEPTIONIST'
    render(<DentalChartWorkspace patientId="patient-1" />)
    await waitFor(() => expect(screen.getByTestId('dental-chart-2d')).toBeTruthy())
    act(() => useDentalChartStore.getState().setSelectedTooth(16))
    const panel = await screen.findByTestId('tooth-context-panel')
    expect(panel.textContent).not.toContain('Add procedure')
    expect(panel.textContent).not.toContain('Add finding')
  })

  it('3D mode in jsdom (no WebGL) shows the localized fallback, 2D stays intact', async () => {
    mockSummaryFetch()
    render(<DentalChartWorkspace patientId="patient-1" />)
    await waitFor(() => expect(screen.getByTestId('dental-chart-2d')).toBeTruthy())
    act(() => useDentalChartStore.getState().setViewMode('3d'))
    await waitFor(() => expect(screen.getByTestId('dental-chart-webgl-fallback')).toBeTruthy())
    // 2D is gone in 3d mode, fallback is honest
    expect(screen.queryByTestId('dental-chart-2d')).toBeNull()
    act(() => useDentalChartStore.getState().setViewMode('split'))
    await waitFor(() => expect(screen.getByTestId('dental-chart-webgl-fallback')).toBeTruthy())
    expect(screen.getByTestId('dental-chart-2d')).toBeTruthy()
  })

  it('add-finding posts to the existing API with surfaces, then refetches from the DB', async () => {
    mockSummaryFetch()
    render(<DentalChartWorkspace patientId="patient-1" />)
    await waitFor(() => expect(screen.getByTestId('dental-chart-2d')).toBeTruthy())
    act(() => useDentalChartStore.getState().setSelectedTooth(16))
    const panel = await screen.findByTestId('tooth-context-panel')
    fireEvent.click(screen.getByText('Add finding'))
    const form = document.querySelector('[data-testid="add-finding-form"]')
    expect(form).toBeTruthy()
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dental-chart',
        expect.objectContaining({ method: 'POST' })
      )
    )
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === '/api/dental-chart')[1].body)
    expect(body).toMatchObject({ patientId: 'patient-1', toothNumber: 16, condition: 'CARIES' })
    expect(body.occlusal === undefined || typeof body.occlusal === 'boolean').toBe(true)
  })

  it('summary fetch failure renders the localized error state', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    render(<DentalChartWorkspace patientId="patient-1" />)
    await waitFor(() => expect(screen.getByTestId('dental-chart-error')).toBeTruthy())
  })

  it('parseToothNumbers handles the Phase-11 comma-separated FDI string', () => {
    expect(parseToothNumbers('16, 17,48')).toEqual([16, 17, 48])
    expect(parseToothNumbers(null)).toEqual([])
    expect(parseToothNumbers('')).toEqual([])
    expect(parseToothNumbers('99,16')).toEqual([16]) // invalid FDI dropped
  })
})

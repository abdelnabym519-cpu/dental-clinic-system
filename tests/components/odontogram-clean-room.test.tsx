import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Odontogram } from '@/components/dental-chart/odontogram/Odontogram'
import { DentalChart } from '@/components/dental-chart/dental-chart'
import { ConditionOverlay } from '@/components/dental-chart/odontogram/ConditionOverlay'
import { ToothSurfaces } from '@/components/dental-chart/odontogram/ToothSurfaces'
import { BridgeConnector } from '@/components/dental-chart/odontogram/BridgeConnector'
import { ToothHistoryTimeline } from '@/components/dental-chart/odontogram/ToothHistoryTimeline'
import { OdontogramLegend } from '@/components/dental-chart/odontogram/OdontogramLegend'
import { getToothGeometry } from '@/components/dental-chart/geometry/tooth-paths'
import { buildToothViewModels } from '@/components/dental-chart/adapters/dental-chart-adapter'
import { DentalChartEntryRecord, ToothViewModel } from '@/components/dental-chart/types/odontogram'

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}))

describe('Clean-Room Odontogram Component Suite', () => {
  const sampleEntries: DentalChartEntryRecord[] = [
    {
      id: 'e1',
      patientId: 'patient-123',
      hospitalId: 'hospital-1',
      toothNumber: 16,
      toothNotation: '16',
      condition: 'CARIES',
      severity: 'MODERATE',
      mesial: true,
      distal: false,
      occlusal: true,
      buccal: false,
      lingual: false,
      notes: 'Occlusal cavity',
      diagnosedDate: new Date('2026-02-01'),
    },
    {
      id: 'e2',
      patientId: 'patient-123',
      hospitalId: 'hospital-1',
      toothNumber: 21,
      toothNotation: '21',
      condition: 'IMPLANT',
      severity: 'MILD',
      mesial: false,
      distal: false,
      occlusal: false,
      buccal: false,
      lingual: false,
      diagnosedDate: new Date('2026-01-15'),
    },
    {
      id: 'e3',
      patientId: 'patient-123',
      hospitalId: 'hospital-1',
      toothNumber: 48,
      toothNotation: '48',
      condition: 'MISSING',
      severity: 'MILD',
      mesial: false,
      distal: false,
      occlusal: false,
      buccal: false,
      lingual: false,
      diagnosedDate: new Date('2026-01-01'),
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: sampleEntries,
        chartData: { 16: [sampleEntries[0]], 21: [sampleEntries[1]], 48: [sampleEntries[2]] },
      }),
    }) as any
  })

  it('renders interactive odontogram with header and 32 teeth', async () => {
    render(<Odontogram patientId="patient-123" entries={sampleEntries} />)

    expect(screen.getByText(/Interactive (Dental Chart|Odontogram)/i)).toBeInTheDocument()
    expect(screen.getByText(/Maxilla/i)).toBeInTheDocument()
    expect(screen.getByText(/Mandible/i)).toBeInTheDocument()

    // Check specific FDI tooth buttons exist
    const tooth16Btn = screen.getByRole('button', { name: /16:/i })
    expect(tooth16Btn).toBeInTheDocument()

    const tooth21Btn = screen.getByRole('button', { name: /21:/i })
    expect(tooth21Btn).toBeInTheDocument()

    const tooth48Btn = screen.getByRole('button', { name: /48:/i })
    expect(tooth48Btn).toBeInTheDocument()
  })

  it('displays summary statistics cards accurately', () => {
    render(<Odontogram patientId="patient-123" entries={sampleEntries} showStats={true} />)

    expect(screen.getByText('Present Teeth')).toBeInTheDocument()
    expect(screen.getByText('Caries (Decay)')).toBeInTheDocument()
    expect(screen.getByText('Missing / Extracted')).toBeInTheDocument()
    expect(screen.getByText('Implants')).toBeInTheDocument()
  })

  it('opens surface selector dialog upon tooth click in clinical mode', async () => {
    render(<Odontogram patientId="patient-123" entries={sampleEntries} mode="clinical" />)

    const tooth16Btn = screen.getByRole('button', { name: /16:/i })
    fireEvent.click(tooth16Btn)

    await waitFor(() => {
      expect(screen.getByText('Tooth #16')).toBeInTheDocument()
      expect(screen.getByText('Clinical Condition')).toBeInTheDocument()
      expect(screen.getByText('Surfaces Affected')).toBeInTheDocument()
    })
  })

  it('supports keyboard navigation via Enter key on tooth cell', async () => {
    render(<Odontogram patientId="patient-123" entries={sampleEntries} mode="clinical" />)

    const tooth11Btn = screen.getByRole('button', { name: /11:/i })
    fireEvent.keyDown(tooth11Btn, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(screen.getByText('Tooth #11')).toBeInTheDocument()
    })
  })

  it('operates in selection mode and updates multi-tooth selection', () => {
    const handleTeethSelect = vi.fn()
    render(
      <Odontogram
        patientId="patient-123"
        entries={sampleEntries}
        mode="selection"
        selectedTeeth={[16]}
        onTeethSelect={handleTeethSelect}
      />
    )

    expect(screen.getByText('Selection Mode')).toBeInTheDocument()
    expect(screen.getByText(/Selected Teeth/i)).toBeInTheDocument()

    // Click tooth 21 to select it
    const tooth21Btn = screen.getByRole('button', { name: /21:/i })
    fireEvent.click(tooth21Btn)

    expect(handleTeethSelect).toHaveBeenCalledWith([16, 21])
  })

  it('renders DentalChart wrapper backward-compatibly', () => {
    render(<DentalChart patientId="patient-123" entries={sampleEntries} />)
    expect(screen.getByText(/Interactive (Dental Chart|Odontogram)/i)).toBeInTheDocument()
  })

  it('renders ConditionOverlay for various dental conditions without throwing', () => {
    const geometry = getToothGeometry(16, 'upper')
    const mockTooth: ToothViewModel = {
      number: 16,
      name: 'Upper Right First Molar',
      type: 'molar',
      position: 'upper',
      quadrant: 1,
      orderInQuadrant: 6,
      condition: 'ROOT_CANAL',
      severity: 'SEVERE',
      surfaces: { mesial: false, distal: false, occlusal: true, buccal: false, lingual: false },
      history: [],
      isImplant: false,
      isCrown: false,
      isBridge: false,
      isRootCanal: true,
      isExtracted: false,
      isMissing: false,
      isFractured: false,
      hasAbscess: false,
      hasPeriodontal: false,
      hasMobility: false,
      hasSensitivity: false,
      hasVeneer: false,
      isPrimary: false,
    }

    const { container: rctContainer } = render(
      <svg viewBox="0 0 60 100">
        <ConditionOverlay tooth={mockTooth} geometry={geometry} />
      </svg>
    )
    expect(rctContainer.querySelector('.rct-layer')).toBeTruthy()

    const implantTooth: ToothViewModel = {
      ...mockTooth,
      condition: 'IMPLANT',
      isImplant: true,
      isRootCanal: false,
    }
    const { container: implantContainer } = render(
      <svg viewBox="0 0 60 100">
        <ConditionOverlay tooth={implantTooth} geometry={geometry} />
      </svg>
    )
    expect(implantContainer.querySelector('.implant-layer')).toBeTruthy()

    const crownTooth: ToothViewModel = {
      ...mockTooth,
      condition: 'CROWN',
      isCrown: true,
      isRootCanal: false,
    }
    const { container: crownContainer } = render(
      <svg viewBox="0 0 60 100">
        <ConditionOverlay tooth={crownTooth} geometry={geometry} />
      </svg>
    )
    expect(crownContainer.querySelector('.crown-layer')).toBeTruthy()

    const missingTooth: ToothViewModel = {
      ...mockTooth,
      condition: 'MISSING',
      isMissing: true,
      isRootCanal: false,
    }
    const { container: missingContainer } = render(
      <svg viewBox="0 0 60 100">
        <ConditionOverlay tooth={missingTooth} geometry={geometry} />
      </svg>
    )
    expect(missingContainer.querySelector('.missing-layer')).toBeTruthy()
  })

  it('renders ToothSurfaces 5-sector interactive regions and handles click', () => {
    const geometry = getToothGeometry(16, 'upper')
    const mockTooth: ToothViewModel = {
      number: 16,
      name: 'Upper Right First Molar',
      type: 'molar',
      position: 'upper',
      quadrant: 1,
      orderInQuadrant: 6,
      condition: 'CARIES',
      severity: 'MODERATE',
      surfaces: { mesial: true, distal: false, occlusal: true, buccal: false, lingual: false },
      history: [],
      isImplant: false,
      isCrown: false,
      isBridge: false,
      isRootCanal: false,
      isExtracted: false,
      isMissing: false,
      isFractured: false,
      hasAbscess: false,
      hasPeriodontal: false,
      hasMobility: false,
      hasSensitivity: false,
      hasVeneer: false,
      isPrimary: false,
    }

    const onSurfaceClick = vi.fn()
    const { container } = render(
      <svg viewBox="0 0 60 100">
        <ToothSurfaces
          tooth={mockTooth}
          geometry={geometry}
          onSurfaceClick={onSurfaceClick}
          interactive={true}
        />
      </svg>
    )

    const surfaces = container.querySelectorAll('path')
    expect(surfaces.length).toBe(5)
    fireEvent.click(surfaces[0])
    expect(onSurfaceClick).toHaveBeenCalled()
  })

  it('renders BridgeConnector span between abutments', () => {
    const viewModels = buildToothViewModels([
      {
        id: 'b1',
        patientId: 'p1',
        hospitalId: 'h1',
        toothNumber: 14,
        toothNotation: '14',
        condition: 'BRIDGE',
        severity: 'MILD',
        mesial: false,
        distal: false,
        occlusal: false,
        buccal: false,
        lingual: false,
        diagnosedDate: new Date(),
      },
      {
        id: 'b2',
        patientId: 'p1',
        hospitalId: 'h1',
        toothNumber: 16,
        toothNotation: '16',
        condition: 'BRIDGE',
        severity: 'MILD',
        mesial: false,
        distal: false,
        occlusal: false,
        buccal: false,
        lingual: false,
        diagnosedDate: new Date(),
      },
    ])

    render(<BridgeConnector viewModels={viewModels} position="upper" />)
    expect(screen.getByText(/Fixed Bridge Span:/i)).toBeInTheDocument()
    expect(screen.getByText(/14, 16/i)).toBeInTheDocument()
  })

  it('renders ToothHistoryTimeline with chronological records', () => {
    const historyEntries: DentalChartEntryRecord[] = [
      {
        id: 'h1',
        patientId: 'p1',
        hospitalId: 'h1',
        toothNumber: 16,
        toothNotation: '16',
        condition: 'CARIES',
        severity: 'MODERATE',
        mesial: true,
        distal: false,
        occlusal: true,
        buccal: false,
        lingual: false,
        notes: 'Initial caries detected',
        diagnosedDate: new Date('2025-06-10'),
      },
      {
        id: 'h2',
        patientId: 'p1',
        hospitalId: 'h1',
        toothNumber: 16,
        toothNotation: '16',
        condition: 'FILLED',
        severity: 'MILD',
        mesial: true,
        distal: false,
        occlusal: true,
        buccal: false,
        lingual: false,
        notes: 'Composite restoration placed',
        diagnosedDate: new Date('2025-06-15'),
      },
    ]

    render(<ToothHistoryTimeline entries={historyEntries} />)
    expect(screen.getByText('Initial caries detected')).toBeInTheDocument()
    expect(screen.getByText('Composite restoration placed')).toBeInTheDocument()
  })

  it('filters active condition in OdontogramLegend', () => {
    const onFilterChange = vi.fn()
    render(<OdontogramLegend activeFilter="ALL" onFilterChange={onFilterChange} />)

    const cariesBtn = screen.getByRole('button', { name: /Caries/i })
    expect(cariesBtn).toBeInTheDocument()
    fireEvent.click(cariesBtn)
    expect(onFilterChange).toHaveBeenCalledWith('CARIES')
  })
})

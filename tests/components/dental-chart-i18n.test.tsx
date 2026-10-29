// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LanguageProvider } from '@/components/providers/language-provider'
import { ArchGrid } from '@/components/dental-chart/odontogram/ArchGrid'
import { ToothHistoryTimeline } from '@/components/dental-chart/odontogram/ToothHistoryTimeline'
import { buildToothViewModels } from '@/components/dental-chart/adapters/dental-chart-adapter'
import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

// The app's UI is Arabic-only (`defaultLocale` is ar-EG), so every string a
// clinician reads must resolve to Arabic. Two labels escaped that rule:
//   1. ToothHistoryTimeline formatted a date with date-fns and no locale, so
//      date-fns fell back to en-US ("Jan 5, 2024").
//   2. ArchGrid hard-coded its four quadrant corner labels as raw JSX text,
//      never passing them through t().
// These tests render inside the REAL LanguageProvider (which defaults to
// ar-EG) and assert no raw English survives.

const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

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
    diagnosedDate: new Date('2026-01-05'),
  } as DentalChartEntryRecord,
]

function viewModels() {
  const entries: DentalChartEntryRecord[] = [
    {
      id: 'v1',
      patientId: 'p1',
      hospitalId: 'h1',
      toothNumber: 11,
      toothNotation: '11',
      condition: 'CARIES',
      severity: 'MILD',
      mesial: false,
      distal: false,
      occlusal: false,
      buccal: false,
      lingual: false,
      diagnosedDate: new Date('2026-01-05'),
    } as DentalChartEntryRecord,
  ]
  return buildToothViewModels(entries)
}

describe('dental chart renders Arabic-only (no raw English)', () => {
  it('ToothHistoryTimeline dates are localized, never en-US month names', () => {
    const { container } = render(
      <LanguageProvider>
        <ToothHistoryTimeline entries={historyEntries} />
      </LanguageProvider>
    )
    const text = container.textContent ?? ''
    const englishMonths = EN_MONTHS.filter((m) => text.includes(m))
    expect(englishMonths).toEqual([])
  })

  it('ArchGrid quadrant corner labels are Arabic, not raw "Q1 (UR)"', async () => {
    render(
      <LanguageProvider>
        <ArchGrid viewModels={viewModels()} />
      </LanguageProvider>
    )
    // The corner cues must be translated...
    expect(screen.getByText('الربع الأول (أعلى يمين)')).toBeInTheDocument()
    expect(screen.getByText('الربع الثاني (أعلى يسار)')).toBeInTheDocument()
    expect(screen.getByText('الربع الثالث (أسفل يسار)')).toBeInTheDocument()
    expect(screen.getByText('الربع الرابع (أسفل يمين)')).toBeInTheDocument()
    // ...and the English originals must be gone.
    for (const eng of ['Q1 (UR)', 'Q2 (UL)', 'Q3 (LL)', 'Q4 (LR)']) {
      expect(screen.queryByText(eng)).toBeNull()
    }
  })
})

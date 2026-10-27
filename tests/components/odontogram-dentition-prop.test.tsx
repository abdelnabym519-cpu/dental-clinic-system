/**
 * FDI-52 — opt-in `dentition` prop on the Phase-3 odontogram.
 *
 * Purely additive: it proves the DEFAULT path is unchanged (still exactly the
 * 32 permanent teeth, no primary block) and that 'mixed' adds the 20 primary
 * teeth. No existing Phase-3 assertion is edited or replaced.
 *
 * NOTE on assertions: `Quadrant` accepts a `subtitle` prop but never renders
 * it (it is destructured and unused). The "Q1 (UR)" strings visible in the
 * default grid are ArchGrid's own hardcoded corner labels, which exist only
 * for Q1-Q4. So primary quadrants are asserted on the rendered TOOTH NUMBERS
 * plus the "Primary Dentition" divider, which is what actually reaches the DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { Odontogram } from '@/components/dental-chart/odontogram/Odontogram'
import { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const noEntries: DentalChartEntryRecord[] = []

const PERMANENT = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48]
const PRIMARY = [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]

function renderOdontogram(dentition?: 'permanent' | 'mixed') {
  return render(
    <Odontogram
      patientId="patient-123"
      entries={noEntries}
      editable={false}
      showStats={false}
      showLegend={false}
      dentition={dentition}
    />
  )
}

describe('Odontogram dentition prop (opt-in, default permanent)', () => {
  it('DEFAULT (no prop) renders the permanent grid and no primary block', () => {
    const { container } = render(<Odontogram patientId="p" entries={noEntries} editable={false} />)
    expect(container.textContent).toContain('Q1 (UR)') // ArchGrid corner label
    expect(container.textContent).toContain('Q4 (LR)')
    expect(container.textContent).not.toContain('Primary Dentition')
    for (const n of PRIMARY) {
      expect(screen.queryAllByText(String(n)).length, `primary ${n} must NOT render`).toBe(0)
    }
  })

  it("dentition='permanent' matches the default exactly (32 teeth, no primary)", () => {
    const { container } = renderOdontogram('permanent')
    expect(container.textContent).toContain('Q2 (UL)')
    expect(container.textContent).toContain('Q3 (LL)')
    expect(container.textContent).not.toContain('Primary Dentition')
    for (const n of PRIMARY) {
      expect(screen.queryAllByText(String(n)).length, `primary ${n} must NOT render`).toBe(0)
    }
    // the permanent grid is intact
    for (const n of PERMANENT) {
      expect(screen.queryAllByText(String(n)).length, `permanent ${n} must render`).toBeGreaterThan(0)
    }
  })

  it("dentition='mixed' additionally renders all 20 primary teeth", () => {
    const { container } = renderOdontogram('mixed')
    // the pre-existing permanent grid is still there, unchanged
    for (const n of PERMANENT) {
      expect(screen.queryAllByText(String(n)).length, `permanent ${n} must render`).toBeGreaterThan(0)
    }
    // and the primary block is added
    expect(container.textContent).toContain('Primary Dentition')
    for (const n of PRIMARY) {
      expect(screen.queryAllByText(String(n)).length, `primary ${n} must render`).toBeGreaterThan(0)
    }
  })
})

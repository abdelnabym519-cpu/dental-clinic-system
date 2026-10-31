/**
 * Round-trip tests for the DenToRa <-> React-Advanced-Odontogram adapter.
 *
 * R1a acceptance: an adapter between DentalChartEntry rows and the library's
 * per-tooth state, with round-trip tests for EVERY mapped condition and EVERY
 * surface, and primary teeth 51-85 present in the 2D view.
 *
 * These tests drive lib/dental-chart/v2/rao-adapter.ts.
 */

import { describe, it, expect } from 'vitest'

import {
  DENTORA_SURFACES,
  MAPPED_CONDITIONS,
  UNMAPPED_CONDITIONS,
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  MILKTOOTH_BLOCKED,
  fdiToSlot,
  slotToFdi,
  isPrimaryFdi,
  entriesToRaoState,
  raoStateToEntries,
  roundTripEntries,
  type RaoToothState,
  type EntryContext,
} from '@/lib/dental-chart/v2/rao-adapter'

import type {
  DentalChartEntryRecord,
  DentalCondition,
} from '@/components/dental-chart/types/odontogram'

// ─── helpers ────────────────────────────────────────────────────────────────

const CTX: EntryContext = {
  patientId: 'p1',
  hospitalId: 'h1',
  diagnosedDate: '2026-01-01',
}

let seq = 0
function row(
  toothNumber: number,
  condition: DentalCondition,
  surfaces: Partial<Record<(typeof DENTORA_SURFACES)[number], boolean>> = {},
  extra: Partial<DentalChartEntryRecord> = {},
): DentalChartEntryRecord {
  seq += 1
  return {
    id: `e${seq}`,
    patientId: CTX.patientId,
    hospitalId: CTX.hospitalId,
    toothNumber,
    toothNotation: String(toothNumber),
    condition,
    severity: 'MILD',
    mesial: surfaces.mesial ?? false,
    distal: surfaces.distal ?? false,
    occlusal: surfaces.occlusal ?? false,
    buccal: surfaces.buccal ?? false,
    lingual: surfaces.lingual ?? false,
    notes: null,
    diagnosedDate: CTX.diagnosedDate,
    ...extra,
  }
}

/** (condition, surfaces) signature — identity for round-trip comparison. */
function signature(entries: DentalChartEntryRecord[]): string[] {
  return entries
    .map((e) => {
      const s = DENTORA_SURFACES.filter((k) => e[k]).sort().join('+')
      return s ? `${e.toothNumber}:${e.condition}:${s}` : `${e.toothNumber}:${e.condition}`
    })
    .sort()
}

/** All 5 surfaces on. */
const ALL5 = {
  mesial: true,
  distal: true,
  occlusal: true,
  buccal: true,
  lingual: true,
} as const

// ─── 1. tooth numbering: permanent + primary 51-85 ──────────────────────────

describe('FDI <-> library slot mapping', () => {
  it('exposes 32 permanent and 20 primary tooth numbers', () => {
    expect(PERMANENT_TEETH).toHaveLength(32)
    expect(PRIMARY_TEETH).toHaveLength(20)
  })

  it('maps every permanent FDI to the same slot, not primary', () => {
    for (const fdi of PERMANENT_TEETH) {
      expect(fdiToSlot(fdi)).toEqual({ slot: fdi, isPrimary: false })
    }
  })

  it('maps every primary FDI 51-85 to slot = fdi - 40, primary', () => {
    for (const fdi of PRIMARY_TEETH) {
      expect(fdiToSlot(fdi)).toEqual({ slot: fdi - 40, isPrimary: true })
      expect(isPrimaryFdi(fdi)).toBe(true)
    }
  })

  it('round-trips all 52 teeth (32 permanent + 20 primary)', () => {
    const all = [...PERMANENT_TEETH, ...PRIMARY_TEETH]
    expect(all).toHaveLength(52)
    for (const fdi of all) {
      const { slot, isPrimary } = fdiToSlot(fdi)
      expect(slotToFdi(slot, isPrimary)).toBe(fdi)
    }
  })

  it('lists the 12 slots that can never be primary', () => {
    expect(MILKTOOTH_BLOCKED).toHaveLength(12)
    expect(MILKTOOTH_BLOCKED).toEqual(
      expect.arrayContaining([16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48]),
    )
  })

  it('rejects a primary flag on a blocked slot', () => {
    // Only the FIRST NINE blocked slots have a primary FDI form at all: the
    // primary dentition has positions 1-5 only, so slots 46/47/48 (permanent
    // molars) have no primary counterpart and 86/87/88 are not valid FDI
    // numbers in the first place (covered by the next test).
    const withPrimaryForm = MILKTOOTH_BLOCKED.filter((s) => s + 40 <= 85)
    expect(withPrimaryForm).toHaveLength(9)
    expect(withPrimaryForm).toEqual([16, 17, 18, 26, 27, 28, 36, 37, 38])
    for (const slot of withPrimaryForm) {
      expect(() => fdiToSlot(slot + 40)).toThrow(/cannot be primary/i)
    }
  })

  it('has no primary FDI form for the three permanent molars 46/47/48', () => {
    // 86/87/88 are outside every valid FDI quadrant+position combination.
    for (const slot of [46, 47, 48]) {
      expect(slot + 40).toBeGreaterThan(85)
      expect(() => fdiToSlot(slot + 40)).toThrow(/Invalid FDI number/)
    }
  })

  it('rejects FDI numbers outside 11-48 / 51-85', () => {
    for (const bad of [0, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 56, 66, 76, 86, 99]) {
      expect(() => fdiToSlot(bad)).toThrow()
    }
  })
})

// ─── 2. every mapped condition round-trips ──────────────────────────────────

describe('round trip: every mapped condition', () => {
  const SURFACE_CONDITIONS: DentalCondition[] = ['CARIES', 'FILLED']

  it('maps 15 of the 16 DenToRa conditions and leaves 1 unmapped', () => {
    expect(MAPPED_CONDITIONS).toHaveLength(15)
    expect(UNMAPPED_CONDITIONS).toEqual(['SENSITIVE'])
  })

  // Non-surface conditions: whole-tooth.
  const WHOLE_TOOTH = MAPPED_CONDITIONS.filter(
    (c): c is DentalCondition => c !== 'HEALTHY' && !SURFACE_CONDITIONS.includes(c as DentalCondition),
  )

  it.each(WHOLE_TOOTH)('%s round-trips on a permanent tooth', (cond) => {
    const out = roundTripEntries([row(11, cond)], 11, CTX)
    expect(signature(out)).toEqual(signature([row(11, cond)]))
  })

  it.each(WHOLE_TOOTH)('%s round-trips on a primary tooth (51-85 present in 2D)', (cond) => {
    const out = roundTripEntries([row(51, cond)], 51, CTX)
    expect(signature(out)).toEqual(signature([row(51, cond)]))
  })
})

// ─── 3. every surface, for both surface-bearing conditions ──────────────────

describe('round trip: every surface', () => {
  it.each(['CARIES', 'FILLED'] as DentalCondition[])('%s: each single surface survives', (cond) => {
    for (const s of DENTORA_SURFACES) {
      const out = roundTripEntries([row(36, cond, { [s]: true })], 36, CTX)
      expect(signature(out)).toEqual([`36:${cond}:${s}`])
    }
  })

  it.each(['CARIES', 'FILLED'] as DentalCondition[])('%s: all 5 surfaces survive', (cond) => {
    const out = roundTripEntries([row(36, cond, ALL5)], 36, CTX)
    expect(signature(out)).toEqual([
      `36:${cond}:buccal+distal+lingual+mesial+occlusal`,
    ])
  })

  it.each(['CARIES', 'FILLED'] as DentalCondition[])(
    '%s: all 32 subsets of the 5 surfaces survive',
    (cond) => {
      // 2^5 = 32 combinations, including empty and full.
      for (let mask = 0; mask < 32; mask += 1) {
        const surfaces = Object.fromEntries(
          DENTORA_SURFACES.map((s, i) => [s, Boolean(mask & (1 << i))]),
        )
        const src = [row(36, cond, surfaces)]
        const expectSig = signature(src)
        const out = roundTripEntries(src, 36, CTX)
        expect(signature(out)).toEqual(expectSig)
      }
    },
  )

  it('keeps CARIES and FILLED surfaces independent on one tooth', () => {
    const src = [
      row(36, 'CARIES', { mesial: true, occlusal: true }),
      row(36, 'FILLED', { distal: true }),
    ]
    const out = roundTripEntries(src, 36, CTX)
    expect(signature(out)).toEqual([
      '36:CARIES:mesial+occlusal',
      '36:FILLED:distal',
    ])
  })

  it('round-trips surface conditions on a primary tooth', () => {
    const src = [row(54, 'CARIES', { occlusal: true }), row(54, 'FILLED', ALL5)]
    const out = roundTripEntries(src, 54, CTX)
    expect(signature(out)).toEqual(signature(src))
  })
})

// ─── 4. multiple conditions on one tooth ────────────────────────────────────

describe('round trip: several conditions on one tooth', () => {
  it('merges and re-splits without cross-talk', () => {
    const src = [
      row(26, 'CARIES', { mesial: true }),
      row(26, 'ABSCESS'),
      row(26, 'PERIODONTAL'),
      row(26, 'MOBILITY', {}, { severity: 'SEVERE' }),
      row(26, 'ROOT_CANAL'),
    ]
    const out = roundTripEntries(src, 26, CTX)
    expect(signature(out)).toEqual(signature(src))
    expect(out).toHaveLength(5)
  })

  it('carries MOBILITY severity MILD/MODERATE/SEVERE -> m1/m2/m3', () => {
    const cases: Array<[string, string]> = [
      ['MILD', 'm1'],
      ['MODERATE', 'm2'],
      ['SEVERE', 'm3'],
    ]
    for (const [severity, expected] of cases) {
      const state = entriesToRaoState([row(31, 'MOBILITY', {}, { severity })], 31)
      expect(state.mobility).toBe(expected)
      // and back
      const back = raoStateToEntries(state, 31, CTX)
      expect(back).toHaveLength(1)
      expect(back[0].severity).toBe(severity)
    }
  })

  it('defaults an unrecognised MOBILITY severity to m1', () => {
    const state = entriesToRaoState(
      [row(31, 'MOBILITY', {}, { severity: 'NOT_A_SEVERITY' })],
      31,
    )
    expect(state.mobility).toBe('m1')
  })
})

// ─── 5. documented lossy behaviour: restorationType collision ───────────────

describe('CROWN / BRIDGE / VENEER collision on restorationType', () => {
  it('keeps CROWN over BRIDGE and VENEER', () => {
    const src = [row(14, 'CROWN'), row(14, 'BRIDGE'), row(14, 'VENEER')]
    const out = roundTripEntries(src, 14, CTX)
    expect(signature(out)).toEqual(['14:CROWN'])
  })

  it('keeps BRIDGE over VENEER', () => {
    const src = [row(14, 'VENEER'), row(14, 'BRIDGE')]
    const out = roundTripEntries(src, 14, CTX)
    expect(signature(out)).toEqual(['14:BRIDGE'])
  })

  it('is order-independent', () => {
    const a = roundTripEntries([row(14, 'CROWN'), row(14, 'VENEER')], 14, CTX)
    const b = roundTripEntries([row(14, 'VENEER'), row(14, 'CROWN')], 14, CTX)
    expect(signature(a)).toEqual(signature(b))
  })

  it('reports the collision rather than losing it silently', () => {
    const state = entriesToRaoState([row(14, 'CROWN'), row(14, 'VENEER')], 14)
    expect(state.warnings.length).toBeGreaterThan(0)
    expect(state.warnings.join(' ')).toMatch(/VENEER|BRIDGE|CROWN/)
  })

  it('emits no warning when there is no collision', () => {
    const state = entriesToRaoState([row(14, 'CROWN')], 14)
    expect(state.warnings).toEqual([])
  })
})

// ─── 6. unmapped SENSITIVE must be impossible to represent ──────────────────

describe('SENSITIVE is unmapped', () => {
  it('is not in the mapped set', () => {
    expect(MAPPED_CONDITIONS).not.toContain('SENSITIVE')
    expect(UNMAPPED_CONDITIONS).toContain('SENSITIVE')
  })

  it('produces no library finding', () => {
    const state = entriesToRaoState([row(12, 'SENSITIVE')], 12)
    const findings = raoStateToEntries(state, 12, CTX)
    expect(findings).toEqual([])
  })

  it('does not disturb other findings on the same tooth', () => {
    const src = [row(12, 'SENSITIVE'), row(12, 'CARIES', { buccal: true })]
    const out = roundTripEntries(src, 12, CTX)
    expect(signature(out)).toEqual(['12:CARIES:buccal'])
  })
})

// ─── 7. HEALTHY is the absence of findings ─────────────────────────────────

describe('HEALTHY', () => {
  it('maps to an empty state and produces no rows', () => {
    const state = entriesToRaoState([row(11, 'HEALTHY')], 11)
    expect(raoStateToEntries(state, 11, CTX)).toEqual([])
  })

  it('is not re-emitted for a tooth that has no findings', () => {
    const state = entriesToRaoState([], 11)
    expect(raoStateToEntries(state, 11, CTX)).toEqual([])
  })
})

// ─── 8. mutual exclusion: MISSING/IMPLANT vs tooth findings ────────────────

describe('absent teeth', () => {
  it('MISSING sets toothSelection none', () => {
    const state = entriesToRaoState([row(46, 'MISSING')], 46)
    expect(state.toothSelection).toBe('none')
  })

  it('IMPLANT sets toothSelection implant', () => {
    const state = entriesToRaoState([row(46, 'IMPLANT')], 46)
    expect(state.toothSelection).toBe('implant')
  })

  it('EXTRACTION sets extractionWound, EXTRACTION_NEEDED sets extractionPlan', () => {
    const a = entriesToRaoState([row(46, 'EXTRACTION')], 46)
    expect(a.extractionWound).toBe(true)
    expect(a.extractionPlan).toBe(false)

    const b = entriesToRaoState([row(46, 'EXTRACTION_NEEDED')], 46)
    expect(b.extractionPlan).toBe(true)
    expect(b.extractionWound).toBe(false)
  })

  it('keeps EXTRACTION and EXTRACTION_NEEDED distinct on round trip', () => {
    const out = roundTripEntries([row(46, 'EXTRACTION'), row(46, 'EXTRACTION_NEEDED')], 46, CTX)
    expect(signature(out)).toEqual(['46:EXTRACTION', '46:EXTRACTION_NEEDED'])
  })
})

// ─── 9. a primary tooth is flagged, and stays primary ───────────────────────

describe('primary teeth in the 2D view', () => {
  it('sets the milktooth flag on the underlying slot', () => {
    const state = entriesToRaoState([row(85, 'CARIES', { occlusal: true })], 85)
    expect(state.slot).toBe(45)
    expect(state.isPrimary).toBe(true)
  })

  it('restores the original 51-85 number on the way back', () => {
    const state = entriesToRaoState([row(85, 'CARIES', { occlusal: true })], 85)
    const out = raoStateToEntries(state, 85, CTX)
    expect(out).toHaveLength(1)
    expect(out[0].toothNumber).toBe(85)
  })

  it('round-trips every primary tooth with a finding', () => {
    for (const fdi of PRIMARY_TEETH) {
      const out = roundTripEntries([row(fdi, 'CARIES', { mesial: true })], fdi, CTX)
      expect(signature(out)).toEqual([`${fdi}:CARIES:mesial`])
    }
  })

  it('does not mark a permanent tooth as primary', () => {
    const state: RaoToothState = entriesToRaoState([row(45, 'CARIES', { mesial: true })], 45)
    expect(state.slot).toBe(45)
    expect(state.isPrimary).toBe(false)
  })
})

// ─── 10. full-chart round trip ──────────────────────────────────────────────

describe('full chart round trip', () => {
  it('round-trips a whole mixed dentition chart', () => {
    const src: DentalChartEntryRecord[] = []
    // every permanent tooth gets caries on one surface (cycled)
    PERMANENT_TEETH.forEach((fdi, i) => {
      const s = DENTORA_SURFACES[i % 5]
      src.push(row(fdi, 'CARIES', { [s]: true }))
    })
    // every primary tooth gets a filling on two surfaces
    PRIMARY_TEETH.forEach((fdi, i) => {
      const a = DENTORA_SURFACES[i % 5]
      const b = DENTORA_SURFACES[(i + 2) % 5]
      src.push(row(fdi, 'FILLED', { [a]: true, [b]: true }))
    })
    // plus a spread of whole-tooth findings
    src.push(row(11, 'CROWN'), row(21, 'IMPLANT'), row(31, 'MISSING'))
    src.push(row(41, 'MOBILITY', {}, { severity: 'MODERATE' }))
    src.push(row(42, 'ABSCESS'), row(43, 'PERIODONTAL'), row(44, 'ROOT_CANAL'))
    src.push(row(45, 'FRACTURED'), row(35, 'EXTRACTION'), row(34, 'EXTRACTION_NEEDED'))
    src.push(row(33, 'VENEER'))

    const byTooth = new Map<number, DentalChartEntryRecord[]>()
    for (const e of src) {
      const list = byTooth.get(e.toothNumber) ?? []
      list.push(e)
      byTooth.set(e.toothNumber, list)
    }

    const out: DentalChartEntryRecord[] = []
    for (const [tooth, rows] of byTooth) {
      out.push(...roundTripEntries(rows, tooth, CTX))
    }

    expect(signature(out)).toEqual(signature(src))
  })
})

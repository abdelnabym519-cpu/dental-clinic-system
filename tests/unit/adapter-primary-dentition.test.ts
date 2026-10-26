/**
 * Phase-3 protected-surface ADDITIONS (FDI-52).
 *
 * This file is purely additive: it exercises the NEW exports only, and it
 * re-pins the EXISTING permanent-only contract so that adding primary support
 * can never silently change behaviour the Phase-3 suites depend on.
 *
 * It does NOT replace or edit tests/unit/odontogram-clean-room.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_FDI_TEETH,
  ALL_FDI_TEETH_PRIMARY,
  ALL_FDI_TEETH_MIXED,
  FDI_QUADRANTS,
  FDI_QUADRANTS_PRIMARY,
  getToothQuadrant,
  getToothQuadrantWide,
} from '@/components/dental-chart/adapters/dental-chart-adapter'

const PERMANENT = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48]
const PRIMARY = [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]

describe('existing permanent-only contract is UNCHANGED (regression guard)', () => {
  it('ALL_FDI_TEETH is still exactly the 32 permanent teeth', () => {
    expect(ALL_FDI_TEETH).toHaveLength(32)
    expect([...ALL_FDI_TEETH].sort((a, b) => a - b)).toEqual(PERMANENT)
  })

  it('FDI_QUADRANTS still holds Q1-Q4 exactly', () => {
    expect(Object.keys(FDI_QUADRANTS)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(FDI_QUADRANTS.Q3).toEqual([38, 37, 36, 35, 34, 33, 32, 31])
  })

  it('getToothQuadrant still returns 1-4 for permanent teeth', () => {
    expect(getToothQuadrant(16)).toBe(1)
    expect(getToothQuadrant(26)).toBe(2)
    expect(getToothQuadrant(36)).toBe(3)
    expect(getToothQuadrant(46)).toBe(4)
  })

  it('getToothQuadrant keeps its pre-existing `return 1` fallback (untouched)', () => {
    // Documented, deliberately preserved: primary teeth still fall back to 1
    // in the OLD function. Callers needing 5-8 must use getToothQuadrantWide.
    expect(getToothQuadrant(51)).toBe(1)
  })
})

describe('new primary exports (additive)', () => {
  it('ALL_FDI_TEETH_PRIMARY is exactly the 20 deciduous teeth', () => {
    expect(ALL_FDI_TEETH_PRIMARY).toHaveLength(20)
    expect([...ALL_FDI_TEETH_PRIMARY].sort((a, b) => a - b)).toEqual(PRIMARY)
  })

  it('FDI_QUADRANTS_PRIMARY holds Q5-Q8', () => {
    expect(Object.keys(FDI_QUADRANTS_PRIMARY)).toEqual(['Q5', 'Q6', 'Q7', 'Q8'])
    expect(FDI_QUADRANTS_PRIMARY.Q5).toEqual([55, 54, 53, 52, 51])
    expect(FDI_QUADRANTS_PRIMARY.Q6).toEqual([61, 62, 63, 64, 65])
    expect(FDI_QUADRANTS_PRIMARY.Q7).toEqual([75, 74, 73, 72, 71])
    expect(FDI_QUADRANTS_PRIMARY.Q8).toEqual([81, 82, 83, 84, 85])
  })

  it('ALL_FDI_TEETH_MIXED is the union of 32 + 20 with no duplicates', () => {
    expect(ALL_FDI_TEETH_MIXED).toHaveLength(52)
    expect(new Set(ALL_FDI_TEETH_MIXED).size).toBe(52)
    expect([...ALL_FDI_TEETH_MIXED].sort((a, b) => a - b)).toEqual(
      [...PERMANENT, ...PRIMARY].sort((a, b) => a - b)
    )
  })
})

describe('getToothQuadrantWide covers all 52 identifiers', () => {
  it('maps permanent teeth to quadrants 1-4', () => {
    for (const q of [1, 2, 3, 4]) {
      for (const n of PERMANENT.filter((t) => Math.floor(t / 10) === q)) {
        expect(getToothQuadrantWide(n), `tooth ${n}`).toBe(q)
      }
    }
  })

  it('maps primary teeth to quadrants 5-8', () => {
    for (const q of [5, 6, 7, 8]) {
      for (const n of PRIMARY.filter((t) => Math.floor(t / 10) === q)) {
        expect(getToothQuadrantWide(n), `tooth ${n}`).toBe(q)
      }
    }
  })

  it('agrees with getToothQuadrant for every permanent tooth', () => {
    for (const n of PERMANENT) {
      expect(getToothQuadrantWide(n), `tooth ${n}`).toBe(getToothQuadrant(n))
    }
  })

  it('falls back to 1 for unrecognised numbers (documented, not a clinical claim)', () => {
    // These are NOT real teeth: 19/30/49 are out-of-schema permanent-shaped
    // numbers and 56/59/99 do not exist in any quadrant.
    for (const bad of [19, 20, 29, 30, 39, 40, 49, 56, 59, 99, 0]) {
      expect(getToothQuadrantWide(bad), `tooth ${bad}`).toBe(1)
    }
  })
})

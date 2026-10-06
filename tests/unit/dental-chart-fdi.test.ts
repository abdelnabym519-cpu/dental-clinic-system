import { describe, it, expect } from 'vitest'
import {
  FDI_TEETH,
  isValidFdi,
  quadrantOf,
  toothIndexOf,
  archOf,
  sideOf,
  groupOf,
  specificTypeOf,
  toothNameAr,
  toothNameEn,
  adjacentTeeth,
  opposingTooth,
  navigationTargets,
} from '@/lib/dental-chart/fdi'

describe('FDI notation (ISO-3950)', () => {
  it('accepts exactly the 32 permanent teeth', () => {
    expect(FDI_TEETH).toHaveLength(32)
    for (const t of FDI_TEETH) expect(isValidFdi(t)).toBe(true)
    expect([...FDI_TEETH].slice(0, 8)).toEqual([11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('rejects invalid numbering (deciduous ranges, zero, quadrant 5+, non-integers)', () => {
    for (const bad of [0, 10, 19, 51, 55, 91, 99, -16, 16.5, NaN, Infinity]) {
      expect(isValidFdi(bad as number)).toBe(false)
    }
  })

  it('derives quadrant/arch/side/group', () => {
    expect(quadrantOf(16)).toBe(1)
    expect(archOf(16)).toBe('upper')
    expect(sideOf(16)).toBe('right')
    expect(archOf(36)).toBe('lower')
    expect(sideOf(36)).toBe('left')
    expect(sideOf(26)).toBe('left')
    expect(groupOf(11)).toBe('incisor')
    expect(groupOf(13)).toBe('canine')
    expect(groupOf(24)).toBe('premolar')
    expect(groupOf(26)).toBe('molar')
    expect(groupOf(48)).toBe('molar')
  })

  it('mirrors the protected Phase-3 ToothSpecificType naming', () => {
    expect(specificTypeOf(16)).toBe('maxillary_first_molar')
    expect(specificTypeOf(32)).toBe('mandibular_lateral_incisor')
    expect(specificTypeOf(41)).toBe('mandibular_central_incisor')
    expect(specificTypeOf(28)).toBe('maxillary_third_molar')
  })

  it('invalid input throws (never silently mislabels a tooth)', () => {
    expect(() => quadrantOf(99)).toThrow()
    expect(() => toothIndexOf(10)).toThrow()
  })
})

describe('Arabic tooth names', () => {
  it('names teeth in clinical Arabic with arch and side', () => {
    expect(toothNameAr(16)).toBe('الرحى الأولى العلوية اليمنى')
    expect(toothNameAr(36)).toBe('الرحى الأولى السفلية اليسرى')
    expect(toothNameAr(11)).toBe('القاطع المركزي العلوي الأيمن')
    expect(toothNameAr(43)).toBe('الناب السفلي الأيمن')
    expect(toothNameAr(18)).toBe('ضرس العقل العلوي الأيمن')
  })

  it('names all 32 teeth (no gaps)', () => {
    for (const t of FDI_TEETH) expect(toothNameAr(t).length).toBeGreaterThan(3)
  })

  it('provides English names for LTR mode', () => {
    expect(toothNameEn(16)).toBe('upper right first molar')
    expect(toothNameEn(41)).toBe('lower right central incisor')
    expect(toothNameEn(28)).toBe('upper left wisdom tooth')
    for (const t of FDI_TEETH) expect(toothNameEn(t).length).toBeGreaterThan(5)
  })
})

describe('navigation graph', () => {
  it('adjacent teeth stay inside the quadrant', () => {
    expect(adjacentTeeth(16)).toEqual([15, 17])
    expect(adjacentTeeth(11)).toEqual([12])
    expect(adjacentTeeth(18)).toEqual([17])
    expect(adjacentTeeth(41)).toEqual([42])
  })

  it('antagonist pairs: 16↔46, 11↔41, 26↔36 (same index, complementary arch, same side)', () => {
    expect(opposingTooth(16)).toBe(46)
    expect(opposingTooth(46)).toBe(16)
    expect(opposingTooth(11)).toBe(41)
    expect(opposingTooth(26)).toBe(36)
  })

  it('arrow navigation never leaves the valid set', () => {
    for (const t of FDI_TEETH) {
      for (const target of Object.values(navigationTargets(t))) {
        expect(isValidFdi(target)).toBe(true)
      }
    }
    // Edge tooth: clamps inside quadrant, vertical jumps to antagonist.
    const nav18 = navigationTargets(18)
    expect(nav18.right).toBe(17) // toward midline
    expect(nav18.left).toBe(18) // clamped at distal edge
    expect(nav18.down).toBe(48) // antagonist
  })
})

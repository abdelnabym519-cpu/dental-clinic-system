/**
 * Phase 3 — Primary & mixed dentition support.
 *
 * Covers the shared FDI foundation only: identity, validation, dentition
 * derivation, quadrant/index, grouping, naming, adjacency and antagonists.
 *
 * Deliberately NOT covered here: root and canal counts. Primary root/canal
 * morphology is undefined pending clinical sign-off, so there is nothing to
 * assert yet.
 */
import { describe, it, expect } from 'vitest'
import {
  FDI_TEETH,
  FDI_TEETH_ALL,
  FDI_TEETH_PERMANENT,
  FDI_TEETH_PRIMARY,
  adjacentTeeth,
  archOf,
  dentitionOf,
  groupOf,
  isPermanentFdi,
  isPrimaryFdi,
  isValidFdi,
  maxToothIndexOf,
  navigationTargets,
  opposingTooth,
  quadrantOf,
  sideOf,
  specificTypeOf,
  toothIndexOf,
  toothNameAr,
  toothNameEn,
} from '@/lib/dental-chart/fdi'
import {
  isValidFdi as aiIsValidFdi,
  parseToothNumbers,
  quadrantOf as aiQuadrantOf,
  sortFdi,
  toothName,
  TOOTH_NAMES,
} from '@/lib/ai/context/fdi'

const PERMANENT = [
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]
const PRIMARY = [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]

describe('valid FDI identifier set (52 total)', () => {
  it('holds exactly 32 permanent + 20 primary identifiers, no duplicates', () => {
    expect(FDI_TEETH_PERMANENT).toHaveLength(32)
    expect(FDI_TEETH_PRIMARY).toHaveLength(20)
    expect(FDI_TEETH_ALL).toHaveLength(52)
    expect(new Set(FDI_TEETH_ALL).size).toBe(52)
    expect([...FDI_TEETH_ALL]).toEqual([...PERMANENT, ...PRIMARY])
  })

  it('accepts every permanent identifier', () => {
    for (const t of PERMANENT) expect(isValidFdi(t)).toBe(true)
    for (const t of PERMANENT) expect(dentitionOf(t)).toBe('permanent')
  })

  it('accepts every primary identifier', () => {
    for (const t of PRIMARY) expect(isValidFdi(t)).toBe(true)
    for (const t of PRIMARY) expect(dentitionOf(t)).toBe('primary')
  })

  it('rejects invalid quadrants and indices', () => {
    // index 0 or 9, quadrant 0 or 9+, out-of-range and non-finite numbers
    for (const bad of [
      0,
      9,
      10,
      19,
      20,
      29,
      30,
      39,
      40,
      49,
      50,
      59,
      60,
      69,
      70,
      79,
      80,
      89,
      90,
      99,
      100,
      111,
      -3,
      -16,
      -51,
      1,
      5,
      8,
      16.5,
      51.5,
      NaN,
      Infinity,
      -Infinity,
    ]) {
      expect(isValidFdi(bad)).toBe(false)
    }
  })

  it('rejects primary indices 6–8 (primary quadrants hold 5 teeth)', () => {
    for (const bad of [56, 57, 58, 59, 66, 67, 68, 69, 76, 77, 78, 86, 87, 88]) {
      expect(isValidFdi(bad)).toBe(false)
    }
  })

  it('rejects non-numbers outright (numeric strings are never coerced)', () => {
    for (const bad of [
      '11',
      '16',
      '51',
      '85',
      '',
      ' 11',
      null,
      undefined,
      true,
      false,
      [],
      {},
      [11],
      { a: 1 },
      () => 11,
      NaN,
    ]) {
      expect(isValidFdi(bad)).toBe(false)
      expect(isPrimaryFdi(bad)).toBe(false)
      expect(isPermanentFdi(bad)).toBe(false)
    }
  })
})

describe('dentition classification', () => {
  it('derives dentition from the quadrant digit', () => {
    expect(dentitionOf(11)).toBe('permanent')
    expect(dentitionOf(48)).toBe('permanent')
    expect(dentitionOf(51)).toBe('primary')
    expect(dentitionOf(85)).toBe('primary')
  })

  it('isPrimaryFdi / isPermanentFdi are exact complements over the valid set', () => {
    for (const t of FDI_TEETH_ALL) {
      expect(isPrimaryFdi(t)).toBe(!isPermanentFdi(t))
      expect(isPrimaryFdi(t)).toBe(dentitionOf(t) === 'primary')
    }
  })

  it('throws rather than guessing for invalid input', () => {
    expect(() => dentitionOf(99)).toThrow()
    expect(() => dentitionOf(50)).toThrow()
    expect(() => dentitionOf('51' as unknown as number)).toThrow()
    expect(() => quadrantOf(19)).toThrow()
    expect(() => toothIndexOf(59)).toThrow()
    expect(() => maxToothIndexOf(56)).toThrow()
  })
})

describe('quadrant, index and arch/side', () => {
  it('maps primary quadrants 5–8 — never silently falls back to quadrant 1', () => {
    expect(quadrantOf(51)).toBe(5)
    expect(quadrantOf(55)).toBe(5)
    expect(quadrantOf(61)).toBe(6)
    expect(quadrantOf(65)).toBe(6)
    expect(quadrantOf(71)).toBe(7)
    expect(quadrantOf(75)).toBe(7)
    expect(quadrantOf(81)).toBe(8)
    expect(quadrantOf(85)).toBe(8)
    for (const t of PRIMARY) expect(quadrantOf(t)).not.toBe(1)
  })

  it('derives tooth index within the quadrant', () => {
    expect(toothIndexOf(51)).toBe(1)
    expect(toothIndexOf(55)).toBe(5)
    expect(toothIndexOf(85)).toBe(5)
    expect(maxToothIndexOf(51)).toBe(5)
    expect(maxToothIndexOf(11)).toBe(8)
  })

  it('derives arch and side for primary teeth', () => {
    expect(archOf(51)).toBe('upper')
    expect(archOf(65)).toBe('upper')
    expect(archOf(71)).toBe('lower')
    expect(archOf(85)).toBe('lower')

    expect(sideOf(51)).toBe('right')
    expect(sideOf(55)).toBe('right')
    expect(sideOf(64)).toBe('left')
    expect(sideOf(61)).toBe('left')
    expect(sideOf(75)).toBe('left')
    expect(sideOf(85)).toBe('right')
  })

  it('permanent quadrant/arch/side behaviour is unchanged', () => {
    expect(quadrantOf(16)).toBe(1)
    expect(archOf(16)).toBe('upper')
    expect(sideOf(16)).toBe('right')
    expect(archOf(36)).toBe('lower')
    expect(sideOf(36)).toBe('left')
    expect(sideOf(26)).toBe('left')
    expect(sideOf(46)).toBe('right')
  })
})

describe('tooth grouping — primary index 4/5 are molars, not premolars', () => {
  it('classifies primary teeth', () => {
    expect(groupOf(51)).toBe('incisor')
    expect(groupOf(52)).toBe('incisor')
    expect(groupOf(53)).toBe('canine')
    expect(groupOf(54)).toBe('molar')
    expect(groupOf(55)).toBe('molar')
    expect(groupOf(64)).toBe('molar')
    expect(groupOf(75)).toBe('molar')
    expect(groupOf(85)).toBe('molar')
  })

  it('never classifies a primary tooth as a premolar', () => {
    for (const t of PRIMARY) expect(groupOf(t)).not.toBe('premolar')
  })

  it('keeps premolars for permanent teeth only', () => {
    expect(groupOf(14)).toBe('premolar')
    expect(groupOf(24)).toBe('premolar')
    expect(groupOf(35)).toBe('premolar')
    expect(groupOf(45)).toBe('premolar')
    expect(groupOf(16)).toBe('molar')
    expect(groupOf(48)).toBe('molar')
    expect(groupOf(11)).toBe('incisor')
    expect(groupOf(13)).toBe('canine')
  })

  it('specificTypeOf marks primary teeth explicitly (no 54/16 collision)', () => {
    expect(specificTypeOf(54)).toBe('primary_maxillary_first_molar')
    expect(specificTypeOf(55)).toBe('primary_maxillary_second_molar')
    expect(specificTypeOf(64)).toBe('primary_maxillary_first_molar')
    expect(specificTypeOf(71)).toBe('primary_mandibular_central_incisor')
    expect(specificTypeOf(85)).toBe('primary_mandibular_second_molar')
    expect(specificTypeOf(16)).toBe('maxillary_first_molar')
    expect(specificTypeOf(14)).toBe('maxillary_first_premolar')
    expect(specificTypeOf(32)).toBe('mandibular_lateral_incisor')
    expect(specificTypeOf(28)).toBe('maxillary_third_molar')
    expect(specificTypeOf(54)).not.toBe(specificTypeOf(16))
  })
})

describe('naming', () => {
  it('names primary teeth in English', () => {
    expect(toothNameEn(51)).toBe('primary upper right central incisor')
    expect(toothNameEn(54)).toBe('primary upper right first molar')
    expect(toothNameEn(64)).toBe('primary upper left first molar')
    expect(toothNameEn(75)).toBe('primary lower left second molar')
    expect(toothNameEn(85)).toBe('primary lower right second molar')
  })

  it('names primary teeth in Arabic with gender agreement', () => {
    expect(toothNameAr(51)).toBe('القاطع المركزي اللبني العلوي الأيمن')
    expect(toothNameAr(54)).toBe('الرحى الأولى اللبنية العلوية اليمنى')
    expect(toothNameAr(85)).toBe('الرحى الثانية اللبنية السفلية اليمنى')
  })

  it('names every one of the 52 identifiers', () => {
    for (const t of FDI_TEETH_ALL) {
      expect(toothNameEn(t).length).toBeGreaterThan(5)
      expect(toothNameAr(t).length).toBeGreaterThan(3)
    }
  })

  it('permanent naming is byte-for-byte unchanged', () => {
    expect(toothNameAr(16)).toBe('الرحى الأولى العلوية اليمنى')
    expect(toothNameAr(36)).toBe('الرحى الأولى السفلية اليسرى')
    expect(toothNameAr(11)).toBe('القاطع المركزي العلوي الأيمن')
    expect(toothNameAr(43)).toBe('الناب السفلي الأيمن')
    expect(toothNameAr(18)).toBe('ضرس العقل العلوي الأيمن')
    expect(toothNameEn(16)).toBe('upper right first molar')
    expect(toothNameEn(41)).toBe('lower right central incisor')
    expect(toothNameEn(28)).toBe('upper left wisdom tooth')
  })
})

describe('adjacency and antagonists', () => {
  it('bounds adjacency to 5 teeth in a primary quadrant', () => {
    expect(adjacentTeeth(51)).toEqual([52])
    expect(adjacentTeeth(54)).toEqual([53, 55])
    expect(adjacentTeeth(55)).toEqual([54])
    expect(adjacentTeeth(61)).toEqual([62])
    expect(adjacentTeeth(65)).toEqual([64])
    expect(adjacentTeeth(85)).toEqual([84])
  })

  it('permanent adjacency is unchanged', () => {
    expect(adjacentTeeth(16)).toEqual([15, 17])
    expect(adjacentTeeth(11)).toEqual([12])
    expect(adjacentTeeth(18)).toEqual([17])
    expect(adjacentTeeth(41)).toEqual([42])
  })

  it('primary antagonists: 5↔8 and 6↔7 (same index, same side)', () => {
    expect(opposingTooth(51)).toBe(81)
    expect(opposingTooth(81)).toBe(51)
    expect(opposingTooth(55)).toBe(85)
    expect(opposingTooth(85)).toBe(55)
    expect(opposingTooth(64)).toBe(74)
    expect(opposingTooth(74)).toBe(64)
    expect(opposingTooth(75)).toBe(65)
    expect(opposingTooth(65)).toBe(75)
  })

  it('permanent antagonists are unchanged', () => {
    expect(opposingTooth(16)).toBe(46)
    expect(opposingTooth(46)).toBe(16)
    expect(opposingTooth(11)).toBe(41)
    expect(opposingTooth(26)).toBe(36)
  })

  it('arrow navigation never leaves the valid set (permanent or primary)', () => {
    for (const t of FDI_TEETH_ALL) {
      for (const target of Object.values(navigationTargets(t))) {
        expect(isValidFdi(target)).toBe(true)
      }
    }
    const nav51 = navigationTargets(51)
    expect(nav51.right).toBe(51) // clamped at the midline
    expect(nav51.left).toBe(52)
    expect(nav51.down).toBe(81) // antagonist
  })
})

describe('mixed dentition (permanent + primary for one patient)', () => {
  it('validates and classifies a mixed set independently', () => {
    const mixed = [11, 16, 36, 48, 51, 55, 64, 75, 85]
    for (const t of mixed) expect(isValidFdi(t)).toBe(true)
    expect(mixed.filter((t) => dentitionOf(t) === 'permanent')).toEqual([11, 16, 36, 48])
    expect(mixed.filter((t) => dentitionOf(t) === 'primary')).toEqual([51, 55, 64, 75, 85])
  })

  it('does not assume a patient has 32 or 20 teeth', () => {
    // A mixed-dentition child may have fewer than 52 teeth recorded; the
    // helpers place no constraint on how many are present.
    const chart = [51, 52, 85, 16, 26]
    expect(chart).toHaveLength(5)
    expect(chart.every((t) => isValidFdi(t))).toBe(true)
    expect(new Set(chart.map((t) => dentitionOf(t)))).toEqual(new Set(['primary', 'permanent']))
  })
})

describe('AI context layer uses the same validator (no second rule set)', () => {
  it('isValidFdi is literally the shared function', () => {
    expect(aiIsValidFdi).toBe(isValidFdi)
  })

  it('ai quadrantOf returns 5–8 for primary and null for invalid', () => {
    expect(aiQuadrantOf(51)).toBe(5)
    expect(aiQuadrantOf(85)).toBe(8)
    expect(aiQuadrantOf(16)).toBe(1)
    expect(aiQuadrantOf(50)).toBeNull()
    expect(aiQuadrantOf(99)).toBeNull()
    expect(aiQuadrantOf('51' as unknown as number)).toBeNull()
  })

  it('parseToothNumbers now accepts primary identifiers', () => {
    expect(parseToothNumbers('51, 85')).toEqual([51, 85])
    expect(parseToothNumbers('tooth 54')).toEqual([54])
    expect(parseToothNumbers('36 51')).toEqual([36, 51])
    // invalid tokens are still dropped, never guessed
    expect(parseToothNumbers('99, 3, 36')).toEqual([36])
    expect(parseToothNumbers('56, 59, 51')).toEqual([51])
    expect(parseToothNumbers(null as unknown as string)).toEqual([])
    expect(parseToothNumbers('')).toEqual([])
  })

  it('toothName covers primary teeth and leaves permanent names intact', () => {
    expect(toothName(51)).toBe('Primary Upper Right Central Incisor')
    expect(toothName(85)).toBe('Primary Lower Right Second Molar')
    expect(toothName(36)).toBe('Lower Left First Molar')
    expect(toothName(11)).toBe('Upper Right Central Incisor')
    expect(Object.keys(TOOTH_NAMES)).toHaveLength(52)
  })

  it('sortFdi orders permanent first, then primary arch order', () => {
    expect(sortFdi([85, 51, 36])).toEqual([36, 51, 85])
    expect(sortFdi([51, 52, 53, 54, 55])).toEqual([55, 54, 53, 52, 51])
    expect(sortFdi([46, 36])).toEqual([36, 46])
  })
})

describe('permanent-only surfaces are untouched', () => {
  it('FDI_TEETH still exports exactly the 32 permanent teeth', () => {
    expect(FDI_TEETH).toHaveLength(32)
    expect([...FDI_TEETH]).toEqual(PERMANENT)
    expect(FDI_TEETH).toBe(FDI_TEETH_PERMANENT)
    for (const t of FDI_TEETH) expect(isPrimaryFdi(t)).toBe(false)
  })
})

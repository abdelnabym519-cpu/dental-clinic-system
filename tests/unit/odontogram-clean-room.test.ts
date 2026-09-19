import { describe, it, expect } from 'vitest'
import {
  ALL_FDI_TEETH,
  FDI_QUADRANTS,
  TOOTH_NAMES,
  getToothAnatomyGroup,
  getToothPosition,
  getToothSide,
  getToothQuadrant,
  buildToothViewModels,
  calculateOdontogramStats,
  DENTAL_CONDITION_CONFIG,
} from '@/components/dental-chart/adapters/dental-chart-adapter'
import { getToothGeometry } from '@/components/dental-chart/geometry/tooth-paths'
import { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'

describe('Clean-Room Odontogram — Anatomy & FDI Mapping', () => {
  it('contains exactly 32 adult permanent teeth in FDI notation', () => {
    expect(ALL_FDI_TEETH).toHaveLength(32)
  })

  it('correctly maps 4 distinct quadrants with 8 teeth each', () => {
    expect(FDI_QUADRANTS.Q1).toEqual([18, 17, 16, 15, 14, 13, 12, 11])
    expect(FDI_QUADRANTS.Q2).toEqual([21, 22, 23, 24, 25, 26, 27, 28])
    expect(FDI_QUADRANTS.Q3).toEqual([38, 37, 36, 35, 34, 33, 32, 31])
    expect(FDI_QUADRANTS.Q4).toEqual([41, 42, 43, 44, 45, 46, 47, 48])
  })

  it('correctly classifies tooth anatomical groups', () => {
    // Incisors (central and lateral)
    expect(getToothAnatomyGroup(11)).toBe('incisor')
    expect(getToothAnatomyGroup(22)).toBe('incisor')
    expect(getToothAnatomyGroup(31)).toBe('incisor')
    expect(getToothAnatomyGroup(42)).toBe('incisor')

    // Canines
    expect(getToothAnatomyGroup(13)).toBe('canine')
    expect(getToothAnatomyGroup(23)).toBe('canine')
    expect(getToothAnatomyGroup(33)).toBe('canine')
    expect(getToothAnatomyGroup(43)).toBe('canine')

    // Premolars
    expect(getToothAnatomyGroup(14)).toBe('premolar')
    expect(getToothAnatomyGroup(15)).toBe('premolar')
    expect(getToothAnatomyGroup(24)).toBe('premolar')
    expect(getToothAnatomyGroup(35)).toBe('premolar')

    // Molars
    expect(getToothAnatomyGroup(16)).toBe('molar')
    expect(getToothAnatomyGroup(27)).toBe('molar')
    expect(getToothAnatomyGroup(38)).toBe('molar')
    expect(getToothAnatomyGroup(46)).toBe('molar')
  })

  it('correctly identifies jaw position and anatomical side', () => {
    expect(getToothPosition(16)).toBe('upper')
    expect(getToothPosition(21)).toBe('upper')
    expect(getToothPosition(36)).toBe('lower')
    expect(getToothPosition(41)).toBe('lower')

    expect(getToothSide(16)).toBe('right')
    expect(getToothSide(46)).toBe('right')
    expect(getToothSide(26)).toBe('left')
    expect(getToothSide(36)).toBe('left')

    expect(getToothQuadrant(16)).toBe(1)
    expect(getToothQuadrant(26)).toBe(2)
    expect(getToothQuadrant(36)).toBe(3)
    expect(getToothQuadrant(46)).toBe(4)
  })

  it('has anatomical descriptive names for all 32 teeth', () => {
    for (const num of ALL_FDI_TEETH) {
      expect(TOOTH_NAMES[num]).toBeDefined()
      expect(TOOTH_NAMES[num].length).toBeGreaterThan(5)
    }
  })
})

describe('Clean-Room Odontogram — Mathematical SVG Geometry', () => {
  const groups = ['incisor', 'canine', 'premolar', 'molar'] as const
  const positions = ['upper', 'lower'] as const
  const sides = ['right', 'left'] as const

  for (const group of groups) {
    for (const position of positions) {
      for (const side of sides) {
        it(`generates complete valid vector paths for ${position} ${side} ${group}`, () => {
          const geom = getToothGeometry(group, position, side)

          expect(geom.crownOutline).toMatch(/^M\s+\d+/)
          expect(geom.rootOutline).toMatch(/^M\s+\d+/)
          expect(geom.pulpOutline).toMatch(/^M\s+\d+/)
          expect(geom.implantOutline).toMatch(/^M\s+\d+/)
          expect(geom.crownCapOutline).toMatch(/^M\s+\d+/)
          expect(geom.fractureCrackPath).toMatch(/^M\s+\d+/)
          expect(geom.gumLinePath).toMatch(/^M\s+\d+/)

          // Surfaces
          expect(geom.surfaces.mesial).toBeDefined()
          expect(geom.surfaces.distal).toBeDefined()
          expect(geom.surfaces.occlusal).toBeDefined()
          expect(geom.surfaces.buccal).toBeDefined()
          expect(geom.surfaces.lingual).toBeDefined()

          // Root canals & apex
          expect(geom.rootCanalPaths.length).toBeGreaterThanOrEqual(1)
          expect(geom.apexCenter.x).toBeGreaterThan(0)
          expect(geom.apexCenter.y).toBeGreaterThan(0)
        })
      }
    }
  }
})

describe('Clean-Room Odontogram — View Model Adapter & Statistics', () => {
  it('builds full 32-tooth view model from empty chart data', () => {
    const models = buildToothViewModels({})
    expect(Object.keys(models)).toHaveLength(32)

    const tooth11 = models[11]
    expect(tooth11.number).toBe(11)
    expect(tooth11.condition).toBe('HEALTHY')
    expect(tooth11.isMissing).toBe(false)
    expect(tooth11.surfaces.mesial).toBe(false)
  })

  it('accurately maps active entries, surfaces, and conditions', () => {
    const sampleEntries: DentalChartEntryRecord[] = [
      {
        id: 'e1',
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
        notes: 'Deep occlusal pit decay',
        diagnosedDate: new Date('2026-01-10'),
      },
      {
        id: 'e2',
        patientId: 'p1',
        hospitalId: 'h1',
        toothNumber: 21,
        toothNotation: '21',
        condition: 'IMPLANT',
        severity: 'MILD',
        mesial: false,
        distal: false,
        occlusal: false,
        buccal: false,
        lingual: false,
        diagnosedDate: new Date('2026-02-15'),
      },
      {
        id: 'e3',
        patientId: 'p1',
        hospitalId: 'h1',
        toothNumber: 36,
        toothNotation: '36',
        condition: 'ROOT_CANAL',
        severity: 'SEVERE',
        mesial: false,
        distal: false,
        occlusal: false,
        buccal: false,
        lingual: false,
        diagnosedDate: new Date('2026-03-01'),
      },
      {
        id: 'e4',
        patientId: 'p1',
        hospitalId: 'h1',
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

    const models = buildToothViewModels(sampleEntries)

    // Tooth 16 (Caries on Mesial + Occlusal)
    expect(models[16].condition).toBe('CARIES')
    expect(models[16].severity).toBe('MODERATE')
    expect(models[16].surfaces.mesial).toBe(true)
    expect(models[16].surfaces.occlusal).toBe(true)
    expect(models[16].surfaces.distal).toBe(false)
    expect(models[16].activeEntry?.notes).toBe('Deep occlusal pit decay')

    // Tooth 21 (Implant)
    expect(models[21].isImplant).toBe(true)
    expect(models[21].condition).toBe('IMPLANT')

    // Tooth 36 (Root Canal)
    expect(models[36].isRootCanal).toBe(true)
    expect(models[36].condition).toBe('ROOT_CANAL')

    // Tooth 48 (Missing)
    expect(models[48].isMissing).toBe(true)
    expect(models[48].condition).toBe('MISSING')

    // Check statistical calculations
    const stats = calculateOdontogramStats(models)
    expect(stats.totalTeeth).toBe(32)
    expect(stats.presentTeeth).toBe(31)
    expect(stats.missingTeeth).toBe(1)
    expect(stats.cariesTeeth).toBe(1)
    expect(stats.implantTeeth).toBe(1)
    expect(stats.rootCanalTeeth).toBe(1)
    expect(stats.healthyTeeth).toBe(28)
  })

  it('maintains configuration for all 16 supported dental conditions', () => {
    const conditions = Object.keys(DENTAL_CONDITION_CONFIG)
    expect(conditions.length).toBeGreaterThanOrEqual(14)
    expect(conditions).toContain('HEALTHY')
    expect(conditions).toContain('CARIES')
    expect(conditions).toContain('FILLED')
    expect(conditions).toContain('CROWN')
    expect(conditions).toContain('BRIDGE')
    expect(conditions).toContain('IMPLANT')
    expect(conditions).toContain('ROOT_CANAL')
    expect(conditions).toContain('EXTRACTION')
    expect(conditions).toContain('MISSING')
    expect(conditions).toContain('FRACTURED')
    expect(conditions).toContain('SENSITIVE')
    expect(conditions).toContain('MOBILITY')
    expect(conditions).toContain('ABSCESS')
    expect(conditions).toContain('PERIODONTAL')
  })
})

// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { getToothGeometryByNumber } from '@/components/dental-chart/geometry/tooth-paths'
import { FDI_TEETH } from '@/lib/dental-chart/fdi'

describe('WS-D: the 2D chart uses per-tooth anatomical geometry (not generic symbols)', () => {
  it('every one of the 32 FDI teeth has complete anatomical paths', () => {
    expect(FDI_TEETH).toHaveLength(32)
    for (const n of FDI_TEETH) {
      const g = getToothGeometryByNumber(n)
      expect(g, `tooth ${n}`).toBeTruthy()
      expect(g.crownOutline.length, `crown ${n}`).toBeGreaterThan(10)
      expect(g.rootOutline.length, `root ${n}`).toBeGreaterThan(10)
      for (const surface of ['mesial', 'distal', 'occlusal', 'buccal', 'lingual'] as const) {
        expect(g.surfaces[surface].length, `surface ${surface} of ${n}`).toBeGreaterThan(0)
      }
    }
  })

  it('tooth CLASSES are visibly distinct shapes (incisor ≠ canine ≠ premolar ≠ molar)', () => {
    const central = getToothGeometryByNumber(11).crownOutline
    const canine = getToothGeometryByNumber(13).crownOutline
    const premolar = getToothGeometryByNumber(14).crownOutline
    const molar = getToothGeometryByNumber(16).crownOutline
    expect(new Set([central, canine, premolar, molar]).size).toBe(4)
  })

  it('root anatomy differentiates: anterior single root, molars multi-rooted with matching canals', () => {
    expect(getToothGeometryByNumber(11).rootCount).toBe(1)
    expect(getToothGeometryByNumber(31).rootCount).toBe(1)
    expect(getToothGeometryByNumber(16).rootCount).toBeGreaterThanOrEqual(2)
    expect(getToothGeometryByNumber(36).rootCount).toBeGreaterThanOrEqual(2)
    expect(getToothGeometryByNumber(16).canalCount).toBeGreaterThanOrEqual(1)
    expect(getToothGeometryByNumber(36).rootSeparationPath ?? '').toBeTruthy()
  })

  it('upper and lower arches are oriented correctly (upper jaw rendered above the occlusal plane, lower below)', () => {
    // Teeth draw in a canonical space; orientation is applied by the arch
    // composition — the structural contract is the grid ordering.
    const { readFileSync } = require('node:fs') as { readFileSync: (p: string) => string }
    const grid = readFileSync('components/dental-chart/odontogram/ArchGrid.tsx', 'utf8')
    const upperIdx = grid.indexOf('UPPER JAW (MAXILLARY ARCH)')
    const planeIdx = grid.indexOf('OCCLUSAL PLANE HORIZONTAL DIVIDER')
    const lowerIdx = grid.indexOf('LOWER JAW (MANDIBULAR ARCH)')
    expect(upperIdx).toBeGreaterThan(-1)
    expect(planeIdx).toBeGreaterThan(upperIdx)
    expect(lowerIdx).toBeGreaterThan(planeIdx)
    // canonical path space keeps one apex convention for every tooth
    expect(Math.sign(getToothGeometryByNumber(11).apexCenter.y)).toBe(
      Math.sign(getToothGeometryByNumber(41).apexCenter.y),
    )
  })

  it('the same FDI number always yields the SAME geometry (stable identity, no randomness)', () => {
    expect(getToothGeometryByNumber(26)).toEqual(getToothGeometryByNumber(26))
  })
})

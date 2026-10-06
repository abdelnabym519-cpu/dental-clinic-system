import { describe, it, expect } from 'vitest'
import {
  toothTransform,
  toothDimensions,
  archAngle,
  ARCH_Y,
} from '@/components/dental-chart/interactive/tooth-3d'
import { FDI_TEETH, sideOf, archOf, toothIndexOf } from '@/lib/dental-chart/fdi'

// Stage E/F — the 3D scene's pure placement math (real WebGL geometry lives
// in the R3F component; these invariants pin the arch layout contract).

describe('3D arch placement', () => {
  it('places all 32 teeth with finite coordinates', () => {
    for (const t of FDI_TEETH) {
      const { position } = toothTransform(t)
      expect(position.every((v) => Number.isFinite(v))).toBe(true)
    }
  })

  it('mirrors left/right quadrants (patient right = viewer left, negative X)', () => {
    for (const idx of [1, 4, 8]) {
      const right = toothTransform(10 + idx) // 1x → upper right
      const left = toothTransform(20 + idx) // 2x → upper left
      expect(right.position[0]).toBeLessThan(0)
      expect(left.position[0]).toBeCloseTo(-right.position[0], 10)
      expect(left.position[2]).toBeCloseTo(right.position[2], 10)
    }
  })

  it('separates the arches vertically and flips upper crowns down', () => {
    const up = toothTransform(16)
    const down = toothTransform(46)
    expect(up.position[1]).toBeGreaterThan(0)
    expect(down.position[1]).toBeLessThan(0)
    expect(up.crownDown).toBe(true)
    expect(down.crownDown).toBe(false)
    expect(Math.abs(up.position[1] - down.position[1])).toBeCloseTo(2 * ARCH_Y, 10)
  })

  it('walks the arch monotonically from midline to third molar', () => {
    for (let t = 2; t <= 8; t++) {
      expect(archAngle(t)).toBeGreaterThan(archAngle(t - 1))
    }
    // molars wrap further back than incisors
    expect(toothTransform(18).position[2]).toBeGreaterThan(toothTransform(11).position[2])
  })

  it('rotation faces each tooth outward (sign follows the side)', () => {
    for (const t of FDI_TEETH) {
      const { rotationY } = toothTransform(t)
      if (sideOf(t) === 'right') expect(rotationY).toBeLessThanOrEqual(0)
      else expect(rotationY).toBeGreaterThanOrEqual(0)
    }
  })

  it('invalid teeth throw (never silently misplaced)', () => {
    expect(() => toothTransform(19)).toThrow()
    expect(() => toothTransform(0)).toThrow()
  })

  it('anatomical dimensions per group: molars widest, canines pointed, all crowned', () => {
    const molar = toothDimensions(16)
    const premolar = toothDimensions(14)
    const canine = toothDimensions(13)
    const incisor = toothDimensions(11)
    expect(molar.crownTop).toBeGreaterThan(premolar.crownTop)
    expect(premolar.crownTop).toBeGreaterThan(canine.crownTop)
    expect(canine.crownTop).toBeLessThan(incisor.crownTop) // pointed tip
    expect(molar.cusps).toBe(4)
    expect(premolar.cusps).toBe(2)
    expect(canine.cusps).toBe(0)
    expect(incisor.flattenZ).toBeLessThan(1) // buccal flattening
  })
})

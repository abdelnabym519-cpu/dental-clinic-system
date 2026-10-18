// @ts-nocheck
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildCrownGeometry,
  buildRootGeometry,
  rootSpecs,
  faciolingual,
  anatomyKeys,
  anatomyOf,
} from '@/components/dental-chart/interactive/tooth-anatomy'
import {
  toothTransform,
  toothDimensions,
  archAngle,
} from '@/components/dental-chart/interactive/tooth-3d'
import { FDI_TEETH, groupOf, archOf, toothIndexOf } from '@/lib/dental-chart/fdi'

function bbox(g: THREE.BufferGeometry) {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return {
    x: b.max.x - b.min.x,
    y: b.max.y - b.min.y,
    z: b.max.z - b.min.z,
    count: g.attributes.position.count,
  }
}

describe('Human-Accurate Dental Anatomy: All 32 Permanent FDI Teeth', () => {
  it('supports all 32 FDI permanent teeth in FDI_TEETH', () => {
    expect(FDI_TEETH).toHaveLength(32)
    for (const n of FDI_TEETH) {
      expect(() => buildCrownGeometry(n)).not.toThrow()
      expect(() => rootSpecs(n)).not.toThrow()
      expect(() => toothDimensions(n)).not.toThrow()
      expect(() => toothTransform(n)).not.toThrow()
    }
  })

  it('differentiates maxillary central (#11) vs lateral (#12) incisors', () => {
    const central = bbox(buildCrownGeometry(11))
    const lateral = bbox(buildCrownGeometry(12))

    // Central incisor is wider mesiodistally (X) and thicker faciolingually (Z) than lateral incisor
    expect(central.x).toBeGreaterThan(lateral.x)
    expect(faciolingual(11)).toBeGreaterThan(faciolingual(12))
  })

  it('differentiates maxillary (#13) vs mandibular (#33) canines', () => {
    const maxCanine = toothDimensions(13)
    const mandCanine = toothDimensions(33)

    expect(maxCanine.rootHeight).toBeGreaterThan(mandCanine.rootHeight)
    expect(faciolingual(13)).toBeGreaterThan(faciolingual(33))
  })

  it('differentiates maxillary 1st premolar (#14) 2-root system from 2nd premolar (#15)', () => {
    const roots14 = rootSpecs(14)
    const roots15 = rootSpecs(15)

    expect(roots14).toHaveLength(2)
    expect(roots15).toHaveLength(1)
  })

  it('differentiates mandibular 1st molar (#46) 5 cusps from 2nd molar (#47) 4 cusps', () => {
    const m1 = toothDimensions(46)
    const m2 = toothDimensions(47)

    expect(m1.cusps).toBe(5)
    expect(m2.cusps).toBe(4)
  })

  it('differentiates maxillary molars (3 roots) vs mandibular molars (2 roots)', () => {
    expect(rootSpecs(16)).toHaveLength(3) // maxillary 1st molar: MB, DB, palatal
    expect(rootSpecs(27)).toHaveLength(3) // maxillary 2nd molar
    expect(rootSpecs(36)).toHaveLength(2) // mandibular 1st molar: mesial, distal
    expect(rootSpecs(47)).toHaveLength(2) // mandibular 2nd molar
  })

  it('ensures all 32 generated crown geometries have finite vertex coordinates', () => {
    for (const n of FDI_TEETH) {
      const geo = buildCrownGeometry(n)
      const pos = geo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true)
        expect(Number.isFinite(pos.getY(i))).toBe(true)
        expect(Number.isFinite(pos.getZ(i))).toBe(true)
      }
    }
  })

  it('preserves backwards compatibility with string group arguments', () => {
    const groups = ['incisor', 'canine', 'premolar', 'molar'] as const
    for (const g of groups) {
      expect(() => buildCrownGeometry(g)).not.toThrow()
      expect(() => rootSpecs(g, 'upper')).not.toThrow()
      expect(() => faciolingual(g)).not.toThrow()
    }
  })
})

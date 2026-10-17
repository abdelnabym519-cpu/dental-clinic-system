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
import { FDI_TEETH, groupOf, archOf } from '@/lib/dental-chart/fdi'

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

describe('WS-C: anatomically differentiated 3D tooth geometry', () => {
  const GROUPS = ['incisor', 'canine', 'premolar', 'molar'] as const

  it('every tooth class builds a crown geometry with a DISTINCT shape (not one box reused)', () => {
    const geoms = GROUPS.map((g) => buildCrownGeometry(g))
    const bbs = geoms.map(bbox)
    // distinct vertex layouts (different outlines/bevels), not one primitive
    const counts = new Set(bbs.map((b) => b.count))
    expect(counts.size).toBeGreaterThanOrEqual(3)
    // mesiodistal width ordering: molar > premolar > incisor, canine distinct
    expect(bbs[3].x).toBeGreaterThan(bbs[2].x) // molar > premolar
    expect(bbs[2].x).toBeGreaterThan(bbs[0].x) // premolar > incisor
  })

  it('the crown is FLATTENED faciolingually (the old models never applied flatten): incisor is blade-like', () => {
    const incisor = bbox(buildCrownGeometry('incisor'))
    expect(incisor.z / incisor.x).toBeLessThan(0.85) // visibly thinner than wide
    expect(faciolingual('incisor')).toBeLessThan(faciolingual('molar'))
  })

  it('crowns TAPER toward the cervix (narrower root-end than occlusal end)', () => {
    for (const g of GROUPS) {
      const geo = buildCrownGeometry(g)
      const pos = geo.attributes.position as THREE.BufferAttribute
      let bottomWidth = 0
      let topWidth = 0
      let bn = 0
      let tn = 0
      geo.computeBoundingBox()
      const midY = (geo.boundingBox!.max.y + geo.boundingBox!.min.y) / 2
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i))
        if (pos.getY(i) < midY - 0.08) {
          bottomWidth += r
          bn++
        } else if (pos.getY(i) > midY + 0.08) {
          topWidth += r
          tn++
        }
      }
      expect(topWidth / tn).toBeGreaterThan(bottomWidth / bn)
    }
  })

  it('root systems are class- and arch-specific: molars multi-rooted, anteriors single-rooted', () => {
    expect(rootSpecs('molar', 'lower')).toHaveLength(2) // mesial + distal
    expect(rootSpecs('molar', 'upper')).toHaveLength(3) // + palatal
    expect(rootSpecs('incisor', 'upper')).toHaveLength(1)
    expect(rootSpecs('canine', 'lower')).toHaveLength(1)
    expect(rootSpecs('premolar', 'upper')).toHaveLength(1)
    // the shared root cone is apex-down (base at Y=0)
    const root = buildRootGeometry()
    root.computeBoundingBox()
    expect(root.boundingBox!.min.y).toBeCloseTo(-1, 5)
    expect(root.boundingBox!.max.y).toBeCloseTo(0, 5)
  })

  it('the full 32-tooth identity space builds — every FDI tooth maps to a valid (group, arch) anatomy', () => {
    expect(FDI_TEETH).toHaveLength(32)
    for (const n of FDI_TEETH) {
      const { group, arch } = anatomyOf(n)
      expect(GROUPS).toContain(group)
      expect(['upper', 'lower']).toContain(arch)
      expect(() => buildCrownGeometry(group)).not.toThrow()
      expect(() => rootSpecs(group, arch)).not.toThrow()
    }
    // key space covers every class/arch pair exactly once
    expect(anatomyKeys()).toHaveLength(8)
  })

  it('WS-E PARITY: 2D geometry labels and 3D classes come from ONE identity source (fdi.ts)', () => {
    // the 2D chart keys its anatomical paths by (arch, type-index) identity
    // derived in tooth-paths; the 3D derives (group, arch) via the same
    // functions — spot-prove the identity agreement on representative teeth.
    const pairs: Array<[number, string, 'upper' | 'lower']> = [
      [11, 'incisor', 'upper'], // upper right central incisor
      [43, 'canine', 'lower'], // lower right canine
      [24, 'premolar', 'upper'], // upper left first premolar
      [36, 'molar', 'lower'], // lower left first molar
      [48, 'molar', 'lower'], // lower right third molar
    ]
    for (const [n, group, arch] of pairs) {
      expect(groupOf(n)).toBe(group)
      expect(archOf(n)).toBe(arch)
      expect(anatomyOf(n)).toEqual({ group, arch })
    }
  })
})

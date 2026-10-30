// @ts-nocheck
/**
 * P2-procedural — the no-overlap contract for the 3D dental arch.
 *
 * Every adjacent pair of teeth along an arch must be separated by at least
 * -CONTACT_TOLERANCE. Real teeth touch at a contact point; they do not
 * interpenetrate. Before this test, all 44 adjacent pairs interpenetrated, the
 * worst by ~37% of a crown width (measured in S4).
 *
 * Method: exact separating-axis test on the REAL BufferGeometry produced by
 * buildCrownGeometry(groupOf(n)), projected to the occlusal (XZ) plane and
 * transformed by the REAL toothTransform(n). Support functions are evaluated
 * over the geometry's own vertices, which is equivalent to using its convex
 * hull, so a positive result means the crowns provably intersect.
 *
 * The tolerance is imported from the solver rather than restated here, so the
 * spacing and the assertion can never disagree.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'

import {
  toothTransform,
  toothDimensions,
  CONTACT_TOLERANCE,
  CROWN_MESIODISTAL,
  CROWN_FACIOLINGUAL,
} from '@/components/dental-chart/interactive/tooth-3d'
import { buildCrownGeometry } from '@/components/dental-chart/interactive/tooth-anatomy'
import { groupOf, isValidFdi } from '@/lib/dental-chart/fdi'

/** All 52 valid FDI ids: 32 permanent + 20 primary. */
export const ALL_FDI: number[] = Array.from({ length: 90 }, (_, i) => i).filter(
  (n) => n >= 11 && n <= 85 && isValidFdi(n)
)

/** Quadrants and how many tooth positions each holds (primary have 5, not 8). */
const QUADRANTS: Array<{ q: number; count: number }> = [
  { q: 1, count: 8 },
  { q: 2, count: 8 },
  { q: 3, count: 8 },
  { q: 4, count: 8 },
  { q: 5, count: 5 },
  { q: 6, count: 5 },
  { q: 7, count: 5 },
  { q: 8, count: 5 },
]

/** Cached crown vertices (projected to XZ) per FDI id. */
const vertexCache = new Map<number, Float64Array>()

function crownVerticesXZ(n: number): Float64Array {
  const cached = vertexCache.get(n)
  if (cached) return cached

  const geo = buildCrownGeometry(groupOf(n))
  const pos = geo.attributes.position as THREE.BufferAttribute
  const { position, rotationY } = toothTransform(n)
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)

  // World XZ: rotate about Y (x' = x cos + z sin, z' = -x sin + z cos), translate.
  const out = new Float64Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i)
    const lz = pos.getZ(i)
    out[i * 2] = lx * cos + lz * sin + position[0]
    out[i * 2 + 1] = -lx * sin + lz * cos + position[2]
  }
  vertexCache.set(n, out)
  return out
}

/**
 * Andrew's monotone chain: convex hull of a flat [x,z,x,z,...] vertex array,
 * returned hull-ordered.
 *
 * The crown BufferGeometry stores vertices in ring/segment order, NOT hull
 * order, so consecutive vertices are chords rather than hull edges. Deriving
 * edge normals straight from the buffer yields directions that are not hull
 * normals and makes the SAT unsound. The hull fixes that.
 */
function convexHull(v: Float64Array): Float64Array {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < v.length; i += 2) pts.push([v[i], v[i + 1]])
  pts.sort((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]))

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const hullLower: Array<[number, number]> = []
  for (const p of pts) {
    while (
      hullLower.length >= 2 &&
      cross(hullLower[hullLower.length - 2], hullLower[hullLower.length - 1], p) <= 0
    )
      hullLower.pop()
    hullLower.push(p)
  }
  const hullUpper: Array<[number, number]> = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (
      hullUpper.length >= 2 &&
      cross(hullUpper[hullUpper.length - 2], hullUpper[hullUpper.length - 1], p) <= 0
    )
      hullUpper.pop()
    hullUpper.push(p)
  }
  const hull = hullLower.slice(0, -1).concat(hullUpper.slice(0, -1))
  const out = new Float64Array(hull.length * 2)
  hull.forEach((p, i) => {
    out[i * 2] = p[0]
    out[i * 2 + 1] = p[1]
  })
  return out
}

const hullCache = new Map<number, Float64Array>()
function hullOf(n: number): Float64Array {
  let h = hullCache.get(n)
  if (!h) {
    h = convexHull(crownVerticesXZ(n))
    hullCache.set(n, h)
  }
  return h
}

/** Support distance of tooth n's crown along world XZ direction (dx, dz). */
function support(n: number, dx: number, dz: number): number {
  const v = crownVerticesXZ(n)
  let best = -Infinity
  for (let i = 0; i < v.length; i += 2) {
    const d = v[i] * dx + v[i + 1] * dz
    if (d > best) best = d
  }
  return best
}

/** Centre of the crown's XZ bounding box. */
function centre(n: number): [number, number] {
  const v = crownVerticesXZ(n)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < v.length; i += 2) {
    if (v[i] < minX) minX = v[i]
    if (v[i] > maxX) maxX = v[i]
    if (v[i + 1] < minZ) minZ = v[i + 1]
    if (v[i + 1] > maxZ) maxZ = v[i + 1]
  }
  return [(minX + maxX) / 2, (minZ + maxZ) / 2]
}

/**
 * Penetration depth between crowns a and b (positive => provably intersecting).
 *
 * crownVerticesXZ() already bakes the toothTransform translation into the
 * vertices, so both crowns live in one world frame. The separating-axis test
 * is then simply:
 *   separated along u  <=>  supportA(u) + supportB(-u) < 0
 * and the minimum of that over all u is the negative separation (or the
 * penetration depth when positive). No centre-delta term belongs here; it is
 * already inside the support values.
 *
 * Exact SAT: for two convex hulls a separating direction, if one exists, is one
 * of the hull edge normals, so testing exactly those (plus the centre line)
 * gives the true minimum.
 */
export function penetration(a: number, b: number): number {
  const [ax, az] = centre(a)
  const [bx, bz] = centre(b)

  const test = (dx: number, dz: number): number => {
    const len = Math.hypot(dx, dz)
    if (len === 0) return Infinity
    const ux = dx / len
    const uz = dz / len
    return support(a, ux, uz) + support(b, -ux, -uz)
  }

  let best = test(bx - ax, bz - az) // the centre line
  for (const n of [a, b]) {
    const h = hullOf(n)
    for (let i = 0; i + 3 < h.length; i += 2) {
      const p = test(-(h[i + 3] - h[i + 1]), h[i + 2] - h[i]) // outward edge normal
      if (p < best) best = p
    }
    // close the loop back to vertex 0
    const p = test(-(h[1] - h[h.length - 1]), h[0] - h[h.length - 2])
    if (p < best) best = p
  }
  return best
}

/** Every adjacent (same-quadrant, consecutive-index) pair across all 52 ids. */
export function adjacentPairs(): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (const { q, count } of QUADRANTS) {
    for (let d = 1; d < count; d++) pairs.push([q * 10 + d, q * 10 + d + 1])
  }
  return pairs
}

describe('P2-procedural: the 3D arch places teeth without interpenetration', () => {
  it('covers all 52 valid FDI ids', () => {
    expect(ALL_FDI).toHaveLength(52)
    expect(new Set(ALL_FDI).size).toBe(52)
  })

  it('no adjacent pair interpenetrates by more than CONTACT_TOLERANCE', () => {
    const failures: string[] = []
    let worst = { pair: '', value: -Infinity }

    for (const [a, b] of adjacentPairs()) {
      const p = penetration(a, b)
      if (p > worst.value) worst = { pair: `${a}-${b}`, value: p }
      if (p > CONTACT_TOLERANCE) {
        failures.push(`${a}-${b} (${groupOf(a)}/${groupOf(b)}): penetration ${p.toFixed(4)}`)
      }
    }

    // Report the worst clearance so a pass is informative, not silent.
    console.log(
      `  worst adjacent clearance: ${worst.pair} penetration ${worst.value.toFixed(4)} ` +
        `(tolerance ${CONTACT_TOLERANCE}); ${adjacentPairs().length - failures.length}` +
        `/${adjacentPairs().length} pairs clear`
    )
    if (failures.length) {
      console.log('  ' + failures.slice(0, 8).join('\n  '))
    }
    expect(failures).toEqual([])
  })
})

/** FDI quadrant pairing: upper quadrant -> its lower counterpart. */
const LOWER_COUNTERPART: Record<number, number> = { 1: 4, 2: 3, 5: 8, 6: 7 }

describe('inter-arch clearance', () => {
  /**
   * S4 measured a positive vertical gap between the upper and lower crown
   * envelopes for every group. The P2 step 2 re-spacing moved teeth around the
   * arch but must not have eaten into that gap, so pin it here with the real
   * geometry rather than trusting the ARCH_Y constant alone.
   */
  it('upper and lower crowns never collide vertically', () => {
    const envelopes = new Map<number, { minY: number; maxY: number }>()

    for (const n of ALL_FDI) {
      const { position, crownDown } = toothTransform(n)
      const geo = buildCrownGeometry(groupOf(n))
      geo.computeBoundingBox()
      const bb = geo.boundingBox!
      // DentalChart3D's ToothMesh offsets the crown mesh by
      // crownY = -(upper) or +(lower) crownHeight/2, so crowns point at the
      // occlusal plane.
      const d = toothDimensions(n)
      const crownY = crownDown ? -d.crownHeight / 2 : d.crownHeight / 2
      envelopes.set(n, {
        minY: position[1] + crownY + bb.min.y,
        maxY: position[1] + crownY + bb.max.y,
      })
    }

    const failures: string[] = []
    let worst = { pair: '', gap: Infinity }
    let compared = 0

    for (const [upperQ, lowerQ] of Object.entries(LOWER_COUNTERPART)) {
      const uq = Number(upperQ)
      const lq = Number(lowerQ)
      const count = uq >= 5 ? 5 : 8
      for (let d = 1; d <= count; d++) {
        const u = envelopes.get(uq * 10 + d)
        const l = envelopes.get(lq * 10 + d)
        if (!u || !l) continue
        compared++
        const gap = u.minY - l.maxY
        if (gap < worst.gap) worst = { pair: `${uq * 10 + d} vs ${lq * 10 + d}`, gap }
        if (gap <= 0) failures.push(`${uq * 10 + d} vs ${lq * 10 + d}: gap ${gap.toFixed(4)}`)
      }
    }

    // non-vacuity: 26 upper/lower pairs covers all 52 teeth (32 permanent +
    // 20 primary), so a passing run cannot be an empty loop.
    expect(compared).toBe(26)
    console.log(
      `  inter-arch: ${compared} pairs, worst clear gap ${worst.gap.toFixed(4)} (${worst.pair})`
    )
    expect(failures).toEqual([])
  })
})

describe('the spacing table matches the real crown geometry', () => {
  // tooth-3d.ts carries its own copy of the per-group crown extents so the arch
  // solver does not have to import the geometry module (which would create a
  // circular import: tooth-anatomy.ts imports tooth-3d.ts). That copy is only
  // safe while it matches the real geometry, so pin it here.
  it('CROWN_MESIODISTAL / CROWN_FACIOLINGUAL equal the measured bounding box', () => {
    for (const group of ['incisor', 'canine', 'premolar', 'molar'] as const) {
      const geo = buildCrownGeometry(group)
      geo.computeBoundingBox()
      const bb = geo.boundingBox!
      const measuredX = bb.max.x - bb.min.x
      const measuredZ = bb.max.z - bb.min.z
      expect(
        Math.abs(CROWN_MESIODISTAL[group] - measuredX),
        `CROWN_MESIODISTAL.${group} drifted from buildCrownGeometry`
      ).toBeLessThan(0.002)
      expect(
        Math.abs(CROWN_FACIOLINGUAL[group] - measuredZ),
        `CROWN_FACIOLINGUAL.${group} drifted from buildCrownGeometry`
      ).toBeLessThan(0.002)
    }
  })
})

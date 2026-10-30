// @ts-nocheck
/**
 * P2-procedural step 1 — the no-overlap contract for the 3D dental arch.
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
 * The tolerance is deliberately named and exported so the contract is explicit
 * rather than implied by a magic number at the assertion site.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'

import { buildCrownGeometry } from '@/components/dental-chart/interactive/tooth-anatomy'
import { toothTransform } from '@/components/dental-chart/interactive/tooth-3d'
import { groupOf, isValidFdi } from '@/lib/dental-chart/fdi'

/**
 * Maximum allowed interpenetration between two adjacent crowns, in world
 * units. Crowns are 0.28-0.46 wide, so 0.01 is ~2-3% of a crown: enough to
 * read as a contact point, far too little to look like teeth merging.
 */
export const CONTACT_TOLERANCE = 0.01

/** All 52 valid FDI ids: 32 permanent + 20 primary. */
export const ALL_FDI = Array.from({ length: 90 }, (_, i) => i).filter(
  (n) => n >= 11 && n <= 85 && isValidFdi(n)
)

/** Quadrants and how many tooth positions each holds (primary have 5, not 8). */
const QUADRANTS: Array<{ q: number; count: number; label: string }> = [
  { q: 1, count: 8, label: 'permanent upper right' },
  { q: 2, count: 8, label: 'permanent upper left' },
  { q: 3, count: 8, label: 'permanent lower left' },
  { q: 4, count: 8, label: 'permanent lower right' },
  { q: 5, count: 5, label: 'primary upper right' },
  { q: 6, count: 5, label: 'primary upper left' },
  { q: 7, count: 5, label: 'primary lower left' },
  { q: 8, count: 5, label: 'primary lower right' },
]

/** Cached crown vertices (projected to XZ) per FDI id. */
const cache = new Map<number, Float64Array>()

function crownVerticesXZ(n: number): Float64Array {
  const cached = cache.get(n)
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
  cache.set(n, out)
  return out
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

/** Centre of the crown's XZ bounding box (a stable anchor for the centre delta). */
function centre(n: number): [number, number] {
  const v = crownVerticesXZ(n)
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  for (let i = 0; i < v.length; i += 2) {
    if (v[i] < minX) minX = v[i]
    if (v[i] > maxX) maxX = v[i]
    if (v[i + 1] < minZ) minZ = v[i + 1]
    if (v[i + 1] > maxZ) maxZ = v[i + 1]
  }
  return [(minX + maxX) / 2, (minZ + maxZ) / 2]
}

/**
 * Andrew's monotone chain: convex hull of a flat [x,z,x,z,...] vertex array,
 * returned as a hull-ordered [x,z,...] array.
 *
 * The crown BufferGeometry stores vertices in ring/segment order, NOT hull
 * order, so consecutive vertices are chords rather than hull edges. Deriving
 * edge normals straight from the buffer produces directions that are not hull
 * normals and makes the SAT unsound. The hull fixes that.
 */
function convexHull(v: Float64Array): Float64Array {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < v.length; i += 2) pts.push([v[i], v[i + 1]])
  pts.sort((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]))

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const lower: Array<[number, number]> = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
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

/**
 * Penetration depth between crowns a and b (positive => provably intersecting).
 *
 * Exact SAT: for two convex hulls a separating direction, if one exists, is
 * one of the hull edge normals of either hull, so testing exactly those (plus
 * the centre line) yields the true minimum penetration.
 */
export function penetration(a: number, b: number): number {
  // crownVerticesXZ() already bakes the toothTransform translation into the
  // vertices, so both crowns live in the same world frame. The separating-axis
  // test is then simply:
  //   separated along u  <=>  supportA(u) + supportB(-u) < 0
  // and the minimum of that quantity over all u is the negative separation (or
  // the penetration depth when positive). No centre-delta term belongs here:
  // it is already inside the support values.
  const [ax, az] = centre(a)
  const [bx, bz] = centre(b)

  const test = (dx: number, dz: number) => {
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
      const ex = h[i + 2] - h[i]
      const ez = h[i + 3] - h[i + 1]
      const p = test(-ez, ex) // outward edge normal
      if (p < best) best = p
    }
    // close the loop back to vertex 0
    const ex = h[0] - h[h.length - 2]
    const ez = h[1] - h[h.length - 1]
    const p = test(-ez, ex)
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

    // Diagnostic output so a failure names the worst offender, not just "failed".
    if (failures.length) {
      console.log(
        `\n  worst pair: ${worst.pair} at ${worst.value.toFixed(4)} ` +
          `(tolerance ${CONTACT_TOLERANCE})\n  ` +
          failures.slice(0, 8).join('\n  ') +
          `\n  ... ${failures.length} of ${adjacentPairs().length} pairs interpenetrate`
      )
    }
    expect(failures).toEqual([])
  })
})

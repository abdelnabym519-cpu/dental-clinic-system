/**
 * DenToRa — Interactive Dental Chart: 3D arch geometry (procedural, original).
 *
 * Pure math placing each FDI tooth on a parametric dental arch. No external
 * assets (constraint: original geometry only) — and structured so procedural
 * meshes can later be swapped for anatomical GLTFs without touching callers.
 *
 * Viewer convention: front view looks at the patient's face, so the patient's
 * RIGHT side appears at negative X. The arch bows toward +Z (toward camera).
 */

import {
  archOf,
  groupOf,
  sideOf,
  toothIndexOf,
  isValidFdi,
  isPrimaryFdi,
  type ToothGroup,
} from '@/lib/dental-chart/fdi'

export interface ToothTransform {
  position: [number, number, number]
  /** Rotation about the vertical axis so each tooth faces outward (buccal). */
  rotationY: number
  /** Upper teeth are flipped so crowns point down toward the occlusal plane. */
  crownDown: boolean
}

/** Vertical separation between the two arches (occlusal gap). */
export const ARCH_Y = 0.52

/**
 * Maximum allowed interpenetration between two adjacent crowns, in world units.
 *
 * Adjacent teeth touch at a contact point; they do not merge. This is the
 * single source of truth for that contract: the arch solver spaces teeth to
 * land within it, and tests/unit/tooth-arch-spacing.test.ts asserts it.
 */
export const CONTACT_TOLERANCE = 0.01

const ARCH_X = 2.35 // horizontal semi-axis
const ARCH_Z = 3.1 // depth semi-axis

/**
 * Crown mesiodistal width per tooth group, measured from the real
 * buildCrownGeometry bounding boxes (not hand-tuned).
 *
 * Duplication risk: tooth-anatomy.ts holds the spec widths these are derived
 * from. tests/unit/tooth-arch-spacing.test.ts pins this table against the real
 * geometry so it cannot silently drift.
 */
export const CROWN_MESIODISTAL: Record<ToothGroup, number> = {
  incisor: 0.28,
  canine: 0.3,
  premolar: 0.3534,
  molar: 0.4642,
}

/**
 * Crown faciolingual (Z) depth per group, measured from the same bounding
 * boxes. Needed because a crown's support along a diagonal is larger than half
 * its width: the canine is deeper than it is wide (0.3074 vs 0.3000), so
 * spacing by width alone under-spaces it.
 */
export const CROWN_FACIOLINGUAL: Record<ToothGroup, number> = {
  incisor: 0.2027,
  canine: 0.3074,
  premolar: 0.3029,
  molar: 0.4009,
}

/** A point on the arch ellipse at parameter theta. */
function archPoint(theta: number): [number, number] {
  return [ARCH_X * Math.sin(theta), ARCH_Z * (1 - Math.cos(theta))]
}

/** Arc-length rate of the ellipse at angle theta: |dP/dtheta|. */
function archSpeed(theta: number): number {
  return Math.hypot(ARCH_X * Math.cos(theta), ARCH_Z * Math.sin(theta))
}

/**
 * Walk the ellipse accumulating arc length and record the angle at each target
 * distance, interpolating inside the final step so the seed is exact rather
 * than always overshooting.
 */
function anglesForArcLengths(targets: number[]): number[] {
  const STEP = 5e-4
  const angles: number[] = []
  let theta = 0
  let acc = 0
  let k = 0
  while (k < targets.length && theta < Math.PI) {
    if (acc >= targets[k]) {
      angles.push(theta)
      k++
      continue
    }
    const next = archSpeed(theta + STEP / 2) * STEP
    if (acc + next >= targets[k]) {
      angles.push(theta + STEP * ((targets[k] - acc) / next))
      k++
      acc += next
      theta += STEP
      continue
    }
    acc += next
    theta += STEP
  }
  while (angles.length < targets.length) angles.push(theta)
  return angles
}

/**
 * Half-extent of a crown along direction (dx, dz), given it is rotated by
 * rotationY. The crown's local axes after a Y rotation are
 *   localX = ( cos ry, -sin ry)   localZ = ( sin ry,  cos ry)
 * so the support is the corner projection, which is exact for a box and
 * conservative (never under-estimates) for the real rounded crown.
 */
function crownSupport(
  halfX: number,
  halfZ: number,
  rotationY: number,
  dx: number,
  dz: number
): number {
  const c = Math.cos(rotationY)
  const sn = Math.sin(rotationY)
  const alongX = dx * c - dz * sn
  const alongZ = dx * sn + dz * c
  return halfX * Math.abs(alongX) + halfZ * Math.abs(alongZ)
}

/** Walk theta forward from `from` until the chord back to `origin` reaches `need`. */
function angleAtChordDistance(from: number, origin: [number, number], need: number): number {
  const STEP = 2e-4
  let theta = from
  for (let i = 0; i < 20000; i++) {
    const [px, pz] = archPoint(theta)
    if (Math.hypot(px - origin[0], pz - origin[1]) >= need) return theta
    theta += STEP
  }
  return theta
}

/**
 * Solve the arch angles for one dentition sequence.
 *
 * Teeth are spaced by what actually matters - each crown's support along the
 * chord to its neighbour, not its width - so the result holds for any crown
 * orientation. That makes the spacing depend on the angles and vice versa, so
 * this runs a short fixed-point iteration (converged well inside 12 passes).
 */
function solveAngles(quadrantPrefix: number, count: number): number[] {
  const halfX: number[] = []
  const halfZ: number[] = []
  for (let i = 1; i <= count; i++) {
    const g = groupOf(quadrantPrefix * 10 + i)
    halfX.push(CROWN_MESIODISTAL[g] / 2)
    halfZ.push(CROWN_FACIOLINGUAL[g] / 2)
  }

  // Seed: cumulative arc length using half-widths, so the iteration starts
  // close to the answer and only has to correct the diagonal overshoot.
  const seed: number[] = [halfX[0]]
  for (let i = 1; i < count; i++) {
    seed.push(seed[i - 1] + halfX[i - 1] + halfX[i] - CONTACT_TOLERANCE)
  }
  let angles = anglesForArcLengths(seed)

  for (let iter = 0; iter < 12; iter++) {
    const next: number[] = [angles[0]]
    for (let i = 1; i < count; i++) {
      const origin = archPoint(next[i - 1])
      let dx = archPoint(angles[i])[0] - origin[0]
      let dz = archPoint(angles[i])[1] - origin[1]
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      const need =
        crownSupport(halfX[i - 1], halfZ[i - 1], angles[i - 1], dx, dz) +
        crownSupport(halfX[i], halfZ[i], angles[i], dx, dz) -
        CONTACT_TOLERANCE
      next.push(angleAtChordDistance(next[i - 1], origin, need))
    }
    const delta = Math.max(...next.map((a, i) => Math.abs(a - angles[i])))
    angles = next
    if (delta < 1e-6) break
  }
  return angles
}

// Permanent (8 per quadrant) and primary (5 per quadrant) are spaced
// independently: a primary quadrant is incisor/incisor/canine/molar/molar, so
// its spacing sequence differs from the permanent one and must not reuse it.
const PERMANENT_ANGLES = solveAngles(1, 8)
const PRIMARY_ANGLES = solveAngles(5, 5)

/** Parametric arch angle for permanent tooth index 1..8 (radians). */
export function archAngle(toothIndex: number): number {
  return PERMANENT_ANGLES[Math.min(Math.max(toothIndex, 1), 8) - 1]
}

/** Parametric arch angle for primary tooth index 1..5 (radians). */
export function primaryArchAngle(toothIndex: number): number {
  return PRIMARY_ANGLES[Math.min(Math.max(toothIndex, 1), 5) - 1]
}

/** Arch angle for any valid FDI number, picking the right dentition sequence. */
function archAngleOf(n: number): number {
  return isPrimaryFdi(n) ? primaryArchAngle(toothIndexOf(n)) : archAngle(toothIndexOf(n))
}

export function toothTransform(n: number): ToothTransform {
  if (!isValidFdi(n)) throw new Error(`Invalid FDI tooth number: ${n}`)
  const t = toothIndexOf(n)
  const theta = archAngleOf(n)
  const right = sideOf(n) === 'right'
  // Right-side teeth at negative X (patient's right = viewer's left).
  const x = (right ? -1 : 1) * ARCH_X * Math.sin(theta)
  const z = ARCH_Z * (1 - Math.cos(theta))
  const y = archOf(n) === 'upper' ? ARCH_Y : -ARCH_Y
  return {
    position: [x, y, z],
    rotationY: (right ? -1 : 1) * theta,
    crownDown: archOf(n) === 'upper',
  }
}

/**
 * Crown/root dimensions per anatomical group (recognizable, stylized).
 * { crownRadiusTop, crownRadiusBottom, crownHeight, rootHeight, radialSegments, flattenZ, cusps }
 */
export interface ToothDimensions {
  crownTop: number
  crownBottom: number
  crownHeight: number
  rootHeight: number
  segments: number
  flattenZ: number
  cusps: number
}

export function toothDimensions(n: number): ToothDimensions {
  switch (groupOf(n)) {
    case 'incisor':
      return {
        crownTop: 0.13,
        crownBottom: 0.17,
        crownHeight: 0.34,
        rootHeight: 0.4,
        segments: 4,
        flattenZ: 0.62,
        cusps: 0,
      }
    case 'canine':
      return {
        crownTop: 0.07,
        crownBottom: 0.17,
        crownHeight: 0.38,
        rootHeight: 0.46,
        segments: 4,
        flattenZ: 0.75,
        cusps: 0,
      }
    case 'premolar':
      return {
        crownTop: 0.17,
        crownBottom: 0.15,
        crownHeight: 0.3,
        rootHeight: 0.4,
        segments: 8,
        flattenZ: 0.85,
        cusps: 2,
      }
    case 'molar':
    default:
      return {
        crownTop: 0.22,
        crownBottom: 0.17,
        crownHeight: 0.3,
        rootHeight: 0.38,
        segments: 8,
        flattenZ: 0.95,
        cusps: 4,
      }
  }
}

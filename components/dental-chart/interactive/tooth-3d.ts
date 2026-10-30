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
import type { ToothSpecificType } from '../types/odontogram'

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
 * Crown extents per anatomical class, measured from the real
 * buildAnatomicalCrownGeometry bounding boxes (not hand-tuned): [x, z] where x
 * is mesiodistal width and z is faciolingual depth.
 *
 * Spacing is per-class rather than per-group because the group masters are a
 * width-tuned compromise and no longer match what the renderer draws - and
 * because maxillary and mandibular crowns genuinely differ (a mandibular
 * central incisor is 0.17 wide, a maxillary one 0.30; mandibular molars are
 * the wider of the two). Spacing by group would hang the whole lower arch off
 * upper-arch sizes.
 *
 * Duplication risk: tooth-anatomy.ts owns the specs these are derived from.
 * tests/unit/anatomical-spec-resolution.test.ts pins this table against the
 * real geometry so it cannot silently drift.
 */
export const CROWN_EXTENTS: Record<ToothSpecificType, [number, number]> = {
  maxillary_central_incisor: [0.3, 0.2492],
  maxillary_lateral_incisor: [0.23, 0.2148],
  maxillary_canine: [0.26, 0.3453],
  maxillary_first_premolar: [0.2423, 0.313],
  maxillary_second_premolar: [0.2423, 0.313],
  maxillary_first_molar: [0.3798, 0.422],
  maxillary_second_molar: [0.3482, 0.3904],
  maxillary_third_molar: [0.3165, 0.3693],
  mandibular_central_incisor: [0.17, 0.1998],
  mandibular_lateral_incisor: [0.19, 0.214],
  mandibular_canine: [0.24, 0.3014],
  mandibular_first_premolar: [0.2423, 0.2625],
  mandibular_second_premolar: [0.2423, 0.2827],
  mandibular_first_molar: [0.4115, 0.3904],
  mandibular_second_molar: [0.3904, 0.3693],
  mandibular_third_molar: [0.3587, 0.3587],
}

/**
 * Crown extents per group, used only for primary teeth, which have no
 * anatomical class of their own (see step 5). Measured from
 * buildCrownGeometry(group) bounding boxes.
 */
export const CROWN_GROUP_EXTENTS: Record<ToothGroup, [number, number]> = {
  incisor: [0.28, 0.2027],
  canine: [0.3, 0.3074],
  premolar: [0.3534, 0.3029],
  molar: [0.4642, 0.4009],
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
/** Extents for one arch sequence: 8 permanent classes, or 5 primary groups. */
function solveAngles(extents: Array<[number, number]>): number[] {
  const halfX = extents.map((e) => e[0] / 2)
  const halfZ = extents.map((e) => e[1] / 2)
  const count = extents.length

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

/**
 * Three independently solved sequences. Upper and lower differ because
 * maxillary and mandibular crowns differ, so the lower arch is genuinely
 * smaller and nests inside the upper one - which is what normal occlusion
 * looks like. Permanent arches are per-class; primary uses group extents
 * because primary teeth have no anatomical class of their own yet (step 5).
 */
const UPPER_ANGLES = solveAngles(
  (
    [
      'maxillary_central_incisor',
      'maxillary_lateral_incisor',
      'maxillary_canine',
      'maxillary_first_premolar',
      'maxillary_second_premolar',
      'maxillary_first_molar',
      'maxillary_second_molar',
      'maxillary_third_molar',
    ] as ToothSpecificType[]
  ).map((k) => CROWN_EXTENTS[k])
)

const LOWER_ANGLES = solveAngles(
  (
    [
      'mandibular_central_incisor',
      'mandibular_lateral_incisor',
      'mandibular_canine',
      'mandibular_first_premolar',
      'mandibular_second_premolar',
      'mandibular_first_molar',
      'mandibular_second_molar',
      'mandibular_third_molar',
    ] as ToothSpecificType[]
  ).map((k) => CROWN_EXTENTS[k])
)

// A primary quadrant is incisor/incisor/canine/molar/molar, so its spacing
// sequence differs from the permanent one and must not reuse it.
const PRIMARY_ANGLES = solveAngles(
  (['incisor', 'incisor', 'canine', 'molar', 'molar'] as ToothGroup[]).map(
    (g) => CROWN_GROUP_EXTENTS[g]
  )
)

/** Parametric arch angle for a permanent upper tooth index 1..8 (radians). */
export function archAngle(toothIndex: number): number {
  return UPPER_ANGLES[Math.min(Math.max(toothIndex, 1), 8) - 1]
}

/** Parametric arch angle for a permanent lower tooth index 1..8 (radians). */
export function lowerArchAngle(toothIndex: number): number {
  return LOWER_ANGLES[Math.min(Math.max(toothIndex, 1), 8) - 1]
}

/** Parametric arch angle for a primary tooth index 1..5 (radians). */
export function primaryArchAngle(toothIndex: number): number {
  return PRIMARY_ANGLES[Math.min(Math.max(toothIndex, 1), 5) - 1]
}

/** Arch angle for any valid FDI number, picking the right arch and dentition. */
function archAngleOf(n: number): number {
  const i = toothIndexOf(n)
  if (isPrimaryFdi(n)) return primaryArchAngle(i)
  return archOf(n) === 'upper' ? archAngle(i) : lowerArchAngle(i)
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

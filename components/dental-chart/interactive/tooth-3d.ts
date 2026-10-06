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

import { archOf, groupOf, sideOf, toothIndexOf, isValidFdi } from '@/lib/dental-chart/fdi'

export interface ToothTransform {
  position: [number, number, number]
  /** Rotation about the vertical axis so each tooth faces outward (buccal). */
  rotationY: number
  /** Upper teeth are flipped so crowns point down toward the occlusal plane. */
  crownDown: boolean
}

/** Vertical separation between the two arches (occlusal gap). */
export const ARCH_Y = 0.52

/** Parametric arch angle for tooth index 1..8 (radians from the midline). */
export function archAngle(toothIndex: number): number {
  // Central incisor nearly frontal; third molar wraps back ~78°.
  return 0.14 + (toothIndex - 1) * 0.092
}

const ARCH_X = 2.35 // horizontal semi-axis
const ARCH_Z = 3.1 // depth semi-axis

export function toothTransform(n: number): ToothTransform {
  if (!isValidFdi(n)) throw new Error(`Invalid FDI tooth number: ${n}`)
  const t = toothIndexOf(n)
  const theta = archAngle(t)
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
      return { crownTop: 0.13, crownBottom: 0.17, crownHeight: 0.34, rootHeight: 0.4, segments: 4, flattenZ: 0.62, cusps: 0 }
    case 'canine':
      return { crownTop: 0.07, crownBottom: 0.17, crownHeight: 0.38, rootHeight: 0.46, segments: 4, flattenZ: 0.75, cusps: 0 }
    case 'premolar':
      return { crownTop: 0.17, crownBottom: 0.15, crownHeight: 0.3, rootHeight: 0.4, segments: 8, flattenZ: 0.85, cusps: 2 }
    case 'molar':
    default:
      return { crownTop: 0.22, crownBottom: 0.17, crownHeight: 0.3, rootHeight: 0.38, segments: 8, flattenZ: 0.95, cusps: 4 }
  }
}

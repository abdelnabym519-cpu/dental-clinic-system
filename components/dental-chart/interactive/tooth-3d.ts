/**
 * DenToRa — Interactive Dental Chart: 3D arch geometry & tooth dimensions.
 *
 * Pure math placing each FDI tooth on a parametric dental arch and providing
 * tooth-specific crown/root anatomical dimensions for all 32 permanent teeth.
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
  return 0.14 + (toothIndex - 1) * 0.092
}

const ARCH_X = 2.35 // horizontal semi-axis
const ARCH_Z = 3.1 // depth semi-axis

export function toothTransform(n: number): ToothTransform {
  if (!isValidFdi(n)) throw new Error(`Invalid FDI tooth number: ${n}`)
  const t = toothIndexOf(n)
  const theta = archAngle(t)
  const right = sideOf(n) === 'right'
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
 * Crown/root dimensions per tooth index & anatomical group.
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
  const group = groupOf(n)
  const pos = toothIndexOf(n)
  const arch = archOf(n)

  if (group === 'incisor') {
    if (arch === 'upper') {
      // Maxillary central incisor (#11/21) is wider than lateral (#12/22)
      return pos === 1
        ? { crownTop: 0.16, crownBottom: 0.18, crownHeight: 0.36, rootHeight: 0.44, segments: 4, flattenZ: 0.58, cusps: 0 }
        : { crownTop: 0.13, crownBottom: 0.16, crownHeight: 0.32, rootHeight: 0.42, segments: 4, flattenZ: 0.62, cusps: 0 }
    }
    // Mandibular incisors (#31/32/41/42) are narrowest
    return pos === 1
      ? { crownTop: 0.11, crownBottom: 0.14, crownHeight: 0.3, rootHeight: 0.4, segments: 4, flattenZ: 0.55, cusps: 0 }
      : { crownTop: 0.12, crownBottom: 0.15, crownHeight: 0.31, rootHeight: 0.42, segments: 4, flattenZ: 0.55, cusps: 0 }
  }

  if (group === 'canine') {
    return arch === 'upper'
      ? { crownTop: 0.08, crownBottom: 0.18, crownHeight: 0.4, rootHeight: 0.52, segments: 4, flattenZ: 0.72, cusps: 0 }
      : { crownTop: 0.07, crownBottom: 0.16, crownHeight: 0.37, rootHeight: 0.48, segments: 4, flattenZ: 0.75, cusps: 0 }
  }

  if (group === 'premolar') {
    return pos === 4
      ? { crownTop: 0.17, crownBottom: 0.15, crownHeight: 0.31, rootHeight: 0.42, segments: 8, flattenZ: 0.85, cusps: 2 }
      : { crownTop: 0.18, crownBottom: 0.16, crownHeight: 0.3, rootHeight: 0.4, segments: 8, flattenZ: 0.88, cusps: 2 }
  }

  // Molar
  if (arch === 'lower' && pos === 6) {
    // Mandibular 1st molar has 5 cusps
    return { crownTop: 0.24, crownBottom: 0.18, crownHeight: 0.32, rootHeight: 0.42, segments: 8, flattenZ: 0.95, cusps: 5 }
  }
  if (pos === 6) {
    return { crownTop: 0.23, crownBottom: 0.18, crownHeight: 0.31, rootHeight: 0.4, segments: 8, flattenZ: 0.95, cusps: 4 }
  }
  if (pos === 7) {
    return { crownTop: 0.21, crownBottom: 0.16, crownHeight: 0.29, rootHeight: 0.38, segments: 8, flattenZ: 0.92, cusps: 4 }
  }
  // 3rd molar (wisdom tooth, compact)
  return { crownTop: 0.19, crownBottom: 0.15, crownHeight: 0.27, rootHeight: 0.34, segments: 8, flattenZ: 0.88, cusps: 4 }
}

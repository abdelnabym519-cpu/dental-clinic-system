/**
 * DenToRa — Interactive Dental Chart: procedural ANATOMICAL crown/root
 * geometry (Workstream C & Human-Accurate Tooth Morphometry).
 *
 * Provides anatomical 3D geometry for all 32 permanent teeth (FDI 11..48).
 * Distinguishes all 8 tooth positions in each quadrant across maxillary & mandibular arches:
 * - Maxillary central (#11/21) vs lateral (#12/22) incisors vs mandibular incisors (#31/32/41/42)
 * - Maxillary (#13/23) vs mandibular (#33/43) canines
 * - 1st (#14/24/34/44) vs 2nd (#15/25/35/45) premolars (including 2-rooted maxillary 1st premolars)
 * - 1st (#16/26/36/46), 2nd (#17/27/37/47), and 3rd (#18/28/38/48) molars
 *   (maxillary 3-rooted, mandibular 2-rooted mesial/distal, 5-cusp mandibular 1st molar, 4-cusp 2nd molar, compact 3rd molar)
 *
 * Pure functions only: callers own caching/disposal.
 */

import * as THREE from 'three'
import { groupOf, archOf, toothIndexOf, isValidFdi } from '@/lib/dental-chart/fdi'
import { toothDimensions } from './tooth-3d'

export type ToothGroup = 'incisor' | 'canine' | 'premolar' | 'molar'

/** Faciolingual thickness of the crown per group/FDI number. */
export function faciolingual(target: ToothGroup | number): number {
  if (typeof target === 'string') {
    switch (target) {
      case 'incisor':
        return 0.2
      case 'canine':
        return 0.24
      case 'premolar':
        return 0.3
      case 'molar':
        return 0.38
    }
  }

  const group = groupOf(target)
  const pos = toothIndexOf(target)
  const arch = archOf(target)

  if (group === 'incisor') {
    if (arch === 'upper') {
      return pos === 1 ? 0.22 : 0.19 // Maxillary central slightly thicker than lateral
    }
    return 0.17 // Mandibular incisors very flattened
  }

  if (group === 'canine') {
    return arch === 'upper' ? 0.26 : 0.23
  }

  if (group === 'premolar') {
    return arch === 'upper' ? 0.32 : 0.29
  }

  // Molar
  if (arch === 'upper') {
    return pos === 6 ? 0.4 : pos === 7 ? 0.38 : 0.35
  }
  return pos === 6 ? 0.38 : pos === 7 ? 0.36 : 0.33
}

/**
 * Occlusal outline in mesiodistal (X) x faciolingual (Y) plane.
 * Extruded along Z which is then rotated to crown vertical axis Y.
 */
function occlusalOutline(target: ToothGroup | number): THREE.Shape {
  const s = new THREE.Shape()

  const group = typeof target === 'string' ? target : groupOf(target)
  const f = faciolingual(target)

  let w = 0.3
  if (typeof target === 'number' && isValidFdi(target)) {
    const pos = toothIndexOf(target)
    const arch = archOf(target)
    if (group === 'incisor') {
      if (arch === 'upper') w = pos === 1 ? 0.36 : 0.28
      else w = pos === 1 ? 0.24 : 0.26 // lower lateral slightly wider than lower central
    } else if (group === 'canine') {
      w = arch === 'upper' ? 0.35 : 0.31
    } else if (group === 'premolar') {
      w = pos === 4 ? 0.34 : 0.36
    } else {
      // molar
      w = pos === 6 ? 0.48 : pos === 7 ? 0.44 : 0.4
    }
  } else {
    w = group === 'molar' ? 0.46 : group === 'premolar' ? 0.36 : group === 'canine' ? 0.34 : 0.3
  }

  const hw = w / 2
  const hf = f / 2

  if (group === 'incisor') {
    // Chisel / blade-like incisal edge
    s.moveTo(-hw * 0.62, -hf)
    s.quadraticCurveTo(-hw * 0.9, -hf * 0.5, -hw, 0)
    s.quadraticCurveTo(-hw * 0.9, hf * 0.7, -hw * 0.66, hf)
    s.lineTo(hw * 0.66, hf)
    s.quadraticCurveTo(hw * 0.9, hf * 0.7, hw, 0)
    s.quadraticCurveTo(hw * 0.9, -hf * 0.5, hw * 0.62, -hf)
    s.quadraticCurveTo(0, -hf * 1.25, -hw * 0.62, -hf)
  } else if (group === 'canine') {
    // Rhombic outline with labial cusp prominence
    s.moveTo(0, hf * 1.15)
    s.quadraticCurveTo(hw * 0.8, hf * 0.4, hw, 0)
    s.quadraticCurveTo(hw * 0.7, -hf * 0.7, 0, -hf)
    s.quadraticCurveTo(-hw * 0.7, -hf * 0.7, -hw, 0)
    s.quadraticCurveTo(-hw * 0.8, hf * 0.4, 0, hf * 1.15)
  } else if (group === 'premolar') {
    // Ovoid crown, oval or rounded-pentagonal
    s.absellipse(0, 0, hw, hf * 0.92, 0, Math.PI * 2, false, 0)
  } else {
    // Molar: rounded-rectangle occlusal table
    const r = hf * 0.85
    s.moveTo(-hw + r, -hf)
    s.lineTo(hw - r, -hf)
    s.quadraticCurveTo(hw, -hf, hw, -hf + r)
    s.lineTo(hw, hf - r)
    s.quadraticCurveTo(hw, hf, hw - r, hf)
    s.lineTo(-hw + r, hf)
    s.quadraticCurveTo(-hw, hf, -hw, hf - r)
    s.lineTo(-hw, -hf + r)
    s.quadraticCurveTo(-hw, -hf, -hw + r, -hf)
  }
  return s
}

/**
 * Builds crown geometry for a specific FDI tooth number (11..48) or tooth group.
 */
export function buildCrownGeometry(target: ToothGroup | number): THREE.BufferGeometry {
  const group = typeof target === 'string' ? target : groupOf(target)
  const repFdi =
    typeof target === 'number'
      ? target
      : group === 'incisor'
        ? 11
        : group === 'canine'
          ? 13
          : group === 'premolar'
            ? 14
            : 16

  const d = toothDimensions(repFdi)
  const f = faciolingual(target)
  const shape = occlusalOutline(target)

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d.crownHeight,
    bevelEnabled: true,
    bevelThickness: Math.min(0.045, d.crownHeight * 0.16),
    bevelSize: Math.min(0.035, f * 0.18),
    bevelSegments: 3,
    curveSegments: 12,
    steps: 1,
  })

  // Extrusion +Z -> crown axis +Y
  geo.rotateX(-Math.PI / 2)
  geo.center()

  // Cervical taper: narrower at cervix (-Y), full width at occlusal third (+Y)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const h = d.crownHeight
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = THREE.MathUtils.clamp((y + h / 2) / h, 0, 1)
    const scale = 0.7 + 0.3 * Math.min(1, t / 0.75)
    pos.setX(i, pos.getX(i) * scale)
    pos.setZ(i, pos.getZ(i) * scale)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

export interface RootSpec {
  /** Local offset from cervix origin. */
  offset: [number, number, number]
  /** Splay / divergence angles (radians). */
  rotZ: number
  rotX: number
}

/**
 * Root system configuration per tooth / group and arch.
 */
export function rootSpecs(target: ToothGroup | number, archParam?: 'upper' | 'lower'): RootSpec[] {
  let group: ToothGroup
  let arch: 'upper' | 'lower'
  let toothPos = 6

  if (typeof target === 'number' && isValidFdi(target)) {
    group = groupOf(target)
    arch = archOf(target)
    toothPos = toothIndexOf(target)
  } else if (typeof target === 'string') {
    group = target
    arch = archParam || 'upper'
  } else {
    group = 'incisor'
    arch = 'upper'
  }

  if (group === 'molar') {
    if (arch === 'upper') {
      // Maxillary molar: 3 roots (mesiobuccal, distobuccal, palatal)
      const splay = toothPos === 6 ? 0.24 : toothPos === 7 ? 0.18 : 0.1
      return [
        { offset: [-0.11, 0.02, 0.06], rotZ: splay, rotX: 0 },
        { offset: [0.11, 0.02, 0.06], rotZ: -splay, rotX: 0 },
        { offset: [0, 0.02, -0.12], rotZ: 0, rotX: -splay * 1.2 },
      ]
    }
    // Mandibular molar: 2 roots (mesial, distal)
    const splay = toothPos === 6 ? 0.22 : toothPos === 7 ? 0.16 : 0.08
    return [
      { offset: [-0.1, 0.02, 0], rotZ: splay, rotX: 0 },
      { offset: [0.1, 0.02, 0], rotZ: -0.2, rotX: 0 },
    ]
  }

  if (group === 'premolar' && arch === 'upper' && toothPos === 4) {
    // Maxillary first premolar commonly has 2 roots (buccal + palatal)
    return [
      { offset: [0, 0.02, 0.06], rotZ: 0.08, rotX: 0.1 },
      { offset: [0, 0.02, -0.06], rotZ: -0.08, rotX: -0.1 },
    ]
  }

  // Anteriors & single-root premolars
  return [{ offset: [0, 0.02, 0], rotZ: 0, rotX: 0 }]
}

/** One tapered root cone (unit height, base at Y=0, apex at Y=-1). */
export function buildRootGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.075, 1, 10)
  geo.translate(0, -0.5, 0)
  return geo
}

/** Anatomical key space used by the 3D renderer caches. */
export function anatomyKeys(): { group: ToothGroup; arch: 'upper' | 'lower' }[] {
  const groups: ToothGroup[] = ['incisor', 'canine', 'premolar', 'molar']
  const arches: Array<'upper' | 'lower'> = ['upper', 'lower']
  return groups.flatMap((group) => arches.map((arch) => ({ group, arch })))
}

/** Group + arch for an FDI tooth. */
export function anatomyOf(n: number): { group: ToothGroup; arch: 'upper' | 'lower' } {
  return { group: groupOf(n), arch: archOf(n) }
}

export { toothIndexOf }

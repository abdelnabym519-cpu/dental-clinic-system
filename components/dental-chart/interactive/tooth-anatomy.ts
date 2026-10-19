/**
 * DenToRa — Interactive Dental Chart: procedural ANATOMICAL crown/root
 * geometry (Workstream C).
 *
 * Replaces the block-like primitive crowns (CylinderGeometry with 4/8
 * segments) with class-morphology geometry built from occlusal outlines:
 * an extruded, bevelled, cervically-tapered crown per tooth GROUP, plus
 * class- and arch-specific root systems (single root for anteriors,
 * two-rooted mandibular / three-rooted maxillary molars).
 *
 * This is a stylized clinical approximation — visibly differentiated
 * incisors/canines/premolars/molars — NOT a claim of clinical-grade
 * anatomy. Original procedural geometry only (no external assets).
 *
 * Pure functions only: callers own caching/disposal (DentalChart3D shares
 * one geometry instance per class and disposes on unmount — Stage N rule).
 */

import * as THREE from 'three'
import { groupOf, archOf, toothIndexOf } from '@/lib/dental-chart/fdi'
import { toothDimensions } from './tooth-3d'

export type ToothGroup = 'incisor' | 'canine' | 'premolar' | 'molar'

/** Faciolingual thickness of the crown (the flatten the old models never applied). */
export function faciolingual(group: ToothGroup): number {
  switch (group) {
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

/**
 * Occlusal outline of the crown in the mesiodistal (X) × faciolingual (Y)
 * plane, centred on the origin. The extrusion axis becomes the crown axis.
 */
function occlusalOutline(group: ToothGroup): THREE.Shape {
  const s = new THREE.Shape()
  const w = group === 'molar' ? 0.46 : group === 'premolar' ? 0.36 : group === 'canine' ? 0.34 : 0.3
  const f = faciolingual(group)
  const hw = w / 2
  const hf = f / 2

  if (group === 'incisor') {
    // Broad, relatively flat crown with a wide straight incisal edge and
    // converging mesial/ distal margins toward the cervix (drawn in the
    // occlusal outline as a rounded wedge).
    s.moveTo(-hw * 0.62, -hf)
    s.quadraticCurveTo(-hw * 0.9, -hf * 0.5, -hw, 0)
    s.quadraticCurveTo(-hw * 0.9, hf * 0.7, -hw * 0.66, hf)
    s.lineTo(hw * 0.66, hf)
    s.quadraticCurveTo(hw * 0.9, hf * 0.7, hw, 0)
    s.quadraticCurveTo(hw * 0.9, -hf * 0.5, hw * 0.62, -hf)
    s.quadraticCurveTo(0, -hf * 1.25, -hw * 0.62, -hf)
  } else if (group === 'canine') {
    // Rhombic outline — the single pointed cusp reads as a ridge in 3D.
    s.moveTo(0, hf * 1.15) // cusp tip (faciolingually prominent)
    s.quadraticCurveTo(hw * 0.8, hf * 0.4, hw, 0)
    s.quadraticCurveTo(hw * 0.7, -hf * 0.7, 0, -hf)
    s.quadraticCurveTo(-hw * 0.7, -hf * 0.7, -hw, 0)
    s.quadraticCurveTo(-hw * 0.8, hf * 0.4, 0, hf * 1.15)
  } else if (group === 'premolar') {
    // Ovoid crown, slightly broader mesiodistally than faciolingually.
    s.absellipse(0, 0, hw, hf * 0.92, 0, Math.PI * 2, false, 0)
  } else {
    // Molar: broad, squat rounded-square occlusal table.
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
 * Build one crown geometry for a tooth group: occlusal outline extruded to
 * the crown height, bevelled (rounded occlusal rim), then tapered toward
 * the cervix. Occlusal surface at +Y, cervix at -Y, centred on the origin.
 */
export function buildCrownGeometry(group: ToothGroup): THREE.BufferGeometry {
  const d = toothDimensions(
    // map the group back to a representative FDI tooth for dimensions
    group === 'incisor' ? 11 : group === 'canine' ? 13 : group === 'premolar' ? 14 : 16
  )
  const f = faciolingual(group)
  const shape = occlusalOutline(group)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d.crownHeight,
    bevelEnabled: true,
    bevelThickness: Math.min(0.045, d.crownHeight * 0.16),
    bevelSize: Math.min(0.035, f * 0.18),
    bevelSegments: 3,
    curveSegments: 12,
    steps: 1,
  })
  // extrusion +Z → crown axis +Y (occlusal outline spans X=mesiodistal, Y→Z)
  geo.rotateX(-Math.PI / 2)
  geo.center()
  // cervical taper: narrower at the cervix, full width at the occlusal third
  const pos = geo.attributes.position as THREE.BufferAttribute
  const h = d.crownHeight
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = THREE.MathUtils.clamp((y + h / 2) / h, 0, 1) // 0 cervix → 1 occlusal
    const scale = 0.7 + 0.3 * Math.min(1, t / 0.75)
    pos.setX(i, pos.getX(i) * scale)
    pos.setZ(i, pos.getZ(i) * scale)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

export interface RootSpec {
  /** Local offset from the tooth origin (cervix; Y component = base embed into the crown). */
  offset: [number, number, number]
  /** Small splay so multi-rooted teeth fan apart. */
  rotZ: number
  rotX: number
}

/**
 * Root SYSTEM per group and arch (local space where the crown points +Y and
 * roots extend −Y; the component's crownDown flip orients upper teeth).
 */
export function rootSpecs(group: ToothGroup, arch: 'upper' | 'lower'): RootSpec[] {
  if (group === 'molar') {
    if (arch === 'upper') {
      // maxillary molar: 3 roots (2 buccal + 1 palatal)
      return [
        { offset: [-0.11, 0.02, 0.06], rotZ: 0.24, rotX: 0 },
        { offset: [0.11, 0.02, 0.06], rotZ: -0.24, rotX: 0 },
        { offset: [0, 0.02, -0.12], rotZ: 0, rotX: -0.3 },
      ]
    }
    // mandibular molar: 2 roots (mesial + distal)
    return [
      { offset: [-0.1, 0.02, 0], rotZ: 0.2, rotX: 0 },
      { offset: [0.1, 0.02, 0], rotZ: -0.2, rotX: 0 },
    ]
  }
  // anterior teeth and premolars: single root (canine longest via dims)
  return [{ offset: [0, 0.02, 0], rotZ: 0, rotX: 0 }]
}

/**
 * One tapered root cone (unit height, apex at −Y) — shared by every root
 * mesh; per-root scale/rotation differentiates the system.
 */
export function buildRootGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.075, 1, 10)
  geo.translate(0, -0.5, 0) // base at Y=0 (cervix), apex at Y=-1
  return geo
}

/** Convenience: the anatomy key space used by the 3D renderer's caches. */
export function anatomyKeys(): { group: ToothGroup; arch: 'upper' | 'lower' }[] {
  const groups: ToothGroup[] = ['incisor', 'canine', 'premolar', 'molar']
  const arches: Array<'upper' | 'lower'> = ['upper', 'lower']
  return groups.flatMap((group) => arches.map((arch) => ({ group, arch })))
}

/** Group + arch for an FDI tooth (shared identity — Workstream E). */
export function anatomyOf(n: number): { group: ToothGroup; arch: 'upper' | 'lower' } {
  return { group: groupOf(n), arch: archOf(n) }
}

// re-exported so the renderer and tests share ONE identity path
export { toothIndexOf }

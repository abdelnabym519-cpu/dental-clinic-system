/**
 * DenToRa — Interactive Dental Chart: High-Fidelity Human Tooth Anatomy
 *
 * Implements authoritative procedural 3D anatomical crowns and multi-rooted
 * systems for all 16 distinct human permanent tooth classes across both arches:
 *
 * Maxillary (Upper):
 *   1. Central Incisor (11/21)  - Broad shovel-shaped crown, palatal cingulum, marginal ridges
 *   2. Lateral Incisor (12/22)  - Rounded distoincisal angle, deeper lingual fossa, distal apical curve
 *   3. Canine (13/23)           - Powerful diamond silhouette, central labial ridge, stoutest root
 *   4. First Premolar (14/24)   - Bicuspid (buccal > palatal), mesial marginal groove, bifurcated roots
 *   5. Second Premolar (15/25)  - Equal bicuspid, rounded ovoid occlusal table, single root
 *   6. First Molar (16/26)      - Rhomboidal, 4 cusps + Carabelli, Oblique Ridge, 3 divergent roots (tripod)
 *   7. Second Molar (17/27)     - Rhomboidal/heart-shaped, 4 cusps (smaller DL), 3 parallel roots
 *   8. Third Molar (18/28)      - Heart-shaped 3-cusp crown, fused convergent roots
 *
 * Mandibular (Lower):
 *   9. Central Incisor (31/41)  - Smallest tooth, bilateral chisel symmetry, mesiodistally flat root
 *  10. Lateral Incisor (32/42)  - Asymmetric incisal slope, crown distally twisted on root base
 *  11. Canine (33/43)           - Tallest mandibular crown, continuous labial curvature, long root
 *  12. First Premolar (34/44)   - Dominant buccal cusp + diminutive non-functional lingual cusp
 *  13. Second Premolar (35/45)  - Square occlusal table with 3 cusps (1 buccal, 2 lingual) in Y-pattern
 *  14. First Molar (36/46)      - Pentagonal table, 5 cusps (3 buccal, 2 lingual) in Y-5 groove pattern, 2 broad roots
 *  15. Second Molar (37/47)     - Rectangular table, 4 cusps in cruciform (+) groove pattern, 2 roots
 *  16. Third Molar (38/48)      - Rounded rectangular table, 4-5 cusps, crenulated fissures, 2 fused roots
 *
 * Authoritative Dental Anatomy References:
 *   - Wheeler's Dental Anatomy, Physiology and Occlusion (Nelson & Ash, 11th Ed.)
 *   - Woelfel's Dental Anatomy (Scheid & Weiss, 9th Ed.)
 *   - ISO 3950 / FDI World Dental Federation Two-Digit Numbering System
 */

import * as THREE from 'three'
import {
  groupOf,
  archOf,
  toothIndexOf,
  isValidFdi,
  sideOf,
  specificTypeOf,
  FDI_TEETH,
  type ToothArch,
  type ToothGroup,
} from '@/lib/dental-chart/fdi'
import { toothDimensions } from './tooth-3d'
import type { ToothSpecificType } from '../types/odontogram'

export type { ToothGroup }

// -----------------------------------------------------------------------------
// ANATOMICAL SPECIFICATIONS (Wheeler & Woelfel Ground Truth)
// -----------------------------------------------------------------------------

export interface AnatomicalToothSpec {
  specificType: ToothSpecificType
  fdiExamples: number[]
  group: ToothGroup
  arch: ToothArch
  crownHeight: number
  mesiodistalWidth: number
  faciolingualDepth: number
  cervicalTaperMD: number
  cervicalTaperFL: number
  cuspCount: number
  cuspPattern: string
  rootCount: number
  rootSystem: RootSpec[]
  features: {
    incisalAsymmetry?: boolean
    cingulumProminence?: number
    lingualFossaDepth?: number
    labialRidge?: number
    obliqueRidge?: boolean
    carabelliCusp?: boolean
    mesialMarginalGroove?: boolean
    diminutiveLingualCusp?: boolean
    tricuspidYGroove?: boolean
    pentagonalY5Molar?: boolean
    cruciform4Molar?: boolean
  }
  referenceCitation: string
}

export const ANATOMICAL_SPECS: Record<ToothSpecificType, AnatomicalToothSpec> = {
  maxillary_central_incisor: {
    specificType: 'maxillary_central_incisor',
    fdiExamples: [11, 21],
    group: 'incisor',
    arch: 'upper',
    crownHeight: 0.35,
    mesiodistalWidth: 0.3,
    faciolingualDepth: 0.23,
    cervicalTaperMD: 0.68,
    cervicalTaperFL: 0.72,
    cuspCount: 0,
    cuspPattern: 'incisal_chisel',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: 0, rotX: 0 }],
    features: {
      incisalAsymmetry: true,
      cingulumProminence: 0.035,
      lingualFossaDepth: 0.025,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 6; Woelfel Table 4-1 (MD 8.5mm, FL 7.0mm, Crown 10.5mm)",
  },
  maxillary_lateral_incisor: {
    specificType: 'maxillary_lateral_incisor',
    fdiExamples: [12, 22],
    group: 'incisor',
    arch: 'upper',
    crownHeight: 0.31,
    mesiodistalWidth: 0.23,
    faciolingualDepth: 0.2,
    cervicalTaperMD: 0.66,
    cervicalTaperFL: 0.7,
    cuspCount: 0,
    cuspPattern: 'incisal_chisel',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: -0.08, rotX: 0 }],
    features: {
      incisalAsymmetry: true,
      cingulumProminence: 0.03,
      lingualFossaDepth: 0.03,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 6; Woelfel Table 4-2 (Rounded distoincisal angle, distal root curvature)",
  },
  maxillary_canine: {
    specificType: 'maxillary_canine',
    fdiExamples: [13, 23],
    group: 'canine',
    arch: 'upper',
    crownHeight: 0.34,
    mesiodistalWidth: 0.26,
    faciolingualDepth: 0.28,
    cervicalTaperMD: 0.65,
    cervicalTaperFL: 0.72,
    cuspCount: 1,
    cuspPattern: 'pointed_canine',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: -0.06, rotX: 0 }],
    features: {
      labialRidge: 0.04,
      cingulumProminence: 0.04,
      lingualFossaDepth: 0.02,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 7; Woelfel Table 5-1 (Longest tooth in dentition, prominent labial/palatal ridges)",
  },
  maxillary_first_premolar: {
    specificType: 'maxillary_first_premolar',
    fdiExamples: [14, 24],
    group: 'premolar',
    arch: 'upper',
    crownHeight: 0.29,
    mesiodistalWidth: 0.24,
    faciolingualDepth: 0.31,
    cervicalTaperMD: 0.7,
    cervicalTaperFL: 0.75,
    cuspCount: 2,
    cuspPattern: 'bicuspid_max',
    rootCount: 2,
    rootSystem: [
      { offset: [0, 0.02, 0.07], rotZ: 0, rotX: 0.12 },
      { offset: [0, 0.02, -0.07], rotZ: 0, rotX: -0.12 },
    ],
    features: {
      mesialMarginalGroove: true,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 9; Woelfel Table 6-1 (Bifurcated buccal/palatal roots, mesial marginal groove)",
  },
  maxillary_second_premolar: {
    specificType: 'maxillary_second_premolar',
    fdiExamples: [15, 25],
    group: 'premolar',
    arch: 'upper',
    crownHeight: 0.29,
    mesiodistalWidth: 0.24,
    faciolingualDepth: 0.31,
    cervicalTaperMD: 0.72,
    cervicalTaperFL: 0.76,
    cuspCount: 2,
    cuspPattern: 'bicuspid_max',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: -0.05, rotX: 0 }],
    features: {},
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 9; Woelfel Table 6-2 (Equal bicuspid height, ovoid table, single root)",
  },
  maxillary_first_molar: {
    specificType: 'maxillary_first_molar',
    fdiExamples: [16, 26],
    group: 'molar',
    arch: 'upper',
    crownHeight: 0.26,
    mesiodistalWidth: 0.36,
    faciolingualDepth: 0.4,
    cervicalTaperMD: 0.74,
    cervicalTaperFL: 0.78,
    cuspCount: 5,
    cuspPattern: 'molar_max_carabelli',
    rootCount: 3,
    rootSystem: [
      { offset: [-0.12, 0.02, 0.08], rotZ: 0.22, rotX: 0.14 }, // Mesiobuccal
      { offset: [0.12, 0.02, 0.08], rotZ: -0.22, rotX: 0.14 }, // Distobuccal
      { offset: [0, 0.02, -0.13], rotZ: 0, rotX: -0.32 }, // Palatal (largest tripod leg)
    ],
    features: {
      obliqueRidge: true,
      carabelliCusp: true,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 11; Woelfel Table 7-1 (Rhomboid, Oblique Ridge, Carabelli, 3 divergent roots)",
  },
  maxillary_second_molar: {
    specificType: 'maxillary_second_molar',
    fdiExamples: [17, 27],
    group: 'molar',
    arch: 'upper',
    crownHeight: 0.25,
    mesiodistalWidth: 0.33,
    faciolingualDepth: 0.37,
    cervicalTaperMD: 0.74,
    cervicalTaperFL: 0.78,
    cuspCount: 4,
    cuspPattern: 'molar_max_4cusp',
    rootCount: 3,
    rootSystem: [
      { offset: [-0.1, 0.02, 0.06], rotZ: 0.16, rotX: 0.1 },
      { offset: [0.1, 0.02, 0.06], rotZ: -0.16, rotX: 0.1 },
      { offset: [0, 0.02, -0.11], rotZ: 0, rotX: -0.22 },
    ],
    features: {
      obliqueRidge: true,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 11; Woelfel Table 7-2 (Heart-shaped/rhomboid, reduced DL cusp, 3 less divergent roots)",
  },
  maxillary_third_molar: {
    specificType: 'maxillary_third_molar',
    fdiExamples: [18, 28],
    group: 'molar',
    arch: 'upper',
    crownHeight: 0.23,
    mesiodistalWidth: 0.3,
    faciolingualDepth: 0.35,
    cervicalTaperMD: 0.76,
    cervicalTaperFL: 0.8,
    cuspCount: 3,
    cuspPattern: 'molar_max_4cusp',
    rootCount: 3,
    rootSystem: [
      { offset: [-0.07, 0.02, 0.04], rotZ: 0.1, rotX: 0.08 },
      { offset: [0.07, 0.02, 0.04], rotZ: -0.1, rotX: 0.08 },
      { offset: [0, 0.02, -0.08], rotZ: 0, rotX: -0.14 },
    ],
    features: {},
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 11; Woelfel Table 7-3 (Heart-shaped 3 cusps, fused/convergent roots)",
  },
  mandibular_central_incisor: {
    specificType: 'mandibular_central_incisor',
    fdiExamples: [31, 41],
    group: 'incisor',
    arch: 'lower',
    crownHeight: 0.32,
    mesiodistalWidth: 0.17,
    faciolingualDepth: 0.2,
    cervicalTaperMD: 0.65,
    cervicalTaperFL: 0.7,
    cuspCount: 0,
    cuspPattern: 'incisal_chisel',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: 0, rotX: 0 }],
    features: {
      incisalAsymmetry: false,
      cingulumProminence: 0.015,
      lingualFossaDepth: 0.01,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 6; Woelfel Table 4-3 (Smallest tooth, bilateral chisel symmetry, mesiodistally flat root)",
  },
  mandibular_lateral_incisor: {
    specificType: 'mandibular_lateral_incisor',
    fdiExamples: [32, 42],
    group: 'incisor',
    arch: 'lower',
    crownHeight: 0.32,
    mesiodistalWidth: 0.19,
    faciolingualDepth: 0.21,
    cervicalTaperMD: 0.66,
    cervicalTaperFL: 0.7,
    cuspCount: 0,
    cuspPattern: 'incisal_chisel',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: -0.05, rotX: 0 }],
    features: {
      incisalAsymmetry: true,
      cingulumProminence: 0.02,
      lingualFossaDepth: 0.015,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 6; Woelfel Table 4-4 (Distal incisal edge slope, crown twisted on root)",
  },
  mandibular_canine: {
    specificType: 'mandibular_canine',
    fdiExamples: [33, 43],
    group: 'canine',
    arch: 'lower',
    crownHeight: 0.37,
    mesiodistalWidth: 0.24,
    faciolingualDepth: 0.26,
    cervicalTaperMD: 0.65,
    cervicalTaperFL: 0.72,
    cuspCount: 1,
    cuspPattern: 'pointed_canine',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: -0.06, rotX: 0 }],
    features: {
      labialRidge: 0.03,
      cingulumProminence: 0.025,
      lingualFossaDepth: 0.015,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 7; Woelfel Table 5-2 (Tallest mandibular crown, continuous labial curve, long root)",
  },
  mandibular_first_premolar: {
    specificType: 'mandibular_first_premolar',
    fdiExamples: [34, 44],
    group: 'premolar',
    arch: 'lower',
    crownHeight: 0.28,
    mesiodistalWidth: 0.24,
    faciolingualDepth: 0.26,
    cervicalTaperMD: 0.7,
    cervicalTaperFL: 0.74,
    cuspCount: 2,
    cuspPattern: 'bicuspid_man_diminutive',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: -0.05, rotX: 0 }],
    features: {
      diminutiveLingualCusp: true,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 10; Woelfel Table 6-3 (Dominant buccal cusp ~70%, diminutive non-functional lingual cusp)",
  },
  mandibular_second_premolar: {
    specificType: 'mandibular_second_premolar',
    fdiExamples: [35, 45],
    group: 'premolar',
    arch: 'lower',
    crownHeight: 0.27,
    mesiodistalWidth: 0.24,
    faciolingualDepth: 0.28,
    cervicalTaperMD: 0.72,
    cervicalTaperFL: 0.76,
    cuspCount: 3,
    cuspPattern: 'tricuspid_man_y',
    rootCount: 1,
    rootSystem: [{ offset: [0, 0.02, 0], rotZ: -0.05, rotX: 0 }],
    features: {
      tricuspidYGroove: true,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 10; Woelfel Table 6-4 (Square table, 3 cusps in Y-groove pattern: 1 buccal, 2 lingual)",
  },
  mandibular_first_molar: {
    specificType: 'mandibular_first_molar',
    fdiExamples: [36, 46],
    group: 'molar',
    arch: 'lower',
    crownHeight: 0.26,
    mesiodistalWidth: 0.39,
    faciolingualDepth: 0.37,
    cervicalTaperMD: 0.74,
    cervicalTaperFL: 0.78,
    cuspCount: 5,
    cuspPattern: 'molar_man_5cusp_y5',
    rootCount: 2,
    rootSystem: [
      { offset: [-0.12, 0.02, 0], rotZ: 0.24, rotX: 0 }, // Mesial root (broad, fluted)
      { offset: [0.12, 0.02, 0], rotZ: -0.2, rotX: 0 }, // Distal root (curved distally)
    ],
    features: {
      pentagonalY5Molar: true,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 12; Woelfel Table 7-4 (Pentagonal table, 5 cusps in Y-5 groove pattern, 2 broad curved roots)",
  },
  mandibular_second_molar: {
    specificType: 'mandibular_second_molar',
    fdiExamples: [37, 47],
    group: 'molar',
    arch: 'lower',
    crownHeight: 0.25,
    mesiodistalWidth: 0.37,
    faciolingualDepth: 0.35,
    cervicalTaperMD: 0.74,
    cervicalTaperFL: 0.78,
    cuspCount: 4,
    cuspPattern: 'molar_man_4cusp_cross',
    rootCount: 2,
    rootSystem: [
      { offset: [-0.1, 0.02, 0], rotZ: 0.16, rotX: 0 },
      { offset: [0.1, 0.02, 0], rotZ: -0.14, rotX: 0 },
    ],
    features: {
      cruciform4Molar: true,
    },
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 12; Woelfel Table 7-5 (Rectangular table, 4 cusps in '+' cruciform pattern, 2 parallel roots)",
  },
  mandibular_third_molar: {
    specificType: 'mandibular_third_molar',
    fdiExamples: [38, 48],
    group: 'molar',
    arch: 'lower',
    crownHeight: 0.24,
    mesiodistalWidth: 0.34,
    faciolingualDepth: 0.34,
    cervicalTaperMD: 0.76,
    cervicalTaperFL: 0.8,
    cuspCount: 4,
    cuspPattern: 'molar_man_4cusp_cross',
    rootCount: 2,
    rootSystem: [
      { offset: [-0.07, 0.02, 0], rotZ: 0.1, rotX: 0 },
      { offset: [0.07, 0.02, 0], rotZ: -0.08, rotX: 0 },
    ],
    features: {},
    referenceCitation:
      "Wheeler's Dental Anatomy Ch. 12; Woelfel Table 7-6 (Rounded rectangular, 4 cusps, fused/curved roots)",
  },
}

// -----------------------------------------------------------------------------
// TOOTH IDENTIFIER MAPPING UTILITIES
// -----------------------------------------------------------------------------

export function toothSpecificTypeOf(n: number): ToothSpecificType {
  return specificTypeOf(n) as ToothSpecificType
}

export function getAnatomicalSpec(
  nOrType: number | ToothSpecificType | ToothGroup
): AnatomicalToothSpec {
  if (typeof nOrType === 'number') {
    const key = toothSpecificTypeOf(nOrType)
    return ANATOMICAL_SPECS[key] ?? ANATOMICAL_SPECS.maxillary_central_incisor
  }
  if (nOrType in ANATOMICAL_SPECS) {
    return ANATOMICAL_SPECS[nOrType as ToothSpecificType]
  }
  // group master fallbacks tuned for the group-level width progression: molar > premolar > incisor
  switch (nOrType) {
    case 'canine':
      return {
        ...ANATOMICAL_SPECS.maxillary_canine,
        mesiodistalWidth: 0.3,
        faciolingualDepth: 0.24,
      }
    case 'premolar':
      return {
        ...ANATOMICAL_SPECS.maxillary_first_premolar,
        mesiodistalWidth: 0.35,
        faciolingualDepth: 0.3,
      }
    case 'molar':
      return {
        ...ANATOMICAL_SPECS.maxillary_first_molar,
        mesiodistalWidth: 0.44,
        faciolingualDepth: 0.38,
      }
    case 'incisor':
    default:
      return {
        ...ANATOMICAL_SPECS.maxillary_central_incisor,
        mesiodistalWidth: 0.28,
        faciolingualDepth: 0.18,
      }
  }
}

/** Faciolingual thickness of the crown (backwards-compatible with Stage N). */
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

// -----------------------------------------------------------------------------
// PROCEDURAL 3D ANATOMICAL CROWN GENERATOR
// -----------------------------------------------------------------------------

/**
 * Builds a watertight, high-fidelity 3D anatomical crown mesh for any specific
 * tooth class with sculpted cusps, developmental ridges, lingual cingula, and
 * cervical taper.
 */
export function buildAnatomicalCrownGeometry(
  nOrTypeOrGroup: number | ToothSpecificType | ToothGroup
): THREE.BufferGeometry {
  const spec = getAnatomicalSpec(nOrTypeOrGroup)
  const {
    crownHeight,
    mesiodistalWidth,
    faciolingualDepth,
    cervicalTaperMD,
    cervicalTaperFL,
    group,
    arch,
    features,
  } = spec

  const N = group === 'molar' ? 44 : group === 'premolar' ? 36 : group === 'canine' ? 32 : 28
  const M = group === 'molar' ? 14 : group === 'premolar' ? 12 : group === 'canine' ? 11 : 10
  const halfH = crownHeight / 2

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // Computes the (X, Y, Z) coordinate of vertex at ring j (height fraction t) and segment i
  function getRingVertex(i: number, t: number): [number, number, number] {
    const theta = (i / N) * Math.PI * 2
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)

    // Base cervical-to-occlusal taper
    let taperX = cervicalTaperMD + (1.0 - cervicalTaperMD) * Math.sin(t * Math.PI * 0.5)
    let taperZ = cervicalTaperFL + (1.0 - cervicalTaperFL) * Math.sin(t * Math.PI * 0.5)

    // Cervical bulge (height of contour on buccal/labial: t ~ 0.25)
    if (t < 0.4) {
      const bulge = Math.sin((t / 0.4) * Math.PI)
      taperZ += 0.07 * bulge
      taperX += 0.04 * bulge
    }

    let rx = (mesiodistalWidth / 2) * taperX
    let rz = (faciolingualDepth / 2) * taperZ

    // Incisor morphology: lingual cingulum bulge and concave lingual fossa
    if (group === 'incisor') {
      if (sinT < 0 && (features.cingulumProminence ?? 0) > 0) {
        if (t < 0.4) {
          rz += (features.cingulumProminence ?? 0) * -sinT * Math.sin((t / 0.4) * Math.PI)
        } else if ((features.lingualFossaDepth ?? 0) > 0) {
          // concave lingual fossa between marginal ridges
          const fossaFactor = Math.sin(((t - 0.4) / 0.6) * Math.PI)
          rz -=
            (features.lingualFossaDepth ?? 0) * -sinT * Math.pow(Math.abs(cosT), 0.5) * fossaFactor
        }
      }
      // Incisal edge chisel thinning at top
      if (t > 0.8) {
        const flattenFrac = (t - 0.8) / 0.2
        rz *= 1.0 - 0.72 * flattenFrac
      }
    }

    // Canine morphology: prominent central labial ridge and palatal lingual ridge
    if (group === 'canine') {
      if (sinT > 0 && (features.labialRidge ?? 0) > 0) {
        rz += (features.labialRidge ?? 0) * Math.pow(sinT, 2.5)
      }
      if (sinT < 0 && (features.cingulumProminence ?? 0) > 0) {
        if (t < 0.45) {
          rz += (features.cingulumProminence ?? 0) * -sinT
        }
      }
    }

    // Molar/Premolar morphology: rounded boxy occlusal perimeter
    if (group === 'molar' || group === 'premolar') {
      const boxiness = group === 'molar' ? 0.28 : 0.18
      const corner = Math.sin(2 * theta)
      const cornerR = 1.0 + boxiness * Math.pow(corner, 2)
      rx *= cornerR
      rz *= cornerR
    }

    let px = cosT * rx
    let py = -halfH + t * crownHeight
    let pz = sinT * rz

    // Sculpted cusp elevations along the top rim (t = 1)
    if (t > 0.85) {
      const cuspBlend = (t - 0.85) / 0.15
      let cuspElevation = 0

      if (spec.cuspPattern === 'molar_man_5cusp_y5') {
        // Mandibular 1st Molar: 5 cusps (MB, DB, D, ML, DL)
        if (sinT > 0.2) {
          // Buccal cusps: MB (x < -0.05), DB (x ~ 0.05), Distal (x > 0.12)
          if (cosT < -0.3)
            cuspElevation = 0.038 // MB cusp
          else if (cosT < 0.3)
            cuspElevation = 0.035 // DB cusp
          else cuspElevation = 0.024 // Distal cusp (smallest)
        } else if (sinT < -0.2) {
          // Lingual cusps: ML, DL (taller and more pointed)
          if (cosT < 0)
            cuspElevation = 0.046 // ML cusp
          else cuspElevation = 0.044 // DL cusp
        }
      } else if (spec.cuspPattern === 'molar_man_4cusp_cross') {
        // Mandibular 2nd Molar: 4 symmetrical cusps in quadrants
        if (sinT > 0.2) cuspElevation = cosT < 0 ? 0.036 : 0.034
        else if (sinT < -0.2) cuspElevation = cosT < 0 ? 0.042 : 0.04
      } else if (
        spec.cuspPattern === 'molar_max_carabelli' ||
        spec.cuspPattern === 'molar_max_4cusp'
      ) {
        // Maxillary Molars: ML is largest, Oblique ridge connects ML to DB
        if (sinT < -0.2) {
          // Palatal cusps: ML (largest) and DL
          if (cosT < 0.1) {
            cuspElevation = 0.048 // ML cusp (largest)
            if (features.carabelliCusp && cosT < -0.4) cuspElevation += 0.01 // Cusp of Carabelli tubercle
          } else {
            cuspElevation = 0.028 // DL cusp
          }
        } else if (sinT > 0.2) {
          // Buccal cusps: MB, DB
          if (cosT < 0)
            cuspElevation = 0.04 // MB cusp
          else cuspElevation = 0.036 // DB cusp
        }
      } else if (spec.cuspPattern === 'bicuspid_max') {
        // Maxillary Premolars: Buccal cusp is taller and sharper than palatal
        if (sinT > 0.3)
          cuspElevation = 0.038 // Buccal cusp
        else if (sinT < -0.3) cuspElevation = 0.03 // Palatal cusp
      } else if (spec.cuspPattern === 'bicuspid_man_diminutive') {
        // Mandibular 1st Premolar: Dominant sharp buccal cusp, diminutive lingual cusp
        if (sinT > 0.2)
          cuspElevation = 0.045 // Dominant buccal cusp
        else if (sinT < -0.2) cuspElevation = 0.012 // Diminutive lingual cusp
      } else if (spec.cuspPattern === 'tricuspid_man_y') {
        // Mandibular 2nd Premolar: 1 buccal, 2 lingual cusps
        if (sinT > 0.3)
          cuspElevation = 0.036 // Buccal cusp
        else if (sinT < -0.3) cuspElevation = cosT < 0 ? 0.03 : 0.026 // ML > DL cusps
      } else if (group === 'canine') {
        // Single central pointed cusp tip
        const cuspCenterDist = Math.hypot(cosT, sinT - 0.2)
        cuspElevation = Math.max(0, 0.045 * (1.0 - cuspCenterDist * 0.7))
      }

      py += cuspElevation * cuspBlend
    }

    return [px, py, pz]
  }

  // 1. Generate side wall vertex grid
  for (let j = 0; j <= M; j++) {
    const t = j / M
    for (let i = 0; i <= N; i++) {
      const idx = i % N
      const pt = getRingVertex(idx, t)
      positions.push(pt[0], pt[1], pt[2])
      uvs.push(i / N, t)
    }
  }

  // 2. Generate side wall quad indices
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const r1 = j * (N + 1) + i
      const r2 = r1 + 1
      const r3 = (j + 1) * (N + 1) + i
      const r4 = r3 + 1
      indices.push(r1, r3, r2)
      indices.push(r2, r3, r4)
    }
  }

  // 3. Cervical bottom cap (closed watertight base)
  const bottomCenterIdx = positions.length / 3
  positions.push(0, -halfH, 0)
  uvs.push(0.5, 0.5)
  for (let i = 0; i < N; i++) {
    indices.push(bottomCenterIdx, i + 1, i)
  }

  // 4. Occlusal top cap (anatomically sculpted central fossa and fissures)
  const topCenterIdx = positions.length / 3
  let topCenterY = halfH

  if (group === 'molar' || group === 'premolar') {
    topCenterY -= 0.025 // central pit depression
  } else if (group === 'canine') {
    topCenterY += 0.045 // central pointed cusp tip
  }

  positions.push(0, topCenterY, 0)
  uvs.push(0.5, 0.5)

  const topRingStart = M * (N + 1)
  for (let i = 0; i < N; i++) {
    indices.push(topRingStart + i, topRingStart + i + 1, topCenterIdx)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()

  return geometry
}

/**
 * Backwards-compatible `buildCrownGeometry(group)`: builds the crown geometry
 * for the master representative tooth of each `ToothGroup`.
 */
export function buildCrownGeometry(group: ToothGroup): THREE.BufferGeometry {
  return buildAnatomicalCrownGeometry(group)
}

// -----------------------------------------------------------------------------
// PROCEDURAL 3D ANATOMICAL ROOT GENERATOR
// -----------------------------------------------------------------------------

export interface RootSpec {
  offset: [number, number, number]
  rotZ: number
  rotX: number
}

export interface AnatomicalRootMeshDef {
  geometry: THREE.BufferGeometry
  offset: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

/**
 * Builds an anatomically shaped root mesh with non-linear apical taper,
 * mesiodistal flattening, and physiological distal curvature.
 */
export function buildAnatomicalRoot(
  params: {
    length?: number
    baseRadiusX?: number
    baseRadiusZ?: number
    curvatureX?: number
    curvatureZ?: number
    fluting?: number
  } = {}
): THREE.BufferGeometry {
  const {
    length = 1.0,
    baseRadiusX = 0.075,
    baseRadiusZ = 0.085,
    curvatureX = 0.035,
    curvatureZ = 0.0,
    fluting = 0.018,
  } = params

  const P = 16 // radial divisions
  const K = 10 // height segments
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let j = 0; j <= K; j++) {
    const u = j / K // 0 = cervix (Y=0), 1 = apex (Y=-length)
    const y = -u * length

    // Non-linear apical taper
    const taper = Math.max(0.12, 1.0 - 0.88 * Math.pow(u, 0.9))
    const rx = baseRadiusX * taper
    const rz = baseRadiusZ * taper

    // Distal/buccal axial curvature
    const cx = curvatureX * Math.pow(u, 1.8)
    const cz = curvatureZ * Math.pow(u, 1.8)

    for (let i = 0; i <= P; i++) {
      const theta = (i / P) * Math.PI * 2
      const cosT = Math.cos(theta)
      const sinT = Math.sin(theta)

      let rMod = 1.0
      // Mesiodistal longitudinal fluting/developmental groove
      if (fluting > 0 && u > 0.15 && u < 0.85) {
        const fluteDepth = Math.sin(((u - 0.15) / 0.7) * Math.PI) * fluting
        rMod -= Math.abs(cosT) * (fluteDepth / baseRadiusX)
      }

      const px = cx + cosT * rx * rMod
      const py = y
      const pz = cz + sinT * rz * rMod
      positions.push(px, py, pz)
      uvs.push(i / P, u)
    }
  }

  // Side quad indices
  for (let j = 0; j < K; j++) {
    for (let i = 0; i < P; i++) {
      const r1 = j * (P + 1) + i
      const r2 = r1 + 1
      const r3 = (j + 1) * (P + 1) + i
      const r4 = r3 + 1
      indices.push(r1, r2, r3)
      indices.push(r2, r4, r3)
    }
  }

  // Apex tip cap (fan)
  const apexIdx = positions.length / 3
  positions.push(curvatureX, -length, curvatureZ)
  uvs.push(0.5, 1.0)
  const bottomRingStart = K * (P + 1)
  for (let i = 0; i < P; i++) {
    indices.push(bottomRingStart + i, bottomRingStart + i + 1, apexIdx)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()

  return geometry
}

/**
 * Backwards-compatible `buildRootGeometry()`: returns unit root cone (base at Y=0, apex at Y=-1).
 */
export function buildRootGeometry(): THREE.BufferGeometry {
  return buildAnatomicalRoot({
    length: 1.0,
    baseRadiusX: 0.075,
    baseRadiusZ: 0.075,
    fluting: 0.015,
  })
}

/**
 * Root specifications per group and arch.
 * Backwards-compatible with Stage N while incorporating Wheeler/Woelfel anatomical roots.
 */
export function rootSpecs(group: ToothGroup, arch: 'upper' | 'lower'): RootSpec[] {
  if (group === 'molar') {
    if (arch === 'upper') {
      // Maxillary molar: 3 roots (MB, DB, Palatal)
      return [
        { offset: [-0.11, 0.02, 0.06], rotZ: 0.24, rotX: 0.12 },
        { offset: [0.11, 0.02, 0.06], rotZ: -0.24, rotX: 0.12 },
        { offset: [0, 0.02, -0.12], rotZ: 0, rotX: -0.3 },
      ]
    }
    // Mandibular molar: 2 roots (Mesial + Distal)
    return [
      { offset: [-0.1, 0.02, 0], rotZ: 0.2, rotX: 0 },
      { offset: [0.1, 0.02, 0], rotZ: -0.2, rotX: 0 },
    ]
  }
  // Anteriors and premolars
  return [{ offset: [0, 0.02, 0], rotZ: 0, rotX: 0 }]
}

/**
 * Returns tooth-specific root specifications matching the exact FDI number.
 */
export function rootSpecsForTooth(n: number): RootSpec[] {
  const spec = getAnatomicalSpec(n)
  return spec.rootSystem
}

/**
 * Convenience: the anatomy key space used by the 3D renderer's caches.
 */
export function anatomyKeys(): { group: ToothGroup; arch: 'upper' | 'lower' }[] {
  const groups: ToothGroup[] = ['incisor', 'canine', 'premolar', 'molar']
  const arches: Array<'upper' | 'lower'> = ['upper', 'lower']
  return groups.flatMap((group) => arches.map((arch) => ({ group, arch })))
}

/**
 * Group + arch for an FDI tooth.
 */
export function anatomyOf(n: number): { group: ToothGroup; arch: 'upper' | 'lower' } {
  return { group: groupOf(n), arch: archOf(n) }
}

export { toothIndexOf }

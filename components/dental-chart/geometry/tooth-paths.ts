/**
 * Clean-Room High Anatomical Realism SVG Tooth Geometry & Vector Path Definitions for DenToRa
 *
 * Authored from first human dental anatomical principles for a 60x100 viewBox coordinate space.
 * Every tooth class features authentic morphological silhouettes, true root bifurcations/trifurcations,
 * distinct cusp lobes, developmental fossae, pulp horns, and clinical CEJ contours.
 */

import { ToothAnatomyGroup, ToothPosition, ToothSide, ToothSpecificType } from '../types/odontogram'

export interface ToothGeometryPaths {
  rootOutline: string
  rootDetails?: string[]
  crownOutline: string
  crownDetails?: string[]
  pulpOutline: string
  rootCanalPaths: string[]
  surfaces: {
    mesial: string
    distal: string
    occlusal: string
    buccal: string
    lingual: string
  }
  implantOutline: string
  implantThreads: string[]
  crownCapOutline: string
  apexCenter: { x: number; y: number }
  apices?: Array<{ x: number; y: number }>
  gumLinePath: string
  fractureCrackPath: string
  fissurePaths?: string[]
  cuspHighlights?: string[]
  rootSeparationPath?: string
  cervicalLinePath?: string
  rootCount: number
  canalCount: number
  relativeWidth?: number // Anatomical proportional width (1.0 = standard, 1.25 = molar, 0.75 = lower incisor)
}

// ─── SPECIFIC TOOTH TYPE IDENTIFIER ──────────────────────────────────────────

export function getToothSpecificType(toothNumber: number): ToothSpecificType {
  switch (toothNumber) {
    // Upper Right (Q1) & Upper Left (Q2)
    case 11:
    case 21:
      return 'maxillary_central_incisor'
    case 12:
    case 22:
      return 'maxillary_lateral_incisor'
    case 13:
    case 23:
      return 'maxillary_canine'
    case 14:
    case 24:
      return 'maxillary_first_premolar'
    case 15:
    case 25:
      return 'maxillary_second_premolar'
    case 16:
    case 26:
      return 'maxillary_first_molar'
    case 17:
    case 27:
      return 'maxillary_second_molar'
    case 18:
    case 28:
      return 'maxillary_third_molar'

    // Lower Left (Q3) & Lower Right (Q4)
    case 31:
    case 41:
      return 'mandibular_central_incisor'
    case 32:
    case 42:
      return 'mandibular_lateral_incisor'
    case 33:
    case 43:
      return 'mandibular_canine'
    case 34:
    case 44:
      return 'mandibular_first_premolar'
    case 35:
    case 45:
      return 'mandibular_second_premolar'
    case 36:
    case 46:
      return 'mandibular_first_molar'
    case 37:
    case 47:
      return 'mandibular_second_molar'
    case 38:
    case 48:
      return 'mandibular_third_molar'

    default:
      return 'maxillary_central_incisor'
  }
}

/**
 * Returns exact vector geometry by tooth number, or falls back to group/position/side.
 */
export function getToothGeometry(
  group: ToothAnatomyGroup,
  position: ToothPosition,
  side: ToothSide,
  toothNumber?: number
): ToothGeometryPaths {
  if (toothNumber) {
    return getToothGeometryByNumber(toothNumber)
  }

  const isUpper = position === 'upper'
  const isRight = side === 'right'

  if (group === 'molar') {
    return isUpper ? getMaxillaryFirstMolar(isRight) : getMandibularFirstMolar(isRight)
  }
  if (group === 'premolar') {
    return isUpper ? getMaxillaryFirstPremolar(isRight) : getMandibularFirstPremolar(isRight)
  }
  if (group === 'canine') {
    return isUpper ? getMaxillaryCanine(isRight) : getMandibularCanine(isRight)
  }
  return isUpper ? getMaxillaryCentralIncisor(isRight) : getMandibularCentralIncisor(isRight)
}

/**
 * Precision anatomical geometry for every individual tooth (11 to 48).
 */
export function getToothGeometryByNumber(toothNumber: number): ToothGeometryPaths {
  switch (toothNumber) {
    // ─── QUADRANT 1: MAXILLARY RIGHT (18 -> 11) ───
    case 11:
      return getMaxillaryCentralIncisor(true)
    case 12:
      return getMaxillaryLateralIncisor(true)
    case 13:
      return getMaxillaryCanine(true)
    case 14:
      return getMaxillaryFirstPremolar(true)
    case 15:
      return getMaxillarySecondPremolar(true)
    case 16:
      return getMaxillaryFirstMolar(true)
    case 17:
      return getMaxillarySecondMolar(true)
    case 18:
      return getMaxillaryThirdMolar(true)

    // ─── QUADRANT 2: MAXILLARY LEFT (21 -> 28) ───
    case 21:
      return getMaxillaryCentralIncisor(false)
    case 22:
      return getMaxillaryLateralIncisor(false)
    case 23:
      return getMaxillaryCanine(false)
    case 24:
      return getMaxillaryFirstPremolar(false)
    case 25:
      return getMaxillarySecondPremolar(false)
    case 26:
      return getMaxillaryFirstMolar(false)
    case 27:
      return getMaxillarySecondMolar(false)
    case 28:
      return getMaxillaryThirdMolar(false)

    // ─── QUADRANT 3: MANDIBULAR LEFT (31 -> 38) ───
    case 31:
      return getMandibularCentralIncisor(false)
    case 32:
      return getMandibularLateralIncisor(false)
    case 33:
      return getMandibularCanine(false)
    case 34:
      return getMandibularFirstPremolar(false)
    case 35:
      return getMandibularSecondPremolar(false)
    case 36:
      return getMandibularFirstMolar(false)
    case 37:
      return getMandibularSecondMolar(false)
    case 38:
      return getMandibularThirdMolar(false)

    // ─── QUADRANT 4: MANDIBULAR RIGHT (48 -> 41) ───
    case 41:
      return getMandibularCentralIncisor(true)
    case 42:
      return getMandibularLateralIncisor(true)
    case 43:
      return getMandibularCanine(true)
    case 44:
      return getMandibularFirstPremolar(true)
    case 45:
      return getMandibularSecondPremolar(true)
    case 46:
      return getMandibularFirstMolar(true)
    case 47:
      return getMandibularSecondMolar(true)
    case 48:
      return getMandibularThirdMolar(true)

    default:
      return getMaxillaryCentralIncisor(true)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. MAXILLARY TEETH GEOMETRY (UPPER ARCH)
// ══════════════════════════════════════════════════════════════════════════════

// ─── 11 & 21: MAXILLARY CENTRAL INCISOR ──────────────────────────────────────
// Spade-shaped broad crown, sharp 90-deg mesio-incisal angle, rounded disto-incisal,
// 3 mamelon developmental lobes, single conical root with gentle apical tapering.
function getMaxillaryCentralIncisor(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 1.15,
    rootOutline:
      'M 17,46 C 16,30 20,15 28,4 C 29,3 31,3 32,4 C 40,15 44,30 43,46 C 36,49 24,49 17,46 Z',
    rootDetails: [
      'M 30,8 C 29.5,20 29.5,34 30,44', // Central developmental depression
    ],
    crownOutline: isRight
      ? 'M 16,46 C 13,56 12,74 13,88 C 13,93 14,95 16,95 L 43,95 C 46,95 48,91 48,85 C 48,74 47,56 44,46 C 36,49 24,49 16,46 Z'
      : 'M 16,46 C 13,56 12,74 12,85 C 12,91 14,95 17,95 L 44,95 C 46,95 47,93 47,88 C 48,74 47,56 44,46 C 36,49 24,49 16,46 Z',
    crownDetails: [
      // 3 Developmental lobes & Incisal mamelon ridges
      'M 15,92 L 45,92', // Incisal translucency halo
      'M 23,54 C 23,66 22,78 22,94', // Mesiolabial developmental groove
      'M 37,54 C 37,66 38,78 38,94', // Distolabial developmental groove
      'M 18,50 C 18,60 17,76 18,88', // Mesial marginal ridge
      'M 42,50 C 42,60 43,76 42,88', // Distal marginal ridge
    ],
    pulpOutline: 'M 24,52 C 22,60 22,74 24,80 C 26,84 34,84 36,80 C 38,74 38,60 36,52 Z',
    rootCanalPaths: ['M 30,4 C 29.5,18 29.5,34 30,52'],
    surfaces: {
      buccal: 'M 18,46 L 42,46 L 38,64 L 22,64 Z',
      lingual: 'M 22,76 L 38,76 L 42,86 L 18,86 Z',
      mesial: isRight
        ? 'M 16,46 L 22,64 L 22,86 L 16,95 C 14,95 13,93 13,88 C 12,74 13,56 16,46 Z'
        : 'M 38,64 L 44,46 C 47,56 48,74 47,88 C 47,93 46,95 44,95 L 38,86 Z',
      distal: isRight
        ? 'M 38,64 L 44,46 C 47,56 48,74 48,85 C 48,91 46,95 43,95 L 38,86 Z'
        : 'M 16,46 L 22,64 L 22,86 L 17,95 C 14,95 12,91 12,85 C 12,74 13,56 16,46 Z',
      occlusal: 'M 18,86 L 42,86 L 44,95 L 16,95 Z',
    },
    fissurePaths: ['M 23,60 L 23,88', 'M 37,60 L 37,88'],
    cuspHighlights: ['M 17,94 L 43,94'],
    implantOutline: 'M 20,46 L 40,46 L 38,14 C 38,10 34,6 30,6 C 26,6 22,10 22,14 Z',
    implantThreads: [
      'M 21,40 L 39,40',
      'M 22,34 L 38,34',
      'M 23,28 L 37,28',
      'M 24,22 L 36,22',
      'M 25,16 L 35,16',
    ],
    crownCapOutline: 'M 14,46 C 12,56 11,76 13,88 L 16,95 L 44,95 L 47,88 C 49,76 48,56 46,46 Z',
    apexCenter: { x: 30, y: 4 },
    apices: [{ x: 30, y: 4 }],
    gumLinePath: 'M 12,46 Q 30,52 48,46',
    cervicalLinePath: 'M 16,46 Q 30,50 44,46',
    fractureCrackPath: 'M 18,48 L 28,66 L 24,76 L 38,95',
  }
}

// ─── 12 & 22: MAXILLARY LATERAL INCISOR ──────────────────────────────────────
// Narrower and more delicate than central incisor, rounded incisal angles,
// distinct distal curve of root apex toward the distal side.
function getMaxillaryLateralIncisor(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 35 : 25
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 0.9,
    rootOutline: isRight
      ? 'M 20,46 C 18,32 22,18 32,5 C 34,3 37,4 37,7 C 39,18 43,32 40,46 C 34,49 26,49 20,46 Z'
      : 'M 20,46 C 17,32 21,18 23,7 C 23,4 26,3 28,5 C 38,18 42,32 40,46 C 34,49 26,49 20,46 Z',
    rootDetails: [isRight ? 'M 30,10 C 33,22 31,34 30,44' : 'M 30,10 C 27,22 29,34 30,44'],
    crownOutline: isRight
      ? 'M 18,46 C 16,56 15,72 16,84 C 17,90 20,94 23,94 L 37,94 C 41,94 44,89 44,82 C 44,70 43,56 42,46 C 34,49 26,49 18,46 Z'
      : 'M 18,46 C 17,56 16,70 16,82 C 16,89 19,94 23,94 L 37,94 C 40,94 43,90 44,84 C 45,72 44,56 42,46 C 34,49 26,49 18,46 Z',
    crownDetails: [
      'M 20,91 L 40,91',
      'M 25,54 C 25,66 24,78 25,93',
      'M 35,54 C 35,66 36,78 35,93',
      'M 20,50 C 20,62 19,76 20,86',
      'M 40,50 C 40,62 41,76 40,86',
    ],
    pulpOutline: 'M 25,52 C 23,60 23,72 25,78 C 27,81 33,81 35,78 C 37,72 37,60 35,52 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},5 C 33,20 30,34 30,52` : `M ${apexX},5 C 27,20 30,34 30,52`,
    ],
    surfaces: {
      buccal: 'M 20,46 L 40,46 L 36,64 L 24,64 Z',
      lingual: 'M 24,76 L 36,76 L 39,84 L 21,84 Z',
      mesial: isRight
        ? 'M 18,46 L 24,64 L 24,84 L 21,84 L 23,94 C 20,94 17,90 16,84 C 15,72 16,56 18,46 Z'
        : 'M 36,64 L 42,46 C 44,56 45,72 44,84 C 43,90 40,94 37,94 L 39,84 L 36,84 Z',
      distal: isRight
        ? 'M 36,64 L 42,46 C 43,56 44,70 44,82 C 44,89 41,94 37,94 L 39,84 L 36,84 Z'
        : 'M 18,46 L 24,64 L 24,84 L 21,84 L 23,94 C 19,94 16,89 16,82 C 16,70 17,56 18,46 Z',
      occlusal: 'M 21,84 L 39,84 L 37,94 L 23,94 Z',
    },
    fissurePaths: ['M 25,60 L 25,86', 'M 35,60 L 35,86'],
    cuspHighlights: ['M 22,93 L 38,93'],
    implantOutline: 'M 22,46 L 38,46 L 36,14 C 36,10 32,6 30,6 C 28,6 24,10 24,14 Z',
    implantThreads: ['M 23,40 L 37,40', 'M 24,34 L 36,34', 'M 25,28 L 35,28', 'M 26,22 L 34,22'],
    crownCapOutline: 'M 16,46 C 14,56 14,76 16,86 L 23,94 L 37,94 L 44,86 C 46,76 46,56 44,46 Z',
    apexCenter: { x: apexX, y: 5 },
    apices: [{ x: apexX, y: 5 }],
    gumLinePath: 'M 14,46 Q 30,51 46,46',
    cervicalLinePath: 'M 18,46 Q 30,49 42,46',
    fractureCrackPath: 'M 20,48 L 30,66 L 26,76 L 36,94',
  }
}

// ─── 13 & 23: MAXILLARY CANINE ───────────────────────────────────────────────
// Distinct spear-shaped crown, prominent pointed cusp, strong central labial ridge,
// asymmetrical cusp slopes (mesial slope shorter, distal slope longer and more convex),
// longest and most robust single root in the arch.
function getMaxillaryCanine(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 1.05,
    rootOutline:
      'M 17,46 C 15,28 19,12 28,2 C 29,1 31,1 32,2 C 41,12 45,28 43,46 C 36,49 24,49 17,46 Z',
    rootDetails: [
      'M 27,6 C 26.5,20 26.5,34 27,44', // Mesial root depression
      'M 33,6 C 33.5,20 33.5,34 33,44', // Distal root depression
    ],
    crownOutline: isRight
      ? 'M 16,46 C 13,58 13,76 18,87 L 30,98 L 43,84 C 48,74 47,58 44,46 C 36,49 24,49 16,46 Z'
      : 'M 16,46 C 13,58 12,74 17,84 L 30,98 L 42,87 C 47,76 47,58 44,46 C 36,49 24,49 16,46 Z',
    crownDetails: [
      // Prominent 3D Labial Spear Ridge & Cusp Facets
      'M 30,46 L 30,97', // Central labial ridge
      'M 18,66 C 22,72 27,84 30,97', // Mesial cusp ridge slope
      'M 42,66 C 38,72 33,84 30,97', // Distal cusp ridge slope
      'M 22,60 C 22,72 24,80 27,90',
      'M 38,60 C 38,72 36,80 33,90',
    ],
    pulpOutline: 'M 25,52 C 23,60 23,74 25,82 L 30,89 L 35,82 C 37,74 37,60 35,52 Z',
    rootCanalPaths: ['M 30,2 C 29.5,18 29.5,34 30,52'],
    surfaces: {
      buccal: 'M 18,46 L 42,46 L 38,62 L 22,62 Z',
      lingual: 'M 22,76 L 38,76 L 41,83 L 30,91 L 19,83 Z',
      mesial: isRight
        ? 'M 16,46 L 22,62 L 22,76 L 19,83 L 18,87 C 13,76 13,58 16,46 Z'
        : 'M 38,62 L 44,46 C 47,58 47,76 42,87 L 41,83 L 38,76 Z',
      distal: isRight
        ? 'M 38,62 L 44,46 C 47,58 48,74 43,84 L 41,83 L 38,76 Z'
        : 'M 16,46 L 22,62 L 22,76 L 19,83 L 17,84 C 12,74 13,58 16,46 Z',
      occlusal: 'M 22,62 L 38,62 L 41,83 L 30,98 L 19,83 L 22,76 Z',
    },
    fissurePaths: ['M 30,48 L 30,94'],
    cuspHighlights: ['M 23,88 L 30,97 L 37,86'],
    implantOutline: 'M 20,46 L 40,46 L 38,12 C 38,8 34,4 30,4 C 26,4 22,8 22,12 Z',
    implantThreads: [
      'M 21,40 L 39,40',
      'M 22,34 L 38,34',
      'M 23,28 L 37,28',
      'M 24,22 L 36,22',
      'M 25,16 L 35,16',
    ],
    crownCapOutline: 'M 14,46 C 11,58 11,78 16,88 L 30,98 L 44,86 C 49,76 49,58 46,46 Z',
    apexCenter: { x: 30, y: 2 },
    apices: [{ x: 30, y: 2 }],
    gumLinePath: 'M 12,46 Q 30,52 48,46',
    cervicalLinePath: 'M 16,46 Q 30,50 44,46',
    fractureCrackPath: 'M 18,48 L 28,66 L 24,76 L 30,98',
  }
}

// ─── 14 & 24: MAXILLARY FIRST PREMOLAR ───────────────────────────────────────
// Distinct bicuspid crown with dominant buccal cusp and palatal cusp,
// TRUE BIFURCATED DUAL ROOTS (buccal & palatal) with visible inter-radicular bifurcation gap.
function getMaxillaryFirstPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 2,
    canalCount: 2,
    relativeWidth: 1.05,
    // True bifurcated root silhouette: Buccal root (left) and Palatal root (right) with deep furcation notch
    rootOutline:
      'M 16,46 C 14,34 14,18 20,5 C 22,3 25,4 26,7 C 28,16 28,26 30,32 C 32,26 32,16 34,7 C 35,4 38,3 40,5 C 46,18 46,34 44,46 C 36,49 24,49 16,46 Z',
    rootDetails: ['M 23,8 C 22.5,18 24,28 25,38', 'M 37,8 C 37.5,18 36,28 35,38'],
    crownOutline:
      'M 14,46 C 12,54 10,74 13,86 C 15,92 21,96 28,96 C 33,96 38,93 42,90 C 48,85 48,66 46,46 C 36,49 24,49 14,46 Z',
    crownDetails: [
      // Buccal & Palatal Cusp Slopes & Central Groove Table
      'M 15,62 C 20,58 27,58 30,60 C 33,58 40,58 45,62', // Buccal cusp contour
      'M 18,78 C 24,82 36,82 42,78', // Palatal cusp contour
      'M 20,68 C 25,66 35,66 40,68', // Central developmental table
    ],
    pulpOutline: 'M 22,52 C 20,60 20,72 23,78 C 25,81 35,81 37,78 C 40,72 40,60 38,52 Z',
    rootCanalPaths: ['M 22,6 C 22,20 24,34 26,52', 'M 38,6 C 38,20 36,34 34,52'],
    surfaces: {
      buccal: 'M 14,46 L 46,46 L 40,62 L 20,62 Z',
      lingual: 'M 20,78 L 40,78 L 43,89 C 38,93 32,95 20,93 Z',
      mesial: isRight
        ? 'M 14,46 L 20,62 L 20,78 L 13,86 C 10,74 12,54 14,46 Z'
        : 'M 40,62 L 46,46 C 48,54 48,74 46,86 L 40,78 Z',
      distal: isRight
        ? 'M 40,62 L 46,46 C 48,54 48,74 46,86 L 40,78 Z'
        : 'M 14,46 L 20,62 L 20,78 L 13,86 C 10,74 12,54 14,46 Z',
      occlusal: 'M 20,62 L 40,62 L 40,78 L 20,78 Z',
    },
    fissurePaths: [
      'M 24,70 L 36,70', // Central developmental groove
      'M 24,70 L 18,65', // Mesiobuccal developmental groove
      'M 36,70 L 42,65', // Distobuccal developmental groove
    ],
    cuspHighlights: ['M 20,64 L 28,60 L 36,64', 'M 22,78 L 28,81 L 34,78'],
    rootSeparationPath: 'M 30,32 L 30,46',
    implantOutline: 'M 18,46 L 42,46 L 40,14 C 40,10 34,6 30,6 C 26,6 20,10 20,14 Z',
    implantThreads: ['M 19,40 L 41,40', 'M 20,34 L 40,34', 'M 21,28 L 39,28', 'M 22,22 L 38,22'],
    crownCapOutline: 'M 12,46 C 10,54 8,76 12,88 C 16,96 44,96 48,88 C 52,76 50,54 48,46 Z',
    apexCenter: { x: 30, y: 6 },
    apices: [
      { x: 22, y: 6 },
      { x: 38, y: 6 },
    ],
    gumLinePath: 'M 10,46 Q 30,52 50,46',
    cervicalLinePath: 'M 14,46 Q 30,50 46,46',
    fractureCrackPath: 'M 16,48 L 26,66 L 22,76 L 36,94',
  }
}

// ─── 15 & 25: MAXILLARY SECOND PREMOLAR ──────────────────────────────────────
// More rounded, balanced cusps than PM1, single tapered root (NOT bifurcated).
function getMaxillarySecondPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 2,
    relativeWidth: 1.0,
    rootOutline:
      'M 18,46 C 16,30 18,15 26,5 C 28,3 32,3 34,5 C 42,15 44,30 42,46 C 36,49 24,49 18,46 Z',
    rootDetails: ['M 28,10 C 27.5,22 27.5,34 28,44', 'M 32,10 C 32.5,22 32.5,34 32,44'],
    crownOutline:
      'M 15,46 C 13,54 12,74 15,85 C 18,91 24,94 30,94 C 36,94 42,91 45,85 C 48,74 47,54 45,46 C 36,49 24,49 15,46 Z',
    crownDetails: [
      'M 18,62 C 24,59 36,59 42,62',
      'M 19,78 C 25,80 35,80 41,78',
      'M 20,68 C 26,66 34,66 40,68',
    ],
    pulpOutline: 'M 23,52 C 21,60 21,72 23,78 C 25,81 35,81 37,78 C 39,72 39,60 37,52 Z',
    rootCanalPaths: ['M 27,6 C 26,20 26,36 28,52', 'M 33,6 C 34,20 34,36 32,52'],
    surfaces: {
      buccal: 'M 15,46 L 45,46 L 39,62 L 21,62 Z',
      lingual: 'M 21,78 L 39,78 L 45,86 C 40,93 20,93 15,86 Z',
      mesial: isRight
        ? 'M 15,46 L 21,62 L 21,78 L 15,86 C 12,76 13,56 15,46 Z'
        : 'M 39,62 L 45,46 C 47,56 48,76 45,86 L 39,78 Z',
      distal: isRight
        ? 'M 39,62 L 45,46 C 47,56 48,76 45,86 L 39,78 Z'
        : 'M 15,46 L 21,62 L 21,78 L 15,86 C 12,76 13,56 15,46 Z',
      occlusal: 'M 21,62 L 39,62 L 39,78 L 21,78 Z',
    },
    fissurePaths: [
      'M 25,70 L 35,70',
      'M 25,70 L 20,65',
      'M 35,70 L 40,65',
      'M 25,70 L 20,75',
      'M 35,70 L 40,75',
    ],
    cuspHighlights: ['M 22,63 L 30,60 L 38,63', 'M 22,77 L 30,79 L 38,77'],
    implantOutline: 'M 20,46 L 40,46 L 38,14 C 38,10 34,6 30,6 C 26,6 22,10 22,14 Z',
    implantThreads: ['M 21,40 L 39,40', 'M 22,34 L 38,34', 'M 23,28 L 37,28', 'M 24,22 L 36,22'],
    crownCapOutline: 'M 13,46 C 11,54 10,76 13,87 C 17,94 43,94 47,87 C 50,76 49,54 47,46 Z',
    apexCenter: { x: 30, y: 5 },
    apices: [{ x: 30, y: 5 }],
    gumLinePath: 'M 11,46 Q 30,51 49,46',
    cervicalLinePath: 'M 15,46 Q 30,49 45,46',
    fractureCrackPath: 'M 17,48 L 27,66 L 23,76 L 37,94',
  }
}

// ─── 16 & 26: MAXILLARY FIRST MOLAR ──────────────────────────────────────────
// Large rhomboid crown, 4 major cusps + Cusp of Carabelli,
// TRUE TRIFURCATED 3-ROOT ANATOMY: Mesiobuccal, Distobuccal, and Palatal roots with physical furcation branching.
function getMaxillaryFirstMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 3,
    canalCount: 4,
    relativeWidth: 1.35,
    // 3 distinct physically branched roots with negative space between branches:
    // Mesiobuccal root (left), Palatal root (center/top), Distobuccal root (right)
    rootOutline:
      'M 9,46 C 7,32 5,16 11,5 C 13,3 16,4 17,7 C 20,16 22,26 25,32 C 26,22 28,12 30,2 C 32,2 34,12 35,32 C 38,26 40,16 43,7 C 44,4 47,3 49,5 C 55,16 53,32 51,46 C 42,49 18,49 9,46 Z',
    rootDetails: [
      'M 14,10 C 14.5,20 18,30 21,38', // MB root ridge
      'M 30,6 C 30,18 30,28 30,38', // Palatal root ridge
      'M 46,10 C 45.5,20 42,30 39,38', // DB root ridge
    ],
    crownOutline:
      'M 7,46 C 5,54 4,74 6,86 C 8,93 16,96 30,96 C 44,96 52,93 54,86 C 56,74 55,54 53,46 C 42,49 18,49 7,46 Z',
    crownDetails: [
      // 4 Sculpted Cusp Facets, Oblique Ridge & Cusp of Carabelli
      'M 11,62 C 17,60 25,60 30,64', // Mesiobuccal cusp ridge
      'M 30,64 C 35,60 43,60 49,62', // Distobuccal cusp ridge
      'M 9,82 C 17,86 24,86 30,84', // Mesiopalatal cusp ridge + Carabelli lobe
      'M 30,84 C 36,86 43,86 51,82', // Distopalatal cusp ridge
      'M 20,66 C 26,72 34,76 42,78', // Oblique ridge
    ],
    pulpOutline: 'M 18,52 C 16,58 16,72 18,78 C 22,81 38,81 42,78 C 44,72 44,58 42,52 Z',
    rootCanalPaths: [
      'M 13,6 C 13,18 17,32 21,52', // MB canal
      'M 30,3 C 30,18 30,32 30,52', // Palatal canal
      'M 47,6 C 47,18 43,32 39,52', // DB canal
    ],
    surfaces: {
      buccal: 'M 7,46 L 53,46 L 46,62 L 14,62 Z',
      lingual: 'M 14,80 L 46,80 L 54,91 C 45,97 15,97 6,91 Z',
      mesial: isRight
        ? 'M 7,46 L 14,62 L 14,80 L 6,91 C 4,76 5,56 7,46 Z'
        : 'M 46,62 L 53,46 C 55,56 56,76 54,91 L 46,80 Z',
      distal: isRight
        ? 'M 46,62 L 53,46 C 55,56 56,76 54,91 L 46,80 Z'
        : 'M 7,46 L 14,62 L 14,80 L 6,91 C 4,76 5,56 7,46 Z',
      occlusal: 'M 14,62 L 46,62 L 46,80 L 14,80 Z',
    },
    fissurePaths: [
      'M 19,70 L 41,70', // Central developmental groove
      'M 30,62 L 30,78', // Buccal/Lingual groove
      'M 21,64 L 39,76', // Oblique groove
    ],
    cuspHighlights: [
      'M 13,63 L 21,61 L 27,64',
      'M 33,64 L 39,61 L 47,63',
      'M 13,79 L 21,81 L 27,79',
      'M 33,79 L 39,81 L 47,79',
    ],
    rootSeparationPath: 'M 25,32 L 25,46 M 35,32 L 35,46',
    implantOutline: 'M 15,46 L 45,46 L 43,14 C 43,10 37,6 30,6 C 23,6 17,10 17,14 Z',
    implantThreads: [
      'M 16,40 L 44,40',
      'M 17,34 L 43,34',
      'M 18,28 L 42,28',
      'M 19,22 L 41,22',
      'M 20,16 L 40,16',
    ],
    crownCapOutline: 'M 5,46 C 3,54 2,78 5,89 C 9,97 51,97 55,89 C 58,78 57,54 55,46 Z',
    apexCenter: { x: 30, y: 2 },
    apices: [
      { x: 13, y: 6 },
      { x: 30, y: 2 },
      { x: 47, y: 6 },
    ],
    gumLinePath: 'M 4,46 Q 30,53 56,46',
    cervicalLinePath: 'M 7,46 Q 30,50 53,46',
    fractureCrackPath: 'M 11,48 L 23,66 L 19,76 L 37,95',
  }
}

// ─── 17 & 27: MAXILLARY SECOND MOLAR ─────────────────────────────────────────
// Smaller than 1st molar, 3 roots that converge more closely, reduced distopalatal cusp.
function getMaxillarySecondMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 3,
    canalCount: 3,
    relativeWidth: 1.25,
    rootOutline:
      'M 11,46 C 9,32 8,18 14,6 C 16,4 19,5 20,8 C 22,18 24,26 26,34 C 27,24 28,14 30,3 C 32,3 33,24 34,34 C 36,26 38,18 40,8 C 41,5 44,4 46,6 C 52,18 51,32 49,46 C 40,49 20,49 11,46 Z',
    rootDetails: [
      'M 17,10 C 18,20 21,30 23,38',
      'M 30,7 C 30,18 30,28 30,38',
      'M 43,10 C 42,20 39,30 37,38',
    ],
    crownOutline:
      'M 9,46 C 7,54 6,74 8,85 C 10,92 18,95 30,95 C 42,95 50,92 52,85 C 54,74 53,54 51,46 C 40,49 20,49 9,46 Z',
    crownDetails: [
      'M 13,62 C 19,60 25,60 30,63',
      'M 30,63 C 35,60 41,60 47,62',
      'M 12,81 C 19,85 25,85 30,83',
      'M 30,83 C 35,85 41,85 48,81',
    ],
    pulpOutline: 'M 19,52 C 17,58 17,72 19,78 C 23,80 37,80 41,78 C 43,72 43,58 41,52 Z',
    rootCanalPaths: [
      'M 16,7 C 16,18 19,32 22,52',
      'M 30,4 C 30,18 30,32 30,52',
      'M 44,7 C 44,18 41,32 38,52',
    ],
    surfaces: {
      buccal: 'M 9,46 L 51,46 L 45,62 L 15,62 Z',
      lingual: 'M 15,80 L 45,80 L 52,90 C 43,95 17,95 8,90 Z',
      mesial: isRight
        ? 'M 9,46 L 15,62 L 15,80 L 8,90 C 6,76 7,56 9,46 Z'
        : 'M 45,62 L 51,46 C 53,56 54,76 52,90 L 45,80 Z',
      distal: isRight
        ? 'M 45,62 L 51,46 C 53,56 54,76 52,90 L 45,80 Z'
        : 'M 9,46 L 15,62 L 15,80 L 8,90 C 6,76 7,56 9,46 Z',
      occlusal: 'M 15,62 L 45,62 L 45,80 L 15,80 Z',
    },
    fissurePaths: ['M 20,70 L 40,70', 'M 30,62 L 30,78'],
    cuspHighlights: [
      'M 15,63 L 21,61 L 27,64',
      'M 33,64 L 39,61 L 45,63',
      'M 15,78 L 21,80 L 27,78',
      'M 33,78 L 39,80 L 45,78',
    ],
    rootSeparationPath: 'M 26,34 L 26,46 M 34,34 L 34,46',
    implantOutline: 'M 17,46 L 43,46 L 41,14 C 41,10 35,6 30,6 C 25,6 19,10 19,14 Z',
    implantThreads: ['M 18,40 L 42,40', 'M 19,34 L 41,34', 'M 20,28 L 40,28', 'M 21,22 L 39,22'],
    crownCapOutline: 'M 7,46 C 5,54 4,76 7,88 C 11,95 49,95 53,88 C 56,76 55,54 53,46 Z',
    apexCenter: { x: 30, y: 3 },
    apices: [
      { x: 16, y: 7 },
      { x: 30, y: 3 },
      { x: 44, y: 7 },
    ],
    gumLinePath: 'M 6,46 Q 30,52 54,46',
    cervicalLinePath: 'M 9,46 Q 30,50 51,46',
    fractureCrackPath: 'M 13,48 L 24,66 L 20,76 L 36,94',
  }
}

// ─── 18 & 28: MAXILLARY THIRD MOLAR ──────────────────────────────────────────
// Compact irregular crown, fused/convergent curved roots.
function getMaxillaryThirdMolar(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 34 : 26
  return {
    rootCount: 1,
    canalCount: 3,
    relativeWidth: 1.15,
    rootOutline: isRight
      ? 'M 13,46 C 11,32 15,20 31,8 C 33,6 36,7 36,10 C 38,20 47,32 47,46 C 39,49 21,49 13,46 Z'
      : 'M 13,46 C 13,32 22,20 24,10 C 24,7 27,6 29,8 C 45,20 49,32 47,46 C 39,49 21,49 13,46 Z',
    rootDetails: ['M 28,14 C 28,24 28,34 28,44', 'M 32,14 C 32,24 32,34 32,44'],
    crownOutline:
      'M 11,46 C 9,54 8,74 10,84 C 12,90 19,94 30,94 C 41,94 48,90 50,84 C 52,74 51,54 49,46 C 40,49 20,49 11,46 Z',
    crownDetails: ['M 15,62 C 21,60 39,60 45,62', 'M 14,80 C 21,84 39,84 46,80'],
    pulpOutline: 'M 20,52 C 18,58 18,72 20,78 C 24,80 36,80 40,78 C 42,72 42,58 40,52 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},9 C 31,22 28,34 26,52` : `M ${apexX},9 C 29,22 32,34 34,52`,
      isRight ? `M ${apexX + 2},10 C 34,22 33,34 34,52` : `M ${apexX - 2},10 C 26,22 27,34 26,52`,
    ],
    surfaces: {
      buccal: 'M 11,46 L 49,46 L 43,62 L 17,62 Z',
      lingual: 'M 17,78 L 43,78 L 49,88 C 42,93 18,93 11,88 Z',
      mesial: isRight
        ? 'M 11,46 L 17,62 L 17,78 L 10,84 C 8,74 9,54 11,46 Z'
        : 'M 43,62 L 49,46 C 51,54 52,74 50,84 L 43,78 Z',
      distal: isRight
        ? 'M 43,62 L 49,46 C 51,54 52,74 50,84 L 43,78 Z'
        : 'M 11,46 L 17,62 L 17,78 L 10,84 C 8,74 9,54 11,46 Z',
      occlusal: 'M 17,62 L 43,62 L 43,78 L 17,78 Z',
    },
    fissurePaths: ['M 22,69 L 38,69', 'M 30,62 L 30,76'],
    cuspHighlights: [
      'M 17,63 L 23,61 L 29,63',
      'M 31,63 L 37,61 L 43,63',
      'M 19,77 L 30,79 L 41,77',
    ],
    implantOutline: 'M 19,46 L 41,46 L 39,14 C 39,10 35,6 30,6 C 25,6 21,10 21,14 Z',
    implantThreads: ['M 20,40 L 40,40', 'M 21,34 L 39,34', 'M 22,28 L 38,28', 'M 23,22 L 37,22'],
    crownCapOutline: 'M 9,46 C 7,54 6,76 9,86 C 13,93 47,93 51,86 C 54,76 53,54 51,46 Z',
    apexCenter: { x: apexX, y: 9 },
    apices: [{ x: apexX, y: 9 }],
    gumLinePath: 'M 8,46 Q 30,52 52,46',
    cervicalLinePath: 'M 11,46 Q 30,50 49,46',
    fractureCrackPath: 'M 14,48 L 25,66 L 21,76 L 35,93',
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. MANDIBULAR TEETH GEOMETRY (LOWER ARCH)
// ══════════════════════════════════════════════════════════════════════════════

// ─── 41 & 31: MANDIBULAR CENTRAL INCISOR ─────────────────────────────────────
// Smallest, narrowest, and most symmetrical tooth in the dentition,
// straight incisal edge, narrow ribbon-like single root.
function getMandibularCentralIncisor(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 0.75,
    crownOutline:
      'M 21,54 C 19,44 19,26 20,13 C 20,8 22,6 24,6 L 36,6 C 38,6 40,8 40,13 C 41,26 41,44 39,54 C 33,51 27,51 21,54 Z',
    crownDetails: [
      'M 23,10 L 37,10', // Incisal edge translucency
      'M 27,15 L 27,42', // Mesiolabial groove
      'M 33,15 L 33,42', // Distolabial groove
    ],
    rootOutline:
      'M 23,54 C 21,70 25,86 28,96 C 29,98 31,98 32,96 C 35,86 39,70 37,54 C 33,51 27,51 23,54 Z',
    rootDetails: [
      'M 30,58 L 30,90', // Longitudinal root groove
    ],
    pulpOutline: 'M 26,48 C 24,40 24,28 26,20 C 28,17 32,17 34,20 C 36,28 36,40 34,48 Z',
    rootCanalPaths: ['M 30,96 C 29.5,80 29.5,64 30,48'],
    surfaces: {
      buccal: 'M 22,17 L 38,17 L 40,6 L 20,6 Z',
      lingual: 'M 21,54 L 39,54 L 36,40 L 24,40 Z',
      mesial: isRight
        ? 'M 20,6 L 22,17 L 24,40 L 21,54 C 19,44 19,26 20,6 Z'
        : 'M 40,6 L 38,17 L 36,40 L 39,54 C 41,44 41,26 40,6 Z',
      distal: isRight
        ? 'M 40,6 L 38,17 L 36,40 L 39,54 C 41,44 41,26 40,6 Z'
        : 'M 20,6 L 22,17 L 24,40 L 21,54 C 19,44 19,26 20,6 Z',
      occlusal: 'M 22,17 L 38,17 L 36,40 L 24,40 Z',
    },
    fissurePaths: ['M 27,15 L 27,40', 'M 33,15 L 33,40'],
    cuspHighlights: ['M 22,7 L 38,7'],
    implantOutline: 'M 23,54 L 37,54 L 35,86 C 35,90 31,94 30,94 C 29,94 25,90 25,86 Z',
    implantThreads: [
      'M 24,60 L 36,60',
      'M 25,66 L 35,66',
      'M 26,72 L 34,72',
      'M 27,78 L 33,78',
      'M 28,84 L 32,84',
    ],
    crownCapOutline: 'M 19,54 C 17,44 17,24 18,13 L 24,6 L 36,6 L 42,13 C 43,24 43,44 41,54 Z',
    apexCenter: { x: 30, y: 96 },
    apices: [{ x: 30, y: 96 }],
    gumLinePath: 'M 17,54 Q 30,48 43,54',
    cervicalLinePath: 'M 21,54 Q 30,50 39,54',
    fractureCrackPath: 'M 21,52 L 30,34 L 26,24 L 35,7',
  }
}

// ─── 42 & 32: MANDIBULAR LATERAL INCISOR ─────────────────────────────────────
// Wider than lower central incisor, slight distal incisal slope and distal root curve.
function getMandibularLateralIncisor(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 33 : 27
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 0.85,
    crownOutline: isRight
      ? 'M 20,54 C 18,44 18,26 19,13 C 19,8 21,6 23,6 L 38,6 C 41,6 43,9 43,14 C 44,26 44,44 42,54 C 35,51 27,51 20,54 Z'
      : 'M 20,54 C 18,44 18,26 19,14 C 19,9 21,6 24,6 L 39,6 C 41,6 43,8 43,13 C 44,26 44,44 42,54 C 35,51 27,51 20,54 Z',
    crownDetails: ['M 22,10 L 40,10', 'M 26,15 L 26,42', 'M 36,15 L 36,42'],
    rootOutline: isRight
      ? `M 22,54 C 20,70 24,86 31,96 C 33,98 35,97 35,95 C 38,86 42,70 40,54 C 35,51 27,51 22,54 Z`
      : `M 22,54 C 20,70 24,86 27,95 C 27,97 29,98 31,96 C 38,86 42,70 40,54 C 35,51 27,51 22,54 Z`,
    rootDetails: ['M 30,58 L 30,90'],
    pulpOutline: 'M 25,48 C 23,40 23,28 25,20 C 27,17 33,17 35,20 C 37,28 37,40 35,48 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},96 C 31,80 30,64 30,48` : `M ${apexX},96 C 29,80 30,64 30,48`,
    ],
    surfaces: {
      buccal: 'M 22,17 L 40,17 L 43,6 L 19,6 Z',
      lingual: 'M 20,54 L 42,54 L 38,40 L 24,40 Z',
      mesial: isRight
        ? 'M 19,6 L 22,17 L 24,40 L 20,54 C 18,44 18,26 19,6 Z'
        : 'M 43,6 L 40,17 L 38,40 L 42,54 C 44,44 44,26 43,6 Z',
      distal: isRight
        ? 'M 43,6 L 40,17 L 38,40 L 42,54 C 44,44 44,26 43,6 Z'
        : 'M 19,6 L 22,17 L 24,40 L 20,54 C 18,44 18,26 19,6 Z',
      occlusal: 'M 22,17 L 40,17 L 38,40 L 24,40 Z',
    },
    fissurePaths: ['M 26,15 L 26,40', 'M 36,15 L 36,40'],
    cuspHighlights: ['M 21,7 L 41,7'],
    implantOutline: 'M 23,54 L 39,54 L 37,86 C 37,90 33,94 30,94 C 27,94 23,90 23,86 Z',
    implantThreads: ['M 24,60 L 38,60', 'M 25,66 L 37,66', 'M 26,72 L 36,72', 'M 27,78 L 35,78'],
    crownCapOutline: 'M 18,54 C 16,44 16,24 17,13 L 23,6 L 39,6 L 45,13 C 46,24 46,44 44,54 Z',
    apexCenter: { x: apexX, y: 96 },
    apices: [{ x: apexX, y: 96 }],
    gumLinePath: 'M 16,54 Q 30,48 44,54',
    cervicalLinePath: 'M 20,54 Q 30,50 42,54',
    fractureCrackPath: 'M 21,52 L 31,34 L 27,24 L 38,7',
  }
}

// ─── 43 & 33: MANDIBULAR CANINE ──────────────────────────────────────────────
// Long slender crown, pointed cusp, smooth rounded labial ridge, stout long root.
function getMandibularCanine(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 1.0,
    crownOutline: isRight
      ? 'M 18,54 C 16,42 15,26 19,14 L 30,4 L 43,16 C 47,26 46,42 44,54 C 36,51 24,51 18,54 Z'
      : 'M 18,54 C 16,42 15,26 19,16 L 30,4 L 43,14 C 47,26 46,42 44,54 C 36,51 24,51 18,54 Z',
    crownDetails: [
      'M 30,54 L 30,5', // Smooth labial ridge
      'M 20,28 L 30,6 L 40,28', // Cusp slope facets
    ],
    rootOutline:
      'M 20,54 C 18,70 22,86 28,96 C 30,98 32,98 34,96 C 40,86 42,70 40,54 C 36,51 24,51 20,54 Z',
    rootDetails: ['M 28,58 L 28,92', 'M 32,58 L 32,92'],
    pulpOutline: 'M 25,48 C 23,40 23,28 25,20 L 30,13 L 35,20 C 37,28 37,40 35,48 Z',
    rootCanalPaths: ['M 30,96 C 29.5,80 29.5,64 30,48'],
    surfaces: {
      buccal: 'M 22,19 L 40,19 L 43,15 L 30,4 L 19,15 Z',
      lingual: 'M 18,54 L 44,54 L 38,40 L 22,40 Z',
      mesial: isRight
        ? 'M 19,15 L 22,19 L 24,40 L 18,54 C 16,42 15,26 19,15 Z'
        : 'M 43,15 L 40,19 L 38,40 L 44,54 C 46,42 47,26 43,15 Z',
      distal: isRight
        ? 'M 43,15 L 40,19 L 38,40 L 44,54 C 46,42 47,26 43,15 Z'
        : 'M 19,15 L 22,19 L 24,40 L 18,54 C 16,42 15,26 19,15 Z',
      occlusal: 'M 22,19 L 40,19 L 38,40 L 22,40 Z',
    },
    fissurePaths: ['M 30,11 L 30,50'],
    cuspHighlights: ['M 24,11 L 30,5 L 36,11'],
    implantOutline: 'M 22,54 L 40,54 L 38,88 C 38,92 34,96 30,96 C 26,96 22,92 22,88 Z',
    implantThreads: [
      'M 23,60 L 39,60',
      'M 24,66 L 38,66',
      'M 25,72 L 37,72',
      'M 26,78 L 36,78',
      'M 27,84 L 35,84',
    ],
    crownCapOutline: 'M 16,54 C 14,42 13,24 17,13 L 30,4 L 45,13 C 49,24 48,42 46,54 Z',
    apexCenter: { x: 30, y: 96 },
    apices: [{ x: 30, y: 96 }],
    gumLinePath: 'M 14,54 Q 30,48 46,54',
    cervicalLinePath: 'M 18,54 Q 30,50 44,54',
    fractureCrackPath: 'M 20,52 L 30,34 L 26,24 L 30,5',
  }
}

// ─── 44 & 34: MANDIBULAR FIRST PREMOLAR ──────────────────────────────────────
// Dominant sharp buccal cusp, very small non-functioning lingual cusp ("snake-eyes" morphology),
// transverse ridge crossing the occlusal table.
function getMandibularFirstPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 1.0,
    crownOutline:
      'M 17,54 C 15,46 13,26 16,15 C 19,9 25,5 30,4 C 35,5 41,9 44,15 C 47,26 45,46 43,54 C 36,51 24,51 17,54 Z',
    crownDetails: [
      // Dominant Buccal Cusp Slope & Lingual Transverse Ridge ("Snake-eyes")
      'M 19,22 C 25,19 35,19 41,22',
      'M 21,40 C 26,42 34,42 39,40',
      'M 30,10 L 30,38', // Transverse ridge
    ],
    rootOutline:
      'M 19,54 C 17,70 19,86 27,95 C 29,97 31,97 33,95 C 41,86 43,70 41,54 C 36,51 24,51 19,54 Z',
    rootDetails: ['M 28,60 L 28,90', 'M 32,60 L 32,90'],
    pulpOutline: 'M 24,48 C 22,40 22,28 24,20 C 26,16 34,16 36,20 C 38,28 38,40 36,48 Z',
    rootCanalPaths: ['M 30,95 C 29.5,80 29.5,64 30,48'],
    surfaces: {
      buccal: 'M 21,20 L 39,20 L 45,7 C 39,4 21,4 15,7 Z',
      lingual: 'M 17,54 L 43,54 L 37,40 L 23,40 Z',
      mesial: isRight
        ? 'M 15,7 L 21,20 L 23,40 L 17,54 C 14,44 13,22 15,7 Z'
        : 'M 45,7 L 39,20 L 37,40 L 43,54 C 46,44 47,22 45,7 Z',
      distal: isRight
        ? 'M 45,7 L 39,20 L 37,40 L 43,54 C 46,44 47,22 45,7 Z'
        : 'M 15,7 L 21,20 L 23,40 L 17,54 C 14,44 13,22 15,7 Z',
      occlusal: 'M 21,20 L 39,20 L 37,40 L 23,40 Z',
    },
    fissurePaths: [
      'M 25,30 L 35,30',
      'M 25,30 A 1.5 1.5 0 1 0 25,30.1',
      'M 35,30 A 1.5 1.5 0 1 0 35,30.1',
    ],
    cuspHighlights: ['M 23,11 L 30,5 L 37,11'],
    implantOutline: 'M 21,54 L 39,54 L 37,86 C 37,90 33,94 30,94 C 27,94 23,90 23,86 Z',
    implantThreads: ['M 22,60 L 38,60', 'M 23,66 L 37,66', 'M 24,72 L 36,72', 'M 25,78 L 35,78'],
    crownCapOutline: 'M 15,54 C 13,46 11,24 14,14 C 18,6 42,6 45,14 C 48,24 47,46 45,54 Z',
    apexCenter: { x: 30, y: 95 },
    apices: [{ x: 30, y: 95 }],
    gumLinePath: 'M 14,54 Q 30,48 46,54',
    cervicalLinePath: 'M 17,54 Q 30,50 43,54',
    fractureCrackPath: 'M 19,52 L 29,34 L 25,24 L 37,7',
  }
}

// ─── 45 & 35: MANDIBULAR SECOND PREMOLAR ─────────────────────────────────────
// Larger, squarer than PM1, 3 cusps with characteristic Y-groove occlusal pattern.
function getMandibularSecondPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    relativeWidth: 1.05,
    crownOutline:
      'M 16,54 C 14,46 12,26 15,15 C 18,9 24,5 30,5 C 36,5 42,9 45,15 C 48,26 46,46 44,54 C 36,51 24,51 16,54 Z',
    crownDetails: [
      'M 19,22 C 25,20 35,20 41,22',
      'M 19,38 C 25,40 35,40 41,38',
      'M 30,22 L 30,38', // Y-pattern central stem
    ],
    rootOutline:
      'M 19,54 C 17,70 19,86 27,95 C 29,97 31,97 33,95 C 41,86 43,70 41,54 C 36,51 24,51 19,54 Z',
    rootDetails: ['M 28,60 L 28,90', 'M 32,60 L 32,90'],
    pulpOutline: 'M 24,48 C 22,40 22,28 24,20 C 26,16 34,16 36,20 C 38,28 38,40 36,48 Z',
    rootCanalPaths: ['M 30,95 C 29.5,80 29.5,64 30,48'],
    surfaces: {
      buccal: 'M 21,20 L 39,20 L 46,7 C 40,4 20,4 14,7 Z',
      lingual: 'M 16,54 L 44,54 L 38,40 L 22,40 Z',
      mesial: isRight
        ? 'M 14,7 L 21,20 L 22,40 L 16,54 C 13,44 12,22 14,7 Z'
        : 'M 46,7 L 39,20 L 38,40 L 44,54 C 47,44 48,22 46,7 Z',
      distal: isRight
        ? 'M 46,7 L 39,20 L 38,40 L 44,54 C 47,44 48,22 46,7 Z'
        : 'M 14,7 L 21,20 L 22,40 L 16,54 C 13,44 12,22 14,7 Z',
      occlusal: 'M 21,20 L 39,20 L 38,40 L 22,40 Z',
    },
    fissurePaths: [
      'M 25,27 L 35,27', // Horizontal bar of Y
      'M 30,27 L 30,39', // Stem of Y
    ],
    cuspHighlights: [
      'M 23,11 L 30,7 L 37,11',
      'M 21,36 L 26,38 L 29,36',
      'M 31,36 L 34,38 L 39,36',
    ],
    implantOutline: 'M 21,54 L 39,54 L 37,86 C 37,90 33,94 30,94 C 27,94 23,90 23,86 Z',
    implantThreads: ['M 22,60 L 38,60', 'M 23,66 L 37,66', 'M 24,72 L 36,72', 'M 25,78 L 35,78'],
    crownCapOutline: 'M 14,54 C 12,46 10,24 13,14 C 17,6 43,6 46,14 C 49,24 48,46 46,54 Z',
    apexCenter: { x: 30, y: 95 },
    apices: [{ x: 30, y: 95 }],
    gumLinePath: 'M 13,54 Q 30,48 47,54',
    cervicalLinePath: 'M 16,54 Q 30,50 44,54',
    fractureCrackPath: 'M 18,52 L 28,34 L 24,24 L 36,7',
  }
}

// ─── 46 & 36: MANDIBULAR FIRST MOLAR ─────────────────────────────────────────
// Largest tooth in the lower arch, 5 distinct cusps (3 buccal, 2 lingual),
// TRUE BIFURCATED DUAL ROOTS: Mesial root (broad, curved distally) and Distal root (straight)
// with deep inter-radicular bifurcation gap.
function getMandibularFirstMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 2,
    canalCount: 3,
    relativeWidth: 1.4,
    // 2 massive physically separated divergent roots with true bifurcation gap
    rootOutline:
      'M 9,54 C 7,68 5,84 13,95 C 15,97 19,97 21,94 C 25,84 26,72 30,64 C 34,72 35,84 39,94 C 41,97 45,97 47,95 C 55,84 53,68 51,54 C 42,51 18,51 9,54 Z',
    rootDetails: [
      'M 17,62 C 16,74 15,86 16,92', // Mesial root longitudinal depression
      'M 43,62 C 44,74 45,86 44,92', // Distal root longitudinal depression
    ],
    crownOutline:
      'M 7,54 C 5,46 4,26 6,14 C 8,7 15,4 30,4 C 45,4 52,7 54,14 C 56,26 55,46 53,54 C 42,51 18,51 7,54 Z',
    crownDetails: [
      // 5 Sculpted 3D Cusp Facets (3 Buccal + 2 Lingual)
      'M 11,20 C 17,17 23,17 28,20', // Mesiobuccal cusp ridge
      'M 28,20 C 33,17 39,17 44,19', // Distobuccal cusp ridge
      'M 44,19 C 48,17 51,19 53,22', // Distal cusp ridge
      'M 11,38 C 17,41 23,41 29,38', // Mesiolingual cusp ridge
      'M 29,38 C 35,41 41,41 47,38', // Distolingual cusp ridge
    ],
    pulpOutline: 'M 18,48 C 16,42 16,28 18,22 C 22,19 38,19 42,22 C 44,28 44,42 42,48 Z',
    rootCanalPaths: [
      'M 16,94 C 16,80 20,66 24,48', // Mesial root canal
      'M 44,94 C 44,80 40,66 36,48', // Distal root canal
    ],
    surfaces: {
      buccal: 'M 13,20 L 47,20 L 55,10 C 47,3 13,3 5,10 Z',
      lingual: 'M 7,54 L 53,54 L 47,40 L 13,40 Z',
      mesial: isRight
        ? 'M 5,10 L 13,20 L 13,40 L 7,54 C 5,44 4,24 5,10 Z'
        : 'M 55,10 L 47,20 L 47,40 L 53,54 C 55,44 56,24 55,10 Z',
      distal: isRight
        ? 'M 55,10 L 47,20 L 47,40 L 53,54 C 55,44 56,24 55,10 Z'
        : 'M 5,10 L 13,20 L 13,40 L 7,54 C 5,44 4,24 5,10 Z',
      occlusal: 'M 13,20 L 47,20 L 47,40 L 13,40 Z',
    },
    fissurePaths: [
      'M 17,30 L 43,30', // Central developmental groove
      'M 23,16 L 23,38', // Mesiobuccal groove
      'M 35,16 L 35,38', // Distobuccal groove
      'M 45,20 L 39,30', // Distal groove
    ],
    cuspHighlights: [
      'M 13,14 L 19,11 L 25,14',
      'M 25,14 L 31,11 L 37,14',
      'M 38,15 L 43,13 L 47,16',
      'M 13,38 L 21,40 L 28,38',
      'M 30,38 L 37,40 L 45,38',
    ],
    rootSeparationPath: 'M 30,64 L 30,54',
    implantOutline: 'M 15,54 L 45,54 L 43,86 C 43,90 37,94 30,94 C 23,94 17,90 17,86 Z',
    implantThreads: [
      'M 16,60 L 44,60',
      'M 17,66 L 43,66',
      'M 18,72 L 42,72',
      'M 19,78 L 41,78',
      'M 20,84 L 40,84',
    ],
    crownCapOutline: 'M 5,54 C 3,46 2,22 5,12 C 9,3 51,3 55,12 C 58,22 57,46 55,54 Z',
    apexCenter: { x: 30, y: 95 },
    apices: [
      { x: 15, y: 95 },
      { x: 45, y: 94 },
    ],
    gumLinePath: 'M 4,54 Q 30,47 56,54',
    cervicalLinePath: 'M 7,54 Q 30,50 53,54',
    fractureCrackPath: 'M 11,52 L 23,34 L 19,24 L 37,6',
  }
}

// ─── 47 & 37: MANDIBULAR SECOND MOLAR ────────────────────────────────────────
// 4 symmetrical cusps with classic "+" (cross) occlusal groove pattern,
// 2 parallel convergent roots.
function getMandibularSecondMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 2,
    canalCount: 3,
    relativeWidth: 1.25,
    rootOutline:
      'M 11,54 C 9,68 8,84 16,95 C 18,97 21,97 23,94 C 26,84 27,72 30,65 C 33,72 34,84 37,94 C 39,97 42,97 44,95 C 52,84 51,68 49,54 C 40,51 20,51 11,54 Z',
    rootDetails: ['M 19,62 L 17,88', 'M 41,62 L 43,88'],
    crownOutline:
      'M 9,54 C 7,46 6,26 8,14 C 10,8 17,5 30,5 C 43,5 50,8 52,14 C 54,26 53,46 51,54 C 40,51 20,51 9,54 Z',
    crownDetails: [
      'M 13,20 C 19,18 25,18 29,20',
      'M 31,20 C 35,18 41,18 47,20',
      'M 13,38 C 19,40 25,40 29,38',
      'M 31,38 C 35,40 41,40 47,38',
    ],
    pulpOutline: 'M 19,48 C 17,42 17,28 19,22 C 23,20 37,20 41,22 C 43,28 43,42 41,48 Z',
    rootCanalPaths: ['M 18,94 C 18,80 21,66 24,48', 'M 42,94 C 42,80 39,66 36,48'],
    surfaces: {
      buccal: 'M 15,20 L 45,20 L 53,10 C 45,4 15,4 7,10 Z',
      lingual: 'M 9,54 L 51,54 L 45,40 L 15,40 Z',
      mesial: isRight
        ? 'M 7,10 L 15,20 L 15,40 L 9,54 C 7,44 6,24 7,10 Z'
        : 'M 53,10 L 45,20 L 45,40 L 51,54 C 53,44 54,24 53,10 Z',
      distal: isRight
        ? 'M 53,10 L 45,20 L 45,40 L 51,54 C 53,44 54,24 53,10 Z'
        : 'M 7,10 L 15,20 L 15,40 L 9,54 C 7,44 6,24 7,10 Z',
      occlusal: 'M 15,20 L 45,20 L 45,40 L 15,40 Z',
    },
    fissurePaths: [
      'M 17,30 L 43,30', // Longitudinal cross bar
      'M 30,16 L 30,40', // Transverse cross bar
    ],
    cuspHighlights: [
      'M 15,14 L 21,12 L 27,14',
      'M 33,14 L 39,12 L 45,14',
      'M 15,38 L 21,40 L 27,38',
      'M 33,38 L 39,40 L 45,38',
    ],
    rootSeparationPath: 'M 30,65 L 30,54',
    implantOutline: 'M 17,54 L 43,54 L 41,86 C 41,90 35,94 30,94 C 25,94 19,90 19,86 Z',
    implantThreads: ['M 18,60 L 42,60', 'M 19,66 L 41,66', 'M 20,72 L 40,72', 'M 21,78 L 39,78'],
    crownCapOutline: 'M 7,54 C 5,46 4,24 7,13 C 11,5 49,5 53,13 C 56,24 55,46 53,54 Z',
    apexCenter: { x: 30, y: 95 },
    apices: [
      { x: 18, y: 95 },
      { x: 42, y: 94 },
    ],
    gumLinePath: 'M 6,54 Q 30,48 54,54',
    cervicalLinePath: 'M 9,54 Q 30,50 51,54',
    fractureCrackPath: 'M 13,52 L 24,34 L 20,24 L 36,7',
  }
}

// ─── 48 & 38: MANDIBULAR THIRD MOLAR ─────────────────────────────────────────
// Smallest lower molar, rounded multi-cusp crown with crenulations, short convergent roots.
function getMandibularThirdMolar(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 34 : 26
  return {
    rootCount: 1,
    canalCount: 2,
    relativeWidth: 1.15,
    rootOutline: isRight
      ? 'M 13,54 C 11,68 15,80 31,92 C 33,94 36,93 36,90 C 38,80 47,68 47,54 C 39,51 21,51 13,54 Z'
      : 'M 13,54 C 13,68 22,80 24,90 C 24,93 27,94 29,92 C 45,80 49,68 47,54 C 39,51 21,51 13,54 Z',
    rootDetails: ['M 28,60 L 28,86', 'M 32,60 L 32,86'],
    crownOutline:
      'M 11,54 C 9,46 8,26 10,15 C 12,9 19,6 30,6 C 41,6 48,9 50,15 C 52,26 51,46 49,54 C 40,51 20,51 11,54 Z',
    crownDetails: ['M 15,20 C 21,18 39,18 45,20', 'M 15,38 C 21,40 39,40 45,38'],
    pulpOutline: 'M 20,48 C 18,42 18,28 20,22 C 24,20 36,20 40,22 C 42,28 42,42 40,48 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},91 C 31,78 28,66 26,48` : `M ${apexX},91 C 29,78 32,66 34,48`,
      isRight ? `M ${apexX + 2},90 C 34,78 33,66 34,48` : `M ${apexX - 2},90 C 26,78 27,66 26,48`,
    ],
    surfaces: {
      buccal: 'M 17,20 L 43,20 L 49,12 C 43,7 17,7 11,12 Z',
      lingual: 'M 11,54 L 49,54 L 43,40 L 17,40 Z',
      mesial: isRight
        ? 'M 11,12 L 17,20 L 17,40 L 11,54 C 9,44 9,24 11,12 Z'
        : 'M 49,12 L 43,20 L 43,40 L 49,54 C 51,44 51,24 49,12 Z',
      distal: isRight
        ? 'M 49,12 L 43,20 L 43,40 L 49,54 C 51,44 51,24 49,12 Z'
        : 'M 11,12 L 17,20 L 17,40 L 11,54 C 9,44 9,24 11,12 Z',
      occlusal: 'M 17,20 L 43,20 L 43,40 L 17,40 Z',
    },
    fissurePaths: ['M 20,30 L 40,30', 'M 30,20 L 30,38'],
    cuspHighlights: [
      'M 17,15 L 23,13 L 29,15',
      'M 31,15 L 37,13 L 43,15',
      'M 17,36 L 23,38 L 29,36',
      'M 31,36 L 37,38 L 43,36',
    ],
    implantOutline: 'M 19,54 L 41,54 L 39,86 C 39,90 35,94 30,94 C 25,94 21,90 21,86 Z',
    implantThreads: ['M 20,60 L 40,60', 'M 21,66 L 39,66', 'M 22,72 L 38,72', 'M 23,78 L 37,78'],
    crownCapOutline: 'M 9,54 C 7,46 6,24 9,14 C 13,7 47,7 51,14 C 54,24 53,46 51,54 Z',
    apexCenter: { x: apexX, y: 91 },
    apices: [{ x: apexX, y: 91 }],
    gumLinePath: 'M 8,54 Q 30,48 52,54',
    cervicalLinePath: 'M 11,54 Q 30,50 49,54',
    fractureCrackPath: 'M 14,52 L 25,34 L 21,24 L 35,8',
  }
}

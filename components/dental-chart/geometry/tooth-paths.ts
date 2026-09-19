/**
 * Clean-Room High Anatomical Realism SVG Tooth Geometry & Vector Path Definitions for DenToRa
 *
 * All coordinates, Bézier curves, root bifurcation paths, cusp morphology,
 * and developmental fissures are authored from first anatomical principles for
 * a normalized 60x100 viewBox coordinate space.
 */

import { ToothAnatomyGroup, ToothPosition, ToothSide, ToothSpecificType } from '../types/odontogram'

export interface ToothGeometryPaths {
  rootOutline: string
  crownOutline: string
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

// ─── MAXILLARY CENTRAL INCISOR (11, 21) ──────────────────────────────────────
// Wide shovel/spatulate crown, sharp 90° mesioincisal angle, rounded distoincisal angle, stout single root.
function getMaxillaryCentralIncisor(isRight: boolean): ToothGeometryPaths {
  // Mesial is towards midline (Left for Q1/right tooth, Right for Q2/left tooth)
  return {
    rootCount: 1,
    canalCount: 1,
    rootOutline: 'M 18,48 C 16,32 20,16 28,6 C 30,4 32,4 34,6 C 42,16 44,32 42,48 Z',
    crownOutline: isRight
      ? 'M 16,48 C 14,58 13,76 14,88 C 14,93 15,95 18,95 L 42,95 C 45,95 47,91 47,85 C 47,74 46,58 44,48 Z'
      : 'M 16,48 C 14,58 13,74 13,85 C 13,91 15,95 18,95 L 42,95 C 45,95 46,93 46,88 C 47,76 46,58 44,48 Z',
    pulpOutline: 'M 24,54 C 22,62 22,74 24,82 C 26,86 34,86 36,82 C 38,74 38,62 36,54 Z',
    rootCanalPaths: ['M 30,6 C 29,20 29,36 30,54'],
    surfaces: {
      buccal: 'M 18,48 L 42,48 L 38,64 L 22,64 Z',
      lingual: 'M 22,78 L 38,78 L 42,86 L 18,86 Z',
      mesial: isRight
        ? 'M 16,48 L 22,64 L 22,86 L 18,95 C 15,95 14,93 14,88 C 13,76 14,58 16,48 Z'
        : 'M 38,64 L 44,48 C 46,58 47,76 46,88 C 46,93 45,95 42,95 L 38,86 Z',
      distal: isRight
        ? 'M 38,64 L 44,48 C 46,58 47,74 47,85 C 47,91 45,95 42,95 L 38,86 Z'
        : 'M 16,48 L 22,64 L 22,86 L 18,95 C 15,95 13,91 13,85 C 13,74 14,58 16,48 Z',
      occlusal: 'M 18,86 L 42,86 L 42,95 L 18,95 Z',
    },
    fissurePaths: ['M 24,62 L 24,88', 'M 36,62 L 36,88'],
    cuspHighlights: ['M 18,94 L 42,94'],
    implantOutline: 'M 20,48 L 40,48 L 38,16 C 38,12 34,8 30,8 C 26,8 22,12 22,16 Z',
    implantThreads: [
      'M 21,42 L 39,42',
      'M 22,36 L 38,36',
      'M 23,30 L 37,30',
      'M 24,24 L 36,24',
      'M 25,18 L 35,18',
    ],
    crownCapOutline: 'M 14,48 C 12,58 12,78 14,88 L 18,95 L 42,95 L 46,88 C 48,78 48,58 46,48 Z',
    apexCenter: { x: 30, y: 6 },
    apices: [{ x: 30, y: 6 }],
    gumLinePath: 'M 13,48 Q 30,53 47,48',
    cervicalLinePath: 'M 16,48 Q 30,51 44,48',
    fractureCrackPath: 'M 18,50 L 28,68 L 24,76 L 38,95',
  }
}

// ─── MAXILLARY LATERAL INCISOR (12, 22) ──────────────────────────────────────
// Slender crown, rounded corners, slender root curving slightly distally.
function getMaxillaryLateralIncisor(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 34 : 26
  return {
    rootCount: 1,
    canalCount: 1,
    rootOutline: isRight
      ? 'M 20,48 C 18,34 22,18 31,7 C 33,5 36,6 36,9 C 38,20 42,34 40,48 Z'
      : 'M 20,48 C 18,34 22,20 24,9 C 24,6 27,5 29,7 C 38,18 42,34 40,48 Z',
    crownOutline: isRight
      ? 'M 18,48 C 16,58 15,74 16,86 C 17,91 19,94 22,94 L 38,94 C 42,94 44,89 44,83 C 44,72 43,58 42,48 Z'
      : 'M 18,48 C 17,58 16,72 16,83 C 16,89 18,94 22,94 L 38,94 C 41,94 43,91 44,86 C 45,74 44,58 42,48 Z',
    pulpOutline: 'M 25,54 C 23,62 23,74 25,80 C 27,83 33,83 35,80 C 37,74 37,62 35,54 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},7 C 32,22 30,36 30,54` : `M ${apexX},7 C 28,22 30,36 30,54`,
    ],
    surfaces: {
      buccal: 'M 20,48 L 40,48 L 36,64 L 24,64 Z',
      lingual: 'M 24,78 L 36,78 L 39,85 L 21,85 Z',
      mesial: isRight
        ? 'M 18,48 L 24,64 L 24,85 L 21,85 L 22,94 C 19,94 17,91 16,86 C 15,74 16,58 18,48 Z'
        : 'M 36,64 L 42,48 C 44,58 45,74 44,86 C 43,91 41,94 38,94 L 39,85 L 36,85 Z',
      distal: isRight
        ? 'M 36,64 L 42,48 C 43,58 44,72 44,83 C 44,89 42,94 38,94 L 39,85 L 36,85 Z'
        : 'M 18,48 L 24,64 L 24,85 L 21,85 L 22,94 C 18,94 16,89 16,83 C 16,72 17,58 18,48 Z',
      occlusal: 'M 21,85 L 39,85 L 38,94 L 22,94 Z',
    },
    fissurePaths: ['M 26,62 L 26,85', 'M 34,62 L 34,85'],
    cuspHighlights: ['M 22,93 L 38,93'],
    implantOutline: 'M 22,48 L 38,48 L 36,16 C 36,12 32,8 30,8 C 28,8 24,12 24,16 Z',
    implantThreads: ['M 23,42 L 37,42', 'M 24,36 L 36,36', 'M 25,30 L 35,30', 'M 26,24 L 34,24'],
    crownCapOutline: 'M 16,48 C 14,58 14,78 16,88 L 22,94 L 38,94 L 44,88 C 46,78 46,58 44,48 Z',
    apexCenter: { x: apexX, y: 7 },
    apices: [{ x: apexX, y: 7 }],
    gumLinePath: 'M 15,48 Q 30,53 45,48',
    cervicalLinePath: 'M 18,48 Q 30,51 42,48',
    fractureCrackPath: 'M 20,50 L 30,68 L 26,76 L 36,94',
  }
}

// ─── MAXILLARY CANINE (13, 23) ───────────────────────────────────────────────
// Massive spear/diamond crown, prominent sharp cusp tip at y=96, prominent labial ridge, stout root.
function getMaxillaryCanine(isRight: boolean): ToothGeometryPaths {
  const cuspX = 30
  return {
    rootCount: 1,
    canalCount: 1,
    rootOutline: 'M 18,48 C 16,30 20,14 28,4 C 30,3 32,3 34,4 C 42,14 44,30 42,48 Z',
    crownOutline: isRight
      ? 'M 16,48 C 13,60 13,76 18,87 L 30,96 L 42,85 C 47,76 47,60 44,48 Z'
      : 'M 16,48 C 13,60 13,76 18,85 L 30,96 L 42,87 C 47,76 47,60 44,48 Z',
    pulpOutline: 'M 25,54 C 23,62 23,74 25,82 L 30,88 L 35,82 C 37,74 37,62 35,54 Z',
    rootCanalPaths: ['M 30,4 C 29,20 29,36 30,54'],
    surfaces: {
      buccal: 'M 18,48 L 42,48 L 38,62 L 22,62 Z',
      lingual: 'M 22,78 L 38,78 L 41,84 L 30,92 L 19,84 Z',
      mesial: isRight
        ? 'M 16,48 L 22,62 L 22,78 L 19,84 L 18,87 C 13,76 13,60 16,48 Z'
        : 'M 38,62 L 44,48 C 47,60 47,76 42,87 L 41,84 L 38,78 Z',
      distal: isRight
        ? 'M 38,62 L 44,48 C 47,60 47,76 42,85 L 41,84 L 38,78 Z'
        : 'M 16,48 L 22,62 L 22,78 L 19,84 L 18,85 C 13,76 13,60 16,48 Z',
      occlusal: 'M 22,62 L 38,62 L 38,78 L 41,84 L 30,96 L 19,84 L 22,78 Z',
    },
    fissurePaths: [
      'M 30,50 L 30,92', // Prominent labial ridge
    ],
    cuspHighlights: ['M 26,90 L 30,95 L 34,90'],
    implantOutline: 'M 20,48 L 40,48 L 38,14 C 38,10 34,6 30,6 C 26,6 22,10 22,14 Z',
    implantThreads: [
      'M 21,42 L 39,42',
      'M 22,36 L 38,36',
      'M 23,30 L 37,30',
      'M 24,24 L 36,24',
      'M 25,18 L 35,18',
    ],
    crownCapOutline: 'M 14,48 C 11,60 11,78 16,88 L 30,96 L 44,88 C 49,78 49,60 46,48 Z',
    apexCenter: { x: cuspX, y: 4 },
    apices: [{ x: cuspX, y: 4 }],
    gumLinePath: 'M 13,48 Q 30,54 47,48',
    cervicalLinePath: 'M 16,48 Q 30,52 44,48',
    fractureCrackPath: 'M 18,50 L 28,68 L 24,76 L 30,96',
  }
}

// ─── MAXILLARY FIRST PREMOLAR (14, 24) ───────────────────────────────────────
// Bicuspid crown (buccal cusp longer than palatal cusp), 2 BIFURCATED ROOTS (buccal & palatal) with deep furcation!
function getMaxillaryFirstPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 2,
    canalCount: 2,
    rootOutline:
      'M 16,48 C 14,36 14,22 20,8 C 22,6 25,6 26,9 C 28,18 28,26 30,32 C 32,26 32,18 34,9 C 35,6 38,6 40,8 C 46,22 46,36 44,48 Z',
    crownOutline:
      'M 14,48 C 12,56 10,76 13,87 C 15,92 22,95 28,95 C 32,95 38,93 42,91 C 48,87 48,68 46,48 Z',
    pulpOutline: 'M 22,54 C 20,62 20,74 23,80 C 25,83 35,83 37,80 C 40,74 40,62 38,54 Z',
    rootCanalPaths: [
      'M 22,8 C 22,22 24,36 26,54', // Buccal canal
      'M 38,8 C 38,22 36,36 34,54', // Palatal canal
    ],
    surfaces: {
      buccal: 'M 14,48 L 46,48 L 40,62 L 20,62 Z',
      lingual: 'M 20,80 L 40,80 L 44,89 C 38,92 32,94 20,92 Z',
      mesial: isRight
        ? 'M 14,48 L 20,62 L 20,80 L 14,88 C 11,76 12,56 14,48 Z'
        : 'M 40,62 L 46,48 C 48,56 48,76 46,88 L 40,80 Z',
      distal: isRight
        ? 'M 40,62 L 46,48 C 48,56 48,76 46,88 L 40,80 Z'
        : 'M 14,48 L 20,62 L 20,80 L 14,88 C 11,76 12,56 14,48 Z',
      occlusal: 'M 20,62 L 40,62 L 40,80 L 20,80 Z',
    },
    fissurePaths: [
      'M 24,71 L 36,71', // Central developmental groove
      'M 24,71 L 18,66', // Mesiobuccal triangular groove
      'M 36,71 L 42,66', // Distobuccal triangular groove
    ],
    cuspHighlights: [
      'M 22,66 L 28,63 L 34,66', // Buccal cusp ridge
      'M 24,77 L 28,79 L 32,77', // Palatal cusp ridge
    ],
    rootSeparationPath: 'M 30,32 L 30,48', // Furcation groove
    implantOutline: 'M 18,48 L 42,48 L 40,16 C 40,12 34,8 30,8 C 26,8 20,12 20,16 Z',
    implantThreads: ['M 19,42 L 41,42', 'M 20,36 L 40,36', 'M 21,30 L 39,30', 'M 22,24 L 38,24'],
    crownCapOutline: 'M 12,48 C 10,56 8,78 12,89 C 16,96 44,96 48,89 C 52,78 50,56 48,48 Z',
    apexCenter: { x: 30, y: 8 },
    apices: [
      { x: 22, y: 8 },
      { x: 38, y: 8 },
    ],
    gumLinePath: 'M 11,48 Q 30,53 49,48',
    cervicalLinePath: 'M 14,48 Q 30,51 46,48',
    fractureCrackPath: 'M 16,50 L 26,68 L 22,76 L 36,94',
  }
}

// ─── MAXILLARY SECOND PREMOLAR (15, 25) ──────────────────────────────────────
// Rounded bicuspid crown, cusps of equal height, single tapered root with deep developmental depression.
function getMaxillarySecondPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 2,
    rootOutline: 'M 18,48 C 16,32 18,16 26,7 C 28,5 32,5 34,7 C 42,16 44,32 42,48 Z',
    crownOutline:
      'M 15,48 C 13,56 12,76 15,86 C 18,92 24,95 30,95 C 36,95 42,92 45,86 C 48,76 47,56 45,48 Z',
    pulpOutline: 'M 23,54 C 21,62 21,74 23,80 C 25,83 35,83 37,80 C 39,74 39,62 37,54 Z',
    rootCanalPaths: ['M 27,8 C 26,22 26,38 28,54', 'M 33,8 C 34,22 34,38 32,54'],
    surfaces: {
      buccal: 'M 15,48 L 45,48 L 39,62 L 21,62 Z',
      lingual: 'M 21,80 L 39,80 L 45,88 C 40,94 20,94 15,88 Z',
      mesial: isRight
        ? 'M 15,48 L 21,62 L 21,80 L 15,88 C 12,78 13,58 15,48 Z'
        : 'M 39,62 L 45,48 C 47,58 48,78 45,88 L 39,80 Z',
      distal: isRight
        ? 'M 39,62 L 45,48 C 47,58 48,78 45,88 L 39,80 Z'
        : 'M 15,48 L 21,62 L 21,80 L 15,88 C 12,78 13,58 15,48 Z',
      occlusal: 'M 21,62 L 39,62 L 39,80 L 21,80 Z',
    },
    fissurePaths: [
      'M 25,71 L 35,71',
      'M 25,71 L 20,66',
      'M 35,71 L 40,66',
      'M 25,71 L 20,76',
      'M 35,71 L 40,76',
    ],
    cuspHighlights: ['M 23,65 L 30,63 L 37,65', 'M 24,77 L 30,79 L 36,77'],
    implantOutline: 'M 20,48 L 40,48 L 38,16 C 38,12 34,8 30,8 C 26,8 22,12 22,16 Z',
    implantThreads: ['M 21,42 L 39,42', 'M 22,36 L 38,36', 'M 23,30 L 37,30', 'M 24,24 L 36,24'],
    crownCapOutline: 'M 13,48 C 11,56 10,78 13,88 C 17,95 43,95 47,88 C 50,78 49,56 47,48 Z',
    apexCenter: { x: 30, y: 7 },
    apices: [{ x: 30, y: 7 }],
    gumLinePath: 'M 12,48 Q 30,53 48,48',
    cervicalLinePath: 'M 15,48 Q 30,51 45,48',
    fractureCrackPath: 'M 17,50 L 27,68 L 23,76 L 37,94',
  }
}

// ─── MAXILLARY FIRST MOLAR (16, 26) ──────────────────────────────────────────
// Large rhomboidal 4-cusp crown + Cusp of Carabelli, 3 DIVERGENT ROOTS (MB, DB, Palatal) with deep furcation!
function getMaxillaryFirstMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 3,
    canalCount: 4,
    rootOutline:
      'M 10,48 C 8,34 6,18 12,6 C 14,4 17,5 18,8 C 21,18 23,28 26,34 C 27,24 28,14 30,3 C 32,3 33,14 34,34 C 37,28 39,18 42,8 C 43,5 46,4 48,6 C 54,18 52,34 50,48 Z',
    crownOutline:
      'M 8,48 C 6,56 5,76 7,88 C 9,94 16,97 30,97 C 44,97 51,94 53,88 C 55,76 54,56 52,48 Z',
    pulpOutline: 'M 18,54 C 16,60 16,74 18,80 C 22,83 38,83 42,80 C 44,74 44,60 42,54 Z',
    rootCanalPaths: [
      'M 14,7 C 14,20 18,34 22,54', // MB canal
      'M 30,4 C 30,20 30,34 30,54', // Palatal canal
      'M 46,7 C 46,20 42,34 38,54', // DB canal
    ],
    surfaces: {
      buccal: 'M 8,48 L 52,48 L 45,62 L 15,62 Z',
      lingual: 'M 15,82 L 45,82 L 53,92 C 45,98 15,98 7,92 Z',
      mesial: isRight
        ? 'M 8,48 L 15,62 L 15,82 L 7,92 C 5,78 6,58 8,48 Z'
        : 'M 45,62 L 52,48 C 54,58 55,78 53,92 L 45,82 Z',
      distal: isRight
        ? 'M 45,62 L 52,48 C 54,58 55,78 53,92 L 45,82 Z'
        : 'M 8,48 L 15,62 L 15,82 L 7,92 C 5,78 6,58 8,48 Z',
      occlusal: 'M 15,62 L 45,62 L 45,82 L 15,82 Z',
    },
    fissurePaths: [
      'M 20,72 L 40,72', // Central groove
      'M 30,64 L 30,80', // Buccal & Lingual grooves
      'M 22,66 L 38,78', // Oblique ridge
    ],
    cuspHighlights: [
      'M 16,66 L 22,64 L 28,66', // MB Cusp
      'M 32,66 L 38,64 L 44,66', // DB Cusp
      'M 16,78 L 24,80 L 32,78', // ML Cusp (Carabelli area)
      'M 34,78 L 40,80 L 44,78', // DL Cusp
    ],
    rootSeparationPath: 'M 26,34 L 26,48 M 34,34 L 34,48',
    implantOutline: 'M 16,48 L 44,48 L 42,16 C 42,12 36,8 30,8 C 24,8 18,12 18,16 Z',
    implantThreads: [
      'M 17,42 L 43,42',
      'M 18,36 L 42,36',
      'M 19,30 L 41,30',
      'M 20,24 L 40,24',
      'M 21,18 L 39,18',
    ],
    crownCapOutline: 'M 6,48 C 4,56 3,80 6,90 C 10,98 50,98 54,90 C 57,80 56,56 54,48 Z',
    apexCenter: { x: 30, y: 4 },
    apices: [
      { x: 14, y: 7 },
      { x: 30, y: 4 },
      { x: 46, y: 7 },
    ],
    gumLinePath: 'M 5,48 Q 30,54 55,48',
    cervicalLinePath: 'M 8,48 Q 30,52 52,48',
    fractureCrackPath: 'M 12,50 L 24,68 L 20,76 L 38,95',
  }
}

// ─── MAXILLARY SECOND MOLAR (17, 27) ─────────────────────────────────────────
// Rhomboidal 4-cusp crown, slightly smaller than 1st molar, 3 roots closer together / less divergent.
function getMaxillarySecondMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 3,
    canalCount: 3,
    rootOutline:
      'M 12,48 C 10,34 9,20 15,7 C 17,5 20,6 21,9 C 23,20 25,28 27,36 C 28,26 29,16 30,4 C 31,4 32,26 33,36 C 35,28 37,20 39,9 C 40,6 43,5 45,7 C 51,20 50,34 48,48 Z',
    crownOutline:
      'M 10,48 C 8,56 7,76 9,87 C 11,93 18,96 30,96 C 42,96 49,93 51,87 C 53,76 52,56 50,48 Z',
    pulpOutline: 'M 19,54 C 17,60 17,74 19,80 C 23,82 37,82 41,80 C 43,74 43,60 41,54 Z',
    rootCanalPaths: [
      'M 17,8 C 17,20 20,34 23,54',
      'M 30,5 C 30,20 30,34 30,54',
      'M 43,8 C 43,20 40,34 37,54',
    ],
    surfaces: {
      buccal: 'M 10,48 L 50,48 L 44,62 L 16,62 Z',
      lingual: 'M 16,82 L 44,82 L 51,91 C 43,96 17,96 9,91 Z',
      mesial: isRight
        ? 'M 10,48 L 16,62 L 16,82 L 9,91 C 7,78 8,58 10,48 Z'
        : 'M 44,62 L 50,48 C 52,58 53,78 51,91 L 44,82 Z',
      distal: isRight
        ? 'M 44,62 L 50,48 C 52,58 53,78 51,91 L 44,82 Z'
        : 'M 10,48 L 16,62 L 16,82 L 9,91 C 7,78 8,58 10,48 Z',
      occlusal: 'M 16,62 L 44,62 L 44,82 L 16,82 Z',
    },
    fissurePaths: ['M 21,72 L 39,72', 'M 30,64 L 30,80'],
    cuspHighlights: [
      'M 18,66 L 23,64 L 28,66',
      'M 32,66 L 37,64 L 42,66',
      'M 18,78 L 24,80 L 30,78',
      'M 34,78 L 39,80 L 42,78',
    ],
    rootSeparationPath: 'M 27,36 L 27,48 M 33,36 L 33,48',
    implantOutline: 'M 18,48 L 42,48 L 40,16 C 40,12 34,8 30,8 C 26,8 20,12 20,16 Z',
    implantThreads: ['M 19,42 L 41,42', 'M 20,36 L 40,36', 'M 21,30 L 39,30', 'M 22,24 L 38,24'],
    crownCapOutline: 'M 8,48 C 6,56 5,78 8,89 C 12,96 48,96 52,89 C 55,78 54,56 52,48 Z',
    apexCenter: { x: 30, y: 5 },
    apices: [
      { x: 17, y: 8 },
      { x: 30, y: 5 },
      { x: 43, y: 8 },
    ],
    gumLinePath: 'M 7,48 Q 30,53 53,48',
    cervicalLinePath: 'M 10,48 Q 30,51 50,48',
    fractureCrackPath: 'M 14,50 L 25,68 L 21,76 L 37,94',
  }
}

// ─── MAXILLARY THIRD MOLAR (18, 28) ──────────────────────────────────────────
// Triangular/heart-shaped 3-cusp crown, fused/convergent roots curving distally.
function getMaxillaryThirdMolar(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 33 : 27
  return {
    rootCount: 1,
    canalCount: 3,
    rootOutline: isRight
      ? 'M 14,48 C 12,34 16,22 30,10 C 32,8 35,9 35,12 C 37,22 46,34 46,48 Z'
      : 'M 14,48 C 14,34 23,22 25,12 C 25,9 28,8 30,10 C 44,22 48,34 46,48 Z',
    crownOutline:
      'M 12,48 C 10,56 9,76 11,86 C 13,92 20,95 30,95 C 40,95 47,92 49,86 C 51,76 50,56 48,48 Z',
    pulpOutline: 'M 20,54 C 18,60 18,74 20,80 C 24,82 36,82 40,80 C 42,74 42,60 40,54 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},11 C 31,24 28,36 26,54` : `M ${apexX},11 C 29,24 32,36 34,54`,
      isRight ? `M ${apexX + 2},12 C 34,24 33,36 34,54` : `M ${apexX - 2},12 C 26,24 27,36 26,54`,
    ],
    surfaces: {
      buccal: 'M 12,48 L 48,48 L 42,62 L 18,62 Z',
      lingual: 'M 18,80 L 42,80 L 48,89 C 42,94 18,94 12,89 Z',
      mesial: isRight
        ? 'M 12,48 L 18,62 L 18,80 L 12,89 C 10,78 10,58 12,48 Z'
        : 'M 42,62 L 48,48 C 50,58 50,78 48,89 L 42,80 Z',
      distal: isRight
        ? 'M 42,62 L 48,48 C 50,58 50,78 48,89 L 42,80 Z'
        : 'M 12,48 L 18,62 L 18,80 L 12,89 C 10,78 10,58 12,48 Z',
      occlusal: 'M 18,62 L 42,62 L 42,80 L 18,80 Z',
    },
    fissurePaths: ['M 23,71 L 37,71', 'M 30,64 L 30,78'],
    cuspHighlights: [
      'M 19,65 L 24,63 L 29,65',
      'M 31,65 L 36,63 L 41,65',
      'M 22,77 L 30,79 L 38,77',
    ],
    implantOutline: 'M 20,48 L 40,48 L 38,16 C 38,12 34,8 30,8 C 26,8 22,12 22,16 Z',
    implantThreads: ['M 21,42 L 39,42', 'M 22,36 L 38,36', 'M 23,30 L 37,30', 'M 24,24 L 36,24'],
    crownCapOutline: 'M 10,48 C 8,56 7,78 10,88 C 14,95 46,95 50,88 C 53,78 52,56 50,48 Z',
    apexCenter: { x: apexX, y: 11 },
    apices: [{ x: apexX, y: 11 }],
    gumLinePath: 'M 9,48 Q 30,53 51,48',
    cervicalLinePath: 'M 12,48 Q 30,51 48,48',
    fractureCrackPath: 'M 15,50 L 26,68 L 22,76 L 36,93',
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. MANDIBULAR TEETH GEOMETRY (LOWER ARCH)
// ══════════════════════════════════════════════════════════════════════════════

// ─── MANDIBULAR CENTRAL INCISOR (41, 31) ─────────────────────────────────────
// Smallest tooth in human dentition, narrow chisel crown (width 20), symmetrical corners, slender root.
function getMandibularCentralIncisor(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    crownOutline:
      'M 20,52 C 18,42 18,24 19,12 C 19,7 21,5 23,5 L 37,5 C 39,5 41,7 41,12 C 42,24 42,42 40,52 Z',
    rootOutline: 'M 22,52 C 20,68 24,84 28,94 C 29,96 31,96 32,94 C 36,84 40,68 38,52 Z',
    pulpOutline: 'M 26,46 C 24,38 24,26 26,18 C 28,15 32,15 34,18 C 36,26 36,38 34,46 Z',
    rootCanalPaths: ['M 30,94 C 29,78 29,62 30,46'],
    surfaces: {
      buccal: 'M 22,16 L 38,16 L 41,5 L 19,5 Z',
      lingual: 'M 20,52 L 40,52 L 36,38 L 24,38 Z',
      mesial: isRight
        ? 'M 19,5 L 22,16 L 24,38 L 20,52 C 18,42 18,24 19,5 Z'
        : 'M 41,5 L 38,16 L 36,38 L 40,52 C 42,42 42,24 41,5 Z',
      distal: isRight
        ? 'M 41,5 L 38,16 L 36,38 L 40,52 C 42,42 42,24 41,5 Z'
        : 'M 19,5 L 22,16 L 24,38 L 20,52 C 18,42 18,24 19,5 Z',
      occlusal: 'M 22,16 L 38,16 L 36,38 L 24,38 Z',
    },
    fissurePaths: ['M 26,14 L 26,38', 'M 34,14 L 34,38'],
    cuspHighlights: ['M 21,6 L 39,6'],
    implantOutline: 'M 22,52 L 38,52 L 36,84 C 36,88 32,92 30,92 C 28,92 24,88 24,84 Z',
    implantThreads: [
      'M 23,58 L 37,58',
      'M 24,64 L 36,64',
      'M 25,70 L 35,70',
      'M 26,76 L 34,76',
      'M 27,82 L 33,82',
    ],
    crownCapOutline: 'M 18,52 C 16,42 16,22 17,12 L 23,5 L 37,5 L 43,12 C 44,22 44,42 42,52 Z',
    apexCenter: { x: 30, y: 94 },
    apices: [{ x: 30, y: 94 }],
    gumLinePath: 'M 17,52 Q 30,47 43,52',
    cervicalLinePath: 'M 20,52 Q 30,49 40,52',
    fractureCrackPath: 'M 20,50 L 30,32 L 26,24 L 36,6',
  }
}

// ─── MANDIBULAR LATERAL INCISOR (42, 32) ─────────────────────────────────────
// Slightly wider than central incisor (width 22), incisal edge slopes slightly distally, root curves distally.
function getMandibularLateralIncisor(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 32 : 28
  return {
    rootCount: 1,
    canalCount: 1,
    crownOutline: isRight
      ? 'M 19,52 C 17,42 17,24 18,12 C 18,7 20,5 22,5 L 37,5 C 40,5 42,8 42,13 C 43,24 43,42 41,52 Z'
      : 'M 19,52 C 17,42 17,24 18,13 C 18,8 20,5 23,5 L 38,5 C 40,5 42,7 42,12 C 43,24 43,42 41,52 Z',
    rootOutline: isRight
      ? `M 21,52 C 19,68 23,84 30,94 C 32,96 34,95 34,93 C 37,84 41,68 39,52 Z`
      : `M 21,52 C 19,68 23,84 26,93 C 26,95 28,96 30,94 C 37,84 41,68 39,52 Z`,
    pulpOutline: 'M 25,46 C 23,38 23,26 25,18 C 27,15 33,15 35,18 C 37,26 37,38 35,46 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},94 C 31,78 30,62 30,46` : `M ${apexX},94 C 29,78 30,62 30,46`,
    ],
    surfaces: {
      buccal: 'M 21,16 L 39,16 L 42,5 L 18,5 Z',
      lingual: 'M 19,52 L 41,52 L 37,38 L 23,38 Z',
      mesial: isRight
        ? 'M 18,5 L 21,16 L 23,38 L 19,52 C 17,42 17,24 18,5 Z'
        : 'M 42,5 L 39,16 L 37,38 L 41,52 C 43,42 43,24 42,5 Z',
      distal: isRight
        ? 'M 42,5 L 39,16 L 37,38 L 41,52 C 43,42 43,24 42,5 Z'
        : 'M 18,5 L 21,16 L 23,38 L 19,52 C 17,42 17,24 18,5 Z',
      occlusal: 'M 21,16 L 39,16 L 37,38 L 23,38 Z',
    },
    fissurePaths: ['M 25,14 L 25,38', 'M 35,14 L 35,38'],
    cuspHighlights: ['M 20,6 L 40,6'],
    implantOutline: 'M 22,52 L 38,52 L 36,84 C 36,88 32,92 30,92 C 28,92 24,88 24,84 Z',
    implantThreads: ['M 23,58 L 37,58', 'M 24,64 L 36,64', 'M 25,70 L 35,70', 'M 26,76 L 34,76'],
    crownCapOutline: 'M 17,52 C 15,42 15,22 16,12 L 22,5 L 38,5 L 44,12 C 45,22 45,42 43,52 Z',
    apexCenter: { x: apexX, y: 94 },
    apices: [{ x: apexX, y: 94 }],
    gumLinePath: 'M 16,52 Q 30,47 44,52',
    cervicalLinePath: 'M 19,52 Q 30,49 41,52',
    fractureCrackPath: 'M 20,50 L 30,32 L 26,24 L 37,6',
  }
}

// ─── MANDIBULAR CANINE (43, 33) ──────────────────────────────────────────────
// Slender cuspid crown, sharp cusp tip at y=4, smooth labial profile, long sturdy single root.
function getMandibularCanine(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    crownOutline: isRight
      ? 'M 17,52 C 15,40 14,24 18,13 L 30,4 L 42,15 C 46,24 45,40 43,52 Z'
      : 'M 17,52 C 15,40 14,24 18,15 L 30,4 L 42,13 C 46,24 45,40 43,52 Z',
    rootOutline: 'M 19,52 C 17,68 21,84 28,95 C 30,97 32,97 34,95 C 41,84 43,68 41,52 Z',
    pulpOutline: 'M 25,46 C 23,38 23,26 25,18 L 30,12 L 35,18 C 37,26 37,38 35,46 Z',
    rootCanalPaths: ['M 30,95 C 29,78 29,62 30,46'],
    surfaces: {
      buccal: 'M 21,18 L 39,18 L 42,14 L 30,4 L 18,14 Z',
      lingual: 'M 17,52 L 43,52 L 37,38 L 23,38 Z',
      mesial: isRight
        ? 'M 18,14 L 21,18 L 23,38 L 17,52 C 15,40 14,24 18,14 Z'
        : 'M 42,14 L 39,18 L 37,38 L 43,52 C 45,40 46,24 42,14 Z',
      distal: isRight
        ? 'M 42,14 L 39,18 L 37,38 L 43,52 C 45,40 46,24 42,14 Z'
        : 'M 18,14 L 21,18 L 23,38 L 17,52 C 15,40 14,24 18,14 Z',
      occlusal: 'M 21,18 L 39,18 L 37,38 L 23,38 Z',
    },
    fissurePaths: ['M 30,10 L 30,48'],
    cuspHighlights: ['M 26,10 L 30,5 L 34,10'],
    implantOutline: 'M 21,52 L 39,52 L 37,86 C 37,90 33,94 30,94 C 27,94 23,90 23,86 Z',
    implantThreads: [
      'M 22,58 L 38,58',
      'M 23,64 L 37,64',
      'M 24,70 L 36,70',
      'M 25,76 L 35,76',
      'M 26,82 L 34,82',
    ],
    crownCapOutline: 'M 15,52 C 13,40 12,22 16,12 L 30,4 L 44,12 C 48,22 47,40 45,52 Z',
    apexCenter: { x: 30, y: 95 },
    apices: [{ x: 30, y: 95 }],
    gumLinePath: 'M 14,52 Q 30,47 46,52',
    cervicalLinePath: 'M 17,52 Q 30,49 43,52',
    fractureCrackPath: 'M 19,50 L 29,32 L 25,24 L 30,4',
  }
}

// ─── MANDIBULAR FIRST PREMOLAR (44, 34) ──────────────────────────────────────
// "Snake-eyes" occlusal table, dominant sharp buccal cusp (y=4), small lingual cusp, single conical root.
function getMandibularFirstPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    crownOutline:
      'M 16,52 C 14,44 12,24 15,14 C 18,8 24,4 30,4 C 36,4 42,8 45,14 C 48,24 46,44 44,52 Z',
    rootOutline: 'M 18,52 C 16,68 18,84 26,93 C 28,95 32,95 34,93 C 42,84 44,68 42,52 Z',
    pulpOutline: 'M 24,46 C 22,38 22,26 24,18 C 26,14 34,14 36,18 C 38,26 38,38 36,46 Z',
    rootCanalPaths: ['M 30,93 C 29,78 29,62 30,46'],
    surfaces: {
      buccal: 'M 20,18 L 40,18 L 46,6 C 40,3 20,3 14,6 Z',
      lingual: 'M 16,52 L 44,52 L 38,38 L 22,38 Z',
      mesial: isRight
        ? 'M 14,6 L 20,18 L 22,38 L 16,52 C 13,42 12,20 14,6 Z'
        : 'M 46,6 L 40,18 L 38,38 L 44,52 C 47,42 48,20 46,6 Z',
      distal: isRight
        ? 'M 46,6 L 40,18 L 38,38 L 44,52 C 47,42 48,20 46,6 Z'
        : 'M 14,6 L 20,18 L 22,38 L 16,52 C 13,42 12,20 14,6 Z',
      occlusal: 'M 20,18 L 40,18 L 38,38 L 22,38 Z',
    },
    fissurePaths: [
      'M 24,28 L 36,28', // Transverse ridge separating 2 distinct pits (snake eyes)
      'M 25,28 A 1.5 1.5 0 1 0 25,28.1',
      'M 35,28 A 1.5 1.5 0 1 0 35,28.1',
    ],
    cuspHighlights: [
      'M 23,10 L 30,6 L 37,10', // Tall buccal cusp
    ],
    implantOutline: 'M 20,52 L 40,52 L 38,84 C 38,88 34,92 30,92 C 26,92 22,88 22,84 Z',
    implantThreads: ['M 21,58 L 39,58', 'M 22,64 L 38,64', 'M 23,70 L 37,70', 'M 24,76 L 36,76'],
    crownCapOutline: 'M 14,52 C 12,44 10,22 13,12 C 17,4 43,4 47,12 C 50,22 48,44 46,52 Z',
    apexCenter: { x: 30, y: 93 },
    apices: [{ x: 30, y: 93 }],
    gumLinePath: 'M 13,52 Q 30,47 47,52',
    cervicalLinePath: 'M 16,52 Q 30,49 44,52',
    fractureCrackPath: 'M 18,50 L 28,32 L 24,24 L 38,6',
  }
}

// ─── MANDIBULAR SECOND PREMOLAR (45, 35) ─────────────────────────────────────
// 3-cusp occlusal table (1 buccal, 2 lingual: ML & DL) with Y-groove pattern, sturdy single root.
function getMandibularSecondPremolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 1,
    canalCount: 1,
    crownOutline:
      'M 15,52 C 13,44 11,24 14,14 C 17,8 23,4 30,4 C 37,4 43,8 46,14 C 49,24 47,44 45,52 Z',
    rootOutline: 'M 18,52 C 16,68 18,84 26,93 C 28,95 32,95 34,93 C 42,84 44,68 42,52 Z',
    pulpOutline: 'M 23,46 C 21,38 21,26 23,18 C 25,14 35,14 37,18 C 39,26 39,38 37,46 Z',
    rootCanalPaths: ['M 30,93 C 29,78 29,62 30,46'],
    surfaces: {
      buccal: 'M 21,18 L 39,18 L 47,6 C 41,3 19,3 13,6 Z',
      lingual: 'M 15,52 L 45,52 L 39,38 L 21,38 Z',
      mesial: isRight
        ? 'M 13,6 L 21,18 L 21,38 L 15,52 C 12,42 11,20 13,6 Z'
        : 'M 47,6 L 39,18 L 39,38 L 45,52 C 48,42 49,20 47,6 Z',
      distal: isRight
        ? 'M 47,6 L 39,18 L 39,38 L 45,52 C 48,42 49,20 47,6 Z'
        : 'M 13,6 L 21,18 L 21,38 L 15,52 C 12,42 11,20 13,6 Z',
      occlusal: 'M 21,18 L 39,18 L 39,38 L 21,38 Z',
    },
    fissurePaths: [
      'M 24,25 L 36,25', // Y-pattern central groove
      'M 30,25 L 30,37', // Lingual groove separating ML and DL cusps
    ],
    cuspHighlights: [
      'M 24,10 L 30,7 L 36,10', // Buccal cusp
      'M 22,34 L 26,36 L 29,34', // ML Cusp
      'M 31,34 L 34,36 L 38,34', // DL Cusp
    ],
    implantOutline: 'M 20,52 L 40,52 L 38,84 C 38,88 34,92 30,92 C 26,92 22,88 22,84 Z',
    implantThreads: ['M 21,58 L 39,58', 'M 22,64 L 38,64', 'M 23,70 L 37,70', 'M 24,76 L 36,76'],
    crownCapOutline: 'M 13,52 C 11,44 9,22 12,12 C 16,4 44,4 48,12 C 51,22 49,44 47,52 Z',
    apexCenter: { x: 30, y: 93 },
    apices: [{ x: 30, y: 93 }],
    gumLinePath: 'M 12,52 Q 30,47 48,52',
    cervicalLinePath: 'M 15,52 Q 30,49 45,52',
    fractureCrackPath: 'M 17,50 L 27,32 L 23,24 L 37,6',
  }
}

// ─── MANDIBULAR FIRST MOLAR (46, 36) ─────────────────────────────────────────
// Largest mandibular crown (width 44), 5 CUSPS (MB, DB, Distal, ML, DL), 2 WIDE SEPARATED ROOTS (Mesial & Distal) with 3 canals!
function getMandibularFirstMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 2,
    canalCount: 3,
    crownOutline: 'M 8,52 C 6,44 5,24 7,12 C 9,6 16,3 30,3 C 44,3 51,6 53,12 C 55,24 54,44 52,52 Z',
    rootOutline:
      'M 10,52 C 8,66 6,82 14,93 C 16,95 20,95 22,92 C 26,82 27,70 30,64 C 33,70 34,82 38,92 C 40,95 44,95 46,93 C 54,82 52,66 50,52 Z',
    pulpOutline: 'M 18,46 C 16,40 16,26 18,20 C 22,17 38,17 42,20 C 44,26 44,40 42,46 Z',
    rootCanalPaths: [
      'M 16,92 C 16,78 20,64 24,46', // Mesiobuccal & Mesiolingual canals in mesial root
      'M 44,92 C 44,78 40,64 36,46', // Distal canal in distal root
    ],
    surfaces: {
      buccal: 'M 14,18 L 46,18 L 54,8 C 46,2 14,2 6,8 Z',
      lingual: 'M 8,52 L 52,52 L 46,38 L 14,38 Z',
      mesial: isRight
        ? 'M 6,8 L 14,18 L 14,38 L 8,52 C 6,42 5,22 6,8 Z'
        : 'M 54,8 L 46,18 L 46,38 L 52,52 C 54,42 55,22 54,8 Z',
      distal: isRight
        ? 'M 54,8 L 46,18 L 46,38 L 52,52 C 54,42 55,22 54,8 Z'
        : 'M 6,8 L 14,18 L 14,38 L 8,52 C 6,42 5,22 6,8 Z',
      occlusal: 'M 14,18 L 46,18 L 46,38 L 14,38 Z',
    },
    fissurePaths: [
      'M 18,28 L 42,28', // Central groove
      'M 24,14 L 24,36', // Mesiobuccal groove
      'M 36,14 L 36,36', // Distobuccal groove
      'M 44,18 L 38,28', // Distal cusp developmental groove
    ],
    cuspHighlights: [
      'M 15,14 L 20,11 L 25,14', // MB Cusp
      'M 27,14 L 32,11 L 37,14', // DB Cusp
      'M 39,15 L 44,13 L 48,16', // Distal Cusp (5th cusp)
      'M 16,34 L 23,36 L 30,34', // ML Cusp
      'M 32,34 L 39,36 L 46,34', // DL Cusp
    ],
    rootSeparationPath: 'M 30,64 L 30,52', // Furcation groove
    implantOutline: 'M 16,52 L 44,52 L 42,84 C 42,88 36,92 30,92 C 24,92 18,88 18,84 Z',
    implantThreads: [
      'M 17,58 L 43,58',
      'M 18,64 L 42,64',
      'M 19,70 L 41,70',
      'M 20,76 L 40,76',
      'M 21,82 L 39,82',
    ],
    crownCapOutline: 'M 6,52 C 4,44 3,20 6,10 C 10,2 50,2 54,10 C 57,20 56,44 54,52 Z',
    apexCenter: { x: 30, y: 93 },
    apices: [
      { x: 16, y: 93 },
      { x: 44, y: 92 },
    ],
    gumLinePath: 'M 5,52 Q 30,46 55,52',
    cervicalLinePath: 'M 8,52 Q 30,48 52,52',
    fractureCrackPath: 'M 12,50 L 24,32 L 20,24 L 38,5',
  }
}

// ─── MANDIBULAR SECOND MOLAR (47, 37) ────────────────────────────────────────
// Rectangular 4-cusp crown with cruciform / cross-shaped (+) fissure pattern, 2 roots closer together.
function getMandibularSecondMolar(isRight: boolean): ToothGeometryPaths {
  return {
    rootCount: 2,
    canalCount: 3,
    rootOutline:
      'M 12,52 C 10,66 9,82 17,93 C 19,95 22,95 24,92 C 27,82 28,70 30,65 C 32,70 33,82 36,92 C 38,95 41,95 43,93 C 51,82 50,66 48,52 Z',
    crownOutline:
      'M 10,52 C 8,44 7,24 9,13 C 11,7 18,4 30,4 C 42,4 49,7 51,13 C 53,24 52,44 50,52 Z',
    pulpOutline: 'M 19,46 C 17,40 17,26 19,20 C 23,18 37,18 41,20 C 43,26 43,40 41,46 Z',
    rootCanalPaths: ['M 19,92 C 19,78 22,64 25,46', 'M 41,92 C 41,78 38,64 35,46'],
    surfaces: {
      buccal: 'M 16,18 L 44,18 L 52,8 C 44,3 16,3 8,8 Z',
      lingual: 'M 10,52 L 50,52 L 44,38 L 16,38 Z',
      mesial: isRight
        ? 'M 8,8 L 16,18 L 16,38 L 10,52 C 8,42 7,22 8,8 Z'
        : 'M 52,8 L 44,18 L 44,38 L 50,52 C 52,42 53,22 52,8 Z',
      distal: isRight
        ? 'M 52,8 L 44,18 L 44,38 L 50,52 C 52,42 53,22 52,8 Z'
        : 'M 8,8 L 16,18 L 16,38 L 10,52 C 8,42 7,22 8,8 Z',
      occlusal: 'M 16,18 L 44,18 L 44,38 L 16,38 Z',
    },
    fissurePaths: [
      'M 18,28 L 42,28', // Perfect + Cross Pattern
      'M 30,14 L 30,38',
    ],
    cuspHighlights: [
      'M 17,14 L 23,12 L 29,14', // MB
      'M 31,14 L 37,12 L 43,14', // DB
      'M 17,34 L 23,36 L 29,34', // ML
      'M 31,34 L 37,36 L 43,34', // DL
    ],
    rootSeparationPath: 'M 30,65 L 30,52',
    implantOutline: 'M 18,52 L 42,52 L 40,84 C 40,88 34,92 30,92 C 26,92 20,88 20,84 Z',
    implantThreads: ['M 19,58 L 41,58', 'M 20,64 L 40,64', 'M 21,70 L 39,70', 'M 22,76 L 38,76'],
    crownCapOutline: 'M 8,52 C 6,44 5,22 8,11 C 12,4 48,4 52,11 C 55,22 54,44 52,52 Z',
    apexCenter: { x: 30, y: 93 },
    apices: [
      { x: 19, y: 93 },
      { x: 41, y: 92 },
    ],
    gumLinePath: 'M 7,52 Q 30,47 53,52',
    cervicalLinePath: 'M 10,52 Q 30,49 50,52',
    fractureCrackPath: 'M 14,50 L 25,32 L 21,24 L 37,6',
  }
}

// ─── MANDIBULAR THIRD MOLAR (48, 38) ─────────────────────────────────────────
// Rounded 4-cusp crown, 2 fused/curved roots sweeping distally.
function getMandibularThirdMolar(isRight: boolean): ToothGeometryPaths {
  const apexX = isRight ? 33 : 27
  return {
    rootCount: 1,
    canalCount: 2,
    crownOutline:
      'M 12,52 C 10,44 9,24 11,14 C 13,8 20,5 30,5 C 40,5 47,8 49,14 C 51,24 50,44 48,52 Z',
    rootOutline: isRight
      ? 'M 14,52 C 12,66 16,78 30,90 C 32,92 35,91 35,88 C 37,78 46,66 46,52 Z'
      : 'M 14,52 C 14,66 23,78 25,88 C 25,91 28,92 30,90 C 44,78 48,66 46,52 Z',
    pulpOutline: 'M 20,46 C 18,40 18,26 20,20 C 24,18 36,18 40,20 C 42,26 42,40 40,46 Z',
    rootCanalPaths: [
      isRight ? `M ${apexX},89 C 31,76 28,64 26,46` : `M ${apexX},89 C 29,76 32,64 34,46`,
      isRight ? `M ${apexX + 2},88 C 34,76 33,64 34,46` : `M ${apexX - 2},88 C 26,76 27,64 26,46`,
    ],
    surfaces: {
      buccal: 'M 18,18 L 42,18 L 48,11 C 42,6 18,6 12,11 Z',
      lingual: 'M 12,52 L 48,52 L 42,38 L 18,38 Z',
      mesial: isRight
        ? 'M 12,11 L 18,18 L 18,38 L 12,52 C 10,42 10,22 12,11 Z'
        : 'M 48,11 L 42,18 L 42,38 L 48,52 C 50,42 50,22 48,11 Z',
      distal: isRight
        ? 'M 48,11 L 42,18 L 42,38 L 48,52 C 50,42 50,22 48,11 Z'
        : 'M 12,11 L 18,18 L 18,38 L 12,52 C 10,42 10,22 12,11 Z',
      occlusal: 'M 18,18 L 42,18 L 42,38 L 18,38 Z',
    },
    fissurePaths: ['M 21,28 L 39,28', 'M 30,18 L 30,36'],
    cuspHighlights: [
      'M 18,15 L 24,13 L 29,15',
      'M 31,15 L 36,13 L 42,15',
      'M 18,33 L 24,35 L 30,33',
      'M 32,33 L 37,35 L 42,33',
    ],
    implantOutline: 'M 20,52 L 40,52 L 38,84 C 38,88 34,92 30,92 C 26,92 22,88 22,84 Z',
    implantThreads: ['M 21,58 L 39,58', 'M 22,64 L 38,64', 'M 23,70 L 37,70', 'M 24,76 L 36,76'],
    crownCapOutline: 'M 10,52 C 8,44 7,22 10,12 C 14,5 46,5 50,12 C 53,22 52,44 50,52 Z',
    apexCenter: { x: apexX, y: 89 },
    apices: [{ x: apexX, y: 89 }],
    gumLinePath: 'M 9,52 Q 30,47 51,52',
    cervicalLinePath: 'M 12,52 Q 30,49 48,52',
    fractureCrackPath: 'M 15,50 L 26,32 L 22,24 L 36,7',
  }
}

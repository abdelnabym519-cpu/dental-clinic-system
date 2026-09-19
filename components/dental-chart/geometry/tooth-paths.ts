/**
 * Clean-Room Mathematical SVG Tooth Geometry & Vector Path Definitions for DenToRa
 *
 * All coordinates and Bézier curves authored from first mathematical principles
 * for a normalized 60x100 viewBox coordinate space.
 */

import { ToothAnatomyGroup, ToothPosition, ToothSide } from '../types/odontogram'

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
  gumLinePath: string
  fractureCrackPath: string
}

/**
 * Returns exact vector geometry for a given tooth anatomy group, jaw position, and dental side.
 */
export function getToothGeometry(
  group: ToothAnatomyGroup,
  position: ToothPosition,
  side: ToothSide
): ToothGeometryPaths {
  const isUpper = position === 'upper'
  const isRight = side === 'right'

  // Geometry coordinate anchors
  // Upper: Roots top (y=6..48), Crown bottom (y=48..94)
  // Lower: Crown top (y=6..52), Roots bottom (y=52..94)

  if (group === 'molar') {
    return isUpper ? getUpperMolarGeometry(isRight) : getLowerMolarGeometry(isRight)
  }

  if (group === 'premolar') {
    return isUpper ? getUpperPremolarGeometry(isRight) : getLowerPremolarGeometry(isRight)
  }

  if (group === 'canine') {
    return isUpper ? getUpperCanineGeometry(isRight) : getLowerCanineGeometry(isRight)
  }

  // Incisor (Default)
  return isUpper ? getUpperIncisorGeometry(isRight) : getLowerIncisorGeometry(isRight)
}

// ─── UPPER MOLAR (3 Roots: MB, DB, Palatal) ──────────────────────────────────
function getUpperMolarGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    rootOutline:
      'M 12,48 C 10,36 8,20 14,8 C 18,6 22,22 26,38 C 28,24 30,12 33,6 C 36,12 37,24 38,38 C 42,22 46,6 50,8 C 54,20 52,36 50,48 Z',
    crownOutline:
      'M 10,48 C 8,56 6,76 8,86 C 10,92 18,96 30,96 C 42,96 50,92 52,86 C 54,76 52,56 50,48 C 44,50 36,49 30,49 C 24,49 16,50 10,48 Z',
    pulpOutline: 'M 20,54 C 18,60 18,72 20,78 C 24,80 36,80 40,78 C 42,72 42,60 40,54 Z',
    rootCanalPaths: [
      'M 16,10 C 14,24 16,38 22,54',
      'M 33,8 C 32,24 32,38 30,54',
      'M 48,10 C 46,24 44,38 38,54',
    ],
    surfaces: {
      buccal: isRight ? 'M 10,48 L 50,48 L 44,60 L 16,60 Z' : 'M 10,48 L 50,48 L 44,60 L 16,60 Z',
      lingual: isRight
        ? 'M 16,84 L 44,84 L 52,94 C 42,97 18,97 8,94 Z'
        : 'M 16,84 L 44,84 L 52,94 C 42,97 18,97 8,94 Z',
      mesial: isRight
        ? 'M 10,48 L 16,60 L 16,84 L 8,94 C 6,80 8,58 10,48 Z'
        : 'M 44,60 L 50,48 C 52,58 54,80 52,94 L 44,84 Z',
      distal: isRight
        ? 'M 44,60 L 50,48 C 52,58 54,80 52,94 L 44,84 Z'
        : 'M 10,48 L 16,60 L 16,84 L 8,94 C 6,80 8,58 10,48 Z',
      occlusal: 'M 16,60 L 44,60 L 44,84 L 16,84 Z',
    },
    implantOutline: 'M 18,48 L 42,48 L 40,16 C 40,12 34,8 30,8 C 26,8 20,12 20,16 Z',
    implantThreads: [
      'M 19,42 L 41,42',
      'M 20,36 L 40,36',
      'M 21,30 L 39,30',
      'M 22,24 L 38,24',
      'M 23,18 L 37,18',
    ],
    crownCapOutline: 'M 8,48 C 6,56 6,78 8,88 C 12,96 48,96 52,88 C 54,78 54,56 52,48 Z',
    apexCenter: { x: 30, y: 7 },
    gumLinePath: 'M 6,48 Q 30,53 54,48',
    fractureCrackPath: 'M 14,50 L 24,66 L 20,74 L 34,92',
  }
}

// ─── LOWER MOLAR (2 Roots: Mesial, Distal) ──────────────────────────────────
function getLowerMolarGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    crownOutline:
      'M 10,52 C 8,44 6,24 8,14 C 10,8 18,4 30,4 C 42,4 50,8 52,14 C 54,24 52,44 50,52 C 44,50 36,51 30,51 C 24,51 16,50 10,52 Z',
    rootOutline:
      'M 12,52 C 10,64 8,80 16,92 C 22,94 25,82 28,64 C 32,82 35,94 44,92 C 52,80 50,64 48,52 Z',
    pulpOutline: 'M 20,22 C 18,28 18,40 20,46 C 24,48 36,48 40,46 C 42,40 42,28 40,22 Z',
    rootCanalPaths: ['M 18,90 C 18,74 20,60 24,46', 'M 42,90 C 42,74 40,60 36,46'],
    surfaces: {
      buccal: isRight
        ? 'M 16,16 L 44,16 L 52,6 C 42,3 18,3 8,6 Z'
        : 'M 16,16 L 44,16 L 52,6 C 42,3 18,3 8,6 Z',
      lingual: isRight ? 'M 10,52 L 50,52 L 44,40 L 16,40 Z' : 'M 10,52 L 50,52 L 44,40 L 16,40 Z',
      mesial: isRight
        ? 'M 8,6 L 16,16 L 16,40 L 10,52 C 8,42 6,20 8,6 Z'
        : 'M 52,6 L 44,16 L 44,40 L 50,52 C 52,42 54,20 52,6 Z',
      distal: isRight
        ? 'M 52,6 L 44,16 L 44,40 L 50,52 C 52,42 54,20 52,6 Z'
        : 'M 8,6 L 16,16 L 16,40 L 10,52 C 8,42 6,20 8,6 Z',
      occlusal: 'M 16,16 L 44,16 L 44,40 L 16,40 Z',
    },
    implantOutline: 'M 18,52 L 42,52 L 40,84 C 40,88 34,92 30,92 C 26,92 20,88 20,84 Z',
    implantThreads: [
      'M 19,58 L 41,58',
      'M 20,64 L 40,64',
      'M 21,70 L 39,70',
      'M 22,76 L 38,76',
      'M 23,82 L 37,82',
    ],
    crownCapOutline: 'M 8,52 C 6,44 6,22 8,12 C 12,4 48,4 52,12 C 54,22 54,44 52,52 Z',
    apexCenter: { x: 30, y: 92 },
    gumLinePath: 'M 6,52 Q 30,47 54,52',
    fractureCrackPath: 'M 14,50 L 24,34 L 20,26 L 34,8',
  }
}

// ─── UPPER PREMOLAR ──────────────────────────────────────────────────────────
function getUpperPremolarGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    rootOutline: 'M 18,48 C 16,34 16,18 24,8 C 28,6 32,6 36,8 C 44,18 44,34 42,48 Z',
    crownOutline:
      'M 14,48 C 12,56 10,76 12,86 C 14,92 22,96 30,96 C 38,96 46,92 48,86 C 50,76 48,56 46,48 Z',
    pulpOutline: 'M 24,54 C 22,60 22,72 24,78 C 26,80 34,80 36,78 C 38,72 38,60 36,54 Z',
    rootCanalPaths: ['M 27,10 C 26,24 26,38 28,54', 'M 33,10 C 34,24 34,38 32,54'],
    surfaces: {
      buccal: 'M 14,48 L 46,48 L 40,60 L 20,60 Z',
      lingual: 'M 20,84 L 40,84 L 48,94 C 40,97 20,97 12,94 Z',
      mesial: isRight
        ? 'M 14,48 L 20,60 L 20,84 L 12,94 C 10,80 12,58 14,48 Z'
        : 'M 40,60 L 46,48 C 48,58 50,80 48,94 L 40,84 Z',
      distal: isRight
        ? 'M 40,60 L 46,48 C 48,58 50,80 48,94 L 40,84 Z'
        : 'M 14,48 L 20,60 L 20,84 L 12,94 C 10,80 12,58 14,48 Z',
      occlusal: 'M 20,60 L 40,60 L 40,84 L 20,84 Z',
    },
    implantOutline: 'M 20,48 L 40,48 L 38,16 C 38,12 34,8 30,8 C 26,8 22,12 22,16 Z',
    implantThreads: ['M 21,42 L 39,42', 'M 22,36 L 38,36', 'M 23,30 L 37,30', 'M 24,24 L 36,24'],
    crownCapOutline: 'M 12,48 C 10,56 10,78 12,88 C 16,96 44,96 48,88 C 50,78 50,56 48,48 Z',
    apexCenter: { x: 30, y: 7 },
    gumLinePath: 'M 10,48 Q 30,52 50,48',
    fractureCrackPath: 'M 18,50 L 28,66 L 24,74 L 38,92',
  }
}

// ─── LOWER PREMOLAR ──────────────────────────────────────────────────────────
function getLowerPremolarGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    crownOutline:
      'M 14,52 C 12,44 10,24 12,14 C 14,8 22,4 30,4 C 38,4 46,8 48,14 C 50,24 48,44 46,52 Z',
    rootOutline: 'M 18,52 C 16,66 16,82 24,92 C 28,94 32,94 36,92 C 44,82 44,66 42,52 Z',
    pulpOutline: 'M 24,22 C 22,28 22,40 24,46 C 26,48 34,48 36,46 C 38,40 38,28 36,22 Z',
    rootCanalPaths: ['M 27,90 C 26,76 26,62 28,46', 'M 33,90 C 34,76 34,62 32,46'],
    surfaces: {
      buccal: 'M 20,16 L 40,16 L 48,6 C 40,3 20,3 12,6 Z',
      lingual: 'M 14,52 L 46,52 L 40,40 L 20,40 Z',
      mesial: isRight
        ? 'M 12,6 L 20,16 L 20,40 L 14,52 C 12,42 10,20 12,6 Z'
        : 'M 48,6 L 40,16 L 40,40 L 46,52 C 48,42 50,20 48,6 Z',
      distal: isRight
        ? 'M 48,6 L 40,16 L 40,40 L 46,52 C 48,42 50,20 48,6 Z'
        : 'M 12,6 L 20,16 L 20,40 L 14,52 C 12,42 10,20 12,6 Z',
      occlusal: 'M 20,16 L 40,16 L 40,40 L 20,40 Z',
    },
    implantOutline: 'M 20,52 L 40,52 L 38,84 C 38,88 34,92 30,92 C 26,92 22,88 22,84 Z',
    implantThreads: ['M 21,58 L 39,58', 'M 22,64 L 38,64', 'M 23,70 L 37,70', 'M 24,76 L 36,76'],
    crownCapOutline: 'M 12,52 C 10,44 10,22 12,12 C 16,4 44,4 48,12 C 50,22 50,44 48,52 Z',
    apexCenter: { x: 30, y: 92 },
    gumLinePath: 'M 10,52 Q 30,48 50,52',
    fractureCrackPath: 'M 18,50 L 28,34 L 24,26 L 38,8',
  }
}

// ─── UPPER CANINE ────────────────────────────────────────────────────────────
function getUpperCanineGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    rootOutline: 'M 20,48 C 18,32 20,16 28,6 C 30,4 32,4 34,6 C 42,16 42,32 40,48 Z',
    crownOutline:
      'M 16,48 C 14,58 14,76 18,86 C 22,92 28,96 30,97 C 32,96 38,92 42,86 C 46,76 46,58 44,48 Z',
    pulpOutline: 'M 26,54 C 24,62 24,72 26,80 L 30,86 L 34,80 C 36,72 36,62 34,54 Z',
    rootCanalPaths: ['M 30,6 C 29,22 29,38 30,54'],
    surfaces: {
      buccal: 'M 16,48 L 44,48 L 38,60 L 22,60 Z',
      lingual: 'M 22,82 L 38,82 L 42,88 L 30,96 L 18,88 Z',
      mesial: isRight
        ? 'M 16,48 L 22,60 L 22,82 L 18,88 C 16,78 14,60 16,48 Z'
        : 'M 38,60 L 44,48 C 46,60 46,78 42,88 L 38,82 Z',
      distal: isRight
        ? 'M 38,60 L 44,48 C 46,60 46,78 42,88 L 38,82 Z'
        : 'M 16,48 L 22,60 L 22,82 L 18,88 C 16,78 14,60 16,48 Z',
      occlusal: 'M 22,60 L 38,60 L 38,82 L 22,82 Z',
    },
    implantOutline: 'M 22,48 L 38,48 L 36,14 C 36,10 32,6 30,6 C 28,6 24,10 24,14 Z',
    implantThreads: ['M 23,42 L 37,42', 'M 24,36 L 36,36', 'M 25,30 L 35,30', 'M 26,24 L 34,24'],
    crownCapOutline: 'M 14,48 C 12,58 12,78 16,88 L 30,97 L 44,88 C 48,78 48,58 46,48 Z',
    apexCenter: { x: 30, y: 5 },
    gumLinePath: 'M 12,48 Q 30,52 48,48',
    fractureCrackPath: 'M 20,50 L 30,68 L 26,76 L 38,94',
  }
}

// ─── LOWER CANINE ────────────────────────────────────────────────────────────
function getLowerCanineGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    crownOutline:
      'M 16,52 C 14,42 14,24 18,14 C 22,8 28,4 30,3 C 32,4 38,8 42,14 C 46,24 46,42 44,52 Z',
    rootOutline: 'M 20,52 C 18,68 20,84 28,94 C 30,96 32,96 34,94 C 42,84 42,68 40,52 Z',
    pulpOutline: 'M 26,46 C 24,38 24,28 26,20 L 30,14 L 34,20 C 36,28 36,38 34,46 Z',
    rootCanalPaths: ['M 30,94 C 29,78 29,62 30,46'],
    surfaces: {
      buccal: 'M 22,18 L 38,18 L 42,12 L 30,4 L 18,12 Z',
      lingual: 'M 16,52 L 44,52 L 38,40 L 22,40 Z',
      mesial: isRight
        ? 'M 18,12 L 22,18 L 22,40 L 16,52 C 14,40 16,22 18,12 Z'
        : 'M 42,12 L 38,18 L 38,40 L 44,52 C 46,40 44,22 42,12 Z',
      distal: isRight
        ? 'M 42,12 L 38,18 L 38,40 L 44,52 C 46,40 44,22 42,12 Z'
        : 'M 18,12 L 22,18 L 22,40 L 16,52 C 14,40 16,22 18,12 Z',
      occlusal: 'M 22,18 L 38,18 L 38,40 L 22,40 Z',
    },
    implantOutline: 'M 22,52 L 38,52 L 36,86 C 36,90 32,94 30,94 C 28,94 24,90 24,86 Z',
    implantThreads: ['M 23,58 L 37,58', 'M 24,64 L 36,64', 'M 25,70 L 35,70', 'M 26,76 L 34,76'],
    crownCapOutline: 'M 14,52 C 12,42 12,22 16,12 L 30,3 L 44,12 C 48,22 48,42 46,52 Z',
    apexCenter: { x: 30, y: 95 },
    gumLinePath: 'M 12,52 Q 30,48 48,52',
    fractureCrackPath: 'M 20,50 L 30,32 L 26,24 L 38,6',
  }
}

// ─── UPPER INCISOR ───────────────────────────────────────────────────────────
function getUpperIncisorGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    rootOutline: 'M 20,48 C 18,34 22,18 28,8 C 30,6 32,6 34,8 C 40,18 42,34 40,48 Z',
    crownOutline:
      'M 16,48 C 14,58 14,76 16,86 C 18,92 24,94 30,94 C 36,94 42,92 44,86 C 46,76 46,58 44,48 Z',
    pulpOutline: 'M 26,54 C 24,62 24,74 26,82 C 28,84 32,84 34,82 C 36,74 36,62 34,54 Z',
    rootCanalPaths: ['M 30,8 C 29,24 29,38 30,54'],
    surfaces: {
      buccal: 'M 16,48 L 44,48 L 38,60 L 22,60 Z',
      lingual: 'M 22,82 L 38,82 L 44,92 C 36,95 24,95 16,92 Z',
      mesial: isRight
        ? 'M 16,48 L 22,60 L 22,82 L 16,92 C 14,78 14,60 16,48 Z'
        : 'M 38,60 L 44,48 C 46,60 46,78 44,92 L 38,82 Z',
      distal: isRight
        ? 'M 38,60 L 44,48 C 46,60 46,78 44,92 L 38,82 Z'
        : 'M 16,48 L 22,60 L 22,82 L 16,92 C 14,78 14,60 16,48 Z',
      occlusal: 'M 22,60 L 38,60 L 38,82 L 22,82 Z',
    },
    implantOutline: 'M 22,48 L 38,48 L 36,16 C 36,12 32,8 30,8 C 28,8 24,12 24,16 Z',
    implantThreads: ['M 23,42 L 37,42', 'M 24,36 L 36,36', 'M 25,30 L 35,30', 'M 26,24 L 34,24'],
    crownCapOutline: 'M 14,48 C 12,58 12,78 14,88 C 18,95 42,95 46,88 C 48,78 48,58 46,48 Z',
    apexCenter: { x: 30, y: 7 },
    gumLinePath: 'M 12,48 Q 30,52 48,48',
    fractureCrackPath: 'M 18,50 L 30,68 L 24,76 L 38,92',
  }
}

// ─── LOWER INCISOR ───────────────────────────────────────────────────────────
function getLowerIncisorGeometry(isRight: boolean): ToothGeometryPaths {
  return {
    crownOutline:
      'M 16,52 C 14,42 14,24 16,14 C 18,8 24,6 30,6 C 36,6 42,8 44,14 C 46,24 46,42 44,52 Z',
    rootOutline: 'M 20,52 C 18,66 22,82 28,92 C 30,94 32,94 34,92 C 40,82 42,66 40,52 Z',
    pulpOutline: 'M 26,46 C 24,38 24,26 26,18 C 28,16 32,16 34,18 C 36,26 36,38 34,46 Z',
    rootCanalPaths: ['M 30,92 C 29,76 29,62 30,46'],
    surfaces: {
      buccal: 'M 22,18 L 38,18 L 44,8 C 36,5 24,5 16,8 Z',
      lingual: 'M 16,52 L 44,52 L 38,40 L 22,40 Z',
      mesial: isRight
        ? 'M 16,8 L 22,18 L 22,40 L 16,52 C 14,42 14,22 16,8 Z'
        : 'M 44,8 L 38,18 L 38,40 L 44,52 C 46,42 46,22 44,8 Z',
      distal: isRight
        ? 'M 44,8 L 38,18 L 38,40 L 44,52 C 46,42 46,22 44,8 Z'
        : 'M 16,8 L 22,18 L 22,40 L 16,52 C 14,42 14,22 16,8 Z',
      occlusal: 'M 22,18 L 38,18 L 38,40 L 22,40 Z',
    },
    implantOutline: 'M 22,52 L 38,52 L 36,84 C 36,88 32,92 30,92 C 28,92 24,88 24,84 Z',
    implantThreads: ['M 23,58 L 37,58', 'M 24,64 L 36,64', 'M 25,70 L 35,70', 'M 26,76 L 34,76'],
    crownCapOutline: 'M 14,52 C 12,42 12,22 14,12 C 18,5 42,5 46,12 C 48,22 48,42 46,52 Z',
    apexCenter: { x: 30, y: 93 },
    gumLinePath: 'M 12,52 Q 30,48 48,52',
    fractureCrackPath: 'M 18,50 L 30,32 L 24,24 L 38,8',
  }
}

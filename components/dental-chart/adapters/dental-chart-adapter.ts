/**
 * Clean-room Dental Chart Data Adapter for DenToRa
 *
 * Converts server-side DentalChartEntry rows to reactive ToothViewModel structures
 * and handles condition configurations, colors, statistics, and FDI quadrant mappings.
 */

import {
  ToothViewModel,
  DentalChartEntryRecord,
  DentalCondition,
  SeverityLevel,
  ToothAnatomyGroup,
  ToothPosition,
  ToothSide,
  ToothSpecificType,
  ToothConditionConfigItem,
} from '../types/odontogram'
import { getToothSpecificType } from '../geometry/tooth-paths'

// ─── FDI TOOTH NUMBERING DEFINITIONS ─────────────────────────────────────────

export const FDI_QUADRANTS = {
  Q1: [18, 17, 16, 15, 14, 13, 12, 11], // Upper Right (Maxillary Right)
  Q2: [21, 22, 23, 24, 25, 26, 27, 28], // Upper Left (Maxillary Left)
  Q3: [38, 37, 36, 35, 34, 33, 32, 31], // Lower Left (Mandibular Left)
  Q4: [41, 42, 43, 44, 45, 46, 47, 48], // Lower Right (Mandibular Right)
} as const

export const ALL_FDI_TEETH: number[] = [
  ...FDI_QUADRANTS.Q1,
  ...FDI_QUADRANTS.Q2,
  ...FDI_QUADRANTS.Q4,
  ...FDI_QUADRANTS.Q3,
]

export const TOOTH_NAMES: Record<number, string> = {
  // Quadrant 1 - Maxillary Right
  18: 'Upper Right Third Molar (Wisdom)',
  17: 'Upper Right Second Molar',
  16: 'Upper Right First Molar',
  15: 'Upper Right Second Premolar',
  14: 'Upper Right First Premolar',
  13: 'Upper Right Canine (Cuspid)',
  12: 'Upper Right Lateral Incisor',
  11: 'Upper Right Central Incisor',

  // Quadrant 2 - Maxillary Left
  21: 'Upper Left Central Incisor',
  22: 'Upper Left Lateral Incisor',
  23: 'Upper Left Canine (Cuspid)',
  24: 'Upper Left First Premolar',
  25: 'Upper Left Second Premolar',
  26: 'Upper Left First Molar',
  27: 'Upper Left Second Molar',
  28: 'Upper Left Third Molar (Wisdom)',

  // Quadrant 3 - Mandibular Left
  31: 'Lower Left Central Incisor',
  32: 'Lower Left Lateral Incisor',
  33: 'Lower Left Canine (Cuspid)',
  34: 'Lower Left First Premolar',
  35: 'Lower Left Second Premolar',
  36: 'Lower Left First Molar',
  37: 'Lower Left Second Molar',
  38: 'Lower Left Third Molar (Wisdom)',

  // Quadrant 4 - Mandibular Right
  41: 'Lower Right Central Incisor',
  42: 'Lower Right Lateral Incisor',
  43: 'Lower Right Canine (Cuspid)',
  44: 'Lower Right First Premolar',
  45: 'Lower Right Second Premolar',
  46: 'Lower Right First Molar',
  47: 'Lower Right Second Molar',
  48: 'Lower Right Third Molar (Wisdom)',
}

// ─── ANATOMICAL GROUP CLASSIFICATION ─────────────────────────────────────────

export function getToothAnatomyGroup(toothNumber: number): ToothAnatomyGroup {
  const lastDigit = toothNumber % 10
  if (lastDigit === 1 || lastDigit === 2) return 'incisor'
  if (lastDigit === 3) return 'canine'
  if (lastDigit === 4 || lastDigit === 5) return 'premolar'
  return 'molar'
}

export function getToothPosition(toothNumber: number): ToothPosition {
  const firstDigit = Math.floor(toothNumber / 10)
  return firstDigit === 1 || firstDigit === 2 ? 'upper' : 'lower'
}

export function getToothSide(toothNumber: number): ToothSide {
  const firstDigit = Math.floor(toothNumber / 10)
  return firstDigit === 1 || firstDigit === 4 ? 'right' : 'left'
}

export function getToothQuadrant(toothNumber: number): 1 | 2 | 3 | 4 {
  const firstDigit = Math.floor(toothNumber / 10)
  if (firstDigit >= 1 && firstDigit <= 4) {
    return firstDigit as 1 | 2 | 3 | 4
  }
  return 1
}

export function getToothRootCanalCounts(toothNumber: number): {
  rootCount: number
  canalCount: number
} {
  const lastDigit = toothNumber % 10
  const isUpper = Math.floor(toothNumber / 10) <= 2

  if (lastDigit === 1 || lastDigit === 2 || lastDigit === 3) {
    return { rootCount: 1, canalCount: 1 }
  }
  if (lastDigit === 4) {
    return isUpper ? { rootCount: 2, canalCount: 2 } : { rootCount: 1, canalCount: 1 }
  }
  if (lastDigit === 5) {
    return isUpper ? { rootCount: 1, canalCount: 2 } : { rootCount: 1, canalCount: 1 }
  }
  if (lastDigit === 6) {
    return isUpper ? { rootCount: 3, canalCount: 4 } : { rootCount: 2, canalCount: 3 }
  }
  if (lastDigit === 7) {
    return isUpper ? { rootCount: 3, canalCount: 3 } : { rootCount: 2, canalCount: 3 }
  }
  if (lastDigit === 8) {
    return isUpper ? { rootCount: 1, canalCount: 3 } : { rootCount: 1, canalCount: 2 }
  }
  return { rootCount: 1, canalCount: 1 }
}

// ─── CONDITION CONFIGURATION ─────────────────────────────────────────────────

export const DENTAL_CONDITION_CONFIG: Record<DentalCondition, ToothConditionConfigItem> = {
  HEALTHY: {
    label: 'Healthy',
    color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
    fillColor: '#10b981',
    borderColor: '#059669',
    description: 'Normal anatomical tooth structure with intact enamel',
    category: 'healthy',
  },
  CARIES: {
    label: 'Caries',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-50 dark:bg-red-950/40',
    fillColor: '#ef4444',
    borderColor: '#dc2626',
    description: 'Active carious lesion or enamel dedemineralization',
    category: 'restorative',
  },
  FILLED: {
    label: 'Filled',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40',
    fillColor: '#3b82f6',
    borderColor: '#2563eb',
    description: 'Composite resin or amalgam restoration',
    category: 'restorative',
  },
  CROWN: {
    label: 'Crown',
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    fillColor: '#f59e0b',
    borderColor: '#d97706',
    description: 'Full anatomical coverage crown (ceramic, zirconia, PFM)',
    category: 'prosthodontic',
  },
  BRIDGE: {
    label: 'Bridge',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-50 dark:bg-purple-950/40',
    fillColor: '#8b5cf6',
    borderColor: '#7c3aed',
    description: 'Fixed partial denture abutment or pontic unit',
    category: 'prosthodontic',
  },
  IMPLANT: {
    label: 'Implant',
    color: 'text-cyan-700 dark:text-cyan-300',
    bgColor: 'bg-cyan-50 dark:bg-cyan-950/40',
    fillColor: '#06b6d4',
    borderColor: '#0891b2',
    description: 'Osseointegrated endosseous fixture replacing root',
    category: 'surgical',
  },
  ROOT_CANAL: {
    label: 'Root Canal',
    color: 'text-pink-700 dark:text-pink-300',
    bgColor: 'bg-pink-50 dark:bg-pink-950/40',
    fillColor: '#ec4899',
    borderColor: '#db2777',
    description: 'Endodontic pulpectomy and obturation',
    category: 'endodontic',
  },
  EXTRACTION: {
    label: 'Extracted',
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-100 dark:bg-slate-900/50',
    fillColor: '#64748b',
    borderColor: '#475569',
    description: 'Surgically extracted tooth socket',
    category: 'surgical',
  },
  EXTRACTION_NEEDED: {
    label: 'Extraction Needed',
    color: 'text-orange-700 dark:text-orange-300',
    bgColor: 'bg-orange-50 dark:bg-orange-950/40',
    fillColor: '#f97316',
    borderColor: '#ea580c',
    description: 'Severely compromised tooth indicated for extraction',
    category: 'surgical',
  },
  MISSING: {
    label: 'Missing',
    color: 'text-zinc-600 dark:text-zinc-400',
    bgColor: 'bg-zinc-100 dark:bg-zinc-900/40',
    fillColor: '#a1a1aa',
    borderColor: '#71717a',
    description: 'Congenitally absent or un-erupted tooth',
    category: 'healthy',
  },
  FRACTURED: {
    label: 'Fractured',
    color: 'text-rose-700 dark:text-rose-300',
    bgColor: 'bg-rose-50 dark:bg-rose-950/40',
    fillColor: '#e11d48',
    borderColor: '#be123c',
    description: 'Structural fracture across coronal enamel or root',
    category: 'restorative',
  },
  SENSITIVE: {
    label: 'Sensitive',
    color: 'text-sky-700 dark:text-sky-300',
    bgColor: 'bg-sky-50 dark:bg-sky-950/40',
    fillColor: '#0ea5e9',
    borderColor: '#0284c7',
    description: 'Exposed cervical dentin with thermal sensitivity',
    category: 'periodontic',
  },
  MOBILITY: {
    label: 'Mobility',
    color: 'text-indigo-700 dark:text-indigo-300',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/40',
    fillColor: '#6366f1',
    borderColor: '#4f46e5',
    description: 'Horizontal or vertical periodontal ligament laxity',
    category: 'periodontic',
  },
  ABSCESS: {
    label: 'Abscess',
    color: 'text-yellow-800 dark:text-yellow-300',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/40',
    fillColor: '#eab308',
    borderColor: '#ca8a04',
    description: 'Periapical radiolucency / apical acute inflammation',
    category: 'endodontic',
  },
  PERIODONTAL: {
    label: 'Periodontal',
    color: 'text-teal-700 dark:text-teal-300',
    bgColor: 'bg-teal-50 dark:bg-teal-950/40',
    fillColor: '#14b8a6',
    borderColor: '#0d9488',
    description: 'Alveolar bone resorption and deep periodontal pockets',
    category: 'periodontic',
  },
  VENEER: {
    label: 'Veneer',
    color: 'text-violet-700 dark:text-violet-300',
    bgColor: 'bg-violet-50 dark:bg-violet-950/40',
    fillColor: '#8b5cf6',
    borderColor: '#7c3aed',
    description: 'Facial porcelain or composite cosmetic laminate',
    category: 'prosthodontic',
  },
}

// ─── VIEW MODEL CONVERSION ADAPTER ───────────────────────────────────────────

export function buildToothViewModels(
  chartData: Record<number, DentalChartEntryRecord[]> | DentalChartEntryRecord[]
): Record<number, ToothViewModel> {
  // Normalize chartData to a map
  const entriesByTooth: Record<number, DentalChartEntryRecord[]> = {}

  if (Array.isArray(chartData)) {
    for (const entry of chartData) {
      if (!entriesByTooth[entry.toothNumber]) {
        entriesByTooth[entry.toothNumber] = []
      }
      entriesByTooth[entry.toothNumber].push(entry)
    }
  } else {
    for (const [key, entries] of Object.entries(chartData)) {
      const toothNum = parseInt(key, 10)
      if (!isNaN(toothNum)) {
        entriesByTooth[toothNum] = entries || []
      }
    }
  }

  const result: Record<number, ToothViewModel> = {}

  for (const toothNumber of ALL_FDI_TEETH) {
    const toothEntries = entriesByTooth[toothNumber] || []
    const activeEntry = toothEntries.find((e) => !e.resolvedDate)

    const condition = (activeEntry?.condition as DentalCondition) || 'HEALTHY'
    const severity = (activeEntry?.severity as SeverityLevel) || 'MILD'
    const counts = getToothRootCanalCounts(toothNumber)

    const surfaces = {
      mesial: !!activeEntry?.mesial,
      distal: !!activeEntry?.distal,
      occlusal: !!activeEntry?.occlusal,
      buccal: !!activeEntry?.buccal,
      lingual: !!activeEntry?.lingual,
    }

    result[toothNumber] = {
      number: toothNumber,
      fdiNotation: String(toothNumber),
      name: TOOTH_NAMES[toothNumber] || `Tooth ${toothNumber}`,
      group: getToothAnatomyGroup(toothNumber),
      specificType: getToothSpecificType(toothNumber),
      position: getToothPosition(toothNumber),
      side: getToothSide(toothNumber),
      quadrant: getToothQuadrant(toothNumber),
      rootCount: counts.rootCount,
      canalCount: counts.canalCount,
      activeEntry,
      condition,
      severity,
      surfaces,
      history: toothEntries,
      isMissing: condition === 'MISSING' || condition === 'EXTRACTION',
      isImplant: condition === 'IMPLANT',
      isCrown: condition === 'CROWN',
      isBridge: condition === 'BRIDGE',
      isRootCanal: condition === 'ROOT_CANAL',
      isFractured: condition === 'FRACTURED',
      hasAbscess: condition === 'ABSCESS',
      hasPeriodontal: condition === 'PERIODONTAL',
      hasMobility: condition === 'MOBILITY',
      hasSensitivity: condition === 'SENSITIVE',
    }
  }

  return result
}

// ─── STATISTICAL AGGREGATION ─────────────────────────────────────────────────

export interface OdontogramSummaryStats {
  totalTeeth: number
  presentTeeth: number
  healthyTeeth: number
  cariesTeeth: number
  filledTeeth: number
  crownTeeth: number
  implantTeeth: number
  rootCanalTeeth: number
  missingTeeth: number
  periodontalTeeth: number
}

export function calculateOdontogramStats(
  viewModels: Record<number, ToothViewModel>
): OdontogramSummaryStats {
  const models = Object.values(viewModels)

  let present = 0
  let healthy = 0
  let caries = 0
  let filled = 0
  let crown = 0
  let implant = 0
  let rootCanal = 0
  let missing = 0
  let periodontal = 0

  for (const tooth of models) {
    if (tooth.isMissing) {
      missing++
    } else {
      present++
      if (tooth.condition === 'HEALTHY') healthy++
      if (tooth.condition === 'CARIES') caries++
      if (tooth.condition === 'FILLED') filled++
      if (tooth.condition === 'CROWN') crown++
      if (tooth.condition === 'IMPLANT') implant++
      if (tooth.condition === 'ROOT_CANAL') rootCanal++
      if (tooth.condition === 'PERIODONTAL' || tooth.condition === 'MOBILITY') periodontal++
    }
  }

  return {
    totalTeeth: 32,
    presentTeeth: present,
    healthyTeeth: healthy,
    cariesTeeth: caries,
    filledTeeth: filled,
    crownTeeth: crown,
    implantTeeth: implant,
    rootCanalTeeth: rootCanal,
    missingTeeth: missing,
    periodontalTeeth: periodontal,
  }
}

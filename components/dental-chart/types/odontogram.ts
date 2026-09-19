/**
 * Clean-room Odontogram Type Definitions for DenToRa
 */

export type ToothPosition = 'upper' | 'lower'
export type ToothSide = 'right' | 'left'
export type ToothAnatomyGroup = 'incisor' | 'canine' | 'premolar' | 'molar'

export type ToothSurfaceKey = 'mesial' | 'distal' | 'occlusal' | 'buccal' | 'lingual'

export type DentalCondition =
  | 'HEALTHY'
  | 'CARIES'
  | 'FILLED'
  | 'CROWN'
  | 'BRIDGE'
  | 'IMPLANT'
  | 'ROOT_CANAL'
  | 'EXTRACTION'
  | 'EXTRACTION_NEEDED'
  | 'MISSING'
  | 'FRACTURED'
  | 'SENSITIVE'
  | 'MOBILITY'
  | 'ABSCESS'
  | 'PERIODONTAL'
  | 'VENEER'

export type SeverityLevel = 'MILD' | 'MODERATE' | 'SEVERE'

export interface DentalChartEntryRecord {
  id: string
  patientId: string
  hospitalId: string
  toothNumber: number
  toothNotation: string
  condition: string
  severity: string
  mesial: boolean
  distal: boolean
  occlusal: boolean
  buccal: boolean
  lingual: boolean
  notes?: string | null
  diagnosedDate: string | Date
  resolvedDate?: string | Date | null
  createdAt?: string | Date
  updatedAt?: string | Date
  recordedBy?: {
    firstName: string
    lastName: string
  }
}

export interface ToothViewModel {
  number: number
  fdiNotation: string
  name: string
  group: ToothAnatomyGroup
  position: ToothPosition
  side: ToothSide
  quadrant: 1 | 2 | 3 | 4
  activeEntry?: DentalChartEntryRecord
  condition: DentalCondition
  severity: SeverityLevel
  surfaces: {
    mesial: boolean
    distal: boolean
    occlusal: boolean
    buccal: boolean
    lingual: boolean
  }
  history: DentalChartEntryRecord[]
  isMissing: boolean
  isImplant: boolean
  isCrown: boolean
  isBridge: boolean
  isRootCanal: boolean
  isFractured: boolean
  hasAbscess: boolean
  hasPeriodontal: boolean
  hasMobility: boolean
  hasSensitivity: boolean
}

export interface OdontogramProps {
  patientId: string
  chartData?: Record<number, DentalChartEntryRecord[]>
  entries?: DentalChartEntryRecord[]
  selectedTeeth?: number[]
  onToothClick?: (toothNumber: number, entry?: DentalChartEntryRecord) => void
  onTeethSelect?: (teeth: number[]) => void
  onEntrySaved?: () => void
  editable?: boolean
  interactive?: boolean
  showStats?: boolean
  showLegend?: boolean
  mode?: 'clinical' | 'selection'
}

export interface ToothConditionConfigItem {
  label: string
  color: string
  bgColor: string
  fillColor: string
  borderColor: string
  description: string
  category: 'healthy' | 'restorative' | 'endodontic' | 'prosthodontic' | 'periodontic' | 'surgical'
}

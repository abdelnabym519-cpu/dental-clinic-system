'use client'

import React from 'react'
import { Odontogram } from './odontogram/Odontogram'
import {
  OdontogramProps,
  DentalChartEntryRecord,
  DentalCondition,
  ToothViewModel,
} from './types/odontogram'

export interface DentalChartProps extends OdontogramProps {}

export function DentalChart(props: DentalChartProps) {
  return <Odontogram {...props} />
}

export { Odontogram }
export type { DentalChartEntryRecord, DentalCondition, ToothViewModel }

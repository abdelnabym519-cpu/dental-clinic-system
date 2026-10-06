/**
 * DenToRa — Interactive Dental Chart: clinical treatment-status derivation.
 *
 * Pure mapping from existing domain records (Phase-3 findings + Phase-11
 * treatment plan items) to the six canonical visual states of the chart.
 * Both the client workspace and the summary API import THIS module — one
 * canonical derivation, never duplicated.
 */

export type ToothTreatmentStatus =
  | 'healthy'
  | 'affected'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'missing'

/** Chart palette (contract from the clinical spec — do not change casually). */
export const TOOTH_COLORS: Record<ToothTreatmentStatus, string> = {
  healthy: '#22c55e',
  affected: '#ef4444',
  planned: '#f59e0b',
  in_progress: '#3b82f6',
  completed: '#8b5cf6',
  missing: '#9ca3af',
}

/** Minimal structural subset accepted from any caller (API rows or view models). */
export interface StatusFindingRef {
  condition: string
  resolvedDate?: string | Date | null
}

export interface StatusProcedureRef {
  status: string // TreatmentPlanItemStatus
}

/** DB conditions that mean the tooth is not present in the mouth. */
const MISSING_CONDITIONS = new Set(['MISSING', 'EXTRACTION'])

/**
 * Derive the visual status of one tooth.
 *
 * Precedence (highest first): missing → completed → in_progress → planned →
 * affected → healthy. Resolved findings (resolvedDate set) are ignored —
 * callers may pass the full history; the derivation is history-safe.
 */
export function deriveToothStatus(
  findings: readonly StatusFindingRef[],
  procedures: readonly StatusProcedureRef[]
): ToothTreatmentStatus {
  const activeFindings = findings.filter((f) => !f.resolvedDate)

  if (activeFindings.some((f) => MISSING_CONDITIONS.has(f.condition))) return 'missing'

  const statuses = procedures.map((p) => p.status)
  if (statuses.includes('COMPLETED')) return 'completed'
  if (statuses.includes('IN_PROGRESS') || statuses.includes('SCHEDULED')) return 'in_progress'
  if (statuses.includes('PENDING')) return 'planned'

  if (activeFindings.some((f) => f.condition !== 'HEALTHY')) return 'affected'

  return 'healthy'
}

/** Derive the status for every tooth from full chart payloads. */
export function deriveStatusMap(
  entriesByTooth: ReadonlyMap<number, readonly StatusFindingRef[]>,
  proceduresByTooth: ReadonlyMap<number, readonly StatusProcedureRef[]>
): Record<number, ToothTreatmentStatus> {
  const teeth = new Set<number>([...entriesByTooth.keys(), ...proceduresByTooth.keys()])
  const out: Record<number, ToothTreatmentStatus> = {}
  for (const t of teeth) {
    out[t] = deriveToothStatus(entriesByTooth.get(t) ?? [], proceduresByTooth.get(t) ?? [])
  }
  return out
}

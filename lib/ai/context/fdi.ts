/**
 * Phase 2 — FDI tooth helpers (server-side).
 *
 * Thin adapter over the SINGLE canonical FDI rule set in
 * `lib/dental-chart/fdi.ts`. Tooth validation is deliberately NOT duplicated
 * here: `isValidFdi` is re-exported from the shared module so permanent
 * (11–48) and primary (51–85) identifiers are accepted and rejected
 * identically by the chart layer and the AI context layer.
 *
 * Reuses the application's existing FDI representation
 * (`DentalChartEntry.toothNumber` = FDI int). No second numbering system.
 */
import { isValidFdi, quadrantOf as sharedQuadrantOf } from '@/lib/dental-chart/fdi'
import type { FdiQuadrant } from '@/lib/dental-chart/fdi'

// Re-exported so the server-side AI layer and the chart layer can never
// drift: there is exactly one FDI validator in the codebase.
export { isValidFdi }
export type {
  FdiDentition,
  FdiQuadrant,
  ToothArch,
  ToothGroup,
  ToothSideRL,
} from '@/lib/dental-chart/fdi'

/**
 * Permanent arch layout only — this table feeds permanent-dentition display
 * order. Primary quadrants (5–8) are not modelled here; use
 * `FDI_TEETH_PRIMARY` from the shared module for primary identifiers.
 */
export const FDI_QUADRANTS: Record<1 | 2 | 3 | 4, number[]> = {
  1: [18, 17, 16, 15, 14, 13, 12, 11], // Upper Right (Maxillary Right)
  2: [21, 22, 23, 24, 25, 26, 27, 28], // Upper Left (Maxillary Left)
  3: [31, 32, 33, 34, 35, 36, 37, 38], // Lower Left (Mandibular Left)
  4: [41, 42, 43, 44, 45, 46, 47, 48], // Lower Right (Mandibular Right)
}

export const TOOTH_NAMES: Record<number, string> = {
  11: 'Upper Right Central Incisor',
  12: 'Upper Right Lateral Incisor',
  13: 'Upper Right Canine',
  14: 'Upper Right First Premolar',
  15: 'Upper Right Second Premolar',
  16: 'Upper Right First Molar',
  17: 'Upper Right Second Molar',
  18: 'Upper Right Third Molar (Wisdom)',
  21: 'Upper Left Central Incisor',
  22: 'Upper Left Lateral Incisor',
  23: 'Upper Left Canine',
  24: 'Upper Left First Premolar',
  25: 'Upper Left Second Premolar',
  26: 'Upper Left First Molar',
  27: 'Upper Left Second Molar',
  28: 'Upper Left Third Molar (Wisdom)',
  31: 'Lower Left Central Incisor',
  32: 'Lower Left Lateral Incisor',
  33: 'Lower Left Canine',
  34: 'Lower Left First Premolar',
  35: 'Lower Left Second Premolar',
  36: 'Lower Left First Molar',
  37: 'Lower Left Second Molar',
  38: 'Lower Left Third Molar (Wisdom)',
  41: 'Lower Right Central Incisor',
  42: 'Lower Right Lateral Incisor',
  43: 'Lower Right Canine',
  44: 'Lower Right First Premolar',
  45: 'Lower Right Second Premolar',
  46: 'Lower Right First Molar',
  47: 'Lower Right Second Molar',
  48: 'Lower Right Third Molar (Wisdom)',
  // Primary (deciduous) dentition — 51–55, 61–65, 71–75, 81–85.
  51: 'Primary Upper Right Central Incisor',
  52: 'Primary Upper Right Lateral Incisor',
  53: 'Primary Upper Right Canine',
  54: 'Primary Upper Right First Molar',
  55: 'Primary Upper Right Second Molar',
  61: 'Primary Upper Left Central Incisor',
  62: 'Primary Upper Left Lateral Incisor',
  63: 'Primary Upper Left Canine',
  64: 'Primary Upper Left First Molar',
  65: 'Primary Upper Left Second Molar',
  71: 'Primary Lower Left Central Incisor',
  72: 'Primary Lower Left Lateral Incisor',
  73: 'Primary Lower Left Canine',
  74: 'Primary Lower Left First Molar',
  75: 'Primary Lower Left Second Molar',
  81: 'Primary Lower Right Central Incisor',
  82: 'Primary Lower Right Lateral Incisor',
  83: 'Primary Lower Right Canine',
  84: 'Primary Lower Right First Molar',
  85: 'Primary Lower Right Second Molar',
}

/** Human-readable clinical name; falls back to a neutral label. */
export function toothName(fdi: number): string {
  return TOOTH_NAMES[fdi] ?? `Tooth ${fdi}`
}

/**
 * Quadrant of a valid FDI number (1–4 permanent, 5–8 primary), or null when
 * the input is not a valid FDI identifier. Contract preserved from the
 * original implementation: this helper reports, it never throws — unlike the
 * shared `quadrantOf`, which throws to avoid silently mislabelling a tooth.
 */
export function quadrantOf(fdi: number): FdiQuadrant | null {
  return isValidFdi(fdi) ? sharedQuadrantOf(fdi) : null
}

/**
 * Parse the free-text `toothNumbers` column (e.g. "36, 46" / "36 46" /
 * "tooth 36") into unique valid FDI ints, in order of first appearance.
 * Invalid tokens are dropped — never guessed.
 */
export function parseToothNumbers(raw: string | null | undefined): number[] {
  if (!raw) return []
  const tokens = raw.split(/[^0-9]+/).filter(Boolean)
  const out: number[] = []
  for (const t of tokens) {
    const n = Number(t)
    if (isValidFdi(n) && !out.includes(n)) out.push(n)
  }
  return out
}

/**
 * Deterministic FDI sort (arch order):
 *   permanent 18..11, 21..28, 38..31, 41..48
 *   primary   55..51, 61..65, 75..71, 81..85
 * Permanent teeth keep their historical ordering exactly.
 */
const ARCH_ORDER: number[] = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 38, 37, 36, 35, 34, 33, 32, 31,
  41, 42, 43, 44, 45, 46, 47, 48, 55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 75, 74, 73, 72, 71, 81,
  82, 83, 84, 85,
]
export function sortFdi(fd: number[]): number[] {
  return [...fd].sort((a, b) => ARCH_ORDER.indexOf(a) - ARCH_ORDER.indexOf(b))
}

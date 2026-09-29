/**
 * Phase 2 — FDI tooth helpers (server-side).
 *
 * Reuses the application's existing, reliable FDI representation
 * (`DentalChartEntry.toothNumber` = FDI int 11-48, same as the dental chart
 * adapter's `TOOTH_NAMES`/`FDI_QUADRANTS`). No second numbering system.
 */

export const FDI_QUADRANTS: Record<1 | 2 | 3 | 4, number[]> = {
  1: [18, 17, 16, 15, 14, 13, 12, 11], // Upper Right (Maxillary Right)
  2: [21, 22, 23, 24, 25, 26, 27, 28], // Upper Left (Maxillary Left)
  3: [31, 32, 33, 34, 35, 36, 37, 38], // Lower Left (Mandibular Left)
  4: [41, 42, 43, 44, 45, 46, 47, 48], // Lower Right (Mandibular Right)
}

export const TOOTH_NAMES: Record<number, string> = {
  11: 'Upper Right Central Incisor', 12: 'Upper Right Lateral Incisor',
  13: 'Upper Right Canine', 14: 'Upper Right First Premolar',
  15: 'Upper Right Second Premolar', 16: 'Upper Right First Molar',
  17: 'Upper Right Second Molar', 18: 'Upper Right Third Molar (Wisdom)',
  21: 'Upper Left Central Incisor', 22: 'Upper Left Lateral Incisor',
  23: 'Upper Left Canine', 24: 'Upper Left First Premolar',
  25: 'Upper Left Second Premolar', 26: 'Upper Left First Molar',
  27: 'Upper Left Second Molar', 28: 'Upper Left Third Molar (Wisdom)',
  31: 'Lower Left Central Incisor', 32: 'Lower Left Lateral Incisor',
  33: 'Lower Left Canine', 34: 'Lower Left First Premolar',
  35: 'Lower Left Second Premolar', 36: 'Lower Left First Molar',
  37: 'Lower Left Second Molar', 38: 'Lower Left Third Molar (Wisdom)',
  41: 'Lower Right Central Incisor', 42: 'Lower Right Lateral Incisor',
  43: 'Lower Right Canine', 44: 'Lower Right First Premolar',
  45: 'Lower Right Second Premolar', 46: 'Lower Right First Molar',
  47: 'Lower Right Second Molar', 48: 'Lower Right Third Molar (Wisdom)',
}

/** True for a valid permanent FDI number (11-48). */
export function isValidFdi(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 11 && n <= 48
}

export function toothName(fdi: number): string {
  return TOOTH_NAMES[fdi] ?? `Tooth ${fdi}`
}

export function quadrantOf(fdi: number): 1 | 2 | 3 | 4 | null {
  if (!isValidFdi(fdi)) return null
  if (fdi >= 11 && fdi <= 18) return 1
  if (fdi >= 21 && fdi <= 28) return 2
  if (fdi >= 31 && fdi <= 38) return 3
  return 4
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

/** Deterministic FDI sort (arch order: 18..11, 21..28, 38..31, 41..48). */
const ARCH_ORDER: number[] = [
  18, 17, 16, 15, 14, 13, 12, 11,
  21, 22, 23, 24, 25, 26, 27, 28,
  38, 37, 36, 35, 34, 33, 32, 31,
  41, 42, 43, 44, 45, 46, 47, 48,
]
export function sortFdi(fd: number[]): number[] {
  return [...fd].sort((a, b) => ARCH_ORDER.indexOf(a) - ARCH_ORDER.indexOf(b))
}

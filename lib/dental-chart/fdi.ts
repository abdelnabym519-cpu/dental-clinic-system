/**
 * DenToRa — Interactive Dental Chart: FDI (ISO-3950) domain utilities.
 *
 * Pure, side-effect-free, framework-free. Single canonical FDI rule set for
 * the interactive chart layer (the Phase-3 protected odontogram keeps its
 * own adapter — this module never duplicates its view-model logic, it only
 * provides notation math + Arabic naming for the new 2D/3D layer).
 *
 * FDI quadrants: 1 = upper right, 2 = upper left, 3 = lower left, 4 = lower right.
 * Permanent teeth: 11–18, 21–28, 31–38, 41–48.
 */

export type ToothArch = 'upper' | 'lower'
export type ToothSideRL = 'right' | 'left'
export type ToothGroup = 'incisor' | 'canine' | 'premolar' | 'molar'
export type FdiQuadrant = 1 | 2 | 3 | 4

/** All 32 permanent teeth in FDI notation, ordered by quadrant. */
export const FDI_TEETH: readonly number[] = Object.freeze(
  [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4, 5, 6, 7, 8].map((t) => q * 10 + t))
)

const QUADRANT_SET = new Set(FDI_TEETH)

export function isValidFdi(n: number): boolean {
  return Number.isInteger(n) && QUADRANT_SET.has(n)
}

export function quadrantOf(n: number): FdiQuadrant {
  if (!isValidFdi(n)) throw new Error(`Invalid FDI tooth number: ${n}`)
  return Math.floor(n / 10) as FdiQuadrant
}

/** Tooth index inside its quadrant (1 = central incisor … 8 = third molar). */
export function toothIndexOf(n: number): number {
  if (!isValidFdi(n)) throw new Error(`Invalid FDI tooth number: ${n}`)
  return n % 10
}

export function archOf(n: number): ToothArch {
  return quadrantOf(n) <= 2 ? 'upper' : 'lower'
}

export function sideOf(n: number): ToothSideRL {
  const q = quadrantOf(n)
  // FDI: 1 = upper right, 2 = upper left, 3 = lower left, 4 = lower right.
  return q === 1 || q === 4 ? 'right' : 'left'
}

export function groupOf(n: number): ToothGroup {
  const t = toothIndexOf(n)
  if (t <= 2) return 'incisor'
  if (t === 3) return 'canine'
  if (t <= 5) return 'premolar'
  return 'molar'
}

/** Mirrors the protected Phase-3 `ToothSpecificType` naming exactly. */
export function specificTypeOf(n: number): string {
  const jaw = archOf(n) === 'upper' ? 'maxillary' : 'mandibular'
  const t = toothIndexOf(n)
  const kind =
    t === 1
      ? 'central_incisor'
      : t === 2
        ? 'lateral_incisor'
        : t === 3
          ? 'canine'
          : t === 4
            ? 'first_premolar'
            : t === 5
              ? 'second_premolar'
              : t === 6
                ? 'first_molar'
                : t === 7
                  ? 'second_molar'
                  : 'third_molar'
  return `${jaw}_${kind}`
}

const TYPE_AR: Record<number, string> = {
  1: 'القاطع المركزي',
  2: 'القاطع الجانبي',
  3: 'الناب',
  4: 'الضاحك الأول',
  5: 'الضاحك الثاني',
  6: 'الرحى الأولى',
  7: 'الرحى الثانية',
  8: 'ضرس العقل',
}

const ARCH_AR: Record<ToothArch, string> = { upper: 'العلوي', lower: 'السفلي' }
const SIDE_AR: Record<ToothSideRL, string> = { right: 'الأيمن', left: 'الأيسر' }
const ARCH_AR_F = { upper: 'العلوية', lower: 'السفلية' } as const
const SIDE_AR_F = { right: 'اليمنى', left: 'اليسرى' } as const


const TYPE_EN: Record<number, string> = {
  1: 'central incisor',
  2: 'lateral incisor',
  3: 'canine',
  4: 'first premolar',
  5: 'second premolar',
  6: 'first molar',
  7: 'second molar',
  8: 'wisdom tooth',
}

/** English clinical name, e.g. 16 → "upper right first molar". */
export function toothNameEn(n: number): string {
  return `${archOf(n)} ${sideOf(n)} ${TYPE_EN[toothIndexOf(n)]}`
}

/** Arabic clinical name with gender agreement, e.g. 16 → "الرحى الأولى العلوية اليمنى". */
export function toothNameAr(n: number): string {
  const t = toothIndexOf(n)
  // "الرحى" is grammatically feminine; ضرس العقل/القاطع/الناب/الضاحك masculine.
  if (t === 6 || t === 7) return `${TYPE_AR[t]} ${ARCH_AR_F[archOf(n)]} ${SIDE_AR_F[sideOf(n)]}`
  return `${TYPE_AR[t]} ${ARCH_AR[archOf(n)]} ${SIDE_AR[sideOf(n)]}`
}

/** Teeth adjacent within the same quadrant (mesial/distal neighbors). */
export function adjacentTeeth(n: number): number[] {
  const q = quadrantOf(n)
  const t = toothIndexOf(n)
  const out: number[] = []
  if (t > 1 && isValidFdi(q * 10 + t - 1)) out.push(q * 10 + t - 1)
  if (t < 8 && isValidFdi(q * 10 + t + 1)) out.push(q * 10 + t + 1)
  return out
}

/** Occluding antagonist: upper-right ↔ lower-right (1↔4), upper-left ↔ lower-left (2↔3). */
export function opposingTooth(n: number): number {
  const q = quadrantOf(n)
  const map: Record<FdiQuadrant, FdiQuadrant> = { 1: 4, 4: 1, 2: 3, 3: 2 }
  return map[q] * 10 + toothIndexOf(n)
}

/** Neighbors for arrow-key navigation: adjacent teeth + the antagonist. */
export function navigationTargets(n: number): { left: number; right: number; up: number; down: number } {
  const q = quadrantOf(n)
  const t = toothIndexOf(n)
  // In-quadrant horizontal direction follows the FDI arc toward the midline.
  const towardMidline = t - 1
  const awayFromMidline = t + 1
  const at = (idx: number) => (isValidFdi(q * 10 + idx) ? q * 10 + idx : null)
  // In RTL layouts ArrowRight moves toward the patient's midline.
  const mid = at(towardMidline) ?? n
  const away = at(awayFromMidline) ?? n
  const ant = opposingTooth(n)
  return archOf(n) === 'upper'
    ? { left: away, right: mid, up: n, down: ant }
    : { left: away, right: mid, up: ant, down: n }
}

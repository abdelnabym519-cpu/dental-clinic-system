/**
 * DenToRa — Interactive Dental Chart: FDI (ISO-3950) domain utilities.
 *
 * Pure, side-effect-free, framework-free. This is the SINGLE canonical FDI
 * rule set for the whole application: the interactive chart layer uses it
 * directly and the server-side AI context layer re-exports its validator
 * (`lib/ai/context/fdi.ts`), so the two can never drift apart.
 *
 * The Phase-3 protected odontogram keeps its own adapter — this module never
 * duplicates its view-model logic, it only provides notation math + naming.
 *
 * SCOPE NOTE — root/canal morphology is deliberately absent.
 * This module provides tooth IDENTITY only (quadrant, index, dentition,
 * group, type, names). Root and canal counts are anatomy-dependent and are
 * intentionally NOT defined here for primary (deciduous) teeth: they remain
 * unavailable pending explicit clinical sign-off. The permanent-dentition
 * table lives in `components/dental-chart/adapters/dental-chart-adapter.ts`
 * and is unchanged by this module.
 *
 * FDI quadrants:
 *   1 = upper right (maxillary right)    permanent   5 = upper right   primary
 *   2 = upper left  (maxillary left)     permanent   6 = upper left    primary
 *   3 = lower left  (mandibular left)    permanent   7 = lower left    primary
 *   4 = lower right (mandibular right)   permanent   8 = lower right   primary
 *
 * Permanent teeth: 11–18, 21–28, 31–38, 41–48  → 32 teeth, indices 1–8.
 * Primary teeth:   51–55, 61–65, 71–75, 81–85  → 20 teeth, indices 1–5.
 *
 * Primary dentition has NO premolars: index 4 = first molar, index 5 = second
 * molar. Indices 6–8 do not exist in a primary quadrant.
 *
 * Dentition is derived from the quadrant digit — never stored separately.
 * A patient may hold permanent and primary teeth at the same time (mixed
 * dentition); nothing here assumes 32 or 20 teeth per patient.
 */

export type ToothArch = 'upper' | 'lower'
export type ToothSideRL = 'right' | 'left'
export type ToothGroup = 'incisor' | 'canine' | 'premolar' | 'molar'
export type FdiQuadrant = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type FdiDentition = 'permanent' | 'primary'

const PERMANENT_QUADRANTS = [1, 2, 3, 4]
const PRIMARY_QUADRANTS = [5, 6, 7, 8]
const PERMANENT_INDICES = [1, 2, 3, 4, 5, 6, 7, 8]
const PRIMARY_INDICES = [1, 2, 3, 4, 5]

/** All 32 permanent teeth in FDI notation, ordered by quadrant. */
export const FDI_TEETH: readonly number[] = Object.freeze(
  PERMANENT_QUADRANTS.flatMap((q) => PERMANENT_INDICES.map((t) => q * 10 + t))
)

/** Explicit alias — preferred at new call sites for readability. */
export const FDI_TEETH_PERMANENT: readonly number[] = FDI_TEETH

/** All 20 primary (deciduous) teeth in FDI notation, ordered by quadrant. */
export const FDI_TEETH_PRIMARY: readonly number[] = Object.freeze(
  PRIMARY_QUADRANTS.flatMap((q) => PRIMARY_INDICES.map((t) => q * 10 + t))
)

/** Every valid FDI identifier: 32 permanent + 20 primary = 52. */
export const FDI_TEETH_ALL: readonly number[] = Object.freeze([
  ...FDI_TEETH_PERMANENT,
  ...FDI_TEETH_PRIMARY,
])

const VALID_FDI = new Set<number>(FDI_TEETH_ALL)
const PRIMARY_FDI = new Set<number>(FDI_TEETH_PRIMARY)

/**
 * True only for one of the 52 valid FDI identifiers.
 * Accepts `unknown` so callers can validate untrusted input directly; numeric
 * strings ('16'), null, undefined, NaN, Infinity and non-integers are all
 * rejected — a number is required, never a coercion.
 */
export function isValidFdi(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && VALID_FDI.has(n)
}

export function isPrimaryFdi(n: unknown): boolean {
  return isValidFdi(n) && PRIMARY_FDI.has(n)
}

export function isPermanentFdi(n: unknown): boolean {
  return isValidFdi(n) && !PRIMARY_FDI.has(n)
}

/** Throws for invalid input — never silently guesses a dentition. */
export function dentitionOf(n: number): FdiDentition {
  if (!isValidFdi(n)) throw new Error(`Invalid FDI tooth number: ${n}`)
  return PRIMARY_FDI.has(n) ? 'primary' : 'permanent'
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

/** Highest valid index in the tooth's own dentition: 8 permanent, 5 primary. */
export function maxToothIndexOf(n: number): number {
  return dentitionOf(n) === 'primary' ? 5 : 8
}

export function archOf(n: number): ToothArch {
  const q = quadrantOf(n)
  // Upper (maxillary): permanent 1–2, primary 5–6.
  return q === 1 || q === 2 || q === 5 || q === 6 ? 'upper' : 'lower'
}

export function sideOf(n: number): ToothSideRL {
  const q = quadrantOf(n)
  // Right: permanent 1 and 4, primary 5 and 8.
  return q === 1 || q === 4 || q === 5 || q === 8 ? 'right' : 'left'
}

/**
 * Primary dentition has no premolars: index 4 is the first molar and index 5
 * the second molar. Premolars exist only in permanent quadrants.
 */
export function groupOf(n: number): ToothGroup {
  const t = toothIndexOf(n)
  if (t <= 2) return 'incisor'
  if (t === 3) return 'canine'
  if (isPrimaryFdi(n)) return 'molar'
  if (t <= 5) return 'premolar'
  return 'molar'
}

/**
 * Mirrors the protected Phase-3 `ToothSpecificType` naming for permanent
 * teeth. Primary teeth carry a `primary_` prefix so that a primary first
 * molar (54) can never be mistaken for a permanent first molar (16).
 */
export function specificTypeOf(n: number): string {
  const primary = isPrimaryFdi(n)
  const jaw = archOf(n) === 'upper' ? 'maxillary' : 'mandibular'
  const t = toothIndexOf(n)
  const kind =
    t === 1
      ? 'central_incisor'
      : t === 2
        ? 'lateral_incisor'
        : t === 3
          ? 'canine'
          : primary
            ? t === 4
              ? 'first_molar'
              : 'second_molar'
            : t === 4
              ? 'first_premolar'
              : t === 5
                ? 'second_premolar'
                : t === 6
                  ? 'first_molar'
                  : t === 7
                    ? 'second_molar'
                    : 'third_molar'
  return primary ? `primary_${jaw}_${kind}` : `${jaw}_${kind}`
}

const TYPE_AR_PERMANENT: Record<number, string> = {
  1: 'القاطع المركزي',
  2: 'القاطع الجانبي',
  3: 'الناب',
  4: 'الضاحك الأول',
  5: 'الضاحك الثاني',
  6: 'الرحى الأولى',
  7: 'الرحى الثانية',
  8: 'ضرس العقل',
}

const TYPE_AR_PRIMARY: Record<number, string> = {
  1: 'القاطع المركزي',
  2: 'القاطع الجانبي',
  3: 'الناب',
  4: 'الرحى الأولى',
  5: 'الرحى الثانية',
}

const ARCH_AR: Record<ToothArch, string> = { upper: 'العلوي', lower: 'السفلي' }
const SIDE_AR: Record<ToothSideRL, string> = { right: 'الأيمن', left: 'الأيسر' }
const ARCH_AR_F = { upper: 'العلوية', lower: 'السفلية' } as const
const SIDE_AR_F = { right: 'اليمنى', left: 'اليسرى' } as const

/**
 * "الرحى" is grammatically feminine; القاطع/الناب/الضاحك/ضرس العقل masculine.
 * In primary dentition the molars are indices 4–5 (not 6–8).
 */
function isFeminineType(n: number): boolean {
  const t = toothIndexOf(n)
  return isPrimaryFdi(n) ? t === 4 || t === 5 : t === 6 || t === 7
}

const TYPE_EN_PERMANENT: Record<number, string> = {
  1: 'central incisor',
  2: 'lateral incisor',
  3: 'canine',
  4: 'first premolar',
  5: 'second premolar',
  6: 'first molar',
  7: 'second molar',
  8: 'wisdom tooth',
}

const TYPE_EN_PRIMARY: Record<number, string> = {
  1: 'central incisor',
  2: 'lateral incisor',
  3: 'canine',
  4: 'first molar',
  5: 'second molar',
}

/** English clinical name, e.g. 16 → "upper right first molar". */
export function toothNameEn(n: number): string {
  const t = toothIndexOf(n)
  const primary = isPrimaryFdi(n)
  const kind = primary ? TYPE_EN_PRIMARY[t] : TYPE_EN_PERMANENT[t]
  return primary ? `primary ${archOf(n)} ${sideOf(n)} ${kind}` : `${archOf(n)} ${sideOf(n)} ${kind}`
}

/** Arabic clinical name with gender agreement, e.g. 16 → "الرحى الأولى العلوية اليمنى". */
export function toothNameAr(n: number): string {
  const t = toothIndexOf(n)
  const primary = isPrimaryFdi(n)
  const type = primary ? TYPE_AR_PRIMARY[t] : TYPE_AR_PERMANENT[t]
  const deciduous = primary ? (isFeminineType(n) ? 'اللبنية' : 'اللبني') : null
  return isFeminineType(n)
    ? [type, deciduous, ARCH_AR_F[archOf(n)], SIDE_AR_F[sideOf(n)]].filter(Boolean).join(' ')
    : [type, deciduous, ARCH_AR[archOf(n)], SIDE_AR[sideOf(n)]].filter(Boolean).join(' ')
}

/** Teeth adjacent within the same quadrant (mesial/distal neighbors). */
export function adjacentTeeth(n: number): number[] {
  const q = quadrantOf(n)
  const t = toothIndexOf(n)
  const out: number[] = []
  if (t > 1 && isValidFdi(q * 10 + t - 1)) out.push(q * 10 + t - 1)
  if (t < maxToothIndexOf(n) && isValidFdi(q * 10 + t + 1)) out.push(q * 10 + t + 1)
  return out
}

/**
 * Occluding antagonist:
 *   permanent 1↔4 (upper-right ↔ lower-right), 2↔3 (upper-left ↔ lower-left)
 *   primary   5↔8 (upper-right ↔ lower-right), 6↔7 (upper-left ↔ lower-left)
 */
const OPPOSING_QUADRANT: Record<FdiQuadrant, FdiQuadrant> = {
  1: 4,
  4: 1,
  2: 3,
  3: 2,
  5: 8,
  8: 5,
  6: 7,
  7: 6,
}

export function opposingTooth(n: number): number {
  const q = quadrantOf(n)
  return OPPOSING_QUADRANT[q] * 10 + toothIndexOf(n)
}

/** Neighbors for arrow-key navigation: adjacent teeth + the antagonist. */
export function navigationTargets(n: number): {
  left: number
  right: number
  up: number
  down: number
} {
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

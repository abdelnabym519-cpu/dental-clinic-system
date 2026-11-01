/**
 * DenToRa <-> React-Advanced-Odontogram adapter (R1a, 2D odontogram).
 *
 * Bridges the two data shapes:
 *
 *   DenToRa  one DentalChartEntryRecord = one (tooth, condition) pair, so N
 *            findings on a tooth are N rows.
 *   Library  one state object per tooth holding every finding at once.
 *
 * so this is N rows <-> 1 state object, not 1:1. `entriesToRaoState` merges,
 * `raoStateToEntries` splits.
 *
 * The mapping table this implements is docs/dental-chart/CONDITION-MAPPING.md.
 * Library facts it depends on were verified against upstream commit
 * a11468def7a5c30c876db24fce3986f21b815377 (2.8.0) and are recorded in
 * docs/dental-chart/ASSETS.md section "(a)":
 *
 *  - ALL_TEETH is 32 PERMANENT numbers only; primary teeth are a `milktooth`
 *    flag on slots 11-45, displayed as 51-85 by getDisplayedToothNumber().
 *  - Surface ids are identical on both sides: buccal, lingual, mesial, distal,
 *    occlusal.
 *
 * No schema change, no new persistence path: this only translates in memory.
 */

import type {
  DentalChartEntryRecord,
  DentalCondition,
} from '@/components/dental-chart/types/odontogram'

// ─── vocabularies ───────────────────────────────────────────────────────────

/** The five surfaces, identical in DenToRa and in the library. */
export const DENTORA_SURFACES = [
  'mesial',
  'distal',
  'occlusal',
  'buccal',
  'lingual',
] as const

export type DenToRaSurface = (typeof DENTORA_SURFACES)[number]

/** The 32 permanent FDI numbers the library can draw. */
export const PERMANENT_TEETH: number[] = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
]

/** The 20 primary FDI numbers 51-85, as DenToRa stores them. */
export const PRIMARY_TEETH: number[] = [
  51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85,
]

/**
 * Library slots that can never carry the `milktooth` flag (MILKTOOTH_BLOCKED
 * in src/odontogram.ts) - the permanent molars, which have no primary
 * predecessor.
 */
export const MILKTOOTH_BLOCKED: number[] = [
  16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48,
]

/** The 15 DenToRa conditions that have a clean library equivalent. */
export const MAPPED_CONDITIONS: DentalCondition[] = [
  'HEALTHY',
  'CARIES',
  'FILLED',
  'CROWN',
  'BRIDGE',
  'IMPLANT',
  'ROOT_CANAL',
  'EXTRACTION',
  'EXTRACTION_NEEDED',
  'MISSING',
  'FRACTURED',
  'MOBILITY',
  'ABSCESS',
  'PERIODONTAL',
  'VENEER',
]

/**
 * DenToRa conditions with NO library equivalent. `SENSITIVE` is the only one:
 * the string "sensitiv" occurs exactly once in the library's src/ and it is the
 * false positive `caseSensitive: true` in src/fhir/codeSystemResource.ts. There
 * is no sensitivity axis, no state field, no SVG layer and no translation key,
 * so it cannot be created in - or rendered by - the 2D view.
 */
export const UNMAPPED_CONDITIONS: DentalCondition[] = ['SENSITIVE']

/** DenToRa severity -> library `mobility` value. */
const MOBILITY_BY_SEVERITY: Record<string, 'm1' | 'm2' | 'm3'> = {
  MILD: 'm1',
  MODERATE: 'm2',
  SEVERE: 'm3',
}
const MOBILITY_DEFAULT: 'm1' | 'm2' | 'm3' = 'm1'
const SEVERITY_BY_MOBILITY: Record<string, string> = {
  m1: 'MILD',
  m2: 'MODERATE',
  m3: 'SEVERE',
}

/**
 * CROWN / BRIDGE / VENEER all write the single `restorationType` axis, so at
 * most one can survive. Precedence is fixed here so the loss is deterministic
 * and testable, never dependent on row order.
 */
const RESTORATION_PRECEDENCE: DentalCondition[] = ['CROWN', 'BRIDGE', 'VENEER']

// ─── tooth numbering ────────────────────────────────────────────────────────

export interface SlotRef {
  slot: number
  isPrimary: boolean
}

/** True for the primary (deciduous) FDI range 51-85. */
export function isPrimaryFdi(fdi: number): boolean {
  return Number.isInteger(fdi) && fdi >= 51 && fdi <= 85 && fdi % 10 >= 1 && fdi % 10 <= 5
}

/**
 * DenToRa FDI -> library slot.
 *
 * Permanent 11-48 map to themselves. Primary 51-85 map to slot = fdi - 40
 * (51->11 ... 85->45) and carry isPrimary, which becomes the library's
 * `milktooth` tooth-selection.
 */
export function fdiToSlot(fdi: number): SlotRef {
  if (!Number.isInteger(fdi)) {
    throw new Error(`Invalid FDI number: ${fdi} (not an integer)`)
  }

  // Range check is on 51-85 (not on isPrimaryFdi) so that numbers inside the
  // primary range but at an illegal position - e.g. 56, which is the primary
  // form of slot 16 - report the real reason they are rejected.
  if (fdi >= 51 && fdi <= 85) {
    const quadrant = Math.floor(fdi / 10) // 5..8
    const position = fdi % 10 // 1..8
    const slot = (quadrant - 4) * 10 + position // 11..18, ..., 41..48
    if (position < 1 || position > 5 || MILKTOOTH_BLOCKED.includes(slot)) {
      throw new Error(
        `FDI ${fdi} maps to slot ${slot}, which cannot be primary (no primary predecessor)`,
      )
    }
    return { slot, isPrimary: true }
  }

  const quadrant = Math.floor(fdi / 10)
  const position = fdi % 10
  if (quadrant < 1 || quadrant > 4 || position < 1 || position > 8) {
    throw new Error(
      `Invalid FDI number: ${fdi} (expected 11-18, 21-28, 31-38, 41-48 or 51-85)`,
    )
  }
  return { slot: fdi, isPrimary: false }
}

/** Library slot + primary flag -> DenToRa FDI. Inverse of `fdiToSlot`. */
export function slotToFdi(slot: number, isPrimary: boolean): number {
  if (!isPrimary) return slot
  const quadrant = Math.floor(slot / 10) // 1..4
  const position = slot % 10 // 1..5
  if (quadrant < 1 || quadrant > 4 || position < 1 || position > 5) {
    throw new Error(`Slot ${slot} cannot be primary`)
  }
  return (quadrant + 4) * 10 + position
}

// ─── the adapter's own state shape ──────────────────────────────────────────

/**
 * Only the part of the library's per-tooth state that DenToRa can express.
 * Every field maps 1:1 onto a documented library axis - see the mapping table.
 */
export interface RaoToothState {
  slot: number
  isPrimary: boolean

  toothSelection: 'tooth-base' | 'milktooth' | 'implant' | 'none'
  caries: DenToRaSurface[]
  fillingSurfaces: DenToRaSurface[]
  restorationType: 'none' | 'crown' | 'bridge' | 'veneer'
  endo: 'none' | 'endo-filling'
  extractionWound: boolean
  extractionPlan: boolean
  toothSubstrate: 'natural' | 'broken'
  mobility: 'none' | 'm1' | 'm2' | 'm3'
  periapicalType: 'none' | 'abscess'
  periodontal: boolean

  /**
   * A CARIES / FILLED row may legally carry zero surfaces in DenToRa. The
   * library has no way to say "caries, surface unspecified" - an empty surface
   * set means no caries - so the row's existence is tracked separately from its
   * surfaces. Without this, a zero-surface row would vanish on round trip.
   */
  cariesPresent: boolean
  fillingPresent: boolean

  /** Non-fatal, human-readable notes about lossy merges. Never silent. */
  warnings: string[]
}

export function emptyRaoState(slot: number, isPrimary: boolean): RaoToothState {
  return {
    slot,
    isPrimary,
    toothSelection: isPrimary ? 'milktooth' : 'tooth-base',
    caries: [],
    fillingSurfaces: [],
    restorationType: 'none',
    endo: 'none',
    extractionWound: false,
    extractionPlan: false,
    toothSubstrate: 'natural',
    mobility: 'none',
    periapicalType: 'none',
    periodontal: false,
    cariesPresent: false,
    fillingPresent: false,
    warnings: [],
  }
}

// ─── DenToRa rows -> library state (merge) ──────────────────────────────────

/**
 * Merge every DenToRa row for one tooth into a single library state.
 * Rows for other teeth are ignored. Unmapped conditions (SENSITIVE) are
 * skipped, and HEALTHY is the absence of findings so it writes nothing.
 */
export function entriesToRaoState(
  entries: DentalChartEntryRecord[],
  tooth: number,
): RaoToothState {
  const { slot, isPrimary } = fdiToSlot(tooth)
  const state = emptyRaoState(slot, isPrimary)

  // Collect restorations first so the collision can be resolved once,
  // independently of row order.
  const restorations = new Set<DentalCondition>()

  for (const entry of entries) {
    if (entry.toothNumber !== tooth) continue
    const condition = entry.condition as DentalCondition
    const surfaces = DENTORA_SURFACES.filter((s) => entry[s] === true)

    switch (condition) {
      case 'HEALTHY':
        // Absence of findings - nothing to write.
        break

      case 'CARIES':
        state.cariesPresent = true
        for (const s of surfaces) if (!state.caries.includes(s)) state.caries.push(s)
        break

      case 'FILLED':
        state.fillingPresent = true
        for (const s of surfaces) {
          if (!state.fillingSurfaces.includes(s)) state.fillingSurfaces.push(s)
        }
        break

      case 'CROWN':
      case 'BRIDGE':
      case 'VENEER':
        restorations.add(condition)
        break

      case 'IMPLANT':
        if (state.toothSelection === 'none') {
          state.warnings.push(
            `Tooth ${tooth}: both MISSING and IMPLANT recorded; kept IMPLANT (more specific).`,
          )
        }
        state.toothSelection = 'implant'
        break

      case 'MISSING':
        if (state.toothSelection === 'implant') {
          state.warnings.push(
            `Tooth ${tooth}: both MISSING and IMPLANT recorded; kept IMPLANT (more specific).`,
          )
        } else {
          state.toothSelection = 'none'
        }
        break

      case 'ROOT_CANAL':
        state.endo = 'endo-filling'
        break

      case 'EXTRACTION':
        state.extractionWound = true
        break

      case 'EXTRACTION_NEEDED':
        state.extractionPlan = true
        break

      case 'FRACTURED':
        state.toothSubstrate = 'broken'
        break

      case 'MOBILITY':
        state.mobility = MOBILITY_BY_SEVERITY[String(entry.severity)] ?? MOBILITY_DEFAULT
        break

      case 'ABSCESS':
        state.periapicalType = 'abscess'
        break

      case 'PERIODONTAL':
        state.periodontal = true
        break

      case 'SENSITIVE':
        // Unmapped: no library axis exists. Skipped deliberately - see
        // docs/dental-chart/CONDITION-MAPPING.md.
        break

      default:
        state.warnings.push(
          `Tooth ${tooth}: unknown condition "${String(condition)}" ignored.`,
        )
        break
    }
  }

  // Resolve the restorationType collision with fixed precedence.
  if (restorations.size > 0) {
    const winner = RESTORATION_PRECEDENCE.find((c) => restorations.has(c))!
    const losers = RESTORATION_PRECEDENCE.filter((c) => restorations.has(c) && c !== winner)
    if (losers.length > 0) {
      state.warnings.push(
        `Tooth ${tooth}: ${[...restorations].sort().join(' + ')} all map to the single ` +
          `"restorationType" axis; kept ${winner}, dropped ${losers.join(', ')}. ` +
          `This is a lossy merge - see docs/dental-chart/CONDITION-MAPPING.md.`,
      )
    }
    state.restorationType = winner.toLowerCase() as 'crown' | 'bridge' | 'veneer'
  }

  return state
}

// ─── library state -> DenToRa rows (split) ──────────────────────────────────

export interface EntryContext {
  patientId: string
  hospitalId: string
  diagnosedDate: string
  recordedBy?: { firstName: string; lastName: string }
}

function buildRow(
  tooth: number,
  condition: DentalCondition,
  ctx: EntryContext,
  surfaces: DenToRaSurface[] = [],
  severity = 'MILD',
): DentalChartEntryRecord {
  return {
    id: '',
    patientId: ctx.patientId,
    hospitalId: ctx.hospitalId,
    toothNumber: tooth,
    toothNotation: String(tooth),
    condition,
    severity,
    mesial: surfaces.includes('mesial'),
    distal: surfaces.includes('distal'),
    occlusal: surfaces.includes('occlusal'),
    buccal: surfaces.includes('buccal'),
    lingual: surfaces.includes('lingual'),
    notes: null,
    diagnosedDate: ctx.diagnosedDate,
    resolvedDate: null,
  }
}

/**
 * Split one library tooth state back into DenToRa rows - one row per finding.
 * `tooth` is the original DenToRa FDI (needed because the library stores the
 * permanent slot, not 51-85).
 */
export function raoStateToEntries(
  state: RaoToothState,
  tooth: number,
  ctx: EntryContext,
): DentalChartEntryRecord[] {
  const rows: DentalChartEntryRecord[] = []

  if (state.cariesPresent) {
    rows.push(buildRow(tooth, 'CARIES', ctx, state.caries))
  }
  if (state.fillingPresent) {
    rows.push(buildRow(tooth, 'FILLED', ctx, state.fillingSurfaces))
  }
  if (state.restorationType !== 'none') {
    rows.push(buildRow(tooth, state.restorationType.toUpperCase() as DentalCondition, ctx))
  }
  if (state.toothSelection === 'implant') {
    rows.push(buildRow(tooth, 'IMPLANT', ctx))
  } else if (state.toothSelection === 'none') {
    rows.push(buildRow(tooth, 'MISSING', ctx))
  }
  if (state.endo === 'endo-filling') {
    rows.push(buildRow(tooth, 'ROOT_CANAL', ctx))
  }
  if (state.extractionWound) {
    rows.push(buildRow(tooth, 'EXTRACTION', ctx))
  }
  if (state.extractionPlan) {
    rows.push(buildRow(tooth, 'EXTRACTION_NEEDED', ctx))
  }
  if (state.toothSubstrate === 'broken') {
    rows.push(buildRow(tooth, 'FRACTURED', ctx))
  }
  if (state.mobility !== 'none') {
    rows.push(
      buildRow(tooth, 'MOBILITY', ctx, [], SEVERITY_BY_MOBILITY[state.mobility] ?? 'MILD'),
    )
  }
  if (state.periapicalType === 'abscess') {
    rows.push(buildRow(tooth, 'ABSCESS', ctx))
  }
  if (state.periodontal) {
    rows.push(buildRow(tooth, 'PERIODONTAL', ctx))
  }

  return rows
}

// ─── round trip ─────────────────────────────────────────────────────────────

/**
 * entries -> library state -> entries.
 *
 * Equality is over (tooth, condition, surfaces), not row identity: row ids and
 * order are not preserved, because N rows collapse into one state object.
 */
export function roundTripEntries(
  entries: DentalChartEntryRecord[],
  tooth: number,
  ctx: EntryContext,
): DentalChartEntryRecord[] {
  const state = entriesToRaoState(entries, tooth)
  return raoStateToEntries(state, tooth, ctx)
}

// ─── library state -> adapter state (the read-back direction) ───────────────

/**
 * The subset of the library's SERIALIZED per-tooth state that this adapter
 * reads. Produced by the engine's own `serializeState()`, so Sets have already
 * become arrays and Maps plain objects (patch 8's `getToothStates()`).
 *
 * Every field is optional: the shape is whatever upstream emits, and we must
 * not throw on a field that a future version renames or drops.
 */
export interface LibraryToothSnapshot {
  toothSelection?: string
  caries?: unknown
  fillingSurfaces?: unknown
  restorationType?: string
  endo?: string
  extractionWound?: boolean
  extractionPlan?: boolean
  toothSubstrate?: string
  mobility?: string
  periapicalType?: string
  mods?: unknown
  [key: string]: unknown
}

function asSurfaceList(value: unknown): DenToRaSurface[] {
  if (!Array.isArray(value)) return []
  const valid = new Set<string>(DENTORA_SURFACES)
  return value.filter((s): s is DenToRaSurface => typeof s === 'string' && valid.has(s))
}

function asStringSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [])
}

/**
 * Convert one serialized library tooth into the adapter's state shape.
 *
 * This is the direction that makes persistence and rollback possible: read the
 * chart back as data, turn it into DenToRa rows, and diff against what is
 * already stored.
 *
 * Anything the library can express but DenToRa cannot is DROPPED here — which
 * is precisely why the unmapped-conditions panel has to exist (see
 * `UNMAPPED_CONDITIONS`): dropping silently would lose clinical data.
 *
 * @param raw    serialized state from `getToothStates()`
 * @param slot   the library slot (11-48)
 * @param isPrimary whether this slot carries the `milktooth` flag
 */
export function raoStateFromLibrary(
  raw: LibraryToothSnapshot | null | undefined,
  slot: number,
  isPrimary: boolean,
): RaoToothState {
  const state = emptyRaoState(slot, isPrimary)
  if (!raw) return state

  const caries = asSurfaceList(raw.caries)
  const fillings = asSurfaceList(raw.fillingSurfaces)
  const mods = asStringSet(raw.mods)

  // toothSelection: implant and none are explicit; otherwise the flag decides.
  if (raw.toothSelection === 'implant') state.toothSelection = 'implant'
  else if (raw.toothSelection === 'none') state.toothSelection = 'none'
  else state.toothSelection = isPrimary ? 'milktooth' : 'tooth-base'

  state.caries = caries
  state.cariesPresent = caries.length > 0
  state.fillingSurfaces = fillings
  state.fillingPresent = fillings.length > 0

  // Only the three restoration types DenToRa knows. 'inlay' / 'onlay' and
  // anything else the library adds later is dropped (and surfaces in the panel).
  const rest = raw.restorationType
  if (rest === 'crown' || rest === 'bridge' || rest === 'veneer') state.restorationType = rest

  if (raw.endo === 'endo-filling') state.endo = 'endo-filling'

  state.extractionWound = raw.extractionWound === true
  state.extractionPlan = raw.extractionPlan === true

  if (raw.toothSubstrate === 'broken') state.toothSubstrate = 'broken'

  if (raw.mobility === 'm1' || raw.mobility === 'm2' || raw.mobility === 'm3') {
    state.mobility = raw.mobility
  }

  if (raw.periapicalType === 'abscess') state.periapicalType = 'abscess'

  state.periodontal = mods.has('parodontal')

  return state
}

// ─── diffing: what the user added, modified or removed ──────────────────────

/** One (condition) row reduced to a comparable signature. */
export interface FindingKey {
  toothNumber: number
  condition: DentalCondition
  surfaces: string
  severity: string
}

export function findingKey(entry: DentalChartEntryRecord): FindingKey {
  return {
    toothNumber: entry.toothNumber,
    condition: entry.condition as DentalCondition,
    surfaces: DENTORA_SURFACES.filter((s) => entry[s] === true).sort().join('+'),
    severity: String(entry.severity ?? ''),
  }
}

export function keyOf(k: FindingKey): string {
  return `${k.toothNumber}|${k.condition}|${k.surfaces}|${k.severity}`
}

export interface ToothDiff {
  added: DentalChartEntryRecord[]
  removed: DentalChartEntryRecord[]
  changed: DentalChartEntryRecord[]
}

/**
 * Diff two sets of rows for ONE tooth, matched on condition.
 *
 * Matching is by condition alone, not by row id: rows coming back from the
 * library are freshly built (`id: ''`) and have no id to match on. Surfaces and
 * severity are compared to detect a modification.
 */
export function diffToothRows(
  before: DentalChartEntryRecord[],
  after: DentalChartEntryRecord[],
): ToothDiff {
  const beforeByCond = new Map<string, DentalChartEntryRecord>()
  for (const e of before) beforeByCond.set(e.condition, e)
  const afterByCond = new Map<string, DentalChartEntryRecord>()
  for (const e of after) afterByCond.set(e.condition, e)

  const added: DentalChartEntryRecord[] = []
  const removed: DentalChartEntryRecord[] = []
  const changed: DentalChartEntryRecord[] = []

  for (const [cond, row] of afterByCond) {
    const prev = beforeByCond.get(cond)
    if (!prev) {
      added.push(row)
    } else if (keyOf(findingKey(prev)) !== keyOf(findingKey(row))) {
      changed.push(row)
    }
  }
  for (const [cond, row] of beforeByCond) {
    if (!afterByCond.has(cond)) removed.push(row)
  }

  return { added, removed, changed }
}

/**
 * Rows whose condition has no library equivalent, i.e. the ones the 2D chart
 * cannot draw. These must be surfaced, never dropped silently - see the
 * "unmapped findings" panel.
 */
export function findUnmappedEntries(entries: DentalChartEntryRecord[]): DentalChartEntryRecord[] {
  const unmapped = new Set<string>(UNMAPPED_CONDITIONS)
  return entries.filter((e) => unmapped.has(e.condition as DentalCondition))
}

/**
 * Convert adapter state BACK into the library's SERIALIZED tooth shape, so it
 * can be handed to `importStatus()`.
 *
 * This is the missing half that makes the 2D chart actually show DenToRa data:
 * the library renders from its own internal `charts.status` map, which is only
 * populated by an import or by user interaction. Pushing rows into it is what
 * turns "the adapter computed a state" into "the tooth is drawn".
 *
 * Only the axes DenToRa owns are emitted. Every other field falls back to the
 * library default, because `hydrateState()` starts from `defaultState()` and
 * documents that "unknown/absent values fall through to defaults; never
 * throws" — so a partial snapshot is safe and is all we need.
 */
export function librarySnapshotFromRaoState(state: RaoToothState): LibraryToothSnapshot {
  const mods: string[] = []
  if (state.periodontal) mods.push('parodontal')

  return {
    toothSelection: state.toothSelection,
    mods,
    periapicalType: state.periapicalType,
    endo: state.endo,
    caries: [...state.caries],
    fillingSurfaces: [...state.fillingSurfaces],
    fillingMaterial: state.fillingPresent ? 'composite' : 'none',
    extractionWound: state.extractionWound,
    extractionPlan: state.extractionPlan,
    toothSubstrate: state.toothSubstrate,
    mobility: state.mobility,
    restorationType: state.restorationType,
    // Touching a tooth marks it charted; the library uses this for its
    // "last modified" bookkeeping and for the plan/status diff.
    crownNeeded: false,
  }
}

/**
 * Build the full `importStatus()` payload for a whole mouth.
 *
 * @param bySlot adapter state keyed by LIBRARY SLOT (11-48)
 */
export function buildImportPayload(
  bySlot: Map<number, RaoToothState>,
): { version: string; globals: Record<string, boolean>; teeth: Record<string, LibraryToothSnapshot> } {
  const teeth: Record<string, LibraryToothSnapshot> = {}
  for (const [slot, state] of bySlot) {
    teeth[String(slot)] = librarySnapshotFromRaoState(state)
  }
  return {
    // A >= 2.3 version tells the engine NOT to re-infer legacy secondary
    // caries, so an unscored caried+filled surface stays primary caries.
    version: '2.22',
    globals: {
      wisdomVisible: true,
      showBase: true,
      occlusalVisible: true,
      showHealthyPulp: false,
      edentulous: false,
    },
    teeth,
  }
}

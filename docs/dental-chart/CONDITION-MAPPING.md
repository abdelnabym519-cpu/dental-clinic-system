# DenToRa ↔ React-Advanced-Odontogram condition mapping

Part of **R1a** (2D odontogram replacement). This is the checked-in mapping
table the task requires: it fixes which of the **16 DenToRa conditions** are
represented in the vendored 2D library, and on which library axis each one
lives.

- Library: `vendor/react-advanced-odontogram`, upstream commit
  `a11468def7a5c30c876db24fce3986f21b815377` (2.8.0, MIT).
- DenToRa source of truth: `components/dental-chart/types/odontogram.ts`
  (`DentalCondition`, `ToothSurfaceKey`).
- Library axis source of truth: `vendor/react-advanced-odontogram/src/registry/axes.ts`
  and `src/state/payload.ts` (`defaultState()`).

## Cardinality (the important structural difference)

| | Shape |
| --- | --- |
| **DenToRa** | one `DentalChartEntryRecord` = **one (tooth, condition)** pair. N conditions on one tooth = N rows. |
| **Library** | **one state object per tooth** holding every finding simultaneously (`Set`/`Map` fields plus scalar axes). |

So the adapter is not 1:1. It is **N rows ⇄ 1 state object**, and therefore:

- `entriesToRaoState(entries)` — **merges** all rows for a tooth into one state.
- `raoStateToEntries(state)` — **splits** one state back into one row per finding.

A round trip is `entries → state → entries`, and the invariant is *set
equality over (tooth, condition, surfaces)*, **not** array identity: row order
and row `id`s are not preserved.

## Surface vocabulary — identical, 5/5

Both sides use the same five surface ids, so no translation is needed:

| DenToRa `ToothSurfaceKey` | Library surface id |
| --- | --- |
| `mesial` | `mesial` |
| `distal` | `distal` |
| `occlusal` | `occlusal` |
| `buccal` | `buccal` |
| `lingual` | `lingual` |

Verified: `validSurfaces()` resolves to `Object.keys(LOCAL_VALUE_MAPS.fillingSurfaces)`
= `buccal, lingual, mesial, distal, occlusal` (`src/fhir/codesystems.ts:141`).

## Tooth numbering — 51–85 needs the `milktooth` flag, not separate slots

The library's `ALL_TEETH` is **32 permanent numbers only** (11–18, 21–28,
31–38, 41–48). Primary teeth are a *flag* on the permanent slot, displayed via
`getDisplayedToothNumber()` (quadrant digit 1→5, 2→6, 3→7, 4→8).

```
DenToRa 51..55  ->  library slot 11..15, toothSelection = "milktooth"
DenToRa 61..65  ->  library slot 21..25, toothSelection = "milktooth"
DenToRa 71..75  ->  library slot 31..35, toothSelection = "milktooth"
DenToRa 81..85  ->  library slot 41..45, toothSelection = "milktooth"
DenToRa 11..48  ->  library slot same,   toothSelection = "tooth-base"
```

i.e. **slot = fdi − 40** for primary, **slot = fdi** for permanent. Only slots
11–15 / 21–25 / 31–35 / 41–45 may be primary (`PRIMARY_MILK`); 16,17,18,
26,27,28, 36,37,38, 46,47,48 are `MILKTOOTH_BLOCKED` and can never be primary.

Primary tooth artwork **does** exist: `src/assets/teeth-svgs/measured/`
contains `51–55` and `71–75` (41 SVGs total, the other side being mirrored).

## Mapping table — 15 mapped, 1 unmapped

| # | DenToRa condition | Library axis / field | Library value | Surfaces carried? |
| --- | --- | --- | --- | --- |
| 1 | `HEALTHY` | *(no findings)* | default state | no |
| 2 | `CARIES` | `caries` (set) | surface ids | **yes**, 5 |
| 3 | `FILLED` | `fillingSurfaces` (set) + `fillingMaterial` | surface ids + material | **yes**, 5 |
| 4 | `CROWN` | `restorationType` | `"crown"` | no |
| 5 | `BRIDGE` | `restorationType` | `"bridge"` | no |
| 6 | `IMPLANT` | `toothSelection` | `"implant"` | no |
| 7 | `ROOT_CANAL` | `endo` | `"endo-filling"` | no |
| 8 | `EXTRACTION` | `extractionWound` | `true` | no |
| 9 | `EXTRACTION_NEEDED` | `extractionPlan` | `true` | no |
| 10 | `MISSING` | `toothSelection` | `"none"` | no |
| 11 | `FRACTURED` | `toothSubstrate` | `"broken"` | no |
| 12 | `SENSITIVE` | — | **UNMAPPED** | — |
| 13 | `MOBILITY` | `mobility` | `"m1"` / `"m2"` / `"m3"` | no |
| 14 | `ABSCESS` | `periapicalType` | `"abscess"` | no |
| 15 | `PERIODONTAL` | `mods` | `"parodontal"` | no |
| 16 | `VENEER` | `restorationType` | `"veneer"` | no |

### Severity → `MOBILITY`

`MOBILITY` is the one condition where DenToRa's `severity` (MILD/MODERATE/SEVERE)
carries real information, so it drives the library value:

| DenToRa severity | Library `mobility` |
| --- | --- |
| `MILD` | `m1` |
| `MODERATE` | `m2` |
| `SEVERE` | `m3` |
| *(none / unrecognised)* | `m1` (documented default) |

### Notes on individual choices

- **`HEALTHY`** is the *absence* of findings, so it maps to the default state and
  round-trips as "a tooth with no rows". It is not stored as a positive finding.
- **`FRACTURED`** uses whole-tooth `toothSubstrate: "broken"` rather than the
  library's per-site `brokenMesial` / `brokenIncisal` / `brokenDistal`
  booleans, because those three do not line up with DenToRa's five surfaces
  (`incisal` has no DenToRa counterpart).
- **`ROOT_CANAL`** uses `endo: "endo-filling"` (root canal filling). The other
  `endo` values (`endo-medical-filling`, `endo-glass-pin`, `endo-metal-pin`)
  are distinct clinical findings with no DenToRa equivalent and are hidden.
- **`EXTRACTION`** = `extractionWound` (the socket, i.e. already extracted);
  **`EXTRACTION_NEEDED`** = `extractionPlan` (planned). Both are separate
  boolean axes, which is why they map cleanly.
- **`CROWN` / `BRIDGE` / `VENEER`** all live on `restorationType`, so they are
  **mutually exclusive on one tooth** in the library. DenToRa rows are not
  constrained that way; the adapter resolves this explicitly (see below).

### ⚠️ The `restorationType` collision

`CROWN`, `BRIDGE` and `VENEER` all write the single `restorationType` axis.
If a tooth carries two of them in DenToRa, only one can survive in the library.

Resolution — **deterministic precedence `CROWN` > `BRIDGE` > `VENEER`**, applied
on merge and on split. This is lossy and is therefore an **explicitly
documented, tested** behaviour: the round-trip test asserts that a tooth with
both `CROWN` and `VENEER` round-trips to `CROWN` only. A warning is surfaced so
the UI can flag it. No silent data loss.

## Unmapped: `SENSITIVE`

`SENSITIVE` is the **only** one of the 16 with no clean library equivalent.

Evidence — the string `sensitiv` occurs **once** in the whole of
`src/` (excluding `__tests__`), and it is the false positive
`caseSensitive: true` in `src/fhir/codeSystemResource.ts:147`:

```
$ grep -rin sensitiv src --include=*.ts --include=*.tsx
  state:      0
  registry:   0
  odontogram.ts: 0
  surfaces:   0
  i18n:       0
```

There is **no** `sensitivity` axis in `registry/axes.ts`, **no** field in
`defaultState()`, **no** SVG layer, and **no** translation key. Per the R1a
requirement that unmapped states be impossible to create, `SENSITIVE` is
therefore **hidden in the 2D view**: it cannot be created there and existing
`SENSITIVE` rows are not rendered by the 2D odontogram.

> Consequence to flag: existing `SENSITIVE` entries stay in the database
> untouched (no schema change, no new persistence path) but are **not visible**
> in the 2D view. They remain visible in the panel/3D path. If they must appear
> in 2D, that needs either an upstream feature or a plugin overlay — a decision
> for the user, not something assumed here.

## Library findings that are hidden (unmapped in the other direction)

The library's vocabulary is a strict superset. Everything below is hidden so it
cannot be created from the DenToRa 2D view:

`endoResection`, `fissureSealing`, `contactMesial`, `contactDistal`,
`brokenMesial`, `brokenIncisal`, `brokenDistal`, `parapulpalPin`,
`bridgePillar`, `crownReplace`, `crownNeeded`, `missingClosed`, `crownLeakage`,
`pulpDx`, `pulpLatin`, `apicalDx`, `resorptionType`, `wearEdge`, `wearCervical`,
`discoloration`, `orthoAppliance`, `orthoDrift`, `orthoVertical`,
`orthoRotation`, `rootCaries`, `radiographicDepth`, `fillingDefect`,
`dxOverrides`, `periImplant`, `cejVisibility`, `rootConcavity`,
`gingivalThickness`, `millerClass`, `calculus`, the `inflammation` and
`mobility` values of the `mods` set, all `restorationMaterial` values, all
`prosthesis` values, and all `endo` values other than `endo-filling`.

Periodontal probing data (`perio`, six probing sites) is likewise out of scope:
DenToRa models `PERIODONTAL` as a single whole-tooth condition with no site
geometry.

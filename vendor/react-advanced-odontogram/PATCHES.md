# Patches applied to the vendored React-Advanced-Odontogram

Upstream commit: `a11468def7a5c30c876db24fce3986f21b815377` (2.8.0).
Every change made to `src/` relative to that commit is listed here.
`LICENSE` and `THIRD-PARTY-NOTICES.md` are **unmodified** (verified
byte-identical with `cmp`).

Legend — **P0** required by the R1a acceptance criteria, **P1** required to make
the library integrate with the host app, **P2** cosmetic/optional.

| # | Pri | File(s) | Patch | Status |
| --- | --- | --- | --- | --- |
| 1 | P0 (i) | `src/odontogram.ts`, `src/OdontogramContext.tsx` | **Controlled selection.** Add a `selectedTeeth` prop and an `onSelectionChange` callback so the selection can be driven by, and reported to, the host store. | ⬜ pending |
| 2 | P0 (ii) | `src/odontogram.ts`, `src/registry/*` | **Findings restricted to the 16 DenToRa conditions.** Unmapped library states are removed from the UI so they cannot be created, and are rejected on import. Mapping table: [`docs/dental-chart/CONDITION-MAPPING.md`](../../docs/dental-chart/CONDITION-MAPPING.md). | ⬜ pending |
| 3 | P0 (iii) | `src/OdontogramContext.tsx`, `src/i18n/*` | **Language switcher hidden; Arabic (`ar`) forced as the default with RTL.** | ⬜ pending |
| 4 | P0 (iv) | `src/odontogram.ts` | **`setReadOnly()` driven from host RBAC** (DOCTOR/ADMIN/SUPER_ADMIN may mutate; RECEPTIONIST is read-only), re-applied after every re-init. | ⬜ pending |
| 5 | P0 (v) | `src/odontogram.ts` | **Per-patient reset.** A `resetToPatient(patientId)` entry point that clears findings, selection, case metadata and plan bookkeeping without tearing down the DOM. | ⬜ pending |
| 6 | P1 | `src/fonts/loader.ts` | jspdf/dompurify resolution under the Next build. | ⬜ pending |
| 7 | P1 | multiple | Next 16 / React 19 integration (no Vite-only globals). | ⬜ pending |

## Notes on the upstream behaviour each patch must respect

Recorded during R0 follow-up verification (`docs/dental-chart/ASSETS.md`,
section "(a)"). These facts constrain the patches:

- `updateSelectionUI()` is the single funnel for selection changes and already
  ends in `notifyStateChange()`, so **patch 1 must not add a second notify**
  (upstream comment: "the edit path (applyToSelected) notifies on its own, so
  this adds no double-fire").
- `onStateChange` callbacks receive **no payload**. A host must call
  `getSelectedTeeth()` inside the callback and diff.
- `destroyOdontogram()` resets **`readOnly = false` and `notesEnabled = false`**,
  so **patch 4 must re-apply** them after every `initOdontogram()`.
- `destroyOdontogram()` does **not** call `notifyStateChange()`.
- `resetMouth()` clears per-tooth state (including periodontal data, which
  lives inside the per-tooth record) plus edentulous and case metadata, but
  **preserves** the selection, session settings, `readOnly` and
  `notesEnabled` — so **patch 5 needs more than a bare `resetMouth()`**.
- `ALL_TEETH` is **32 permanent numbers only**. Primary teeth are a
  `milktooth` flag on slots 11–15 / 21–25 / 31–35 / 41–45, *displayed* as
  51–85 by `getDisplayedToothNumber()` (quadrant digit 1→5, 2→6, 3→7, 4→8).
  Slots 16,17,18,26,27,28,36,37,38,46,47,48 are `MILKTOOTH_BLOCKED` and can
  never be primary.

# Patches applied to the vendored React-Advanced-Odontogram

Upstream commit: `a11468def7a5c30c876db24fce3986f21b815377` (2.8.0).
Every change made to `src/` relative to that commit is listed here.
`LICENSE` and `THIRD-PARTY-NOTICES.md` are **unmodified** (verified
byte-identical with `cmp`).

Exactly three files are patched:

```
src/odontogram.ts                 (engine)
src/OdontogramContext.tsx         (React provider)
src/surfaces/OdontogramTopbar.tsx (topbar)
```

Everything else under `src/` is upstream verbatim.

| #   | Pri          | File(s)                                         | Patch                                                                                                                                                         | Status                    |
| --- | ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | **P0 (i)**   | `odontogram.ts`, `OdontogramContext.tsx`        | **Controlled selection** — new `setSelectedTeeth()`, `selectedTeeth` prop and `onSelectionChange` callback.                                                   | ✅ done                   |
| 2   | **P0 (ii)**  | _(no library change)_                           | **Findings restricted to the 16 DenToRa conditions.** Enforced in the adapter, not by patching the library — see note below.                                  | ✅ done (adapter)         |
| 3   | **P0 (iii)** | `OdontogramContext.tsx`, `OdontogramTopbar.tsx` | **Language switcher hidden; Arabic RTL default.** New `showLanguageSwitcher` prop (default `true`, upstream behaviour); host passes `language="ar"`.          | ✅ done                   |
| 4   | **P0 (iv)**  | _(no library change)_                           | **`readOnly` driven from host RBAC.** The `readOnly` prop already existed and the provider already re-applies it — see note below.                            | ✅ done (no patch needed) |
| 5   | **P0 (v)**   | `odontogram.ts`, `OdontogramContext.tsx`        | **Per-patient reset** — new `resetForPatient()`, exposed through the context.                                                                                 | ✅ done                   |
| 6   | P1           | `package.json` (host)                           | `dompurify` + `jspdf` added — the library's only two external runtime imports.                                                                                | ✅ done                   |
| 7   | P1           | `tsconfig.json` (host)                          | `vendor` excluded from the repo typecheck.                                                                                                                    | ✅ done                   |
| 8   | P1           | `src/odontogram.ts`                             | **`getToothStates()`** — structured per-tooth state reader. The engine had none, so a host could not diff the chart and persistence/rollback were impossible. | ✅ done                   |
| 9   | **P0**       | `src/index.css`                                 | **Scope the global stylesheet.** It leaked onto every page of the host app — see the dedicated section below.                                                 | ✅ done                   |
| 10  | **P1**       | `src/index.ts`                                  | **Re-export imperative functions** — `resetForPatient`, `getToothStates`, and `setSelectedTeeth` exported through the public package entry.                   | ✅ done                   |

---

## Patch 1 — controlled selection (R1a-i)

**`src/odontogram.ts`** — added `setSelectedTeeth(teeth: number[])` next to the
existing `getSelectedTeeth()`. The engine shipped only the _reader_, so a host
could never push a selection in.

- Writes funnel through `updateSelectionUI()`, which already ends in a single
  `notifyStateChange()`. Notifying here too would double-fire.
- `activeTooth` is kept as the first selected tooth, matching the zoom popover's
  "info" path, so the control cards stay consistent.
- Numbers not in `ALL_TEETH` are dropped: a stray number would be invisible in
  the DOM but still reported back by `getSelectedTeeth()`, desyncing the host.

**`src/OdontogramContext.tsx`** — two effects:

- _Push in_: compares the `selectedTeeth` prop against the engine's **current**
  selection (not the previous prop), so it is idempotent and cannot fight the
  engine. When the user clicks a tooth the host echoes the same array back and
  the guard short-circuits instead of re-applying and clobbering `activeTooth`.
- _Pull out_: subscribes to `onStateChange`, re-reads `getSelectedTeeth()` and
  **diffs**, because `onStateChange` carries no payload and fires for every
  edit, not just selection changes. Reading inside the callback is safe —
  `updateSelectionUI()` mutates `selectedTeeth` _before_ notifying, and
  `notifyStateChange()` is synchronous.

## Patch 8 — structured state reader

**`src/odontogram.ts`** — added `getToothStates()`, returning the STATUS chart
for all 32 slots, already run through the engine's own `serializeState()` so
Sets become arrays and Maps become plain objects.

The engine genuinely had no way to read the chart back as data:
`getToothStateSummary()` returns **display strings**, and `exportStatus()`
**writes a file to disk** instead of returning anything. Without a reader a host
cannot diff the chart against its own records, so it cannot know what the user
added, modified or removed — which is what makes persistence and rollback
possible at all.

It is also the counterpart to `importStatus()`: that function is the only way to
make DenToRa data visible, because the library renders from its own internal
`charts.status` map, which otherwise only ever holds user edits.

## Patch 9 — scope the global stylesheet (highest-impact patch here)

`src/index.ts` imports `index.css` as a side effect, which makes it a **global**
stylesheet. Next keeps CSS loaded by a dynamic import after client-side
navigation, so once a user opens the v2 chart these rules keep applying on every
other page, for the rest of the session.

What leaked, measured before patching:

| Selector                 | Declaration                                                    | Damage                                                                                                                               |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `:root`                  | `--card`, `--muted`, `--accent`                                | **Collides with the app's shadcn tokens** (`app/globals.css:9,17,19`). The sheet loads last, so it wins and recolours the whole app. |
| `.dark` (bare, ×2)       | `--card`, `--muted`, `--bg`, `--text`, …                       | Same collision, but only when the app's Tailwind dark mode is on — i.e. invisible until someone toggles the theme.                   |
| `body`                   | `margin`, `font-family`, `radial-gradient` background, `color` | Overrides the host page's typography and background.                                                                                 |
| `html, body`             | `height: 100%`                                                 | Can break page scrolling.                                                                                                            |
| `select`, `select:focus` | appearance, background, `min-width: 220px`, focus ring         | Restyles **every** dropdown on the host site.                                                                                        |
| `.dark body`             | `background`                                                   | The app uses Tailwind's `.dark`, so this recoloured the host body.                                                                   |
| `*`                      | `box-sizing`                                                   | Benign (Tailwind's preflight already sets it), scoped anyway for consistency.                                                        |

Fix — scope every one of them to `.rao-scope`, the container the host wraps the
chart in, and drop the two that cannot be scoped meaningfully (`html,body`
height, `.dark body`).

Notes on why this is safe:

- **`:root` is redundant for the library.** `OdontogramContext.tsx:1045` always
  renders a `.odontogram-root` wrapper, and the sheet already re-resolves every
  token on `.odontogram-root` and `.dark .odontogram-root`. Moving the token
  block to `.rao-scope` therefore loses nothing inside the chart.
- **Dark mode still works.** The two bare `.dark` blocks became
  `.dark .rao-scope`, and the app's `.dark` (Tailwind, on `<html>`) is an
  ancestor of the container — so it still matches.
- `--odon-*` tokens are untouched: the library owns that prefix and the host
  drives it through `themeConfig` (see the dark-mode note below).

Guarded by `tests/unit/rao-vendor-css-scope.test.ts` (13 tests), which parses
the sheet and fails if any of these selectors reappear unscoped, and which
asserts the app really does define `--card`/`--muted`/`--accent` (so the
collision check cannot silently become vacuous) and that the host applies
`.rao-scope`.

## Patch 2 — findings restricted to the 16 DenToRa conditions (R1a-ii)

**Deliberately NOT done by patching the library.** The restriction is enforced
at the adapter boundary in `lib/dental-chart/v2/rao-adapter.ts`, which is the
only path by which DenToRa data reaches the odontogram. The adapter's state type
has a field for each mapped axis and nothing else, so an unmapped library
finding is not merely hidden — it is **unrepresentable** in the DenToRa view,
which is a stronger guarantee than removing UI controls.

The mapping table is checked in at `docs/dental-chart/CONDITION-MAPPING.md`:
15 of the 16 conditions map cleanly; `SENSITIVE` does not and cannot be created.

> Still outstanding for the UI: the library's own control cards (settings,
> perio, export) expose the superset vocabulary and are not yet hidden from the
> DenToRa route. That is tracked as follow-up work — the data path is already
> closed, the UI path is not.

## Patch 3 — language switcher hidden, Arabic RTL default (R1a-iii)

- New `showLanguageSwitcher?: boolean` prop on `OdontogramProvider`
  (`OdontogramContext.tsx`), default **`true`** so upstream behaviour is
  unchanged for anyone not passing it. Threaded through the context value.
- `OdontogramTopbar.tsx` wraps the `#languageMenu` block in
  `{showLanguageSwitcher && (...)}`.
- Arabic is a first-class upstream language: `i18n/languages.ts` documents
  `ar` as _"Arabic (RTL — UI mirrors, dental/perio charts pinned LTR)"_. The
  host passes `language="ar"`, which the provider already supported in
  controlled mode.

## Patch 4 — `readOnly` from host RBAC (R1a-iv)

**No library change was needed, and patching would have been wrong.** The
provider already accepts `readOnly` and already re-applies it:

```js
// Sync read-only mode
useEffect(() => {
  setReadOnly(readOnlyProp ?? false)
}, [readOnlyProp])
```

This matters because of an R0 finding: `destroyOdontogram()` resets
`readOnly = false` and `notesEnabled = false` when it tears down the case. The
existing effect re-applies the host value after any re-init, so the host only
needs to pass `readOnly={!canModify}`.

RBAC roles come from the existing workspace (`DentalChartWorkspace.tsx`):
`MUTATOR_ROLES = {DOCTOR, ADMIN, SUPER_ADMIN}` may mutate;
`VIEWER_ROLES = {…, RECEPTIONIST}` may only view.

## Patch 5 — per-patient reset (R1a-v)

**`src/odontogram.ts`** — added `resetForPatient()`, exposed through the
context in `OdontogramContext.tsx`.

It is deliberately **more** than a bare `resetMouth()`, and deliberately
**less** than `destroyOdontogram()` + `initOdontogram()`:

- `resetMouth()` clears per-tooth findings (including perio, which rides inside
  the per-tooth record), edentulous and case metadata — but it **preserves the
  selection**. Leftover selection from patient A would leak into patient B's
  chart, so `resetForPatient()` clears `selectedTeeth` and `activeTooth` too.
- It must **not** reset `readOnly` / `notesEnabled` / numbering / language,
  which are host configuration rather than patient data. That is precisely the
  mistake `destroyOdontogram()` makes.
- One `notifyStateChange()` at the end (via `updateSelectionUI()`), so
  listeners see a single consistent transition rather than a burst.

---

## Verification

Patched files parse (esbuild, `PARSE OK`):

```
src/odontogram.ts                    PARSE OK
src/OdontogramContext.tsx            PARSE OK
src/surfaces/OdontogramTopbar.tsx    PARSE OK
```

Typechecked with the library's own `tsconfig.build.json` against the host's
`node_modules`: **3 errors, all of them**
`Cannot find module 'fhir/r4'` in `src/fhir/{codeSystemResource,types,valueSetResources}.ts`
— a missing upstream devDependency, in files **none of the patches touch**.
No patch-related type errors.

`vendor/` is excluded from the repository `tsconfig.json`, so the app's own
typecheck is unaffected (measured: 498 errors before and after, all the
pre-existing `@prisma/client` cascade).

## Upstream behaviours each patch respects

Recorded during R0 verification (`docs/dental-chart/ASSETS.md`, section "(a)"):

- `updateSelectionUI()` is the single funnel for selection changes and already
  ends in `notifyStateChange()` — patches must not add a second notify.
- `onStateChange` callbacks receive **no payload**.
- `destroyOdontogram()` resets **`readOnly = false` and `notesEnabled = false`**,
  and does **not** call `notifyStateChange()`.
- `ALL_TEETH` is **32 permanent numbers only**; primary teeth are a `milktooth`
  flag on slots 11–45, displayed as 51–85 by `getDisplayedToothNumber()`
  (quadrant digit 1→5, 2→6, 3→7, 4→8). Slots 16,17,18, 26,27,28, 36,37,38,
  46,47,48 are `MILKTOOTH_BLOCKED` and can never be primary.

---

## Patch 10 � public re-exports of imperative state functions (P1)

src/index.ts re-exports * from "./App", but App.tsx only re-exported
the upstream imperative functions (clearSelection, getSelectedTeeth, etc.).
The DenToRa extension functions added in patches 1, 5, and 8 (setSelectedTeeth,

esetForPatient, and getToothStates) were exported from src/odontogram.ts
but omitted from src/index.ts.

Because ypes/rao-odontogram.d.ts declares them as ambient exports, sc --noEmit
passed, and unit tests using mocks passed, but Turbopack production compilation
(
pm run build) failed with:
Export resetForPatient doesn't exist in target module and
Export getToothStates doesn't exist in target module.

Fix:
src/index.ts explicitly exports
esetForPatient, getToothStates, and
setSelectedTeeth from ./odontogram.
Guarded by ests/unit/rao-vendor-exports.test.ts (contract and real-module smoke test).

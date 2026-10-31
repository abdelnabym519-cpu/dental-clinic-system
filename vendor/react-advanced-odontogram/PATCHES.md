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

| # | Pri | File(s) | Patch | Status |
| --- | --- | --- | --- | --- |
| 1 | **P0 (i)** | `odontogram.ts`, `OdontogramContext.tsx` | **Controlled selection** — new `setSelectedTeeth()`, `selectedTeeth` prop and `onSelectionChange` callback. | ✅ done |
| 2 | **P0 (ii)** | *(no library change)* | **Findings restricted to the 16 DenToRa conditions.** Enforced in the adapter, not by patching the library — see note below. | ✅ done (adapter) |
| 3 | **P0 (iii)** | `OdontogramContext.tsx`, `OdontogramTopbar.tsx` | **Language switcher hidden; Arabic RTL default.** New `showLanguageSwitcher` prop (default `true`, upstream behaviour); host passes `language="ar"`. | ✅ done |
| 4 | **P0 (iv)** | *(no library change)* | **`readOnly` driven from host RBAC.** The `readOnly` prop already existed and the provider already re-applies it — see note below. | ✅ done (no patch needed) |
| 5 | **P0 (v)** | `odontogram.ts`, `OdontogramContext.tsx` | **Per-patient reset** — new `resetForPatient()`, exposed through the context. | ✅ done |
| 6 | P1 | `package.json` (host) | `dompurify` + `jspdf` added — the library's only two external runtime imports. | ✅ done |
| 7 | P1 | `tsconfig.json` (host) | `vendor` excluded from the repo typecheck. | ✅ done |

---

## Patch 1 — controlled selection (R1a-i)

**`src/odontogram.ts`** — added `setSelectedTeeth(teeth: number[])` next to the
existing `getSelectedTeeth()`. The engine shipped only the *reader*, so a host
could never push a selection in.

- Writes funnel through `updateSelectionUI()`, which already ends in a single
  `notifyStateChange()`. Notifying here too would double-fire.
- `activeTooth` is kept as the first selected tooth, matching the zoom popover's
  "info" path, so the control cards stay consistent.
- Numbers not in `ALL_TEETH` are dropped: a stray number would be invisible in
  the DOM but still reported back by `getSelectedTeeth()`, desyncing the host.

**`src/OdontogramContext.tsx`** — two effects:

- *Push in*: compares the `selectedTeeth` prop against the engine's **current**
  selection (not the previous prop), so it is idempotent and cannot fight the
  engine. When the user clicks a tooth the host echoes the same array back and
  the guard short-circuits instead of re-applying and clobbering `activeTooth`.
- *Pull out*: subscribes to `onStateChange`, re-reads `getSelectedTeeth()` and
  **diffs**, because `onStateChange` carries no payload and fires for every
  edit, not just selection changes. Reading inside the callback is safe —
  `updateSelectionUI()` mutates `selectedTeeth` *before* notifying, and
  `notifyStateChange()` is synchronous.

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
  `ar` as *"Arabic (RTL — UI mirrors, dental/perio charts pinned LTR)"*. The
  host passes `language="ar"`, which the provider already supported in
  controlled mode.

## Patch 4 — `readOnly` from host RBAC (R1a-iv)

**No library change was needed, and patching would have been wrong.** The
provider already accepts `readOnly` and already re-applies it:

```js
// Sync read-only mode
useEffect(() => {
  setReadOnly(readOnlyProp ?? false);
}, [readOnlyProp]);
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

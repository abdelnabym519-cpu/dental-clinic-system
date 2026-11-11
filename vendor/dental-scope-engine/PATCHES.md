# vendor/dental-scope-engine — patch log

Every change to the vendored source is numbered here, with the reason and the
test that pins it. Nothing is patched silently.

Conventions (same as `vendor/react-advanced-odontogram`):

* patches are **additive** wherever possible — a new module beside the upstream
  one beats an edit inside it;
* every patch has a **contract test** that parses this vendored source, so a
  change to the file cannot pass unnoticed;
* the vendor tree is kept out of the app's `tsc` via an ambient declaration plus
  a resolver alias, and is typechecked separately by `typecheck:vendor-3d`.

Upstream commit pinned: `e34d4b986d5439501f23c91cde593f69a3b180b0`.

---

## Patches

| # | File | Change | Why | Test |
| --- | --- | --- | --- | --- |
| **1** | `src/content/**` **DELETED** (20 files) + `src/app/about.ts`, `src/app/guide.ts` deleted; new `src/stubs/educational-text.ts`; 6 modules repointed at it | The content tree is **CC BY-SA 4.0**, not MIT, and carried `canal-counts.json` — clinical data nobody approved. The stub keeps the engine compiling on EMPTY data: no prose, no counts, no sources. | Licence hygiene; `summary` returns `''` not `undefined`, because `Engine.ts` writes it straight to `textContent` and `undefined` would print the English word "undefined" in an Arabic UI. | `tests/unit/dental-scope-licence.test.ts` |

### PATCH 1 — details

Deleted: `src/content/` (canal-counts.json, canalFrequency.ts, content.ts,
descriptionCoverage.ts, developmentAnatomy.ts, feedbackAnatomy.ts,
hyoidAttachments.ts, supportingAnatomy.ts, toothGuides.ts, vesselReferences.ts,
`{de,en,es,la,sv}/structures.json`, `{de,en,es,la,sv}/teeth.json`) plus
`src/app/about.ts` and `src/app/guide.ts`, whose only job was rendering it.

New `src/stubs/educational-text.ts` exports, all EMPTY:

| Export | Stub value | Consumer |
| --- | --- | --- |
| `resolveContent()` | `{ key: null, summary: '', sources: [], facts: [], related: [], guides: [], status: 'placeholder' }` | `Engine.ts:1047`, `ui/DetailPanel.tsx` |
| `canalFrequency()` | `undefined` → its panel does `if (!item) return null` | `ui/CanalFrequency.tsx` |
| `formatPercent()` | `''` | `ui/CanalFrequency.tsx` |
| `frequencyContext()` | `[]` | `ui/CanalFrequency.tsx` |
| `hyoidAttachments()` | `[]` | `ui/HyoidConnections.tsx` |
| `DEVELOPMENT_SOURCES` | `[]` | `ui/DevelopmentControls.tsx`, `ui/GuidedTour.tsx` |
| `HYOID_SOURCES` | `[]` | `ui/HyoidConnections.tsx` |

Types (`ResolvedContent`, `ToothGuide`, `CanalFrequency`, `SourceRef`,
`HyoidAttachment`, `HyoidGroup`) were reconstructed from the **deleted files'
signatures in git history** and from their **consumers'** usage — not invented.

---

## PATCHES 2–7 — `src/engine/dentoraPatches.ts` (NEW, additive)

All six live in one new module rather than being spliced into the 1900-line
upstream `Engine.ts`. `Engine` is imported **type-only**, so there is no
runtime import cycle. The module reaches the engine through four narrow
accessors added to `Engine` (`dentoraEntries`, `dentoraScene`,
`dentoraRenderer`, `dentoraDisposeResources`) instead of casting into private
fields.

| # | Patch | Export | Notes |
| --- | --- | --- | --- |
| **2** | Tooth appearance | `setToothAppearance(engine, fdi, {tint, opacity, rim})`, `clearToothAppearance(engine)` | Traverses `entries` for keys starting `tooth-<fdi>`; `cementum-`/`dentine-`/`pulp-<fdi>` get the SAME status so a "caries on 36" entry cannot light the crown while the roots look healthy. Tints by **multiply**, not `set`, preserving enamel shading. Originals saved on `userData.dentoraBase` so every change is undoable. |
| **3** | Selection OUT | `onToothSelection(cb)`, `fdiFromMeshKey(id)` | Subscribes to the **module-level** zustand store (no React). `tooth-<NN>` → FDI is a **parse, not a lookup**: NN *is* the FDI number (`Engine.ts:313`, `DevelopmentScene.ts:62,305`). De-duplicated; fires immediately with the current selection; returns unsubscribe. |
| **4** | Selection IN | `selectTooth(engine, fdi, opts)`, `focusTooth(engine, fdi)` | Forwards `tooth-<fdi>` to `selectFromUI` / `focus`. |
| **5** | Per-mount isolation | `resetEngine(engine)` | The store is a **module-level singleton**, so one patient's selection survives a remount. Clears appearance + `selectedId`/`selectionRequest`/`hoveredId`/`isolateId`, then `resetToStart()`. |
| **6** | Full dispose | `disposeEngineResources(engine)` | Upstream `dispose()` stops the loop and drops the renderer but **never releases geometries, materials or textures** — every mount leaked GPU memory. Now disposes textures → materials → geometries, including meshes outside `entries` via a scene traverse. Idempotent (`dentoraDisposed`), and wired into `Engine.dispose()`. |
| **7** | Hide chrome, no English | `hideEngineChrome(container)` | `Engine.mount()` builds `div.ds-overlay` (label layer) and `div#ds-hover-info.ds-tip` — the tooltip is fed by `formatTooth`/`nameOf`/`SINUS_NOTE`, i.e. **English text**. Both hidden; `labels` switched off in the store. The React chrome (search, language flags, `TopBar`) lives in `main.tsx`, which we never render. |

### Engine.ts edits (kept minimal)

1. `interface MeshEntry` → `export interface MeshEntry` (so the bridge can type).
2. Import `disposeEngineResources` and call `dentoraDisposeResources()` at the
   end of `dispose()`.
3. Add the four accessors in one clearly-marked block.

### `typecheck:vendor-3d`

`vendor/dental-scope-engine/tsconfig.json` + `npm run typecheck:vendor-3d` —
**0 errors**. Mirrors the existing `typecheck:vendor` (RAO) approach: the app's
root `tsconfig` excludes `vendor/`, so without this the patches would never be
typechecked. `strict: false` matches the style upstream was written against.
Two deliberate exclusions: `src/main.tsx` (the upstream Vite app entry —
nothing imports it, we never render it, and it pulls `@vercel/analytics`) and
`src/vendored-assets.d.ts` (declares the flag-PNG imports used by the chrome).

### Negative controls (`tests/unit/dental-scope-patches.test.ts`, 25 tests)

| Removal | Result |
| --- | --- |
| `export` on `setToothAppearance` | **3 failed** ✓ |
| Rename `dentoraEntries` accessor | **1 failed** ✓ |
| Drop `dentoraDisposeResources()` from `dispose()` | **1 failed** ✓ |
| Reverted | **25 passed** ✓ |

> The accessor control initially **passed when it should have failed**: an
> unanchored `dentoraEntries\s*\(` regex still matched the renamed
> `_removed_dentoraEntries(`. The assertion is now anchored with
> `^\\s{2}<name>\\s*\\(` (`m` flag) and carries a comment not to loosen it.

### Still outstanding (S3 follow-up / S4)

7. **Neutralise `neurovascular.glb`** — `Engine.ts:1108` and `:1251` call
   `loader.load('neurovascular.glb')` and `:77` lists it as a stage. That file
   is CC BY-SA 4.0 (Z-Anatomy) and must never be fetched, so the loader must
   refuse it regardless of how it is reached (see `VENDOR.md`).

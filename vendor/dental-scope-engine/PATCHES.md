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

Planned (S3, each will get a row here):

1. `setToothAppearance(fdi, { tint, opacity, rim })` — a tint over the enamel
   material, applied by traversing meshes whose key starts with `tooth-<fdi>`,
   rather than replacing the material.
2. Selection **out**: subscribe to `src/state/store.ts` `selectedId` and map
   `tooth-NN` → FDI number.
3. Selection **in**: `selectFromUI` / `focus` with the FDI → key mapping.
4. Per-mount isolation / explicit reset between patients.
5. `dispose()` hardening — release geometries, materials and textures.
6. Removal/hiding of the engine's own UI chrome (search, labels panel,
   language flags) so no English text can appear in our build.
7. **Neutralise `neurovascular.glb`** — `Engine.ts:1108` and `:1251` call
   `loader.load('neurovascular.glb')` and `:77` lists it as a stage. That file
   is CC BY-SA 4.0 (Z-Anatomy) and must never be fetched, so the loader must
   refuse it regardless of how it is reached (see `VENDOR.md`).

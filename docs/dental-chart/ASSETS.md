# Dental-chart 3D assets — license research (P1)

**Status: RESEARCH ONLY. No third-party asset has been downloaded, imported or
committed.** This file exists to satisfy rule 1 (license evidence) and to record
the gate decision. Nothing here is committed assets — only findings.

User constraint (2026-10-28): assets must be **100% free, no purchase**.
Re-verified from source on the day of writing (2026-10-30).

---

## Summary: no candidate passes. Recommendation = default plan (procedural).

| #   | Candidate                            | License (verified from source)                                 | Commercial use                      | Actual meshes?                                             | One mesh per tooth class?                                                                                                       | Primary teeth                      | Crown/root separable                                | Verdict                                |
| --- | ------------------------------------ | -------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- | -------------------------------------- |
| 1   | **BodyParts3D 4.0** (DBCLS)          | **CC BY 4.0** — official license page, last updated 2025/02/27 | **Yes** (no NC term)                | Yes (OBJ, reduced + high poly)                             | Tooth concepts exist individually, but the published tooth artifact is **one merged dentition** (`BP22611`, concept `FMA12516`) | **No** — adult male reference only | No — each concept is a single mesh (roots included) | Partial: permanent only, not separable |
| 2   | **Open-Full-Jaw** (diku-dk)          | **CC BY-NC-SA 4.0** — from the repository `LICENSE` file       | **NO — NonCommercial + ShareAlike** | Yes (surface + volume, 17 patients / 29 jaws, teeth + PDL) | Yes (per-tooth meshes + principal axes)                                                                                         | No — adult CBCT                    | Yes (teeth and PDL shipped separately)              | **DISQUALIFIED**                       |
| 3   | **STS-Tooth** (Zenodo 10597292)      | CC BY 4.0 (Zenodo record)                                      | Yes, but consent scope contested    | **No — CBCT volumes + masks, not meshes**                  | n/a                                                                                                                             | Children + adults (2D images)      | n/a                                                 | Unsuitable (not meshes)                |
| 4   | Sketchfab "Human teeth" (A. Antipov) | CC Attribution, **version not shown**                          | Unclear                             | ~15.6k tris                                                | Unlikely — character-mouth asset                                                                                                | No                                 | No                                                  | Unsuitable                             |
| 5   | Meshy community "Tooth"              | CC0                                                            | Yes                                 | AI-generated                                               | No                                                                                                                              | No                                 | No                                                  | Unsuitable — no anatomical validation  |

---

## Finding that changes the decision: Open-Full-Jaw is NonCommercial

The session-2 brief recorded Open-Full-Jaw's license as "NOT verified". It is
now verified, and it is **worse than the paper suggests**:

- The **paper PDF** (arXiv 2209.07576) states `License: CC BY 4.0`.
- The **repository `LICENSE` file** — the artifact that actually governs the
  dataset — is
  **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**.

Verified by fetching `https://raw.githubusercontent.com/diku-dk/Open-Full-Jaw/main/LICENSE`
directly; it opens with "Attribution-NonCommercial-ShareAlike 4.0 International"
and defines `NonCommercial` in Section 1(k). GitHub's own repo metadata also
reports the license as `other`, i.e. not a standard permissive OSI license.

Consequences:

- **NonCommercial** excludes use in a commercial dental practice-management
  product. This alone is disqualifying.
- **ShareAlike** would additionally require derivative works to be licensed on
  the same terms, which is incompatible with the product's licensing.

Open-Full-Jaw was the only candidate with real CBCT-derived, per-tooth,
crown-and-root-capable meshes. With it disqualified, no remaining candidate
covers the requirement.

## BodyParts3D — license verified as clean, coverage is not

License verified from the official page
(`https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html`, last updated
2025/02/27):

> The license for this database is specified in the Creative Commons Attribution
> 4.0 International. […] If you use data from this database, please be sure
> attribute this database as follows: "BodyParts3D, © The Database Center for
> Life Science licensed under CC Attribution 4.0 International"

Permits access, redistribution and derivative works; requires attribution;
**no NonCommercial term, so commercial use is allowed**.

Caveats that matter here:

- **Legacy license contamination.** Older releases and derived artifacts carry
  **CC BY-SA 2.1 Japan** (share-alike) — e.g. the Wikimedia Commons
  `BodyParts3D Tooth.stl` is tagged `CC-BY-SA-2.1-jp`, and BodyParts3D 3.0 OBJ
  files carry that text in their comments. Only the current **4.0** release from
  the official source is safe, and the version used must be recorded.
- **Adult male only.** BodyParts3D is a whole-body adult reference, so it cannot
  supply the **20 primary (baby) teeth** at all.
- **Not separable.** The published tooth artifact is a single merged dentition
  mesh (representation `BP22611`, concept `FMA12516`), and per-concept meshes
  include crown and root in one object. Clinical state colouring needs crown and
  root as separable parts.
- **Reduced-polygon** variants are the practical download; quality unverified.

Net: at best 32 of 52 ids, no primary teeth, no crown/root separation.

## STS-Tooth

Zenodo record 10597292 states `License: cc-by-4.0`. But it ships **CBCT volumes
and segmentation masks, not surface meshes**, so it cannot be dropped into a
glTF pipeline without building a segmentation→mesh extraction pipeline. The
paper describes participant consent for non-commercial academic communication
use, which conflicts with commercial deployment even where the Zenodo license
says CC BY 4.0. Treat as unsuitable.

---

## Recommendation

**Adopt the default plan: improved procedural geometry.** It is 100% free,
requires no attribution, has no license contamination risk, and can cover all 52
ids including primary teeth, with crown and root as separate objects by
construction.

The honest caveat that must accompany it (rule 2): procedural geometry is
**stylized-realistic, not scan-realistic**. It will not look like a scanned or
professionally modelled tooth. It must never be described as photorealistic or
clinically accurate.

## Free-only fallbacks (no purchase, no commission)

- **(a) User-supplied set carrying a free license.** If the user can supply
  per-tooth meshes (16 permanent classes + 10 primary classes, crown and root
  separable) with a written license permitting commercial use, we will adopt
  them. Each file still needs its own entry above and an attribution record.
- **(b) Improved procedural geometry — the default**, as recommended.

## Required attribution if (a) is later adopted

If a CC BY asset is adopted, an in-app **Credits** page must carry the exact
attribution text verbatim, e.g. for BodyParts3D:

    BodyParts3D, © The Database Center for Life Science licensed under
    CC Attribution 4.0 International

plus the release/version used and the date checked.

---

**Awaiting the user's choice. No asset has been downloaded into the repo.**

---

# R0 — adoption verification (read-only)

**Direction under evaluation:** replace both current charts with
`Yoosseph/dental-scope` (3D) and `ZoliQua/React-Advanced-Odontogram` (2D).

**Status of this document:** facts gathered read-only from the two upstream
repositories on 2026-10-31. **No file was downloaded into this repository, no
code was written, and no adoption recommendation is made here.** P2 step 5
(primary crowns) is **paused**; nothing in the current charts has been deleted.

Checked at commit: `Yoosseph/dental-scope@main` (pushed 2026-10-26) and
`ZoliQua/React-Advanced-Odontogram@main` (pushed 2026-10-28, npm v2.8.0).

---

## A. Yoosseph/dental-scope (3D)

Repo: <https://github.com/Yoosseph/dental-scope>

### (a) LICENSE, CREDITS.md, docs/assets.md

The repository carries **three different licences**, stated in `LICENSE` itself
("This licence covers the source code only. Other parts of the repository are
licensed separately"):

| Part | Licence | Where stated |
| --- | --- | --- |
| Source code | **MIT** — "Copyright (c) 2026 Yoseph and Dental Scope contributors" | `LICENSE` |
| 3D models in `public/models/` | **CC BY-SA 2.1 Japan** | `LICENSE`, `CREDITS.md`, `docs/assets.md` |
| Educational text in `src/content/` | **CC BY-SA 4.0** | `LICENSE` |
| `public/models/neurovascular.glb` | **CC BY-SA 4.0** (Z-Anatomy derivation) | `CREDITS.md` |

- **BodyParts3D release used: "BodyParts3D 3.0 (DBCLS)"** — `docs/assets.md`
  and confirmed in `public/models/manifest.json` (`source` field).
- Original distribution:
  <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- Verbatim STL mirror used by the pipeline:
  <https://github.com/Kevin-Mattheus-Moerman/BodyParts3D> (code MIT, content
  CC BY-SA 2.1 JP)
- **Required attribution (verbatim, `docs/assets.md`):**
  "BodyParts3D, © The Database Center for Life Science licensed under
  CC Attribution-Share Alike 2.1 Japan"
- **Share-alike (verbatim, `docs/assets.md`):**
  "All derived assets in `public/models/` are distributed under the same licence"
- Derived images: `public/og-image.png` "carries the same licence and attribution".

**On the ShareAlike obligation if the GLBs are modified and shipped inside an
app — two things are recorded, and neither is resolved here:**

1. *What the project says.* dental-scope states that derived assets carry the
   same licence. `CREDITS.md` also states that CC BY-SA 2.1 JP
   "allows adaptations to be shared under a later version of the same licence",
   which is the stated basis for releasing `neurovascular.glb` under CC BY-SA 4.0.
2. *A licence conflict that already exists in our own notes.* The P1 section
   above recorded BodyParts3D's own site as **CC BY 4.0 (no ShareAlike)**, last
   updated 2025/02/27
   (<https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html>). dental-scope
   asserts the older **CC BY-SA 2.1 JP**, sourced through the Kevin-Mattheus-Moerman
   mirror rather than DBCLS directly. Which licence actually governs the STLs, and
   whether ShareAlike reaches a host application as opposed to only the derivative
   model file, are **legal determinations, not engineering ones**. This document
   records the wording; it does not conclude.

### (b) `public/models` per-tooth GLBs

**Files and sizes** (from `public/models/manifest.json` `files` map, 35 entries):

| File | Size |
| --- | --- |
| `core.glb` | 6.09 MB |
| `context.glb` | 0.98 MB |
| `neurovascular.glb` | 0.37 MB |
| `manifest.json` | 0.29 MB |
| `teeth/` (32 files) | 44.08 MB |
| **Total** | **51.52 MB** |

Per-tooth files range 0.52 MB (`tooth-11.glb`) to 3.32 MB (`tooth-46.glb`).

**Triangle counts** (`docs/assets.md` asset table, 165 rows, 1,610,184 total):

- 32 `tooth-XX` outer meshes in `core.glb`: **978,584 triangles**, average
  **30,581**, range 18,384 (`tooth-31`) to 52,568 (`tooth-15`).
- Third molars (18, 28, 38, 48) have **no FMA source** (table shows "—") and
  triangle counts identical to their second molars — `docs/assets.md`:
  "Third molars (18, 28, 38, 48) — copy of the second molar of the same quadrant,
  scaled to 90 % and moved distally along the arch."

**Enamel / dentin / cementum / pulp — separate meshes or separate materials?**

**Separate meshes.** `docs/assets.md`:

> Plus 32 tooth assets in `teeth/tooth-XX.glb` (provenance `modeled`), each
> containing enamel, coronal and radicular dentin, cementum, periodontal
> ligament, pulp chamber and one mesh per root canal, derived from the
> corresponding tooth mesh above.

Confirmed in `manifest.json` — `teeth["11"].layers` is
`["enamel","dentin-coronal","dentin-radicular","cementum","pdl","pulp-chamber","canal-single"]`,
and there are 7 distinct layer sets across the dentition. Example root/canal
configurations from `manifest.json`:

- `tooth-16`: mesiobuccal [`canal-mesiobuccal-1`, `canal-mesiobuccal-2`],
  distobuccal [`canal-distobuccal`], palatal [`canal-palatal`]
- `tooth-36` / `46`: mesial [`canal-mesial-1`, `canal-mesial-2`], distal [`canal-distal`]
- `tooth-11`: single [`canal-single`]

**Provenance of all 32 teeth is `schematic`, not `source`** (`manifest.json`).
`docs/assets.md` defines `modeled` as "Internal tooth anatomy generated inside
the real tooth shape with simplified, approximate proportions (**not
measured**)".

**Axis / scale conventions** (`public/models/manifest.json`, top level):

```
units: "cm"    up: "+Y"    anterior: "+Z"    patientLeft: "+X"
source: "BodyParts3D 3.0 (DBCLS), CC BY-SA 2.1 JP"    generated: "2026-10-04"
```

Note: `patientLeft: "+X"` means patient-right is **negative X**, which is the
same handedness DenToRa already uses (right quadrants at X < 0). Example from
`manifest.json`: `tooth-11` (right) bounds X −0.9179 … −0.079 cm (~8.4 mm wide).

**Primary-tooth asset: none exists.**

- `manifest.json` contains **0** meshes whose key starts with `development`, and
  **0** meshes matching primary FDI 51–85.
- A `primary-teeth` **category** exists in `src/anatomy/categories.ts`, and
  `src/anatomy/registry.ts` registers primary teeth with
  `provenance: 'schematic'`, but there is no shipped geometry for them.
- `docs/dentition-development.md` describes how they appear at runtime:

  > The scene uses 20 primary and 28 permanent tooth definitions. **Primary
  > molars use resized adult molar templates at their successor premolar sites;
  > other primary teeth use resized corresponding adult crowns.**
  > **These visuals are not selectable**; the adult atlas retains its normal
  > picking, labels and dissection tools.
  >
  > [...] ages, bilateral symmetry, predecessor removal at eruption onset,
  > placements, shapes, root lengths and craniofacial proportions are
  > **schematic display conventions, not fitted pediatric anatomy. No
  > age-specific pediatric imaging is bundled.**

So primary teeth are resized copies of adult crowns, are not selectable, and
are explicitly labelled schematic by the upstream project.

### (c) How the engine exposes material overrides, picking and camera

Source: `src/engine/Engine.ts` (1810 lines), `src/state/store.ts`,
`src/engine/materials.ts`, `src/ui/App.tsx`.

**Shape of the API.** `Engine` is an imperative class, *not* a React component:

```ts
export class Engine {
  readonly registry: Registry
  readonly scene: THREE.Scene          // public
  rig!: CameraRig                      // public
  mount(container: HTMLElement)        // imperative DOM mount
  dispose()
  loadAll()
  ensureTooth(fdi: number): Promise<void>
  selectFromUI(id, opts): Promise<void>
  focus(id, opts)
  setView(p: ViewPreset)
  boundsOf(id, visibleOnly, restPose?): THREE.Box3
}
```

Host pattern (`src/ui/App.tsx`):

```tsx
const { engine, registry } = useServices()
useEffect(() => {
  engine.mount(stage.current!)
  const stop = startRouter(engine, registry)
  return () => { stop(); engine.dispose() }
}, [engine, registry])
```

**State coupling.** The engine imports a module-level singleton zustand store
directly (`src/state/store.ts`: `export const store = createStore<AppState>()(...)`).
It writes selection into it; it does not emit events.

**Reporting the selected tooth to a host.** On `pointerup`, `this.pick()`
returns a **string mesh key** (e.g. `"tooth-11"`, *not* an FDI number), then
`actions.select(hit)` writes `selectedId` to the store. A host reads it with
`useApp((s) => s.selectedId)` or `store.subscribe(...)`.
**There is no callback prop and no event emitter.** Converting the mesh key to
an FDI number uses `toothFdiOfMesh()`, which is `private`.

**Receiving a selection from a host.** `engine.selectFromUI(id, { focus, reveal })`,
`engine.focus(id, opts)`, or `actions.select(id)`.

**Per-structure material override / tinting a tooth by clinical state — no
supported API exists.**

- `private entries = new Map<string, MeshEntry>()` holds every mesh and its
  `TissueMaterial`. It is **private**.
- Materials are derived, not assigned: `styleKeyFor(meshKey, cats)` →
  `styleFor(key)` → `createTissueMaterial(styleKey)`; `TissueMaterial` is a
  `THREE.MeshPhysicalMaterial` with `userData: { fx, styleKey }`.
- The only public mutators are theme/visibility driven:
  `applyThemeToMaterial(mat, theme)`, `setMaterialOpacity(mat, opacity)`,
  `highlightColor(mat, hover)` with fixed constants (`HIGHLIGHT = #3346f0`,
  `HOVER = #8f9bff`).
- Therefore a host wanting to tint by clinical state must either traverse
  `engine.scene` (public) to find meshes, or fork `Engine.ts`.

**Camera.** `engine.rig` (a `CameraRig`) is public. Higher-level helpers:
`engine.setView(preset)`, `engine.focus(id, { restPose })`,
`engine.boundsOf(id, visibleOnly, restPose)`.

### (d) Cost of vendoring the engine into a Next 16 client component

| Factor | Finding |
| --- | --- |
| npm availability | `package.json` has `"private": true` — **not published**. Vendoring = copying `src/`. |
| React | `react ^19.3.0` / `react-dom ^19.3.0` — compatible with Next 16 / React 19. |
| Runtime deps to add | `three ^0.186.1`, `three-mesh-bvh ^0.9.15`, `zustand ^5.0.15`. |
| meshopt decoder | GLBs are meshopt-compressed. The decoder is imported from `three/examples/jsm/libs/meshopt_decoder.module.js` — **it ships inside three, so no extra npm package is needed at runtime**. The `meshoptimizer` package is a **devDependency** for the compress pipeline only. |
| Initial payload | 3 stages, loaded in order: `core.glb` 6.09 MB + `context.glb` 0.98 MB + `neurovascular.glb` 0.37 MB = **7.44 MB**. |
| Lazy payload | 32 detailed per-tooth GLBs, **44.08 MB** total (~1.38 MB each), loaded on demand via `ensureTooth(fdi)`; tooth 36 is prefetched at idle. |
| SSR | Vite-only (`vite.config.ts`, `index.html`, `src/main.tsx`). No SSR path. `mount(container)` needs the DOM and the engine touches `window`/`document` → must be a client component with `ssr: false`. |
| Assets | Must be served from a public path (currently `public/models/`) — 51.52 MB. |

---

## B. ZoliQua/React-Advanced-Odontogram (2D)

Repo: <https://github.com/ZoliQua/React-Advanced-Odontogram> ·
npm: `react-advanced-odontogram` v2.8.0

### (e) LICENSE and the tooth SVG art

- **Repository/package licence: MIT** — `LICENSE`, "Copyright (c) 2026 Zoltán Dul".
- **The tooth artwork is NOT third-party.** `THIRD-PARTY-NOTICES.md` §1:

  > The point most often asked about: **the tooth drawings are not third-party
  > assets.**
  >
  > - Every SVG in `src/assets/teeth-svgs/` (classic and `measured/`) and
  >   `src/assets/icon-svgs/` is original work by Zoltán Dul, and each file
  >   carries its own in-file notice: `Created by Zoltan Dul in 2026 - free to
  >   use with MIT license`. They are covered by the MIT License, commercial use
  >   included.
  > - The `measured` profile's templates are **generated** by `tools/toothgen`
  >   from six hand-drawn donor SVGs in `tools/toothgen/source/`, which are
  >   likewise original work in this repository.
  > - `tools/toothgen/spec.py` cites published anatomy figures (`Fig. 32a
  >   (p. 49)`, `Bild 91 (p. 113)`, Wheeler / Ash & Nelson means, and the
  >   *Odontographie* plate grid). These are cited as the source of
  >   **measurements** [...] **No external illustration is traced or
  >   reproduced**; the drawn geometry is generated over this repository's own
  >   donors.
  > - Parts of the `measured` anatomy originated in third-party **forks of this
  >   MIT-licensed project** [...] Those forks carry this repository's unchanged
  >   MIT License and copyright notice; no separate or additional rights are
  >   asserted over them.

  So `tools/toothgen` carries **no separate licence or attribution of its own**;
  it is MIT like the rest, and the cited anatomy texts are acknowledged as
  measurement sources only.

- **Additional obligations a redistributor inherits** (`THIRD-PARTY-NOTICES.md` §2–3),
  beyond the MIT code:
  - Roboto **subset** (Apache-2.0, © Google Inc.), base64-embedded in `src/fonts/roboto.ts`
  - Noto Naskh Arabic **subset** (SIL OFL 1.1), lazy-loaded — `src/fonts/notoArabic.ts`
  - Noto Sans SC **subset** (SIL OFL 1.1), lazy-loaded — `src/fonts/notoSC.ts`
  - Runtime deps: `jspdf` (MIT), `DOMPurify` (MPL-2.0 **or** Apache-2.0)
  - `react` / `react-dom` are **peer** dependencies, `^18 || ^19`
  - The notice file states: "if you redistribute this library, ship this file too"
  - It also self-declares: "This is an engineering inventory, not legal advice."

### (f) Public API

**Entry point.** `src/index.ts` → `export default App` and
`export { App as OdontogramShell }`. Props are
`Omit<OdontogramProviderProps, "children">` (`src/OdontogramContext.tsx`).

The props type states the governing contract:

> All state/behavior props are optional: when omitted the provider operates in
> **standalone** mode with internal state; when provided it operates in
> **controlled** mode and delegates state to the parent.

**Does it emit a selection-change event? Does it accept a controlled selected
tooth?**

| Question | Answer | Evidence |
| --- | --- | --- |
| Read selection | **Yes** — `getSelectedTeeth(): number[]` | "The currently selected teeth, as FDI numbers, in the order they were added to the selection. Empty when nothing is selected. Returns a fresh array." |
| Selection-change event | **Partial** — `onStateChange(cb: () => void): () => void` | "Callback invoked on each change." It fires after *any* tooth state edit, edentulous toggle, import, or session-setting change — **not only selection**. **The callback receives no payload**; the host re-reads `getSelectedTeeth()` and diffs. There is **no `onSelectionChange`**. |
| Controlled selected tooth | **No** | The `OdontogramProviderProps` list ends at `children` with **no `selectedTooth` / `onSelectionChange` prop**. Every `set*ForSelection(...)` (≈25 of them) writes a *finding* to whatever is currently selected; **nothing sets the selection itself**. A host therefore cannot programmatically drive "select tooth 36". |

**Resetting state per patient (module-level singleton).** The engine is a
module-level singleton (`src/odontogram.ts`, ~8,800 lines of module state).

- `initOdontogram()` / `destroyOdontogram()` — lifecycle.
- `resetMouth()` — clears the whole mouth; `resetTooth()` — clears the current
  selection.
- Module-level state also includes `planEditedTeeth: Set<number>`, described as
  "Runtime-only — NEVER serialized [...] Cleared whenever the plan is
  (re)initialized, reset, or replaced by an import".
- Consequence: switching patients requires `destroyOdontogram()` +
  `initOdontogram()` (or at minimum `resetMouth()`), and **two mounted instances
  would share the same module state**.

**setReadOnly.** Both approaches exist:

- Prop: `readOnly?: boolean` — "When true, disables all interactions (click,
  touch, keyboard). Useful for print/report/view modes."
- Imperative: `setReadOnly(value: boolean)` and `getReadOnly(): boolean`.

**Language: default Arabic, and hiding the language switcher.**

- Arabic **is supported**: `Language` includes `"ar"` —
  "Arabic (RTL — UI mirrors, dental/perio charts pinned LTR)".
- Controlled via prop `language?: Language` with
  `onLanguageChange?: (lang: Language) => void`.
- **The default is English, not Arabic**: `export const FALLBACK_LANGUAGE: Language = "en"`
  and the doc comment says it is "the one the UI starts in". Arabic must be
  passed explicitly.
- Only English is bundled statically; every other language is a separate chunk
  fetched the first time it is selected.
- **Hiding the language switcher: no prop exists.** The menu is hardcoded in
  `src/surfaces/OdontogramTopbar.tsx` as `<div id="languageMenu" ...>` listing all
  12 languages. A host would have to (i) hide it with CSS on `#languageMenu`,
  or (ii) pass `language="ar"` and re-assert it inside `onLanguageChange`
  (controlled mode) so user changes are neutralised.

**Theming via `--odon-*` variables.** Yes.

- Prop `themeConfig?: OdontogramThemeConfig` (from `src/theme.ts`):
  - `colors`: `background`, `panel`, `card`, `text`, `muted`, `line`, `accent`, `accent2`
  - `tooth`: `body`, `dentin`, … ("an omitted key leaves that surface exactly as drawn")
  - `tokens`: **open-ended** — "Every token [...] can be set by name through
    `OdontogramThemeConfig.tokens`"
- Applied by `applyThemeConfig(element, config)`, which sets/removes inline CSS
  custom properties on the root element.
- **37 distinct `--odon-*` variables** exist in `src/index.css`
  (`--odon-bg`, `--odon-panel`, `--odon-card`, `--odon-text`, `--odon-muted`,
  `--odon-line`, `--odon-accent`, `--odon-accent2`, `--odon-tooth-body`,
  `--odon-tooth-cusp`, `--odon-tooth-dentin`, `--odon-caries`, `--odon-gum`,
  `--odon-bone`, `--odon-pulp-healthy`, `--odon-select-rgb`,
  `--odon-select-border-style`, …).
- The artwork consumes them as fallbacks, e.g.
  `fill: var(--odon-tooth-body, #ebebeb)`.

### (g) Can the finding/condition palette be restricted?

**Partially. There is no arbitrary per-condition filter.**
No `allowedFindings` / `disabledFindings` / `hiddenFindings` / `findingFilter`
exists anywhere in the source.

What *can* be restricted:

1. **Granularity props** — `pulpDetailLevel` (`simple`/`aae`/`latin`),
   `secondaryCariesMode` (`simple`/`standard`/`full`),
   `rootCariesMode` (`simple`/`severity`),
   `radiographicDepthMode` (`off`/`threeLevel`/`detailed`),
   `wearDetailLevel` and `discolorationDetailLevel` (`simple`/`complex`),
   `surfaceNotation` (`simple`/`full`).
2. **Feature toggles** — `enableIcdas`, `cariesDepthEnabled`,
   `fissureSealingEnabled`, `fillingDefectEnabled`, `enableNotes`, and
   `fillingMaterialAvailability` (`Record<material, boolean>` over
   `amalgam | composite | gic | temporary`). Imperative equivalents:
   `setIcdasEnabled`, `setCariesDepthEnabled`, `setFissureSealingEnabled`,
   `setFillingDefectEnabled`, `setSnomedEnabled`, `setNotesEnabled`.
3. **Whole-panel visibility** — `showStatusCard`, `showOrthoCard`, `toothInfo`.
4. **Extension** — `plugins?: OdontogramPlugin[]` (base / restoration / overlay
   layers) and `toothTemplates?: ToothTemplateOverrides` to replace the factory
   tooth artwork.

What **cannot** be done: removing an individual finding (for example hiding
caries entirely, or dropping orthodontics while keeping the rest of its card).

### (h) Mapping to DenToRa's `DentalChartEntry`

DenToRa source of truth: `components/dental-chart/types/odontogram.ts`

- `ToothSurfaceKey = 'mesial' | 'distal' | 'occlusal' | 'buccal' | 'lingual'` — **5 surfaces**
- `DentalCondition` — **16 values**: `HEALTHY, CARIES, FILLED, CROWN, BRIDGE,
  IMPLANT, ROOT_CANAL, EXTRACTION, EXTRACTION_NEEDED, MISSING, FRACTURED,
  SENSITIVE, MOBILITY, ABSCESS, PERIODONTAL, VENEER`
- `SeverityLevel = 'MILD' | 'MODERATE' | 'SEVERE'`
- `DentalChartEntryRecord` carries the 5 surfaces as **booleans**, plus
  `condition: string`, `severity: string`, `notes`, dates.

**No clinical decisions are made below. This is a vocabulary mapping only.**

#### Surfaces — 1:1

| RAO surface | DenToRa surface | Note |
| --- | --- | --- |
| `occlusal` | `occlusal` | RAO always **stores** `occlusal`; displays "incisal" on anteriors in `full` notation |
| `mesial` | `mesial` | |
| `distal` | `distal` | |
| `buccal` | `buccal` | |
| `lingual` | `lingual` | RAO displays "palatal" on upper lingual in `full` notation |

⚠️ RAO's **periodontal** model uses **6 sites**, not 5:
`PERIO_SITES = ["MB","B","DB","ML","L","DL"]` — **no DenToRa equivalent**.

#### Conditions — RAO finding → DenToRa

| RAO axis | RAO values | → DenToRa | Fit |
| --- | --- | --- | --- |
| `toothSelection` | `implant` | `IMPLANT` | direct |
| `toothSelection` | `no-tooth-after-extraction` | `MISSING` | direct-ish |
| `toothSelection` | `tooth-base` | `HEALTHY` | implicit only |
| `toothSelection` | `tooth-under-gum` | — | **no DenToRa equivalent** |
| `toothSelection` | `milktooth` | — | **no DenToRa equivalent** (primary dentition marker) |
| `extractionPlan` | (boolean) | `EXTRACTION_NEEDED` | direct |
| `extractionWound` | (boolean) | — | **no DenToRa equivalent** |
| `caries` (per surface) | `caries-buccal/mesial/distal/occlusal/lingual` | `CARIES` + 5 surface booleans | direct, surface-carrying |
| `caries` | `caries-subcrown` | `CARIES` | surface not representable |
| `rootCaries` | `active`/`arrested`/`active-cavitated` | `CARIES` | activity/arrest nuance lost |
| `fillingMaterial` | `amalgam`/`composite`/`gic`/`temporary` | `FILLED` | material lost |
| `restorationType` | `crown` | `CROWN` | direct |
| `restorationType` | `bridge` | `BRIDGE` | direct |
| `restorationType` | `veneer` | `VENEER` | direct |
| `restorationType` | `inlay` | `FILLED` (nearest) | **no exact DenToRa equivalent** |
| `restorationType` | `onlay` | `FILLED` (nearest) | **no exact DenToRa equivalent** |
| `restorationMaterial` | `emax`/`gold`/`gradia`/`zircon`/`metal`/`metal-ceramic`/`telescope`/`temporary` | — | **no DenToRa equivalent** |
| `endo` | `endo-filling` | `ROOT_CANAL` | close |
| `endo` | `endo-medical-filling` | `ROOT_CANAL` (partial) | nuance lost |
| `endo` | `endo-filling-incomplete` | `ROOT_CANAL` (partial) | nuance lost |
| `endo` | `endo-glass-pin` / `endo-metal-pin` | — | **no DenToRa equivalent** |
| `pulpDx` | `normal`/`reversible-pulpitis`/`irreversible-pulpitis`/`necrosis` | — | **no DenToRa equivalent** |
| `pulpLatin` | 10 values | — | **no DenToRa equivalent** |
| `apicalDx` | `acute-apical-abscess`/`chronic-apical-abscess` | `ABSCESS` | close |
| `apicalDx` | `symptomatic-`/`asymptomatic-apical-periodontitis` | `PERIODONTAL` (nearest) | conflates periapical with periodontal |
| `apicalDx` | `condensing-osteitis` | — | **no DenToRa equivalent** |
| `mobility` | `m1`/`m2`/`m3` | `MOBILITY` | grade could ride on `severity` |
| `mods` | `parodontal` | `PERIODONTAL` | direct |
| `mods` | `inflammation` | — | **no DenToRa equivalent** |
| `toothSubstrate` | `broken` | `FRACTURED` | close |
| `toothSubstrate` | `crownprep` | — | **no DenToRa equivalent** |
| `toothSubstrate` | `radix` | — | **no DenToRa equivalent** (retained root) |
| `resorptionType` | `internal`/`external-cervical` | — | **no DenToRa equivalent** |
| `wearEdge` | `attrition`/`erosion` | — | **no DenToRa equivalent** |
| `wearCervical` | `abrasion`/`abfraction`/`erosion` | — | **no DenToRa equivalent** |
| `discoloration` | `tetracycline`/`fluorosis`/`nonvital`/`extrinsic`/`other` | — | **no DenToRa equivalent** |
| `prosthesis` | `healing-abutment`/`locator`/`locator-denture`/`bar`/`bar-denture`/`removable-partial`/`removable-full` | — | **no DenToRa equivalent** |
| `periImplant` | `mucositis`/`peri-implantitis-mild`/`-moderate`/`-severe` | — | **no DenToRa equivalent** |
| `orthoAppliance` | `bracket`/`band` | — | **no DenToRa equivalent** |
| `orthoDrift` | `mesial`/`distal` | — | **no DenToRa equivalent** |
| `orthoVertical` | `extrusion`/`intrusion` | — | **no DenToRa equivalent** |
| `radiographicDepth` | `E1`/`E2`/`D1`/`D2`/`D3` | — | **no DenToRa equivalent** |
| `fillingDefect` | `marginal`/`fracture`/`wear` | — | **no DenToRa equivalent** |
| fissure sealing | (boolean) | — | **no DenToRa equivalent** |
| perio charting (6 sites) | PPD / BOP / recession / furcation / plaque / CAL | `PERIODONTAL` only | **no DenToRa equivalent** for site-level data |
| notes | (string) | `notes` | direct |

#### DenToRa conditions with **no RAO source**

| DenToRa condition | Closest RAO | Note |
| --- | --- | --- |
| `EXTRACTION` (the act) | `extractionWound`, `no-tooth-after-extraction` | RAO models the *result*, not the procedure |
| `SENSITIVE` | **none found** | no sensitivity axis in RAO's vocabulary |
| `HEALTHY` | implicit (`tooth-base`, all findings `none`) | not an explicit RAO finding |

#### Summary of the gap

- DenToRa has **16** conditions; RAO models a **much larger** clinical vocabulary
  (≈29 `DX_CODES` diagnoses plus ~20 recordable axes).
- **The mapping is lossy in the RAO → DenToRa direction**: roughly two-thirds of
  RAO's recordable findings (pulp diagnoses, wear, discoloration, resorption,
  prosthetics, peri-implantitis, orthodontics, perio site data, restoration
  materials) have **no place** in `DentalChartEntry` as it is currently defined.
- Only **2** DenToRa conditions lack any RAO source (`EXTRACTION`, `SENSITIVE`),
  and `HEALTHY` is implicit rather than explicit.

---

## R0 status

- P2 step 5 (primary crowns) — **paused**, no code written.
- Nothing deleted from the current charts.
- **No adoption recommendation is made here.** Awaiting your decision.

---

# R0 follow-up — deep verification (read-only)

Follows the acceptance of R0. Facts only, with source URLs and quoted text.
**No legal conclusion is drawn in section (c).** No asset downloaded, nothing
deleted. Tip at time of writing: `4b78e2c`.

## (a) React-Advanced-Odontogram — selection events and reset semantics

### Does a tooth selection trigger `onStateChange`? — **Yes.**

`updateSelectionUI()` in `src/odontogram.ts` ends with `notifyStateChange()`,
and it is the funnel for selection:

```js
function updateSelectionUI(){
  $$(".tooth-tile").forEach(tile => {
    const toothNo = Number(tile.dataset.tooth);
    const isSelected = selectedTeeth.has(toothNo);
    tile.classList.toggle("active", isSelected);
    if(tile.hasAttribute("role")) tile.setAttribute("aria-selected", String(isSelected));
  });
  updateSelectionFilterButtons();
  updateActiveLabel();
  if(activeTooth && selectedTeeth.has(activeTooth)){
    setControlsEnabled(true);
    syncControlsFromState(toothState.get(activeTooth));
  }else{
    syncControlsFromState(defaultState());
    setControlsEnabled(false);
  }
  // The declarative control cards re-read via onStateChange, so a selection
  // change (new active tooth) must notify — otherwise a card would keep showing
  // the previously-active tooth's state. Selection funnels through here and the
  // edit path (applyToSelected) notifies on its own, so this adds no double-fire.
  notifyStateChange();
}
```

Every selection write path mutates `selectedTeeth` **first**, then calls
`updateSelectionUI()` — so by the time listeners run, the new selection is
already in place. Confirmed on the touch-zoom path too (`selectBtn` /
`infoBtn` handlers both call `updateSelectionUI()`).

### Can selection be read synchronously after the event? — **Yes.**

`notifyStateChange()` (`src/state/notify.ts`) is a plain synchronous loop:

```js
export function notifyStateChange(){
  for(const cb of stateChangeListeners){
    try{ cb(); }
    catch(e){ console.error("odontogram state-change listener failed", e); }
  }
  try{ postNotifyHook?.(); }
  catch(e){ console.error("odontogram bridge overlay render failed", e); }
}
```

So inside the listener, `getSelectedTeeth()` already returns the **new**
selection. Two caveats:

- The callback receives **no payload** (`cb: () => void`), so a host must
  re-read `getSelectedTeeth()` and diff to know what changed.
- `onStateChange` fires for **every** edit, edentulous toggle, import and
  session-setting change — not only selection — so every fire costs a diff.
- `postNotifyHook?.()` (the bridge-overlay redraw) runs **after** all listeners.

`getSelectedTeeth()` returns `Array.from(selectedTeeth)` — a fresh array, so
mutating it is safe.

### What exactly resets — `resetMouth()` vs `destroyOdontogram()` + `initOdontogram()`

**`resetMouth()`** (verbatim doc comment: "Reset the WHOLE mouth to a blank
slate") does:

1. `setEdentulous(false)`
2. `resetCaseMeta()` — case-level patient metadata
3. For every tooth in `ALL_TEETH`: `toothState.set(toothNo, defaultState())`,
   `applyStateToSvg(toothNo)`, `updateToothTileNumber(toothNo)`
4. Re-syncs the active tooth's controls if one is active
5. `notifyStateChange()` once at the end

Per-tooth periodontal data **is** cleared by this, because perio lives inside
the per-tooth record — `src/state/payload.ts`:

> Per-tooth, per-site periodontal probing data — deliberately a SEPARATE
> sub-record from the 5-surface caries maps above (perio sites are a different
> geometry: 6 fixed probing points, not tooth surfaces).

**`resetMouth()` does NOT reset:** the selection (`selectedTeeth` /
`activeTooth`), session settings (numbering system, ICDAS, caries/pulp/wear/
discoloration detail levels, surface notation), `readOnly`, `notesEnabled`,
theme, or the plan/edited-teeth bookkeeping.

**`destroyOdontogram()`** does (in order): `initialized = false`; `initToken++`;
`teardownBridgeOverlayResize()`; removes the `document` click and grid touch
listeners; unsubscribes i18n; clears `#toothGrid.innerHTML`; removes the arch
toggle bar; hides zoom popover / context menu / note editor; clears the
long-press timer; `pinchScale = 1`, `isPinching = false`, `archMode = "both"`;
**`readOnly = false`**; **`notesEnabled = false`**; `pluginOverlays.clear()`;
`charts.status.clear()`; `charts.plan.clear()`; `setPlanInitialized(false)`;
`planEditedTeeth.clear()`; `pendingDualStateConfirm = null`;
`setActiveChartMode("status")`; `resetCaseMeta()`; clears the four DOM maps
(`toothSvgRoot`, `toothTile`, `toothLabelUpper`, `toothLabelLower`); and
**`selectedTeeth = new Set(); activeTooth = null`**.

**⚠️ Two consequences for a per-patient reset:**

1. `destroyOdontogram()` resets **`readOnly = false` and `notesEnabled = false`**
   (it resets "the whole case"). A host must **re-apply** `setReadOnly()` /
   `setNotesEnabled()` after every `initOdontogram()`.
2. `destroyOdontogram()` does **not** call `notifyStateChange()`, so subscribers
   are not told about the teardown.
3. `initOdontogram()` is idempotent (`if(initialized) return;`) and calls
   `notifyStateChange()` at the end.

### ⚠️ Blocking finding for R1a: the library has no FDI 51–85 teeth

```js
// src/anatomy/profiles.ts
export const ALL_TEETH = [
  18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
  48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38
];
```

**32 permanent numbers only.** Primary teeth are **not** separate teeth — they
are a *flag* on the permanent slot. `src/state/numbering.ts`:

> A milk tooth is stored under its permanent FDI number but DISPLAYED with the
> deciduous quadrant digit (1->5, 2->6, 3->7, 4->8), so e.g. permanent 11 shows
> as 51. Non-milk teeth display their own number unchanged.

```js
export function getDisplayedToothNumber(toothNo){
  const s = toothState.get(toothNo);
  if(!s || s.toothSelection !== "milktooth") return toothNo;
  const firstDigit = Math.floor(toothNo / 10);
  const secondDigit = toothNo % 10;
  const mappedFirst = firstDigit === 1 ? 5 : firstDigit === 2 ? 6 : firstDigit === 3 ? 7 : 8;
  return mappedFirst * 10 + secondDigit;
}
```

Constraints found in `src/odontogram.ts`:

- `PRIMARY_MILK` = the **20** positions that may be a milk tooth:
  `11–15, 21–25, 31–35, 41–45`
- `MILKTOOTH_BLOCKED` = the **12** that may not:
  `16,17,18,26,27,28,36,37,38,46,47,48`

So the adapter mapping is **DenToRa 51–85 ↔ library 11–45 + `milktooth` flag**
(subtract 40: 51→11, 55→15, 61→21, 65→25, 71→31, 75→35, 81→41, 85→45).
Display is handled by the library itself via `getDisplayedToothNumber`.

## (b) dental-scope — mesh keys and triangle counts

### Are `tooth-NN` keys the FDI number? — **Yes, verified.**

`public/models/manifest.json` has 32 `tooth-NN` mesh keys and 32 `teeth[NN]`
entries. Each key was cross-checked against FDI semantics (quadrant → arch and
side, position → tooth type): **0 mismatches across all 32.**

| | |
| --- | --- |
| Keys | `11–18, 21–28, 31–38, 41–48` (32, permanent only) |
| Example | `teeth["11"]` → `{arch: "maxillary", side: "right", type: "central-incisor"}` = FDI 11 ✓ |
| `manifest.source` | `"BodyParts3D 3.0 (DBCLS), CC BY-SA 2.1 JP"` |

So `tooth-NN` **is** the FDI number, and `meshOwner`/`toothFdiOfMesh()` only has
to strip the `tooth-` prefix and parse the integer.

### Triangles: initial 7.44 MB vs lazy 44.08 MB

From the `docs/assets.md` asset table (165 rows, 1,610,184 triangles total),
summed by file:

| Stage | File | Meshes | Triangles |
| --- | --- | --- | --- |
| 1 | `core.glb` (6.09 MB) | 44 | **1,231,006** |
| 2 | `context.glb` (0.98 MB) | 45 | **279,546** |
| 3 | `neurovascular.glb` (0.37 MB) | 76 | **99,632** |
| | **Initial total (7.44 MB)** | **165** | **1,610,184** |

- The 32 `tooth-XX` **outer shells** are inside `core.glb` and are already
  counted above: **978,584 triangles** (avg 30,581, range 18,384–52,568).
- **The lazy 44.08 MB (`teeth/tooth-XX.glb`, 32 files) triangle count is NOT
  published** — not in `manifest.json` (which stores only byte sizes per file)
  and not in the asset table (whose `tooth-XX` rows describe the `core.glb`
  shells, not the internal layer meshes). Measuring it would require
  downloading a GLB, which is out of scope until the licence decision in R1b.

**Correction to R0:** the earlier "978,584 triangles" figure is the tooth meshes
only. The real initial-load cost is **1,610,184 triangles**.

## (c) DBCLS BodyParts3D — does the CC BY 4.0 statement cover Release 3.0?

**Recorded as facts. No legal conclusion.**

**The licence page** (<https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html>),
"Last updated : 2025/02/27", quoted verbatim:

> You may use this database in compliance with the terms and conditions of the
> license described below. [...]
>
> The license for this database is specified in the Creative Commons
> Attribution 4.0 International.
>
> If you use data from this database, please be sure attribute this database as
> follows: "BodyParts3D, © The Database Center for Life Science licensed under
> CC Attribution 4.0 International".
>
> With regard to this database, you are licensed to:
> 1. freely access part or whole of this database, and acquire data;
> 2. freely redistribute part or whole of the data from this database; and
> 3. freely create and distribute database and other derivative works based on
>    part or whole of the data from this database,
>
> under the license, as long as you comply with the following conditions:
> 1. You must attribute this database in the manner specified by the author or
>    licensor when distributing part or whole of this database or any adapted
>    material.
> 2. You need to contact the Licensor shown below to request a license for use
>    of this database or any part thereof not licensed under the license.

**Does it name a release?** No. The page says **"this database"** throughout and
carries **no version scoping in either direction** — it does not say "all
releases including earlier ones", and it does not say "current release only".

**Release timeline** — from the Update History page
(<https://dbarchive.biosciencedbc.jp/en/bodyparts3d/update.html>), quoted:

| Date | Update contents |
| --- | --- |
| 2025/02/27 | "License" is updated. |
| 2013/06/19 | 3D data (Release 4.0) is updated. |
| 2011/09/15 | 3D data (Release 3.0) is updated. |
| 2011/08/25 | "License" is updated. |
| 2010/08/16 | 3D data (Release 2.0) is updated. |
| 2009/02/09 | 3D data (Release 1.0) is updated. |
| 2008/08/12 | BodyPart3D (http://lifesciencedb.jp/bp3d/?lng=en) is released. |

**What the download page currently serves** —
<https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html> lists, under
`LATEST/`:

- `isa_BP3D_4.0_obj_99.zip` (136 MB)
- `partof_BP3D_4.0_obj_99.zip` (62 MB)

**Facts that follow, stated without legal interpretation:**

1. **Release 3.0** — the release dental-scope states it uses — dates from
   **2011/09/15**.
2. **Release 4.0** dates from **2013/06/19** and is the release currently
   served under `LATEST/`.
3. The licence page has been updated at least twice: **2011/08/25** (a week
   before Release 3.0 shipped) and **2025/02/27** (the CC BY 4.0 text).
4. The **2025/02/27 CC BY 4.0 statement postdates Release 3.0 by about
   13.5 years** and postdates Release 4.0 by about 11.7 years.
5. At the moment Release 3.0 was published, the operative "License" page was
   the **2011/08/25** state, not the 2025/02/27 one. What that 2011 text said
   is **not recorded on the live site** and was not retrieved here.
6. dental-scope did not take its STLs from DBCLS directly but from the
   Kevin-Mattheus-Moerman mirror, which `CREDITS.md` describes as
   "(Kevin M. Moerman; code MIT, **content CC BY-SA 2.1 JP**)".

**Not concluded here:** whether the 2025/02/27 CC BY 4.0 grant reaches Release
3.0 data retroactively; which licence governed Release 3.0 in 2011; and whether
ShareAlike attaches at all. These are questions for counsel. The practical
observation for engineering is that the DBCLS licence page and dental-scope's
own `CREDITS.md` currently assert **different licences** (CC BY 4.0 with no
ShareAlike vs CC BY-SA 2.1 JP with ShareAlike) for what is described as the
same source.

# Dental Scope

[![Ownit](https://ownit.ownit-worker.workers.dev/badge/Yoosseph/dental-scope.svg)](https://ownit.ownit-worker.workers.dev/Yoosseph/dental-scope)
[![CI](https://github.com/Yoosseph/dental-scope/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Yoosseph/dental-scope/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/website?url=https%3A%2F%2Fdental-scope.com&label=dental-scope.com)](https://dental-scope.com/)
[![Code licence: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Content licence: CC BY-SA 4.0](https://img.shields.io/badge/content-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)
[![3D models licence: CC BY-SA 2.1 JP](https://img.shields.io/badge/3D%20models-CC%20BY--SA%202.1%20JP-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en)
[![Content status: draft, pending expert review](https://img.shields.io/badge/content-draft%2C%20pending%20expert%20review-orange.svg)](docs/content.md)
[![Dental reviewers wanted](https://img.shields.io/badge/dental%20reviewers-wanted-brightgreen.svg)](CONTRIBUTING.md#content-contributions)

**Explore Dental Anatomy in 3D.**

Dental Scope is an open-source, interactive 3D dental anatomy explorer. Start with the whole mouth (jaws, gingiva, the complete permanent dentition, nerves and the temporomandibular joints) and move all the way down to the enamel, dentin, pulp chamber and root canals of a single tooth.

> Educational anatomical reference. Not intended for diagnosis or treatment.

![Dental Scope overview](docs/screenshots/overview.png)

| Inside a tooth | Cross-section through the arch | Dissected anatomy |
|---|---|---|
| ![Root canals of tooth 36](docs/screenshots/tooth-canals.png) | ![Axial section through the lower crowns](docs/screenshots/section-axial.png) | ![Dissected anatomy](docs/screenshots/exploded.png) |

<p align="center"><img src="docs/screenshots/mobile.png" alt="Dental Scope on a phone" width="260"></p>

## Features

- **Mouth → jaw → dentition → tooth → tissue.** One continuous scene; no separate "tooth viewer".
- **All 32 permanent teeth**, individually selectable, named anatomically, with **FDI, Universal and Palmer** numbering (switchable).
- **Inside every tooth:** enamel, coronal and radicular dentin, cementum, periodontal ligament, pulp chamber with pulp horns, and one canal per root in its most common configuration (e.g. MB2 in maxillary first molars, two mesial canals in mandibular first molars). Five dissection levels peel the tooth layer by layer.
- **Dissection** at two levels: the whole mouth (*Dissect anatomy*: jaws apart, gum and teeth lifted off in clean tiers, bone see-through so the nerves and vessels stay where they run) and a single tooth (*Separate layers*: enamel shell, dentin, pulp and canals apart).
- **Cross-sections:** sagittal, coronal, axial or view-aligned planes; inside a tooth they switch to mesiodistal, buccolingual and horizontal. Cut surfaces render as solid tissue, so enamel thickness, dentin and pulp read clearly, across all 32 teeth at once.
- **Search** by name, tooth number in any system (`11`, `#8`, `UR6`, `fdi 36`), tissue, synonym (`gums`, `wisdom tooth`, `IAN`, `cuspid`).
- **Layers** for 19 dental categories with show, show-only, translucent and hide; plus hide/ghost/isolate per structure and a full hierarchy tree.
- **Premium camera:** arcing focus transitions, bounding-box framing, eight view presets including occlusal views, optical centre that stays clear of panels.
- **Labels** that anchor to anatomy, declutter by priority, hide when occluded or too small, and select on click.
- **Deep links:** `/tooth/36`, `/tooth/36/dissect`, `/structure/inferior-alveolar-nerve-left`.
- **Shareable credits popup:** `/credits/` opens the credits over the 3D explorer. Translated links are `/credits/sv/`, `/credits/de/`, `/credits/es/` and `/credits/la/`; relative-base builds use `#/credits/`.
- **English, Swedish, German, Spanish and Latin:** switch with the flags at the top (Latin has no country, so it gets a Roman SPQR vexillum). Everything is translated by hand, including anatomical names, descriptions, search terms and the about page (`/about/sv/`, `/about/de/`, `/about/es/`, `/about/la/`). Add `?lang=sv`, `de`, `es` or `la` to a link to open it in that language. Latin uses Terminologia Anatomica names and a Neo-Latin interface. Translations live in `src/i18n/` and `src/content/<lang>/`.
- **Honest data:** every structure shows whether it is *source*, *derived*, *modeled*, *atlas* or *schematic* geometry; all text shows its review status.
- **Responsive** (bottom sheets on phones), **keyboard-accessible** (tree view, shortcuts, focus rings), **reduced-motion** aware, light and dark themes.
- **Fast:** ≈2.3 MB of geometry for first paint, the rest streams in; ≈367 KB per tooth's internal anatomy on average, loaded on demand; render-on-demand loop.

The dental feedback additions include nerve passage views, a Nerves & muscles transparency preset, sourced canal-count tables for every permanent tooth type, additional cranial nerves and an illustrative TMJ opening control. Scope, sources and the server review checklist are in [docs/feedback-anatomy.md](docs/feedback-anatomy.md).

## Tech stack

Vite · React 19 · TypeScript (strict) · Three.js (imperative engine) · Zustand · glTF + meshopt compression.
Asset pipeline: Python (NumPy, SciPy, scikit-image, trimesh) + glTF Transform.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # unit tests (Vitest)
npm run typecheck
npm run typecheck:tests # TypeScript checks for tests and Vite config
npm run lint       # ESLint (type-aware rules on src/**)
npm run build      # static site in dist/ (includes a 404.html SPA fallback)
npx playwright install chromium # once, for browser tests
npm run test:e2e   # desktop and phone flows against the production build
```

Browser regressions cover selection/dissection Back and Forward, search focus and dismissal, layer scrolling, primary dentition, mobile reading trays, failed-download retry and credits links. CI installs Chromium and runs these after the production build; failed runs retain traces and screenshots in `test-results/`.

The built site is fully static. For a sub-path deployment set `DS_BASE`, e.g. `DS_BASE=/dental-scope/ npm run build`; with a relative base (`DS_BASE=./`) deep links switch to hash URLs (`#/tooth/36`) so the build works from any folder. Set `VITE_DS_REPO_URL` to link the “Made by Yoseph” credit and the About dialog to the repository; when it is unset the credit is plain text, so a build never advertises a private repository. The live site is deployed by Vercel from `main`; set `VITE_DS_REPO_URL` and `DS_SITE_URL` in the Vercel project's environment variables.

Set `DS_SITE_URL` to the public address of the deployment (e.g. `https://user.github.io/dental-scope/`) to add canonical URLs, social-preview tags with `og-image.png`, structured data and `sitemap.xml`. On Vercel, set it in the project's environment variables. Every build also writes `robots.txt` and a static entry page per tooth (`tooth/36/`) so those deep links return their own title and description instead of the 404 fallback. Crawlers only read `robots.txt` at the domain root, so for a project site under a sub-path submit `sitemap.xml` in the search engine's webmaster tools instead.

Every build also writes a text-first guide page for every tooth and structure in all five languages: English at the root (`teeth/36-mandibular-left-first-molar/`), the others under `sv/`, `de/`, `es/` and `la/` with translated slugs (`sv/tander/36-vanster-forsta-molar-i-underkaken/`). A guide page stays `noindex` until its own text reaches 150 words (`MIN_INDEX_WORDS` in `src/app/guide.ts`); only indexable pages go into `sitemap.xml`, with hreflang links between their language versions. Once a tooth's English guide page is indexable, the matching explorer entry page (`tooth/36/`) leaves the index so the two don't compete. Vercel preview deployments (or any build with `DS_PREVIEW=1`) are `noindex` everywhere and `robots.txt` blocks all crawlers.

### Keyboard

`/` search · `Esc` clear / leave tooth · `F` focus · `I` isolate · `H` hide · `G` ghost · `D` inside tooth · `[` `]` dissection level · `E` dissect anatomy / separate tooth layers · `C` section · `L` labels · arrows orbit · `+` `−` zoom · `R` reset

## Architecture

```
src/
  app/       routing, search/sharing metadata, repository link
  anatomy/   structure registry, tooth tables, notation     ← anatomy is data
  content/   educational text (JSON) + resolver
  search/    index + scorer
  state/     Zustand store, pure visibility resolver
  engine/    Three.js engine: loading, materials, picking, camera, explode, section, labels
  ui/        React panels (no per-frame rendering)
  modes/     Explore + Quiz (learn/compare still scaffolds)
tools/pipeline/   BodyParts3D → production GLB
```

- React renders the chrome; the engine owns Three.js and subscribes to the store. Nothing re-renders React per frame.
- One pure function decides every mesh's visibility (categories, hide/ghost, isolation, dissection level, section) and accepts extra filters: the hook for future timeline and procedure modes.
- Loading is staged: jaws & teeth → skull & muscles → nerves & vessels → a tooth's internals on demand.

Details and a handoff guide (commands, runtime flows, where to start): [docs/architecture.md](docs/architecture.md). Data research: [docs/dental-data-research.md](docs/dental-data-research.md).

## Anatomical data and attribution

3D anatomy is derived from **BodyParts3D**, © The Database Center for Life Science, licensed under [CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en). Third molars, alveolar bone and TMJ regions are derived from it; internal tooth anatomy is modeled inside each real tooth shape. Most nerves and vessels follow the [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy) atlas (CC BY-SA 4.0), fitted onto these jaws; the superior alveolar nerves, the inferior alveolar vein, the pterygoid plexus and the joint discs are schematic. See [CREDITS.md](CREDITS.md) and [docs/assets.md](docs/assets.md); the statements in the app's About dialog are sourced in [docs/sources.md](docs/sources.md).

## Roadmap

Actionable follow-ups from dental feedback: [feedback TODOs](docs/feedback-todos.md).

- [ ] Expert review of all educational text (see [docs/content.md](docs/content.md))
- [x] Atlas nerve and vessel paths (Z-Anatomy, CC BY-SA 4.0)
- [ ] CBCT-derived canals where licences allow
- [x] Primary dentition and an eruption timeline (schematic mixed-dentition stages; expert review pending)
- [x] Quiz mode: identify all 32 permanent teeth on the separated board (shuffled positions, hints, show answer, answer-safe surface and section inspection, score)
- [ ] Learn mode: guided lessons as data
- [ ] Compare mode: two teeth side by side
- [ ] Salivary glands, tongue and oral mucosa
- [ ] Procedure modules: caries, restoration, root canal treatment, crown, implant, extraction, orthodontic movement, impaction
- [ ] Anatomical variation (e.g. C-shaped canals, extra roots)
- [ ] Localisation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Reviews of the anatomical text by dental professionals are especially welcome.

## Licence

- Code: [MIT](LICENSE)
- 3D models (`public/models/`): CC BY-SA 2.1 JP (derived from BodyParts3D)
- Educational text (`src/content/`): CC BY-SA 4.0

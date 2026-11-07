# vendor/dental-scope-engine — the dental-scope 3D engine (CODE ONLY)

## What is vendored

The **MIT-licensed source code** of
[Yoosseph/dental-scope](https://github.com/Yoosseph/dental-scope), extracted
from upstream `main`.

| Field | Value |
| --- | --- |
| Upstream | https://github.com/Yoosseph/dental-scope |
| Pinned commit | `e34d4b986d5439501f23c91cde593f69a3b180b0` |
| Fetched | 2026-11-07, `codeload.github.com/Yoosseph/dental-scope/tar.gz/refs/heads/main` |
| Code licence | **MIT** — `LICENSE` vendored verbatim; first line reads `MIT License` |
| Package | `dental-scope`, `private: true` → **not on npm**, hence vendoring |
| Vendored size | **1.5 MB, 115 files, 0 model files** |

## What is NOT vendored, and why

The upstream tarball is ~266 MB, almost all of it 3D model assets under
`public/models/` (571 asset files: `core.glb`, `neurovascular.glb`,
`teeth/tooth-NN.glb`, …).

**None of those is committed.** Their licence is contested (below) and
MASTER §4.4 forbids committing 3D model files:

    git ls-files | grep -Ei '\.glb$'   ->   0

Also excluded: `docs/`, `e2e/`, `.github/`, and every upstream `*.test.ts`
(their suite is not our gate — our own contract tests are).

## Licences — the part that is NOT settled

| Asset | Licence | Source |
| --- | --- | --- |
| Engine **code** | **MIT** | `LICENSE` (vendored) |
| Tooth meshes | **CC BY-SA 2.1 Japan** (BodyParts3D, DBCLS) | upstream `CREDITS.md` |
| Written content | CC BY-SA 4.0 | upstream `CREDITS.md` |
| `neurovascular.glb` | CC BY-SA 4.0 (Z-Anatomy) | upstream `CREDITS.md` |

**Conflict — unresolved and for counsel.** The DBCLS site states **CC BY 4.0**
(updated 2025-02-27) while upstream `CREDITS.md` states **CC BY-SA 2.1 JP** for
what is described as the same source. ShareAlike is treated as binding here.
Full research: `docs/dental-chart/ASSETS.md`; the questions for a lawyer are in
the D1 template `docs/legal/3D-ASSETS-DECISION.md`.

Consequences for this build:

* **Default `ASSET_MODE=none`** — the engine is never pointed at real meshes
  until the user records decision **D1**.
* **`neurovascular.glb` is never loaded**, under any mode.
* When `ASSET_MODE != none`, the Arabic credits page (S7) must be shown.

## Engine facts verified by READING the vendored source

* `src/engine/Engine.ts:86` — `export class Engine`.
* `src/engine/Engine.ts:186` — `mount(container: HTMLElement)`.
* `src/engine/Engine.ts:265` — `dispose()`.
* Tooth meshes are keyed **`tooth-<NN>`**, where `NN` is the two-digit FDI
  number — confirmed at `src/engine/Engine.ts:313` and
  `src/engine/DevelopmentScene.ts:62,305`. This is the key↔FDI mapping the
  adapter depends on.
* Selection lives in a module-level zustand store (`src/state/store.ts`) with a
  `selectedId` field.
* Runtime deps we actually need: **three, three-mesh-bvh, zustand**. Upstream
  also lists React, fonts and `@vercel/analytics`; those belong to its own UI
  chrome, which we neither use nor load.
* The upstream package is Vite/ESM-only ⇒ it must be loaded through a
  client-side dynamic import (`next/dynamic`, `ssr: false`).

# FINAL REPORT — 2026-11-11 — P4/S3: the six Dentora engine patches

## Tip — FULL 40 characters

```
git rev-parse HEAD
eb8a2e15718f22548790122d19b1c217144258fd
```

```
remote arena : eb8a2e15718f22548790122d19b1c217144258fd
remote merge : eb8a2e15718f22548790122d19b1c217144258fd
local  HEAD  : eb8a2e15718f22548790122d19b1c217144258fd
```

`local == origin: YES` — verified with `git ls-remote` on both branches.
One commit this turn, pushed in the same turn:

```
eb8a2e15718f22548790122d19b1c217144258fd  P4/S3: six Dentora engine patches (appearance, selection, reset, dispose, chrome) + typecheck:vendor-3d + 25 contract tests
```

Step 1 (licence hygiene) and step 6 (verify scripts) were completed last turn
at `087fc7ca…` / `794b8a4a…` / `8b0b8d89…` and are verified still in place:

```
$ git ls-files vendor/dental-scope-engine | grep -Eic 'content|docs|\.glb|neurovascular'
0
$ git ls-files | grep -Eic '\.glb$'
0
```

---

## P4/S3 — six engine patches — status **BUILT**

> BUILT, not DONE. The patches are typechecked and unit-tested against the real
> module, but **nothing renders yet** — the adapter (step 3) is what puts them
> on screen.

### Design: additive, not a fork

All six live in **one new module**, `src/engine/dentoraPatches.ts`, rather than
being spliced into the 1900-line upstream `Engine.ts`. `Engine` is imported
**type-only**, so there is no runtime import cycle. The module reaches the
engine through four narrow accessors instead of casting into private fields.

`Engine.ts` edits total three, all small:

1. `interface MeshEntry` → `export interface MeshEntry` (so the bridge can type).
2. Import `disposeEngineResources`; call `dentoraDisposeResources()` at the end of `dispose()`.
3. One clearly-marked block adding `dentoraEntries`, `dentoraScene`,
   `dentoraRenderer`, `dentoraDisposeResources`.

### The six patches

| # | Patch | Export | Notes |
| --- | --- | --- | --- |
| **2** | Tooth appearance | `setToothAppearance(engine, fdi, {tint, opacity, rim})`, `clearToothAppearance(engine)` | Traverses `entries` for keys starting `tooth-<fdi>`. `cementum-`/`dentine-`/`pulp-<fdi>` get the **same status** — otherwise a "caries on 36" entry lights the crown while the roots look healthy. Tints by **multiply, not `set`**, preserving enamel shading. Originals saved on `userData.dentoraBase`, so every change is undoable. |
| **3** | Selection OUT | `onToothSelection(cb)`, `fdiFromMeshKey(id)` | Subscribes to the **module-level** zustand store — no React hook, so it works from a plain adapter. `tooth-<NN>` → FDI is a **parse, not a lookup table**: NN *is* the FDI number (`Engine.ts:313`, `DevelopmentScene.ts:62,305`). De-duplicated; fires immediately with the current selection; returns unsubscribe. |
| **4** | Selection IN | `selectTooth(engine, fdi, opts)`, `focusTooth(engine, fdi)` | Forwards `tooth-<fdi>` to the engine's `selectFromUI` / `focus`. |
| **5** | Per-mount isolation | `resetEngine(engine)` | The store is a **module-level singleton**, so one patient's selection survives a remount and would leak into the next. Clears appearance + `selectedId`/`selectionRequest`/`hoveredId`/`isolateId`, then `resetToStart()`. |
| **6** | Full dispose | `disposeEngineResources(engine)` | Upstream `dispose()` stops the loop and drops the renderer but **never releases geometries, materials or textures** — every mount leaked GPU memory. Now disposes textures → materials → geometries, including meshes outside `entries` via a scene traverse. Idempotent (`dentoraDispose` flag), wired into `Engine.dispose()`. |
| **7** | Hide chrome, no English | `hideEngineChrome(container)` | `Engine.mount()` builds `div.ds-overlay` (label layer) and `div#ds-hover-info.ds-tip`; that tooltip is fed by `formatTooth`/`nameOf`/`SINUS_NOTE` — i.e. **English text**. Both hidden, and `labels` switched off in the store. The React chrome (search, language flags, `TopBar`) lives in `main.tsx`, which we never render, so it cannot appear. |

### `typecheck:vendor-3d` — **0 errors**

New `vendor/dental-scope-engine/tsconfig.json` + `npm run typecheck:vendor-3d`,
mirroring the existing RAO `typecheck:vendor`. Without it the patches would
never be typechecked, since the app's root `tsconfig` excludes `vendor/`.

```
$ npm run typecheck:vendor-3d
> tsc -p vendor/dental-scope-engine/tsconfig.json
$ echo $?
0
```

`strict: false` matches the style upstream was written against, so reported
errors are real, not a strictness mismatch. Two deliberate exclusions:
`src/main.tsx` (the upstream Vite entry — nothing imports it, we never render
it, and it pulls `@vercel/analytics`) and a new `src/vendored-assets.d.ts`
declaring the flag-PNG imports used by the chrome.

### Tests added — `tests/unit/dental-scope-patches.test.ts` (25)

Real-module tests: they import the actual patch module and assert its exports
and behaviour (including a jsdom container for PATCH 7), and they **parse the
vendored source** so a change to `Engine.ts` cannot pass unnoticed.

### Red-then-green — negative controls

| Removal | Result |
| --- | --- |
| `export` on `setToothAppearance` | **3 failed** ✓ |
| Rename the `dentoraEntries` accessor | **1 failed** ✓ |
| Drop `dentoraDisposeResources()` from `dispose()` | **1 failed** ✓ |
| All reverted | **25 passed** ✓ |

**One control caught a real flaw in my own test.** Renaming
`dentoraEntries` → `_removed_dentoraEntries` initially **passed** 25/25: the
assertion `dentoraEntries\s*\(` still matched the renamed method, because
`_removed_dentoraEntries(` contains `dentoraEntries(`. The assertion is now
anchored (`^\s{2}<name>\s*\(`, `m` flag) with a comment not to loosen it, and
re-running the same control gives 1 failed. Worth flagging because it is
exactly the kind of green test that proves nothing.

---

## Files changed

```
vendor/dental-scope-engine/src/engine/dentoraPatches.ts   (NEW — patches 2-7)
vendor/dental-scope-engine/src/engine/Engine.ts           (MeshEntry export, 4 accessors, dispose fix)
vendor/dental-scope-engine/src/vendored-assets.d.ts       (NEW — image-import declarations)
vendor/dental-scope-engine/tsconfig.json                  (NEW — typecheck:vendor-3d)
vendor/dental-scope-engine/PATCHES.md                     (patches 2-7 recorded)
package.json                                              (typecheck:vendor-3d script)
tests/unit/dental-scope-patches.test.ts                   (NEW — 25 contract tests)
```

## Verification numbers

| Gate | This run | Previous |
| --- | --- | --- |
| Full suite | **1 failed \| 6583 passed \| 12 skipped (6596)** | 1 failed \| 6558 passed (6571) |
| Test files | 2 failed \| 362 passed \| 1 skipped (365) | 2 failed \| 361 passed |
| `tsc --noEmit` (app) | **498** | 498 — unchanged, no new errors |
| `typecheck:vendor-3d` | **0** | (new script) |
| `.glb` tracked in git | **0** | 0 |

**+25 passed, no regression** — exactly the 25 new contract tests. The single
failure is the known environmental case (`tests/unit/dev-start-env.test.ts`,
Prisma client absent in the sandbox), unchanged since `0533cac`.
`tests/api/imaging-review.test.ts` still fails at collection and contributes 0
tests — the count divergence I have **not** diagnosed.

## Expected `scripts/verify-local.sh` output on your machine

```
branch=<your-branch> HEAD=eb8a2e15718f22548790122d19b1c217144258fd
typecheck=0(498 known × 'error TS')  typecheck:vendor=0  typecheck:vendor-3d=0  lint=0 problems
tests=1   files: 2 failed | 362 passed | 1 skipped (365) ; tests: 1 failed | 6583 passed | 12 skipped (6596)
build=1(@prisma/client exports — blocker B14)
no-glb-in-git=0
```

## What to check on your machine

```bash
git fetch origin merge/fdi52-into-wip && git rev-parse HEAD   # -> eb8a2e15718f22548790122d19b1c217144258fd
npm run typecheck:vendor-3d                                   # -> 0 errors
npx vitest run tests/unit/dental-scope-patches.test.ts        # -> 25 passed
git ls-files vendor/dental-scope-engine | grep -Eic 'content|docs|\.glb|neurovascular'   # -> 0
bash scripts/verify-local.sh
```

## Not verified here

* **Nothing renders yet.** These are unit-level contracts; the engine has not
  been mounted in a browser, so WebGL behaviour, real tinting appearance, and
  the actual GPU-memory saving from PATCH 6 are all unproven.
* **PATCH 7 was tested in jsdom, not a real browser.** The engine's DOM is
  created by `Engine.mount()`, which needs WebGL — so `hideEngineChrome` was
  exercised against a hand-built container matching what `mount()` produces.
* Step 3 (Chart3DAdapter + dev route), step 4 (asset loading / USER-VERIFY
  commands) and step 5 restrictions: **not started**.
* The `imaging-review.test.ts` collection failure: still not diagnosed.
* D1 (licence decision) and the git-history question: **open**.
* P3 remains **BUILT** — still waiting on your 3 screenshots.

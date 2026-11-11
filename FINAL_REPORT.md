# FINAL REPORT — 2026-11-11 — P4/S1 LICENCE HYGIENE (blocking) + verify-script fixes

## Tip — FULL 40 characters

```
git rev-parse HEAD
794b8a4af32d0643b8b5075894c86543590a4485
```

```
remote arena : 794b8a4af32d0643b8b5075894c86543590a4485
remote merge : 794b8a4af32d0643b8b5075894c86543590a4485
local  HEAD  : 794b8a4af32d0643b8b5075894c86543590a4485
```

`local == origin: YES` — verified with `git ls-remote` on both branches.
Two commits this turn, both pushed in the same turn:

```
087fc7ca93810a60d2665d75e77442d3ae411274  P4/S1 licence hygiene: delete CC BY-SA 4.0 content tree from vendored dental-scope, replace with empty typed stub
794b8a4af32d0643b8b5075894c86543590a4485  P4/S1 licence hygiene + verify script fixes (test counts, sha256 manifest, session/env reporting)
```

---

## 1. LICENCE HYGIENE — status **VERIFIED-HERE** (source-level)

**Root cause.** The dental-scope engine *code* is MIT, but upstream
`src/content/` is a **separate work under CC BY-SA 4.0** — five languages of
educational prose plus `canal-counts.json`, clinical data nobody approved. My
S1 vendoring had copied it wholesale. You were right: that was a licence
violation waiting to ship.

**Action: deleted, not relicensed, not trimmed.** 20 files under
`src/content/`, plus `src/app/about.ts` and `src/app/guide.ts`, whose only job
was rendering that content.

### The grep you asked for

```
$ git ls-files vendor/dental-scope-engine | grep -Ei "content|docs|\.glb|neurovascular"
(no output)

$ git ls-files vendor/dental-scope-engine | grep -Eic 'content|docs|\.glb|neurovascular'
0
```

Working tree agrees (`find`, not git):

```
$ find vendor/dental-scope-engine \( -iname '*content*' -o -iname '*docs*' -o -iname '*.glb' -o -iname '*neurovascular*' \) | wc -l
0
```

### Replacement stub — `src/stubs/educational-text.ts` (PATCH 1)

Same export names and types, **EMPTY data**. Types were reconstructed from the
deleted files' signatures **in git history** and from their **consumers'**
usage — not invented.

| Export | Stub value | Consumer |
| --- | --- | --- |
| `resolveContent()` | `{key:null, summary:'', sources:[], facts:[], related:[], guides:[], status:'placeholder'}` | `Engine.ts:1047`, `ui/DetailPanel.tsx` |
| `canalFrequency()` | `undefined` → panel does `if (!item) return null` | `ui/CanalFrequency.tsx` |
| `formatPercent()` | `''` | `ui/CanalFrequency.tsx` |
| `frequencyContext()` | `[]` | `ui/CanalFrequency.tsx` |
| `hyoidAttachments()` | `[]` | `ui/HyoidConnections.tsx` |
| `DEVELOPMENT_SOURCES` / `HYOID_SOURCES` | `[]` | `DevelopmentControls.tsx`, `GuidedTour.tsx`, `HyoidConnections.tsx` |

Six modules repointed. The stub **typechecks with 0 errors**
(`tsc --noEmit --strict --allowImportingTsExtensions …`).

**One deliberate detail worth your attention:** `summary` is `''`, **not**
`undefined`. `Engine.ts` does `resolveContent(...).summary!` and assigns it to
`textContent`; `undefined` would render the literal English word **"undefined"**
into an Arabic-only UI. The stub returns an empty string so the node stays
empty.

### ⚠ GIT HISTORY STILL CONTAINS THE FILES — input to D1

Deletion removes them from the tip, **not from history**. Every commit up to
`0152c65f1f0664dd29daaa6d0b3f5bde0a94fb22` still carries the full CC BY-SA 4.0
tree:

```
git log --all --oneline -- vendor/dental-scope-engine/src/content/
git show 0152c65:vendor/dental-scope-engine/src/content/canal-counts.json
```

If this repository is ever published, pushed publicly, or handed to a third
party, that content is **disclosed by the history**. Recorded in
`docs/dental-chart/ASSETS.md`. I did **not** resolve it — that is D1's job.

### Tests added — `tests/unit/dental-scope-licence.test.ts` (13)

Fails if any path in the vendor tree matches `content|docs|\.glb|neurovascular`;
if any source still imports from `content/`; if a model file appears; or if the
stub ever ships non-empty data.

**Red-then-green (negative control):**

```
mkdir -p vendor/dental-scope-engine/src/content && echo "export const probe = 1" > .../probe.ts
  → Tests  1 failed | 12 passed (13)
     offending paths: src/content/probe.ts
rm -rf vendor/dental-scope-engine/src/content
  → Tests  13 passed (13)
```

### Bundle proof

Nothing outside `vendor/` imports the engine, so it cannot reach the bundle:

```
$ grep -rn "dental-scope-engine" --include=*.ts --include=*.tsx --include=*.mjs . \
    | grep -v node_modules | grep -v '^./vendor/' | grep -v '^./docs/'
(no output)                      # 0 matches
$ grep -n "dental-scope" next.config.* tsconfig.json
(no reference)
$ git ls-files | grep -Eic '\.glb$'
0
$ find . -name 'canal-counts.json' -o -name 'teeth.json' -o -name 'structures.json'
(no output)
```

Honest limit: the 3D chart is not integrated until S3, so this is an
**import-graph proof, not a built-artefact proof**. `npm run build` is still
blocked by B14 (`@prisma/client`), so I could not grep `.next/`. I will redo
this as a real bundle grep at S3 once the engine is wired in.

### Documents updated

* `vendor/dental-scope-engine/VENDOR.md` — removal record + the S3 hazard below.
* `vendor/dental-scope-engine/PATCHES.md` — PATCH 1 table.
* `docs/dental-chart/ASSETS.md` — removed-file list, stub table, history caveat.
* `CREDITS.md` (new, repository root) — third-party register + the four rules.

Upstream `CREDITS.md` and `LICENSE` are kept **verbatim** — they are the
author's attribution file and must not be edited; our notes live elsewhere.

### Hazard found, NOT fixed (belongs to S3)

`Engine.ts:1108` and `:1251` call `loader.load('neurovascular.glb')`, and
`:77` lists it as a stage. That file is **CC BY-SA 4.0 (Z-Anatomy)** and must
never be fetched. It is absent from `3d-assets.manifest.json` and refused by
`asset-mode.ts`, but the engine can still *ask* for it. S3 must neutralise the
loader. (`tour.ts:42` and `ui/Overlays.tsx:12` are chrome, removed by hiding
the engine's UI.)

---

## 2. verify-local.sh / verify-ai.sh — status **VERIFIED-HERE**

### (a) `tests` row printed an empty detail — reproduced and fixed

Vitest colourises its summary, so the lines begin with an ESC sequence and
`^[[:space:]]*Test Files` never matched. Reproduced with `FORCE_COLOR=1`:

```
raw:  ^[[2m Test Files ^[[22m ^[[1m^[[32m1 passed^[[39m^[[22m^[[90m (1)^[[39m
OLD:  note=''                                   <-- the bug you reported
NEW:  files: 1 passed (1) ; tests: 13 passed (13)
```

Added `strip_ansi` to `scripts/verify-local.sh`.

### (b) `sha256sum -c` → "no properly formatted checksum lines"

**Root cause: the committed `ai-validation/models.sha256` contains comments
and ZERO data lines** — there was literally nothing to parse:

```
$ grep -vE '^(#|$)' ai-validation/models.sha256 | wc -l
0
$ ( cd ai-validation && sha256sum -c models.sha256 )
sha256sum: models.sha256: no properly formatted checksum lines found
```

How a data line must be formatted — **64 hex chars, TWO spaces, then the
path**, one per line, paths relative to `ai-validation/`:

```
fac62870b9f9ab47c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4  models/your-model.bin
```

Generate with:

```
( cd ai-validation && sha256sum models/*.bin > models.sha256 )
```

The script now: distinguishes "no data lines" (prints the format + generation
command, sets FAIL) from a real check; normalises data lines first with
**portable awk** (no `{n}` intervals — my first attempt used `{64}` and silently
produced zero lines even for a *correct* manifest, which I caught by testing);
and **prints the name of every failing model**. Verified against fixtures:

```
good        -> a.bin: OK
onespace    -> a.bin: OK            (GNU tolerates 1 space; normalised anyway)
tab         -> a.bin: OK
empty       -> HOW-TO branch, model_checksums=FAIL
mixed       -> a.bin: OK / b.bin: FAILED ;  failing: b.bin
```

### (c) Reporting

| Was | Now |
| --- | --- |
| `session=000-no-response` | `session=dev server not running` |
| `env_missing_names=<count>` | `env_missing_names=S3_ACCESS_KEY,S3_BUCKET` — the NAMES, comma-separated, or `none` |

Both scripts pass `bash -n`.

---

## 3. Full suite

| | This run | Baseline (`0533cac` → `efae161`) |
| --- | --- | --- |
| Tests | **1 failed \| 6558 passed \| 12 skipped (6571)** | 1 failed \| 6545 passed (6558) |
| Test files | 2 failed \| 361 passed \| 1 skipped (364) | 2 failed \| 360 passed |

**+13 passed, no regression** — exactly the 13 new licence tests. The single
failure is the known environmental case
(`tests/unit/dev-start-env.test.ts`, Prisma client absent in the sandbox),
unchanged since `0533cac`. `tests/api/imaging-review.test.ts` still fails at
collection and contributes 0 tests — the count divergence I have **not** yet
diagnosed.

---

## 4. Expected `scripts/verify-local.sh` output on your machine

```
branch=<your-branch> HEAD=794b8a4af32d0643b8b5075894c86543590a4485
typecheck=0(498 known × 'error TS')  typecheck:vendor=0  lint=0 problems
tests=1   files: 2 failed | 361 passed | 1 skipped (364) ; tests: 1 failed | 6558 passed | 12 skipped (6571)
build=1(@prisma/client exports — blocker B14)
no-glb-in-git=0
```

The `tests` row is the one that was empty before; it now carries both counts.

## 5. What to check on your machine

```bash
git fetch origin merge/fdi52-into-wip && git rev-parse HEAD   # -> 794b8a4af32d0643b8b5075894c86543590a4485
git ls-files vendor/dental-scope-engine | grep -Ei 'content|docs|\.glb|neurovascular'   # -> nothing
git ls-files | grep -Eic '\.glb$'                                                       # -> 0
bash scripts/verify-local.sh
bash scripts/verify-ai.sh
```

## 6. Not verified here

* Step 1 is **source-level only**; the bundle proof becomes a real artefact
  grep at S3 (build is blocked by B14).
* Steps 2–5 (S3 patches, Chart3DAdapter, asset loading) **not started**.
* The `imaging-review.test.ts` collection failure: still not diagnosed.
* D1 (licence decision): **open**, deliberately, plus the new git-history
  question above.
* P3 remains **BUILT** — still waiting on your 3 screenshots.

# FINAL REPORT — 2026-11-11 — answers (a)/(b), then P4/step 3

## Tip — FULL 40 characters

```
git rev-parse HEAD
8dfe73dddce70fde7af86bbb5e1eacbfa988e3af
```

```
remote arena : 8dfe73dddce70fde7af86bbb5e1eacbfa988e3af
remote merge : 8dfe73dddce70fde7af86bbb5e1eacbfa988e3af
local  HEAD  : 8dfe73dddce70fde7af86bbb5e1eacbfa988e3af
```

`local == origin: YES` — verified with `git ls-remote` on both branches.
Three commits this turn, all pushed in the same turn:

```
f506a4c5513ce330ab202fe157bffc73bf6f872d  docs(USER-VERIFY): PATCH 2/6 GPU eyeball checklist + ?perf=1 numbers; correct verify-ai.sh CRLF claim
7bb4b272c852a74930a54672a6fec9e73cc7aefe  P4/step3: Chart3DAdapter + ScopeScene + ProceduralScene fallback + dev route, ASSET_MODE=none default
8dfe73dddce70fde7af86bbb5e1eacbfa988e3af  fix(i18n): single-token test-seam error so the protected i18n guard passes
```

---

# (a) The two verify scripts — parsing code, and why `sha256sum -c` failed

## a1. `verify-local.sh` tests row — `scripts/verify-local.sh:74-100`

```bash
74: # Remove ANSI colour/escape sequences so summary greps can anchor on ^.
75: strip_ansi () {
76:   sed -e "s/$(printf '\033')\\[[0-9;]*[A-Za-z]//g" \
77:       -e "s/$(printf '\033')\][^\007]*\007//g"
78: }
...
92:       # nothing and this row printed an empty detail. Strip ANSI first.
93:       local tf tt
94:       tf="$(strip_ansi <"$f" | grep -E 'Test Files' | tail -1 \
95:             | sed -e 's/^[[:space:]]*Test Files[[:space:]]*//' -e 's/[[:space:]]*$//')"
96:       tt="$(strip_ansi <"$f" | grep -E '^[[:space:]]*Tests[[:space:]]' | tail -1 \
97:             | sed -e 's/^[[:space:]]*Tests[[:space:]]*//' -e 's/[[:space:]]*$//')"
98:       [ -z "$tf" ] && tf="(no 'Test Files' line)"
99:       [ -z "$tt" ] && tt="(no 'Tests' line)"
100:      n="files: $tf ; tests: $tt" ;;
```

Root cause of the empty detail, reproduced last turn with `FORCE_COLOR=1`:
vitest emits `^[[2m Test Files ^[[22m …`, so `^[[:space:]]*` never matched.
Old → `note=''`. New → `files: 1 passed (1) ; tests: 13 passed (13)`.

## a2. `verify-ai.sh` manifest block — `scripts/verify-ai.sh:95-143`

```bash
 96:  awk '
 97:    /^[[:space:]]*#/ { next }
 98:    /^[[:space:]]*$/ { next }
 99:    {
100:      sub(/\r$/, "")
101:      h = $1
102:      if (length(h) == 64 && h ~ /^[0-9a-fA-F]+$/) {
103:        p = $0
104:        sub(/^[[:space:]]*[0-9a-fA-F]+[[:space:]]+/, "", p)
105:        sub(/^\*/, "", p)
106:        if (p != "") printf "%s  %s\n", h, p
107:      }
108:    }' "$MANIFEST" > "$MAN_NORM"
109:  ENTRIES=$(grep -c '' "$MAN_NORM" | tr -d ' ')
...
122:    ( cd ai-validation && sha256sum -c "$MAN_NORM" 2>&1 ) | tee "$MAN_OUT" | tee -a "$LOG"
125:    FAILED_MODELS="$(grep -E ' FAILED( |$)' "$MAN_OUT" | sed 's/: FAILED.*//' | sort -u)"
```

## a3. The manifest data lines — and why `sha256sum -c` failed

**There are none.** The committed manifest is comments only:

```
$ grep -vE '^(#|$)' ai-validation/models.sha256 | cat -A
(no output)
$ grep -cvE '^(#|$)' ai-validation/models.sha256
0
$ ( cd ai-validation && sha256sum -c models.sha256 )
sha256sum: models.sha256: no properly formatted checksum lines found
```

That is the whole explanation: `sha256sum -c` had **zero data lines** to parse.
A data line must be **64 hex chars, whitespace, then the relative path**:

```
3100795e42b2eb175e3a53bf0787528bf2c1fef29b867b771abbd580ca4f7341  m.bin
```

Generate with: `( cd ai-validation && sha256sum models/*.bin > models.sha256 )`

## a4. CRLF — I have to correct myself

You asked me to show the check passing on a CRLF file. I built the fixtures
(`cat -A` below; `^M$` = CRLF):

```
3100795e...7341  m.bin^M$      two spaces
3100795e...7341 m.bin^M$       one space
3100795e...7341^I m.bin^M$     tab + space
```

and the result contradicts what I wrote in the script last turn:

```
RAW  sha256sum -c:   crlf OK    crlf1 OK    crlf2 OK
NORMALISED:          crlf OK    crlf1 OK    crlf2 OK
```

**GNU coreutils already strips the CR, and also tolerates one space, a tab and
the `*` binary marker.** So CRLF was never the cause, and the comment I added
last turn claiming it was is wrong. I have rewritten that comment to say so
plainly. The normaliser stays — it buys portability to stricter `sha256sum`
implementations (BSD/macOS) and, more importantly, gives the script a reliable
**data-line count** to branch on, which is what lets it print the required
format instead of a bare parsing error.

What the script now does:
* **0 data lines** → prints the required format + the generation command,
  `model_checksums=FAIL`. No bogus parsing error.
* **data lines present** → verifies, and prints **the name of every failing
  model** (`failing: b.bin` in my fixture run).

---

# (b) What to eyeball on a GPU — `docs/USER-VERIFY.md` §6 (new)

Written to `docs/USER-VERIFY.md` (now 175 lines). Summary:

**PATCH 2 (tint by multiply)** — 5 checks: tinted tooth still looks like enamel
(multiply) vs a flat painted blob (would mean `set`); roots share the status;
neighbours unaffected; clearing restores exactly; base survives a theme switch
(a known limitation: the base colour is captured on first tint, so a re-theme
afterwards leaves it stale).

**PATCH 6 (dispose)** — the one a unit test cannot prove: mount → unmount →
remount **5 times**, comparing heap and GPU memory each cycle. Flat baseline =
works; monotonic climb = still leaking; context loss after N mounts = severe.
Read GPU memory in DevTools → Memory, or `chrome://gpu`. **`?perf=1` reports JS
heap only — GPU buffers live outside it, so a flat JS heap does not by itself
prove PATCH 6 works.**

**`?perf=1` numbers** — initial bytes (**must be 0 under `ASSET_MODE=none`;
non-zero means an asset slipped the mode gate**), time to first frame, FPS
while orbiting (watch for decay, which suggests a leak), JS heap.

---

# P4/step 3 — Chart3DAdapter + dev route — status **BUILT**

> BUILT, not DONE: no browser has rendered this.

## What was built

| File | Role |
| --- | --- |
| `lib/dental-chart/3d/types.ts` | The `Chart3DAdapter` contract (`mount, setStates, onSelect, select, setView, reset, dispose`), `selectScene()`, Arabic `fallbackNote()` |
| `lib/dental-chart/3d/procedural-scene.ts` | **ProceduralScene** — adapts the EXISTING R3F `DentalChart3D` via `createRoot`; the automatic fallback and where primary teeth land later |
| `lib/dental-chart/3d/scope-scene.ts` | **ScopeScene** — the vendored engine (32 permanent teeth) + PATCH 2/3/4/5/6/7; everything imported **dynamically** so the default path never loads three.js |
| `lib/dental-chart/3d/perf.ts` | `?perf=1` tracker: initial bytes, time to first frame, FPS **while orbiting**, JS heap |
| `components/dental-chart/interactive/Chart3DStage.tsx` | WebGL detection, mount, layered fallback, Arabic loading/ready/fallback/error states, perf overlay |
| `app/(dashboard)/patients/[id]/dental-chart-3d/page.tsx` | The dev route: `next/dynamic` `ssr:false`, `DentalChartErrorBoundary`, Arabic UI |

## The layering — no model file is never allowed to mean "blank"

```
no WebGL                 → ProceduralScene + Arabic note (webgl-unsupported)
ASSET_MODE=none (DEFAULT)→ ProceduralScene + Arabic note (asset-mode-none)
assets on, engine fails  → ProceduralScene + Arabic note (scope-mount-failed)
assets on, engine mounts → ScopeScene, no note
```

`selectScene()` is a pure function and is tested for all six combinations;
every non-engine outcome carries a reason, and every reason has an Arabic note.

## Tinting, and resolved rows

Statuses come from the **existing** `GET /api/dental-chart/:id/summary`, whose
`deriveStatusMap` already ignores findings with `resolvedDate`. The page trusts
that map rather than re-deriving. Tests pin it:

```
CARIES + resolvedDate '2026-01-01' → deriveToothStatus = healthy → tintForStatus = null
CARIES without resolvedDate        → affected → '#ef4444'
```

`healthy` is never tinted (it keeps the material's own enamel colour);
`missing` reads as absent (grey `+` opacity 0.18), not merely grey.

## Tests added — 24

`tests/unit/chart3d-adapter.test.ts` (16) and
`tests/components/chart3d-stage.test.tsx` (8), including the one you asked for:

* renders **with no model file** → `data-scene="procedural"` and an Arabic note;
* **no error state** in that case;
* statuses reach the scene (`{11:'planned', 36:'affected'}`);
* engine-enabled-but-failing degrades to procedural + `تعذّر تشغيل محرّك`;
* the perf overlay is absent by default and shows all four metrics with `?perf=1`.

## A regression I caught and fixed

The full suite went from 1 failed test to 2: the **protected** i18n guard
(`tests/unit/i18n-pass3-surfaces.test.tsx`) flagged the English literal
`'forced failure (test seam)'` in my new client component. I fixed my code
(single short token `'forced'`), not the guard. Re-run: 52 passed.

## Two upstream/type issues found and fixed

1. Importing the engine into the app pulled 17 `TS5097` errors (`.ts` extension
   imports) into the root program. Fixed with `allowImportingTsExtensions: true`
   in the root `tsconfig.json` — I **measured first** (499 vs 498 baseline) to
   confirm it does not drag the vendor tree under `strict: true` and explode.
2. One residual `TS2339` on `import.meta.env.VITE_DS_URL` — upstream
   `app/router.ts:34` reads a variable its own shim never declares, and the
   vendor shim is excluded from the root program while `router.ts` is not.
   Fixed by declaring it in `types/dental-scope-env.d.ts` (PATCH 8), which the
   root program *does* include.

**`tsc --noEmit` is back to exactly 498** (baseline), 0 vendor errors.
`npm run typecheck:vendor-3d` → 0.

## Verification numbers

| Gate | This run | Previous |
| --- | --- | --- |
| Full suite | **1 failed \| 6607 passed \| 12 skipped (6620)** | 1 failed \| 6583 passed |
| Test files | 2 failed \| 364 passed \| 1 skipped (367) | 2 failed \| 362 passed |
| `tsc --noEmit` | **498** | 498 — at baseline |
| `typecheck:vendor-3d` | **0** | 0 |
| `.glb` tracked in git | **0** | 0 |

**+24 passed, no regression.** The single failure is the known environmental
case (`tests/unit/dev-start-env.test.ts`, Prisma absent in the sandbox).

## Expected `scripts/verify-local.sh` output on your machine

```
branch=<your-branch> HEAD=8dfe73dddce70fde7af86bbb5e1eacbfa988e3af
typecheck=0(498 known × 'error TS')  typecheck:vendor=0  typecheck:vendor-3d=0  lint=0 problems
tests=1   files: 2 failed | 364 passed | 1 skipped (367) ; tests: 1 failed | 6607 passed | 12 skipped (6620)
build=1(@prisma/client exports — blocker B14)
no-glb-in-git=0
```

## What to check on your machine

```bash
git fetch origin merge/fdi52-into-wip && git rev-parse HEAD   # -> 8dfe73dddce70fde7af86bbb5e1eacbfa988e3af
npx vitest run tests/unit/chart3d-adapter.test.ts tests/components/chart3d-stage.test.tsx   # -> 24 passed
npm run typecheck:vendor-3d                                    # -> 0 errors
bash scripts/verify-local.sh
```

## Not verified here

* **Nothing has rendered.** No browser, no GPU. The fallback logic is
  unit-tested with a mocked procedural scene — three.js has never run here.
* `?perf=1` numbers are **entirely unmeasured** (no browser); only the overlay's
  presence and labels are tested.
* Step 4 (authenticated asset route, Range support, traversal tests, fetch
  script, USER-VERIFY commands) **not started**.
* P5–P6, the Credits page and the primary-tooth view: **not started**, per your
  instruction.
* `tests/api/imaging-review.test.ts` still fails at collection (0 tests).
* D1 and the git-history question: **open**. P3 remains **BUILT** pending your
  3 screenshots.

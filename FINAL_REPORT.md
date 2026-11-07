# FINAL REPORT — 2026-11-07

**Tip — full 40 characters:**

```
git rev-parse HEAD
a489bb90e1c11ec8e13985463c709f8a0e21736f
```

`local == origin: YES` — verified with `git ls-remote`, not with a local ref:

```
remote arena : a489bb90e1c11ec8e13985463c709f8a0e21736f
remote merge : a489bb90e1c11ec8e13985463c709f8a0e21736f
local  HEAD  : a489bb90e1c11ec8e13985463c709f8a0e21736f
```

Ancestry check (MASTER §1): `0533cac3f136813bfd2dccbfd1c6511b5a14518a` (the tip
you had before this turn) is an ancestor of `a489bb9`. Nothing was rewritten.

> **On your other clone showing `baf39b2`:** that clone was stale, not a lost
> push. `git ls-remote origin refs/heads/merge/fdi52-into-wip` returns
> `a489bb9…`. Run `git fetch` there. Check `ls-remote` before believing a clone.

---

## 1. setup:dev — where every `S3_*` default comes from

**status VERIFIED-HERE.** You were right to challenge this: my earlier
`lib/storage/env.ts` **hardcoded the dev MinIO credentials**. Even though the
same values were already public in `.env.example`, keeping a second copy in
source was wrong. It is removed.

| Value | Source | file:line |
| --- | --- | --- |
| `S3_ACCESS_KEY` | `MINIO_ROOT_USER` | `docker-compose.dev.yml:76` |
| `S3_SECRET_KEY` | `MINIO_ROOT_PASSWORD` | `docker-compose.dev.yml:77` |
| `S3_ENDPOINT` | the published `9000:9000` port | `docker-compose.dev.yml:79` |
| `S3_BUCKET` | `mc mb --ignore-existing local/<bucket>` | `docker-compose.dev.yml:107` |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | MinIO **protocol facts**, not secrets | `STORAGE_PROTOCOL_DEFAULTS`, `lib/storage/env.ts` |
| `STORAGE_DRIVER`, `UPLOAD_DIR` | active lines in the template | `.env.example:28,31` |

All four compose values are read by the new `scripts/lib/compose-storage.ts`.
Proof that no credential remains in source:

```
$ grep -nE "dentalerp|S3_(ENDPOINT|ACCESS_KEY|SECRET_KEY|BUCKET):" lib/storage/env.ts
(no matches)
```

**Fail loud, never invent.** If a value cannot be derived, `setup:dev` throws
(`Cannot derive S3_ACCESS_KEY … refusing to invent a storage value`) instead of
writing an empty one — an empty or invented `S3_*` is exactly what lets the app
write to local disk while the orchestrator reads MinIO, which was the original
`NoSuchKey` root cause.

**Nothing is printed.** Values go straight into `.env` (gitignored). Logs,
warnings and the duplicate-key message carry NAMES only.

Tests: `tests/unit/compose-storage.test.ts` (13) — derivation, service-block
isolation (a later service mentioning `MINIO_ROOT_*` must not win), fail-loud
for each missing value, and a sweep proving no credential literal exists in
`lib/` or `scripts/`.

## 2. Duplicate `.env` keys — warn, names only, say which one wins

**status VERIFIED-HERE.** New `findDuplicateEnvKeys()` +
`formatDuplicateKeyWarning()` in `scripts/lib/dev-env.ts`.

Semantics mirror the parser exactly (`parseEnvFileContent` assigns in file
order and skips empty values), so the **last non-empty occurrence wins**; if
every occurrence is empty the key is **ABSENT** (`winningLine === -1`). Both
rules are cross-checked against the real parser in tests, so the warning can
never disagree with what actually gets loaded.

Wired into `npm run setup:dev` (`.env.example` + `.env`) and `npm run dev:start`
(`.env` + `.env.local`):

```
[env] WARNING: .env declares 1 key more than once (names only - no values shown).
[env]   S3_SECRET_KEY: 2 occurrences at lines 4, 9 - line 9 wins (the last non-empty one). Delete the others.
[env]   Duplicates are legal but ambiguous: remove the losing lines to avoid surprises.
```

Tests `tests/unit/dev-env-duplicates.test.ts` (13), including an explicit
assertion that a value (`hunter2`) can never reach the warning text.

## 3. P4 — started, code parts only

### S1 — vendor the MIT engine **BUILT** (committed and pushed in the same turn)

| Field | Value |
| --- | --- |
| Upstream | https://github.com/Yoosseph/dental-scope |
| Pinned commit | `e34d4b986d5439501f23c91cde593f69a3b180b0` |
| Licence | **MIT** — `LICENSE` vendored verbatim |
| Vendored | **115 files, 1.5 MB, 0 model files** |
| Provenance / patches | `vendor/dental-scope-engine/VENDOR.md`, `PATCHES.md` |

The tarball is ~266 MB, of which **571 files are model assets**. None is
committed — `git ls-files | grep -Eic '\.glb$'` returns **0**. I also excluded
`docs/`, `e2e/`, `.github/` and every upstream `*.test.ts`.

Facts verified by **reading** the vendored source, not from memory:

* `src/engine/Engine.ts:86` `export class Engine`; `:186` `mount(container)`;
  `:265` `dispose()`.
* Mesh keys are **`tooth-<NN>`** = the two-digit FDI number
  (`Engine.ts:313`, `DevelopmentScene.ts:62,305`). That is the key↔FDI mapping
  the adapter needs.
* Deps we actually need: **three, three-mesh-bvh, zustand**. React, the fonts
  and `@vercel/analytics` belong to its own UI chrome — not used.
* Vite/ESM-only ⇒ must load via `next/dynamic`, `ssr: false`.

### S2 — asset modes, `none` as the DEFAULT **BUILT**

`lib/dental-chart/3d/asset-mode.ts`: unknown or missing `ASSET_MODE` falls back
to `none`, never to a mode that loads third-party meshes. `bundled` **throws**
`BundledAssetsBlockedError` until `docs/legal/3D-ASSETS-DECISION.md` carries the
marker `D1-DECISION-RECORDED`. `neurovascular.glb` is forbidden in **every**
mode.

`3d-assets.manifest.json` — committed, **34 entries, 53.6 MB, 0 forbidden
files**, with **real** SHA-256 digests computed from the pinned tarball. It
records the licence conflict honestly (CC BY-SA 2.1 JP per upstream CREDITS vs
CC BY 4.0 per DBCLS, marked **UNRESOLVED**) instead of picking a side.

`scripts/3d-assets/fetch.mjs` — downloads the **pinned** commit, extracts only
manifest-listed files, verifies every digest and size into the gitignored
`.local-assets/3d/`. A checksum mismatch is a **hard failure**; a digest is
never edited to make a check pass.

Tests `tests/unit/asset-mode.test.ts` (14).

### S3, S4–S5, S7, S9 — **NOT STARTED**

My turn budget ran out after S2. `PATCHES.md` already lists the six engine
patches S3 needs. **These are BUILT-less: no code exists for them yet.**

---

## 4. Verification numbers

| Gate | Result | Baseline |
| --- | --- | --- |
| Full suite | **Tests 1 failed \| 6545 passed \| 12 skipped (6558)** | 6504 passed ⇒ **not worse (+41)** |
| Test files | 2 failed \| 360 passed \| 1 skipped (363) | 2 failed \| 357 passed |
| `tsc --noEmit` | **498** | 498 (unchanged) |
| `.glb` tracked in git | **0** | 0 |
| Tree | clean | clean |

The 1 failure is the known environmental case
(`tests/unit/dev-start-env.test.ts` — Prisma client absent in the sandbox), the
same one present at `0533cac`. `tests/api/imaging-review.test.ts` fails at
collection and contributes 0 tests — a count divergence I have **not** yet
diagnosed and am reporting rather than hiding.

**Red-then-green:** all three new suites were written first and are green on
the first run after the fix + `readFileSync` in `scripts/dev-start.ts:44`.

## 5. What `scripts/verify-local.sh` should print on your machine

I expect it to print, in this shape:

```
branch=<your-branch> HEAD=a489bb9…
typecheck=PASS(498 known) typecheck:vendor=PASS(0) lint=PASS tests=6558(1 fail: prisma-absent)
build=FAIL(@prisma/client exports — blocker B14) no-glb-in-git=PASS
```

and for the AI/storage block:

```
compose=UP orchestrator=UP model_loaded=X/Y model_checksums=OK
minio=UP session=OK migrate_status_rc=0 env_missing_names=(none)
STORAGE_DRIVER=s3
```

Point to check: `env_missing_names=(none)` now requires `setup:dev` to have
derived the four `S3_*` values from `docker-compose.dev.yml`. If it lists
names, the compose file moved and `scripts/lib/compose-storage.ts` needs the
new line — it fails loudly rather than guessing.

## 6. Not verified here

* P3 remains **BUILT** — I am still waiting for your 3 screenshots.
* S3–S5, S7, S9: **not started**.
* P9.1 runtime part stays `[LOCAL]` (no Docker, no `.env` in the sandbox).
* The `imaging-review.test.ts` collection failure: not diagnosed.
* Licence conflict D1: **open**, deliberately, for counsel.

## 7. Commits this turn

```
ca2ccf6b1df72b5cacfdbc1f12f084013d59ca9f  P9.1b/c: derive storage defaults from compose; warn on duplicate env keys
0152c65f1f0664dd29daaa6d0b3f5bde0a94fb22  P4 S1: vendor dental-scope engine MIT source (code only, 0 model files)
0a6722b5c029b1e98963863dead852b655d4e687  P4 S2: ASSET_MODE (none default), integrity manifest, fetch script, D1 template
a489bb90e1c11ec8e13985463c709f8a0e21736f  docs(PROGRESS): P4 S1/S2 record
```

All pushed to both `arena/91dddda0-dental-clinic-system` and
`merge/fdi52-into-wip`, fast-forward only, `local == origin: YES`.

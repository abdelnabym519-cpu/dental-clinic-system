# PROGRESS.md — DenToRa chart/AI/anatomy run

> Sandbox resets between turns have been observed. **Trust this file + git, not memory.**
> Re-anchor with `git status && git log --oneline -3` at the start of every turn.

## Session / branch constraints (READ FIRST)

| Item | Value |
|---|---|
| Session branch | `arena/91dddda0-dental-clinic-system` |
| Local HEAD | `d5c32bc` (Step 3 restored) |
| HEAD tree | see `git rev-parse HEAD^{tree}` |
| Requested target branch | `wip/realistic-teeth-anatomy` @ `d8c28ae58cb18c76026c04cf72e8b2153f427be7` |
| Target branch on origin? | **YES — verified** via `git ls-remote --heads origin wip/realistic-teeth-anatomy` |
| Can we check it out? | **NO.** This session is pinned to `arena/91dddda0`; switching/creating branches is not permitted. User chose (2026-10-26) to proceed on `arena/91dddda0` anyway. |
| `arena/91dddda0` on origin? | **No** — local-only (confirmed absent from the 11 remote heads). |
| Environment | Linux sandbox clone. **Not** `C:/Projects/dental-erp-dental-chart`. Docker absent. |

**Consequence:** the WIP rewrite at `d8c28ae` (tooth-anatomy.ts +833/−110) is **NOT present** on this branch.
WP1 hypotheses H1/H4 that depend on `d8c28ae` vs `eba87b7` do not apply here.

## BASELINE (measured at commit `d5c32bc`, not assumed)

| Command | Result |
|---|---|
| `node_modules/.bin/tsc --noEmit` | **498 errors**, exit 2 |
| `npm run lint` | **0 errors, 274 warnings**, exit 0 |
| `npm run test` | **6263 passed / 12 skipped / 8 failed** (345 files: 338 passed, 6 failed, 1 skipped), exit 1 |
| `npm run build` | see `BLOCKERS.md` (Prisma client absent) |
| Full-suite duration | 322.72s |

Historical reference from the master prompt (older commit `512a028`): 6462 passed / 12 skipped / 0 failed.
**Not comparable** — different commit and different branch. Do not treat 6462 as our baseline.

## Pre-existing failures (verified at base worktree `8f3429c8`)

| Test | Cause |
|---|---|
| `tests/api/imaging-review.test.ts` | collection error — Prisma client not generated |
| `tests/unit/dev-start-env.test.ts` → "the REAL PrismaClient receives…" | Prisma client not generated |

Both fail identically WITHOUT the FDI-52 change. Confirmed by running the same files in a detached
worktree at `8f3429c8` (`/tmp/basewt`): `Test Files 2 failed | 4 passed (6)`, `Tests 1 failed | 71 passed (72)`.

## REGRESSIONS INTRODUCED BY FDI-52 (7 tests) — UNRESOLVED

Root cause: broadening the valid set from 32 → 52 makes numbers **63** and **81** valid
(primary upper-left canine / primary lower-right central incisor). The voice layer's
STT-confusion safety net only fires for numbers that are **invalid**, so it is now bypassed.

| Test file | Test | Observed |
|---|---|---|
| `tests/unit/voice-entity-resolution.test.ts` | flags the classic 36/63 STT confusion as AMBIGUOUS | `RESOLVED` ≠ `AMBIGUOUS` |
| `tests/unit/voice-entity-resolution.test.ts` | rescues the invalid heard form 81 → 18 | `RESOLVED` ≠ `AMBIGUOUS` |
| `tests/unit/voice-pipeline.test.ts` | ambiguous tooth number never reaches the agent | `undefined` ≠ `TOOTH_AMBIGUOUS` |
| `tests/evaluation/voice-robot-eval.test.ts` | all voice golden cases satisfy their contract | (same cause) |
| `tests/evaluation/clinical-safety-eval.test.ts` | CS-RESTO-007 | `CLARIFICATION_REQUIRED` ∉ `[COMPLETED]` |
| `tests/evaluation/clinical-safety-eval.test.ts` | global invariants across ALL cases | aggregates CS-RESTO-007 |
| `tests/evaluation/clinical-safety-eval.test.ts` | writes machine-readable artifact | `expected 20 to be 19` |

**Contract in force** (`lib/ai/voice/entity-resolution.ts:112-159`):
> "A number that is valid FDI stays a single candidate." Reversal rescue applies **only** to
> non-FDI numbers. Existing test `both-valid reversals stay literal (42 IS a valid FDI number)`
> pins this: 42 resolves literally even though 24 is also valid.

So under FDI-52 the *rule* is unchanged; only the *outcome* for 63/81 changed.
**This silently disables the 36↔63 and 18↔81 disambiguation prompts** — described in the source
as "the classic dental failure". Clinical-safety relevant. NOT yet fixed; NOT touched.

**CS-RESTO-007 root cause: NOT yet established.** Input is `"Assess the restoration on tooth 30."`
(US numbering; 30 is invalid in both the 32- and 52-ID worlds), yet the agent moved from
`COMPLETED` (base) to `CLARIFICATION_REQUIRED` (current). Broadening the valid set should not
reduce resolution, so the mechanism is not yet understood. **The golden file will not be edited
until the mechanism is proven.**

## Work packages

| WP | Status |
|---|---|
| WP0 preflight | **PARTIAL** — git state ✅, env detection ✅, baseline ✅, tooth-anatomy diff **N/A** (d8c28ae not on this branch) |
| WP1 chart load error | **NOT STARTED** — depends on d8c28ae; cannot reproduce here |
| WP2 AI runtime | **BLOCKED** — no Docker, no model files |
| WP3 FDI-52 foundation | **PARTIAL** — core + tests done (`d5c32bc`); consumers NOT yet migrated; 7 regressions open |
| WP4 3D anatomy | NOT STARTED |
| WP5 2D/Arabic/sync | NOT STARTED |
| WP6 10 known issues | NOT STARTED |
| WP7 / WP8 | NOT STARTED |

## Commits on this branch

| Hash | Subject |
|---|---|
| `8f3429c` | Merge PR #3 (base, = `dentora-unified` tip) |
| `84dedb07` | Step 3 FDI-52 — **LOST to a sandbox reset** (`git cat-file` exit 128) |
| `d5c32bc` | Re-commit of Step 3 (identical content; 226/226 targeted tests green) |

# TODO.md

Ordered by the master prompt dependency graph. Every item needs evidence before it is checked off.

## Now (in progress)

- [x] Restore dependencies (`npm ci --ignore-scripts`)
- [x] Re-commit the Step 3 FDI-52 work lost to the sandbox reset → `d5c32bc`
- [x] Measure baseline: tsc 498 / lint 0 errors+274 warnings / test 6263 passed, 12 skipped, 8 failed
- [x] Separate pre-existing failures (2) from FDI-52 regressions (7)
- [ ] **Root-cause CS-RESTO-007** (`CLARIFICATION_REQUIRED` instead of `COMPLETED`) — do NOT edit the golden first
- [ ] **Decide voice/STT policy for 63 and 81** — see PROGRESS.md. Options: - A accept new literal behaviour + update the 4 voice tests (safety net for 36↔63 / 18↔81 is lost) - B dentition-aware rescue: heard-primary-whose-reversal-is-permanent ⇒ AMBIGUOUS
      (keeps 63/81 prompts, keeps `42 → 42` and `36 → 36` literals)
- [ ] Remove the temporary base worktree (`git worktree remove /tmp/basewt`) when comparisons are done

## WP0 preflight

- [x] git state, branch, log, stash list
- [x] Environment detection (docker, models, node)
- [x] Baseline numbers
- [x] `PROGRESS.md` / `BLOCKERS.md` / `TODO.md` / `ARCHITECTURE.md`
- [ ] `npm run build` baseline (blocked: B4/B5)
- [ ] tooth-anatomy.ts diff d8c28ae vs eba87b7 — **N/A on this branch** (see B1)

## WP1 chart load error — cannot reproduce here (error is on d8c28ae, not on this branch)

## WP3 FDI-52 foundation (core done, consumers pending)

- [x] Shared module: 52 ids, dentition derivation, primary molars, names, adjacency, antagonists
- [x] Unify `lib/ai/context/fdi.ts` (divergent validator deleted)
- [x] 34 new unit tests
- [ ] Consumer inventory completed in ARCHITECTURE.md
- [ ] Migrate API layer (dental-chart POST, summary aggregate, treatment-plan items)
- [ ] Migrate adapter (remove the silent `return 1` quadrant fallback)
- [ ] Migrate AI tools (`lib/ai/agent/tools.ts:221-222`)
- [ ] Migrate classifier / loop message ranges (`lib/ai/agent/classifier.ts:392,1196`, `loop.ts:826-827`)
- [ ] Resolve the 7 regressions
- [ ] Full suite ≥ baseline; tsc not worse

## WP2 / WP4 / WP5 / WP6 / WP7 / WP8 — not started (WP2 blocked: B2, B3)

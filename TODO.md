# TODO.md

Governing document: **MASTER-DENTORA-ALL-IN-ONE.md** (committed at the repo
root). It wins over every earlier prompt. Findings live in `PROGRESS.md`;
things only the user can run live in `docs/USER-VERIFY.md`; environment limits
live in `BLOCKERS.md`.

Branch: `merge/fdi52-into-wip` is canonical. This session is pinned to
`arena/91dddda0-dental-clinic-system` and keeps **both at the same commit**, so
one tip hash identifies both.

## Execution order (dependency-ordered — do not reorder)

- [x] **P0 PREFLIGHT** — tip verified (`baf39b2`; section-1 ancestor check
      PASSED), environment recorded (SANDBOX), baseline measured
      (tsc 498 / vendor 0 / lint 0 errors + 304 warnings / tests 6449-1-12 /
      build LOCAL / 0 `.glb` tracked). `scripts/verify-local.sh` +
      `scripts/verify-ai.sh` written and exercised;
      `ai-validation/models.sha256` placeholder + `scripts/generate-model-manifest.sh`
      added; `.local-logs/` gitignored.
- [x] **P1 REPAIR THE BUILD** — the fix is **already on origin at `baf39b2`**
      (Patch 10: `export { resetForPatient, getToothStates, setSelectedTeeth }`).
      Remaining: re-verify from the remote state, run the non-mock guards,
      perform the NEGATIVE CONTROL, attempt `npm run build` here.
- [x] **P2 PRIMARY TEETH IN THE API** — POST + PUT use the shared `isValidFdi`
      (52 ids). The only test allowed to change is
      `tests/api/dental-chart-cross-hospital.test.ts` (invalid example 51 → 56).
      Error message must still contain "FDI". PUT currently has NO validation.
- [ ] **P9.1 (code part only)** — single source of truth for storage variables,
      `setup:dev` guarantees `STORAGE_*`/`S3_*`, analyze route pre-flight with an
      Arabic message instead of a raw `NoSuchKey`. Test-first.
- [ ] **P3 2D v2 COMPLETION** — then **STOP** at the user-acceptance step
      (D2 precondition) and ask for screenshots before calling it done.
- [ ] **P4** 3D dental-scope engine (S1–S9) — not started.
- [ ] **P5** unified workspace — not started.
- [ ] **P6** retire the old charts — **blocked on the user's word ACCEPT (D2)**.
- [ ] **P7** premium design system — not started.
- [ ] **P8** interactive dashboard with real numbers — not started.
- [ ] **P9.2–P9.4** AI end-to-end [LOCAL], text AI provider (D4), licensing banner.
- [ ] **P10** stabilization of the known issues.
- [ ] **Part II** (14A–18 hardening) — gated behind every Part I gate.

## Decisions only the user makes (STOP and ask — never assume)

| Id | Decision | Status |
| --- | --- | --- |
| D1 | Distribution of 3D models to clinics (CC BY-SA ShareAlike) | **OPEN** — default `ASSET_MODE=none` in any shipped build |
| D2 | The word ACCEPT before retiring the old charts and protected tests | **OPEN** — blocks P6 |
| D3 | Clinician sign-off of primary-tooth anatomical data | **OPEN** — primary 3D stays a labelled crown-only schematic until then |
| D4 | AI text provider (none / cloud with data minimisation / local LLM) | **OPEN** — text AI stays `503 AI_NOT_CONFIGURED` until chosen |
| D5 | Subscription extension for the demo hospital (SUPER_ADMIN flow) | **OPEN** — not a DB hack |

## Never do

- No schema change for charts; no new persistence path (all writes go through
  `/api/dental-chart` with RBAC + audit + tenant isolation).
- No edits to protected Phase-3 odontogram tests until D2.
- No `--force` push, `--hard` reset, `clean -fd`, `migrate reset`, `--no-verify`
  (except a PROVEN environmental failure recorded in BLOCKERS.md).
- No `npm audit fix --force`; never print `.env` **values** in a report.
- No `.glb` (or any 3D model file) committed to git.
- Never weaken, skip or delete a test to get green.

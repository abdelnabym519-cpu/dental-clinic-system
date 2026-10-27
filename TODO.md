# TODO.md

## Now (in progress) — SESSION 2, branch `merge/fdi52-into-wip` @ `0819562a`

Order is fixed by the session brief; it deliberately does NOT follow WP1..WP8 of
`master-chart-ai-fdi.md`.

- [x] **S0 PREFLIGHT** — HEAD verified `0819562a`, environment recorded, baseline measured
      (tsc 498, lint 0/266, tests 6301/12/1 across 348 files), docs refreshed.
- [ ] **S1** `tests/unit/dev-start-env.test.ts` — keep the `not.toContain('Environment variable not
    found: DATABASE_URL')` assertion; widen ONLY the second assertion to accept
      authentication/credential rejection. Add a negative case. Unverifiable here (no Prisma client,
      no MySQL) — the user must run it.
- [ ] **S2** `clinical` HTTP 500 from `patient-360.tsx` — read-only: find the call, the route
      handler, and every 500 path; check what changed between `eba87b7` and HEAD. Facts only.
- [ ] **S3** CHART PAGE ERROR — **waiting for the user's Console + terminal text.** Until it
      arrives: only verify `ChartErrorBoundary` + retry (from `3f80351`) are present and tested.
      Do not claim they explain the error.
- [ ] **S4** WP4 code-level — 904-line `tooth-anatomy.ts`: valid non-degenerate geometry for all 32
      permanent AND all 20 primary ids; continuous arch, no overlaps within a stated tolerance.
      No invented anatomy (no primary root/canal counts).
- [ ] **S5** ARABIC-ONLY — **propose, do not edit protected files.** List every English string in
      the chart UI (incl. ArchGrid's hardcoded corner labels "Q1 (UR)"…; note `Quadrant`'s
      `subtitle` prop is never rendered). ArchGrid/Odontogram are Phase-3 protected. **WAIT.**

## Deferred / blocked

- Mixed-dentition UI — **DEFERRED** (BLOCKERS B8-B11; spike parked at `7d1800f`).
  Data, API, voice and AI layers already support all 52 ids.
- WP2 (AI runtime) — blocked in this sandbox (B2 docker, B3 model weights).

## Not to be touched in this session

`wip/realistic-teeth-anatomy`, `arena/91dddda0-dental-clinic-system`,
`spike/odontogram-mixed-dentition`. No merges, no rebases, no cherry-picks, no PRs.

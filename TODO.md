# TODO — unresolved verified work

## Machine-bound (requires the real machine: browsers + MySQL; sandbox-proven external)
1. Execute `npx playwright test tests/e2e/dental-chart-3d.spec.ts` at b045b4b+ on the
   real machine — certification gate: 18 passed / 0 failed / 0 skipped across all six
   projects. Precondition: `git log --oneline -1` MUST show b045b4b or newer FIRST —
   two consecutive runs executed stale trees; verify parity before trusting any count.
2. Full Playwright suite execution on the real machine (2952 tests, 53 files).

## Deferred (verified, by-design scope decisions — not defects)
3. Prescriptions tab in the patient file: verified absent; adding a tab is a feature
   addition (prescriptions exist as a first-class module at /prescriptions), deferred
   to product decision.

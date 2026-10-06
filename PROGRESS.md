# Progress — Whole-Repository Stabilization

## Current State
Baseline `a1ca14e` (Robot 76e944f + Dental Chart integration) carried **445 TypeScript
errors** (Robot-side debt) which blocked `next build`. One Ralph iteration found and
fixed the ROOT CAUSE (single upstream node); residual classes were then repaired with
certified, previously-validated fixes. Final state: **tsc 0 · suite 6141/0 · build exit 0 ·
lint 0 errors / 260 warnings · runtime smoke PASS.**

## Completed Iterations

### Iteration 1 — ROOT CAUSE: structural prisma client typing (P1)
- Problem: 445 tsc errors across ~50 files; `next build` type-check FAILED.
- Severity: P1 (build blocker).
- Root Cause: `lib/prisma.ts` typed the client structurally (`[model: string]: any`),
  making EVERY Prisma query result `any` → ~400 implicit-any errors cascading through
  every route/service that consumes query results. The type debt was upstream of all
  50 symptomatic files.
- Dependency Graph Impact: single upstream node → ~50 downstream files.
- Fix: type-only import of the real generated `PrismaClient` (erased at runtime;
  runtime architecture unchanged) + certified companion fix moving the fallback flag
  to `globalThis` (module-scoped flag was invisible across dev-bundler chunks —
  readiness could report "ok" without a database).
- Verification: tsc 445 → 52; downstream re-verified.
- Evidence: tsc output before/after; command in FINAL_REPORT.md.

### Iteration 2 — Residual classes exposed by real types (P1/P2)
One problem-class at a time, each adopted from the certified session lineage after
diff-verification that it is the minimal correct fix:
- `lib/billing/invoice-pdf.ts`: money type widened to `number | string | Prisma.Decimal`
  (runtime conversion stays centralized in money()/moneyLocal()) — fixed 28 errors at
  the consumer-type root.
- `lib/ai/action-pipeline.ts`: `findUnique` on non-unique compound fields (invoiceNo,
  appointmentNo, …) → `findFirst` — genuine runtime crash class (PrismaClientValidationError)
  on every AI command verification + fail-closed patient scope on DB error.
- `lib/ai/intelligence/proactive.ts` + `app/api/ai/intelligence/alerts/route.ts` +
  `tests/*` + `lib/ai/intelligence/clinic-brain.ts`: accessor typo `prisma.aiInsight`
  → `prisma.aIInsight` (undefined property → runtime TypeError class).
- `app/api/patient-portal/prescriptions/[id]/pdf/route.ts`: age computed from a patient
  projection WITHOUT dateOfBirth → crash class; now selected from the prescription's
  patient relation (staff-PDF parity).
- `lib/billing-utils.ts`: Arabic-first invoice/payment labels (I6) + missing `UPI`
  entry for the `PaymentMethod` enum (TS2741) — certified behavior of the unified-money work.
- `prisma/schema.prisma` + migration `20261005090000_add_welcome_message_type`:
  PROVEN necessary — `lib/messaging/service.ts` (robot code) references `WELCOME` while
  the robot schema lacked it (tree was internally inconsistent; compile + runtime).
  ENUM append is metadata-only and backward-compatible.
- `app/api/appointments/availability/route.ts`, `app/api/super-admin/hospitals/[id]/subscription/route.ts`,
  `app/api/imaging/jobs/[id]/review/route.ts`, `scripts/dev-start.ts`,
  `scripts/restore-dev-admin.ts`: typing/cast repairs (TS-prescribed, runtime-equivalent).
- 7 robot test files updated as CONTRACT UPDATES (assertions follow the repaired
  production behavior; each carries an explanatory comment; nothing weakened/deleted).

- Verification: tsc 52 → **0**; full suite 6141/0; lint 0/260; build exit 0; boot smoke PASS.
- Commit: (this commit)

### Iteration 2 — ROOT CAUSE: dev-start ran its DB probe without DATABASE_URL (P1, user-reported)
- Problem: `npm run dev:start` failed with "MySQL did not become ready within 180s /
  Environment variable not found: DATABASE_URL" while Docker reported mysql+redis Running.
- Severity: P1 (startup path broken on the canonical command).
- Root Cause (environment graph traced end-to-end): `scripts/dev-start.ts` validated that
  `.env` EXISTS but never LOADED it into `process.env`. A plain `tsx` process does not load
  env files (only the Prisma CLI and `next dev` do), so the script's own PrismaClient
  readiness probe ran with no DATABASE_URL and looped the exact reported error for 180s
  while MySQL was healthy. Docker was never the problem.
- Fix: new pure module `scripts/lib/dev-env.ts` (unit-tested) — canonical precedence
  **shell > .env.local > .env** (Next.js-compatible; shell keys snapshotted so file-vs-file
  override works), values injected only into unset keys, secret values never logged/returned;
  wired into `runSafeStartup` step 1 (load → secret-free summary logs → actionable
  `DATABASE_URL is not configured` error naming all checked sources → recommended-var
  warnings by name only). Downstream inheritors (probe PrismaClient, `prisma migrate deploy`,
  `next dev`) now all receive the configuration.
- Verification (A/B, executable): control run reproduced the EXACT user error
  (env-missing=true); fixed run shows DATABASE_URL reaching Prisma (env-missing=false;
  remaining sandbox error is the --no-engine client's prisma:// protocol requirement — a
  sandbox artifact, not repo behavior). 8 new unit tests incl. an orchestrator behavioral
  test proving DATABASE_URL is present in the process before the first command runs, and
  secret-safety (error text never contains planted secret values). One robot test
  (`dev-start.test.ts`) contract-updated for the deliberately improved error message;
  behavioral invariant (fails BEFORE any Docker command) asserted unchanged.
- Full regression: `npm run verify` EXIT 0 — tsc 0 · lint 0 errors/260 warnings ·
  suite 6149/12/0 · build 256 pages. Playwright install attempted → egress-blocked (B2).
- Commit: (this commit)

## Remaining Work
None in-scope. See BLOCKERS.md for environment-dependent verification limits.

## Current Risks
- Sandbox lacks MySQL/Redis/Docker/AUTH_SECRET/browser binaries → DB-backed runtime
  flows, authenticated UI walkthroughs and browser E2E are ENVIRONMENT-BLOCKED (tests
  cover them at unit/integration level with the real route handlers).

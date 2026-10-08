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

### Iteration 3 — P1 follow-up: real-machine still failed; seam hardened + stale-checkout self-evidence (user-reported)
- Problem: after 02448af the user's real `npm run dev:start` STILL showed the pre-fix
  failure signature (no `environment:` log line, old 'DATABASE_URL not found' probe error).
- Root Cause (two layers):
  (1) DECISIVE: the executing script on the user's machine did NOT contain 02448af — the
      output lacks BOTH new artifacts (v2 provenance line, new error message) while the
      code at HEAD verifiably contains them (grep at HEAD). The runtime was a stale/locally
      modified working tree.
  (2) LATENT: even with the loader, the probe client depended on process.env indirection.
- Fix: belt-and-braces seam hardening — the probe client now receives the resolved URL
  EXPLICITLY (`new PrismaClient({ datasources: { db: { url } } })`), making readiness
  immune to any env-inheritance quirk; provenance banner (dev-start with env-loader v2 +
  resolved root) makes a stale checkout SELF-EVIDENT; probe env-not-found errors now
  carry an actionable stale-checkout note; new permanent diagnostic `scripts/env-doctor.ts`
  (presence/source/cwd/execPath/argv — never values).
- Verification: real command executed in-repo — banner + `.env loaded (+1 keys)` printed,
  then the ONLY failure is Docker-absent (sandbox-external, AFTER the env stage);
  strengthened orchestrator test asserts the resolved URL is the CONSTRUCTOR ARGUMENT the
  probe receives (the real seam); real-PrismaClient test proves the explicit-datasource
  construction never fails with env-not-found; `npm run verify` EXIT 0 (6151/12/0).
- Commit: (this commit)

### Iteration 4 — P1 final bootstrap: the template itself was broken (user's env-doctor output)
- Evidence: user's real machine — loader v2 banner + `.env loaded (+6 keys)` but
  `DATABASE_URL present = false` -> assertDatabaseConfigured fired exactly as designed.
  The loader is innocent; the CONFIGURATION CONTRACT was incomplete.
- Root Cause: `.env.example`'s ACTIVE DATABASE_URL was `root:password@...` while
  docker-compose.dev.yml provisions root/dental — the canonical `cp .env.example .env`
  path could never reach a working `SELECT 1`. Required secrets shipped empty with no
  deterministic way to fill them.
- Fix: template's active DATABASE_URL now matches compose exactly (verified by a
  consistency test that parses the compose file); new `npm run setup:dev`
  (scripts/setup-dev.ts + pure scripts/lib/setup-dev.ts) — creates .env from the
  template, generates NEXTAUTH_SECRET/ENCRYPTION_KEY/CRON_SECRET crypto-randomly,
  fills only MISSING keys, never overwrites, never touches .env.local, idempotent,
  never prints values; all recovery messages (dev-start error, env-doctor verdict)
  now point to `npm run setup:dev`; README canonical first step updated; dev-start's
  recommended list aligned with app reality (NEXTAUTH_SECRET/ENCRYPTION_KEY/CRON_SECRET).
- Tests: tests/unit/setup-dev.test.ts — template<->compose consistency pin, cp-equivalence,
  fresh creation fills 4/4, existing values preserved verbatim + idempotent, fail-loud on
  template without active DATABASE_URL. Full harness EXIT 0.
- Real-machine expectation: `npm run setup:dev` -> `npm run dev:start` -> MySQL probe with
  explicit URL -> ready -> migrate deploy -> app. Docker/TCP legs remain sandbox-external.
- Commit: (this commit)

### Iteration 5 — evidence refresh: external blocks re-probed exhaustively, §13 record completed (no code change)
- Egress re-probe (2026-10-08): cdn.mysql.com, dev.mysql.com, registry.npmmirror.com,
  cdn.playwright.dev, playwright.azureedge.net, deb.debian.org — ALL unreachable (000);
  apt unusable; NO local mysqld/mariadb/docker/podman/mysql-client; npm-hosted
  `mysql-memory-server` is a runtime downloader for the blocked CDN. Pure-JS MySQL
  stand-in considered and REJECTED (would fake the exact readiness being certified).
  => B1/B2 remain genuinely BLOCKED_EXTERNAL, now with dated exhaustive evidence.
- BLOCKERS.md: B1 evidence table added; new §13 live-integration matrix
  (requirement/feature/command/resolution, no values) per the certification contract.
- No production code changed (HEAD 4d781b4 semantics untouched); docs-only iteration.
- Commit: (this commit)

### Iteration 6 — E2E repair: three stacked root causes behind the adminPage fixture failure (user's real browser run)
- Baseline (user's machine, browsers installed): 122 passed / 8 skipped / 1917 did not
  run — every fixture-dependent spec died in beforeEach (`locator.fill` 45s timeout).
- RC1 locale (fixture): the app is Arabic-first (`defaultLocale ar-EG`); fresh visitors
  get Arabic labels (auth.email = 'البريد الإلكتروني'). The harness asserts English
  label text (getByLabel(/email/i)) — provably zero matches. PROVEN LIVE: SSR of /login
  renders `<label for="email">البريد الإلكتروني</label>` without the cookie and
  `<label ...>Email</label>` with the app's own `dentora-locale=en-EG` cookie.
  Fix: (a) default Playwright storageState pins the app's OWN locale cookie
  (tests/e2e/locale-state.json — exactly what LanguageToggle writes; no Arabic-UI
  specs exist to conflict); (b) fixtures/auth.ts login() uses structural locators
  (#email / #password / form button[type=submit]) — immune to any label language.
- RC2 credentials (fixture): fixture used *@demo-dental.com while prisma/seed.ts
  creates *@dentora-dental.com — every login was an invalid-credentials failure even
  past RC1. Fix: fixture synced to seed (admin/doctor/reception @dentora-dental.com).
- RC3 secret (application, root): next-auth v5 reads ONLY AUTH_SECRET while the
  documented contract (.env.example + setup:dev) provisions NEXTAUTH_SECRET ->
  MissingSecret on every signIn/session/proxy-auth call. Fix: one canonical mapping
  `secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET` in the SHARED
  lib/auth.config.ts (inherited by lib/auth.ts AND the edge middleware instance);
  PROVEN LIVE: with provisioned env, /api/auth/session 200, /api/auth/providers 200
  (credentials provider listed), boot log clean (was: MissingSecret + 404/500s).
- Regression pins: tests/unit/e2e-fixture-contract.test.ts (10 tests, no browser
  needed) — seed<->fixture credential sync, structural selectors + no .getByLabel(
  at the login seam, locale-cookie pin wired in playwright.config, secret mapping in
  the shared config, no instance escaping it, login-page structural hooks exist.
- Validation: `npx playwright test --list` -> 2946 tests / 53 files (config + storage
  state valid); `npm run verify` EXIT 0 (6168/12/0, build 256 pages); phase12 bytes
  restored. Browser E2E execution remains BLOCKED_EXTERNAL in this sandbox (B2) —
  the user's machine (browsers + MySQL + seeded DB) runs `npx playwright test`.
- Commit: (this commit)

### Iteration 7 — 3D Dental Chart mission: full-stack audit, 2 gaps closed, all layers validated
- Phase 0/1 AUDIT (no premature writing): the interactive 2D/3D dental chart ALREADY
  exists as a complete architecture — DentalChartWorkspace (single summary fetch,
  single refetch point, client-mirrored RBAC enforced server-side), DentalChart3D
  (R3F/three: procedural anatomical teeth per FDI group — crown/root/cusps/sockets,
  parametric arch with correct patient-right mapping, per-tooth raycast picking,
  hover/select materials, camera presets, frameloop=demand, shared GPU resources +
  explicit disposal), DentalChart3DLoader (ssr:false + useSyncExternalStore WebGL
  detection + localized fallback), ToothContextPanel (findings/procedures/imaging,
  empty-select guard, busy states, no-plan honesty), zustand store (2D<->3D sync),
  aggregate summary API (view roles, tenant-404, read-only), FDI canonical module.
  Baseline: 72/72 dental tests green. NO schema change needed (pure reuse — Phase 16).
- GAP 1 (mission Phase 8, mandatory): the zustand store is a module singleton and
  nothing reset it on patient switch — Patient A's selected tooth/hover leaked into
  Patient B's chart. FIXED in DentalChartWorkspace (reset() on patientId change,
  before refetch) + component test 'PHASE-8 isolation' (selection/hover/panel all
  cleared, refetch for patient-2 asserted) — suite now 11/11.
- GAP 2 (mission Phase 14/19): tests/e2e/dental-chart-3d.spec.ts was doubly stale —
  it NEVER authenticated (middleware would bounce it to /login) and targeted
  /patients/patient-e2e-1 (not in seed; wrong id form). REWRITTEN on the repaired
  fixture architecture: doctorPage/receptionistPage shared fixtures, patient id from
  the REAL navigation path (list -> detail -> chart), honest 3D-or-fallback assertion,
  full critical path (split view -> canvas -> 2D-driven shared-store selection ->
  panel -> add finding via real API -> reload -> persisted state re-derived), the
  mandatory patient-isolation E2E, and read-only RECEPTIONIST. Collects 3 tests x
  6 projects = 18 (playwright --list total 2952).
- Also closed: missing component coverage for the PROCEDURE workflow (add-procedure
  posts to /api/treatment-plans/[planId]/items with toothNumbers '16' + single
  refetch; no-active-plan renders the honest message with NO save control).
- Live runtime (provisioned env): unauth chart page 307 -> login?callbackUrl=...;
  unauth summary GET 401; unauth finding POST 401; boot log clean (no MissingSecret).
- Full regression: npm run verify EXIT 0 (6171/12/0, build 256 pages); tsc 0; lint
  0 errors/260 warnings; phase12 bytes intact. No test weakened; no app behavior
  removed; Odontogram untouched.
- Limitations (documented, non-blocking): browser E2E execution + pointer-level
  3D canvas picking are verified on the REAL machine run (browsers/MySQL absent in
  sandbox — dated BLOCKERS.md evidence); 3D tooth numbering is delivered via the
  hover chip + context panel + 2D numbering (deliberate: no per-frame 3D text cost).
- Commit: (this commit)

### Iteration 8 — '12/12 dental-chart-3d failures': root cause = stale pre-8f5b972 spec on the executing machine
- DECISIVE EVIDENCE (4 independent lines, all in-repo): (1) the reported failing test
  names ('open patient dental chart, switch to 3D, select a tooth, see the panel',
  'RECEPTIONIST is read-only on the chart') exist VERBATIM only in the b4f4082 version
  of tests/e2e/dental-chart-3d.spec.ts; (2) the reported failure lines 15:55/37:55 are
  exactly that file's dental-chart-2d toBeVisible asserts — at 8f5b972 line 15 is a
  doc comment; (3) '12 tests executed' = 2x6 projects = the OLD suite's count; at
  8f5b972 the suite is 3x6 = 18; (4) the old spec never authenticates -> middleware
  307 -> /login -> dental-chart-2d never renders -> 'element(s) not found'. The repair
  itself already shipped in 8f5b972 (fixture-based rewrite).
- This iteration (hardening + proof, no production change):
  * test.use desktop workstation viewport (1366x768) — the shared patients-list
    navigation helper is desktop-layout; all 6 ENGINE projects still run.
  * isolation test made NON-VACUOUS: seed guarantees 10 patients, so the second row
    is now asserted, not conditionally skipped.
  * locale contract re-verified against locales/en.json (3D View / Split View /
    Add finding / Save / View Details all match the spec regexes with the pinned
    dentora-locale=en-EG cookie).
- Honest execution status: sandbox cannot run browsers (chromium executable absent;
  CDN egress-blocked — re-demonstrated this iteration: 'Executable doesn't exist',
  ~/.cache/ms-playwright empty; dated probe matrix in BLOCKERS.md). Targeted result
  at HEAD must be 18 passed / 0 failed on a browser+MySQL machine.
- Full regression: npm run verify EXIT 0 (6171/12/0, build 256 pages); tsc 0;
  playwright --list 2952 total, 18 in the targeted file.
- Commit: (this commit)

### Iteration 9 — real-machine 16/18 failure classes: auth contract + Radix nav made engine-independent
- User machine: 18 collected, 2 passed / 16 failed; auth.ts:40 waitForURL(/dashboard|onboarding/)
  timeouts on several engines; patients.ts menuitem (WebKit) + waitForURL (Firefox); 2 passed
  => one project authenticated fine => credentials/seed/secret VALID on real DB; the failing
  seam is the CLIENT-REDIRECT TIMING assumption, not auth itself.
- RC-A (auth fixture): login() raced the login page's client-side router.push (fetch-callback
  -> engine-dependent). REWRITE: observe the real credentials callback
  (POST /api/auth/callback/credentials; accept 200 and 302 transports; non-ok throws a
  DIAGNOSTIC error naming seed/secret checks), then require a server-issued session cookie
  (authjs|next-auth session-token prefix regex — v4/v5/__Secure/chunked), then prove the
  middleware accepts it (goto /dashboard + toHaveURL(/dashboard) — a rejected session 307s to
  /login and fails loudly). No bypass, no fake cookies; REAL auth contract, engine-independent.
- RC-B (patient nav): the row menu trigger is an icon-only button with NO accessible name and
  the fixture blind-clicked '.last()' then raced the Radix portal mount (WebKit drops the first
  pointer event during mount). FIX (production a11y, justified): trigger now carries
  aria-label={t('ui.actions')} (en 'Actions' / ar 'إجراءات'); fixture targets
  button[aria-haspopup="menu"], ASSERTS the role=menu portal is open before the item click,
  and verifies the destination with a function predicate on pathname (never /patients/new).
  New shared helper openPatientDetailByRow(page, rowIndex); openFirstPatientDetail delegates.
- RC-C (spec): isolation test now uses the shared helper for Patient B (row 1, seed-guaranteed);
  the FDI round-trip is explicit (panel header number captured pre-reload, asserted post-reload).
- Phase 11 (stream error): classified SECONDARY — Next dev logs 'The destination stream closed
  early' when the CLIENT aborts an in-flight RSC stream; the failing tests' teardown after
  waitForURL timeouts is exactly that pattern. Sandbox: all responses completed with correct
  codes (200/302/307) under repeated mid-render aborts; the error is logged, never thrown, and
  absent from every clean flow. Also observed: raw callback POST without CSRF -> MissingCSRF
  302 (protection working; secret healthy). No production change.
- Pins: contract suite extended to 13 tests (auth contract present, brittle pattern banned,
  Radix menu contract, a11y trigger name). verify EXIT 0 (6174/12/0, build 256 pages); tsc 0;
  lint 0. A corrupted .next/dev/types/validator.ts (dev-server artifact) briefly broke
  typecheck — cleared, regenerated cleanly; no source impact.
- Final honesty: the 18-test browser matrix remains machine-bound (sandbox browsers blocked,
  dated evidence). Expected on the real machine after pull: 18 passed / 0 failed / 0 skipped.
- Commit: (this commit)

## Remaining Work
None in-scope. See BLOCKERS.md for environment-dependent verification limits.

## Current Risks
- Sandbox lacks MySQL/Redis/Docker/AUTH_SECRET/browser binaries → DB-backed runtime
  flows, authenticated UI walkthroughs and browser E2E are ENVIRONMENT-BLOCKED (tests
  cover them at unit/integration level with the real route handlers).

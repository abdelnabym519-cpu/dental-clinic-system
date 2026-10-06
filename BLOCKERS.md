# Blockers — genuinely external only

## B1 — Database-backed runtime verification
- External Dependency: MySQL 8.4 (docker-compose.dev.yml) — not installable in this sandbox (no Docker daemon; egress-blocked).
- Exact Requirement: running MySQL + `DATABASE_URL` (auto-loaded by `npm run dev:start` after Iteration 2).
- Why Required: end-to-end persistence flows (login → CRUD → readiness 200).
- Affected Verification: DB matrix row = PARTIAL. The ENVIRONMENT-LOADING half of this
  blocker was FIXED and PROVEN in-repo (A/B: the exact user failure reproduced, then
  eliminated; `npm run dev:start` now loads shell > .env.local > .env before any Prisma
  work). The TCP/query half needs a real MySQL — one command on the developer machine:
  `npm run dev:start` (user's containers were already Running; the probe will now reach them).
- Current Status: ENVIRONMENT-BLOCKED (database runtime only; environment-loading repaired).

## B2 — Browser/E2E execution
- External Dependency: Playwright browser binaries + display (absent; `npx playwright install chromium` attempted this iteration and failed on sandbox egress — evidence recorded).
- Affected Verification: Playwright specs (`tests/e2e/*.spec.ts`) — CODE-VALIDATED only.
- Available Alternative: `npx playwright install && npx playwright test` on a developer machine.
- Current Status: ENVIRONMENT-BLOCKED.

## B3 — Auth secret / external credentials
- External Dependency: `AUTH_SECRET` (Auth.js), Cloudflare `CLOUDFLARE_*` (documented live contract), SMS/WhatsApp providers.
- Affected Verification: authenticated UI walkthrough; live AI inference (deterministic harness + typed-failure suites cover the contract).
- Current Status: ENVIRONMENT-BLOCKED (never printed; values live only in the operator's environment).

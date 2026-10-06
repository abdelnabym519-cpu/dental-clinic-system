# Blockers — genuinely external only

## B1 — Database-backed runtime verification
- External Dependency: MySQL 8.4 (docker-compose.dev.yml) — not installable in this sandbox (no Docker daemon; egress-blocked).
- Exact Requirement: running MySQL + `DATABASE_URL`.
- Why Required: end-to-end persistence flows (login → CRUD → readiness 200).
- Affected Verification: DB matrix row = PARTIAL (migrations validated by apply-order review + schema/engine consistency; suite covers handlers with the real Prisma client against mocked persistence).
- Available Alternative: developer machine: `npm run dev:start` (documented startup contract).
- Current Status: ENVIRONMENT-BLOCKED.

## B2 — Browser/E2E execution
- External Dependency: Playwright browser binaries + display (absent; `~/.cache/ms-playwright` empty).
- Affected Verification: Playwright specs (`tests/e2e/*.spec.ts`) — CODE-VALIDATED only.
- Available Alternative: `npx playwright install && npx playwright test` on a developer machine.
- Current Status: ENVIRONMENT-BLOCKED.

## B3 — Auth secret / external credentials
- External Dependency: `AUTH_SECRET` (Auth.js), Cloudflare `CLOUDFLARE_*` (documented live contract), SMS/WhatsApp providers.
- Affected Verification: authenticated UI walkthrough; live AI inference (deterministic harness + typed-failure suites cover the contract).
- Current Status: ENVIRONMENT-BLOCKED (never printed; values live only in the operator's environment).

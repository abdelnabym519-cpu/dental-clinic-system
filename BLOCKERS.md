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
- Evidence refresh (2026-10-08, exhaustive local + egress probe):
  * Local runtimes: `mysqld`, `mariadbd`, `mysql` client, `docker`, `podman`,
    `nerdctl` — NONE present; no mysql/mariadb-server packages installed.
  * Egress (HTTP HEAD, 10s timeout): cdn.mysql.com, dev.mysql.com,
    registry.npmmirror.com, cdn.playwright.dev, playwright.azureedge.net,
    deb.debian.org — ALL unreachable (000); apt unusable (no list write
    permission, mirrors unreachable). Only registry.npmjs.org is reachable.
  * npm-hosted alternatives (`mysql-memory-server` 1.17.0 resolvable) are
    RUNTIME DOWNLOADERS for the blocked CDNs — not usable offline.
  * A pure-JS MySQL-wire-protocol stand-in was considered and REJECTED
    (would fake the exact readiness this certification must prove).
  => a REAL MySQL in this sandbox is impossible; the DB leg is proven by
  construction (explicit-datasource probe, test-pinned compose consistency)
  and executes on any Docker machine via `npm run setup:dev && npm run dev:start`.

## B2 — Browser/E2E execution
- External Dependency: Playwright browser binaries + display (absent; `npx playwright install chromium` attempted this iteration and failed on sandbox egress — evidence recorded).
- Affected Verification: Playwright specs (`tests/e2e/*.spec.ts`) — CODE-VALIDATED only.
- Available Alternative: `npx playwright install && npx playwright test` on a developer machine.
- Current Status: ENVIRONMENT-BLOCKED.

## B3 — Auth secret / external credentials
- External Dependency: `AUTH_SECRET` (Auth.js), Cloudflare `CLOUDFLARE_*` (documented live contract), SMS/WhatsApp providers.
- Affected Verification: authenticated UI walkthrough; live AI inference (deterministic harness + typed-failure suites cover the contract).
- Current Status: ENVIRONMENT-BLOCKED (never printed; values live only in the operator's environment).


## §13 — Live integrations: requirement / feature / command / resolution (no values)

| Integration | Requirement (why external) | Feature affected | Command that would verify | Resolution |
|---|---|---|---|---|
| Cloudflare AI Gateway (`@cf/zai-org/glm-4.7-flash`) | Real CF account + token (user's `.env.local` only — never in sandbox) | AI treatment advisor, robot insights | `npm run dev:start` + AI compose + authenticated AI request | BLOCKED_EXTERNAL — unauth path pinned 401; fallback model contract pinned; no fabricated AI success |
| OpenRouter | Real API key | Optional AI features under `OPENROUTER_API_KEY` | authenticated request via gateway routes | BLOCKED_EXTERNAL — key absent by design here |
| SMTP (Mailpit dev or real) | Mail server (compose provides Mailpit on Docker machines; real SMTP needs credentials) | email notifications/password reset | `npm run dev:start` + Mailpit UI :8025 | BLOCKED_EXTERNAL in sandbox; on user machine Mailpit arrives with the same compose |
| WhatsApp Meta Cloud API | Business tokens + phone IDs | WhatsApp messaging (Phase 10) | `npm run whatsapp:test -- <number>` | BLOCKED_EXTERNAL — `MESSAGING_ENABLED=false` keeps the mock provider verifiable in tests |
| SMS (Twilio / Africa's Talking) | Provider credentials | SMS reminders/fallbacks | authenticated send with test number | BLOCKED_EXTERNAL — mock provider verified in suite |
| S3/MinIO | Object store (compose provides MinIO on Docker machines) | file storage when `STORAGE_DRIVER=s3` | `npm run dev:start` + bucket check | BLOCKED_EXTERNAL in sandbox; `local` driver fully test-verified |
| Playwright browsers | Browser binaries (CDN egress-blocked — see B2) | browser E2E + Dental Chart browser run | `npx playwright install` → `npx playwright test` | BLOCKED_EXTERNAL (fresh 2026-10-08 probe in B2) |

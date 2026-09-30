# DENTORA AI — Phase 11: Full Integration + Deployment Hardening

> **Status: 🟢 SANDBOX GREEN (with explicit blockers).** All gates that can be
> validated in this environment pass; every environment-bound blocker is
> documented with evidence and the exact target-machine command that closes it.
> SANDBOX GREEN does **NOT** mean production-ready. Phase 12 (clinical
> certification) is **not started**.
>
> Baseline: Phase 10 commit `8bd8d87`. Version contract: `1.0.0` (package.json).
> Environments: Node v22.22.3, Vitest 2.1.9, Next 16.3.8, Arena sandbox (2 vCPU class).

---

## 1. Executive Summary

Phase 11 turns the completed DenToRa AI stack into **one coherent, deployable,
resilient system** — without creating a second anything. The audit (§4) found a
mature architecture; this phase added the missing production contracts, fixed
the real defects it surfaced, and validated everything with **67 new tests**
(full suite **6,036 passed / 12 skipped / 0 failed**, up from 5,969/12).

Highlights:
- **Environment contract** (`lib/config/env.ts`): every production-sensitive
  variable named, classified, validated; production preflight **fails fast**
  naming variables, never values.
- **Correlation IDs** (`lib/observability/correlation.ts`): typed,
  shape-validated (arbitrary client strings are never trusted), echo-able.
- **Structured logging** (`lib/observability/logger.ts`): JSON lines,
  6 severities, recursive secret/PHI redaction before serialization.
- **Typed API error contract** (`lib/api/errors.ts`): `{code,message,
  requestId,details?}`, Arabic/English catalog, no stacks/DB errors/paths.
- **Canonical timeouts + retry classification** (`lib/config/limits.ts`):
  9 finite timeout classes; security/user-action failures are NEVER retried.
- **Reusable rate limiter** (`lib/api/rate-limit.ts`) + **CORS policy**
  (`lib/config/cors.ts`): credentials can no longer ride a wildcard origin.
- **Voice pipeline fail-safe**: a database outage during entity resolution now
  produces a typed `VOICE_DEPENDENCY_ERROR` with the session persisted in a
  recoverable ERROR state (previously it could throw past the boundary —
  found by failure injection, fixed, tested).
- **Health/readiness enriched** (version, revision, environment, optional
  subsystems reported honestly without gating readiness).
- **Build reproducibility**: Google-Fonts build dependency **removed**
  (Inter self-hosted from vendored OFL woff2); `@resvg/resvg-js` installed so
  the arch tool type-checks; `next` upgraded 16.2.12→**16.3.8** closing
  **4 critical RCE advisories**; **12 remaining audit findings all require
  major-version upgrades** (breaking; deliberately deferred, §62).
- **Deployment engineering**: `scripts/deploy.sh` (8 fail-safe stages),
  `scripts/smoke.sh` (deterministic, optional authenticated flow).
- **Validation**: failure injection (14), adversarial cross-layer (13),
  integrated E2E scenarios A–E (6), env-labeled perf (5).

## 2. Baseline

Pre-Phase-11 (Phase 10 commit `8bd8d87`): **5,969 passed / 12 skipped /
0 failed** (318 files); `tsc --noEmit` 503 pre-existing errors (prisma-stub
environment baseline); working tree clean; remote == local.

## 3. Full Architecture

The canonical architecture is UNCHANGED and re-validated (diagram in the
master prompt §3): Robot → Voice/Chat/UI → Interaction Layer → **one Agent**
→ Dental Brain / Clinic Brain / Patient AI → **one Case/Patient Graph** →
Memory / Dental RAG / Multimodal → Local AI Engines → Tools → Workflows →
Safety → Approval → Execution → Verification → Audit → Observability/Eval.
Phase 11 added **no new subsystems** — only contracts, hardening, and
validation around this exact graph.

## 4. Integration Graph (audit result)

Verified dependency edges (repo evidence):
`app/api/ai/voice/turn` → `lib/ai/voice/pipeline` → `lib/ai/agent/loop`
(loop.ts:373) → `{context, knowledge, intelligence/{case-graph,dental-brain,
patient-ai,clinic-brain}, multimodal, engines, workflows}` →
`lib/ai/action-policy` → `lib/ai/action-pipeline` → executors →
`AuditLog`. Voice sessions (`AIConversation` reuse) and robot rendering
(presentation-only) attach to the same spine. Storage (`lib/storage`) serves
documents/attachments/imaging. **No duplicate services found**; the Phase 5
engines registry, Phase 7 evaluation, and Phase 8 memory are each singletons.

**Findings fixed in-scope:** pipeline boundary throw (§15 below); CORS
wildcard+credentials (§27); login-page font network dependency (§52);
`@resvg/resvg-js` missing dev dependency (§69); `next` critical RCEs (§62).
**Findings documented out-of-scope:** login rate limiting (NextAuth-internal;
§28 documents it — protected-file adjacency, NEXT ACTION custom provider
wrapper), 12 npm audit majors (§62), Arabic local AI models (Phase 10
blocker, unchanged).

## 5. Environment Contract

`lib/config/env.ts` — `ENVIRONMENT_SPECS` (15 vars: name/purpose/required/
secret/devDefault/appliesTo), `currentEnvironment()` (APP_ENV > NODE_ENV >
CI — NODE_ENV alone is never a security control), `validateEnvironment()`
(MISSING_REQUIRED / DEV_FALLBACK_IN_PRODUCTION / INSECURE_VALUE),
`requireValidEnvironment()` (fail-fast; message names variables, never
values). Secrets: `DATABASE_URL`, `NEXTAUTH_SECRET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `OPENROUTER_API_KEY`, `WHATSAPP_ACCESS_TOKEN` — all
optional-by-exception only where a local/honest path exists (local-first, §14).

## 6. Configuration Matrix

| subsystem | Local/Dev | Test/CI | Staging | Production | notes |
|---|---|---|---|---|---|
| App | `next dev` | vitest (no DB) | docker `app` | docker `app` | standalone output |
| Database | MySQL local (`DATABASE_URL` devDefault) | **not required** (fake boundary) | required | required | `migrate deploy` only |
| Auth | NextAuth dev | mocked | `NEXTAUTH_SECRET` required | required + `NEXTAUTH_URL` | protected WIP untouched |
| Storage | local driver `UPLOAD_DIR` | tmp dirs | s3 or local | s3 (`S3_*` required when `STORAGE_DRIVER=s3`) | driver-validated at construction |
| AI provider | optional | fixture | optional | optional (local-first) | absent ⇒ honest degradation |
| Voice | browser Web Speech | fixture STT | +opt-in command STT/TTS | same | `DENTORA_VOICE_STT_CMD/TTS_CMD` |
| Redis | not used | not used | not used | not used | compose profile exists, **app does not depend on it** |
| CORS | `*` (no credentials claim) | n/a | `CORS_ALLOWED_ORIGINS` allowlist | allowlist recommended | §27 |

## 7. Database Hardening

No new migrations were required (additive code only — `prisma/` untouched).
Existing deployment behavior audited and preserved: `migrate` runs
`prisma migrate deploy` in compose (never `reset`/`dev`); `scripts/verify-
persistence.ts` exists for post-migration checks; tenant scoping is enforced
at every repository call (re-verified by the Phase 11 adversarial suite);
indexes/FKs are owned by the existing migration history — **not rewritten**
(§9: do not rewrite unnecessarily). Rollback strategy: §77.

## 8. Redis Hardening

**Finding: the application does not use Redis.** The compose file ships an
optional `redis` profile ("nothing uses Redis yet" — its own comment).
Therefore: no Redis failure mode exists; no Redis code path can bypass
approval/tenant/security because there is no Redis code path. `/api/ready`
reports `redis: 'not_configured'` honestly. If Phase 12+ introduces a Redis
consumer, the timeout class (2 s) and fail-safe rules are already codified
(`TIMEOUT_CLASSES_MS.REDIS`).

## 9. Storage Hardening

`lib/storage` audited: canonical keys `{hospitalId}/...` with
`assertSafeSegments` traversal rejection; `keyBelongsToHospital` is the
tenant gate (`app/api/uploads/[...path]` compares caller tenant); S3 driver
validates configuration at construction (named-variable failure); local
driver root is path-resolved and its failures surface as typed errors
(tested: unwritable root → throw; unknown driver → named throw; cross-tenant
keys denied). URL/content-type/size protections live at the upload routes
(10 MB cap, content signatures via multimodal preprocessing). Object
credentials are server-only (never client-bundled).

## 10. AI Deployment

Engines remain governed by the **single** capability matrix
(`lib/ai/engines/capability-matrix.ts`): per-task status
(AVAILABLE/PARTIAL/BLOCKED/RESOURCE_BLOCKED/UNKNOWN) with provenance. No
engine was promoted without evidence (§13); Scenario B of the integration
suite asserts the matrix answers honestly. Startup contract: engines are
**not** in the web process — they are opt-in local tooling with registered
hashes; the web app degrades honestly when absent (Scenario E, §15).

## 11. Orchestrator

**Audit finding: there is no FastAPI orchestrator in this repository** — the
master prompt's assumption does not match the implementation. Local AI
execution is bounded by the capability matrix + the multimodal pipeline
inside the Next.js app; heavy engines run out-of-process as operator-invoked
tools (Phase 5 evidence). Scope/identity/checksum rules that would bind an
external orchestrator are already enforced where execution actually happens:
action policy (`lib/ai/action-policy.ts:421`), provenance fields on
`aiAnalysisJob`, and the voice/audio file-safety layer. Documented so a
future orchestrator inherits these contracts.

## 12. Queue

Job semantics live in `lib/ai/workflows` (`AiWorkflowRun`, DB-backed): states
`PENDING/RUNNING/WAITING_APPROVAL/COMPLETED/FAILED/CANCELLED/EXPIRED` with an
explicit legal-transition table and terminal states (verified in the Phase 11
adversarial suite). Duplicate sensitive execution is prevented at TWO layers:
workflow fingerprint/idempotency (Phase 9) and the voice duplicate window
(Phase 10) — both re-tested under failure injection. No separate queue
infrastructure exists (Redis §8).

## 13. Retry

`classifyError()` (§17) — verified: `SAFETY_BLOCK/TENANT_MISMATCH/
APPROVAL_REPLAY/FORGED_PROVENANCE/UNAUTHORIZED` → **maxRetries 0**
(SECURITY_FAILURE); `APPROVAL_REQUIRED/CLARIFICATION_REQUIRED` →
USER_ACTION_REQUIRED; `ECONNRESET/TIMEOUT/…` → RETRYABLE with a bounded
budget (≤3) and `backoffSchedule()` exponential delays. The approval pipeline
itself never retries a decision; the voice pipeline never retries at all
(one shot per utterance, honest errors).

## 14. Timeout

`TIMEOUT_CLASSES_MS`: REQUEST 30s, TOOL 15s, WORKFLOW_STEP 20s, DATABASE 10s,
REDIS 2s, OBJECT_STORAGE 15s, AI_ENGINE 120s, STT/TTS 30s — all finite
(unit-enforced < 10 min). Component-level enforcement pre-exists and stays:
agent `trace.limits.totalTimeoutMs` (20 s), command-provider 30 s spawn
timeouts, provider output caps. No infinite waits anywhere in the AI stack.

## 15. Degraded Mode

Implemented and tested: TTS unavailable → text response remains complete
(NullTtsProvider contract); STT/local engine binary missing → typed error,
text input remains; database outage → `VOICE_DEPENDENCY_ERROR` honest message,
no fabricated clinical content; AI engine absent → capability matrix answers
honestly (Scenario B); Redis not configured → not a dependency. **Degradation
never bypasses security** — every degraded path keeps auth, tenant scope, and
approval gates intact (failure-injection suite).

## 16. Health/Readiness

`/api/health` (liveness; touches nothing) now also reports `version`,
`revision`, `environment`. `/api/ready` gates ONLY on the required
dependency (database `SELECT 1` → 503 on failure) and reports storage
driver presence, `redis: not_configured`, and local-AI registry status as
**informational** — optional dependencies are never falsely critical
(§20), and readiness never lies ready when the DB is down (route tests).

## 17. Startup

Compose order: mysql (healthcheck) → migrate (one-shot `migrate deploy`) →
app (depends_on mysql healthy). UI readiness: the dashboard requires an
authenticated session against the database — an unready DB cannot serve a
"ready" page. `/api/ready` is the orchestrator-facing gate. Documented
startup sequence (§76): config validation → DB → migrations → app → health →
readiness → smoke → release.

## 18. Shutdown

Next.js standalone receives SIGTERM from compose (`stop_grace_period`);
in-flight requests drain. Voice sessions are in-memory with a 15 min TTL —
a killed instance loses only ephemeral interaction state (conversation
memory persists in `AIConversation`); the voice turn sweep on every request
garbage-collects stale rows (§24 hardening implemented this phase). Workflow
runs persist in `AiWorkflowRun` and resume as FAILED/EXPIRED per the state
machine — no persistent state is corrupted by shutdown (by construction:
all durable state is transactional in MySQL).

## 19. Streaming

The agent/voice surface is request/response (no SSE to the browser); chat
streaming uses the existing OpenRouter path with abort propagation. Client
disconnect cannot cause background action: sensitive execution requires the
approval ledger (a human POST), never a stream callback. The voice hook's
`PLAYBACK_ENDED` is idempotent server-side (state-guarded). Bounded
backpressure: speakable text ≤800 chars; command-provider output caps.

## 20. Voice Deployment

Phase 10 interfaces unchanged (no redesign). Hardened: session sweep on the
turn hot path (bounded memory); `VOICE_DEPENDENCY_ERROR` fail-safe;
fingerprint+telemetry remain PHI-minimized; provider registry stays honest
(`EXTERNAL_TRANSPORT` declared for browser STT). Session store remains
**single-node in-memory by explicit decision** (master prompt §24: retain
unless a safe production upgrade is clearly justified — the isolated
`session-store.ts` interface remains the swap point; no duplicate authority
introduced).

## 21. Robot Deployment

Presentation-only (no data access, no DB calls) — unchanged by design and
re-asserted by component tests. Bundle impact: robot + panel are client
components on the AI Companion page only (not in the root layout);
animations are CSS/SMIL with reduced-motion suppression; kiosk size for
tablets. Robot failure cannot break the Agent (no inverted dependency).

## 22. Frontend Hardening

Server-only secrets are not imported by client components (voice/robot use
relative API URLs only). `poweredByHeader` off; standalone output; static
security headers for all routes (§27). Error boundaries/loading states are
the existing app-wide conventions (untouched). The font change (§52)
removes the last build-time network fetch from the layout.

## 23. Authentication

NextAuth behavior preserved; **protected WIP files untouched** (§5, verified
zero diff). `lib/auth.config.ts` (edge-safe, separate from protected
`lib/auth.ts`) unchanged. Session expiry/cookie flags are NextAuth v4
defaults with the app's existing configuration. **Documented gap (not
modified, per §28): no login attempt rate limiting** — NextAuth's internal
endpoint is not route-wrapped here; NEXT ACTION: a credentials-provider
wrapper with the audit-log limiter (would touch auth config adjacent to
protected work — deferred with user visibility).

## 24. RBAC

All roles (ADMIN/DOCTOR/RECEPTIONIST/ACCOUNTANT/LAB_TECH + PATIENT portal)
remain enforced server-side: middleware role routes, `requireAuthAndRole`
on AI routes (re-tested 401/403), workflow `ALL_WORKFLOW_ROLES` gate,
approval `approvalRoles`, memory `CLASS_TO_ROLES`/`DOMAIN_WRITE_ROLES`
(re-tested: PATIENT cannot reach workflow runs; AI cannot write
CLINICALLY_VERIFIED; RECEPTIONIST cannot approve). No client-side role
check is treated as authorization anywhere in the AI surface.

## 25. Tenant Isolation

Cross-tenant audit re-executed at the Phase 11 seams: patient resolution
(tenant-scoped findMany — tested), voice sessions (userId+tenantId binding —
tested cross-user AND cross-tenant), storage keys (`keyBelongsToHospital` —
tested incl. traversal shapes), approvals (`findApprovalForTenant` → 404 —
tested), knowledge/graph/memory (tenant columns; Phase 7 goldens HOSP_B
leak-guards still green in the full suite). Every cross-tenant identifier
fails closed.

## 26. Patient Isolation

Patient context is never taken from client claims: the voice pipeline
resolves patients server-side from spoken hints (clarify, never guess) and
the agent re-verifies `patientId` against the tenant (loop.ts:74-81,
re-validated). Cross-patient leakage tests: adversarial voice patient-spoof
(other-tenant name → NOT_FOUND), Phase 7 cross-patient traps (A2's tooth-36
never appears in A's context) — all green in the full run.

## 27. Action Safety

The Phase 1 pipeline (Policy → RBAC → Validation → Tenant Scope → Financial
Guardrails → Fingerprint → Approval → Idempotency → Transaction → Executor →
Verification → Audit) is UNTOUCHED and re-verified: `approveAndExecute`
fingerprint integrity, RBAC re-check, duplicate-window idempotency all
exercised by the existing approval-safety evals (green in the full run).
No Phase 11 code executes financial or sensitive actions directly.

## 28. Approval

Fake/stale/expired/wrong-tenant/wrong-patient/replay/mutation/escalation
approvals: covered by the existing approval-safety evaluation suite (green)
PLUS new Phase 11 route-level tests (non-approver → 403; cross-tenant id →
404) and the voice binding tests (expired binding → inert). The robot panel
can only POST decisions to the ledger route — params always come from the
stored row.

## 29. Financial Safety

No AI route modifies financial records directly: payments/invoices flow
through `runAiAction` → policy (`action-policy.ts:421`) → approval →
transaction executor → verification → audit. Re-verified via goldens
(RECEPTIONIST financial → FAILED SAFETY_BLOCK "not permi…"), the voice
Scenario-D approval stop, and the adversarial injection attempts.

## 30. Audit

Existing `AuditLog` hardening retained; voice/turn audits carry
state/op/agentStatus/taskType/error/totalMs/approvalRequired — never
transcripts/audio (route test asserts the payload excludes spoken content).
New structured logs (§39) carry correlation ids and are secret-redacted.
No chain-of-thought, secrets, raw audio, or unnecessary PHI is stored.

## 31. Correlation IDs

`x-correlation-id`/`x-request-id` accepted ONLY when matching
`^[A-Za-z0-9_-]{8,64}$`, else a typed `c-<time>-<rand>` is minted; the id
echoes on error responses and binds logs to agent `requestId`s
(`vturn-…`/`req-…` already embedded). Client strings are never trusted
identity (tested: path/hostile strings replaced).

## 32. Observability

Phase 7 remains the ONE framework: trace objects (`traceId`, stages,
toolCalls, modelCalls), environment-labeled benchmarks, eval gates. Phase 11
added the log/correlation layer around it — no second telemetry system.
Captured dimensions per surface: latency (medians/p95 in §55), status,
error codes, retries (bounded), timeouts (bounded), correlation id.

## 33. Logging

`lib/observability/logger.ts`: DEBUG/INFO/WARN/ERROR/SECURITY/AUDIT;
JSON-line output with ts/level/msg/version/correlationId/component;
recursive redaction of password/token/secret/apiKey/authorization/cookie/
audio/transcript keys; error objects serialize name+message only; LOG_LEVEL
gate. Deployed on the new paths (preflight output, deploy script, ready
failures keep existing console.error for ops familiarity).

## 34. Error Contract

`{error: {code, message, requestId, details?}}` via `apiErrorResponse()` —
codes map to statuses (400/401/403/404/409/429/500/503/504); messages come
from the ar/en catalog through the existing i18n dictionary; stacks, DB
errors, and filesystem paths never leave the server (`internalDetail` stays
server-side by type). Wired on new code paths; legacy routes keep their
existing (dictionary-keyed) messages — migration is incremental by design.

## 35. Rate Limiting

AI chat/agent/voice-turn: 60/min/user (audit-log backed) — audit confirmed;
extracted into `checkRateLimit()` for reuse. Uploads and data-import have
size caps; knowledge ingestion and workflow triggers remain role-gated with
the same pattern available. Rate limiting never substitutes authorization
(§41) — every limiter runs AFTER `requireAuthAndRole`.

## 36. Upload Security

Existing enforcement audited and preserved: 10 MB document cap, MIME/extension
checks, content-signature sniffing in multimodal preprocessing, DICOM/mesh/
PDF budgets in the Phase 6 pipeline, storage-key traversal rejection,
filename normalization via canonical keys. Client MIME is never trusted
(signature detection). New tests: hostile storage keys (§9), oversized/unsafe
audio (Phase 10 suite, still green).

## 37. Document Security

Documents remain untrusted data: the adversarial suite replays an injected
instruction INSIDE document content through the voice path — the agent
treats it as data (no instruction-following, nothing sent anywhere, no
approval granted). RAG remains PUBLISHED-only curated dental knowledge with
PHI rejection (Phase 4 gates green in the full run).

## 38. AI Output Security

Clinical outputs preserve the existing 5-band epistemic labeling
(Directly Visible / Model Finding / Clinical Interpretation / Uncertainty /
Missing Information) — Phase 8 dental-brain contract, untouched. TTS shaping
never adds certainty (Phase 10 tests, still green). Generated text never
becomes database truth without the action pipeline (§27).

## 39. Memory

Phase 8 memory hardening re-verified: trust levels are stored facts
(AI_DERIVED candidates are excluded from clinical context by default);
`CLASS_TO_TRUST` forbids AI candidates from carrying CLINICALLY_VERIFIED;
`validateWrite` rejects escalation attempts (newly tested); retrieval
budgets and poisoning resistance unchanged (Phase 8 gates green).

## 40. RAG

Phase 4 contract unchanged and green: PUBLISHED-only retrieval, source
provenance, versioning, tenant behavior, PHI rejection, citation
verification, explicit T4 marking. No hidden knowledge expansion;
dental-specialized scope intact.

## 41. Graph

Phase 9 case/patient graph unchanged: canonical graph, patient+tenant scope,
provenance on edges, consistency checks REPORT-never-repair, bounded
context. Phase 9 gates green in the full run.

## 42. Workflows

Phase 9 engine unchanged: explicit state machine with terminal states,
replay-safe run store, step budgets, RBAC (`ALL_WORKFLOW_ROLES`), approval
integration via the Phase 1 pipeline, stale-run expiry. New adversarial test
proves the API rejects out-of-privileged roles (401/403 fail-closed).

## 43. Multimodal

Phase 6 pipeline unchanged: attachment scope checks, signed/validated
access, MIME validation, size/pixel/mesh/DICOM limits, tenant+patient
isolation, provenance. Green in the full run (multimodal evals untouched).

## 44. Voice/Robot Integration

End-to-end validated by Scenarios A–E (§57): voice→agent→patient context
(A), voice→imaging intent→honest engine matrix→text response (B),
robot/voice→deterministic clinic brain (C), voice→WAITING_APPROVAL with
binding+expiry (D), engine-dependency failure→typed degraded response (E).
No duplicated context authority: the robot renders agent state; the agent
owns context.

## 45. Docker

Audited: multi-stage node:20-alpine, non-root `nextjs` user, standalone
output, HEALTHCHECK on `/api/health`, no secrets baked (env at runtime),
explicit volumes (mysql-data, uploads), explicit network. **Kept as-is**
(§52: do not blindly rewrite). The two fixes that make builds reproducible
(font vendoring §52-note; resvg devDependency) reduce image-build fragility
without touching the Dockerfile.

## 46. Network

Expected topology: `app` (only published service) → mysql (internal) →
uploads volume; redis profile optional and unpublished; no other ports
exposed in compose. CORS allowlist available for reverse-proxy fronting
(Caddy compose variant exists). Documentation-only change — compose files
untouched.

## 47. Secrets

`.gitignore` covers `.env`, `.env.*` (only `.env.example` /
`.env.production.example` placeholders are tracked — verified no real
values). The environment contract (§5) classifies secrets and forbids
dev fallbacks in production. Secret scan (pattern-based: AWS keys, sk- keys,
private key blocks, GitHub tokens): **clean**. Deploy output names variables
never values (tested).

## 48. Deployment

`scripts/deploy.sh` — 8 fail-safe stages: preflight (env contract via tsx,
exit 1 on any problem) → backup checkpoint (calls `scripts/backup.sh`;
refuses production deploys without a running mysql to back up unless
explicitly skipped with a loud warning) → `prisma migrate deploy` (never
reset/dev) → `docker compose up -d app` → health poll (30×2 s) → readiness
poll → `scripts/smoke.sh` → release confirmation (version+revision). Any
stage failure stops the deployment safely (set -eu).

## 49. Migrations

No new migrations (no schema changes). Safety rules validated in the deploy
script: `migrate deploy` only; backup precedes migration; destructive
commands absent (grep-verified: no `migrate reset` in any deploy path).

## 50. Versioning

ONE source: `package.json` (`1.0.0`) via `lib/config/version.ts`; `GIT_SHA`
optionally injected at deploy; exposed on `/api/health`, `/api/ready`, and
every structured-log line; `versionStamp()` for diagnostics. No second
versioning system created.

## 51. Smoke Tests

`scripts/smoke.sh`: unauthenticated subset always (health ok+version, ready
db-gate, login page 200, agent API 401, voice API 401 — proves the auth
gates alive and nothing leaks); authenticated subset with `SMOKE_EMAIL/
SMOKE_PASSWORD` (NextAuth CSRF dance → patient-scoped read, accepting
200-or-role-correct-403). Synthetic accounts only. Component-level smoke
tests also exist (`tests/smoke/`) and remain green.

## 52. Failure Injection

`tests/integration/phase11-failure-injection.test.ts` — 14 scenarios:
database unavailable (typed `VOICE_DEPENDENCY_ERROR`, session recoverable,
no fake answer), agent crash (typed error, null agentStatus), storage driver
misconfiguration (named construction failures), unwritable storage root
(throw, no silent loss), storage root missing (documented: driver mkdirs
its own root — correct behavior), STT engine binary missing (typed error,
no fabricated transcript), TTS unavailable (text remains), missing secret
(preflight throw), duplicate sensitive job (agent invoked once),
cross-tenant fingerprint non-collision, expired approval binding (inert),
storage-key tenant/traversal denials. **Found & fixed:** the pipeline
boundary throw (§15).

## 53. Recovery

Per failure class: database — detected by the pipeline boundary; behavior
typed error + Arabic honest message; data safety none affected (read-only
path); recovery automatic on next turn (ERROR→UNDERSTANDING); verification
test green; residual risk: user-visible error during DB blips (accepted).
Storage — detected at driver; behavior typed throw; no partial writes
(put is atomic per object); recovery: fix permissions/driver config;
residual: none identified. Engine binary — detected at spawn; text path
unaffected; recovery: install engine; residual: none. Secret — detected at
preflight; deployment aborts; recovery: provision secret; residual: none.
Timeouts — bounded at classes (§14); recovery: retry per §13 policy.
**No recovery is claimed beyond what these tests exercise.**

## 54. Backup/Restore

`scripts/backup.sh` (mysqldump + uploads volume, timestamped, pre-flight
checks) and `scripts/restore.sh` exist and are audited — **BLOCKED from
execution in this sandbox** (no Docker daemon). Contract documented: trigger
(pre-deploy + scheduled), artifact (sql.gz + uploads tar), retention
(operator policy; compose keeps local timestamps), encryption (operator
must enable at rest — flagged, not implemented), verification (restore
exercise REQUIRED before production — SELF_HOSTING guidance), RPO/RTO:
operator-defined; the deploy script enforces "no migration without a fresh
backup" as the application-side contract. §73: backup-ready is NOT claimed.

## 55. Performance

SANDBOX-labeled (`ai-validation/phase11/benchmarks-sandbox.json`; label
enforced by test): api_health_handler 0.07 ms median / 0.30 p95;
voice_e2e_patient_review (real pipeline+agent, replay boundary) 0.96/2.58;
agent_request_replay 0.42/3.75; clinic_brain_metrics 0.06/0.26.
Phase 10 voice hot-path records unchanged and still green. Frontend build
sizes: **not reported** — build completion blocked by the prisma-stub
type-check (§69); bundle analysis deferred to the target machine. No
target-machine claims anywhere.

## 56. Resource Limits

Enforced (existing + validated): upload 10 MB; audio 10 MB/30 s; transcripts
600 chars; speakable 800 chars; agent plan ≤8 steps / ≤8 tools / 20 s; voice
sessions 15 min TTL; confirm window 30 s; duplicate window 8 s; workflow
step budgets (Phase 9); rate limits 60/min on AI surfaces. Documented:
queue depth N/A (no external queue); concurrency bounded by the Node
process + MySQL pool.

## 57. Evaluation

`tests/evaluation/integration-scenarios.test.ts` — Scenarios A–E (§44) with
a deterministic replay ledger: same input ⇒ same status/taskType; D always
PENDING_APPROVAL; E always the typed NO_AGENT failure. All six tests green.

## 58. Adversarial Testing

`tests/integration/phase11-adversarial-cross-layer.test.ts` — 13 cross-layer
attacks, all fail closed: voice→tool injection (unauthorized role; skip-
approval demand), voice→patient spoof, robot→approval (non-approver 403;
cross-tenant 404), storage→traversal (3 hostile shapes), memory→trust
escalation (validator rejects; class ceilings), document→agent policy
(injection stays data), session→user confusion (cross-user/cross-tenant/
cross-store), workflow→privilege escalation, local AI→forged artifact
(non-JSON engine output rejected). Plus the 14 Phase 10 voice adversarial
cases still green.

## 59. Replay

Integrated scenarios run through the Phase 7 replay boundary (REAL agent +
deterministic services) — fully replayable without hidden chain-of-thought;
the ledger assertion enforces stability within the run, and the golden
datasets remain committed for byte-stable replays.

## 60. Test Results

| suite | pre-P11 | new | post-P11 |
|---|---|---|---|
| full vitest | 5,969 passed / 12 skipped / 0 failed | **+67** (5 new files + extensions) | **6,036 passed / 12 skipped / 0 failed** (324 files) |
| phase11 failure injection | — | 14 | green |
| phase11 adversarial cross-layer | — | 13 | green |
| integration scenarios A–E | — | 6 | green |
| integration perf | — | 5 | green |
| config-env + platform contracts | — | 30 | green |
| Phase 7 eval gates (regression) | 4/4 | — | 4/4 |
| voice gates (regression) | 14/14 + 4 | — | green |

No unrelated regression. Baseline numbers are from the actual pre-phase run
(`git stash`-free: measured at 8bd8d87 and after; never fabricated).

## 61. Security Scan Results

- `npm audit`: **19 → 12 findings** after the non-breaking fix (next 16.3.8
  closes 4 critical RCEs: GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4,
  GHSA-vcvr-r3jv-pc5j + inherited postcss/sharp). Remaining 12 require
  MAJOR upgrades (vitest 2→5, next-auth/@auth majors, nodemailer 10, uuid 11,
  esbuild via vite) — deferred with rationale (§62). Tool: npm 11.x audit
  (registry live).
- Secret scan: pattern-based (AWS/OpenAI/GitHub tokens, private keys) over
  tracked text files: **0 findings**. Tooling note: gitleaks/trivy not
  installed in the sandbox; container image scan NOT executed (no Docker
  daemon) — **not claimed**.

## 62. Dependency Audit

- **Upgraded (security, same-major):** `next` 16.2.12→16.3.8; transitive
  refresh via `npm audit fix`. Verified: full suite green + tsc parity 502
  (one FEWER than baseline: resvg resolved).
- **Added:** `@fontsource/inter@5.3.0` (OFL; font vendored to `app/fonts/`),
  `@resvg/resvg-js` (dev; fixes pre-existing TS2307 in `tools/render-arch.tsx`).
- **Flagged, deferred (breaking):** vitest 2→5 (+coverage/ui), next-auth v4
  major-track bumps (adjacent to protected auth work), nodemailer 10, uuid 11,
  esbuild (dev-only vite dependency), sharp advisory inherited from next
  (resolved with next). NEXT ACTION: a dedicated dependency-modernization
  track with its own regression window — deliberately NOT mixed into this
  phase (§71: avoid destabilization).

## 63. Production Readiness Matrix

| Area | Status | Evidence | Blocker | Next Action |
|---|---|---|---|---|
| Application | PARTIAL | 6,036 tests green; tsc parity | build type-check needs real prisma client | run `prisma generate` on target machine |
| Database | VERIFIED (contract) | migrate-deploy path; tenant scope tests | sandbox cannot run MySQL | exercise migrations + smoke on target |
| Redis | UNAVAILABLE (by design) | no consumer; ready reports honestly | n/a | introduce only with §8 rules |
| Storage | PARTIAL | driver/tenant tests green | S3 untested live (no MinIO here) | MinIO round-trip on target |
| AI | PARTIAL | capability matrix honest; local STT/TTS evidence (Phase 10) | Arabic models blocked (hosts) | validate on networked machine |
| Voice | VERIFIED (sandbox) | Phase 10 gates + Phase 11 fail-safe | session store single-node | Phase 12+ durable store if multi-node |
| Robot | VERIFIED (component) | component tests; presentation-only | none | — |
| Security | PARTIAL | adversarial suites green; headers/CORS hardened; scan clean | login rate-limit gap; 12 audit majors | auth wrapper + dep track |
| Observability | VERIFIED (sandbox) | trace/log/correlation/bench | no external collector configured | wire collector on target |
| Backup | BLOCKED | scripts exist and are audited | no Docker daemon here | execute + verify restore on target |
| Recovery | PARTIAL | failure-injection evidence | live restore not run here | §54 procedure on target |
| Performance | PARTIAL | SANDBOX-labeled bench | no target-machine numbers | re-run (label flips) |
| Deployment | PARTIAL | deploy.sh + smoke.sh ready | not executed end-to-end here | run on target |

## 64. Known Limitations

1. `npm run build` compiles successfully but its type-check stage fails on
   the pre-existing 503→502 error baseline — ALL of it downstream of the
   sandbox's inability to download the prisma engine (verified: TLS to
   binaries.prisma.sh refused; `--no-engine` also blocked). On a networked
   machine the generated client types resolve these (most are stub-type
   errors and prisma-inferred generics).
2. Backup/restore and Docker flows could not be EXECUTED (no daemon).
3. Login rate limiting not implemented (protected-file adjacency).
4. 12 dependency findings require major upgrades (deferred deliberately).
5. Voice session store remains single-node (documented Phase 10 decision).
6. Arabic local STT/TTS models remain blocked (network hosts).

## 65. Blockers

| blocker | proof | closes with |
|---|---|---|
| prisma engine download TLS-refused | `npx prisma generate` + `--no-engine` + raw HTTPS probe all fail (this sandbox) | target machine: `npm install && npx prisma generate && npm run build` |
| Docker daemon absent | no `docker` socket in sandbox | target: `./scripts/deploy.sh` |
| fonts.googleapis.com unreachable | direct fetch probe fails | FIXED (self-hosted Inter) |
| binaries for Arabic AI models | huggingface/alphacephei unreachable | FIXED path: command boundary; validate on networked machine |

## 66. Phase 12 Interfaces

Exposed (documented only — no Phase 12 implementation): clinical validation
dataset slot (`tests/evaluation/golden/*` + harness extend by dataset);
clinician review workflow (approvals ledger + `CLASS_TO_ROLES.
DOCTOR_CONFIRMED` trust path — human confirmation is already a first-class
write class); clinical accuracy evaluation (Phase 7 gate pattern + capability
matrix per-task statuses ready for accuracy columns); calibration
(`uncertainty[]` + 5-band labeling already machine-readable); safety
validation (adversarial suites as the regression corpus); human factors
(voice adversarial + robot a11y tests); clinical governance (audit trail +
correlation ids + PHI-minimized telemetry); certification evidence
(EVIDENCE.json pattern + environment-labeled benches + this report chain).

## 67. Git Verification

- Pre-phase: HEAD `8bd8d87` == origin; tree clean.
- Post-phase: ONE focused commit `feat(ai): harden full integration and
  deployment`; pushed to `arena/01a0f3e0-dental-clinic-system`;
  `git rev-parse HEAD` == `git ls-remote` HEAD; working tree clean.
- Protected WIP files: **zero diff** vs `8bd8d87` (verified pre-commit).
- Forbidden commands unused: no `reset --hard`, no `clean -fd`, no `push --force`.

## 68. Final Gate

**🟢 SANDBOX GREEN (with explicit blockers).** Everything runnable in this
environment was run and passes: 6,036 tests, tsc parity (502 ≤ baseline,
0 new), lint 0 errors, audit hardened, secret scan clean, failure injection
and cross-layer adversarial all fail-closed, deploy/smoke tooling syntax- and
preflight-verified. **Not claimed:** production-readiness, build-green
(blocked on prisma engine download — exact command documented), backup
execution, target-machine performance. Phase 12 remains **not started**.

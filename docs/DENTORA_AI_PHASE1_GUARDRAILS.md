# DenToRa — Phase 1: AI Guardrails & Action Safety

**Date:** 2026-09-29 · **Branch:** `arena/01a0ce7a-dental-clinic-system` · **Base:** `9a08f31`
**Predecessor:** Phase 0 audit (`docs/DENTORA_AI_PHASE0_AUDIT.md`)

---

## 1. Phase summary

Phase 0 established that the AI assistant could make the **LLM's output the
authority** over real operations: a natural-language request could record
payments or create treatments with no approval gate, no durable record, and no
independent server-side authorization (findings R1, R5).

This phase makes the following invariant hold for **every** AI-driven action:

> **No AI-generated intent executes a sensitive operation unless the server
> independently authorizes it.** The LLM output, the client, the prompt, and
> the skill layer are *inputs to be validated* — never the authority.

What was built:

- a **central Action Policy Registry** classifying every parser intent
  (30 intents + 1 alias = 31 resolvable names; `general` is handled outside
  the pipeline by construction);
- a **12-stage server-side pipeline** (`runAiAction`) that every AI action
  must pass: policy → RBAC → validation → patient scope → financial guardrail
  → fingerprint → approval gate → idempotency → transactional execution →
  verification → audit;
- a **durable approval ledger** (one new table `AIActionApproval`) that
  doubles as the execution/idempotency ledger, with atomic state transitions;
- **wired financial guardrails**: `ai_financial_approval_limit` and
  `ai_monthly_budget` (dead settings in Phase 0, now the authority for
  auto-executing payments);
- an **approvals API + dashboard** (`/api/ai/approvals`, `/ai-approvals`);
- 64 new tests (44 unit + 20 E2E through the real routes), including the
  spec'd scenarios A–H and an adversarial injection suite.

**Out of scope (unchanged):** Agent Loop, RAG, dental KB, local LLM,
multimodal chat, new engines, voice agent, robot UI, memory architecture.
Nothing outside the AI action path was altered (see §22 for the exact file
manifest).

---

## 2. Verdict & gate checklist

### 🟢 PASS

| # | Gate | Result |
|---|------|--------|
| 1 | Every parser intent classified in the registry (no unclassified action reachable) | ✅ verified programmatically: 31/31 intents covered, 0 missing, 0 registry-only gaps (besides the `general` non-action) |
| 2 | LLM/client/prompt/skill never the authority for a sensitive action | ✅ executor reachable only via `dispatchExecutor` inside the pipeline (grepped: 4 call sites, all gated) |
| 3 | Fail closed on every safety-critical failure | ✅ §12 matrix; `LEDGER_UNAVAILABLE` blocks all sensitive actions when the delegate is absent |
| 4 | Patient IDs from model/client untrusted — server re-resolves | ✅ `resolvePatientForAction` (tenant-scoped); injected `patientId` param has no authority (E2E H3) |
| 5 | Approval binds exact validated params (tenant+actor+action+params+policyVersion via fingerprint) | ✅ sha256 fingerprint; tamper → `FINGERPRINT_MISMATCH` (E2E E1) |
| 6 | Modified/expired/rejected/cancelled/cross-tenant/self approvals cannot execute | ✅ E2E E1, F, G (5 tests) |
| 7 | Financial settings wired with fail-closed semantics | ✅ missing limit → approval; over limit/budget → approval; within both → auto-execute (audited+verified) |
| 8 | Multi-write executors transactional | ✅ `transactionRequired` policies run inside `prisma.$transaction` |
| 9 | Retries cannot double-execute | ✅ fingerprint idempotency window (10 min), unit + E2E |
| 10 | Per-action AuditLog without secrets/PHI/raw prompts | ✅ redacted JSON; E2E C1 asserts no patient name in audit rows |
| 11 | Verification = authoritative read-back | ✅ tenant-scoped read-backs; wrong amount → not verified |
| 12 | Clinical output status semantics preserved (prescriptions DRAFT) | ✅ verified on read-back (`rx.status === 'DRAFT'` required) |
| 13 | Minimal prompt/context changes; prompts are NOT a security boundary | ✅ prompt edits only describe the new approval flow to the model |
| 14 | Reusable test harness | ✅ faithful in-memory ledger mock reused across unit + E2E suites |
| 15 | E2E scenarios A–H through real routes | ✅ §17 |
| 16 | Migration additive only, no reset | ✅ §15 |
| 17 | Full regression green | ✅ 5178 passed / 12 skipped / 0 failed (baseline 5114 + 64 new) |
| 18 | Typecheck unchanged | ✅ tsc exactly 503 (identical to baseline) |
| 19 | Lint: 0 errors | ✅ 0 errors (261 pre-existing warnings; 1 new warning is the codebase's ubiquitous `react-hooks/set-state-in-effect` pattern, 96 pre-existing instances) |
| 20 | Build | ⚪ environment-blocked (Google Fonts fetch blocked in sandbox — same as Phase 20B; no build-affecting changes beyond type-checked TS) |
| 21 | Performance measured before/after | ✅ §19 — no material regression |
| 22 | Attacker audit, any YES → BLOCKED | ✅ §20 — all security-critical answers NO; 2 documented residuals |

---

## 3. Threat model recap (Phase 0 → this phase)

| Phase 0 finding | Status now |
|---|---|
| R1 — NL could execute payments/treatments with no approval | Closed: policy registry + approval ledger + atomic state machine. Payments auto-execute **only** within the operator-configured limit & monthly budget; everything else waits for an ADMIN (never the requester). |
| R5 — dead guardrail settings (false compliance) | Closed: `ai_financial_approval_limit` + `ai_monthly_budget` are read by the pipeline (stage 6) and missing settings fail closed (approval required). |
| R2 — PHI to cloud LLM | **Not addressed this phase** (out of scope; requires local-LLM mode — future phase). Mitigated indirectly: the command route's context is unchanged, and no *new* data path was introduced. |
| R3 — assistant blind to teeth/imaging | Not addressed (out of scope). |
| R4 — no runtime AI-output marking | Not addressed (out of scope); audit rows now tag AI actions (`AI_<ACTION>`, entityType `AIAction`) which is a prerequisite for it. |

---

## 4. Architecture: the 12-stage pipeline

`lib/ai/action-pipeline.ts` → `runAiAction()` is the single entry point for
AI-driven actions (used by `/api/ai/command` and `/api/ai/chat`).

```
 1 resolvePolicy      unknown intent → BLOCKED (UNKNOWN_ACTION)
 2 RBAC               server-side; LLM's self-reported role ignored
 3 validate           per-action validator (real enums, numeric ranges)
 4 ledger availability   sensitive actions fail closed without the delegate
 5 patient scope      tenant re-resolution (name or invoice-referenced)
 6 financial pre-read  amount known BEFORE mutation; guardrail settings read
 7 fingerprint        sha256(hospitalId|action|patientId|policyVersion|canonical params)
 8 approval gate      durable PENDING row; needsApproval → stop (APPROVAL_REQUIRED)
 9 idempotency        same validated request in 10-min window → DUPLICATE
10 execute            dispatchExecutor (only executor call site); $transaction
                      when policy.transactionRequired
11 verify             authoritative tenant-scoped read-back
12 audit + complete   AuditLog row; atomic PENDING|APPROVED → EXECUTED
```

Key properties:

- **READ actions skip the ledger entirely** (zero DB writes per read — no
  ledger row, no audit row, no idempotency lookup). Only `sensitive`
  (`riskLevel !== 'READ'`) actions pay the safety cost.
- The pipeline is the **only** path to the executors: `dispatchExecutor` has
  exactly 4 call sites, all inside `runAiAction`/`approveAndExecute`, all
  after the gates.
- `approveAndExecute()` (approvals API) re-reads the **stored** validated
  params — the client has no parameter channel at execute time — recomputes
  the fingerprint (tamper detection), re-authorizes the **original requester's
  current role**, re-checks idempotency, then executes/verifies/audits exactly
  like the auto path.

---

## 5. Action Policy Registry (`lib/ai/action-policy.ts`)

`POLICY_VERSION = 1` (bumped on any policy change → old approvals cannot
execute under a new policy: different fingerprint).

Every entry carries: `riskLevel`, `roles` (RBAC), `approvalRequired` (floor),
`approvalRoles`, `patientScope`, `transactionRequired`, `idempotencyRequired`,
`auditRequired`, and a `validate()` using real schema enums.

| Risk level | Intents |
|---|---|
| 🟢 READ (14) | `search_patients`, `check_patient`, `show_appointments`, `show_treatments`, `show_invoices`, `check_overdue`, `show_revenue`, `check_stock`, `low_stock`, `show_lab_orders`, `show_prescriptions`, `search_medications`, `show_staff`, `daily_summary` |
| 🔴 WRITE (9) | `create_patient`, `update_patient`, `book_appointment`, `cancel_appointment`, `reschedule_appointment`, `complete_appointment`, `add_inventory_item`, `update_stock`, `add_medication` |
| 🟠 CLINICAL_WRITE (4) | `create_treatment`, `complete_treatment`, `create_prescription` (+ doctor-gated sets) |
| 🟡 FINANCIAL (2) | `record_payment` (guardrail-decided approval), `create_invoice` (always approval) |
| ⛔ EXTERNAL (1) | external-classified action — approval-gated like other non-READs |

Rules enforced by tests (`tests/unit/ai-action-policy.test.ts`):

- **no action allows the PATIENT role** (portal accounts can drive zero
  actions — closes the portal-user hole);
- every READ is available to all staff roles (`SUPER_ADMIN, ADMIN, DOCTOR,
  RECEPTIONIST, LAB_TECH, ACCOUNTANT`);
- financial actions restricted to ACCOUNTANT/ADMIN with ADMIN-only approval;
- clinical writes doctor-gated; inventory mutations admin-only;
- validators reject malformed enums/numbers (`25:99` times, `2026-13-99`
  dates, negative amounts, unknown payment methods …).

`generate_invoice` is an alias of `create_invoice` (legacy parser name).

---

## 6. Approval ledger & state machine (`lib/ai/approvals.ts`)

One table `AIActionApproval` serves as both the **approval record** and the
**execution/idempotency ledger** for auto-executed sensitive actions.

```
                 approve (approver ≠ requester, role-gated)
 PENDING ────────────────────────────────► APPROVED ──────────┐
   │  │  │  │                                                execute │
   │  │  │  └─ lazy expiry (expiresAt) ──► EXPIRED                ▼
   │  │  └─ reject ──► REJECTED                              EXECUTED (terminal)
   │  └─ cancel (requester) ──► CANCELLED
   └─ block (duplicate/unknown executor) ──► BLOCKED
```

Integrity rules (all enforced by code + tests):

- every transition is an **atomic `updateMany` with the expected current
  status in the WHERE clause** — duplicate approvals, replays and state races
  are structurally impossible (the loser gets count=0 → fail closed);
- **self-approval is rejected** (`SELF_APPROVAL`);
- the approver role must be in `policy.approvalRoles` (checked by the route
  and re-checked by `approveAndExecute`);
- **fingerprint binding**: `sha256(hospitalId|action|patientId|policyVersion|
  canonical-params)` (keys sorted, string values) — modified params, a new
  policy version, or another tenant produce a different fingerprint;
- **lazy expiry** (24 h TTL default): any read of a stale PENDING row
  atomically expires it; expired rows can never execute;
- `markExecuted` accepts only `PENDING|APPROVED → EXECUTED` — losing that race
  = `STATE_RACE`, fail closed;
- `monthFinancialTotal()` sums EXECUTED financial amounts this calendar month
  for the budget check.

**Delegate adapter (fail closed):** the generated Prisma client exposes the
delegate as `aIActionApproval`. Environments where the client has not been
regenerated for the Phase 1 migration lack the delegate → `ledgerAvailable()`
is false → **every sensitive action is BLOCKED** (`LEDGER_UNAVAILABLE`) while
READ actions continue to work. No sensitive path ever touches a missing table
silently.

---

## 7. Financial guardrails (the dead settings, now wired)

Stage 6 of the pipeline, for `riskLevel === 'FINANCIAL'`:

1. **Pre-read the amount** before anything mutates (`resolveFinancialAmount`):
   - `record_payment`: explicit `amount` or the invoice's `balanceAmount`,
     from the tenant-scoped invoice (unresolvable invoice →
     `FINANCIAL_PREP_FAILED`, no approval, no execution);
   - `create_invoice`: sum of the patient's unbilled completed treatments +
     14% VAT (informational snapshot — see §20 residual R-1).
2. **Read settings** `ai_financial_approval_limit` / `ai_monthly_budget`
   (per hospital).
3. **Decision** — `needsApproval = policy.approvalRequired || overLimit ||
   overBudget` where:
   - `overLimit = (limit setting missing) || amount > limit` → **missing
     setting fails closed**;
   - `overBudget = budget !== null && (monthSpent + amount) > budget`.

Semantics (documented decision): **within both limits → auto-execute**
(audited + verified + ledger row for idempotency/budget accounting); **over
either, or settings missing → durable approval** decided by an ADMIN other
than the requester. `create_invoice` is `approvalRequired: true` (a new
billing obligation always needs a human); `record_payment`'s approval is
decided by the guardrails (which is precisely what these settings are for).

Both settings now have real consumers (Phase 0: zero). The settings UI
(`settings/ai`) links to the approvals dashboard.

---

## 8. Idempotency & replay

- Fingerprint (tenant + action + patient + policy version + canonical
  validated params) is the identity of a request.
- `findDuplicateRequest` blocks when a **recent** (10-min window) row with the
  same fingerprint is `EXECUTED` (success) or a fresh (≤5 min) `PENDING`
  (in-flight). The current request's own row is **excluded** (`NOT: { id }`)
  — a bug caught by the faithful test mock (without the exclusion every
  sensitive action would self-match the PENDING row it just created).
- Consequences: an LLM retry of "record payment 1000 on INV-00001" cannot
  double-pay; a modified amount is a *different* request (new approval);
  another tenant's identical request has a different fingerprint (no
  cross-tenant replay).
- Residual: two requests with identical fingerprints landing in the same
  instant are both admitted (DB-level race). Mitigated by the executors'
  natural state checks (e.g. the invoice balance re-check rejects the second
  overpayment) and documented.

---

## 9. Transactions

Policies with `transactionRequired: true` (currently both FINANCIAL actions)
execute their whole multi-write sequence inside one
`prisma.$transaction(async (tx) => dispatchExecutor(action, params,
hospitalId, tx))`. The 16 mutating executors accept a `client` parameter
(default `prisma`) so the transactional client is used for **all** of their
writes; read-only executors and shared helpers keep using the plain client.

---

## 10. Verification (read-back)

After execution, sensitive actions read the **authoritative state back**
(`verifyAction`) and the result carries `verification: { verified, detail }`:

| Action | Read-back | Pass condition |
|---|---|---|
| `record_payment` | `payment.findFirst({ paymentNo, hospitalId })` | tenant-owned, `COMPLETED`, amount matches |
| `create_invoice` | `invoice.findUnique({ hospitalId, invoiceNo })` | tenant-owned, `PENDING` |
| `book_appointment` | `appointment.findUnique({ hospitalId, appointmentNo })` | tenant-owned, `SCHEDULED` |
| `create_patient` | `patient.findUnique({ hospitalId, patientId })` | tenant-owned |
| `create_treatment` | `treatment.findUnique({ hospitalId, treatmentNo })` | tenant-owned, `IN_PROGRESS` |
| `create_prescription` | `prescription.findUnique({ hospitalId, prescriptionNo })` | tenant-owned, **`DRAFT`** (AI output is never authoritative clinical state) |
| `update_stock` | `inventoryItem.findFirst({ hospitalId, name contains })` | new stock matches |
| `create_lab_order` | `labOrder.findUnique({ hospitalId, orderNumber })` | tenant-owned, `CREATED` |

Two real production bugs were caught by the faithful mocks and fixed this
phase:

1. **Operator-precedence bug** in the payment verification
   (`A && B && C || D && E` — tenant/status checks bypassable when an amount
   was present) — now parenthesized correctly.
2. **Broken read-backs**: the code used `findUnique({ where: { paymentNo } })`
   etc., but `paymentNo` has **no unique constraint** in the schema and the
   other reference numbers are *tenant-composite* unique — every read-back
   would have thrown a Prisma validation error in production. All seven
   read-backs are now tenant-scoped (`findFirst` for payment, composite
   `findUnique` for the rest).

---

## 11. Audit

One `AuditLog` row per sensitive action (not per read): `action =
AI_<ACTION>`, `entityType = 'AIAction'`, `entityId = ledgerId`, plus
redacted JSON: `policyVersion`, `riskLevel`, `role`, `fingerprint`,
`approvalRequired` (old) and `status`, `verified`, `amount` (new).

Never stored: patient free-text (names), phone numbers, addresses, raw
prompts, model outputs, tokens/secrets. E2E C1 asserts the audit payload
contains no patient name. The `requestReason` ledger field stores the parser's
one-line summary (bounded, not a prompt).

Status values written: `PENDING_APPROVAL`, `BLOCKED_DUPLICATE`,
`EXECUTION_ERROR`, `EXECUTED`, `EXECUTED_BUSINESS_FAILED`,
`EXECUTED_AFTER_APPROVAL`.

---

## 12. Fail-closed matrix

| Failure | Sensitive actions | Reads |
|---|---|---|
| Unknown intent | BLOCKED `UNKNOWN_ACTION` (command route → conversational fallback) | n/a |
| Role not allowed | BLOCKED `RBAC_DENIED` (before ledger/DB writes) | BLOCKED |
| Malformed params | BLOCKED `INVALID_PARAMS` (validator) | BLOCKED |
| Ledger delegate missing (migration not applied / client stale) | BLOCKED `LEDGER_UNAVAILABLE` | EXECUTED (reads need no ledger) |
| Patient unresolvable | BLOCKED `PATIENT_NOT_FOUND` | n/a |
| Financial amount unresolvable | BLOCKED `FINANCIAL_PREP_FAILED` | n/a |
| Settings missing | approval required (never auto-execute) | n/a |
| Duplicate in window | BLOCKED `DUPLICATE`, row marked | n/a |
| Executor throws | row keeps error, `EXECUTION_ERROR` (approvable retry) | BLOCKED `EXECUTION_ERROR` |
| Read-back fails/mismatches | executed state = EXECUTED with `verification.verified=false` surfaced to UI; retry path remains | n/a |
| Lost atomic transition | `STATE_RACE`, no double execution | n/a |
| Expired / rejected / cancelled / executed row acted on | 409, no execution | n/a |
| Cross-tenant action attempt | 404 (no existence leak) | n/a |
| Fingerprint mismatch (stored tamper) | 409 `FINGERPRINT_MISMATCH` | n/a |

---

## 13. API changes

**`POST /api/ai/command`** — same contract, hardened:

- every non-`general` intent now goes through `runAiAction`;
- response adds server-computed `status`
  (`EXECUTED | APPROVAL_REQUIRED | BLOCKED | ERROR`) and `requiresApproval`
  (the LLM's self-reported `requiresApproval` is **ignored** — the policy
  registry decides);
- `result` keeps its historical shape (`summary`, `items`, `invoices`,
  `message`, `success` at top level — the command bar renders these) with the
  pipeline's security metadata alongside: `status`, `approvalId`,
  `verification`.

**`GET /api/ai/approvals`** — tenant-scoped list (pending + recent decided)
with client affordances (`canApprove/canReject/canCancel/canExecute`,
`approvalRoles`). 503 if the ledger is unavailable (no partial data).

**`POST /api/ai/approvals/[id]`** — `{ decision: approve|reject|cancel|execute,
note? }`. **No parameter channel exists** — execution always uses the stored
validated params. Error mapping: 403 role/self-approval, 404 not found
(including cross-tenant), 409 state conflicts (not pending, already executed,
expired, race, fingerprint, duplicate), 502 execution error. All messages are
dictionary keys (i18n).

---

## 14. UI changes

- **`/ai-approvals`** (dashboard): pending requests (action, params, amount,
  requester, patient, expiry) + recent decisions; approve/reject/cancel/
  execute actions calling the API; server affordances drive button
  availability; Arabic/English via the language hook.
- **`settings/ai`**: link card to the approvals dashboard.
- Command bar: the existing `requiresApproval` badge now reflects the
  **server** decision (previously the LLM's unenforced guess).

---

## 15. Database migration

`prisma/migrations/20260929120000_add_ai_action_approvals/migration.sql`

- **Additive only**: creates one table `AIActionApproval` (24 columns) +
  5 indexes + 4 foreign keys. No existing table, column, index or row is
  altered or dropped. `prisma migrate reset` was **not** used.
- FKs: `hospitalId → Hospital` (CASCADE), `requestedById → User` (CASCADE),
  `approvedById → User` (SET NULL), `patientId → Patient` (SET NULL) —
  deleting a clinic cleans its safety rows; deleting an approver/patient
  preserves audit history.
- Conventions match existing migrations (backtick MySQL style, `DATETIME(3)`,
  `utf8mb4_unicode_ci`, `_idx` naming, `updatedAt NOT NULL` without default —
  Prisma `@updatedAt`).
- Schema: `AIActionApproval` model + `AIActionStatus` enum
  (`PENDING, APPROVED, REJECTED, CANCELLED, EXPIRED, EXECUTED, BLOCKED`) + 3
  relations on `Hospital`, `User` (×2 named relations), `Patient`.
- **Rollback** (if ever needed): `DROP TABLE \`AIActionApproval\`;` (the enum
  lives inside the table in MySQL).
- **Deploy**: `prisma migrate deploy` on the operator's machine (the sandbox
  cannot reach binaries.prisma.sh, see §21), then `prisma generate`. Until
  then the app runs fail-closed for sensitive actions (§6).

---

## 16. i18n

+50 keys per locale (`locales/en.json`, `ar.json`): pipeline user-facing
messages (unknown action, not permitted, invalid params, patient not found,
duplicate, execution failed, pending approval, ledger unavailable), approvals
API errors, and the `aiApprovals.*` dashboard strings. The
`i18n-api-messages` suite (which pins error-literal discipline, template
count ≤ 48) passes — all new API-route messages are plain dictionary keys,
zero new templates.

---

## 17. Test suite (64 new tests, all green)

**`tests/unit/ai-action-policy.test.ts` (19)** — registry completeness, RBAC
sanity (no PATIENT anywhere), financial/clinical/inventory gating, validators
(including `25:99` time rejection), aliases.

**`tests/unit/ai-action-pipeline.test.ts` (25)** — the real pipeline + real
executors with a faithful in-memory ledger mock (supports Prisma `in:`
operators, `NOT.id`, `createdAt.gte`): fail-closed unknown action, RBAC
denials with zero DB writes, validation, financial safety (within limit
auto-executes / over limit approval / missing settings fail closed / budget
exceeded / phantom invoice), idempotency (duplicate blocked, modified params
not duplicate, cross-tenant fingerprints differ), full approval lifecycle
(approve executes stored params, role gate, reject, self-approval, expiry).

**`tests/api/ai-guardrails.test.ts` (20)** — E2E through the real routes with
the LLM mocked to controlled (including adversarial) intent output:

| Spec scenario | Test | Assertion core |
|---|---|---|
| A — safe read | `check_patient` executes | `EXECUTED`, **no ledger row, no audit row** |
| B — unauthorized write | RECEPTIONIST payment; PATIENT payment | `BLOCKED` before any ledger/DB write |
| C — approval required | 9000 > limit 5000; `create_invoice` below any limit; missing settings | durable PENDING, fingerprint = expected sha256, redacted audit, no execution |
| D — approved execution | ADMIN approves | stored amount 9000 executed once, `verification.verified`, row EXECUTED + approvedById, full audit trail; RECEPTIONIST role gate 403 |
| E — modified request | tampered stored params; legitimate amount change | `FINGERPRINT_MISMATCH` 409 no execution; new approval with new fingerprint |
| F — cross-tenant | other clinic lists/acts | not listed; 404; row untouched |
| G — replay | double approve; execute-after-executed; self-approval; reject-then-approve; expiry | 409/403 each; exactly one execution ever |
| H — injection | portal-user prompt injection (LLM obeys); LLM lies `requiresApproval:false`; injected `patientId/role/sudo` params; hallucinated destructive intent | RBAC BLOCKED; server-computed APPROVAL_REQUIRED; injected params inert (patient resolved from tenant invoice); conversational fallback, zero side effects |

**Pre-existing suite**: `tests/api/ai-routes.test.ts` (50 tests) updated to
the Phase 1 response shape where the contract intentionally changed; all
green.

---

## 18. Regression & quality gates

| Gate | Baseline (`9a08f31`) | After Phase 1 |
|---|---|---|
| `vitest run` (full) | 5114 passed / 12 skipped / 0 failed | **5178 passed / 12 skipped / 0 failed** (+64 new) |
| `tsc --noEmit` | 503 errors (pre-existing, incl. 28 TS7006 in `command-executors.ts` from the structural `lib/prisma.ts` type) | **503 — identical, zero new** |
| `npm run lint` | 0 errors, 260 warnings | **0 errors, 261 warnings** (+1: the dashboard page's data-fetch effect matches the repo's ubiquitous `react-hooks/set-state-in-effect` pattern — 96 pre-existing instances) |
| `next build` | ⚪ blocked (Google Fonts fetch blocked in sandbox; same as Phase 20B) | ⚪ unchanged |
| DB | untouched (no migrate/reset in sandbox) | untouched; migration committed, additive |

---

## 19. Performance (mocked DB, n=1000 per sample)

Measured by benchmarking the pre-Phase-1 path (direct executor call, as the
old route did) against the pipeline:

| Path | Before (µs mean / p95) | After (µs mean / p95) | Delta |
|---|---|---|---|
| READ `check_patient` | 12.0 / 3.6 | 13.8 / 9.5 | +1.8 µs mean — negligible (zero DB round-trips: reads skip the ledger) |
| WRITE auto-exec `record_payment` | 5.2 / 6.3 | 49.5 / 73.8 | +44 µs — 7 extra mocked in-memory queries (ledger create, settings, month total, duplicate check, markExecuted, audit, fingerprint) |
| APPROVAL gate (over limit) | n/a — **the old path executed the payment** | 19.5 / 21.5 | new cost of a human-in-the-loop gate |

**Assessment: no material regression.** These actions are staff-initiated and
low-frequency; the route is already dominated by the LLM round-trip
(hundreds of ms – seconds). The ~50 µs service-layer overhead per sensitive
action is three to four orders of magnitude below the latency it is protecting.

---

## 20. Attacker audit (§34)

Final adversarial review. Any **YES** on a security-critical item = BLOCKED.

| # | Question | Answer |
|---|----------|--------|
| 1 | Can an AI intent execute a sensitive operation without server authorization? | **NO** — executor reachable only via `dispatchExecutor` inside the gated pipeline (4 call sites, verified by grep) |
| 2 | Can prompt injection through the patient portal cause a sensitive action? | **NO** — PATIENT role excluded from every action; E2E H1: even an injection-obedient LLM is RBAC-blocked before any DB write |
| 3 | Can client/LLM-supplied patient or resource IDs bypass tenant scoping? | **NO** — server re-resolves (tenant-scoped); E2E H3: injected `patientId` param is inert, ledger stores the resolved patient |
| 4 | Can the LLM's `requiresApproval` claim bypass the approval gate? | **NO** — server computes it from policy + settings; E2E H2 |
| 5 | Can an approver execute different parameters than were approved? | **NO** — execution reads only stored params; fingerprint re-checked; E2E E1 (tamper → 409) |
| 6 | Can a requester approve their own request? | **NO** — `SELF_APPROVAL`; E2E G3 (403) |
| 7 | Can an approval be replayed (double-approve, re-execute, after reject)? | **NO** — atomic status-guarded transitions; E2E G1/G2/G4 |
| 8 | Can one clinic see or act on another clinic's approvals? | **NO** — tenant-scoped everywhere; cross-tenant = 404 no-leak; E2E F |
| 9 | Can a retry double-execute a financial action? | **NO** — fingerprint idempotency window; unit + E2E |
| 10 | Do missing settings or a missing ledger fail open? | **NO** — missing settings → approval; missing delegate → all sensitive actions BLOCKED |
| 11 | Can an expired approval execute? | **NO** — lazy expiry + status guards; E2E G5 |
| 12 | Can an unknown/hallucinated intent reach an executor? | **NO** — `UNKNOWN_ACTION`; command route falls back to a conversational answer only; E2E H4 |
| 13 | Can a verification mismatch pass silently? | **NO** — precedence bug fixed; tenant-scoped read-backs; mismatch → `verified: false` surfaced |
| 14 | Can concurrent approvals race to double execution? | **NO** — `updateMany` guard; loser gets `STATE_RACE` (fail closed) |
| 15 | Do audit rows leak PHI/secrets/prompts? | **NO** — redacted JSON; E2E C1 asserts absence of patient names |
| 16 | Is any prompt/context a security boundary? | **NO** — prompts only describe behavior; all enforcement is server-side |
| 17 | Are there executor call sites outside the pipeline? | **NO** — verified by grep (§4) |

**Verdict: all security-critical answers NO → not blocked.**

**Documented residuals (acceptable, bounded):**

- **R-1 — `create_invoice` executed amount vs approval snapshot.** The
  approver sees the amount computed at request time; the executor recomputes
  from live data at execution. If a new completed treatment is added between
  request and approval (window ≤ 24 h TTL), the executed invoice can exceed
  the displayed snapshot. The action itself remains human-approved,
  tenant-scoped, audited and verified; the divergence is bounded by clinic
  activity in the window. Future work: re-quote the amount at execution and
  re-confirm if it exceeds the approved snapshot.
- **R-2 — same-instant identical-fingerprint race.** Two byte-identical
  requests in the same instant can both pass the duplicate check. Mitigated
  by executor state checks (e.g. invoice balance re-check rejects the second
  overpayment) and the audit trail makes any double-execution visible.

---

## 21. Environment notes & operator steps

1. **`prisma generate` is blocked in this sandbox** (binaries.prisma.sh
   unreachable). The sandbox's generated client is therefore **stale** (no
   `aIActionApproval` delegate). By design, the app in this environment runs
   **fail-closed**: READ actions work, sensitive actions return
   `LEDGER_UNAVAILABLE` blocks. This is the intended degraded mode, not an
   error state.
2. **Operator steps to activate**: on a machine with network access —
   `npx prisma migrate deploy` then `npx prisma generate`. After that the
   generated client exposes the delegate and the full pipeline is active
   against the new table. No data migration, no seed changes.
3. `next build` remains blocked in-sandbox by the Google Fonts fetch (same as
   Phase 20B); all delivered TS is type-checked (tsc unchanged at 503).
4. The user's uncommitted auth-task files (`lib/auth.ts`, `lib/prisma.ts`,
   `tests/setup.ts`, `vitest.config.ts` + 3 auth test files) were left
   untouched and are **not** part of this phase's commit.

---

## 22. Changed files & future work

**New (Phase 1):**

| File | Purpose |
|---|---|
| `lib/ai/action-policy.ts` | policy registry (31 names), validators, RBAC, financial hooks |
| `lib/ai/approvals.ts` | ledger adapter (fail-closed), fingerprint, atomic state machine, idempotency, month total |
| `lib/ai/action-pipeline.ts` | 12-stage pipeline, `approveAndExecute`, `dispatchExecutor`, verification, redacted audit |
| `app/api/ai/approvals/route.ts` | GET tenant-scoped list + affordances |
| `app/api/ai/approvals/[id]/route.ts` | POST approve/reject/cancel/execute |
| `app/(dashboard)/ai-approvals/page.tsx` | approvals dashboard |
| `prisma/migrations/20260929120000_add_ai_action_approvals/migration.sql` | additive migration |
| `tests/unit/ai-action-policy.test.ts` | 19 registry tests |
| `tests/unit/ai-action-pipeline.test.ts` | 25 pipeline tests |
| `tests/api/ai-guardrails.test.ts` | 20 E2E scenario tests (A–H) |
| `docs/DENTORA_AI_PHASE1_GUARDRAILS.md` | this report |
| `docs/DENTORA_AI_PHASE0_AUDIT.md` | Phase 0 report (folded into this commit per workflow) |

**Modified (Phase 1):**

| File | Change |
|---|---|
| `prisma/schema.prisma` | +`AIActionStatus` enum, +`AIActionApproval` model, 3 relations |
| `lib/ai/command-executors.ts` | exported `findPatient`; 16 mutating executors accept a `client` param (transaction support); structured return fields for verification |
| `app/api/ai/command/route.ts` | pipeline-wired; server-computed `status`/`requiresApproval`; historical result shape preserved |
| `app/api/ai/chat/route.ts` | pipeline-wired; approval semantics in prompts; conversation awaited for graph link |
| `app/(dashboard)/settings/ai/page.tsx` | approvals link card |
| `locales/en.json`, `locales/ar.json` | +50 keys each |
| `tests/__mocks__/prisma.ts` | +`aIActionApproval` delegate (shared mock) |

**Future work (explicitly out of this phase):** local-LLM mode / PHI-egress
control (R2), odontogram/imaging context for the assistant (R3), runtime
AI-output marking (R4), R-1 re-quote at execution, same-instant duplicate
race hardening (R-2), read-action audit trail (if data-access logging is
desired), Agent Loop/RAG/KB per the master mandate roadmap.

---

*End of Phase 1 report.*

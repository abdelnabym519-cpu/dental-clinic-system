# DenToRa AI — Phase 8: Local Dental Engines & Canonical Memory Architecture

**Date:** 2026-09-30 · **Branch:** `arena/01a0ce7a-dental-clinic-system` · **Base:** Phase 7 `b5f157f`
**Status: 🟡 PARTIAL-GREEN (honest)** — memory architecture fully implemented, tested, adversarially
evaluated and committed; engine registry re-validated with exact, non-collapsed evidence states.
No production-readiness claim. No clinical-accuracy claim. No target-hardware claim.

---

## 1. Executive summary & honest status

Phase 8 delivered two things, each with a single canonical implementation (no second brain, no
second registry, no second evaluation architecture):

1. **Local dental engines — re-validated, honestly classified.** The engine registry
   (`lib/ai/engines/registry-metadata.ts`) is the one typed table of every dental model we can
   point to: exact SHA-256, provenance, input/output contract, resource/latency evidence,
   clinical evidence, limitations, failure modes, security constraints, license, and a
   per-engine verification status re-dated to 2026-09-30. Two engines are `AVAILABLE` with
   real-inference evidence (MeshSegNet max + man); three are `BLOCKED` with the *exact*
   unreachability blocker; the VLM / CBCT / intraoral families are honestly recorded as
   candidates **not registered** (`RESOURCE_BLOCKED` / `BLOCKED` / `UNAVAILABLE`).
2. **Canonical memory architecture.** One memory subsystem inside the existing Agent/Context
   (`lib/ai/memory/`) — no second service. Agent → Memory Orchestrator → Policy → Retrieval →
   Validation → Context Assembly → Agent. Seven trust levels (AI_DERIVED can never silently
   become CLINICALLY_VERIFIED), bounded tenant/role/patient/case-scoped retrieval, explicit
   correction/supersession with an audit trail (no invisible mutation), per-domain retention,
   and a fail-closed write policy where the LLM never self-authorizes sensitive writes.

**Why 🟡 and not 🟢:** the three `BLOCKED` engines are blocked by *artifact availability in the
validation environment* (Hugging Face / Google Drive unreachable), not by a code defect. We do not
claim them working. And there is **no target-hardware (i9-13900H / 16 GB) evidence** for anything
in this phase — every measured number is `SANDBOX`-labeled. BLOCKED was never collapsed to PASS.

**Definition-of-done outcome:** all Phase 8 gates that are measurable in this environment are
green; every unmeasurable item is reported as `NOT_MEASURED` with the exact blocker. The full
suite is green (see §27). One real bug was found *and fixed* by the new evaluation (see §17).

---

## 2. Scope and non-scope (phase boundary)

**In scope (Phase 8):** engine audit + typed registry + metadata; canonical memory architecture;
memory evaluation goldens (synthetic only); F-1 server-resolved patient authority; memory perf
metrics (env-labeled); additive DB migration; i18n for the new API surface.

**Explicitly NOT built (exposed as clean interfaces only, per the phase boundary):**
- Phase 9 — Intelligence / Graph / Agentic workflows.
- Phase 10 — Robot / Voice.
- Phase 11 — Deployment / hardening for production.
- Phase 12 — Clinical certification.

We did **not** build a second RAG, a second evaluation framework, a second agent, or a separate
"brain" service. Memory reuses the Phase 7 evaluation harness (`replayAgentCase`) and the Phase 3
agent loop; the engine registry reuses the Phase 5 runtime abstraction.

---

## 3. Method: audit → design → implement → test → adversarial → benchmark

Every engine was re-audited against its source on 2026-09-30 (the `lastVerifiedAt` in the table
is the audit date, not a blanket stamp). Memory was designed against the existing agent loop
(read-only first pass over `loop.ts`), implemented additively, unit-tested, then driven through
the **real** loop by an evaluation suite (not a mock of the loop), then adversarially probed
(poisoning, injection, cross-scope, forged provenance), then benchmarked with environment labels.
No mock stands in for a final claim; where a real artifact was unreachable, the state is
`BLOCKED` with the exact blocker, never `AVAILABLE`.

---

## 4. Engine registry — one canonical typed table (single source of truth)

`lib/ai/engines/registry-metadata.ts` exports `ENGINE_REGISTRY: readonly EngineRegistryEntry[]`
— the single typed table. It is **not** a duplicate of the Phase 5 orchestrator registry; the two
are held consistent by a contract test (`matrixConsistencyIssues()`):

- every registry `task` must exist in the capability matrix with the **same** engine;
- every capability-matrix engine with a row must exist in this table;
- every `weightSha256` must be exactly 64 hex chars;
- every entry must be `cpu` (no CUDA-required path).

The Python orchestrator (`ai/orchestrator/app/capability_matrix.py`) remains the source of truth
for runtime selection; the TS table is its contract-tested mirror for the app's typed surfaces.
Engine **names never select engines** — selection is a pure `engineForModality` lookup (the
§3 contract), so a client cannot name its way to a model.

---

## 5. Per-engine metadata (§5)

Every entry carries the full metadata record the mandate requires:

| Field | Purpose |
|---|---|
| `weightSha256` / `weightSizeBytes` / `weightVersion` | artifact identity; mismatch = different model |
| `weightSource` / `artifactProvenance` | where the weights come from, with a committed provenance doc |
| `inputContract` / `outputContract` | exact tensor / mesh / image in, typed finding out |
| `resourceRequirements` | CPU-only flag, RAM note, target vs sandbox |
| `latencyEvidence` / `memoryEvidence` | measured with an **env label** or `NOT_MEASURED` + ref |
| `clinicalEvidence` | available? + reference (always `false` here — none published) |
| `limitations` | what the model does *not* do (no severity, no diagnosis, jaw fixed, …) |
| `failureModes` | `STANDIN_REJECTED`, `PROVENANCE_MISMATCH`, `MODALITY_MISMATCH`, `TIMEOUT`, … |
| `securityConstraints` | registry-pinned path, checksum=identity, stand-in refusal, bounded loader |
| `licenseMetadata` | license + commercialUse flag (CC-BY-NC, Apache-2.0, AGPL loader boundary) |
| `verificationStatus` / `lastVerifiedAt` | the honest state string + audit date |

---

## 6. The eight evidence states (never collapsed)

We keep the full separation the mandate demands — each is a distinct, non-derivable fact:

**capability ≠ model ≠ weights ≠ inference ≠ CPU inference ≠ runtime-verified ≠
real-inference-verified ≠ target-hardware-verified.**

Plus the availability/result vocabulary: `AVAILABLE`, `PARTIAL`, `RESOURCE_BLOCKED`,
`BLOCKED`, `UNAVAILABLE`, `NOT_MEASURED`. A number is never reported without its environment
label, and a `BLOCKED`/`UNAVAILABLE` is never collapsed into `PASS`. In the registry, the
per-engine `status` block exposes the fine-grained booleans (`discovered`, `artifactVerified`,
`runtimeVerified`, `realInferenceVerified`, `targetHardwareVerified`,
`clinicalEvidenceAvailable`) *and* the single `availability` roll-up — so a reader can always
see *which* step stopped, not just that it stopped.

---

## 7. Artifact security (§7)

- **SHA-256 = identity.** `checksum = identity; mismatch = different model` — a mismatch fails
  closed (`PROVENANCE_MISMATCH`); we never "close enough" a weight.
- **No arbitrary code execution.** Model paths are registry-pinned (never scanned from disk);
  the orthodontic `torch.load` uses `weights_only` + a bounded safe-globals allow-list with the
  diagnostics committed; the implant loader pins the ultralytics version.
- **Stand-in refusal.** The health gate rejects synthetic/placeholder artifacts
  (`STANDIN_REJECTED`) — a fake ONNX cannot pass as Liodon.
- **Restricted loaders as a recorded boundary.** The AGPL loader for the implant model is a
  license boundary that is explicitly documented, not hidden.

---

## 8. Engine families — honest availability table (2026-09-30)

| engineId | Family | Availability | Real inference? | Exact blocker / note |
|---|---|---|---|---|
| `liodon` | PANORAMIC | `BLOCKED` | No | `best.onnx` (SHA `4cee38b5…`, 10.6 MB) publishes **only on Hugging Face** — unreachable from the validation env. Operator-verified path exists (`ai-validation/liodon`). |
| `meshsegnet-max` | 3D_DENTAL | `AVAILABLE` | **Yes** | SHA `727cd3c5…` verified from the official repo in-env. Surface-mesh only (CBCT must be surfaced). Target HW not verified. |
| `meshsegnet-man` | 3D_DENTAL | `AVAILABLE` | **Yes** | SHA `d74c87e0…` verified in-env. Same class as max, separate weights, separate run. |
| `implant-ai` | IMPLANT | `BLOCKED` | No | `8024.pt` (SHA `e7cc1377…`, 144 MB) publishes **only on Hugging Face** — unreachable; operator-verified SHA recorded. |
| `orthodontic-ai` | ORTHODONTIC | `BLOCKED` | No | real checkpoint (SHA `fb1a781a…`, 268.8 MB) is **Google-Drive-only** — unreachable; no real-weight output exists (control run used random weights, labeled as such). |

**Candidates investigated but NOT registered** (honest; never in the live registry):

| Candidate | Family | Classification | Blocker (re-tested 2026-09-30) |
|---|---|---|---|
| DentalGemma 1.5 4B IT | DENTAL_VLM | `RESOURCE_BLOCKED` | GGUF (3.47 GiB) absent from repo; HF unreachable; no target-hardware run exists. Lab prepared, status UNKNOWN, never run. |
| ToothFairy2 (CBCT, 42 cls) | CBCT | `BLOCKED` | Real input requires user authentication; the compatible route (ToothFairy4) gates behind an account and publishes no unauthenticated case — re-tested, still gated. |
| Generic CV intraoral | INTRAORAL_PHOTO | `UNAVAILABLE` | No pretrained **intraoral-dental** model with verifiable weights in reachable sources. Generic CV is excluded by policy (no dental capability claim without dental evidence). |

**No generic-segmentation substitution** for CBCT; **no generic-CV = dental** claim for
intraoral; the VLM is not registered because no real inference exists.

---

## 9. Memory — one canonical architecture (inside Agent/Context)

`lib/ai/memory/` is the single memory subsystem. There is no second "brain" or separate service.
The flow is exactly:

```
Agent (loop.ts)
   → Memory Orchestrator (prepare / update)
        → Policy (validation.ts — trust, class, role, domain)
        → Retrieval (retrieval.ts — scoped, bounded, task-specific)
        → Validation (typed trust / confidence / key checks)
        → Context Assembly (provenance-labeled block, never flattened)
   → Agent (bounded block appended to context)
```

The agent loop calls `prepare` (retrieve) at the start of a run and `update` (write) after
execution, each **idempotent** (`memoryUpdateDone` guard) and **fail-soft**: a memory failure
degrades to no-memory and is recorded as a warning — never a run failure, and never silently.
Working memory is `EPHEMERAL` and is **never persisted**; only durable domains hit the store.

---

## 10. Memory domains & types

**Domains (5):** `CLINIC`, `DOCTOR`, `PATIENT`, `CASE`, `CONVERSATION`. Scope = domain + the
matching scope column(s); `hospitalId` is the tenant root and **every** retrieval is
tenant-scoped at the query level. `CASE` maps to a `Treatment` row in this schema.

**Types (4):** `STRUCTURED`, `EPISODIC`, `SEMANTIC`, `WORKING`. `WORKING` maps to the
non-persisted `EPHEMERAL` write class — it is the current run's scratch, never durable.

---

## 11. Trust model (7 levels; no silent escalation)

`USER_PROVIDED`, `CLINIC_CONFIGURED`, `DOCTOR_CONFIRMED`, `SYSTEM_DERIVED`, `AI_DERIVED`,
`CLINICALLY_VERIFIED`, `UNKNOWN`.

The rule the mandate fixes is enforced in `validation.ts` (`CLASS_TO_TRUST`): each write class
maps to the **only** legal trust levels, and there is no path from a lower to a higher trust.
`CANDIDATE_MEMORY → {AI_DERIVED, UNKNOWN}`; `USER_CONFIRMED → {USER_PROVIDED}`;
`DOCTOR_CONFIRMED → {DOCTOR_CONFIRMED, CLINICALLY_VERIFIED}`;
`SYSTEM_VERIFIED → {SYSTEM_DERIVED}`. **AI_DERIVED can never silently become
CLINICALLY_VERIFIED** — a model output enters only as AI_DERIVED/UNKNOWN and stays labeled
`UNVERIFIED candidate (AI_DERIVED)` when retrieved.

---

## 12. Confidence — only where justified

A numeric confidence is accepted **only** when it carries `source`, `semantics`, `calibration`,
`version`, and timestamp (`MemoryConfidence`); a bare number is rejected
(`MEMORY_CONFIDENCE_INVALID`). Otherwise trust is **categorical**. This is the guard against
manufactured numerical confidence.

---

## 13. Correction & supersession (no invisible mutation)

A correction **never mutates the original row in place**. The old row keeps its content with
`status = SUPERSEDED`/`INVALIDATED` + a `supersededBy` pointer, and an `AiMemoryEvent` records
`eventKind`, actor, reason, and **both** value snapshots (`oldValue`/`newValue`) — the same
policy class as `AuditLog.oldValues/newValues`. Provenance is therefore never invisibly
overwritten; the full write→correct→supersede→invalidate→delete→expire history is auditable.

---

## 14. Retention per domain (implementation decision — not legal)

Retention is explicit per domain via `expiresAt`, set at write time from the domain policy
(`retention.ts`). **These are implementation decisions, documented as such — not invented legal
or regulatory requirements.** The migration and docs state this plainly.

---

## 15. Memory security: write classes & authorization

Write classes: `CANDIDATE_MEMORY`, `USER_CONFIRMED`, `DOCTOR_CONFIRMED`, `SYSTEM_VERIFIED`,
plus `EPHEMERAL` (non-persisted) and `FORBIDDEN`. `CLASS_TO_ROLES` deterministically maps each
class to the roles that may use it (server-checked). **The LLM never self-authorizes a sensitive
memory write** — the agent loop proposes; the orchestrator's policy validates the actor's real
role from the session, not anything the model said. Untrusted/poisoned text is never
auto-trusted: it can only ever enter as `AI_DERIVED`/`UNKNOWN` candidate data.

---

## 16. Retrieval: scoped, bounded, task-specific

Retrieval is tenant-pinned (query-level `hospitalId`), role/patient/case/conversation scoped,
**bounded** (`maxItems` / `maxChars`), and task-specific via a deterministic plan
(`planMemoryRetrieval`) — it selects the domains relevant to the task/profile, not a
whole-history dump. The default is *not* to retrieve an entire patient's history. Results are
assembled into a **provenance-labeled block** — each line carries its trust label and source,
and candidate (AI_DERIVED) lines carry an `UNVERIFIED candidate (AI_DERIVED)` marker on the same
line. The block is explicitly "not the medical record."

---

## 17. P360 integration — 7 layers, never flattened

Memory context is appended to the agent context as its **own** labeled section. It is never
flattened into the Patient-360 blob and never merged with RAG/knowledge or raw patient records.
The agent loop keeps `memoryBlock` and the P360 clinical context as distinct, separately-labeled
inputs, so the seven context layers remain distinguishable and none inherits another's trust.

---

## 18. Agent-loop integration (deterministic-first, fail-soft)

- `prepare` runs at run start with bounded limits; `update` runs after execution, once.
- Retrieval returns a `MemoryBlock` (`block` + `serialized` + `items` + `domains` +
  `truncated` + `candidates` + `retrievalMs`).
- The **trace** (`AgentTrace.memory`) records **counts only** — `items`, `domains`, `truncated`,
  `candidates`, `retrievalMs`, `written` — never keys/values/names/content (PHI-free).
- Failure degrades to no-memory with a warning; it never fails the run and never fails open.

**Bug found & fixed by the new evaluation (§21):** the loop's `prepare` call referenced an
undefined `doctorId` (the in-scope variable is `resolvedDoctorId`), so the first real run threw
`ReferenceError: doctorId is not defined` and silently degraded. The memory golden
`MEM-001` (real loop + real store) caught it; the fix is `doctorId: resolvedDoctorId`. This is
exactly why the evaluation drives the *real* loop instead of a mock.

---

## 19. Memory API (additive route)

`POST /api/ai/memory` with `op ∈ {write, correct, invalidate, delete, list}`. Security model
matches the knowledge/agent routes:

- actor + tenant come from the **session** — the client never asserts them;
- scope columns are **re-validated server-side** against the tenant; a `PATIENT` may only touch
  their own linked patient and their own conversations;
- trust/policy rules live in `lib/ai/memory/validation.ts` — the route only transports; it
  cannot escalate trust or cross tenants;
- errors are machine-readable `{ error: { code, messageKey, message } }` with a `MEMORY_*`
  typed code and a flat **i18n** `messageKey` (ar/en) — never free-form English in Arabic.

The route is additive; it touches no agent/context/action pipeline.

---

## 20. F-1 — server-resolved patient authority through the pipeline

The reserved patient-id channel is **pipeline-only**. A model/client that puts `patientId` or
`__resolvedPatientId` into tool/action input is **stripped**; only the tenant-validated
resolution re-injects it at dispatch time. This phase completed the last remaining route:

- `app/api/ai/command/route.ts` — already strips LLM-emitted params (Phase 8 earlier).
- `app/api/ai/chat/route.ts` — **now** strips `patientId` and `__resolvedPatientId` from
  `parsed.params` before `runAiAction` (same pattern, same comment contract).

New regression coverage: `tests/api/ai-chat-f1-strip.test.ts` (NEG — LLM-emitted
`patientId`/`__resolvedPatientId` never reach the pipeline; POS — legitimate params pass
unchanged; POS — missing params sanitize to `{}`). The pipeline-side strip
(`tests/unit/ai-action-pipeline.test.ts`) and the approval-safety + regression evals remain green.
Client IDs are never authoritative; tenant/patient-scope validation is preserved; no Phase-1
bypass was introduced.

---

## 21. Evaluation — Phase 7 baseline extended with memory goldens

No second evaluation architecture. The Phase 7 `replayAgentCase` harness gained an additive
`ReplayOverrides.memory` (a real `MemoryOrchestrator` + real `InMemoryMemoryStore`) and an
`observe().memory` (counts only). `EVAL_CATEGORIES` was additively extended with `'MEMORY'`.

**`tests/evaluation/memory-eval.test.ts`** runs the **real agent loop + real store** against
**`tests/evaluation/golden/memory.golden.json`** (8 **synthetic-only** cases, `SYNTHETIC_ONLY`,
category `MEMORY`):

| Case | Contract | Result |
|---|---|---|
| MEM-001 | Provenance-labeled block appears in context; PATIENT domain retrieved | PASS |
| MEM-002 | AI_DERIVED candidate retrieved **and** labeled `UNVERIFIED candidate (AI_DERIVED)` on the same line; not promoted | PASS |
| MEM-003 | No memory intent → no retrieval (absent block) | PASS |
| MEM-004 | Explicit patient preference → **exactly one** `pref.*` `USER_PROVIDED` write, scope = session-resolved own patient (`pat-A1`) | PASS |
| MEM-005 | Memory disabled (null orchestrator) → no block, run still completes | PASS |
| MEM-006 | Poisoned stored value renders **only** as a `[USER_PROVIDED]` labeled data line; agent does not obey it; no cross-patient ids leak; nothing written | PASS |
| MEM-007 | Cross-tenant row (tenant B) **never** surfaces for a tenant-A actor | PASS |
| MEM-008 | Implicit/vague preference → **no** write (deterministic gate) | PASS |

A PHI-free meta invariant is asserted: `JSON.stringify(observed.memory)` must contain no raw
content (e.g. the follow-up note text, a name, or a model guess). The suite reports
`retrievalMs` (median) and marks any unmeasurable metric `NOT_MEASURED`, then requires the
Gate B extension (`gateReport('B_AGENT', …)`) to **PASS**.

---

## 22. Security & adversarial matrix — all fail-closed

| Attack | Where defended | Outcome |
|---|---|---|
| Poisoning (injected instruction in a stored value) | retrieval labels it; policy never auto-trusts; MEM-006 | inert labeled data; not obeyed |
| Prompt injection in message → sensitive write | write policy + role check; LLM cannot self-authorize | no unauthorized write |
| Cross-scope / cross-tenant retrieval | tenant-pinned query + scope re-validation; MEM-007 | foreign row never surfaces |
| Forged provenance / trust escalation | `CLASS_TO_TRUST` (no escalation); `MEMORY_TRUST_ESCALATION` | rejected |
| LLM-emitted patient scope (F-1) | route strip + pipeline-only reserved key; §20 | stripped |
| Stand-in / tampered weights | SHA-256 identity gate; `STANDIN_REJECTED` | refused |

Every path fails **closed**: on any violation the write is rejected or the retrieval is
empty, and a typed `MEMORY_*` code is emitted.

---

## 23. Clinical safety

A model finding is **not** a diagnosis and **not** a treatment recommendation. There is no
`diagnosis` field anywhere in the memory or engine output contracts. Engine outputs are
findings (boxes, masks, landmarks, per-cell class histograms) with neutral names; every
`clinicalEvidence.available` is `false` in this phase (no validation study published). Memory
stores events/preferences/observations with explicit trust — it does not assert clinical
conclusions. Candidate model output is always labeled `UNVERIFIED candidate (AI_DERIVED)`.

---

## 24. Performance — environment-labeled (never sandbox-as-target)

`tests/evaluation/performance-eval.test.ts` (Gate K) detects the environment label and
benchmarks, with warmup + samples, median/p95/cold/failures, asserting the record invariants and
that **no target-machine claim is emitted** when the label is not `TARGET_MACHINE`. Phase 8 added
a **`memory_prepare_update`** benchmark (one bounded write + one bounded retrieval, the agent
loop's hot path) — same label contract. All Phase 8 numbers are labeled `SANDBOX` (the
validation machine), explicitly *not* the i9-13900H target. Anything not measured is
`NOT_MEASURED`.

---

## 25. Offline/local path + additive DB migration

- **Offline/local:** the memory store, validation, retrieval, and the engine metadata are all
  in-process TS with **no cloud dependency** for the memory path. Engine inference is CPU-only;
  where weights are unreachable the engine is `BLOCKED`, not silently swapped for a cloud call.
- **DB (additive only):** `prisma/migrations/20261002000000_add_ai_memory_phase8/migration.sql`
  adds exactly two tables — `AiMemoryItem` and `AiMemoryEvent` — with indexes and
  tenant-root FKs. **No existing table, column, index, or row is altered or dropped.** No native
  ENUM types (documented String columns; the TS layer is the typed source of truth). The
  migration was tested **forward**; no `migrate reset`, no `db push` destructive op, no reseed,
  no prod-data touch. A rollback note (drop the two new tables) is in the file.

---

## 26. i18n (Arabic mandatory on new UI/API surfaces)

The memory API surface is dictionary-backed. `locales/ar.json` and `locales/en.json` each carry
the six `aiMemory.*` keys (`error.unauthorized`, `error.scopeNotFound`, `error.notFound`,
`error.invalid`, `error.conflict`, `section`) — counts match and the route returns a flat
`messageKey`, so an Arabic client never receives free-form English. The engine/metadata and
evaluation surfaces are structured data (not user-facing prose), so no additional locale keys
were invented.

---

## 27. Verification evidence (this run)

**Full suite (post-fix):** `299 test files passed | 1 skipped (300)` ·
`5708 tests passed | 12 skipped | 0 failed` (up from 5700 pre-memory-eval; +4 memory-eval,
+3 chat-F-1, +1 perf, and the memory unit/registry additions).

Phase 8 scorecard (representative suites, all green):

| Suite | Result |
|---|---|
| `tests/evaluation/memory-eval.test.ts` (real loop + real store) | 4/4 |
| `tests/unit/memory-policy.test.ts` | 15/15 |
| `tests/unit/memory-lifecycle.test.ts` | 8/8 |
| `tests/unit/memory-retrieval.test.ts` | 10/10 |
| `tests/api/memory-route.test.ts` | 10/10 |
| `tests/unit/engines-registry-metadata.test.ts` | 9/9 |
| `tests/unit/engines-capability-matrix.test.ts` | 13/13 |
| `tests/unit/engines-evidence.test.ts` | 3/3 |
| `tests/unit/engines-local-ai-service.test.ts` | 17/17 |
| `tests/api/ai-chat-f1-strip.test.ts` | 3/3 |
| `tests/evaluation/performance-eval.test.ts` (incl. `memory_prepare_update`) | 6/6 |
| `tests/evaluation/regression-eval.test.ts` | 7/7 |
| `tests/evaluation/approval-safety-eval.test.ts` | 15/15 |
| `tests/unit/ai-action-pipeline.test.ts` | 31/31 |

**Static checks:** `tsc --noEmit` = 505 errors, all pre-existing/environmental (Phase 8 surface
is **type-clean**; the one Phase 8 loop typing error was fixed). `eslint` on the Phase 8 app/lib
surface = **0 errors** (test files are in the repo's eslint ignore set). `python3 -m py_compile`
on `ai/orchestrator/app/capability_matrix.py` = OK.

---

## 28. Limitations, honest blockers, recommendations, next-phase interfaces

**Limitations (honest):**
- Three engines are `BLOCKED` purely by artifact availability (HF / Google Drive unreachable).
  The code, loader, health gate, and operator-verified SHA are all in place — the missing piece
  is the bytes. No target-hardware (i9-13900H / 16 GB) run exists for any engine this phase.
- No clinical validation evidence exists for any engine; all outputs are decision-support
  findings, not diagnoses.
- Memory retention periods are implementation decisions, not legal requirements.

**Blockers (exact):**
- `liodon` — `best.onnx` (SHA `4cee38b5…`) is Hugging-Face-only.
- `implant-ai` — `8024.pt` (SHA `e7cc1377…`) is Hugging-Face-only.
- `orthodontic-ai` — checkpoint (SHA `fb1a781a…`) is Google-Drive-only.
- `dentalgemma` (VLM) — GGUF absent + HF unreachable (candidate, not registered).
- `toothfairy2/4` (CBCT) — real input gated behind an account (candidate, not registered).
- intraoral — no verifiable **dental** pretrained weights reachable (candidate, UNAVAILABLE).

**Recommendations:**
- When the validation environment gains HF/Drive egress, re-run the operator-verified ingestion
  for the three `BLOCKED` engines (SHAs are already pinned; do not re-invent them) and upgrade
  each state only with fresh real-inference evidence.
- Add a target-hardware benchmark pass on the i9-13900H to move any `AVAILABLE` engine toward
  `targetHardwareVerified` — and label it `TARGET_MACHINE` only there.

**Clean interfaces for Phases 9–12 (exposed, not built):**
- Phase 9 (Graph/Agentic): the memory store's tenant-scoped `list`/`query` and the
  `MemoryOrchestrator.prepare/update` contract are graph- and workflow-ready without a second
  brain.
- Phase 10 (Voice/Robot): nothing in memory assumes a text-only actor; the session actor model
  is transport-agnostic.
- Phase 11 (Deployment): additive migration + CPU-only engines + env-labeled perf give a clean
  deployment surface; no production-readiness is claimed.
- Phase 12 (Certification): every engine carries a `clinicalEvidence` slot and `verificationStatus`
  ready to be filled by a real validation study — none is pre-filled.

---

*Failure policy honored throughout: 🟢/🟡/🔴 with exact reasons; BLOCKED never becomes PASS;
unmeasurable metrics are `NOT_MEASURED`, not fabricated; no false greens via skip/mock/weaken/
hardcode.*

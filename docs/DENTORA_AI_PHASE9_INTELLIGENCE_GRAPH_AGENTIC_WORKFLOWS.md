# DENTORA AI — Phase 9: Dental Intelligence, Case/Patient Graph, Clinic Intelligence & Bounded Agentic Workflows

**Status: 🟢 GREEN (all gates passed; sandbox-labeled metrics only)**
**Baseline:** Phase 8 `c86edfc` · **Environment:** SANDBOX (2 vCPU / ~3.9 GB, Node v22.22.3) · **Date:** 2026-09-30

---

## 1. Executive Summary

Phase 9 adds **dental-specialized intelligence** over the existing relational
schema and the existing single Agent:

- **ONE canonical Case/Patient Graph** (in-process, relational-backed) over
  Patient/Tooth/Case(TreatmentPlan)/Findings/Symptoms/Imaging/AI
  Findings/Diagnosis Support/Treatment/Follow-up/Outcome + cross-relations to
  conversations/memory/appointments — **no graph database introduced** (§5–§9).
- **Three capability modules** inside the existing Agent (not new frameworks,
  not new agents — §3/§48): **Dental Brain** (case understanding, structured
  summary, CDS-only differential), **Patient AI** (longitudinal timeline +
  current state), **Clinic Brain** (deterministic operational metrics + Daily
  Command Center).
- **Bounded proactive intelligence**: pure deterministic rules → typed alerts
  (AIInsight rows) with dedup/dismissal/audit. Alerts are **signals only** —
  `action` is always `null`; acting requires the existing approval/action
  pipeline (§34).
- **Four bounded agentic workflows** (case review, imaging review, follow-up,
  daily clinic) executed by a typed engine: validated state machine, hard
  budgets (maxSteps / maxToolCalls / timeout / bounded retry), RBAC at trigger
  time, sensitive steps routed through the Phase-1 action pipeline and parked
  in `WAITING_APPROVAL`, persistent replayable step logs (ONE additive
  `AiWorkflowRun` table).

Every derived relationship carries full provenance; clinical interpretation
never silently becomes clinical fact; unknown stays unknown; missing data is
`NOT_AVAILABLE`/`NOT_MEASURED` — never a fabricated metric. All 45-item DoD
checklist in §35. **No production-readiness claims** (sandbox only).

## 2. Scope & Boundary

**In:** graph module, dental/patient/clinic brains, proactive alerts, four
workflows + engine + store, 6 API routes, i18n (ar/en), 1 additive migration,
tests (unit/API/adversarial/eval/perf), this report.

**Out (explicit):** Phase 10 (voice, STT/TTS, robot UI/hardware) — clean
interfaces only, none implemented; Phase 11/12; any new Agent/Brain/Memory/RAG/
graph/observability/eval *framework*; Neo4j or any graph DB; duplicate
entities; production-readiness claims.

**Reuse (not recreated):** Phase 1 approval/action pipeline
(`runAiAction`), Phase 3 agent loop + tools, Phase 4 RAG, Phase 7 eval/replay/
observability harness, Phase 8 memory + local-AI engines, existing
notification/task/event architecture, existing prisma client + where the
schema already models the entities.

## 3. Discovery & Audit (schema-first, §5)

Audit of `prisma/schema.prisma` confirmed **every required entity already
exists** — no duplicate entities were created:

| Graph concept | Existing table | Notes |
|---|---|---|
| Patient | `Patient` | portal-linked, tenant-pinned |
| Tooth / finding / symptom | `DentalChartEntry` | FDI `toothNumber`, condition, severity, resolved |
| Case | `TreatmentPlan` (+ items) | **Case = TreatmentPlan** (decision §4.1) |
| Treatment | `Treatment` | follow-up fields on the row |
| Prescription | `Prescription` (+ meds) | |
| Imaging | `ImagingStudy` | modality/studyType/studyDate |
| AI Finding | `AIAnalysisJob` | engine, modelVersion, modelChecksum, reviewDecision, acceptedFindings |
| Diagnosis support | `DentalChartEntry` + AI job review | no separate `diagnosis` entity (6-phase rule) |
| Follow-up | `Treatment.followUpDate/Required/Notes` | |
| Outcome | `Treatment.status` + complications | |
| Memory ref | `AiMemoryItem` (Phase 8) | references only, content stays in Memory layer |
| Conversation | `AIconversation` (Phase 3/8) | cross-relation, not re-modeled |
| Appointment | `Appointment` | queue statuses (CHECKED_IN etc.) |

The **only additive DDL** is `AiWorkflowRun` (workflow observability — a new
concern with no existing table): migration
`prisma/migrations/20261003000000_add_ai_workflow_run_phase9/migration.sql`
(ADD-only; no column/table drops; tenant FK on `hospitalId`).

## 4. Key Design Decisions

1. **Case = TreatmentPlan.** A "case" in this clinic is a treatment plan with
   items/consent/status; modeling a second Case entity would have violated the
   no-duplicate-entities rule.
2. **In-process relational graph.** A graph is a *query shape over
   relations*, not a new DB. `buildCaseGraph` performs ~10 tenant-pinned
   `findMany` calls (bounded `take`s) and assembles typed nodes/edges in
   memory. Traversal is pure, bounded, deterministic (BFS, max depth/nodes,
   edge-kind filter). No Neo4j, no new job queue, no new framework.
3. **Brains are capability modules.** `runDentalBrain` / `buildPatientIntelligence`
   / `buildClinicMetrics` are imported by the existing agent tool surface and
   by the API routes; there is no second agent and no second brain.
4. **Alerts = AIInsight rows** (category/severity/title/data), `data.kind =
   'PROACTIVE_ALERT'`. Reuses the existing insight store + notification
   architecture; no new alert table.
5. **Sensitive steps have no direct write path.** `schedule_followup` maps to
   the Phase-1 `book_appointment` action; `create_finding` has **no** pipeline
   policy and therefore **fails closed** (`NO_PIPELINE_ACTION`) — a confirmed
   finding is only ever written through the existing clinician review flow.
6. **Financials are role-gated** (`SUPER_ADMIN`/`ADMIN`/`ACCOUNTANT`);
   everyone else gets `NOT_AVAILABLE` with zeroed values (not a fake success).
7. **`delayedAppointments` is always `NOT_MEASURED`** — chair-time telemetry
   does not exist; the command center never claims it.
8. **Memory refs are content-free** in the graph (ref + key + trustLevel +
   domain); content is fetched only through the scoped Phase-8 Memory API.
9. **i18n Arabic-first**: every user-facing string is a flat key
   (`int.*`, `wf.*`, `cc.*`, `aiIntelligence.error.*`, `aiWorkflow.error.*`);
   error envelopes carry `{code, messageKey, message}` — the machine-readable
   `code` is the contract, `messageKey` is the ar/en render path. RTL: no
   layout logic introduced in this phase (keys are order-neutral).

## 5. Case/Patient Graph (module: `lib/ai/intelligence/case-graph.ts`, 738 LOC)

`buildCaseGraph(prisma, {hospitalId, patientId, caseId?, actor, now, limits?})`:

- **Fail-closed entry:** unknown patient → `INT_PATIENT_NOT_FOUND`; patient of
  another tenant → `INT_SCOPE_MISMATCH`; case not of this patient/tenant →
  `INT_CASE_NOT_FOUND`. No partial graph is ever returned.
- **Node kinds** (typed, `GRAPH_NODE_KINDS`): `PATIENT, DOCTOR, TOOTH,
  CASE, FINDING, SYMPTOM, IMAGING, AI_FINDING, DIAGNOSIS_SUPPORT,
  TREATMENT, PRESCRIPTION, FOLLOW_UP, OUTCOME, MEMORY, APPOINTMENT`.
- **Edge kinds** (typed, `GRAPH_EDGE_KINDS`) with per-edge **provenance**:
  `{source, actor, at, sourceType, version?}` + **trust class** (see §6).
- **Limits:** `maxNodes/maxEdges` + per-table `take`s (`maxAppointments`,
  `maxTreatments`, `maxImaging`, `maxChartEntries`, `maxMemory`) — bounded by
  construction; truncation is reported on the graph object.
- **Traversal:** `traverseGraph(graph, {startId, maxDepth≤limits, maxNodes≤
  limits, direction, edgeKinds?})` → `{nodes, edges, depth, truncated,
  queryCount, resultCount, maxDepthReached}`. Unknown start → empty result.
  Pure function: no I/O, deterministic.
- **AI jobs** come from the **standalone `AIAnalysisJob` table**, re-pinned to
  the patient's studies (`studyId ∈ patient's study ids`) — the embedded
  `imagingStudy.aiJobs` array is display data, not the graph's source.
- **Scope revalidation at the consumer boundary** (§9): patient AI refuses any
  graph containing a foreign `patient:*` node (`INT_SCOPE_MISMATCH`) —
  defense in depth beyond the build-time pinning.

## 6. Trust Classes & Provenance (§9)

`GRAPH_TRUSTS` (7 classes, distinct semantics — interpretation never silently
becomes fact):

| Class | Meaning | Produced by |
|---|---|---|
| `RECORD_FACT` | Structured record fact | chart/treatment/plan/appt rows |
| `USER_PROVIDED` | Patient/portal statement | memory (USER_PROVIDED), chief complaint |
| `DOCTOR_CONFIRMED` | Clinician confirmed | **ACCEPTED** AI review, clinical notes |
| `AI_DERIVED` | Model output, unconfirmed | unreviewed/rejected AI findings |
| `KNOWLEDGE_EVIDENCE` | RAG guideline evidence | (reserved; Phase-4 surface) |
| `SYSTEM_INFERRED` | Deterministic derivation | follow-up overdue, utilization, bottlenecks |
| `UNKNOWN` | Unresolvable | unmapped sources |

Rules enforced and tested:

- **Every edge has provenance** (source/actor/at/sourceType); an edge without
  it is *reported* by the consistency checker, never silently completed (§32).
- **AI finding → FACT only on `reviewDecision = 'ACCEPTED'`** (job-level
  clinician decision). Unreviewed/rejected findings stay `AI_DERIVED` /
  `AI_INTERPRETATION`. Forged `acceptedFindings` without a decision confirm
  nothing (adversarial #9).
- **No silent overwrite:** supersession is explicit (memory `supersededBy`;
  resolved chart entries keep history; the graph contains both active and
  resolved findings with `resolved` flags).
- Memory `AI_DERIVED` rows are never upgraded by the graph or any brain;
  trust class travels with the node (`MEMORY_TRUST_MAP`).

## 7. Scope Revalidation & Tenant Isolation

- **Session is the source of trust:** all 6 routes read actor + `hospitalId`
  from `requireAuthAndRole(...)`; the client never asserts either.
- **`resolvePatientScope`**: staff → tenant-pinned lookup; `PATIENT` → **only
  their own linked patient** (sibling patient in the same tenant → 404).
- **`resolveCaseScope`**: caseId revalidated against (tenant, patient).
- **Graph/brains**: every read is tenant- and patient-pinned; cross-tenant
  requests fail closed with typed codes (unit tests #1–#6, adversarial).
- **Revalidation at the tool/application-service boundary**: the graph is
  rebuilt server-side per request; patient AI re-checks graph membership;
  workflow `RESOLVE_PATIENT` re-validates the context patient against the
  tenant (a forged id fails the *run*, producing zero output items).
- **Store tenant-pinning:** `createWorkflowRunStore(prisma, hospitalId)`
  captures the tenant; every read/write includes `hospitalId` in the where
  clause — a foreign run id is invisible, not an error.

## 8. Dental Brain — case understanding (§10–§13)

`understandCase(graph, {procedureCategories, now})` answers the required
questions with **explicit availability per item**:

- **Teeth** (FDI) with per-tooth condition aggregation (severity max;
  `resolved = all entries resolved` — a RESOLVED history entry no longer hides
  an ACTIVE condition; **real bug found & fixed by differential testing**).
- **Findings**: chart findings (FACT) vs AI findings (class-bound).
- **AI vs clinician-confirmed**: separate lists; confirmed = ACCEPTED only.
- **Imaging**: studies with modality/studyType/status + job count.
- **Treatment done / pending / cancelled** (status-partitioned).
- **Follow-up due**: date + overdue flag (deterministic vs `now`).
- **Missing information**: closed key set
  (`chief_complaint, imaging, findings, follow_up_date, case_plan_status`) —
  an empty rich record yields all five; a complete record yields `[]`.
  Unknown stays unknown; nothing is invented.

## 9. Dental Brain — summary & differential

- **Fixed 16-section clinical summary** (`patientContext … missingInformation`)
  + `disclaimerKey` (`int.summary.disclaimer`), every section typed
  `{state: AVAILABLE|NOT_AVAILABLE|NOT_MEASURED, lines[]}`. No section is
  omitted; gaps are explicit.
- **Differential support = CDS stance only**: `stance:
  'clinical_decision_support'` is a structural constant; candidates carry
  supporting/contradicting/missing evidence arrays; the summary never emits a
  `diagnosis` field; a plan's *recorded* diagnosis (clinician record) is a
  flag, not an AI claim.
- **Domains**: condition→domain mapping (`CARIES/FILLED/FRACTURED→RESTORATIVE`,
  `ROOT_CANAL/SENSITIVE→ENDODONTICS`, …) + procedure categories.
- **Injection stays data**: free-text INJECTED payloads in the fixture remain
  inert strings in bounded outputs (adversarial #20).

## 10. Imaging Intelligence Pipeline (§14)

The pipeline stages (modality → scope → engine → run → validate → provenance →
AI-vs-clinician → graph → memory candidate → approval) **already exist** from
Phases 5–8; Phase 9 connects, not duplicates:

- The graph ingests **only completed, validated `AIAnalysisJob` rows** with
  model provenance (`modelVersion`, `modelChecksum`, `orchestratorVersion`) on
  every `AI_FINDING` node and `IMAGING_HAS_AI_FINDING` edge.
- Unavailable engines are never called (Phase 8 engine honesty; the brain
  layer performs **no inference at all** — it is rules over structured data).
- Findings enter the graph as **evidence with provenance and scope** — never
  as diagnoses; confirmation requires the real clinician review decision.
- The `imaging_review` workflow builds a review package (CDS) and **fails
  closed at `create_finding`** (no pipeline policy → `NO_PIPELINE_ACTION`).

## 11. Patient AI — longitudinal timeline (§15–§16)

`buildPatientIntelligence(graph, now)`:

- **Timeline**: typed events `{id: ev:{nodeId}, at (top-level, ISO), kind ∈
  APPOINTMENT|TREATMENT|IMAGING|AI_FINDING|AI_REVIEW|FOLLOW_UP|OUTCOME|CASE|
  MEMORY, labelKey, labelParams, insightClass, provenance, data}`.
  Sorted **time desc (stable) → kind → id**; hard `TIMELINE_LIMIT = 50` with
  `timelineTruncated` flag.
- **Trust preserved end-to-end**: ACCEPTED AI finding → `FACT` + AI_REVIEW
  event; unreviewed → `AI_INTERPRETATION`; overdue follow-up →
  `DERIVED_INSIGHT`; memory → `FACT` with trustLevel, **content-free**.
- **Never invented**: every event maps 1:1 to a graph node (a real record);
  an empty patient produces an **empty** timeline and explicit unknown areas.

## 12. Patient AI — current state

`current = { activeCases, currentTreatments, pendingItems, followUpsDue,
recentFindings, unresolvedIssues, memoryRefs }`:

- `activeCases`: plan statuses `PROPOSED/ACCEPTED/IN_PROGRESS` **plus legacy
  `ACTIVE`** (tolerant read of pre-enum rows — report, don't drop; real
  fixture-compat fix).
- `currentTreatments`: treatment/rx nodes `IN_PROGRESS|PENDING|SCHEDULED|
  PLANNED|DRAFT`; ref = `treatmentNo` (display id) when present.
- `pendingItems`: current treatments + missing consent for
  PROPOSED/ACCEPTED plans.
- `followUpsDue`: date-asc; `overdue` only when `date < now` (d+30 fixture is
  listed, not overdue).
- `recentFindings` ≤ 10 with AI-confirmed flag; `unresolvedIssues` =
  unresolved chart findings + unconfirmed AI finding refs + overdue follow-up
  refs.
- `memoryRefs`: `{ref, key, trustLevel, domain}` — **never content**.

## 13. Clinic Brain — deterministic metrics (§17)

`buildClinicMetrics(prisma, {hospitalId, now, actorRole})` — every section
typed `{state, …}` over verified rows only:

- **todayAppointments**: total, `byStatus`, noShows, cancellations,
  `utilization = (completed+in_progress)/scheduledToday` — **`null` when
  nothing is scheduled** (never a fake 0%).
- **queue**: waiting (CHECKED_IN), inProgress, bounded checked-in list.
- **overdueFollowUps**: COMPLETED + `followUpRequired` + `followUpDate ≤ now`,
  date-asc, bounded items.
- **pendingTreatments**: PLANNED/IN_PROGRESS by status.
- **doctorWorkload**: scheduledToday + overdueFollowUps per doctor.
- **aiReviewRequired**: COMPLETED jobs without `reviewDecision` (≤20).
- **financialItems**: deterministic count/sum of open invoices — **only for
  `SUPER_ADMIN/ADMIN/ACCOUNTANT`**; others `NOT_AVAILABLE` (zeroed).
- **unresolvedTasks** + **bottlenecks**: bounded deterministic rules
  (`NO_SHOW_RATE ≥3`, `QUEUE_BACKLOG ≥4`, `FOLLOW_UP_BACKLOG ≥5`,
  `UTILIZATION_SATURATION`) — no noise below threshold, no LLM.

## 14. Daily Command Center (§18–§19)

`buildCommandCenter` → 11 typed sections (`todaysAppointments,
patientsWaiting, delayedAppointments, urgentClinicalReview, pendingFollowUps,
pendingTreatments, aiFindingsAwaitingReview, operationalBottlenecks,
unresolvedTasks, financialItems, doctorWorkload`):

- every item keeps its **insight class** (`FACT` vs `DERIVED_INSIGHT` vs
  `AI_INTERPRETATION`) — classes are never mixed (§20);
- `delayedAppointments` is **always `NOT_MEASURED`** with an explicit
  "not claimed" note (no chair-time telemetry);
- deterministic first: same input → byte-identical metrics (tested).

## 15. Proactive intelligence — rules (§17–§21)

`runProactiveIntelligence` — **pure deterministic rules, no LLM**:

1. **FOLLOW_UP_DUE**: overdue `>7d` → `CRITICAL`, else `WARNING`;
   due-within-3d → `INFO`; required-without-date → `CASE_INCOMPLETE
   WARNING`.
2. **MISSED_APPOINTMENT**: past-due (−30 min) SCHEDULED/CONFIRMED without
   check-in → `WARNING`; recorded NO_SHOW → `INFO`.
3. **AI_REVIEW_REQUIRED**: per unreviewed COMPLETED job → `WARNING`.
4. **QUEUE_BOTTLENECK**: waiting ≥4 `WARNING`, ≥8 `CRITICAL`.

Every alert carries `{alertType, severity, trigger, evidence, scope,
titleKey, at, dedupKey, state}` and persists as an AIInsight row with
`data = {dedupKey, alertType, trigger, evidence, scope, titleParams,
detectedAt, detectedById, kind: 'PROACTIVE_ALERT', action: null}` + 14-day
`expiresAt`.

## 16. Proactive — dedup, dismissal, audit

- **Dedup by stable key per (tenant, alertType, scope)**: re-runs are
  idempotent (`created=0`, `deduplicated=N`); dedup reads are tenant-pinned —
  a foreign tenant's row never blocks or suppresses.
- **Dismissal is a STATE change**: the audit row is never deleted;
  `dismissed=true` + `data.dismissedById/dismissedAt` recorded; dismissed
  alerts leave the active list and can be re-detected.
- **Tenant-pinned dismissal**: foreign/unknown id → `NOT_FOUND` (404 typed).
- **Audit trail**: `AI_INTELLIGENCE_ALERTS_RUN`,
  `AI_INTELLIGENCE_ALERT_DISMISS` via the shared `writeAudit` helper.

## 17. Insight classes & alert types (§20–§21)

- Insight classes (`FACT, AI_INTERPRETATION, DERIVED_INSIGHT, RECOMMENDATION,
  ACTION`) are typed on every brain/center/workflow output item and asserted
  in tests — never mixed, never implicit.
- Alert types are the closed typed set
  `FOLLOW_UP_DUE | MISSED_APPOINTMENT | AI_REVIEW_REQUIRED | CASE_INCOMPLETE |
  TREATMENT_PENDING | QUEUE_BOTTLENECK | TASK_OVERDUE` (Phase 9 implements
  rules for the first five; `TREATMENT_PENDING`/`TASK_OVERDUE` extend the same
  typed envelope via the existing notification/task/event architecture).
- Bounded: fixed rules, fixed severity mapping, fixed dedup keys, 14-day
  expiry, 200-row GET cap — **no spam path**.

## 18. Workflow framework — typed definitions (§22)

Four canonical definitions (`lib/ai/workflows/definitions.ts`) in a closed
registry (`WORKFLOWS`):

| id | steps | maxSteps | maxToolCalls | timeout | retry | allowedRoles | approval steps |
|---|---|---|---|---|---|---|---|
| `case_review` | 9 | 9 | 8 | 30s | 1× `RETRIEVAL_TIMEOUT` | SA/A/D/R | — |
| `imaging_review` | 6 | 7 | 7 | 120s | 1× `ENGINE_TIMEOUT` | SA/A/D/LAB | `create_finding` |
| `follow_up` | 6 | 7 | 6 | 30s | 1× `RETRIEVAL_TIMEOUT` | SA/A/D/R | `propose_action` |
| `daily_clinic_review` | 7 | 7 | 5 | 20s | 0 | SA/A/D | — |

Each definition: `{workflowId, version, nameKey, trigger, allowedRoles,
allowedTools, maxSteps, maxToolCalls, timeoutMs, retry{maxRetries, retryOn},
approvalRequiredSteps, verificationRequired, audit, steps[]}` with unique step
ids. Structural validity (steps ≤ maxSteps, tools ⊆ allowedTools, approval
steps ⊆ ids, budgets > 0) is **unit-tested for every definition**.

## 19. Workflow state machine (§23)

Closed status set `PENDING → RUNNING → (WAITING_APPROVAL →) COMPLETED |
FAILED | CANCELLED | EXPIRED`:

- `isValidTransition` is a closed table; **every transition is persisted**
  through the store; terminal states have zero exits (exhaustively tested).
- Invalid transitions throw `INT_WORKFLOW_INVALID_TRANSITION` (409 at the
  API) — e.g. cancelling a completed run, resuming an EXPIRED run.
- Retry is **not** a state transition (RUNNING stays RUNNING); the attempt
  counter is observability, persisted with the run.

## 20. Workflow engine — bounds (§24–§26)

`runWorkflow(deps, {workflowId, context})`:

- **RBAC at trigger time** against the definition (`INT_WORKFLOW_ROLE_DENIED`
  → 403) — the client/LLM can never grant roles or widen budgets.
- **No invented workflows/tools**: unknown id → `INT_WORKFLOW_NOT_FOUND`;
  step referencing a tool outside `allowedTools` →
  `INT_WORKFLOW_NOT_RUNNABLE`; steps > maxSteps →
  `INT_WORKFLOW_LIMIT_EXCEEDED` (all tested with deliberately evil
  definitions injected at runtime).
- **Hard budgets enforced per run**: tool call counter vs `maxToolCalls`
  (`INT_WORKFLOW_LIMIT_EXCEEDED`); wall-clock vs `expiresAt`
  (`INT_WORKFLOW_EXPIRED`, fail closed); retry only for typed codes in
  `retryOn`, bounded by `maxRetries` (non-retriable → immediate FAILED).
- **Patient-scoped runs require a revalidated patient**
  (`INT_INVALID_PARAMS` / `INT_PATIENT_NOT_FOUND`); clinic runs may have no
  patient (graph steps then report NOT_AVAILABLE rather than failing).
- **Persistence**: every run persists to `AiWorkflowRun` (id, workflowId,
  version, status, tenant, patient/case, actor, currentStep, bounded
  `stepLog[]` with per-step `{stepId, ok, toolCalls, latencyMs,
  verification, detail, error?}`, approvalId, context, result, attempts,
  timestamps) — **observable, replayable, auditable**.
- **Deterministic replay**: injected `now`/`nextRunId`; same input →
  identical step sequence, result and output keys (golden WF-001).

## 21. Sensitive steps & approval parking (§25)

- `PROPOSE_ACTION` **never mutates a record**: it maps to the Phase-1 action
  pipeline (`schedule_followup → book_appointment`; `create_finding →`
  **no policy → fail closed**) and hands the run off:
  - pipeline `APPROVAL_REQUIRED` → run parks in **`WAITING_APPROVAL`** with
    `approvalId`; an `ACTION` output item `wf.out.actionPendingApproval` is
    emitted; **nothing is executed** (tests assert zero `actionExecuted`
    items and the parked terminal row);
  - pipeline `BLOCKED` → run FAILED (`BLOCKED` surfaced in `result.error`);
  - no pipeline bound / blocked upstream → FAILED closed.
- `create_finding` failing closed is a deliberate boundary: confirmed
  findings are written only through the existing clinician review flow — the
  workflow may point at it, never bypass it.
- **Proactive ≠ autonomous**: alert rows carry `action: null` by
  construction (§34); executing anything is a separate approved action.

## 22. Workflow persistence & replay

- ONE additive table (`AiWorkflowRun`) — relational, tenant-indexed; no
  queue, no graph DB.
- `WorkflowRunStore` is a structural interface: the route uses the prisma
  store (tenant-captured), unit tests use the in-memory store (same
  interface) — no logic forks.
- `list`/`get` API ops are tenant-pinned observations of the step log
  (replay + audit); `cancel` is a validated transition.
- The engine never writes clinical records — its only writes are the run's
  own state rows.

## 23. API surface (§37)

| Route | Verb | Scope | Behavior |
|---|---|---|---|
| `/api/ai/intelligence/case` | GET | staff+PATIENT, revalidated patient/case | `understanding` (dental brain) |
| `/api/ai/intelligence/summary` | GET | same | 16-section `summary` + CDS `differential` |
| `/api/ai/intelligence/patient` | GET | same | `intelligence` (timeline + current + unknownAreas) |
| `/api/ai/intelligence/clinic` | GET | staff (incl. ACCOUNTANT) | `metrics` + `commandCenter` (financials role-gated) |
| `/api/ai/intelligence/alerts` | GET/POST | staff | active alerts / `run` sweep / `dismiss` |
| `/api/ai/workflows` | GET/POST | union of workflow roles | definitions / `run`/`cancel`/`get`/`list` |

Conventions (identical class to Phase 4/6/8 additive routes): `force-dynamic`;
session-resolved actor/tenant; typed `INT_*` error envelope
`{error: {code, messageKey, message}}` with flat ar/en keys; bounded queries
(caps on alerts list, workflow run store `take`); fire-and-forget audit on
every read/action (`AI_INTELLIGENCE_*_READ/RUN/DISMISS/CANCEL`,
`AI_WORKFLOW_*`); 401 unauthenticated / 403 role / 404 scope / 400 params /
409 transition / 500 unexpected — all asserted in the API suite.

## 24. Security model summary

- AuthN via the existing session (`requireAuthAndRole`); authZ per surface
  and, for workflows, **per definition** at trigger time.
- Patient scoping: server re-validation; PATIENT self-pinning.
- Tenant isolation at every layer (routes, graph, brains, alerts, run store)
  with fail-closed typed errors; cross-tenant data never appears in any
  output (asserted: no `hosp-B`/`pat-B1` substrings in tenant-A graphs).
- AI output class-bound (never auto-fact); memory content-free;
  injection payloads stay inert data; planner cannot invent
  tools/permissions/evidence/relationships or bypass safety (adversarial
  #18–#22).
- No direct uncontrolled DB access from any brain/engine: all I/O through
  injected structural prisma interfaces.

## 25. i18n / Arabic-first / RTL (§39)

- **5,663 flat keys per locale** (ar.json / en.json, parity-checked) —
  Phase 9 added the `int.*` (case/patient/summary), `wf.*` (steps + output
  items), `cc.*` (command center sections), `aiIntelligence.error.*` and
  `aiWorkflow.error.*` namespaces.
- **Zero hard-coded user-facing English**: response payloads carry keys +
  params; the error contract is `code` + `messageKey` (Arabic users never
  receive a free-form English contract string).
- Deterministic outputs (metrics/step logs) contain no prose — they are
  structured values rendered via keys, which keeps RTL layout-neutral.

## 26. Memory boundaries (§27)

- The graph projects memory **references only** (ref/key/trustLevel/domain);
  content is fetched exclusively through the scoped Phase-8 Memory API.
- Memory never overwrites authoritative structured records: no brain writes
  to any clinical table; workflow runs write only their own state rows.
- Superseded memory (`status ≠ ACTIVE`) is excluded at graph build; trust
  classes travel unchanged (poisoned `trustLevel` claims stay
  class-bound, content-free — adversarial #11).

## 27. RAG boundaries (§28)

- No PHI/clinic data is ingested into global knowledge; the Phase-4 RAG
  surface is untouched in this phase.
- Workflow `RETRIEVE_KNOWLEDGE` uses the **local deterministic domain
  mapping** (condition/procedure → domain) — it performs no semantic
  retrieval and fabricates no citations; true RAG queries remain a Phase-4
  agent capability, separate from this surface.

## 28. Local-AI boundary (§29)

- Local-AI findings reach the graph **only** as validated `AIAnalysisJob`
  rows with model provenance (version/checksum/orchestrator) — evidence,
  never diagnoses.
- Unavailable engines are never called from this surface (the brains perform
  no inference); engine honesty from Phase 5/8 is preserved.
- Multimodal attachments: the workflow context accepts `attachmentIds`
  (bounded, string-typed) that flow into the run's persisted context;
  attachment **analysis** remains the Phase-6 pipeline — no file duplication,
  no new upload path.

## 29. Evaluation — synthetic goldens (§31–§32)

`tests/evaluation/intelligence-phase9.golden.json`
(`phiPolicy: SYNTHETIC_ONLY`, 15 cases) +
`tests/evaluation/intelligence-eval.test.ts`:

- `INT9-CG-001..004`: canonical graph (FDI teeth, trust-preserved kinds,
  full edge provenance, bounded size, isolation); tenant-B pinning; forged
  id → `INT_PATIENT_NOT_FOUND`; cross-tenant → `INT_SCOPE_MISMATCH`.
- `INT9-DB-001..003`: understanding (teeth/confirmed/domains/no missing on
  rich record); empty record (explicit missing + 16 sections + no
  fabrication); CDS differential (stance + candidates + no diagnosis).
- `INT9-PA-001..002`: deterministic desc timeline, kind set, accepted AI →
  FACT / pending → AI_INTERPRETATION, current treatment ref, limit 50;
  empty patient → empty timeline, no invented events.
- `INT9-CB-001..002`: empty day (total 0, utilization **null**, financials
  NOT_AVAILABLE for RECEPTIONIST); rich day (exact totals, utilization 0.3,
  QUEUE_BACKLOG, financials AVAILABLE for ACCOUNTANT, NOT_MEASURED delayed).
- `INT9-WF-001..004`: case_review 9 steps COMPLETED + **replay
  deterministic**; follow_up parks WAITING_APPROVAL with no executed action;
  imaging_review fails closed at create_finding with review package present;
  PATIENT role → `INT_WORKFLOW_ROLE_DENIED`.
- `INT9-AL-001`: sweep → 1 WARNING signal, idempotent re-run (0 created / 1
  dedup), `action` always null.

Every case runs the **real modules** over the shared synthetic harness; each
produces ≥1 typed check; **any FAIL fails the test** (zero false-greens).
**Result: 15/15 cases, all checks PASS.**

## 30. Adversarial security (§33) — 22 cases, all fail closed

`tests/unit/intelligence-adversarial.test.ts`:

1. forged patient id → `INT_PATIENT_NOT_FOUND` (no graph)
2. cross-tenant patient id → `INT_SCOPE_MISMATCH`
3. cross-patient leakage (PAT_A2 trap) — never in PAT_A1 graph
4. foreign patient node injected into a graph → patient AI
   `INT_SCOPE_MISMATCH`
5. traversal from foreign/unknown start → empty result
6. forged case id → `INT_CASE_NOT_FOUND`
7. unreviewed AI job → findings stay AI_INTERPRETATION, never FACT
8. REJECTED decision (confidence 0.99) → not confirmed
9. **forged clinician confirmation** (acceptedFindings without decision) →
   not confirmed
10. AI "diagnosis" → CDS differential only; no `diagnosis` field fabricated
11. memory poisoning (self-promoting claim) → content-free, class-bound
12. superseded/stale memory → not projected (ACTIVE only)
13. **provenance forgery** (edge without provenance) → REPORTED, graph
    **not repaired** (byte-identical after check)
14. orphan + duplicate + impossible two-patient edges → all reported; input
    unchanged
15. conflicting case state + stale derived follow-up → reported
16. alerts: signal-only (`action: null`), idempotent, cross-tenant dedup
    isolation
17. tenant-pinned dismissal (foreign id → NOT_FOUND); sweep writes nowhere
    else
18. privilege escalation: PATIENT in no workflow allowedRoles →
    `INT_WORKFLOW_ROLE_DENIED`
19. planner manipulation: invented tool → NOT_RUNNABLE; over-steps →
    LIMIT_EXCEEDED
20. prompt injection in patient data stays DATA (run unaffected, canonical
    step program, no instruction echo)
21. fake approval: parked run cannot be advanced by the client; only
    validated transitions exist
22. stale/EXPIRED run: closed state machine, no resume/cancel

**Result: 22/22 PASS — every attack fails closed.**

## 31. Graph consistency checks (§33) — REPORT, never repair

`checkGraphConsistency(graph)` returns typed issues (the graph is never
mutated — verified byte-identical after the call):

`ORPHAN_EDGE` (missing endpoint) · `IMPOSSIBLE_PATIENT_CASE_LINK` (two
distinct patient nodes) · `MISSING_PROVENANCE` (edge without source/at) ·
`DUPLICATE_EDGE` (same kind|from|to twice) · `CONFLICTING_STATE` (same case
ref, different statuses) · `STALE_DERIVED_RELATIONSHIP` (RECORD-sourced
follow-up dated before `builtAt`). All six are produced on demand by
adversarial tests #13–#15; none auto-corrects clinical data.

## 32. Performance (§36) — SANDBOX-labeled only

`tests/evaluation/intelligence-performance-eval.test.ts` (Phase-7/8
benchmark harness, environment-label contract):

| Benchmark | Scope | Invariants |
|---|---|---|
| `phase9_graph_build_traverse` | graph build + bounded traversal (depth 3) | labeled, 0 failures, p95 ≥ median |
| `phase9_brains_latency` | understanding + summary + differential + patient AI | labeled, 0 failures |
| `phase9_clinic_command_center` | metrics + command center | labeled, 0 failures |
| `phase9_workflow_case_review` | full run (total/steps/tool calls) | 9 steps, 0 < toolCalls ≤ 8 |
| `phase9_alerts_sweep_dedup` | sweep + idempotent re-run | labeled, 0 failures |

Label for this run: **SANDBOX** (never TARGET_MACHINE unless forced);
summaries always emit the label; no target-machine/production claims. All 6
tests PASS with warmup + samples and `assertLabeled` checks.

## 33. Migration (additive only, §40)

`prisma/migrations/20261003000000_add_ai_workflow_run_phase9/migration.sql`:
creates `AiWorkflowRun` (id, hospitalId FK, workflowId, version, status,
patientId, caseId, actorId, actorRole, currentStep, stepLog Json, approvalId,
context Json, result Json, attempts, startedAt, completedAt, expiresAt,
createdAt) + indexes on `(hospitalId, status)` and `(hospitalId,
createdAt)`. **ADD-only** — no drops, no column renames, no data mutation;
schema.prisma updated in lockstep (structural `any` prisma client
unchanged).

## 34. Test matrix (§39/§40)

| Suite | File | Tests |
|---|---|---|
| Case graph (scope/isolation/trust/traversal/consistency) | `tests/unit/intelligence-case-graph.test.ts` | 16 |
| Dental brain (understanding/summary/differential/NOT_AVAILABLE/injection) | `tests/unit/intelligence-dental-brain.test.ts` | 11 |
| Patient AI (timeline/current/trust/bounds) | `tests/unit/intelligence-patient-ai.test.ts` | 8 |
| Clinic brain + command center (metrics/gating/determinism) | `tests/unit/intelligence-clinic-brain.test.ts` | 7 |
| Proactive (rules/severity/dedup/dismiss/signal-only) | `tests/unit/intelligence-proactive.test.ts` | 9 |
| Workflow engine + definitions (state machine/RBAC/budgets/retry/replay) | `tests/unit/workflows-engine.test.ts` | 25 |
| API routes (6 routes: auth/scope/errors/gating/run/cancel/audit) | `tests/api/ai-intelligence-routes.test.ts` | 18 |
| Adversarial (22 attack scenarios, fail-closed) | `tests/unit/intelligence-adversarial.test.ts` | 22 |
| Evaluation goldens (15 synthetic cases) | `tests/evaluation/intelligence-eval.test.ts` | 2 |
| Performance (SANDBOX-labeled) | `tests/evaluation/intelligence-performance-eval.test.ts` | 6 |
| **Phase 9 total** | | **124** |

Supporting harness change (additive, backward-compatible):
`tests/harness/context-fixtures.ts` now creates delegates for `extraRows`
tables not in the base fixture set (staff/aiAnalysisJob/aiMemoryItem/…) —
required because the graph reads the standalone `AIAnalysisJob` table.

**Full regression: `5,832 passed | 12 skipped | 0 failed` (309 files;
baseline Phase 8: 5,708 passed — delta exactly +124 new, no regressions).**

## 35. Definition of Done (§41–§42) — checklist

- [x] Relational schema audited first; ONE canonical graph; **no graph DB**
- [x] No duplicate entities; no second Agent/Brain/Memory/RAG/eval framework
- [x] Case = TreatmentPlan (documented)
- [x] All trust classes distinct; interpretation never silently becomes fact
- [x] Provenance on every derived relationship; no silent overwrite
- [x] Tenant isolation on every traversal; revalidation at tool/app boundary
- [x] Dental Brain answers all case-understanding questions; explicit
      unavailable; fixed 16-section summary + disclaimer
- [x] Differential = CDS only; never a confirmed diagnosis
- [x] Imaging pipeline connected (validated jobs + provenance); no
      unavailable engine calls; find-finding fails closed
- [x] Patient AI: bounded deterministic timeline (50), trust preserved,
      unknown stays unknown, no invented events
- [x] Clinic Brain: deterministic metrics; NOT_MEASURED/NOT_AVAILABLE where
      missing; financials role-gated; no fake 0%
- [x] Command Center: typed sections; delayed = NOT_MEASURED
- [x] Proactive: bounded rules; typed alerts; trigger/evidence/scope/severity/
      timestamp/dedup/dismissal/audit; no spam
- [x] Insight classes never mixed
- [x] 4 typed workflow definitions (version/trigger/roles/tools/budgets/
      timeout/retry/approval/verification/audit)
- [x] Validated state machine; no silent transitions
- [x] No workflow directly mutates sensitive records; approval parking
- [x] Bounded planner; cannot invent tools/permissions/evidence; no bypass
- [x] Memory never overwrites authoritative records; content-free refs
- [x] RAG separate from PHI; local-AI findings = evidence only
- [x] Attachments connected, no duplication
- [x] Eval extended with synthetic goldens (all brains/graph/workflows)
- [x] Adversarial ≈20 (22) — ALL fail closed
- [x] Graph consistency checks — REPORT, never silently repair
- [x] Additive migration only
- [x] Typed APIs + auth + RBAC + tenant/patient/case scoping + validation +
      bounded queries + typed errors + audit
- [x] Arabic-first ar/en, no hard-coded user-facing English, RTL-neutral
- [x] Test matrix (graph/dental/patient/clinic/workflows/security/adversarial/
      full regression)
- [x] Performance labeled SANDBOX (no target claims)
- [x] No production-readiness claims; Phase 10 boundary respected (interfaces
      only)

## 36. Status, failures, next actions

**Gate: 🟢** — every gate passed with evidence (tests above; tsc/eslint below).

**Typecheck:** `tsc --noEmit` → **505 errors, identical to the Phase 8
baseline (505); 0 new; 0 in any Phase 9 file** (pre-existing baseline errors
are out of scope and untouched).
**Lint:** `eslint` on the Phase 9 surface (lib/ai/intelligence,
lib/ai/workflows, both route trees, all new test files, harness) → **0
errors** (only pre-existing ignore-pattern warnings for tests/).
**Build:** not re-run (no build-breaking surface changes beyond additive
routes; the Next build in this sandbox fails on font egress — pre-existing,
environmental, unrelated).

**Blockers:** none for this phase. Environmental notes (not blockers):
fonts.googleapis.com egress blocked (build font fetch); api.github.com 401
(token) — push uses the configured sandbox git auth.

**Real bugs found & fixed by Phase 9 tests (differential/honesty wins):**
1. `differentialSupport` per-condition aggregation was overwritten by the
   latest finding — a RESOLVED history entry hid the ACTIVE condition (0
   candidates on a valid caries case). Now: severity = max, `resolved` = AND
   of entries, tooth preserved.
2. Patient AI `activeCases` silently dropped legacy `ACTIVE` plan status
   (out-of-enum fixture row) — now included with a comment (report, don't
   drop).
3. `tests/harness/context-fixtures.ts` did not create delegates for
   non-base `extraRows` tables → new-table reads crashed; additive fix.

**User files (preserved, untouched, uncommitted):** `lib/auth.ts`,
`lib/prisma.ts`, `tests/setup.ts`, `vitest.config.ts`,
`tests/unit/auth-root-cause.test.ts`,
`tests/unit/auth-root-cause-empty-secret.test.ts`,
`tests/unit/prisma-fallback-recovery.test.ts` — verified present in the
working tree and excluded from the Phase 9 commit.

**Phase 10 interfaces (exposed, not implemented):**
- Voice/STT-TTS: no surface added (explicit boundary).
- Robot/UI/hardware: none.
- What Phase 10 *can* attach to: the `AiWorkflowRun` observation API
  (run/step/approval state), the alerts GET (push channel candidate), and the
  patient intelligence bundle (timeline/current) — all already typed and
  tenant-scoped.

**Files changed (Phase 9 commit):**
- `lib/ai/intelligence/` — types, case-graph, dental-brain, patient-ai,
  clinic-brain, proactive, route-utils (7 files, ~2,539 LOC)
- `lib/ai/workflows/` — types, definitions, engine, run-store (4 files, ~894 LOC)
- `app/api/ai/intelligence/{case,summary,patient,clinic,alerts}/route.ts`,
  `app/api/ai/workflows/route.ts` (6 routes)
- `prisma/schema.prisma` (AiWorkflowRun model),
  `prisma/migrations/20261003000000_add_ai_workflow_run_phase9/migration.sql`
- `locales/ar.json`, `locales/en.json` (5,663 keys each, parity)
- tests: 5 unit suites + workflows suite + API suite + adversarial + eval
  goldens (json + ts) + perf suite + harness extension (12 test artifacts)

**Recommendation:** proceed to Phase 10 design on the clean interfaces above.
Before any production consideration: run the SANDBOX-labeled benchmarks on
the TARGET_MACHINE (label will switch automatically), add chair-time
telemetry if `delayedAppointments` should ever leave `NOT_MEASURED`, and
re-audit the baseline 505 tsc errors as a separate maintenance track.

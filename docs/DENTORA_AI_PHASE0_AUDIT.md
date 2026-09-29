# DenToRa AI — PHASE 0: Forensic Audit of the Existing AI Assistant & Agent Readiness

**Date:** 2026-09-29 · **Branch:** `arena/01a0ce7a-dental-clinic-system` @ `9a08f31` · **Mode:** AUDIT ONLY (zero production modifications — verified in §A and §Evidence)

This audit reverse-engineered the existing DenToRa AI from source, schema, tests, docker artifacts, the validation lab, and live runtime probes. Every claim carries file/function/line evidence. Where evidence is unavailable it is explicitly marked **UNKNOWN**.

---

## A. Executive Summary — What Exists Today

DenToRa already ships **two distinct AI stacks** that do not talk to each other:

### Stack 1 — Cloud LLM Assistant ("the Assistant")
A full-featured, **cloud-LLM (OpenRouter) clinic assistant** built into the dashboard:

- **17 API routes** under `app/api/ai/**` (chat, command, query, clinical, analyze, briefing, insights, suggestions, usage, cashflow-forecast, claim-analysis, inventory-forecast, no-show-risk, patient-segmentation, pricing-suggestions) plus `app/api/data-import/ai-mapping` (AI column-mapping for imports) and `app/api/cron/briefing` (morning briefing).
- **Model tiering** (`lib/ai/models.ts`): Flash-Lite `google/gemini-2.5-flash-lite` (fast/chat) → Pro `google/gemini-2.5-pro` (default/reports/query/scheduling/billing/insights) → Opus `anthropic/claude-opus-4.5` (`clinical` tier, temperature 0.2) for safety-critical tasks. Cost-tier comments in `lib/ai/models.ts:5-18`.
- **15 "skills"** (`lib/ai/skills/*.ts`) = role-gated prompt templates (treatment-advisor, consent-generator, whatsapp-receptionist, billing-agent, smart-scheduler, no-show-predictor, …) each mapped to a model tier via `SKILL_MODEL_MAP` (`lib/ai/models.ts:57-77`).
- **28 natural-language → database actions** with an LLM intent-detection pass (Flash) + **34 executor functions** (`lib/ai/command-executors.ts:1317` dispatcher) that **write directly to the database with NO approval step** (create patient, book/cancel appointment, create treatment, create invoice, **record payment**, update stock, lab orders, prescriptions…).
- **Natural-language → data queries** (`app/api/ai/query/route.ts`) via a **whitelist of 5 hardcoded Prisma builders** (invoice, patient, appointment, treatment, inventoryItem), limit ≤ 50, all tenant-scoped. No raw SQL.
- **7 clinical sub-endpoints** (`app/api/ai/clinical/route.ts`): patient_summary (cached to `Patient.aiSummary`), drug_check, cost_estimate (14% EG VAT), consent_form (multi-language), clinical_notes, duplicate_check, audit_analysis.
- **Risk scoring** (`app/api/ai/analyze/route.ts:38-115`): deterministic rubric embedded in the prompt → LLM scores 0–100 → persisted as `PatientRiskScore`.
- **Insights engine**: `AIInsight` records (6 categories, 3 severities, TTL) produced by an LLM (briefing/insights routes) and by a **deterministic rule-based event dispatcher** (`lib/ai/event-dispatcher.ts`: treatment.completed, appointment.no_show, inventory.below_reorder, lab_order.delayed, payment.received>EGP5000, patient.created).
- **UI**: full chat page (`app/(dashboard)/chat/page.tsx`, 656 lines) + floating chat widget (`components/ai/chat-widget.tsx`, 424 lines), **voice in/out via browser Web Speech API** (`hooks/use-web-voice.ts`, default `lang: 'ar-EG'`, hands-free continuous mode), voice orb, streaming SSE, plus 12 more components (command-bar, patient-360, treatment-assist 543 lines, report-builder, insights-panel, audit-monitor, usage-stats, …).
- **Persistence**: `AIConversation` (messages + context snapshot as JSON), `AISkillExecution` (input/output/status/duration/tokensUsed/cost), `AIInsight`, `AuditLog` entries (`AI_INTERACTION`), rate limit 100 req/min per user (chat route).
- **Tests**: 10 dedicated AI test files, **664 tests, all passing** (verified this audit: `npx vitest run` → `10 passed, 664 passed`); full suite 5114 passed / 12 skipped / 0 failed.
- **AuthN**: `OPENROUTER_API_KEY` server env var (optional — features 502 without it, `.env.example:86-89`); settings page shows key status (stubbed: always `unknown`, `app/(dashboard)/settings/ai/page.tsx:71`).

### Stack 2 — Local Imaging AI (Phases 19A → 20B)
A **local, CPU-only, Dockerized multi-engine imaging analysis pipeline** (see §I): FastAPI orchestrator (:8000) + 5 engines (liodon :8001, MeshSegNet max :8002 / man :8003, implant-ai :8004, orthodontic-ai :8005), MinIO object storage, `ImagingStudy` + `AIAnalysisJob` (full provenance + mandatory doctor review), upload UI, findings viewer, doctor review panel. Validated in the `ai-validation/` lab (6 engine workspaces incl. control runs, provenance docs, contract tests).

### The headline architectural fact
**The chat assistant has zero access to the imaging stack and zero access to most of the patient's dental data.** `lib/ai/context-builder.ts` (the only context source) fetches medical-history flags, 5 treatment plans, 5 completed appointments, open invoices, and the latest risk score — **it does NOT fetch the odontogram (`DentalChartEntry`), imaging studies, AI findings, clinical notes, prescriptions, procedures, or symptoms.** The two stacks share no context, no tools, no memory, and no approval layer.

### Audit hygiene
- No production file was modified. The only new artifact is this report (`docs/`), left **uncommitted**.
- Runtime state at audit time: dev server (Next 16.2.12 Turbopack) on :3000; all `POST /api/ai/*` and `POST /api/imaging/studies` returned **401** unauthenticated (auth gates live); `POST /api/ai/usage` → 405 (GET-only). Sandbox DB is in prisma fallback mode (no live rows) — behavioral claims are code-level + unit-test-level, not live-data-level.

---

## B. Current Architecture (as-built, from code)

```
                                   ┌────────────────────────────────────────────────────────────┐
                                   │                      BROWSER (Next.js 16 App Router)        │
                                   │  /chat page · chat-widget · command-bar · treatment-assist  │
                                   │  patient-360 · insights-panel · voice (Web Speech ar-EG)    │
                                   │  /imaging UI (upload, studies, findings viewer, review)     │
                                   └───────┬──────────────────────────────────────┬─────────────┘
                       fetch /api/ai/*      │                                      │  XHR multipart
                                            ▼                                      ▼
   ┌─────────────────────────────────────────────────┐      ┌──────────────────────────────────────────┐
   │ STACK 1 — Cloud LLM Assistant (Node, in-process)│      │ STACK 2 — Local Imaging AI (Docker)       │
   │                                                 │      │                                          │
   │ app/api/ai/{chat,command,query,clinical,        │      │ Next.js routes (auth, tenant, storage)    │
   │  analyze,briefing,insights,usage,suggestions,   │      │  app/api/imaging/**  (lib/ai-orchestrator)│
   │  cashflow-forecast, claim-analysis,             │      │        │                       │          │
   │  inventory-forecast, no-show-risk,              │      │        ▼                       ▼          │
   │  patient-segments, pricing-suggestions}         │      │  MinIO (S3)  ◄──── read-only ───┐         │
   │ app/api/data-import/ai-mapping · cron/briefing  │      │        │  original.${ext} keys   │         │
   │                                                 │      │        ▼                         │         │
   │ lib/ai/openrouter.ts ── HTTPS ─────────────────────►  │  FastAPI ORCHESTRATOR :8000               │
   │   (OpenRouter: gemini-2.5-flash-lite /             │   /health /engines /analyze /jobs/{id}        │
   │    gemini-2.5-pro / claude-opus-4.5)               │   secret header · validates responses         │
   │ lib/ai/models.ts (3 tiers)  lib/ai/context-builder │        │  per-engine dispatch                 │
   │ lib/ai/skills/* (15 prompt templates, RBAC)        │        ▼                                       │
   │ lib/ai/command-executors.ts (34 write/read execs)  │  liodon:8001  meshsegnet-max:8002 (ONNX/PyTorch│
   │ lib/ai/event-dispatcher.ts (6 rule-based events)   │  CPU)  meshsegnet-man:8003  implant:8004       │
   │                                                 │      │  orthodontic:8005 (mmpose CPU)            │
   └──────────────┬──────────────────────────────────┘      └──────────────────────────────────────────┘
                  │ Prisma (tenant-scoped, hospitalId on every query)
                  ▼
   MySQL (Prisma): Patient · MedicalHistory · Appointment · Treatment · Invoice · Payment ·
   Prescription · DentalChartEntry (odontogram) · ImagingStudy · AIAnalysisJob · AIConversation ·
   AISkillExecution · AIInsight · PatientRiskScore · StockTransaction · AuditLog · Setting …
```

**Classification of the current system (§5 question):** the Assistant is a **hybrid of (a) simple chat completion and (b) a fixed tool-using pipeline** — NOT an agent. It has a deterministic single-turn loop (context → intent → tool → response) with 28+5 tools, but **no planning, no multi-step loops, no self-verification, no reflection, no learning from outcomes**. The imaging stack is a **workflow engine** (async jobs, provenance, human review). Proven in §D.3.

---

## C. AI Assistant Capability Matrix

| Capability | Status | Evidence | Location | Risk |
|---|---|---|---|---|
| Free chat (Arabic/English, streamed) | 🟢 IMPLEMENTED | SSE `streamResponse`; streaming flag; 654-line chat page; 664 green tests | `lib/ai/openrouter.ts:93-127`, `app/(dashboard)/chat/page.tsx` | Cloud dependency; key missing → 502 |
| Voice input (STT) | 🟢 IMPLEMENTED (browser) | Web Speech API, default `ar-EG`, hands-free continuous | `hooks/use-web-voice.ts:28-46`, `chat-widget.tsx:108-152` | Browser support; privacy (local) |
| Voice output (TTS) | 🟢 IMPLEMENTED (browser) | TTS after stream ends; voice-mode prompt rules (no markdown, spoken Arabic numbers) | `chat-widget.tsx:128-144`, `app/api/ai/chat/route.ts:262-275` | Browser TTS quality |
| Intent detection → action execution | 🟢 IMPLEMENTED, ⚠️ NO APPROVAL | Flash pass over last 8 turns → `executeIntent` → direct DB writes → result injected as `ACTION RESULT` | `app/api/ai/chat/route.ts:62-126,246-290`; `lib/ai/command-executors.ts:1317` | LLM-triggered writes (payments!) without human approval; dead `ai_financial_approval_limit` setting |
| Natural-language → data read | 🟢 IMPLEMENTED (safe) | Whitelist 5 builders, limit≤50, tenant-scoped, no raw SQL | `app/api/ai/query/route.ts:14-97,150-157` | 5 models only; read-only |
| Clinical: 360° summary | 🟢 IMPLEMENTED (LLM) | clinical tier; cached `Patient.aiSummary/aiSummaryAt` | `app/api/ai/clinical/route.ts:76-148` | Cache staleness (manual `refresh` only) |
| Clinical: drug interactions | 🟢 IMPLEMENTED (LLM) | clinical tier; "doctor review only" disclaimer in prompt | `clinical/route.ts:150-190` | LLM-only pharma knowledge, no formulary DB |
| Clinical: cost estimate (EG VAT 14%) | 🟢 IMPLEMENTED (LLM) | reports tier; real `Procedure.basePrice` fed in | `clinical/route.ts:192-243` | LLM arithmetic |
| Clinical: consent form (multi-lang) | 🟢 IMPLEMENTED (LLM) | `language` param; reports tier | `clinical/route.ts:245-290` | Legal validity of generated text |
| Clinical: notes expansion | 🟢 IMPLEMENTED (LLM) | "Do not fabricate findings" prompt rule | `clinical/route.ts:292-330` | Still LLM free text |
| Duplicate patient detection | 🟢 IMPLEMENTED (hybrid) | deterministic candidate fetch + LLM confidence ≥0.6 | `clinical/route.ts:332-391` | LLM scoring variance |
| Audit-log anomaly analysis | 🟢 IMPLEMENTED (LLM) | last 200 logs → suspicious patterns JSON | `clinical/route.ts:393-421` | 200-row window only |
| Risk scoring (0–100 + contraindications) | 🟢 IMPLEMENTED (LLM + rubric) | rubric in prompt; persists `PatientRiskScore` + tokens/cost | `app/api/ai/analyze/route.ts:38-115` | LLM-assigned scores presented as fact |
| Morning briefing (cron) | 🟢 IMPLEMENTED | cron route → reports tier → `AIInsight` | `app/api/cron/briefing/route.ts:92-103` | LLM cost per run |
| Insights (generate/list/dismiss) | 🟢 IMPLEMENTED | fast tier JSON; ADMIN writes; TTL | `app/api/ai/insights/route.ts` | — |
| Financial analytics (cashflow, claims, pricing, no-show, segments) | 🟢 IMPLEMENTED (LLM over real aggregates) | real Prisma aggregates → LLM → `AISkillExecution` | 6 routes under `app/api/ai/` | LLM math over numbers |
| Skill RBAC | 🟢 IMPLEMENTED | per-skill `allowedRoles`, 403 on mismatch | `lib/ai/skills/*.ts`, `chat/route.ts:216-221` | chat action executors are NOT skill-RBAC-gated (all roles) |
| Settings toggles (ai_enabled, budget, approval limit…) | 🔴 DEAD UI — stored, never read | `settings/ai/page.tsx:17-36` writes Setting rows; **zero readers** (grep of `lib/`, `app/` = 0 hits) | `app/(dashboard)/settings/ai/page.tsx` | False sense of control; budget/approval guardrails do not exist |
| Token/cost tracking | 🟢 IMPLEMENTED | `AISkillExecution.tokensUsed/cost/duration`; usage dashboard (ADMIN) | `analyze/route.ts:107-115`, `app/api/ai/usage/route.ts` | no budget *enforcement* |
| Rate limiting | 🟢 IMPLEMENTED | 100/min per user via `auditLog.count` | `chat/route.ts:163-177` | DB-count per request (perf) |
| Conversation persistence | 🟢 IMPLEMENTED | `AIConversation` (messages+context JSON), fire-and-forget | `chat/route.ts:296-312` | fire-and-forget `.catch(console.error)` = silent loss |
| Server-side conversation memory | 🔴 MISSING | server never fetches prior `AIConversation` rows into context; history is **client-sent** each request | `chat/route.ts:131-135,315` | context window controlled by client; no cross-session memory |
| Attachments / multimodal in chat | 🔴 MISSING | no `<input type=file>` / FormData anywhere in chat UI (grep evidence) | `components/ai/*`, `chat/page.tsx` | cannot analyze "الصورة دي" from chat |
| Knowledge base / RAG | 🔴 MISSING | no embeddings/vector store/retrieval anywhere (grep: 0 hits for embedding/vector/rag in app/lib) | — | dental intelligence = LLM pretraining only |
| Approval workflow for AI actions | 🔴 MISSING | no approval model/endpoint; executors write directly | `command-executors.ts` | see §L-1 |
| Local (offline) LLM for assistant | 🔴 MISSING (conflict) | 100% of assistant inference = OpenRouter cloud | `lib/ai/openrouter.ts:9` | conflicts with local-only CPU mandate for AI; egress + cost + PHI to cloud |

---

## D. Five-Principles Audit

### D.1 Prompt Engineering
**What exists (all prompts are in-repo, versioned with the code — no prompt store, no versioning metadata):**
1. **INTENT_PROMPT** — `app/api/ai/chat/route.ts:62-126`: 28 actions with explicit param schemas, enums, date-normalization rules, "respond ONLY with JSON `{action, params, complexity}`". Strong structured-output instruction; complexity field drives cost-optimized routing.
2. **General system prompt** — `chat/route.ts:222-244`: hospital name, hard rules ("MUST NOT share patient data across hospitals", "NEVER claim you performed an action unless you see an ACTION RESULT"), date, serialized context.
3. **Voice-mode variant** — `chat/route.ts:262-275`: no-markdown rules, spoken Arabic number examples.
4. **15 skill system prompts** — `lib/ai/skills/*.ts` (`systemPrompt(hospitalName, contextStr)` factory). `treatment-advisor` contains explicit mandatory clinical rules (allergy flagging, diabetes→HbA1c, pregnancy→X-ray deferral, blood thinners→EGP, "NEVER provide a clinical diagnosis", "NEVER prescribe", "Mark all output as 'AI-generated — pending doctor review'").
5. **Query translator prompt** — `query/route.ts:110-129`: model+filter reference, JSON-only.
6. **Clinical sub-prompts** — `clinical/route.ts` (7), each with JSON-only output contracts and, for the sensitive ones, "doctor review only" / "do not fabricate" clauses.
7. **Risk rubric prompt** — `analyze/route.ts:80-100`: deterministic point values per condition (allergies +15, pregnancy +20…).
8. **Analytics prompts** — 6 routes + briefing + audit_analysis: all "Output valid JSON ONLY" with explicit schemas.
9. **Orchestrator/engine prompts** — N/A (fixed models, no LLM; validation is code, `ai/orchestrator/app/validation.py`).

**Prompt engineering assessment:**
- Explicit & schema-driven: **strong** (every JSON-producing prompt has a contract; `extractJSON` handles code-fence wrapping, `openrouter.ts:131-135`).
- Hard-coded vs dynamic: roles/systems are hard-coded templates; dynamic parts = hospital name, context snapshot, date. **No prompt versioning, no A/B, no runtime config** of prompts (settings page cannot change them).
- **Injection defenses: absent.** User text is concatenated into INTENT_PROMPT (`recentMessages` appended after the system prompt — correct role separation), but there is no delimiting/quoting of user content, no instruction to distrust embedded instructions, no output-side filter. Mitigating factor: the only *effects* are the fixed 34 executors, all tenant-scoped (§L).
- **Prompt duplication:** intent list (28 actions) duplicated conceptually in executors dispatcher; skill prompts repeat context boilerplate. Clinical safety rules exist only in `treatment-advisor` — the generic chat route has no equivalent "never diagnose" rule.
- Hidden assumptions: intent model assumes it can collect missing params "from conversation history"; executors assume LLM passes strings (`parseInt`/`parseFloat` on all numerics — a non-numeric LLM output silently produces `NaN`/`undefined`, e.g. `execCreatePatient` age).

### D.2 Context Engineering
**Origin & retrieval:** single source — `lib/ai/context-builder.ts:26-121` (Prisma, all queries tenant-scoped by `hospitalId`):
- Always: hospital (name, plan), user (name, role), current page.
- If `patientId` (client-supplied, tenant-checked via `findUnique({id, hospitalId})`): demographics, medical-history flags (allergies/diabetes/HTN/heart/hepatitis/HIV/epilepsy/pregnancy/bleeding), current medications, open-invoice balance, 5 latest treatment plans, 5 completed appointments, latest `PatientRiskScore.overallScore`.
- Skills and all other routes build their own ad-hoc contexts (clinical routes fetch their own slices; analytics routes fetch their own aggregates). **There is no single context service** — ~10 separate fetch implementations.

**Injection:** `serializeContext` (compact `key: value` lines) is interpolated into system prompts verbatim.

**Missing from context (verified by reading `buildContext` includes):** odontogram (`DentalChartEntry`), imaging studies & AI findings, clinical notes, prescriptions, treatments in-progress, procedures, symptoms/complaints text, lab orders, communication history. **The Assistant is blind to the patient's teeth, their X-rays, and the AI's own imaging findings.**

**Filtering/ranking:** none (take-limits: 5 plans, 5 visits, 10 invoices implicit in some routes). **Staleness:** `Patient.aiSummary` cache invalidated only by manual `refresh:true`. **Size control:** none (no token budget; history = client's last N messages, capped at 20 in the final prompt `chat/route.ts:315`). **Leakage:** context is per-request, tenant-scoped — no cross-tenant leak found. **Unauthorized context:** any authenticated user of the tenant can pass any `patientId` of that tenant to `/api/ai/chat` (no per-patient authorization beyond tenant) — RBAC exists only for skills and some routes (analyze: ADMIN/DOCTOR/RECEPTIONIST; clinical: **all roles**; query: **all roles**).

### D.3 Loop Engineering (reverse-engineered execution loop)

Per-request loop of `POST /api/ai/chat` (proven from `app/api/ai/chat/route.ts`):

| Stage | Status | Location / method | Inputs → Outputs | Failure handling |
|---|---|---|---|---|
| Observe | ✅ | auth + body parse | HTTP → session, messages, patientId, page, skill, stream, voice | 401/400 |
| Understand (intent) | ✅ | 2nd LLM call (Flash) over last 8 turns | messages → `{action, params, complexity}` | silent `catch {}` → continue as plain chat (`chat/route.ts:288-289`) |
| Retrieve | ✅ | `buildContext` Prisma | hospital/user/patient → context string | 500 on DB error |
| Plan | 🔴 MISSING | no plan step; at most one action per turn | — | — |
| Use Tools | ✅ | `executeIntent` (34 executors) | action+params → DB mutation result | executor returns `{success:false,message}` → injected as action result text |
| Analyze | ✅ (LLM) | main completion (tiered model) | system+context+history+action result → answer | 502 on provider error |
| Validate | 🟡 PARTIAL | executor param checks (required fields, amount>0, ≤balance, valid status enums, duplicate checks, conflict checks) | — | no LLM-output validation (free text accepted as-is) |
| Safety | 🟡 PARTIAL | prompt rules only; no runtime safety layer | — | — |
| Approval | 🔴 MISSING | — | — | — |
| Act | ✅ | executors write Prisma | — | best-effort (no transaction spanning multi-write actions; e.g. `record_payment` = payment.create + invoice.update without `prisma.$transaction`) |
| Verify | 🔴 MISSING | no post-action verification call | — | — |
| Learn from outcome | 🔴 MISSING | — | — | — |
| Audit | ✅ | `AIConversation` + `AuditLog(AI_INTERACTION)` fire-and-forget; `AISkillExecution` (tokens/cost/duration) on skill/clinical/query paths | — | `.catch(console.error)` silent |

**Classification (proven, not assumed):** **tool-using chat pipeline (single-shot), plus a separate deterministic workflow engine for imaging.** No agent loop, no RAG, no multi-step planning, no reflection. Multi-"step" requests are handled by the LLM narrating, not by an execution loop.

### D.4 Harness Engineering
**Test inventory (verified counts, all green this audit):**
- AI-dedicated: `tests/api/ai-routes.test.ts` (1455 lines, 65 cases), `tests/api/ai-extended.test.ts` (492, 24), `tests/unit/ai-context-builder.test.ts` (911), `tests/unit/ai-event-dispatcher.test.ts` (347), `tests/unit/ai-models.test.ts` (173, 18), `tests/unit/ai-openrouter.test.ts` (666, 45), `tests/unit/ai-skills.test.ts` (332, 34), `tests/unit/ai-skills-individual.test.ts` (247), `tests/components/ai-components.test.tsx` (1775), `tests/components/ai-provider.test.tsx` (320) → **10 files / 664 tests passed** (run 2026-09-29, 14.45s).
- Full suite: **5114 passed / 12 skipped / 0 failed** (run 2026-09-29).
- Imaging: `tests/api/e2e-imaging-ai.test.ts` (docker-gated), imaging unit/component suites (part of the 5114).
- Engine lab: `ai-validation/*/tests/` (contract tests per engine, e.g. `test_engine6_contract.py`), validation reports with hashes/timing.

**What the mocks hide:** `tests/unit/ai-openrouter.test.ts:29-47` mocks `global.fetch` with canned JSON — **no test exercises a real OpenRouter response**, and no test asserts prompt *quality* (they assert plumbing: headers, model routing, JSON extraction, error mapping). `tests/api/ai-routes.test.ts` mocks all of Prisma — executor DB behavior (transactions, partial failures) is untested. **No adversarial/prompt-injection tests, no multimodal tests (chat has none to test), no timeout/retry tests for the LLM call (there is no retry/timeout code — `fetch` with default undici timeout), no performance tests.**

**Observability:** `console.error` logs only; `AISkillExecution` rows give tokens/cost/duration per skill; `AuditLog` gives per-interaction audit; no tracing (no request IDs through LLM calls), no metrics endpoint, no LLM log of the actual prompts/sent (only intent specs/outputs stored).

**Reproducibility:** model names pinned in `AI_MODELS` (good); but OpenRouter may swap underlying versions — no `provider`/snapshot pinning; temperature per tier. **A clinical prompt change today is NOT detectable by the test suite** (no prompt regression fixtures beyond string-presence checks in `ai-skills*` tests).

**Gap (answer to "can we prove an AI change didn't break…"):** clinical workflows — NO (no clinical eval set); permissions — YES (route role tests exist in `ai-routes.test.ts`); tenant isolation — YES (builder tests assert `hospitalId` scoping); Arabic — PARTIAL (i18n parity tests cover static strings, not LLM Arabic quality); patient context — YES (context-builder unit tests, 911 lines); imaging — YES (dedicated suites + lab); API behavior — YES; performance — NO.

### D.5 Graph Engineering (what exists, as-built)

Relational core (Prisma, all tenant-scoped by `hospitalId`):

```
Hospital ─┬─ User · Staff · Patient ── MedicalHistory (allergies, conditions, meds)
          │        │
          │        ├─ DentalChartEntry (toothNumber, toothNotation, 5 surfaces,
          │        │      ToothCondition, Severity, diagnosedDate, resolvedDate)  ← ODONTOGRAM
          │        ├─ Appointment (type, status, priority, chiefComplaint, doctorId)
          │        ├─ Treatment (procedureId, doctorId, cost, diagnosis, toothNumbers,
          │        │      followUpDate, Procedure, TreatmentPlan/Items)
          │        ├─ Prescription (doctorId, diagnosis, medications[])
          │        ├─ ClinicalNote (NoteType) · InsuranceClaim · Invoice/Payment
          │        ├─ ImagingStudy (modality, originalKey/size/hash, appointmentId?)
          │        │      └─ AIAnalysisJob (engine, status, provenance{model,checksum,
          │        │            source,license,orchestratorVersion}, findings Json,
          │        │            confidence, requestedBy, reviewedBy, reviewDecision,
          │        │            acceptedFindings)
          │        └─ PatientRiskScore (overallScore, factors, contraindications)
          ├─ AIConversation (messages Json, context Json) · AISkillExecution · AIInsight
          ├─ InventoryItem/Batch/StockTransaction · Supplier · PurchaseOrder · StockAlert
          └─ LabOrder (workType, toothNumbers, shadeGuide, labVendorId, status chain)
```

**Assessment:** the *data* graph of the Patient 360 target (§12) **already exists relationally** — every expected node except explicit "Symptom", "Outcome", and "Conversation↔Patient" link (AIConversation is keyed to user, not patient). Tooth-level data exists (`DentalChartEntry`, `toothNumbers` on treatments/lab orders) but as **integers/strings, not FDI-validated** (no check constraint; `toothNumber Int` accepts 0–99+; no uniqueness on (patient, tooth)). Temporal tracking exists per-entity (`diagnosedDate/resolvedDate`, `createdAt/updatedAt`, `AIAnalysisJob` lifecycle timestamps) but **no event-sourced history** — patient updates overwrite (no history table; `AuditLog.oldValues/newValues` is the only change log, written by app routes, not by AI executors — **executors do not write AuditLog entries**, verified by reading all 34 executors: only `update_stock` writes a `StockTransaction` audit trail; create/update patient, record_payment etc. leave no AuditLog row, only the `AI_INTERACTION` conversation-level log).

**Missing links:** Conversation→Patient (context stores patient snapshot but conversation isn't linked), AIInsight→entity (insights carry `data` JSON, no FK), ImagingStudy↔Treatment (no link — X-rays can't be tied to the procedure they support), Outcome (no model). No graph DB, no computed "case graph" object anywhere (grep: no case-graph code).

---

## E. Dental Intelligence Matrix

| Capability | Classification | Evidence |
|---|---|---|
| Dental terminology in answers | **SIMULATED** (LLM pretraining, unverified) | no domain corpus/KB in repo (grep: zero knowledge-base files); quality = OpenRouter model's |
| FDI tooth numbering | **PARTIAL** | `DentalChartEntry.toothNumber Int` + `toothNotation String` (`schema.prisma:773-804`); `toothNumbers` strings on Treatment/LabOrder; **no FDI validation, no unique (patient,tooth)**; AI never receives odontogram in context |
| Odontogram awareness | **MISSING (for AI)** / EXISTS (for UI) | odontogram UI + model exist; `buildContext` does NOT include `DentalChartEntry` (`context-builder.ts:40-50` includes list) |
| Diagnosis support | **PARTIAL** | `Treatment.diagnosis` free text; `clinical_notes` expansion LLM; **no diagnosis dictionary/entity**; treatment-advisor prompt says "NEVER provide a clinical diagnosis" (prompt-level only) |
| Differential diagnosis | **MISSING** | no endpoint, no prompt, no data model |
| Treatment planning | **PARTIAL → DRAFT only** | `treatment-advisor` skill (sequencing rules in prompt, `lib/ai/skills/treatment-advisor.ts`); `TreatmentPlan` model exists; AI output is text — no structured plan write, no approval |
| Contraindication checking | **PARTIAL (rubric-based)** | deterministic rubric for risk (`analyze/route.ts:80-100`); prompt rules for surgery/X-ray/anticoagulants (treatment-advisor); drug_check LLM only — **no drug-formulary database** |
| Periodontal / endodontic / prosthodontic / ortho / implant / pediatric detail | **MISSING (structured)** / SIMULATED (free text) | no dedicated data models; `ProcedureCategory` enum exists for procedures; ortho *imaging* (38 landmarks) is a real engine (§I) but its output never reaches the assistant |
| Dental imaging understanding | **SPLIT** | imaging engines: real local inference (proven, §I); assistant chat: blind (no imaging context, no attachments) |
| Clinical documentation | **PARTIAL** | `clinical_notes` LLM expansion + real `ClinicalNote` model (with `NoteType` enum) — but the LLM output is returned to the UI as text; persistence is a separate manual step (no verified auto-persist path found for AI notes) |
| 100-domain knowledge scope | **MISSING** | nothing in the repo implements, scopes, or verifies it; entirely delegated to the cloud model |

**Bottom line:** "dental intelligence" today = **cloud LLM general knowledge + a handful of prompt rubrics + real imaging engines that the LLM cannot see.** Nothing in the dental domain is VERIFIED as specialized intelligence.

## F. Clinic Intelligence Matrix

| Capability | READ | DRAFT | RECOMMEND | APPROVAL | EXECUTE | Evidence |
|---|---|---|---|---|---|---|
| Today's appointments / queue / no-shows | 🟢 `show_appointments`, `daily_summary` | — | 🟢 no-show-risk route + insight | — | 🟢 complete/cancel/reschedule (no approval) | executors §2, `no-show-risk/route.ts` |
| Doctor schedules / rooms | 🟢 partial (doctor lookup; **no room model found** — UNKNOWN) | — | — | — | — | `findDoctor`; no Room in schema grep |
| Delayed patients / bottlenecks | 🟡 LLM over aggregates | — | 🟢 insights (event dispatcher: lab delay, no-show) | — | — | `event-dispatcher.ts` |
| Follow-ups / recalls | 🟡 `Treatment.followUpDate` exists; no recall queue model (UNKNOWN) | — | 🟢 re-engagement insight | — | — | schema `Treatment`, dispatcher |
| Outstanding treatment / pending procedures | 🟢 `show_treatments` | — | 🟢 invoice-recommended insight on `treatment.completed` | — | 🟢 `complete_treatment` (no approval) | executors §3 |
| Billing status / revenue / overdue | 🟢 `show_invoices`, `check_overdue`, `show_revenue`, cashflow/claims routes | 🟢 cost_estimate | 🟢 insights | 🔴 **missing** | 🟢 **`record_payment`, `create_invoice` — no approval** | executors §4 |
| Inventory / stock / purchasing | 🟢 `check_stock`, `low_stock`, forecast | — | 🟢 PO-recommended insight | — | 🟢 `add_inventory_item`, `update_stock` (StockTransaction trail) | executors §5 |
| Lab orders | 🟢 `show_lab_orders` | — | 🟢 delay insight | — | 🟢 create/update (status-validated) | executors §6 |
| Scheduling (slots, conflicts) | 🟢 | 🟢 smart-scheduler skill | — | — | 🟢 `book_appointment` (conflict-checked) | executors §2, skill |
| Prescriptions | 🟢 `show_prescriptions` | 🟢 (LLM text) | — | 🔴 missing (doctor sign-off model exists: `PrescriptionStatus` w/ SIGNED? — **not verified in this audit: UNKNOWN**) | 🟢 `create_prescription` (no approval) | executors §7 |

## G. Patient 360 Matrix (per node)

| Node | Exists | AI-accessible | Permission-aware | Tenant-aware | Historical | Timestamped |
|---|---|---|---|---|---|---|
| Demographics | ✅ Patient | ✅ context | ⚠️ any role in tenant | ✅ | overwrite-only | ✅ |
| Medical history | ✅ MedicalHistory | ✅ (flags serialized) | ⚠️ | ✅ | ❌ | ✅ (implicit) |
| Dental history (odontogram) | ✅ DentalChartEntry | 🔴 NOT in context | — | ✅ | ✅ (diagnosed/resolved) | ✅ |
| Allergies / Medications | ✅ (in MedicalHistory + Medication catalog) | ✅ flags / catalog searchable (skill) | ⚠️ | ✅ | ❌ | — |
| Visits / Appointments | ✅ | ✅ (5 completed) | ⚠️ | ✅ | ✅ | ✅ |
| Symptoms/complaints | ⚠️ free text only (`chiefComplaint`) | ⚠️ only via appointments/treatments include (not in context) | — | ✅ | — | — |
| Diagnoses | ⚠️ `Treatment.diagnosis` string | ⚠️ partial | — | ✅ | — | — |
| Imaging + AI findings | ✅ ImagingStudy+AIAnalysisJob | 🔴 NOT in context; chat can't view/attach | ✅ (route-level) | ✅ | ✅ | ✅ |
| Treatments / Procedures | ✅ | ✅ (5 plans) | ⚠️ | ✅ | ✅ | ✅ |
| Prescriptions | ✅ | 🟡 via executor (search) | ⚠️ | ✅ | ✅ | ✅ |
| Payments / Invoices | ✅ | ✅ (balance in context) | ⚠️ | ✅ | ✅ | ✅ |
| Follow-ups / Recall | ⚠️ followUpDate only | ❌ | — | ✅ | — | ⚠️ |
| Communications | ✅ (messaging models) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Outcomes | 🔴 no model | — | — | — | — | — |
| AI memory of patient | ⚠️ `aiSummary` cache + `PatientRiskScore` (latest only; `findFirst` in context) | ✅ | ⚠️ | ✅ | ⚠️ (scores accumulate; summary = 1) | ✅ |

## H. Multimodal Matrix

| Modality | Upload | Storage | Validation | AI inference | Result → UI | Audit | Pipeline stops at |
|---|---|---|---|---|---|---|---|
| PANORAMIC (x-ray) | ✅ `ImagingUpload` (jpeg/png/webp ≤50MB) | ✅ MinIO `original.${ext}`, hash+size+mime persisted | ✅ ext+size+mime; engine re-validates | ✅ liodon (local, CPU) | ✅ FindingsViewer (boxes) + doctor review | ✅ job+provenance+review | **complete** (engine run user-verified; sandbox docker-gated) |
| PERIAPICAL / BITEWING | ✅ same | ✅ | ✅ | ✅ implant-ai (YOLOv8-seg, 8 classes) | ✅ + review | ✅ | **complete** (engine user-verified) |
| CEPHALOMETRIC | ✅ (Phase 20B) | ✅ | ✅ | ✅ orthodontic-ai (38 landmarks, mmpose CPU) | ✅ 38 landmarks viewer + review | ✅ | **complete** (score-overshoot validator bug fixed `9a08f31`) |
| THREE_D_SCAN / CBCT (mesh) | ✅ obj/stl/vtk/ply ≤200MB | ✅ | ✅ ext whitelist (`.npy` refused) | ✅ meshsegnet-max/man (jaw param) | ✅ segment table (15 classes) | ✅ | **complete** (body-buffer 10MB→200MB fixed `9a08f31`) |
| PHOTO | ✅ upload+storage | ✅ | ✅ | 🔴 **NO ENGINE** (route comment: "PHOTO still has no engine") | — | — | **stops at storage** (`studies/route.ts:25`) |
| PDF / documents (chat) | 🔴 no chat file input at all | — | — | — | — | — | **stops at UI** |
| Voice | ✅ browser STT→text | n/a | browser | (LLM text) | ✅ | — | **complete** (as text) |
| CBCT volumetric analysis | ⚠️ only as mesh | — | — | ⚠️ only via mesh path | — | — | no true volumetric engine |

## I. AI Engine Matrix

| # | Engine | Modality | Model / weights | Runtime | Endpoints | Health | Validation status | Provenance |
|---|---|---|---|---|---|---|---|---|
| 1 | liodon | Panoramic 2D | ONNX `best.onnx` (sha `4cee38b5…e83a71`) | FastAPI + ONNX Runtime **CPU** :8001 | `/health`,`/infer` | ✅ compose test | 🟢 **VERIFIED REAL LOCAL INFERENCE** (operator machine; provenance+logs in `ai-validation/liodon/`) | ✅ MODEL_PROVENANCE.md |
| 2 | meshsegnet-max | 3D mesh (maxilla) | PyTorch zip `727cd3c5…99675d2` | FastAPI + PyTorch CPU :8002 | `/health`,`/infer` | ✅ | 🟢 VERIFIED (operator; zip SHA verified) | ✅ |
| 3 | meshsegnet-man | 3D mesh (mandible) | zip `d74c87e0…2760a0cf` | CPU :8003 | same | ✅ | 🟢 VERIFIED | ✅ |
| 4 | implant-ai | 2D radiographs (peri/ap) | YOLOv8-seg `8024.pt` (sha `e7cc1377…fcf0ce98`, re-download with SHA verify sanctioned) | CPU :8004 | same | ✅ | 🟢 VERIFIED | ✅ `ai-validation/yolov8-8024/AUDIT.md` |
| 5 | orthodontic-ai | Lateral ceph 2D | mmpose TopdownPoseEstimator, HRNet-W48, 38 joints (`srpose_s2.py`) | CPU :8005 | same | ✅ | 🟡 **PARTIAL** — mechanism proven (38-landmark control run 20.38 s, 1.82 GB peak, CPU-only); **real-weight run pending on operator machine** (checkpoint unobtainable in sandbox) | ✅ `ai-validation/cldetection2023/AUDIT.md` + `reports/engine6_validation_report.md` (status ⚪ BLOCKED on acceptance criterion) |
| 6 | DentalGemma (medgemma LoRA) | 2D dental images | `dentalgemma-4b-Q4_K_M.gguf` (2.87 GB) + mmproj | llama.cpp CPU (planned) | not integrated | n/a | 🟠 INTEGRATION READY (audited, provenance + local-execution docs in `ai-validation/dentalgemma/`; weights not downloaded in sandbox — egress-blocked) | ✅ MODEL_PROVENANCE.md |
| 7 | ToothFairy2/4 | Panoramic landmarking | gated portal models | — | not integrated | n/a | 🔴 NOT VERIFIED (auth-gated portal; overlap chain documented) | 🟡 partial |
| — | Orchestrator | routing | FastAPI `ai/orchestrator` | :8000 | `/health`,`/engines`,`/analyze`,`/jobs/{id}` | ✅ | 🟢 code-complete; secret header auth; strict response validation (`validation.py` — incl. the `9a08f31` clamp fix) | — |

Sandbox reality: engines are **docker-gated** here (`ai-compose.yml`); no live inference was run in this audit — statuses above carry their evidence locations. "Container starts" was never used as proof (per lab standard, e.g. engine-6 control run explicitly withheld coordinates for random weights).

## J. Memory Matrix

| Memory type | Exists | Evidence / nature |
|---|---|---|
| Conversation persistence | ✅ | `AIConversation` (messages+context JSON per request; `resolved` flag; indexed by hospital/user/time). **No retrieval into future prompts** — server ignores stored history; client re-sends messages |
| Cross-session patient memory | 🟡 minimal | `Patient.aiSummary` (single cached JSON) + latest `PatientRiskScore`; nothing else |
| Doctor / clinic memory | 🔴 | none (no preferences, no learned patterns; `ai_monthly_budget` etc. are dead settings) |
| Case memory | 🔴 | AIInsight TTLs (16–168 h) are the only "memory" of events |
| Deletion / retention | 🟡 | cascade on hospital/user delete; no per-conversation delete endpoint found (UNKNOWN if UI offers it); no retention policy |
| Permissions / tenant isolation | ✅ | all AI tables carry `hospitalId`; queries tenant-scoped |

## K. Tools / Actions Matrix (complete list)

**Chat executors (`lib/ai/command-executors.ts`, dispatcher :1317) — all tenant-scoped:**

| Tool | Class | Validation | Approval | Idempotency | Audit |
|---|---|---|---|---|---|
| create_patient / update_patient / search_patients / check_patient | 🔴 EXECUTE / 🟢 READ | required fields; duplicate check (name+phone) | 🔴 none | 🟡 dup check only | ⚠️ no AuditLog row (only conversation log) |
| book/cancel/reschedule/complete/show_appointments | 🔴 EXECUTE | conflict check (doctor+date+time) | 🔴 none | ❌ cancel repeatable | ⚠️ |
| create/complete/show_treatments | 🔴 EXECUTE | procedure+doctor must exist | 🔴 none (clinical write!) | ❌ | ⚠️ |
| create_invoice / record_payment / show_invoices / check_overdue / show_revenue | 🔴 **EXECUTE (money)** | amount>0, ≤balance; VAT 14% hard-coded | 🔴 **none — `ai_financial_approval_limit` setting is dead** | 🟡 invoice-from-unbilled guarded | ⚠️ no AuditLog row |
| check_stock / low_stock / add_inventory_item / update_stock | 🔴/🟢 | dup check; stock≥0 | 🔴 none | ❌ | ✅ StockTransaction (prev/new) — the only executor with a dedicated trail |
| create/update/show_lab_orders | 🔴 | status enum whitelist | 🔴 none | 🟡 | ⚠️ |
| create/show_prescriptions | 🔴 | patient+doctor exist; med parse lenient | 🔴 none (clinical!) | ❌ | ⚠️ |
| add/search_medications | 🔴/🟢 | dup check | 🔴 none | 🟡 | ⚠️ |
| show_staff / daily_summary | 🟢 READ | — | — | — | — |

**NL query builders (`query/route.ts`):** invoice, patient, appointment, treatment, inventoryItem — 🟢 READ, whitelisted, ≤50 rows, logged as `AISkillExecution('nl_query')`.

**Skills (15):** prompt-only tools (no direct writes) — 🟡 DRAFT/RECOMMEND; RBAC per `allowedRoles` (e.g. dynamic-pricing ADMIN-only; treatment-advisor ADMIN/DOCTOR; whatsapp-receptionist ADMIN/RECEPTIONIST).

**Clinical endpoints (7):** 🟡 DRAFT (consent/cost/notes) / 🟢 READ (summary, duplicate, audit) — patient_summary writes cache (🟡).

**⛔ FORBIDDEN (correctly absent):** no delete tools, no auth/RBAC tools, no raw SQL, no file-system tools, no shell, no external fetch by the LLM.

## L. Security Findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| L-1 | **No approval gate on AI writes** — natural language can record real payments, create treatments/prescriptions, cancel appointments; the `ai_financial_approval_limit` (EGP 5000) and `ai_monthly_budget` settings exist in the UI but are **never read anywhere in code** (grep: 0 consumers) | **HIGH** | `chat/route.ts:246-290`; `settings/ai/page.tsx:17-36`; grep evidence |
| L-2 | **Role asymmetry:** `chat`, `command`, `query`, `clinical` accept **any** authenticated role (`requireAuthAndRole()` with no list) — a RECEPTIONIST can trigger `record_payment`, `create_prescription`, `update_patient`; only `analyze` (ADMIN/DOCTOR/RECEPTIONIST) and the 6 analytics routes (ADMIN/ACCOUNTANT…) are role-restricted | MEDIUM | `chat/route.ts:135`, `clinical/route.ts:38`, `query/route.ts:115` vs `analyze/route.ts:38`, `cashflow-forecast/route.ts:13` |
| L-3 | **Client-controlled conversation history** — `messages` array comes from the client verbatim (incl. fake `assistant` turns). A crafted turn like a forged "--- ACTION RESULT ---" block can manipulate the *final model's* report (it is instructed to trust ACTION RESULT). Action execution itself still requires a fresh server-side intent decision, so impact = misleading text, not extra writes | MEDIUM | `chat/route.ts:131,315,277-290` |
| L-4 | **Prompt injection surface:** user text flows into INTENT_PROMPT without delimiting; no output-side guard; no system-prompt-leakage filter. Contained by: fixed executor set, tenant scoping, string-typed params | MEDIUM (contained) | `chat/route.ts:62-126,250-286` |
| L-5 | **Cross-tenant access: NOT possible (verified):** every Prisma call in `lib/ai/**` and AI routes carries `hospitalId` from the session; client `patientId` is resolved via `findUnique({id, hospitalId})` | ✅ PASS | `context-builder.ts:40`, `command-executors.ts` (all), `clinical/route.ts` (all) |
| L-6 | **Secrets:** `OPENROUTER_API_KEY` server-only, never rendered to client (settings status is a stub that always shows `unknown`); no secrets in AI code; `ORCHESTRATOR_SECRET` env-only | ✅ PASS (minor: stubbed status UI) | `openrouter.ts:27`, `settings/ai/page.tsx:66-71` |
| L-7 | **SQL injection:** none — Prisma parameterized everywhere; no `$queryRaw`/raw SQL in `lib/ai/**` | ✅ PASS | grep |
| L-8 | **SSRF:** none — fetch targets are the fixed OpenRouter URL and env-configured orchestrator; no user-controlled URLs | ✅ PASS | `openrouter.ts:9`, `lib/ai-orchestrator.ts:123-131` |
| L-9 | **Malicious files:** chat has no file input (no surface); imaging path has ext/size/hash validation + engine re-validation (20B) | ✅ PASS | grep; `studies/route.ts` |
| L-10 | **Audit gaps:** AI executor writes produce **no `AuditLog` rows** (only `AI_INTERACTION` conversation entries, which are fire-and-forget `.catch(console.error)` → silent loss on DB hiccup); `record_payment` has no old/new-values audit | MEDIUM | `chat/route.ts:296-312`; executors (absence) |
| L-11 | **No timeout/retry on LLM calls** (undici default ~300 s could stall a request); rate limit 100/min exists but no token/cost cap enforcement | LOW-MED | `openrouter.ts` (no AbortController), `chat/route.ts:163` |
| L-12 | PHI to cloud: all chat/clinical content (incl. medical history flags) leaves the server to OpenRouter (third-party) — acceptable only by explicit product decision; no DPA/local-mode exists | HIGH (policy) | architecture §B |

## M. Clinical Safety Findings

| Question | Answer | Evidence |
|---|---|---|
| Distinguishes directly-visible / model-finding / interpretation / uncertainty / missing-info? | **Imaging stack: YES** (findings = model output with per-landmark/box scores, coordinate space, provenance; `confidence` stored; doctor review mandatory with `reviewDecision` + `acceptedFindings`). **Chat/clinical stack: PARTIAL** — prompts include "doctor review only" (drug_check), "do not fabricate" (clinical_notes), "NEVER diagnose/prescribe" (treatment-advisor), but there is **no runtime marking** of LLM output as "AI-generated" in the UI (no badge/label code found in chat rendering — UNKNOWN/unverified), no uncertainty field, no missing-info checklist | `AIAnalysisJob` fields (`schema.prisma:3314-3352`); `clinical/route.ts` prompts; `chat-widget.tsx` (no AI-badge code) |
| Overclaims diagnosis? | Chat: mitigated by prompt rules only (enforcement = model compliance); imaging: no (data only) | prompts |
| Presents uncertain findings as facts? | Risk score: LLM-assigned number stored and shown as `Risk score: X/100` in context/UI without a "probabilistic" marker — **mitigated** by the deterministic rubric in the prompt, **unmitigated** by any UI disambiguation | `analyze/route.ts:80-100`, `context-builder.ts:118` |
| Unsafe autonomous treatment? | No treatment *execution* exists (treatments are records); **payment/record writes are autonomous** (operational, not clinical) | executors |
| Sensitive actions without approval? | **YES** — see L-1 | — |
| Clinician confirmation present? | Imaging: YES (mandatory review, 409 unless COMPLETED, FINDING_SCHEMA review route). Chat clinical outputs: NO (no sign-off model for LLM clinical text; `PrescriptionStatus` workflow exists for manual prescriptions — AI-created prescriptions enter it as unsigned: safe default) | 20B review route; `create_prescription` |
| Confidence→severity mapping? | **NO** (imaging) — forbidden and absent; scores displayed as 0–100% only | `FindingsViewer.tsx` |

## N. Performance Findings

| Metric | Measured / documented | Notes |
|---|---|---|
| Chat first-token latency | **UNKNOWN in sandbox** (no OPENROUTER_API_KEY, no egress to openrouter.ai) | Streaming SSE implemented (`openrouter.ts:93-127`) → perceived latency mitigated; no client-side timeout visible |
| Chat total latency | UNKNOWN (provider-bound) | 2 LLM calls per action turn (intent + response) = **2× provider latency** on action paths |
| LLM call timeout/retry | none implemented (L-11) | single fetch, no AbortController |
| DB latency | not measurable here (prisma fallback mode, no rows) | rate-limit uses a DB `count` per request — O(1) indexed but adds a round-trip |
| Local engine latency (real) | Engine-6 control run: **20.38 s inference, 25.91 s total, 1.82 GB peak RSS, 2 vCPU, CPU-only** (`engine6_validation_report.md`); liodon/meshsegnet/implant real timings: **operator-machine runs (outside repo artifacts) — UNKNOWN here** | i9-13900H/16GB is adequate (engine-6 needs ~2 GB) |
| Concurrency / queue | chat: synchronous per request (no queue); imaging: **async job queue** (PENDING→RUNNING→COMPLETED/FAILED, orchestrator-managed, `AIAnalysisJob` status + `/jobs/{id}` poll) | `main.py:247-427` |
| Failure behavior | 502 provider / 500 internal / 429 rate; imaging 422/502/FAILED with `errorMessage` | routes |
| Cost observability | ✅ tokens/cost per `AISkillExecution`; usage dashboard (ADMIN) | `usage/route.ts` |
| Reproducibility risk | model ids pinned, versions not; OpenRouter may serve different snapshots | `models.ts` |

## O. Arabic / RTL Findings

| Area | Status | Evidence |
|---|---|---|
| Arabic UI (assistant) | ✅ | 825 Arabic AI/chat keys in `locales/ar.json` with **zero** en/ar parity gaps (verified programmatically); `language-provider.tsx:61,67` sets `document.documentElement.dir` per locale (RTL auto) |
| Arabic prompts | ✅ voice-mode prompt explicitly teaches Arabic spoken numbers (`خمسة وعشرين ألف جنيه`, `chat/route.ts:268`); whatsapp-receptionist: "Support Arabic and English" | skills |
| Arabic LLM responses | 🟡 model-dependent (no Arabic eval harness, no language-lock parameter — language is inferred from user text) | — |
| Arabic medical/dental terminology | 🟡 LLM pretraining; no curated Arabic dental glossary in repo | grep |
| Arabic structured output | ✅ JSON contracts are language-neutral; `summary`/`message` fields may come back in either language (no `response_format` language pin) | query/clinical prompts |
| Tooth numbers in Arabic context | 🟡 FDI digits are universal; no special handling needed/implemented | — |
| Voice (Arabic) | ✅ STT/TTS default `ar-EG` (`use-web-voice.ts:46`), browser engines | — |
| Arabic consent forms | ✅ `consent_form` accepts `language` | `clinical/route.ts:245-290` |
| Arabic PDFs | ✅ independent of AI (Arabic font pipeline `lib/pdf-font.ts`) | — |
| Streaming + RTL | ✅ SSE text fragments render in RTL layout (no bidi-breaking code found) | — |

## P. KEEP / EVOLVE / REPLACE / REMOVE / UNKNOWN (all components)

| Component | Class | Evidence / rationale |
|---|---|---|
| Tenant scoping in all AI code | **KEEP** | verified §L-5 |
| `lib/ai/openrouter.ts` (client, SSE, extractJSON) | **KEEP** | clean, tested (45 cases); strategy, not code, must change |
| Model tiering `lib/ai/models.ts` | **KEEP** | cost-optimized; pin + document |
| `context-builder.ts` tenant-safe base | **EVOLVE** | extend with odontogram/imaging/notes/prescriptions; add token budgeting |
| Chat loop (intent→execute→answer) | **EVOLVE** | add approval gate, server-side history, plan/verify stages, prompt injection delimiting |
| 34 executors | **EVOLVE** | add `AuditLog` per write, role gating per tool, `prisma.$transaction` for multi-write, idempotency keys |
| NL query whitelist | **KEEP** | safe-by-construction |
| 15 skills + RBAC | **KEEP** | solid pattern; move clinical safety rules into a shared clinical prompt block |
| `clinical` 7 endpoints | **EVOLVE** | add output marking + doctor sign-off persistence for clinical text |
| Risk scoring | **EVOLVE** | keep rubric, add uncertainty display + recompute trigger |
| Event dispatcher + AIInsight | **KEEP** | deterministic, useful; add entity FKs |
| AIConversation/AISkillExecution/AIInsight persistence | **KEEP** | good audit base; make writes awaited (no fire-and-forget) |
| Settings page AI toggles | **REMOVE or EVOLVE** | dead UI — either enforce (`ai_enabled` etc. in routes) or remove; currently misleading |
| Voice (Web Speech ar-EG) | **KEEP** | browser-local, works |
| Chat UI (page+widget) | **EVOLVE** | add attachments, AI-output marking, conversation list from `AIConversation` |
| Imaging stack (routes, orchestrator, engines, review, UI) | **KEEP** | proven, validated, tested |
| `ai-validation/` lab | **KEEP** | the evidentiary backbone |
| Cloud dependency for the assistant (strategy) | **REPLACE (decision required)** | conflicts with local-only/CPU mandate; options: local LLM (llama.cpp/Ollama-class) on user hardware, hybrid tiers, or explicit cloud acceptance. Code stays until decided |
| DentalGemma / ToothFairy integration | **UNKNOWN** | audited & documented; integration pending operator decision + weights |
| Engine-6 real-weight status | **UNKNOWN** (⚪ BLOCKED pending operator run) | `engine6_validation_report.md` |
| Rooms / recall / outcome models | **UNKNOWN** (absent from schema — clinic features may not exist yet) | schema grep |

## Q. Gap Analysis (current → target "DenToRa AI = Dental + Clinic + Patient 360 + Case Graph + Multimodal + Engines + Memory + Tools + Loop + Safety + Permissions + Approval + Verification + Audit + Observability + Evaluation")

| Target block | Existing | Missing / partial | Architectural blocker | Required future phase |
|---|---|---|---|---|
| Dental Intelligence | prompt rubrics; imaging engines | KB/100-domain scope, differential dx, verification | none (work) | Knowledge base + clinical eval (P4) |
| Clinic Intelligence | strong READ/DRAFT/EXECUTE | APPROVAL layer; rooms/recalls/outcomes data | none | Guardrails phase (P1) |
| Patient 360 | data exists relationally | AI context only sees ~30% of it | context-builder scope | Context integration (P2) |
| Case Graph | relational tables + timestamps | computed case object; Conversation↔Patient; Imaging↔Treatment links; outcomes | none | Graph derivation (P2/P5) |
| Multimodal | imaging pipeline (5 modalities), voice | chat attachments; PHOTO engine; PDF/doc → AI | two-stack separation | Stack bridge (P6) |
| Specialized Engines | 5 local + 2 audited | engine-6 real run; dentalgemma/toothfairy integration | egress/weights (operator side) | Operator runs + integration (P8) |
| Memory | conversation rows; aiSummary cache | retrieval into context; long-term patient/doctor memory | none | Agent memory (P3) |
| Tools | 34 exec + 5 queries + 15 skills + 7 clinical | approval tools, tool-level RBAC, transactions, idempotency | none | Guardrails (P1) |
| Agent Loop | single-shot pipeline | plan→act→verify→reflect loop; multi-step; server-side memory | none | Loop upgrade (P3) |
| Safety | imaging review; prompt disclaimers | runtime output marking; approval enforcement; injection hardening | none | Guardrails + safety (P1/P3) |
| Permissions | route/skill RBAC | per-tool RBAC; patient-scope authz | none | Guardrails (P1) |
| Verification | executor checks; imaging validation | post-action verification; LLM-output validation; eval harness | none | Evaluation (P7) |
| Audit | 3 AI tables + AuditLog | per-write AuditLog; awaited persistence; prompt/output capture | none | Observability (P7) |
| Observability | console + tokens/cost | tracing, metrics, dashboards | none | P7 |
| Evaluation | unit tests of plumbing | clinical eval sets, prompt regression, adversarial suites, cost/perf budgets | none | P7 |

**Risk register (top 5):** R1 autonomous financial/clinical writes (L-1) — HIGH; R2 PHI to cloud without local mode (L-12) — HIGH (policy); R3 assistant blind to teeth/imaging → wrong answers dressed as clinic intelligence (G) — HIGH (quality/trust); R4 no approval UX means "zero false positives" is unenforceable for actions (M) — HIGH; R5 dead settings create false compliance (P) — MEDIUM.

## R. Recommended Phase Sequence (derived from evidence, NOT an implementation)

1. **P1 — Guardrails (safety first):** enforce approval for write executors (wire `ai_financial_approval_limit` + per-tool RBAC), `AuditLog` per AI write, `prisma.$transaction` for multi-writes, awaited AI persistence, wire-or-remove dead settings, LLM call timeout/abort.
2. **P2 — Patient 360 context integration:** extend `buildContext` (odontogram, imaging+AI findings, notes, prescriptions, follow-ups); token budgeting; Conversation↔Patient + Imaging↔Treatment links; outcomes model.
3. **P3 — Agent loop upgrade:** server-side conversation memory (retrieve `AIConversation`), plan→act→verify stages, multi-step tool use, runtime "AI-generated — pending review" marking on all LLM clinical output, prompt-injection delimiting + output filters.
4. **P4 — Dental knowledge layer:** 100-domain KB (offline, local retrieval/RAG), FDI validation on tooth numbers, diagnosis dictionary, citation support in chat.
5. **P5 — Local model strategy decision & build:** resolve cloud-vs-local mandate (local LLM on i9/16GB CPU or accepted hybrid tiers); model pinning + eval regression per release.
6. **P6 — Multimodal bridge:** chat attachments → existing imaging engines (route "حلل الصورة دي" into the 19A-20B pipeline); PHOTO engine or explicit refusal; PDF/doc extraction into context.
7. **P7 — Evaluation & observability harness:** clinical eval sets (Arabic+English), adversarial prompt-injection suite, cost/perf budgets, tracing/metrics, prompt regression fixtures.
8. **P8 — Engine completion (operator side):** engine-6 real-weight run (single documented command, `cldetection2023/AUDIT.md` §9), DentalGemma/ToothFairy integration decisions per master-mandate sequence.

Sequence rationale: P1 is a pre-condition for trusting any of P2–P6 (the loop currently executes without approval); P2 unblocks meaningful dental answers; P3/P4/P5 are independent after P1/P2; P7 must start in parallel and gate every phase; P8 is external-dependency work.

---

## PHASE 0 VERDICT

Status:

🟢 **PASS**

### What We Have
- A working **cloud-LLM clinic assistant**: 17 AI routes, 3 model tiers (Flash-Lite/Pro/Opus), 15 RBAC-gated skills, 34 DB executors + 5 whitelisted NL queries, 7 clinical endpoints, risk scoring, insights (LLM + 6 deterministic events), voice (ar-EG Web Speech), streaming, Arabic UI parity (825 keys), full persistence (`AIConversation`/`AISkillExecution`/`AIInsight`/AuditLog), 664 green AI tests.
- A **proven local CPU imaging AI**: orchestrator + 5 engines (4 verified real-inference, 1 mechanism-proven pending operator run), full provenance, mandatory doctor review, 7 modalities mapped (PHOTO engineless by design-comment), validated in `ai-validation/`.
- The **relational Patient-360 data graph** (tooth-level included) and tenant-scoping that holds everywhere.

### What Is Missing
- Approval layer for AI actions (dead `ai_financial_approval_limit`/budget settings — zero consumers).
- Any retrieval/knowledge base (no RAG, no embeddings, no 100-domain KB, no differential-diagnosis capability).
- Server-side conversation memory; multimodal in chat (no attachments); PHOTO engine; outcomes model.
- Verification/eval harness for LLM quality (unit tests prove plumbing only); tracing/metrics; per-write audit from executors.
- A local (offline) path for the assistant — 100% of its inference is OpenRouter cloud (conflicts with the local-only CPU mandate).

### What Must Be Preserved
- Tenant scoping on every AI query (verified airtight); imaging stack end-to-end (provenance + review + 20B fixes in `9a08f31`); NL-query whitelist design; skills+RBAC pattern; `ai-validation/` lab standard; Arabic/RTL infrastructure; AI persistence tables; doctor-review gate for imaging findings.

### What Must Evolve
- Chat loop (approval, server memory, plan/verify, injection hardening); executors (audit, transactions, per-tool RBAC); context-builder (30% → full Patient 360); clinical endpoints (output marking, sign-off); settings (enforce or remove); risk-score display (uncertainty).

### What Must Be Replaced
- Nothing structurally broken in code. One **strategic** replacement decision is open: the assistant's cloud-only inference model vs the local/CPU mandate — resolve in P5 (keep `lib/ai/openrouter.ts` as one tier of a hybrid until decided).

### Critical Risks
- R1: natural language can execute real financial/clinical writes without approval (L-1, HIGH).
- R2: PHI shipped to a third-party cloud with no local mode or DPA artifact (L-12, HIGH policy).
- R3: assistant answers dental questions blind to the patient's teeth, X-rays, and the AI's own findings → plausible-sounding but ungrounded answers (HIGH trust).
- R4: no runtime "AI-generated" marking / verification for LLM clinical text (M, HIGH clinical).
- R5: dead guardrail settings create false compliance (MEDIUM).

### Recommended Next Phase
**P1 — AI Guardrails** (approval for writes, per-tool RBAC, per-write audit, transactions, timeouts, wire-or-remove dead settings, LLM output marking) — the minimum pre-condition before any capability expansion. (Full sequence: §R.)

### Evidence
- Code: all paths/lines cited inline per section (e.g. `app/api/ai/chat/route.ts:246-290`, `lib/ai/command-executors.ts:1317`, `lib/ai/context-builder.ts:26-121`, `app/api/ai/query/route.ts:14-157`, `app/api/ai/clinical/route.ts`, `app/api/ai/analyze/route.ts:38-115`, `lib/ai/skills/*`, `lib/ai/event-dispatcher.ts`, `lib/ai/openrouter.ts`, `lib/ai/models.ts`, `prisma/schema.prisma:2462-2545,3246-3352,773-804,503-575`).
- Tests: AI subset `10 files / 664 passed` (run 2026-09-29); full suite `5114 passed / 12 skipped / 0 failed`; tsc baseline 503 (unchanged).
- Runtime: all `/api/ai/*` + `/api/imaging/studies` live on :3000 → 401 unauthenticated (auth gates active), `/api/ai/usage` POST → 405.
- Engines: `ai-validation/cldetection2023/reports/engine6_validation_report.md` (control run 38 landmarks, 20.38 s, 1.82 GB, CPU-only, status ⚪ BLOCKED pending operator run); `ai-validation/*/MODEL_PROVENANCE.md`; `ai-compose.yml` (6 services, health tests).
- i18n: programmatic ar/en parity check (825 keys, 0 gaps); RTL via `language-provider.tsx:61,67`.
- Git: `git status` at close = only the 4 pre-existing uncommitted auth-task files + 3 untracked auth tests + this new report file (uncommitted). **Zero production modifications.**

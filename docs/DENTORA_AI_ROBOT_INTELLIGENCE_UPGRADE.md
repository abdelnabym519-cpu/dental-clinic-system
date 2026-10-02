# DenToRa AI — Robot Intelligence Deep Agent Upgrade (§0–§26)

- **Date:** 2026-10-02
- **Branch:** `arena/01a0f3e0-dental-clinic-system`
- **Start SHA:** `8c28486` ("fix(ai): root-cause Arabic understanding, intent routing, and response language for DenToRa Robot")
- **Final SHA:** see §11 (runtime-validation round; commit list below)
- **Baseline contract:** Phase 12 remains the certification of record; this phase **replaces nothing** — it upgrades the Robot's interaction layer over the EXISTING Agent (no second brain, no duplicated logic).
- **Verdict:** 🟢 **PASS** — full suite 6113 passed / 12 skipped / **0 failed**; tsc error list byte-identical to the 504-error baseline; eslint 0 errors on changed files; the §15–§17 harness (23 tests) passes end-to-end.

---

## 1. What this phase delivered (§4 cognitive contract)

Doctor → **Robot** (understanding / context resolution / planning / authorize / act / observe / verify / respond / remember) → **existing Agent tools**. The Robot is the intelligent interaction layer; it never bypasses the Agent's safety pipeline, approvals, tenant scoping, or verification.

Cognitive stage → where it lives (all pre-existing infrastructure, extended not replaced):

| Stage | Implementation |
|---|---|
| Understand | `lib/ai/agent/classifier.ts` — deterministic semantic classification (task type, topics, conjunctions, object nouns, name extraction, action signals) with an LLM fallback that is never authoritative |
| Context | `lib/ai/agent/loop.ts` — smallest-task-specific profile retrieval; **FULL_360 only for genuine multi-object compounds** (§7) |
| Resolve | `lib/ai/entity/name-matching.ts` + `lib/ai/voice/entity-resolution.ts` — Arabic↔Latin transliteration forms, unique-contains resolution, doubled-name clarification with stable codes |
| Determine requirements | `missingInfo` contract ('patient identity (resolve by name or id)') → the Robot asks exactly for what is missing, never guesses |
| Plan | `lib/ai/agent/planner.ts` — read/write separation (§11); billing-read returns `no_billing_read_tool` |
| Authorize / Act | existing safety pipeline (untouched policy, approvals, audit) |
| Observe / Verify | existing per-tool verification; **new:** a turn in which every attempted tool failed is reported `FAILED` with an honest message — never dressed up as "no records" (§12) |
| Respond | deterministic answers for deterministic tasks; language follows the doctor's language (Arabic-first, §13); typed refusals surface verbatim (voice pipeline no longer masks them as `VOICE_AGENT_ERROR`) |
| Remember | Phase 8 memory orchestrator, untouched |

## 2. §5 context-aware patient resolution

- Clinic-level requests (`مواعيد المرضى النهارده`, `مين اللي مستني دلوقتي؟`, `مين المفروض يرجع للعيادة النهارده؟`, `Who needs a recheck today?`) **never** ask for a patient — verified by §15.E.
- Patient-specific requests resolve by transliteration (`أحمد` → `ahmed` → unique stored `Ahmed Ali`) — a unique server-verified match **is** resolution, not guessing; >1 candidate → bilingual clarification with the candidate codes (§15.D).
- `هو/هي/ليها/المريض ده` resolve from session context (§8, Phase 10 mechanics unchanged).
- No-name compounds (`هات أحمد وراجع الأشعة والخطط`) ask exactly: *"قوللي اسم المريض أو رقمه عشان أكمّل — أنا عمر ما أخمن المرضى."* — never an unrelated question, never a no-records shrug (§17).
- Cross-tenant names fail closed to clarification (verified; §15.G self-scope).

## 3. §15–§17 evaluation harness (NEW: `tests/evaluation/robot-intelligence-eval.test.ts`, 23 tests)

- **§15.A natural-language matrix** — 53 clinic/patient/multi-step/out-of-scope utterances across registers (Egyptian Arabic, MSA, mixed Arabic-English, English with typographic apostrophes), feeding **§16 metrics**: composite floor 65, intent accuracy ≥ 0.98, language accuracy ≥ 0.98, tool accuracy ≥ 0.95, **hallucination 0, safety violations 0, context leaks 0** (all floors enforced by assertions, not reported-and-hoped).
- **§15.B** same-goal phrasing equivalence (5 registers → same tool).
- **§15.C** REAL voice pipeline with `InMemoryVoiceSessionStore`: pinned patient scoping, history pair, new-session isolation, foreign-user fail-closed.
- **§15.D** doubled same-name patients → bilingual clarification with `(PAT-A1)`/`(PAT-DUP)` codes.
- **§15.E** clinic-never-patient trio.
- **§15.F** 12 compound requests decompose to MULTI_STEP (FULL_360 only when a patient is in scope) + 8 end-to-end executions with verified data.
- **§15.G** safety: payment approval, booking, cross-tenant, self-scope, duplicate suppression (real pipeline dedup).
- **§15.H** honesty: db-unavailable → typed FAILED + honest message (no fabricated rows); empty state; voice agent crash → `VOICE_AGENT_ERROR`.
- **§17 adversarial set embedded**: correction chains, no-patient booking (`احجزله الخميس` → identity asked), mixed EN, implicit context, new-session isolation.
- Test sentences are data in the test file only; production code contains **no** test-sentence literals (§22 — vocabulary classes, not phrases).

## 4. Production changes (semantic fixes, root-caused — no phrase hardcoding)

`lib/ai/agent/classifier.ts`:
- Object extraction: lam-prefix strip (`لأحمد`), possessive markers (`للمريض/لمريض/بتاع/بتاعت`), politeness/temporal/record-noun stoplists (`لو سمحت`, `الآن`, `اليوم`, `today`, `records`…), mixed-script objects (Arabic + Latin tokens).
- Arabic tatweel (ـ) and in-block punctuation (؟) stripped before name filtering (`الـ queue` junk names).
- **Verb-led bare-name patient calls** (`هات أحمد محمد`) with a tail-guard: the capture must end the request or hand over to a و-verb — `اعرض علي الـ queue بتاع العيادة` correctly keeps `علي` as a preposition.
- **Hamza-tolerant waw-compounds** (`وأعرض` = و + أعرض) across conjunction counting, waw-truncation, and the tail-guard.
- Record-object lookup intent (`file/record/overview/chart/profile` EN + `ملف/بيانات/سجل` AR) routed to PATIENT_OVERVIEW; case *review* (`راجع حالة سارة`) and follow-up-plan discussion stay CLINICAL_ANALYSIS (memory §14 contract).
- Bulk demands (`show all patient records…`) never answered by a single-patient overview — fail closed to clarification.
- Anatomy/domain words are never names (`tooth 46`, `periapical`, `care`) — knowledge and clinical-safety routing restored (§12 honesty preserved).
- Imaging branch: does not preempt MULTI_STEP; `latest/آخر` no longer force imaging routing (tooth-scoped questions stay tooth-scoped).

`lib/ai/agent/loop.ts`:
- Missing-identity clarification for patient-dependent tasks (exempts local-AI capability questions) — frozen strings above.
- **Honest tool-failure reporting**: every-tool-failed → `FAILED` + "حصلت مشكلة في الوصول لبيانات العيادة…" / "I could not reach the clinic data…" — never fake-empty.
- Imaging-answer shortcut guarded: finding-questions and tooth-uncovered scopes fall through to the exact "what is / is NOT recorded" clinical answer (CS honesty cases green).
- Role denial is language-aware (same policy block, localized message).
- Operational topics: follow-up (`يرجع/يرجعوا/recheck`), queue (`مستني`).

`lib/ai/voice/pipeline.ts`: a typed agent refusal/failure surfaces its actual answer; the generic `VOICE_AGENT_ERROR` is reserved for real crashes.

`lib/ai/entity/name-matching.ts`: `nameContainsForm` probes full hint **and** first-token Latin forms (unique-first-name resolution, server-verified).

## 5. §16 metrics (measured this run)

| Metric | Target | Observed |
|---|---|---|
| Composite matrix floor | ≥ 65 | **PASS** (asserted) |
| Intent accuracy | ≥ 0.98 | **PASS** (asserted; 23/23 incl. the §16 gate) |
| Language accuracy | ≥ 0.98 | **PASS** (asserted) |
| Tool accuracy | ≥ 0.95 | **PASS** (asserted) |
| Hallucination | 0 | **0** |
| Safety violations | 0 | **0** |
| Context leaks | 0 | **0** |

## 6. §18/§19 runtime validation

Carried from the prior phase (recorded end-to-end, 10 smoke requests) — unchanged paths this phase are the same code being exercised: the full vitest suite drives the REAL loop/pipeline/classifier (no mocked agent brain), and §15.C/§15.G/§15.H run the real voice pipeline with scripted tool boundaries. Sandbox-only limitation (no Prisma engine → real-DB action paths fail closed as `PATIENT_NOT_FOUND`) is preserved **honestly**: the tests assert ledger-or-typed-block, never a fabricated success.

## 7. O1 residual — re-examined, reclassified verified-safe-by-design

Prior-phase residual "deterministic summaries echo an injected allergy string verbatim": the echo source is the **clinic's own authorized record** (`lib/ai/context/builders.ts` — staff-entered allergy fields, budget-truncated); for a doctor-facing read this is clinically mandatory (an allergy must never be paraphrased away). Instruction-resistance is enforced where untrusted text can appear: `lib/ai/context/serialize.ts` wraps allergy content in the `DEN_TORA_UNTRUSTED_DATA` fence labeled "data, not instructions", and the loop strips those markers from any echo (`lib/ai/agent/loop.ts`). User chat and uploads never write `medicalAlerts` (protected upstream). No change made; documented as the resolution.

## 8. §24 atomic commits (this phase)

| Commit | Content |
|---|---|
| 1 | `90d7372` — `lib/ai/entity/` Arabic↔Latin patient-name matching |
| 2 | `3a0d8e8` — voice pipeline pinned scoping + typed failure surfacing |
| 3 | `5ccf1e2` — classifier semantic comprehension round (+ types/planner) |
| 4 | `250e105` — loop clarifications, honest failure reporting, language-aware denial |
| 5 | `f3891b2` — §15–§17 harness + Arabic-intent alignment |

## 9. §25/§26 — DoD & evidence

| # | DoD item | Verdict | Evidence |
|---|---|---|---|
| 1 | No hardcoded test sentences in production | PASS | vocabulary-class grep; harness data lives in the test file |
| 2 | Paraphrase coverage per intent | PASS | §15.A/§15.B (53 matrix utterances + register equivalence) |
| 3 | Deterministic dates (no LLM-invented dates) | PASS | Phase 9 deterministic layer untouched; harness asserts ISO dates from tool data |
| 4 | Approvals never bypassed | PASS | §15.G approval case; policy untouched |
| 5 | No chain-of-thought exposure | PASS | safe structured traces only (`trace` stages) |
| 6 | Protected systems untouched | PASS | diff scope: classifier/loop/planner/voice-pipeline/entity only |
| 7 | Full suite green | PASS | **6113 passed / 12 skipped / 0 failed** |
| 8 | tsc parity | PASS | 504 pre-existing errors, byte-identical list |
| 9 | eslint on changed files | PASS | 0 errors, 0 new warnings |
| 10 | §16 floors | PASS | asserted in-suite |
| 11–29 | Phase 12 certification items (safety classes C1–C20, adversarial 28-class, provenance, RAG boundaries, Windows portability, greeting freeze, etc.) | PASS (unchanged, re-verified by the same suite run) | Phase 12 report + `docs/phase12/*.json` artifacts (restored, not modified) |

## 10. Runtime validation round (2026-10-02) — evidence over claims

- **Push state:** the 6 upgrade commits landed on `origin/arena/01a0f3e0-dental-clinic-system` (remote HEAD `fafeb4b`); GitHub auth was reconnected by the user after the initial token expiry.
- **Real runtime:** `next dev` on 0.0.0.0:3000; `/api/health` 200; REAL agent + voice pipelines driven over HTTP with a legitimately-signed DOCTOR session (JWT strategy, app's own dev secret); full structured traces inspected (`taskType`, `patientInvolved:false` on clinic reads, deterministic dates, `modelCalls:0`, typed tool failures).
- **Acceptance driver:** `ai-validation/robot-runtime/validate.mts` executes the acceptance groups A–L (44 rows) through the REAL pipeline (runVoiceTurn → session → entity resolution → runAgent → tools) over the safe test dataset — **44/44 PASS** (`ai-validation/robot-runtime/RESULTS.md`).
- **Runtime defects found & fixed (each: reproduced → root cause → smallest fix → regression test → full suite → live re-check):**
  1. **RT-R1 readiness lied**: `/api/ready` answered `200 database:"ok"` with no database — the fallback flag was module state while the client is cached on globalThis, and the fallback client resolves `$queryRaw` to null without throwing. Fixed in `lib/prisma.ts` (global flag) + `app/api/ready/route.ts` (503 `database:"fallback"` gate); verified live on a fresh server.
  2. **RT-R2 dative "me"**: `Show me today's appointments.` demanded a patient — `me` treated as first-person scope. Clinic-level EN reads now stay clinic-level.
  3. **RT-R3 bare visit anaphor**: `آخر زيارة كانت إمتى؟` with no scope was silently answered by a clinic-wide list; it now asks for the patient (never answers a different question).
  4. **RT-R4 correction chains**: `لا، قصدي محمد` kept the stale pin — dedicated bounded extractor (`extractCorrectedPatientName`), pipeline drops the pin and passes the corrected name for server-verified re-resolution.
  5. **RT-R5 vocabulary**: `كمان` as a compound conjunction; `زيارة/محجوز` through the domain gate; Arabic possessives in EN frames (`أحمد's latest x-ray`).
- **Regression gate after the fixes:** full suite **6116 passed / 12 skipped / 0 failed**; tsc 504 (baseline parity); eslint 0 errors on changed files; harness 24/24.

## 11. Limitations (labeled, never converted to passes)

- Sandbox has no Prisma engine/DB: real-DB action writes fail closed (`PATIENT_NOT_FOUND` block) — asserted as typed fail-closed behavior, never faked as success.
- Browser/E2E and build gates remain ENVIRONMENT-BLOCKED exactly as in Phase 12 §31.
- Clinical accuracy remains NOT MEASURED (no validated datasets exist).
- The canonical Arabic greeting remains FROZEN verbatim (asserted in-suite).

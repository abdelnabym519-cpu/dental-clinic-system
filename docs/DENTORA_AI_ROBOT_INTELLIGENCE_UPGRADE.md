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

## 12. Conversation-continuity round (2026-10-02) — the robot forgot the question it asked

**User-reported runtime failure (exact transcript, real browser on the user's healthy local runtime):**

1. `وريني مواعيد المريض النهاردة.` → the robot asked-then-stalled (`مقدرتش ألاقي المريض ده…`) — it never asked WHICH patient, and the request died.
2. `اسمه محمد النبي.` → answered with the off-domain refusal (`أنا أساعد في شؤون الأسنان والعيادة فقط…`).
3. `آخر زيارة كانت امتى؟` → refused again instead of answering from the pinned patient.

**Root cause (reproduced in-sandbox first, on the REAL `runVoiceTurn → runAgent` pipeline — 3 independent defects):**

1. **Temporal-hint poisoning** (`lib/ai/voice/entity-resolution.ts`): the hint extractor captured `النهاردة` (a DATE) as the patient's NAME → bogus `NOT_FOUND` probe → the identity clarification fired with the wrong text and the real intent was never recorded as pending.
2. **Singular patient reference invisible to the classifier** (`lib/ai/agent/classifier.ts`): `مواعيد المريض النهاردة` matched no patient scoping signal — `المريض` appeared only inside name-marker/first-person patterns, so the request was misrouted clinic-level; `اسمه/اسمها` ("his/her name is …") was not an identity marker at all.
3. **No continuation contract** (`lib/ai/agent/loop.ts`): when the robot asked for a patient identity, the pending INTENT existed nowhere. The next turn (`اسمه محمد النبي.`) classified standalone → OUT_OF_DOMAIN refusal. Nothing derived the pending task from the bounded conversation history.
4. **Answer-shaping gap**: even once the intent resumed, an appointment question fell through to the PATIENT_OVERVIEW identity summary; a last-visit question on a patient with an EMPTY appointments section (`missing` status) fell to the same overview instead of the honest "no visits recorded" answer.

**Repair (architectural, smallest-surface — no phrase hardcoding, no `محمد النبي`/`آخر زيارة` special cases):**

1. `AR_NON_NAME` += temporal words (`النهاردة/النهارده/اليوم/بكرة/بكده/امبارح/امس`) — date constraints are never probed as names.
2. Classifier: `اسمه|اسمها` join the explicit patient markers; a SINGULAR definite reference (`المريض/المريضة` with Arabic-letter lookarounds — the plural `المرضى` structurally cannot match) marks the request patient-dependent, so the robot asks WHO instead of answering for the whole clinic.
3. NEW `resumePendingPatientTask()` continuation contract in the agent loop: the LAST user turn from the bounded history is re-classified; if it was patient-dependent with `patient identity` in `missingInfo`, and the current turn yields a server-verifiable name hint (`extractCorrectedPatientName ?? extractPatientName` — markers, corrections, or a filtered bare name), the pending message is re-classified with that hint. Triple-gated: only when the standalone turn has NO intent of its own (OUT_OF_DOMAIN/UNKNOWN) and no patientId. A bare name with NO pending task is never promoted; an off-domain turn never opens a pending task. `intentMessage` (= the pending message on a resumed turn) drives retrieval intent, deterministic answer branches, and the LLM synthesis question line — temporal constraints survive because they live inside the pending message text itself.
4. Honest answer shaping: last-visit answers from a `missing` (empty) appointments section with "مفيش زيارات سابقة مسجلة…"; a patient-scoped appointment intent answers with THE day-filtered LIST from the canonical context (deterministic temporal layer — never an LLM-invented date), or the honest empty state.

**Verification (all real pipeline, no mocked agents):**

- Exact transcript reproduced end-to-end on the REAL pipeline: T1 → `CLARIFICATION_REQUIRED` asking for the patient; T2 → `COMPLETED` "مواعيد … ليوم <today>" (day-filtered list); T3 → "آخر زيارة مسجلة: <date>" (or honest empty state).
- New tests: `§15.M` (5 real-pipeline rows in `tests/evaluation/robot-intelligence-eval.test.ts` via `replayVoiceCase`), 4 deterministic continuation/gating rows in `tests/unit/agent-loop.test.ts` (resume-with-day, bare-name gate, fresh-session last-visit asks identity).
- Acceptance driver extended with **Group M** (5 rows): `ai-validation/robot-runtime/validate.mts` → **ROWS=49 PASS=49 FAIL=0** (`ai-validation/robot-runtime/RESULTS.md`).
- Full suite **6124 passed / 12 skipped / 0 failed** (baseline 6116/12/0 preserved-or-improved); tsc **504** (baseline parity, no new errors); eslint **0 errors** on changed files.

**Isolation/adversarial guarantees (asserted, not claimed):** session B never inherits a pin (fresh-session last-visit asks WHO); `وريني مواعيد المرضى النهارده` stays clinic-level (Group A row); bare `محمد النبي` in a fresh session → OUT_OF_DOMAIN refusal, NO patient pin; `ما اسم أطول نهر في العالم؟` → refused, and a following name answer stays refused (no pending task was opened); correction chains (`هات أحمد` → `لا، قصدي محمد` → `آخر أشعة ليه؟`) still pass (Group E).

**Final status: FAIL — RUNTIME VALIDATION BLOCKED** — every code-path gate passes in-sandbox (real pipeline over the safe dataset), but the REAL-browser + REAL-MySQL doctor conversation cannot execute in this sandbox (no MySQL server, no browser binaries — environment-blocked, labeled honestly per §11). User-side check (local runtime already healthy after the migration repair, ~2 minutes): `npm run dev` → doctor login → speak/type exactly: `وريني مواعيد المريض النهاردة.` → expect "which patient" → answer `اسمه محمد النبي.` → expect محمد النبي's TODAY appointment list → `آخر زيارة كانت امتى؟` → expect the last recorded visit (or "no previous visits recorded").

## 13. Failed-resolution continuity round (2026-10-02) — a NOT_FOUND must never kill the task

**User-reported runtime failure (exact transcript):** `قولي المواعيد بتاعه بكرة.` → `مفيش مواعيد يوم اليوم المطلوب.` (a malformed generic date answer); `وريني مواعيد المريض اللي اسمه محمد علي.` → `مقدرتش ألاقي المريض ده…` (correct ask, but the task state was discarded); `اسم محمد النبي.` → the off-domain refusal. The pending task died at the NOT_FOUND.

**Root causes (each reproduced on the REAL pipeline before any edit):**

1. **Relative-clause identity was never extracted** — `المريض اللي اسمه محمد علي` let the clause scaffolding (`اللي اسمه`) leak into the name capture (`اللي اسمه محمد`), so the probe probed garbage and the task died in clarification.
2. **Multi-word name matching was ANY-word** — `nameContainsForm` matched when a SINGLE spoken word overlapped the record, so `محمد علي` rode `Ahmed Ali`'s family name (علي→ali) onto the WRONG patient, and the correction scenario could never reproduce.
3. **No continuation after a FAILED resolution** — the round-12 pending-task contract only saw the LAST user turn and required an identity-missing classification; a correction turn after NOT_FOUND (no pin, nothing pending-looking) fell through to OUT_OF_DOMAIN.
4. **Correction cues lost their name when no pin existed** — the pipeline passes the corrected name explicitly only when a pin existed (§17 re-pin); after a failed lookup there is no pin, so `قصدي محمد النبي` reached the agent nameless.
5. **Bare `اسم` (identity answer) was not an identity marker** — `اسم محمد النبي` produced no name hint at all.
6. **Possessive pronouns** — `بتاعه` leaked into the name candidate filters (junk-name probe) instead of scoping the request to an unidentified patient.
7. **Malformed date answers** — the deterministic appointments summary printed a placeholder date (`يوم اليوم`) when no concrete date had been resolved.

**Architectural correction (existing abstractions extended — no parallel state model, no phrase hardcoding):**

1. `classifier.ts`: relative-clause identity pattern (`اللي/الذي + اسمه/اسمها/الاسم → the name`); `اسم` joins the explicit identity markers (ordered after اسمه/اسمها); scaffolding words (`اللي`, `اسمه`, `اسم`, `بتاعه`…) are stop-filtered EVERYWHERE a name candidate is built; a NEW conservative `extractBareNameCandidate` (every token stopword/object/verb/temporal/filler-filtered) exists for the continuation context ONLY; correction cues extend to `لا، …` and now carry the corrected name into `patientName` (a cue SUPPLIES identity); a possessive-pronoun reference (`بتاعه/بتاعها/بتاعهم/بتاعتها`, his/her/their) marks the request patient-dependent — identity from pin or clarification, never a clinic-level guess.
2. `name-matching.ts`: MULTI-word hints are now AND-per-word — EVERY spoken word must be satisfied by some stored word (folded Arabic ± bounded renderings); a partial overlap is a DIFFERENT person and stays a recoverable NOT_FOUND. A bounded Egyptian-surname rendering dictionary was added so a Latin-stored `محمد النبي` (Mohamed Alnaby) still resolves while `محمد النبي` never resolves `Mohamed Salem`. Single-word semantics unchanged; `عبد الله`-style compound first names handled.
3. `loop.ts` — the pending-task contract is now a BACKWARD SCAN of the bounded history: identity-only turns (`اسم محمد النبي`, bare names — OUT_OF_DOMAIN) are SKIPPED, so a correction CHAIN still finds the original intent turn; the first turn with a real intent must be patient-dependent with its identity still unresolved (missing OR previously attempted and NOT_FOUND — same classifier contract), otherwise there is no continuation. The gate accepts identity-supplying turns: OUT_OF_DOMAIN/UNKNOWN standalone OR a correction-cue turn (when the pipeline did not already pass the name). `intentMessage` (= the pending message) keeps driving retrieval, answer branches, and the LLM question line — temporal constraints survive structurally. The deterministic temporal layer now also covers بعد بكرة (+2) and امبارح/أمس (−1). Empty appointment answers never claim a placeholder date.
4. `entity-resolution.ts`: possessive/identity-clause words join `AR_NON_NAME` — the pipeline hint prober never probes them as names.

**State model (§4/§15):** the recoverable pending task is NOT a new store — it is reconstructed deterministically from the bounded conversation history (the project's established architecture: the history IS the state). It is session-scoped and tenant-safe by construction (history is per-session; resolution is tenant-scoped at the DB seam), survives NOT_FOUND clarifications and wrong corrections (the scan skips identity-only turns), is superseded the moment the user starts a new independent task (the gate only fires for intent-less identity turns), and decays with the bounded window.

**Tests added (all deterministic):** `agent-loop.test.ts` — 7 rows (failed lookup stays NOT_FOUND; all 5 correction variants resume the appointment intent; بكرة survives as TOMORROW; wrong-correction chain recovers; possessive with/without scope; fresh-session identity turns never query). `robot-intelligence-eval.test.ts` §15.N — 7 real-pipeline rows (Scenarios A–D via `replayVoiceCase` + the variants/adversarial matrix). Driver **Group N** — 8 acceptance rows (N1–N7 + the appointment-focused answer check): `validate.mts` → **ROWS=57 PASS=57 FAIL=0**. Matcher unit matrix verified (wrong-patient overlap rejected, Latin-stored correction resolves, compound names, folding).

**Regression:** two driver rows and one eval row that relied on the OLD partial-overlap matching (`هات أحمد محمد` → Ahmed Ali on one shared word) were updated to the full stored name (`هات أحمد علي`) — the pin+pronoun semantics they exist to protect are unchanged; partial-overlap resolution was itself the defect class this round removes. Full suite **6138 passed / 12 skipped / 0 failed** (previous 6124/12/0; +14 new tests, 0 failures); tsc **504** (baseline parity); eslint **0 errors**.

**Final status: FAIL — RUNTIME VALIDATION BLOCKED** — every code-path gate passes in-sandbox (real pipeline over the safe dataset, 57/57 driver rows), but the REAL-browser + REAL-MySQL doctor scenarios (§18 A–D) cannot execute here (no MySQL server, no browser binaries — environment-blocked, labeled honestly). User-side check (local runtime already healthy; ~3 minutes): doctor login → speak/type: `وريني مواعيد المريض اللي اسمه محمد علي.` → expect the recoverable "which patient / confirm the name" ask → `اسم محمد النبي.` → expect محمد النبي's appointments (NOT an overview, NOT a refusal) → `وريني مواعيد المريض اللي اسمه محمد علي بكرة.` + `اسم محمد النبي.` → expect TOMORROW's date in the answer → with a patient already pinned: `قولي المواعيد بتاعه بكرة.` → expect that patient's tomorrow appointments → fresh session: `قولي المواعيد بتاعه بكرة.` → expect the identity ask.

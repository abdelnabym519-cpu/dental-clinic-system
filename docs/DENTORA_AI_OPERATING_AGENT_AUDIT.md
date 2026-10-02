# DENToRa AI Operating Agent — Capability Matrix & Audit (Master Prompt §4/§36)

Method: every row below was verified by reading the shipping code path AND its
executing tests/driver rows (`npx tsx ai-validation/robot-runtime/validate.mts`,
73 rows through the real pipeline: runVoiceTurn/session → entity resolution →
runAgent → tools → deterministic answers). No row is marked PASS from file
existence alone (§34).

Verdicts: **PASS** = reachable + connected + executes + validated. **BLOCKED**
= code complete, real-runtime dependency unavailable in this sandbox. **PARTIAL**
= honest gap, listed in UNIMPLEMENTED.

| Capability | Canonical path | Executing proof | Verdict |
|---|---|---|---|
| Canonical agent (one brain) | `lib/ai/agent/loop.ts` — OBSERVE→UNDERSTAND→CLASSIFY→RETRIEVE→PLAN→TOOL→OBSERVE→ANALYZE→VALIDATE→SAFETY→APPROVAL→ACT→VERIFY→AUDIT, bounded limits, trace | all 73 driver rows + 6159-test suite reach `runAgent` | PASS |
| Channels reach the agent | text: `/api/ai/agent`; voice: `lib/ai/voice/pipeline.ts` (same loop); robot: `components/robot` + `lib/ai/robot-identity.ts`; doctor/clinic/patient UIs: `/api/ai/*` surfaces | driver Groups A–Q (voice), unit agent-loop (text) | PASS |
| Agent loop (multi-step/failure/clarify/resume) | planner templates + execution loop with maxPlanSteps/maxToolCalls/repeats/timeout; typed failures; §24 knowledge-gap clarify; pending-task resume | tests/unit/agent-loop (loop safety, failures), driver N-group (correction chains) | PASS |
| Dental expert layer | `lib/ai/knowledge/taxonomy.ts` (approved domain taxonomy) + `retrieve_dental_knowledge` tool; domains mapped from findings/procedures — never user-selected | robot-intelligence + agent-eval knowledge rows | PASS |
| Multi-expert synthesis | `domainsForCase` → same intelligence logic per domain; disagreement → uncertainty, never fabricated specialists | clinical-eval / dental-brain tests | PASS (honest: synthesis is deterministic over recorded evidence) |
| Patient 360 | context profiles (FULL_360 etc.) + `get_patient_360`; `buildPatientIntelligence` | patient360-eval, driver M/N rows | PASS |
| Tooth intelligence | TOOTH profile + `get_tooth_context` + FDI validation; longitudinal tooth chain in context builders | agent-loop tooth rows | PASS |
| Whole-mouth intelligence | `lib/ai/intelligence/dental-brain.ts` (whole-mouth state over the case graph) | clinical-eval | PASS |
| Case graph | `lib/ai/intelligence/case-graph.ts` — Patient→Tooth→Finding→Symptom→Imaging→Diagnosis→Treatment→Follow-up→Outcome | phase-9/intelligence suites | PASS |
| Multimodal routing | `lib/ai/multimodal/modality.ts` (`tasksForModality`), un-analyzable modality is NEVER scheduled (planner) | agent-loop + multimodal-eval | PASS |
| AI engines as real tools | `lib/ai/engines/*`: registry + capability matrix + orchestrator transport; typed failures (STANDIN_REJECTED, PROVENANCE_MISMATCH, ORCHESTRATOR_UNREACHABLE…); engine never chosen from user text (§32) | local-ai-eval + adversarial | BLOCKED (real inference needs the local python orchestrator `AI_ORCHESTRATOR_URL`; artifacts + provenance in `ai-validation/{dentalgemma,yolov8-8024,meshsegnet,toothfairy2,liodon,cldetection2023}`) |
| Clinic intelligence | `lib/ai/intelligence/clinic-brain.ts` + skills (no-show, pricing, cashflow, inventory, segments) | skill suites | PASS |
| Doctor brain | briefing API + patient 360 + imaging + risk + second review + proactive alerts; chairside voice = same agent | api/briefing + voice driver | PASS |
| Patient AI | `lib/ai/intelligence/patient-ai.ts` + portal self-scope (PATIENT role is ALWAYS self-scoped in resolvePatient) | agent-loop PATIENT rows | PASS |
| Mission mode | **NEW:** mission phrasing (`جهزلي حالات بكرة`) → OPERATIONAL/command_center → `get_command_center` tool → digital twin → deterministic honest briefing; §9 day layer honors بكرة (tomorrow) | driver Group Q (Q1–Q3) + 3 agent-loop unit tests | PASS |
| Clinic digital twin | `buildClinicMetrics`/`buildCommandCenter` — now queried BY THE AGENT (one twin, no parallel metrics), not only via `/api/ai/intelligence/clinic` | driver Q2 | PASS |
| Proactive intelligence | `lib/ai/intelligence/proactive.ts` + `/api/ai/insights` | proactive suites | PASS |
| Clinical intelligence | dental-brain (differential support, dependencies, complexity, tracking) with FACT / DERIVED_INSIGHT / AI_INTERPRETATION separation | phase-12 clinical safety evals | PASS |
| Evidence mode | grounding + citation extraction/stripping + provenance contract (`extractSources`); untrusted user docs never enter the knowledge base | grounding tests + clinical-safety goldens | PASS |
| Research/patient separation | knowledge retrieval tool is patient-free unless a patient is resolved; knowledge store vs patient context are separate services; §45 fences | agent-loop security rows | PASS |
| Knowledge-gap detection | `missingInfo` → exact ask → resume (§24 never-guess); driver N-group | PASS |
| Memory (clinic/doctor/patient/case/conversation) | `lib/ai/memory/*` (5 kinds, retention, validation) + bounded conversation history as the state store | memory-eval | PASS |
| Voice (§27) | round-3 turn manager FSM, partial buffering, held-incomplete, barge-in, interruption-with-content, pronoun/temporal resolution, failure layer — same agent loop | driver Groups O + P, harness 14/14 | PASS (streaming ASR/TTS provider runtime = BLOCKED) |
| Avatar/Robot (§28) | robot identity + frozen greeting + robot components; robot voice shares the SAME pipeline/session/agent state (no second brain) | robot tests + driver | PASS |
| Safety | RBAC-at-retrieval, action policy, idempotency/dup windows, teeth validation, cross-tenant refusals — all inside the loop | security/adversarial suites, driver K/Q3 | PASS |
| Approval | approval ledger (fingerprint, expiry, duplicates) + DRAFT path for incomplete params | approval-safety-eval | PASS |
| Audit | trace + tool calls + plan + failures persisted per turn (`AgentTrace`), action pipeline audit | observability-eval | PASS |
| Observability | `lib/observability/{correlation,logger}.ts` + per-layer failure attribution (agent/voice failure codes) | failure-injection tests, driver O7 | PASS |
| Clinical documentation (doctor note drafting) | — none exists; the agent clarifies instead of fabricating | probe: 'اكتبلي Clinical Note.' → honest clarification | PARTIAL (UNIMPLEMENTED — see below) |

## Disconnections closed this round

1. **Mission mode / Digital Twin ↔ canonical agent** (the one real
   disconnection found): the workflow engine and command center existed but
   were API-only. The agent now plans `get_command_center` (same
   `buildCommandCenter` the API serves — no duplicated metrics), honors the
   resolved day, renders honest data states, and refuses clinic-wide missions
   for PATIENT actors. Proof: driver Group Q, agent-loop mission tests.
2. **Stale-pin precedence** (carried from round 2): fixed and locked (commit
   `21520ca`).

## Honest unimplemented capabilities (not faked)

- **Clinical documentation drafting** ('اكتبلي Clinical Note.'): no note
  generator exists in the architecture; the agent's current behavior is the
  SAFE behavior (clarify, never fabricate a clinical document). Building one
  is a scoped feature, not a connection.
- **Real engine inference in this sandbox**: the orchestrator (python, local
  models) is not runnable here; contracts, provenance, and typed failures are
  validated; per §37/§38 runtime inference must be verified on the target
  Windows/CPU machine (runbook below).
- **VAD**: voice activity detection relies on the browser ASR's speech events
  + turn manager; no standalone VAD DSP stage exists.

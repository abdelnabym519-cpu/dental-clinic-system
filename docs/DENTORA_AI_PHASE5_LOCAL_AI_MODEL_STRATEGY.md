# DenToRa AI — Phase 5: Local AI / Model Strategy, Runtime Abstraction & Evidence-Based Engine Registry

**Date:** 2026-09-30 · **Branch:** `arena/01a0ce7a-dental-clinic-system` · **Status:** ARCHITECTURE COMPLETE — 2/5 engines REAL-INFERENCE-VERIFIED, remainder legitimately externally blocked (§36 gate: 🟡)

Every statement in this document carries one of five evidence tags:

| Tag | Meaning |
|---|---|
| **[VERIFIED]** | Reproducible proof exists in this repository (committed artifact + automated test) |
| **[INFERRED]** | Sound reasoning from verified facts; no direct artifact yet |
| **[PLANNED]** | Designed, not yet built |
| **[BLOCKED]** | Cannot be completed from this environment — with the exact external blocker |
| **[DEFERRED]** | Explicitly out of scope for Phase 5, owned by a later phase |

---

## 1. Executive Summary

Phase 5 delivers the **local-AI foundation**: one canonical, typed, evidence-based engine
registry and runtime abstraction through which the DenToRa Agent discovers, validates,
selects, executes, normalizes, traces, and honestly reports specialized dental AI engines —
**without pretending that unverified models are operational** (§40).

**What is genuinely working now** (each item is machine-verified in CI):

- Two real engines (`meshsegnet-max`, `meshsegnet-man`) passed the **real-inference gate**
  on CPU with SHA-256-verified official weights and challenge-published test meshes.
  Committed machine-readable evidence:
  `ai-validation/meshsegnet/reports/phase5_real_inference_{max,man}.json` **[VERIFIED]**
- A single canonical typed registry + capability matrix (no `any`) mirrored between the
  Python orchestrator (source of truth, consumed by `/engines`) and the TypeScript app,
  with contract tests that fail on drift. **[VERIFIED]**
- The full abstraction flow Agent → `LocalAIService` → CapabilityRegistry →
  EngineResolver → EngineAdapter → Runtime → validated output, implemented and tested. **[VERIFIED]**
- Deterministic engine selection from (task, modality) only — engine names in user text
  never select anything. Tested: a question naming `liodon` returns the identical
  registry answer as the same question without the name. **[VERIFIED]**
- A live capability tool in the Phase 3 agent loop: `local_ai_capabilities` (read-only,
  `reviewRequired`, deterministic renderer, no LLM). Doctor and patient roles can ask
  "what dental AI can you do" and get the honest matrix + live engine health. **[VERIFIED]**
- One FastAPI orchestrator service (CPU-only image, no CUDA) with 66 passing tests:
  lifecycle state machine, provenance, storage path validation, capability resolution. **[VERIFIED]**
- Full repo suite: **5499 passed / 12 skipped**; `tsc --noEmit` unchanged at the Phase 4
  baseline (503 pre-existing errors, **0 introduced by Phase 5**). **[VERIFIED]**

**What is NOT yet verified** (honest boundaries):

- `liodon` (panoramic) and `implant-ai` (periapical/bitewing): production path and
  operator-verified SHAs exist, but the weight files are published only on Hugging Face,
  which is unreachable from the validation environment → **PARTIAL**, no new real-weight
  inference evidence was produced for them in this phase. **[BLOCKED — external: Hugging Face unreachable from sandbox]**
- `orthodontic-ai` (cephalometric): mechanism proven with a random-weight control run;
  the real checkpoint distributes via a gated Google Drive link → **PARTIAL**. **[BLOCKED — external: gated download]**
- CBCT volume (multi-structure) segmentation: **no engine in this repository** — reported
  as UNAVAILABLE, never claimed. **[DEFERRED]**
- Clinical **accuracy** of any engine: Phase 5 measures infrastructure (latency/memory),
  never accuracy. Accuracy needs an evaluation dataset with reference annotations. **[DEFERRED]**
- Numbers on the **target Windows machine** (i9-13900H/16 GB/Iris Xe): all baselines here
  are from the validation sandbox (2 vCPU / ~4 GB) and are labeled as such. **[DEFERRED — operator-run on target hardware]**

---

## 2. Scope — what Phase 5 covers and deliberately does not

**In scope** (§3): registry, runtime abstraction, typed contracts, selection policy,
local-vs-cloud policy, observability/tracing, security model, health semantics, evidence
harness, benchmark harness, this document, and the Agent integration that *reports*
capabilities through the Phase 3 loop.

**Deliberately out of scope:** Phases 6–11 features (Odontogram, i18n expansion, PDF,
auth/RBAC changes, Agenda, messaging, portal work); clinical-accuracy evaluation; model
training or fine-tuning (pretrained weights only, §2); GPU support (CPU-only contract —
a GPU is optional and never required, §2); destructive schema changes (additive only, §29);
any change to Phase 1–4 behavior except the additive capability tool described in §10.

**No rewrites:** the Phase 1 approval pipeline, Phase 3 safety/loop, Phase 4 RAG, and the
imaging pipeline are untouched except for the additive, contract-tested additions listed
above. **[VERIFIED — diff review + full suite green]**

---

## 3. Status vocabulary

Two orthogonal state machines, never conflated:

**A. Evidence level per (task, engine) pair** — the six-level ladder (§9):

```
capabilityDeclared → modelExists → weightsVerified → localInferenceVerified → cpuInferenceVerified → productionIntegrated
```

A task is **SUPPORTED** only when all six hold. **PARTIAL** when the production path
exists but some level is unverified *in this environment*. **UNVERIFIED** when levels are
partially met without production integration. **UNAVAILABLE** when the capability is
declared absent (we chose not to claim it).

**B. Artifact lifecycle per engine instance** (§16) — enforced by
`ai/orchestrator/app/lifecycle.py` and tested:

```
DISCOVERED → WEIGHTS_VERIFIED → BUILD_OK → VALIDATED → REGISTERED → AVAILABLE → RETIRED
                                    │
                                    └── BLOCKED (with exact reason)   REJECTED (with reason)
```

Hard rules: transitions are forward-only (tested: `REGISTERED → AVAILABLE` is rejected —
`VALIDATED` must come first); a checksum mismatch is an **identity** change, not a
metadata change, and forces re-verification (no silent artifact replacement); every
terminal state carries a machine-readable reason.

"Verified / working / integrated / CPU-compatible / production-ready" may appear in
DenToRa output only when a committed artifact backs the word (§34). This document applies
that rule to itself via the five evidence tags. **[VERIFIED — tests/unit/engines-*, orchestrator lifecycle tests]**

---

## 4. Hardware reality

| | Validation sandbox (where evidence was produced) | Target machine (operator's) |
|---|---|---|
| CPU | 2 vCPU (Linux) | Intel i9-13900H (hybrid 6P+8E+4E-cores) |
| RAM | ~4 GB | 16 GB |
| GPU | none | Iris Xe (unused — CPU-only contract) |
| OS | Linux | Windows |
| Python | 3.11.2 / torch 2.14.0 (`cuda_available: false` recorded) | — (operator-provisioned) |

**Contract:** every engine and every evidence artifact in this repository must run on
plain CPU with zero CUDA dependency; the Docker base images are CPU-only; the target's
GPU is an optional speed factor that no DenToRa path may require. All baselines in §20
are **sandbox** numbers and are labeled as infrastructure-only. **[VERIFIED for sandbox — `runtime.cuda_available: false` in both evidence reports; DEFERRED for target — requires an operator run on Windows]**

**16 GB budget analysis [INFERRED]:** two MeshSegNet engines at peak ran at
1.84 GB + 1.74 GB RSS concurrently in the sandbox evidence run (sequential load,
one engine process each). On the 16 GB target this leaves ≥ 12 GB for the Node app,
Postgres, the imaging pipeline, and OS — so the orchestrator can host all five local
engines **sequentially-per-request** (one engine process per engine, model loaded once,
inference serialized by the orchestrator's job queue). Starvation prevention: a global
inference semaphore (max 1 concurrent heavy mesh inference) plus per-job wall-clock
limits (§17). This budget is an inference from measured RSS; the operator must confirm
with the §27 harness run on the target.

---

## 5. Engine inventory

Repo existence ≠ operational. Each row states its *evidence-backed* status:

| Engine | Code | Task(s) | Modality | Weights | Phase 5 status | Evidence |
|---|---|---|---|---|---|---|
| MeshSegNet (max) | `ai/engines/meshsegnet-max` | `dental_mesh_segmentation`, `cbct_surface_segmentation` | 3D scan / CBCT (mesh) | SHA `727cd3c5…5d2` verified from official Tai-Hsien/MeshSegNet repo | **AVAILABLE — REAL_INFERENCE_VERIFIED** (CPU) | `phase5_real_inference_max.json` |
| MeshSegNet (mandible) | `ai/engines/meshsegnet-man` | `dental_mesh_segmentation_mandible` | 3D scan (mesh) | SHA `d74c87e0…60a0cf` verified from official repo | **AVAILABLE — REAL_INFERENCE_VERIFIED** (CPU) | `phase5_real_inference_man.json` |
| Liodon | `ai/engines/liodon` | `panoramic_caries_detection`, `panoramic_impacted_tooth_detection` | Panoramic | SHA `4cee38b5…3a71` operator-verified (19A) | **PARTIAL — BLOCKED (weights on Hugging Face, unreachable from sandbox)** | `ai-validation/liodon/` |
| Implant AI | `ai/engines/implant-ai` | `periapical_lesion_detection`, `bitewing_caries_detection` | Periapical / bitewing | SHA `e7cc1377…9ce98` operator-verified (19B) | **PARTIAL — BLOCKED (weights on Hugging Face, unreachable)** | `ai-validation/yolov8-8024/` (19B lab) |
| Orthodontic AI | `ai/engines/orthodontic-ai` | `cephalometric_landmark_detection`, `orthodontic_analysis` | Cephalometric | SHA `fb1a781a…646fdcc` mechanism-verified (19B) | **PARTIAL — BLOCKED (real checkpoint on gated Google Drive)** | `ai-validation/cldetection2023/` |
| Cloud LLM | (existing) | conversation synthesis, RAG synthesis | text | — | **UNCHANGED — CLOUD_ALLOWED for text only** | Phase 3/4, untouched |

**No phantom engines exist.** The registry contains exactly the engines above; the
capability matrix contains exactly ten tasks; an engine may be named in the matrix only if
a registry entry with a checksum exists (test-enforced). The 38-landmark output of
`orthodontic-ai` uses the model's own numeric vocabulary — no official anatomical label
map is published, so none is invented (same provenance rule as MeshSegNet's neutral
class names: `Gingiva`, `Tooth_1…Tooth_14`). **[VERIFIED]**

---

## 6. Weight verification & provenance

Rules (all machine-enforced):

1. **Identity = SHA-256.** The checksum is the artifact's identity; a mismatch means a
   different artifact and re-verification — never a metadata update. Expected SHAs live in
   exactly one Python constant per engine (`ai/orchestrator/app/registry.py`) cross-checked
   against `ai-validation/**/MODEL_PROVENANCE.md` and each engine's own `model.py`
   (tests assert the three agree).
2. **No fabrication, no silent substitution, no unknown mirrors.** Downloads happen only
   from the authoritative source recorded in `MODEL_PROVENANCE.md` (official GitHub for
   MeshSegNet; Hugging Face for Liodon/Implant AI; the paper's gated Drive for
   CLDetection). If the source is unreachable from the environment, the engine is
   **BLOCKED with the exact reason** — a stand-in weight file is never loaded, and the
   engine's health endpoint exposes `is_standin` so a stand-in can never be mistaken for
   the real model.
3. **Two-stage verification:** at download time (download script verifies the SHA before
   the file is accepted) and at load time (engine `/health` re-verifies the on-disk
   checksum against the registry before serving — `model_checksum_verified: true` in the
   committed evidence).
4. **Provenance joins the existing DenToRa audit trail** (§14) — no parallel logging
   system; engine-run provenance rows reference the `AiAnalysisJob` they produced.
5. **No PHI in any provenance record** — inputs are challenge-published meshes / synthetic
   fixtures; evidence files contain hashes, shapes, and counts only (test-enforced: the
   evidence JSON must not contain coordinate arrays or host paths).

**Verified in this phase:** both MeshSegNet weight files re-downloaded from the official
repository with matching SHAs, verified at download and at load. **[VERIFIED]**

---

## 7. Capability matrix (10 tasks)

The matrix is product policy data (task → registered engine + evidence levels), mirrored
between `ai/orchestrator/app/capability_matrix.py` (source of truth) and
`lib/ai/engines/capability-matrix.ts`, contract-tested field-by-field.

| Task | Modality | Engine | Overall | Why |
|---|---|---|---|---|
| `dental_mesh_segmentation` | THREE_D_SCAN | meshsegnet-max | **SUPPORTED** | All six levels hold; real CPU inference evidence committed |
| `dental_mesh_segmentation_mandible` | THREE_D_SCAN | meshsegnet-man | **SUPPORTED** | Separate weights, separate evidence run |
| `cbct_surface_segmentation` | CBCT | meshsegnet-max | **SUPPORTED** | Engine consumes surfaced meshes; raw-volume segmentation is NOT claimed |
| `panoramic_caries_detection` | PANORAMIC | liodon | PARTIAL | Production path + operator SHA exist; weights unreachable from sandbox |
| `panoramic_impacted_tooth_detection` | PANORAMIC | liodon | PARTIAL | same engine |
| `periapical_lesion_detection` | PERIAPICAL | implant-ai | PARTIAL | production path + operator SHA; weights unreachable |
| `bitewing_caries_detection` | BITEWING | implant-ai | PARTIAL | same engine |
| `cephalometric_landmark_detection` | CEPHALOMETRIC | orthodontic-ai | PARTIAL | mechanism proven (random-weight control); real checkpoint gated |
| `orthodontic_analysis` | CEPHALOMETRIC | orthodontic-ai | PARTIAL | exposed via 38-landmark output; no diagnosis computed |
| `cbct_multi_structure_segmentation` | CBCT | — | **UNAVAILABLE** | no engine in repo (ToothFairy-class models are access-gated); honest gap, deferred |

Every row: `humanReview: REQUIRED` — **finding ≠ diagnosis** (§12). Modality mismatch
resolves to a typed `MODALITY_MISMATCH`, unknown task to typed `UNSUPPORTED_CAPABILITY` —
never a best-effort guess. **[VERIFIED — tests/unit/engines-capability-matrix.test.ts]**

---

## 8. Runtime architecture

```
DenToRa Agent (Phase 3 loop)
  │  requests a CAPABILITY — never model internals (§10/§32)
  ▼
LocalAIService                     lib/ai/engines/local-ai-service.ts
  │  capabilityView()  resolveEngine(task, modality, jaw?)  analyze(job)
  ▼
CapabilityRegistry  (capability-matrix — typed, no `any`)
  ▼
EngineResolver      (deterministic (task, modality[, jaw]) lookup)
  ▼
EngineAdapter       (orchestrator-source.ts — speaks the FastAPI contract)
  ▼
Runtime             (FastAPI orchestrator service, CPU-only container)
  │  engine process per engine; model loaded once; inference serialized
  ▼
Validated Output    (canonical envelope — checksum-verified weights, provenance row,
                     confidence + uncertainty, human_review=REQUIRED)
```

- **The Agent requests capabilities.** It cannot name an engine, path, or class list; the
  tool `local_ai_capabilities` returns the matrix + live health and nothing else
  (read-only, `reviewRequired: true`, deterministic renderer — no LLM). **[VERIFIED]**
- **Engine output formats never leak to the Agent.** The adapter maps raw engine payloads
  (e.g. 15-class per-cell labels) to the canonical envelope (segments/findings/landmarks
  with neutral names + counts); tests assert the envelope schema and the absence of raw
  internals. **[VERIFIED]**
- **Honest failure is first-class.** Unreachable orchestrator → `runtime.source =
  'unavailable'` + exact reason in the answer; forged checksum / stand-in weight / job
  mismatch → typed rejection, no output. Tested. **[VERIFIED]**
- **In-process vs service (§21): service.** Decision evidence: peak RSS of one MeshSegNet
  engine process is ~1.8 GB (measured) — hosting it in the Node app would endanger the
  whole clinic API on a 16 GB machine with Postgres + MinIO + imaging; the engine is
  also the least stable component (C++/VTK/torch stack), and isolating it keeps the Node
  process crash-free and restartable; Windows operation is simpler with one container per
  engine. Counter-evidence considered: one extra hop per call (~ms-level in-process
  measurement) — accepted. **[INFERRED from measured RSS + crash-isolation reasoning; DEFERRED: operator confirmation on target]**

---

## 9. Deterministic engine selection

Selection is a **pure function of (task, modality[, jaw])** with zero free text (§13/§32):

- Image/volume tasks → the specialized local engine when evidence-backed (the three
  SUPPORTED mesh tasks route to MeshSegNet; jaw disambiguates max vs mandible).
- Structured-data tasks → deterministic tools (Phase 1/2 tools), never a model.
- Factual/educational questions → Phase 4 RAG.
- No evidence-backed engine → honest unavailability with the exact reason.
- An engine *name* in user text is data, not a selector. **Test:** "Can liodon run on my
  panoramic? What dental AI analysis can you do on X-rays?" produces a byte-identical
  answer to the same question without "liodon" — and no patient data is fetched (a
  capability question is patient-free registry information, even for PATIENT actors).
  **[VERIFIED — tests/unit/agent-local-ai-integration.test.ts]**

---

## 10. Local vs cloud policy

Per-task routing policy (§14), enforced by the capability matrix + agent loop:

| Mode | Meaning | Phase 5 instances |
|---|---|---|
| `LOCAL_REQUIRED` | only a local engine may execute; cloud refusal is the safe default | all ten dental-imaging tasks |
| `LOCAL_PREFERRED` | local engine used when AVAILABLE; otherwise honest unavailability (no silent cloud) | the six PARTIAL tasks until their weights are reachable |
| `CLOUD_ALLOWED` | cloud permitted for this task class | text: conversation synthesis + RAG synthesis (Phase 3/4) — **unchanged** |
| `CLOUD_ONLY_CURRENTLY` | only a cloud path exists today; reported as such, never as local | — (none in dental imaging; none invented) |
| `UNAVAILABLE` | no path at all, reported honestly | `cbct_multi_structure_segmentation` |

The cloud LLM remains fully intact for its original role; Phase 5 **adds a local path
through the abstraction — it never replaces the cloud destructively**. No engine output
travels to the cloud. **[VERIFIED — agent integration tests + untouched Phase 3/4 code]**

---

## 11. FastAPI orchestrator service

`ai/orchestrator/` — one service, CPU-only Docker image (no CUDA base, §22), endpoints:
`/engines` (registry view), `/health` (per-engine six-stage health, §18),
`/jobs` (submit/track inference jobs), capability resolution endpoint mirroring the TS
matrix. 66 tests pass (lifecycle transitions, provenance immutability, storage-path
traversal rejection, capability resolution, job integrity). **[VERIFIED]**

The TS client (`orchestrator-source.ts`) talks to it with a bounded 2.5 s timeout and the
deployment's `ORCHESTRATOR_SECRET`; a missing secret or unreachable service degrades to
the honest `unavailable` runtime state — it never fabricates health. The orchestrator
re-validates tenant context server-side on every job (Phase 5 §19): client-supplied
identifiers are re-resolved against the DB before any engine touch. **[VERIFIED — orchestrator tests + TS unit tests]**

**Container builds ≠ operational (§22):** the image build proves packaging only; the
inference gate (§19) is what makes an engine AVAILABLE. **[VERIFIED — engine reached AVAILABLE only after the real-inference run, not at build time]**

---

## 12. Canonical output envelope & "finding ≠ diagnosis"

Every engine result normalizes to one typed envelope (`lib/ai/engines/types.ts`):
`job` (tenant-verified ids), `engine` (name + weight SHA used), `modality`,
`findings/segments/landmarks` (neutral clinical vocabulary only), `confidence` +
`uncertainty` (model-native, never re-labeled as severity), `provenance` (job id, weight
checksum, run timing), `humanReview: 'REQUIRED'`.

Hard rules: **model output is never automatically a diagnosis** — the envelope has no
diagnosis field by construction, and the agent renderer always appends the clinician-review
disclaimer (test-enforced on real answers); **no confidence → severity upgrade** (19B
rule, unchanged); **an output can never attach to a patient by client-supplied
identifier** — attachment goes through the tenant-verified `AiAnalysisJob` path only.
Phases 6–11 (reporting, diagnosis workflows) build on this envelope; none of it exists
yet and none of it is claimed. **[VERIFIED for envelope + disclaimer; DEFERRED for downstream consumers]**

---

## 13. Provenance & audit integration

Engine runs join the **existing** DenToRa audit machinery (audit log + graph lineage,
§31): a provenance row is written into the job record the engine run produced — run id,
engine name, weight SHA, input SHA (or job-referenced study id — never raw PHI),
checksum-verification result, timing, exit status. There is **no parallel logging
system** and **no PHI** in any provenance field (evidence files and fixtures are
hashes/shapes/counts; tests scan for PHI-like content and host paths). Every inference
result is therefore traceable through the existing graph: study → job → provenance →
weight identity → evidence report. **[VERIFIED for the pipeline and evidence artifacts; the DB rows land when the first production job runs — the schema is Phase 2/20B's existing `AiAnalysisJob` + provenance columns, additive only]**

---

## 14. Security — threat matrix & mitigations

| Threat | Mitigation | Evidence |
|---|---|---|
| Path traversal (model/artifact paths) | orchestrator storage layer resolves and rejects paths outside the artifact root | orchestrator tests (traversal cases) **[VERIFIED]** |
| Model injection (substituted weights) | SHA-256 identity at download AND at load; mismatch = different artifact, re-verify; `is_standin` flag | evidence reports + service tests (forged checksum rejected) **[VERIFIED]** |
| Oversized / zip-bomb inputs | engine-side size + cell-count caps (official 10k-cell decimation cap enforced, recorded in evidence); job-level wall-clock limits | evidence `preprocessing` block **[VERIFIED]** |
| Command injection (agent strings → OS) | agent-produced strings are data only: no `eval`, no shell interpolation, no OS command construction anywhere in the TS/Python AI path | code audit + 0 matches in grep **[INFERRED]** |
| Cross-tenant access | server-side tenant re-validation on every job; ids re-resolved, never trusted from client | orchestrator tests + service tests (job mismatch rejected) **[VERIFIED]** |
| Forged provenance / confidence | provenance written server-side by the runtime; confidence is model-native and surfaced as-is (no re-labeling); tamper test: substituted checksum fails identity check | evidence tamper test **[VERIFIED]** |
| Privilege escalation (agent upgrading itself) | Phase 3 policy unchanged: LLM/classifier never upgrades execution mode or approval; the new capability tool is read-only and `reviewRequired` | Phase 3 tests still green (5499 pass) **[VERIFIED]** |
| Engine-name impersonation in user text | selection is a (task, modality) lookup; names in text are ignored | integration test (byte-identical answer with/without "liodon") **[VERIFIED]** |
| PHI leakage into traces/evidence | fixtures synthetic or challenge-published; evidence contains hashes/counts only; answer tests assert absence of patient name/ids | evidence + integration tests **[VERIFIED]** |
| Starvation / DoS via concurrent inference | global inference semaphore + per-job timeout + request budget (§17) | orchestrator design **[PLANNED — enforced in production deployment]** |

---

## 15. Tenant isolation & server-side re-validation

Re-uses Phase 2 rules, extended to engine jobs: the agent's `hospitalId`/actor is
re-verified server-side in the orchestrator; the job's patient/study references are
re-resolved against the DB (a client-supplied id that doesn't resolve → typed rejection,
no engine touch); engine outputs attach only through the verified `AiAnalysisJob`. No
RBAC/tenant code was modified (guardrail §30). **[VERIFIED — job-mismatch and tenant tests]**

---

## 16. Lifecycle management

Enforced by `lifecycle.py` (state machine, forward-only, terminal states carry reasons)
and the registry (checksum = identity). **No silent artifact replacement:** re-downloading
a weight with a different SHA is a *new artifact* requiring re-verification and
re-registration; the old verified artifact remains valid until explicitly RETIRED.
Engine process model: one process per engine, model loaded once at startup (load time
recorded: 74 ms), served for the process lifetime; a RETIRED engine's process is drained
and killed. Windows note: the same lifecycle runs under the operator's container or
native Python — no Linux-only assumptions (no `os.posix`, no systemd dependencies).
**[VERIFIED for the state machine; PLANNED for operator-run RETIRE flows]**

---

## 17. Resource budgets & fail-safes (16 GB target)

Measured (sandbox, sequential): peak RSS 1.84 GB (max) / 1.74 GB (man); model load 74 ms;
warm inference 9.6–11.6 s per 10k-cell mesh on 2 vCPU. Budget for the 16 GB target
[INFERRED]: Node app ≤ 1 GB, Postgres ≤ 2 GB, MinIO ≤ 1 GB, up to 5 engine processes
≈ 9 GB worst case if all resident — feasible, but the deployment default is
**one resident engine at a time** (the orchestrator loads the engine the incoming job
needs, keeps it warm, evicts on LRU with a 30 min idle TTL) so the realistic steady state
is ≤ 4 GB for AI. Fail-safes: per-job wall-clock limit (default 120 s on target —
configurable), global semaphore = 1 heavy inference at a time (lightweight 2D jobs may
run concurrently, budget 2), memory watermark check before load (refuse with honest
`RESOURCE_UNAVAILABLE` instead of swapping the clinic), graceful timeout → job marked
TIMED_OUT with the exact reason — **never reported as success** (§24). **[PLANNED — limits designed and defaulted in the orchestrator; operator-confirmed thresholds deferred]**

---

## 18. Health semantics — six distinct states

`/health` reports per engine (never a single boolean):

1. **process alive** — engine process reachable
2. **runtime loaded** — torch/dependencies imported
3. **weights available** — file present at the pinned path
4. **checksum verified** — SHA matches the registry identity
5. **model initialized** — parameters loaded (parameter count recorded: 1,799,140)
6. **inference ready** — a smoke probe returned a well-formed envelope

**health ≠ readiness ≠ inference-ready** (§23): states 1–5 can all be true while the
model is a stand-in (exposed via `is_standin`) or while real inference has never been
gated — that is exactly the situation of liodon/implant/orthodontic in this environment,
and the agent surface renders it as PARTIAL + the exact reason, never as AVAILABLE.
A container that builds but cannot infer is not operational (§22) — AVAILABLE is granted
only by the lifecycle's `VALIDATED` step, which requires the real-inference evidence.
**[VERIFIED — health mapping in orchestrator-source + service tests (stand-in refusal)]**

---

## 19. Validation harness & evidence

Gate definition (§25/§26/§34): an engine is **AVAILABLE** only when, in order:
weights downloaded from the authoritative source **and** SHA-verified (download stage);
engine loaded with checksum re-verified (health stage); **real inference executed on CPU
against a pinned, SHA-recorded input** (evidence stage); output envelope validated;
determinism checked (cold vs warm run labels identical); performance + memory recorded;
all of it written to a committed, machine-readable, PHI-free report that CI re-validates
against the official identities.

Import success, container build, mock output, synthetic smoke tests, and hardcoded
answers each fail this gate individually (tests exist for each). Synthetic fixtures are
used only for unit isolation of TS/Python glue — they never produce an AVAILABLE state.
The final gate used **real weights and real inference**; the mocks in this repository are
unit-test doubles (documented as such in `tests/harness/local-ai-fixtures.ts`).

**Executed in this phase [VERIFIED]:** `ai-validation/meshsegnet/scripts/run_phase5_evidence.py`
spawned each engine on its own port, ran the health gate, executed cold + 5×warm real
inference on the pinned challenge meshes (`ZOUIF2W4_upper.obj` SHA `581b9a02…` /
`0EJBIPTC_lower.obj` SHA `b824f682…`), checked determinism, and wrote
`phase5_real_inference_{max,man}.json` (status `REAL_INFERENCE_VERIFIED`). CI re-validates
both reports' shape, identities, CPU-only runtime, cell cap, determinism, and absence of
PHI/host paths on every push (`tests/unit/engines-evidence.test.ts`).

**NOT executed [BLOCKED]:** real-weight inference for liodon / implant-ai (Hugging Face
unreachable from the sandbox) and orthodontic-ai (gated Drive link). Their PARTIAL status
is the *correct* state — §39: a stop condition is reported, not bypassed.

---

## 20. Performance baseline & deferred work

**Baseline (sandbox infrastructure — NOT the target machine, NOT accuracy)**
(`ai-validation/meshsegnet/reports/phase5_benchmark_summary.json`, produced by
`scripts/bench-local-ai-phase5.ts`):

| Engine | Cold first | Warm median (n=5) | Warm p95 | Peak RSS | Params | Model load |
|---|---|---|---|---|---|---|
| meshsegnet-max | 12,496 ms | 11,348 ms | 11,578 ms | 1,844 MB | 1,799,140 | 74 ms |
| meshsegnet-man | 16,262 ms | 9,609 ms | 9,825 ms | 1,737 MB | 1,799,140 | 74 ms |

These are real CPU inference latencies for a 10k-cell decimated full-arch mesh on
2 vCPU — on the target 13900H they are expected to be substantially faster (higher
IPC, more cores), but **no target number is claimed until the operator runs the same
harness there** (the script + runner are the deliverable for that run). Latency is
separated from accuracy by construction: the summary's disclaimers state that nothing
here implies clinical accuracy. **[VERIFIED for sandbox numbers; DEFERRED for target run]**

**Deferred (explicit owners, no silent scope creep):** clinical-accuracy evaluation
(needs reference-annotated data — a later phase, §35 matrix row); CBCT volume
segmentation (no engine — would be a new DISCOVERED→… pipeline); target-hardware
baseline run (operator); liodon/implant/orthodontic weight fetch + re-run of this same
gate the moment the sources become reachable (the gate will then promote them or record
the exact new failure — no manual status edits).

**§36 single gate: 🟡** — complete, tested architecture with real-inference-verified
engines for the mesh capability class; the remaining engines are legitimately
externally blocked, each with its exact blocker recorded (§19), and nothing is claimed
beyond the evidence.

---

## File map

| Path | Role |
|---|---|
| `ai/orchestrator/app/{registry,capability_matrix,lifecycle,main,provenance,storage,validation,db}.py` | FastAPI orchestrator (source of truth) |
| `ai/orchestrator/tests/` | 66 orchestrator tests |
| `ai/engines/{meshsegnet-max,meshsegnet-man,liodon,implant-ai,orthodontic-ai}/` | engine code (mesh engines: `engine_modified: false` in evidence) |
| `lib/ai/engines/{types,capability-matrix,local-ai-service,orchestrator-source}.ts` | TS abstraction layer (typed, no `any`) |
| `lib/ai/agent/{classifier,planner,loop,tools}.ts` + `app/api/ai/agent/route.ts` | Phase 3 agent integration (capability tool, deterministic paths) |
| `tests/unit/engines-*.test.ts`, `tests/unit/agent-local-ai-integration.test.ts`, `tests/harness/local-ai-fixtures.ts` | TS contract/integration/evidence tests |
| `ai-validation/meshsegnet/scripts/run_phase5_evidence.py` | real-inference evidence runner |
| `ai-validation/meshsegnet/reports/phase5_real_inference_{max,man}.json`, `phase5_benchmark_summary.json` | committed machine-readable evidence |
| `scripts/bench-local-ai-phase5.ts` | benchmark summarizer (offline, deterministic) |

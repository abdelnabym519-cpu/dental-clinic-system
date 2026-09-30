# DENTORA AI — Phase 10: Voice Layer & Robot Presentation (Arabic/English Voice Interface on the SAME Agent)

> **Status: COMPLETE IN SANDBOX — NOT production-ready.** All gates defined in
> this document pass at the SANDBOX label. Nothing here is a clinical or
> deployment claim. Phase 11 (deployment hardening) and Phase 12 (clinical
> certification) are explicitly **not started**.
>
> Baseline: Phase 9 commit `e24fb541e2f91c7162f1540f67f119c1c7fbfcb3`.
> Environments: Node v22.22.3, Vitest 2.1.9, Python 3.11.2, Arena sandbox (2 vCPU class).

---

## 1. Executive Summary

Phase 10 adds a **voice and robot interaction layer** on top of the existing
DenToRa Agent — no second agent, brain, memory, graph, RAG, evaluation, or
observability stack was created. A patient-facing/staff-facing microphone (and
the robot's body) now drive the **same `runAgent` loop** (loop.ts:373), the
**same approval ledger**, the **same tenant/role enforcement**, the **same
Conversation Memory**, and the **same Phase 7 evaluation/replay harness**.

Delivered, end to end:

- a **typed voice session state machine** (11 states, explicit legal-edge
  table, fail-closed transition errors);
- **STT/TTS provider abstractions** with an honest provider registry
  (10 entries: 2 REAL_INFERENCE_VERIFIED locally in this sandbox, 1
  runtime-dependent browser default, 4 BLOCKED with evidence, 1 UNAVAILABLE,
  plus browser/null markers) — local-first by design, honest BLOCKED reporting;
- **transcript-as-untrusted-input**: sanitization (zero-width/bidi/control
  stripping), bounded length, partial-transcript rejection, and an agent
  message contract that preserves the agent's own Arabic routing
  (`prepareAgentMessage` = sanitize + Arabic-Indic digit fold ONLY);
- **dental entity resolution over the existing graph** (patients via the
  existing fake/real Prisma boundary; FDI teeth via the existing
  `isValidFdi` contract; Arabic-Indic numerals; Arabic spoken numbers) with
  **clarification-instead-of-guessing** semantics (36/63 STT confusion,
  duplicate patient names, ≤5 bounded candidates);
- **barge-in/interruption** (استنى / اسكت / كفاية / stop / wait), **cancellation**
  (خلاص / الغيها / cancel), and **duplicate-action protection** (sha256
  tenant:user:fingerprint, 8 s window, action-history-aware);
- **explicit attributable confirmation** for sensitive actions: a bare
  "yes/ok/ايوه" is never a confirmation; the confirm phrase must coincide with
  a bound, unexpired `WAITING_APPROVAL` binding; the final grant always
  belongs to the Phase 1 ledger;
- **PHI-minimized telemetry** (fingerprint + char count + stage timings; no
  raw audio, no full transcripts in audit/telemetry);
- a **Robot presentation component** (9 visual states driven by the canonical
  `InteractionState`, ARIA/keyboard/reduced-motion/contrast, 4 sizes
  sm/md/lg/kiosk) plus a companion panel and a Web Speech hook —
  all presentation-only, fully synced to real session state;
- **evaluation**: 14 synthetic voice goldens replayed through the REAL agent
  over the fake boundary, a 4-test gate, an adversarial security suite
  (14/14 fail-closed), and a SANDBOX-labeled performance bench (9 records).

**Final gates:** `vitest` **5,969 passed / 12 skipped / 0 failed** (318 files;
baseline 5,822/12 → **+147 tests**). `tsc --noEmit` **503 errors — byte-identical
set to the pre-existing environment baseline, 0 new**.

## 2. Scope & Boundary

**In scope:** voice session lifecycle; transcript trust pipeline; dental entity
resolution for speech; STT/TTS abstractions + local provider audit; duplicate
and confirmation safety for spoken actions; robot UI synced to real state;
voice goldens extending Phase 7 replay; adversarial voice security; SANDBOX
benchmarks; this report.

**Out of scope (untouched):** the agent loop, task classification, policy
engine, approval ledger, knowledge/RAG, context engine, observability core,
Phase 9 intelligence/workflows. The existing `components/ai/voice-orb` and its
test, and `hooks/use-web-voice.ts`, were **not modified** (chat page keeps its
existing orb; the robot adds a new surface on the AI Companion page).

**Explicit non-goals:** always-on ambient listening; speaker biometrics;
raw-audio persistence; a new conversation store; real-time streaming STT to
the server.

## 3. Discovery & Audit (schema-first)

Discovery followed the Phase 9 pattern — read the integration surface before
writing code:

- **Agent entry:** `runAgent(request, deps)` — `lib/ai/agent/loop.ts:373`;
  request carries `actor/hospitalId/message/patientId/toothFdi/source`;
  statuses: COMPLETED / CLARIFICATION_REQUIRED / PENDING_APPROVAL /
  DRAFT_CREATED / NOT_EXECUTED / FAILED.
- **Authn/z:** `requireAuthAndRole` (api-helpers) — server session only;
  `STAFF_ROLES = ['SUPER_ADMIN','ADMIN','DOCTOR','RECEPTIONIST']`;
  patient scope re-validated server-side (fail-closed).
- **Approvals:** Phase 1 ledger (`resolvePolicy` at action-policy.ts:421);
  params only ever from the stored row — voice can *request* and *surface*,
  never *grant*.
- **Persistence:** `AIConversation` (messages/context JSON) and `AuditLog`
  (action/entityType/newValues) — voice reuses both; no new store.
- **FDI:** existing `fdi.isValidFdi` (permanent set) reused as the tooth
  contract.
- **Phase 7 harness:** `tests/harness/agent-fixtures` (AGENT_ROWS,
  `createAgentFakePrisma`, HOSP_A/HOSP_B, ACTOR_FOR_ROLE) and the golden
  schema — extended additively, not forked.
- **i18n:** `locales/{ar,en}.json` (5,697 keys at baseline) + reverse-index
  translation; API prose must be Arabic-resolvable (existing gate).

**Audit finding fixed en route:** the harness's mini where-engine
(`tests/harness/context-fixtures.ts`) documented "real where/orderBy/take
semantics" but lacked top-level `OR`/`AND` and `contains`/`equals`/
`startsWith` string operators that production Prisma code (and the voice
patient resolver) relies on. Extended **additively**; all pre-existing
behavior preserved (54 harness-consuming tests re-verified green).

## 4. Key Design Decisions

1. **The agent receives natural text.** `prepareAgentMessage(raw)` = sanitize
   + Arabic-Indic→ASCII digit fold **ONLY**. Letter folding/ى→أ normalization
   is **resolution-only**. Rationale (measured, §29): feeding the agent
   letter-normalized Arabic broke its own deterministic routing
   (OUT_OF_DOMAIN on a valid operational query); feeding it the folded form
   fixed routing while keeping resolvers normalization-aware on their side.
2. **Server owns state transitions; client owns SPEAKING playback.** The
   server replays end agent/clarification turns in LISTENING; the browser
   hook emits PLAYBACK_ENDED when TTS audio finishes, which legally completes
   the turn. This keeps the state machine honest without a server-side audio
   clock.
3. **Duplicate protection keys on meaning, not audio.** sha256 over
   `tenant:user:normalized-transcript` with a rolling 8 s window that only
   suppresses when the prior identical utterance **led to action** (task
   `actionRequested` / non-read-only). Read-only repeats are allowed —
   re-asking "who is in the queue" must work.
4. **Confirmation is a state, not a word.** Explicit confirm lexicon
   (أكد / تأكيد / أكيد / confirm…) must co-occur with `state=WAITING_APPROVAL`
   and an unexpired `pendingApprovalId` bound to the SAME session. A bare
   affirmation is routed to the agent as ordinary speech.
5. **Clarify, never guess** (§10/§11): tooth 63 hears → offer "36 ولا السن 63"
   (the heard non-FDI form is always displayed); duplicate patient names →
   list ≤5 candidates verbatim; unknown names → explicit NOT_FOUND ask.
6. **PHI-minimized observability:** audit rows carry ids, state, op, codes,
   and timings — never transcript text, never audio. Local evidence files
   contain synthetic commands only.
7. **Robot is a view of truth.** `robotStateFor(InteractionState)` is the ONE
   mapping (§34); the robot cannot "look busy" without a real PROCESSING
   state.

## 5. Voice Session State Machine (`lib/ai/voice/types.ts`, `session.ts`)

- States: `IDLE, LISTENING, TRANSCRIBING, UNDERSTANDING, PROCESSING,
  WAITING_APPROVAL, SPEAKING, INTERRUPTED, COMPLETED, ERROR, CANCELLED`.
- `INTERACTION_STATE_TRANSITIONS` is an explicit adjacency table;
  `transitionSession` throws typed `VoiceStateTransitionError`
  (`VOICE_STATE_TRANSITION_INVALID` with from/to) on any other edge —
  fail closed.
- Notable legal edges: `IDLE→UNDERSTANDING` (typed text / first turn),
  `ERROR→UNDERSTANDING` (recovery), `UNDERSTANDING→SPEAKING`
  (short-circuit answers: duplicate notices and clarification acks speak
  without a PROCESSING round-trip), any active state→`CANCELLED`;
  `CANCELLED` is terminal (empty out-edge set).
- TTLs (constants in types): session 15 min (refresh on activity),
  duplicate window 8 s, confirmation binding 30 s, transcript retention
  600 s; store sweeps expired rows; `pendingApprovalId` is cleared on every
  quiet/terminal transition.
- Sessions bind `(voiceSessionId, userId, tenantId)` — every read/mutation
  re-verifies the binding; a mismatch returns null/invalid (never another
  user's session).

## 6. Transcript Trust Pipeline (`normalize.ts`, `security.ts`)

`VoiceTranscript { text, confidence, isFinal, providerId, locale? }` — typed
STT output is the ONLY thing the HTTP contract accepts (§41: no raw audio in
the API layer, by construction).

1. **`sanitizeTranscript`**: NFC; strips zero-width (U+200B–200D, FEFF),
   bidi controls (U+202A–202E, U+2066–2069) and C0 controls; rejects
   non-strings (`VOICE_TRANSCRIPT_UNSAFE`), empty (`…_EMPTY`), >600 chars
   (`…_TOO_LONG`).
2. **Partial transcripts are never valid** (`isFinal=false` →
   `VOICE_TRANSCRIPT_PARTIAL`) — the pipeline refuses them before any
   resolution or agent call (tested: the agent runner is not invoked).
3. **`normalizeTranscript`** (resolution-only): Arabic-Indic ٠-٩ and extended
   ۰-۹ → ASCII digits; tashkeel/tatweel strip; conservative hamza fold
   (أإآ→ا, ة→ه, ى→ي); reports digit fold count.
4. **`prepareAgentMessage`** (agent-facing): sanitize + digit fold only —
   case and Arabic letter forms preserved (§4.1).
5. **`validateTranscriptSafety`** composes the above and returns the language
   tag (`ar | en | mixed`) from `detectTranscriptLanguage`.

## 7. STT Providers (`stt.ts`) + Registry Audit (`providers.ts`)

Abstraction: `SttProvider.transcribe(input) → { text, confidence, isFinal,
providerId, language, meta? }`.

| providerId | engine | status (this sandbox) |
|---|---|---|
| `web-speech-stt-browser` | Web Speech (client device) | RUNTIME_VERIFIED as a *client-side* default; server-side refusal is by design (`WEB_SPEECH_IS_CLIENT_SIDE`) |
| `pocketsphinx-local-stt` | PocketSphinx en-us, JSGF grammar mode | **REAL_INFERENCE_VERIFIED** — grammar decode ≈25–29 ms vs ≈574–764 ms open dictation on synthetic speech; sha256 of wheel + model recorded in EVIDENCE.json |
| `vosk-local-stt` | Vosk | **BLOCKED** — model host unreachable (huggingface.co UNREACHABLE) |
| `whisper-cpp-local-stt` | whisper.cpp | **BLOCKED** — same |
| `faster-whisper-local-stt` | faster-whisper | **BLOCKED** — same |
| `fixture-stt` | scripted | eval/replay only (never shipped as a real transcript source) |

- Command STT boundary: argv-only spawn (no shell), 10 MB audio cap, 30 s
  runtime cap, 64 KB stdout cap, JSON contract `{text, confidence, isFinal}`;
  grammar flag passed through for bounded-command engines; stdin is fed
  **before** awaiting exit (pipe-deadlock fix, §38).
- Opt-in via `DENTORA_VOICE_STT_CMD`; unset ⇒ browser default (no silent
  local installs).
- Registry entries carry: engine, version, locale support, runtime, privacy
  mode (`EXTERNAL_TRANSPORT` for browser STT), offline capability,
  sha256/provenance for verified artifacts, latency evidence, and explicit
  `limitations[]` — the rule **no silent gaps** is unit-enforced.

## 8. TTS Providers (`tts.ts`)

| providerId | engine | status |
|---|---|---|
| `web-speech-tts-browser` | speechSynthesis (client) | default; text passes through untouched |
| `mespeak-local-tts` | meSpeak (espeak-ng WASM build) | **REAL_INFERENCE_VERIFIED** — round-trip TTS→STT EXACT 3/3 on the tuned voice `{speed:130, wordgap:3, pitch:50, variant:'f2'}` (without pitch/variant only the first word survived) |
| `piper-local-tts` | Piper | **BLOCKED** — model host unreachable |
| `espeak-ng-local-tts` | espeak-ng | **UNAVAILABLE** — npm WASM package ships zero voice data; @echogarden build does not exist (404) |
| `null-tts` | none | headless/CI honest empty |

**Speakable shaping** (`speakableFromResponse`, 800-char default): strips
markdown tables/fences/emphasis/citation URLs while **preserving uncertainty
and hedge wording verbatim** ("Possible", "uncertain", "لا يمكن الجزم") —
TTS must never add certainty the text did not have (unit-tested in both
directions). Numbers are preserved exactly (doses, amounts).

## 9. Arabic/English/Mixed Language Handling

- `detectTranscriptLanguage` classifies `ar | en | mixed` (Arabic-dominant
  with Latin tokens ⇒ mixed); locales `ar-EG` (default) and `en-US`.
- Arabic-Indic digits (٠-٩, ۰-۹) fold for resolution but reach the agent in
  their original (folded-digits, natural-letters) form.
- Spoken-number tables: Arabic Egyptian clinical forms (ستة وتلاتين…,
  keys stored in NORMALIZED letter form) and English (thirty six…), bounded
  to dental-relevant ranges — extraction is table+digit based, never LLM.
- Bounded bilingual clarification texts ship in code (`toothClarification`,
  `patientClarification`) and in i18n for UI chrome; all Arabic strings
  reviewed for MSA+Egyptian clinical register.

## 10. Dental Entity Resolution — Patients (`entity-resolution.ts`)

`resolvePatientReference(client, tenantId, hint)` — tenant-scoped `findMany`
through the SAME Prisma boundary the agent uses:

- **exact** full-name match (normalization-aware both sides) → RESOLVED;
- unique **contains** match → RESOLVED (JS-side verify via
  `normalizeTranscript`);
- 2–5 candidates → `PATIENT_AMBIGUOUS` clarification listing names verbatim;
- >5 → ambiguous with count (never a wall of PHI);
- 0 → `PATIENT_NOT_FOUND` ("ممكن تتأكد من الاسم أو رقم المريض؟") — an honest
  fail-safe, not an error;
- no name marker in the utterance → `NOT_REQUESTED` (agent answers
  generically).

**Known gap (declared, not hidden):** no Arabic↔English transliteration —
an Arabic hint ("احمد") cannot match Latin-only rows ("Ahmed Ali"); the
resolver correctly returns NOT_FOUND rather than guessing. Workaround today:
seed/store the name form used by the speaker (Arabic rows resolve exactly);
NEXT ACTION: bounded transliteration table + stored pronunciation alias
(§38).

Name hints come from a **bounded lexicon** (`المريض/حالة المريض/patient/mr/ms…`)
with an Arabic stop-word filter (عنده/في/… — note علي/على are real names and
are NOT stop words); Arabic letter class `[\u0621-\u064A]` explicitly
excludes Arabic punctuation (؟ ، ؛ live in U+0600–U+06FF but are NOT letters);
hints are extracted from the **agent-facing sanitized original**, never from
the letter-folded text.

## 11. Dental Entity Resolution — Teeth (FDI via the existing contract)

- Direct digits: `isValidFdi` (permanent set) gate → RESOLVED (36, 46, …).
- **STT reversal confusion** (the classic لِثة/سن 36↔63 class): when the
  heard number is INVALID but its digit-reversal is a valid FDI number,
  the resolver returns `AMBIGUOUS [validTwin]` and the clarification always
  offers BOTH forms — "تقصد السن 36 ولا السن 63؟" — including the heard
  non-FDI form (63 is not in the permanent set; hiding it would gaslight
  the speaker).
- Both-forms-valid numbers (42) stay literal (42 IS a valid FDI tooth).
- Spoken forms resolve through the bounded tables (§9); `NOT_FOUND` numbers
  (e.g. "tooth 99") ask explicitly.

## 12. Speakable Response Shaping

See §8 (`speakableFromResponse`). Additionally: clarification questions and
approval prompts are authored as speakable-first bilingual strings; the
pipeline returns `speakableText` (≤800 chars) and `displayText` separately,
so the robot never reads raw markdown aloud.

## 13. Interruption / Barge-in (`op: 'INTERRUPT'` / spoken phrases)

- Control lexicon (matched on normalized text, defensive re-normalize):
  INTERRUPT استنى/اسكت/كفاية/وقف/stop/wait; CANCEL خلاص/الغيها/إلغاء/cancel;
  CONFIRM أكد/تأكيد/أكد/confirm — matched BEFORE the agent and before
  entity resolution.
- `INTERRUPT` from SPEAKING → `INTERRUPTED` with `interruptionCount++`
  (telemetry); client hook stops `speechSynthesis` immediately on state.
- `CANCEL` is terminal-safe from any active state and clears any pending
  approval binding (tested).
- PLAYBACK_ENDED from SPEAKING → COMPLETED; PLAYBACK_ENDED elsewhere is
  ignored (idempotent client events).

## 14. Explicit Attributable Confirmation (§15)

- `assessVoiceConfirmation(phrase, session, now)` requires ALL of:
  explicit verb in the utterance; `session.state === 'WAITING_APPROVAL'`;
  `pendingApprovalId` present and unexpired; last activity within the
  30 s confirm window.
- A bare "ايوه / yes / ok" NEVER matches the confirm lexicon (unit-tested).
- A confirm with no pending binding is inert (`CONFIRM_WITHOUT_PENDING_APPROVAL`)
  — the TTS-echo/stray-speech defense.
- The pipeline never grants approval itself: on a valid confirm the turn
  re-enters the agent; the approval decision itself remains a Phase 1 ledger
  action (the robot panel posts to the existing
  `/api/ai/approvals/[id]` with `{decision}`).
- `WAITING_APPROVAL` voice turns speak a confirmation prompt containing
  "أكد" and surface a typed approval card (id, action, risk, params preview).

## 15. Anti-Spoof / Background-Speech Defenses

- **TTS echo**: the robot's own spoken prompts are ordinary audio; even if
  they loop back through the mic, a confirm phrase without a live binding is
  inert (§14) and an expired binding is rejected (tested in the adversarial
  suite with a force-expired binding).
- **Partial transcript injection**: interim hypotheses cannot act (§6.2).
- **Cross-user replay**: fingerprints bind tenant+user — replaying another
  user's audio in your session keys a DIFFERENT fingerprint; and session ids
  are actor-bound (§16), so a stolen session id is useless across users.
- **Bidi/zero-width smuggling**: stripped at sanitize; the stripped text is
  still treated as DATA by the agent (tested: no control chars in any
  surface text).

## 16. Duplicate-Action Protection (§17)

- `transcriptFingerprint(text, tenantId, userId)` = sha256 over
  `tenant:user:normalized` (16 hex) — cross-tenant/user strings cannot
  collide (unit-tested).
- `assessDuplicate(...)` suppresses only when an identical fingerprint
  recurs within 8 s **and** the prior occurrence `ledToAction` — where
  `ledToAction` includes the agent task's `actionRequested` flag and
  non-read-only execution modes.
- Suppressed turns return `duplicateSuppressed: true`, a spoken notice
  ("I just heard that command — I will not repeat the action…"), state
  SPEAKING, and **agentStatus null** — the agent is provably not re-invoked
  (call-count tests).
- Golden VCE-INT-009 exercises the full two-turn flow through the REAL
  agent; the window reset helper supports multi-tenant tests.

## 17. Voice → Agent Integration (the SAME loop)

`runVoiceTurn(deps, call)` (pipeline.ts): get-bound-session (fail-closed
`VOICE_SESSION_INVALID`) → op guard (INTERRUPT/PLAYBACK_ENDED/CANCEL short
paths) → SPEAK: safety (§6) → control phrases (§13) → confirmation binding
(§14) → duplicate suppression (§16) → entity resolution (§10–§11; clarify,
never guess) → **`deps.agent.runAgent(agentRequest(...))` with
`source:'voice'`, requestId `vturn-<session>-<turn>`, resolved patientId /
toothFdi, and message = `prepareAgentMessage(text)`** → response mapping:
PENDING_APPROVAL→WAITING_APPROVAL (+typed approval view + spoken prompt),
CLARIFICATION_REQUIRED→LISTENING(+clarification), COMPLETED→SPEAKING,
FAILED→ERROR (honest Arabic apology + code), exceptions→
`VOICE_AGENT_ERROR` on the session (never thrown past the boundary; the
session records the typed error and stays recoverable via ERROR→UNDERSTANDING).

## 18. RBAC Through Voice (§18)

Voice adds **no** authorization path: actor+tenant come from the server
session (`requireAuthAndRole`); the agent re-enforces policy exactly as for
typed chat. Golden VCE-SEC-012 (RECEPTIONIST, invoice command) and the
adversarial suite prove the agent's safety refusal survives the voice path
("This action is not permitted for your role… It was not executed.");
tenant isolation is tested at resolver, session, and agent levels.

## 19. API Surface (§37) — typed, audio-free, rate-limited

- `POST /api/ai/voice/session` → binds the session to the server-session
  actor, reuses the latest tenant `AIConversation` (existing memory — never
  a new store), audits `AI_VOICE_SESSION` (non-blocking).
- `DELETE /api/ai/voice/session` → idempotent teardown.
- `POST /api/ai/voice/turn` → body `{voiceSessionId, op?, transcript?}`;
  **raw audio is structurally inadmissible** (typed transcript contract
  only); unknown ops default to SPEAK; SPEAK without a typed transcript →
  400; rate limit 60 turns/min/user via the existing audit-log counter
  (`AI_VOICE_TURN`); response is the typed `VoiceTurnResponse`
  (`state, speakableText, displayText, clarification, approval, agentStatus,
  taskType, duplicateSuppressed, interrupted, telemetry, error`).
- `GET /api/ai/voice/providers` → the audited registry (machine-readable
  honesty for ops/UI).
- Route contract tests: actor binding (client cannot spoof tenant/role),
  malformed JSON/ids rejected, rate limit 429, PHI-min audit payload.

## 20. Robot Presentation Component (`components/robot/dentora-robot.tsx`)

Premium futuristic medical AI: white/silver body, dental-blue accents,
expressive digital eyes (state-specific eye shapes), antenna pulse while
listening, tooth motif; decorative art is `aria-hidden`. Nine robot states
(idle, listening, thinking, speaking, interrupted, waiting-approval,
warning, error, success) driven ONLY by `robotStateFor(InteractionState)`
— including TRANSCRIBING/UNDERSTANDING/PROCESSING→thinking and
CANCELLED→idle. Sizes sm 96 / md 160 / lg 240 / kiosk 320 px.

## 21. Robot Panel & Hook (`robot-panel.tsx`, `use-dentora-voice.ts`)

- Panel: TTS toggle (Voice replies On/Off), mic start/stop, typed-text
  fallback input (same pipeline, `providerId 'text-input'`), clarification
  quick-answers, approval card (POST to the existing approvals API),
  transcript display of interim hypotheses as DISPLAY-ONLY text.
- Hook: Web Speech recognition (ar-EG/en-US by locale), final transcripts
  POST to `/api/ai/voice/turn`; `onend` after speech ⇒ PLAYBACK_ENDED;
  interruption stops synthesis and posts INTERRUPT; state mirrors the
  server response (client never invents state).

## 22. Accessibility (§26) — mandatory, tested

- `role="status"` + `aria-live="polite"` + required `statusLabel` (spoken
  state meaning); SVG and glow are `aria-hidden` — screen readers get TEXT.
- Keyboard: the robot renders no button trap; interaction lives in the
  panel (mic button and inputs are standard focusable controls); text
  fallback provides a full no-mic path.
- Reduced motion: OS `prefers-reduced-motion` AND explicit prop —
  eye/glow/antenna animations suppressed (unit-tested: zero `<animate>`
  pulse elements under reducedMotion).
- Contrast: every state carries a text label; status colors are accents,
  never the only signal.

## 23. Responsive / Kiosk (§25)

sm/md/lg for dashboard contexts; `kiosk` (320 px) for reception tablets.
Layout is a single flex column — survives RTL mirroring (`dir` from i18n)
and low-DPI kiosk displays; no absolute-positioned text.

## 24. Security Model Summary

| attack class | defense | tested |
|---|---|---|
| prompt injection via speech | transcript is DATA; agent policy re-enforced; no tenant-wide dump/credentials in any response | golden SEC-011 + adversarial suite |
| fake/echo confirmation | binding requirements (§14/§15) | unit + adversarial |
| duplicate/replayed audio | fingerprint+window+action-history (§16) | unit + adversarial |
| cross-session/tenant | actor-bound sessions; tenant-scoped resolvers | unit + adversarial |
| oversized/malformed input | caps + typed contracts + fail-closed codes | unit + adversarial |
| privilege escalation by voice | no new authz path; agent safety block | golden SEC-012 + adversarial |
| PHI leakage via telemetry | fingerprint+counts+timings only | route contract tests |

## 25. i18n / Arabic-first (§39)

Locales grew 5,697 → **5,700 keys (parity ar/en)**: voice/robot UI strings
and three new API literals ("Voice session not found",
"voiceSessionId is required", "transcript is required for SPEAK turns")
registered so the existing **API-prose Arabic-resolvability gate** passes
(this surfaced in the full-suite run and was fixed, not waived). Voice
clarifications are bilingual at the source; the robot/panel strings resolve
through the standard dictionary (fallback = key, never empty).

## 26. Memory Boundary (§27)

Voice sessions are ephemeral state (15 min TTL, in-memory singleton store —
`session-store.ts`, explicitly marked for a Phase 11 durable swap if ever
needed). Long-term memory remains `AIConversation` + the existing memory
layer; the voice path REUSES the conversation (session route attaches the
latest tenant conversation id) and adds nothing parallel.

## 27. Local-AI Boundary (§29)

Local STT/TTS engines run **opt-in on the operator's machine** via argv
command boundaries (`DENTORA_VOICE_STT_CMD/TTS_CMD`), never bundled, never
auto-downloaded; verified artifacts carry sha256 provenance in the registry
and EVIDENCE.json. The SANDBOX verification used a temporary venv
(`/tmp/dentora-voice-venv`) — no Python deps were added to the app;
`tools/voice/verify-local-voice.sh` is re-runnable evidence.

## 28. Evaluation — Synthetic Voice Goldens (§31–§32)

`lib/ai/evaluation/voice-replay.ts`: zod-typed voice golden schema
(per-case in-memory session store + fake clock; per-turn observations:
states, clarificationCodes, duplicateSuppressed, interrupted,
approvalRequired, agentStatus, taskType, speakable/display text with
`rx:` must-contain support) — replaying through the REAL agent via the
Phase 7 `buildReplayAgentDeps` boundary.

**14 goldens** (`tests/evaluation/golden/voice-interaction.golden.json`),
all green:

| id | class | asserts |
|---|---|---|
| VCE-AR-001 | Arabic operational query | real agent routing (waiting queue), tenant-scoped |
| VCE-AR-002 | ٦٣ STT-confusion | clarification offers 36 AND 63 (heard form preserved) |
| VCE-AR-003 | Arabic patient+tooth | resolver resolves منى; honest "not recorded" answer (no invented findings) |
| VCE-EN-004 | English operational | same agent routing as typed chat |
| VCE-EN-005 | clinical query via voice | agent-parity: CLINICAL_ANALYSIS/COMPLETED with honest no-evidence answer; must-not-contain guess guards |
| VCE-AR-006 | two Ahmeds | PATIENT_AMBIGUOUS lists احمد علي / احمد سعيد (Arabic-seeded rows) |
| VCE-MIX-007 | mixed AR/EN | routing intact on code-switched speech |
| VCE-INT-008 | barge-in استنى | INTERRUPTED, agent not left running |
| VCE-INT-009 | duplicate sensitive command | turn 2 suppressed, agentStatus null |
| VCE-INT-010 | cancel خلاص الغيها | terminal-safe, binding cleared |
| VCE-SEC-011 | spoken prompt injection | deflected; no PAY-/INV- leakage |
| VCE-SEC-012 | RECEPTIONIST financial | agent safety refusal (not permitted) |
| VCE-SEC-013 | weather chatter | stays out of the dental domain |
| VCE-AR-014 | تسوس terminology | deterministic clarification path; no invented advice |

**Golden-alignment discipline:** expectations were aligned ONLY to verified
deterministic behavior (debug-run evidence per case); safety semantics
(must-not-contain, refusal, no-approval) were never weakened. Server replays
end agent/clarification turns LISTENING (client owns SPEAKING) — goldens
encode the server-observable truth.

Gate test `tests/evaluation/voice-robot-eval.test.ts` (4 tests): dataset
validity (≥12 cases, ar/en/mixed coverage, required tags), eval-all
(no-FAIL ≥20 checks), honesty replay of security cases (duplicate ⇒
agentStatus null; never WAITING_APPROVAL grants), and the
`P10_VOICE_ROBOT` overall verdict.

## 29. Debug Evidence Trail (selected, reproducible)

- Letter-normalized Arabic to the agent ⇒ OUT_OF_DOMAIN; agent-facing
  `prepareAgentMessage` fix ⇒ AR-001/AR-002/AR-014 green.
- `resolveToothReference('ركز على السن ٦٣')` was AMBIGUOUS [36] with the
  heard form hidden by an `isValidFdi` display gate ⇒ reversal display
  de-gated (Number.isInteger) ⇒ "36 ولا السن 63".
- `extractPatientNameHint('المريض منى عنده…')` originally captured عنده as a
  surname (U+061F ؟ inside \u0600-\u06FF broke token classes) ⇒ letters-only
  class + stop-word list.
- VCE-AR-003 FAILED: seeded row lacked `patientCode` fields after a fixture
  merge bug (Python `dict.update` overwrote `patientId: null`) — identity
  contract correctly rejected it; fixed the fixture, kept the contract.
- Identical clinical message through `replayAgentCase` and
  `replayVoiceCase` yields the SAME status/task/answer ⇒ EN-005 golden
  aligned to agent parity.
- Command-provider pipe deadlock (stdin ended after close) found by the
  provider unit tests and fixed in both STT and TTS (feed stdin before
  awaiting exit).

## 30. Adversarial Voice Security — 14 cases, all fail closed

`tests/unit/voice-adversarial-security.test.ts` (REAL pipeline + REAL agent
over the fake boundary): spoken injection (AR + EN roleplay) deflected with
no credential/tenant dump; fake confirmation inert; TTS-echo confirm against
a force-expired binding rejected; cross-USER and cross-TENANT session access
→ `VOICE_SESSION_INVALID`; RECEPTIONIST money movement refused by the agent;
oversized transcript rejected pre-agent; bidi smuggling stripped; unknown
STT provider ids still bounded by trust rules; confidence-0 garbage cannot
execute; rapid-fire sensitive repeats suppressed (≥1 suppression across 3
identical turns, at most one agent entry); near-duplicates (case/spacing)
stay inert.

## 31. PHI-Minimized Observability (§20)

- Audit (`AI_VOICE_TURN`): state, op, agentStatus, taskType,
  duplicateSuppressed, error code, totalMs, approvalRequired — **no
  transcript text, no audio references** (route test asserts the serialized
  payload excludes the spoken content).
- Voice telemetry object: env label, transcript CHAR COUNT (not content),
  stage timings (stt/agent/tts/total), interruption count, approval flag.
- Local evidence files contain only synthetic commands ("show patient
  ahmed"…) — no real patient audio was ever processed or stored.

## 32. Performance (§36) — SANDBOX-labeled only

`tests/evaluation/voice-robot-perf.test.ts` uses the existing Phase 7
`benchmark()`/environment-label harness (SANDBOX; artifact written only on
explicit `DENTORA_WRITE_BENCH=1` →
`ai-validation/voice-local/benchmarks-sandbox.json`). Medians (SANDBOX,
fake agent boundary — isolates the VOICE LAYER cost, not LLM latency):

| record | median | p95 |
|---|---|---|
| transcript trust (sanitize+validate) | 0.03 ms | 0.08 ms |
| normalize | 0.02 ms | 0.04 ms |
| prepareAgentMessage | 0.01 ms | 0.01 ms |
| tooth resolution | 0.05 ms | 0.14 ms |
| duplicate assessment | 0.01 ms | 0.08 ms |
| speakable shaping | 0.01 ms | 0.02 ms |
| **full informational turn (real pipeline+agent, fake boundary)** | **0.45 ms** | 0.73 ms |
| duplicate-suppressed turn | 0.06 ms | 0.21 ms |
| session ops | ~0 ms | 0.02 ms |

Local engines (same SANDBOX, real inference): pocketsphinx grammar decode
≈25–29 ms (vs ≈574–764 ms open dictation — and open dictation on synthetic
speech is NOT accurate evidence, per §38); meSpeak synth + round-trip EXACT
3/3 with the tuned voice. **No target-machine claims are made anywhere**
(env-label guard enforced in test).

## 33. Provider Audit — STATUS/BLOCKER/EVIDENCE/IMPACT/WORKAROUND/NEXT ACTION

| item | status | blocker / evidence | impact | workaround | next action |
|---|---|---|---|---|---|
| PocketSphinx STT (en) | REAL_INFERENCE_VERIFIED | EVIDENCE.json: grammar 25–29 ms decode; wheel+model sha256 recorded | English command-mode local STT works today | — | Arabic acoustic model needs huggingface/alphacephei |
| meSpeak TTS (en voice data) | REAL_INFERENCE_VERIFIED | round-trip 3/3 EXACT ({130,3,50,f2}); GPL tool, optional, not bundled | local English TTS | — | Arabic voice data hunt post-unblock |
| Vosk / whisper.cpp / faster-whisper / Piper | BLOCKED | huggingface.co + alphacephei.com UNREACHABLE from sandbox (verified in EVIDENCE.json) | no AR local models validated | browser Web Speech default; command boundary ready | retry on the target machine with network |
| espeak-ng WASM | UNAVAILABLE | npm package ships zero voice data; @echogarden build 404 | — | meSpeak (same engine family) | drop or vendor data |
| Arabic local STT/TTS | BLOCKED | same hosts; Arabic bundles unreachable | voice AR currently via browser engines | ar-EG Web Speech | validate on TARGET_MACHINE |
| `npx prisma generate` | BLOCKED (pre-existing) | binaries.prisma.sh TLS refused ×5 | typed client is a stub in THIS sandbox; runtime unaffected | tests use the fake boundary; routes cast the client | regenerate on target machine |
| Browser Web Speech STT | RUNTIME_DEPENDENT | headless cannot verify; vendor cloud transport | production AR accuracy unmeasured | transcript trust + confirm flow mitigate | instrument via voice telemetry in prod clients |

## 34. One Mapping, One Truth (§34)

`InteractionState` (server) → `robotStateFor` → robot visual; the SAME state
drives the orb-independent robot, the panel, the hook, telemetry, and the
goldens. There is no second state enum anywhere in the voice stack
(mechanically enforced by the component test enumerating all 12
interaction states).

## 35. Files Changed (Phase 10)

**New — voice core** (`lib/ai/voice/`, ~2.9k LOC): types.ts, normalize.ts,
entity-resolution.ts, session.ts, session-store.ts, security.ts, stt.ts,
tts.ts, providers.ts, pipeline.ts.
**New — API**: app/api/ai/voice/{session,turn,providers}/route.ts;
lib/ai/agent/server-deps.ts (production deps composition).
**New — frontend**: components/robot/{dentora-robot,robot-panel}.tsx,
hooks/use-dentora-voice.ts, app/(dashboard)/ai-companion/page.tsx (+nav entry).
**New — evaluation**: lib/ai/evaluation/voice-replay.ts,
tests/evaluation/golden/voice-interaction.golden.json,
tests/evaluation/voice-robot-eval.test.ts,
tests/evaluation/voice-robot-perf.test.ts.
**New — unit/component tests (9 files, 147 tests total with goldens/perf)**:
voice-session, voice-normalize, voice-entity-resolution, voice-security,
voice-pipeline, voice-stt-tts-providers, voice-api-routes,
voice-adversarial-security, tests/components/dentora-robot.test.tsx.
**New — tooling/evidence**: tools/voice/{stt-local.py, tts-local.mjs,
verify-local-voice.sh}, ai-validation/voice-local/{EVIDENCE.json,
commands.jsgf, benchmarks-sandbox.json}.
**Modified (additive)**: lib/ai/evaluation/replay.ts (export
buildReplayAgentDeps/ACTOR_FOR_ROLE), lib/ai/evaluation/types.ts (+2 EVAL
codes), tests/harness/context-fixtures.ts (OR/AND/contains operators),
config/nav.ts (companion entry), locales/{ar,en}.json (+3 keys), .gitignore
(+.voice-local-check/).
**Untouched (verified)**: components/ai/voice-orb + its test,
hooks/use-web-voice.ts, chat page, all Phase 0–9 lib code, the 7 protected
WIP files (tracked-but-unmodified; excluded from semantic changes by
policy).

## 36. Test Matrix (§39/§40)

| suite | tests | result |
|---|---|---|
| voice-session | 8 | green |
| voice-normalize | 13 | green |
| voice-entity-resolution | 16 | green |
| voice-security | 16 | green |
| voice-pipeline (scripted agent) | 16 | green |
| voice-stt-tts-providers | 24 | green |
| voice-api-routes | 11 | green |
| voice-adversarial-security | 14 | green |
| dentora-robot (component) | 9 | green |
| voice goldens gate (eval) | 4 | green |
| voice perf (eval) | 7 | green |
| **full repo** | **5,969 + 12 skipped** | **0 failed** (318 files; baseline 5,822/12) |
| tsc --noEmit | — | 503 = pre-existing env baseline, **0 new** |
| Phase 7 gates (regression) | replay-eval | 4/4 green |

## 37. Definition of Done — checklist

- [x] Typed voice session with explicit 11-state machine; illegal
      transitions throw typed errors (fail closed).
- [x] STT/TTS abstractions; local-first; honest BLOCKED/UNAVAILABLE with
      STATUS/BLOCKER/EVIDENCE/IMPACT/WORKAROUND/NEXT ACTION; SANDBOX labels.
- [x] Transcript = untrusted input; partials never act; bidi/zero-width
      stripped; bounded length.
- [x] Dental entity resolution (patients, FDI incl. Arabic-Indic + spoken
      numbers) with clarify-never-guess.
- [x] Interruption/barge-in and cancellation lexicons.
- [x] Duplicate-action protection via fingerprints + window + action
      history (existing idempotency semantics preserved; no new store).
- [x] Explicit attributable confirmation; bare affirmations never confirm;
      voice never grants ledger approval.
- [x] PHI-minimized telemetry/audit (no raw audio, no transcripts).
- [x] Robot UI: 9 states synced to real state; ARIA/keyboard/reduced-motion/
      contrast; sm/md/lg/kiosk; Command Center data only via the
      deterministic Phase 9 Clinic Brain (LLM never invents counts — robot
      surfaces agent answers only).
- [x] Phase 7 replay extended with 14 voice goldens + gate; adversarial
      voice security suite fail-closed; perf bench SANDBOX-labeled.
- [x] Report (this document, 39 numbered sections).
- [x] One focused commit; push; remote HEAD == local HEAD.
- [ ] **Deliberately NOT claimed:** production readiness; clinical accuracy
      of speech recognition; Arabic local-model support (blocked, §33).

## 38. Honest Limitations & Failure Modes

1. **Arabic local STT/TTS models could not be validated** (model hosts
   unreachable) — AR voice today rides browser Web Speech with unmeasured
   accuracy; mitigated by trust pipeline + confirmations, not eliminated.
2. **No AR↔EN name transliteration** — cross-script patient lookups return
   an honest NOT_FOUND ask instead of a guess.
3. **Web Speech transport is external** (browser-vendor service) — privacy
   mode recorded EXTERNAL_TRANSPORT; organizations needing on-prem voice
   must use the opt-in command boundary (English only today).
4. **Open-dictation accuracy on synthetic speech is poor and is NOT cited
   as evidence**; only grammar-mode decode numbers are quoted.
5. **In-memory session store** — single-node only; Phase 11 must swap the
   singleton for a durable store before multi-instance deployment (interface
   already isolated in `session-store.ts`).
6. **tsc stub-client casts** (pre-existing sandbox condition) remain in the
   two new routes, clearly commented; they compile clean against the real
   client surface.

## 39. Status, Failures, Next Actions

**Gate verdict: 🟢 SANDBOX GREEN** — 5,969/12/0 tests; 0 new type errors;
Phase 7 regression 4/4; goldens 14/14; adversarial 14/14; bench artifact
SANDBOX-labeled; evidence re-runnable (`tools/voice/verify-local-voice.sh`,
`DENTORA_WRITE_BENCH=1`).

🟡 Items (declared, blocked outside this environment): Arabic local
STT/TTS model validation (network); Web Speech production AR accuracy
(needs real browsers/devices); durable session store (Phase 11 scope).

🔴 None.

**Next actions (Phase 11 candidates, NOT started):** durable voice-session
store + horizontal scaling notes; target-machine bench re-run (label flips
automatically); Arabic acoustic models once hosts are reachable; bounded
name-transliteration table; production telemetry dashboard wiring for the
voice counters.

**Explicitly out of scope and untouched:** Phase 11 (deployment hardening)
and Phase 12 (clinical certification).

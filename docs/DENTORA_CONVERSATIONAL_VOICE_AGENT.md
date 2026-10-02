# DENTORA — Round 3: Real Conversational Voice Agent

**Status: CODE-COMPLETE (BLOCKED on live runtime gates — see §9).**
Supersedes the command-parser view of the voice pipeline. Round 2 made the robot
*task-competent*; round 3 makes it *conversational*: it now has a turn-taking
state machine, barge-in, deterministic conversation state, pronoun/temporal
continuation, and a failure layer that can answer "did the robot or the ASR
misunderstand me?"

## 1. Architecture audit (pre-code) — where speech prematurely became a command

| # | Location (pre-round-3) | Premature-command behavior | Fix |
|---|------------------------|-----------------------------|-----|
| A1 | `hooks/use-dentora-voice.ts` — interim ASR results executed directly | Partial hypotheses ran the agent; `وريني مواعيد محمد النبي بتاع…` fired mid-sentence | Interim results only buffer (`PARTIAL_BUFFERED`); execution gated on `isFinal` + turn-manager `CONFIRMED_END` |
| A2 | `lib/ai/voice/pipeline.ts` — silence = submit | Any final chunk became one turn; pauses split one request into fragments | Turn manager decides turn end; short pauses (`HELD_INCOMPLETE` + trailing-dependency words) hold and combine |
| A3 | Pipeline — no conversation state | Every turn re-identified the patient from scratch; pronouns unresolvable | Explicit `VoiceConversationState` (activePatient/activeTask/pendingTask/lastIntent) persisted on the session |
| A4 | Pipeline — TTS unstoppable | Barge-in played over the robot; the interruption was lost or became a NEW task, dropping the pending one | Barge-in: stop audio client-side, mark `interrupted`, capture remainder, classify correction/continuation/new-task, keep pending task |
| A5 | Agent loop — generic off-domain fallback | `بتاعته` / follow-ups answered with "أنا مساعد الأسنان…" even when context could recover | Continuation gate BEFORE off-domain rejection (only when an active unresolved patient task exists); failure layer classifies the miss |

## 2. Turn manager (`lib/ai/voice/turn-manager.ts`)

Deterministic FSM: `LISTENING → POSSIBLE_END → CONFIRMED_END → PROCESSING → RESPONDING`,
plus `PARTIAL_BUFFERED` (interim transcript buffered), `HELD_INCOMPLETE`
(final chunk, but the sentence ends on a dependency word / continuation cue →
buffer and combine with the next chunk), `INTERRUPTED` (barge-in).
All transitions go through `transitionSession`, which validates edges and
throws on illegal ones. Partial transcripts are **never** executed: the hook
delivers only `isFinal` transcripts to the pipeline, and interims live solely
in the manager's partial buffer.

Trailing-dependency hold: a final chunk whose last meaningful token is a
preposition/determiner (`في، عن، مع، بتاع، بتاعة، اللي، بتاعه…`, `for/with/to…`)
is held and combined with the next chunk. The word `علي/على` is deliberately
**not** a dependency word: normalization folds `ى→ي` so the preposition
collides with the name علي, and holding every Ali-ending name is worse than an
occasional missed hold on a preposition.

## 3. Barge-in

1. Client (`use-dentora-voice`): while state is `RESPONDING`, ASR keeps
   listening; speech events call `cancelSpeech()` and flag the turn.
2. Pipeline: control phrases (`استنى / اسمعني / ثواني / wait…`) with **no**
   remainder → pure interruption ack (`LISTENING→INTERRUPTED` edge walk —
   `UNDERSTANDING→INTERRUPTED` is illegal in the FSM); with a remainder → the
   remainder becomes the real turn and is classified
   correction / continuation / new-task. A pending patient task survives the
   interruption (patientScope preserved unless an explicit, extractable
   correction renames the patient).
3. Every respond branch reports `interrupted: true` when barge-in occurred, so
   the UI and telemetry can distinguish "answered the interruption" from
   "answered over the user".

## 4. Deterministic conversation state

`VoiceConversationState` on the voice session (single store — the voice
session row; no duplicate history): `activePatient`, `activeTask`,
`pendingTask` (held-incomplete), `lastIntent`, `lastUserTurn`, timestamps.
Bounded history (last N turns, capped length) is reused for pronoun
resolution — nothing new is stored twice.

## 5. Continuation & identity

- Pronoun/possessive continuation: `بتاعه/بتاعها/بتاعهم/بتاعته/المريض ده/عنده/عندها/ليه/لها/حالته…`
  resolve against `activePatient` **only**; `بتاعه` without any context asks
  for identity — never guesses.
- Temporal references (`النهاردة/بكرة/بعد بكرة/امبارح/الأسبوع الجاي/الأسبوع اللي فات/الشهر الجاي`)
  expand deterministically to date ranges in Africa/Cairo local time.
- Correction cue (`قصدي / مقصدش / أنا بقصد / I meant…`): a correction turn
  re-scopes the active task; when a patient **id** is already pinned, a
  temporal-only correction (`قصدي الأسبوع ده`) re-scopes without re-identifying;
  a bare name / `اسم محمد النبي` in a fresh session never manufactures a task.
- Continuation gate ordering: **continuation check BEFORE off-domain
  rejection**, only when an active unresolved patient task exists — otherwise
  off-domain routing is untouched.
- Multi-word names never match on one token; classifier is HIGH(execute)/
  MEDIUM(confirm)/LOW(ask); the DB always determines the patient (no name→id
  mapping anywhere).

## 6. Failure layer (telemetry)

`VOICE_FAILURE_*` codes distinguish: `ASR_FAILURE` (empty/low-confidence
transcript), `TURN_DETECTION_FAILURE` (fragmented turn), 
`ENTITY_RESOLUTION_FAILURE` (couldn't identify the patient), 
`AGENT_REASONING_FAILURE`, `TOOL_FAILURE`, `TTS_FAILURE`. User-facing copy is
natural Egyptian Arabic (`مش قادر أسمعك كويس…`, `مش قادر أحدد المريض…`) —
never stack traces, never "أنا مساعد الأسنان فقط".

## 7. Arabic capture semantics (classifier)

Name capture skips **leading** scaffolding tokens (verbs, `المريض`, possessives
`بتاع/بتاعة`) but truncates at the **first non-name token after the name
begins** — so `وريني مواعيد محمد النبي بتاع بكره بالليل` → `محمد النبي`
(temporal words never glue onto names) while `اعرض الأشعة بتاعة أحمد` →
`أحمد` (leading possessive skipped). Temporal/possessive closed classes carry
both hamza and bare-alef spellings (ASR orthography is not normalized before
capture). `extractCorrectedPatientName` returns null when a correction cue has
no name (`قصدي الأسبوع ده`), letting a pinned patient re-scope instead of
re-identifying.

## 8. Verification (local harness — deterministic, no microphone)

- **Harness** `tests/unit/voice-turn-manager.test.ts` — 14/14: scenarios A–H
  (identity correction chain, relative clause, possessive, fresh-session
  safety, natural continuation, interruption + temporal correction, pronoun,
  ambiguous identity), failure-layer trio, turn-manager units. Validates
  **state transitions**, not just strings.
- **Driver** `npx tsx ai-validation/robot-runtime/validate.mts` — **65/65**
  (Groups A–N preserved + new Group O: turn-taking/barge-in — partial
  buffering, combined turns, held-incomplete, pure-interruption ack, pinned
  pronoun continuation, this-week correction, failure codes, no-wrong-patient).
- **Full suite** 6152 passed / 12 skipped / **0 failed** (round-2 baseline
  6138/12/0 preserved; +14 new harness tests). **tsc** 504 (parity, no new
  errors). **eslint** 0 errors on changed files.

## 9. Runtime validation — BLOCKED (environment)

Real browser + microphone + real MySQL are unavailable in this sandbox
(no display/audio device; MySQL not provisioned). Per the phase contract this
is **RUNTIME VALIDATION BLOCKED**, not PASS. To verify locally:

```bash
# 1. deps + env (MySQL 8 reachable via DATABASE_URL in .env)
npm install
npx prisma generate
# 2. schema (NEVER reset; apply migrations only)
npx prisma migrate deploy
# 3. full gates
npm test -- --run          # expect 6152 passed / 12 skipped / 0 failed
npx tsc --noEmit           # expect 504 (baseline parity)
npx tsx ai-validation/robot-runtime/validate.mts   # expect ROWS=65 PASS=65
# 4. app
npm run dev                # open the dashboard, use the voice button (Chrome, mic granted)
#   - say: وريني مواعيد محمد النبي بتاع… (pause) بكرة   → ONE request, tomorrow filter
#   - say: استنى، قصدي الأشعة بتاعته                    → interruption keeps the pinned patient
#   - watch /api/voice telemetry for VOICE_FAILURE_* codes
```

## 10. Known limitations

- Deferred round-2 defect: stale-pin precedence — with a pin AND an explicit
  `اسم X` cue, the pinned patient still answers (pin wins); queued for a
  follow-up round.
- `علي/على` collision documented in §2: preposition-final utterances are not
  held.
- Turn-manager hold windows are tuned for Egyptian Arabic; English mixes work
  but long English prepositional tails may split turns.
- Live ASR/TTS provider latency characteristics are untested here
  (providers are pluggable; unit tests use deterministic replays).

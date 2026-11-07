# PROGRESS.md — DenToRa chart/AI/anatomy run

> Sandbox resets between turns have been observed **twice**, destroying local commits each time.
> **Trust this file + git, not memory.** Re-anchor with `git status && git log --oneline -3` at the
> start of every turn, and push early — pushes survived every reset.

## Session / branch constraints

| Item                 | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| Session branch       | `arena/91dddda0-dental-clinic-system`                                              |
| On origin            | **YES** — pushed, tracks `origin/arena/91dddda0-dental-clinic-system`              |
| Requested target     | `wip/realistic-teeth-anatomy` @ `d8c28ae58cb18c76026c04cf72e8b2153f427be7`         |
| Target on origin     | **YES — verified** via `git ls-remote --heads origin wip/realistic-teeth-anatomy`  |
| Can we check it out? | **NO.** Session is pinned; user chose to proceed here anyway.                      |
| Environment          | Linux sandbox clone. **Not** `C:/Projects/dental-erp-dental-chart`. Docker absent. |

**Consequence:** the `d8c28ae` tooth-anatomy rewrite is **NOT** on this branch, so WP1 H1/H4
(d8c28ae vs eba87b7) cannot be reproduced here.

## BASELINE (measured at `2ebafa3`, the FDI-52 commit)

| Command         | Result                                                            |
| --------------- | ----------------------------------------------------------------- |
| `tsc --noEmit`  | **498 errors**, exit 2                                            |
| `npm run lint`  | **0 errors, 274 warnings**, exit 0                                |
| `npm run test`  | **6263 passed / 12 skipped / 8 failed** (345 files), exit 1, 322s |
| `npm run build` | `✓ Compiled successfully in 44s` → TypeScript fails → **exit 1**  |

The master prompt's 6462/12/0 figure is from `512a028` — a different commit and branch. Not comparable.

## CS-RESTO-007 — ROOT CAUSE **PROVEN** (golden deliberately untouched)

**Symptom:** status went `COMPLETED` → `CLARIFICATION_REQUIRED`; `mustContain: "Identity:"` lost.

**Probe** (`replayAgentCase` on the single golden case, run in detached worktrees):

|          | BASE `8f3429c`                                                                 | CURRENT `2ebafa3`                                                |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| status   | `COMPLETED`                                                                    | `CLARIFICATION_REQUIRED`                                         |
| taskType | `CLINICAL_ANALYSIS`                                                            | `INFORMATIONAL`                                                  |
| tools    | `["get_tooth_context"]`                                                        | `[]`                                                             |
| answer   | `"Based on the available recorded information: Identity: Ahmed Ali (PAT-A1)…"` | `"Which tooth do you mean? Please give the FDI number (11–48)."` |

**File bisect** (scratch worktree `/tmp/wt_cur`, one file reverted at a time):

| Variant                             | Result                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| revert `lib/ai/context/fdi.ts` only | `COMPLETED / CLINICAL_ANALYSIS / get_tooth_context` → **flips back** |
| revert both (sanity)                | `COMPLETED`                                                          |

→ **`lib/ai/context/fdi.ts` is the flipping file.** `lib/dental-chart/fdi.ts` is not involved.

**Mechanism** — the old validator was a _range_ check, not a set check:

```js
// OLD  lib/ai/context/fdi.ts
return typeof n === 'number' && Number.isInteger(n) && n >= 11 && n <= 48
//   30 → TRUE   ← wrongly accepts 19, 20, 29, 30, 39, 40, 49

// NEW  (shared set membership)
return typeof n === 'number' && Number.isInteger(n) && VALID_FDI.has(n)
//   30 → FALSE  ← correct
```

`extractToothMentions` (`lib/ai/agent/classifier.ts:409`) does `if (!isValidFdi(n)) continue`.
At base, `30` was wrongly extracted as a tooth mention → `toothInvolved: true` → `CLINICAL_ANALYSIS`
→ `get_tooth_context` ran → answer contained `"Identity:"` → **the golden passed for the wrong reason**.
Under FDI-52, `30` is correctly rejected, so the agent asks which tooth instead.

**The FDI-52 change therefore FIXED a latent bug; the golden encodes the buggy behaviour.**
The new answer still satisfies the global denylist, `mustNotContain`, and carries an honesty marker
(`'Which tooth'` is literally in `HONESTY_MARKERS`). Only `status ∈ [COMPLETED]` and
`mustContain "Identity:"` fail.

**Per the user's rule 6 the golden is NOT edited.** Awaiting an explicit decision.

## Option B — DONE (commit `5cdb56d`)

Rule: a heard **PRIMARY** number whose digit-reversal is a valid **PERMANENT** number ⇒ `AMBIGUOUS`
with both candidates. Never fires for a heard permanent number, so `42→42` and `36→36` stay literal.

| Class          | Ids                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------- |
| AMBIGUOUS (16) | 51‑54, 61‑64, 71‑74, 81‑84                                                                |
| RESOLVED (4)   | 55 (reverses to itself), 65/75/85 (56/57/58 invalid — no index 6‑8 in a primary quadrant) |

Full suite: **8 failed → 4 failed**; **6263 → 6271 passed**.
Fixed: `voice-entity-resolution` (2), `voice-pipeline` (1), `voice-robot-eval` (1).

## STEP 4 INVENTORY — every site where `false` triggers fallback / rescue / clarification / rejection

### A. `isValidFdi` call sites — now accept 51‑85 (behaviour change)

| Site                                             | Path on `false`                             | Change under 52 ids                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/ai/agent/classifier.ts:409`                 | `continue` — tooth mention dropped          | **Two changes:** now REJECTS 19/20/29/30/39/40/49 (previously false-accepted) **and** now ACCEPTS 51‑85. **This is the CS-RESTO-007 mechanism.** |
| `lib/ai/context/builders.ts:184`                 | `continue` — chart row dropped from byTooth | primary-tooth rows now **included** (desired — previously invisible to AI context)                                                               |
| `lib/ai/context/builders.ts:638`                 | `toothFdi: null`, `toothLink: 'unknown'`    | AI findings on primary teeth now link as **'confirmed'** (desired)                                                                               |
| `lib/ai/context/fdi.ts:114`                      | `quadrantOf` → `null`                       | now returns **5‑8** for primary instead of null                                                                                                  |
| `lib/ai/context/fdi.ts:128`                      | token dropped from `parseToothNumbers`      | primary tokens now parsed                                                                                                                        |
| `lib/ai/voice/entity-resolution.ts:140,143`      | not pushed as candidate                     | primary now accepted → **handled by the Option B guard**                                                                                         |
| `lib/ai/voice/entity-resolution.ts:171`          | reversal rescue                             | **fewer** numbers reach it (63/81 now valid) → **mitigated by Option B**                                                                         |
| `app/api/ai/context/route.ts:67`                 | 400 rejection                               | now **accepts** 51‑85 (desired)                                                                                                                  |
| `app/api/treatment-plans/[id]/items/route.ts:50` | 400 rejection                               | now **accepts** 51‑85 (desired)                                                                                                                  |
| `components/…/DentalChartWorkspace.tsx:383`      | filtered out                                | primary now included                                                                                                                             |
| `components/…/tooth-3d.ts:35`                    | `throw`                                     | primary no longer throws                                                                                                                         |

### B. Hardcoded permanent-only ranges — still REJECT primary (not yet migrated)

| Site                                             | Effect                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `lib/ai/agent/tools.ts:221-222`                  | `toothFdi < 11 \|\| > 48` → rejects primary, message says `11..48`                    |
| `app/api/dental-chart/[id]/summary/route.ts:58`  | `< 11 \|\| > 48` → **silently drops primary findings**                                |
| `app/api/dental-chart/[id]/summary/route.ts:203` | filter `>= 11 && <= 48` → **silently drops primary**                                  |
| `lib/ai/agent/classifier.ts:392`                 | comment says "11–48 only"                                                             |
| `lib/ai/agent/classifier.ts:1196`                | `missingInfo: 'valid FDI tooth number (11–48)'`                                       |
| `lib/ai/agent/loop.ts:826-827`                   | clarification strings hardcode `(11–48)`; **:827 is English** (Arabic-only violation) |

### C. 32-tooth arrays

| Site                                                                               | Effect                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `components/dental-chart/adapters/dental-chart-adapter.ts:30` `ALL_FDI_TEETH` (32) | used at `:310` and by `Odontogram.tsx:20` (**Phase-3 protected**) |
| `DentalChart3D.tsx:253` uses `FDI_TEETH` (32)                                      | 3D will not render primary teeth yet                              |

### D. Silent fallback (the flagged bug)

`components/dental-chart/adapters/dental-chart-adapter.ts:100-104` — `getToothQuadrant` returns `1`
for anything outside quadrants 1‑4, so **every primary tooth (51‑85) is silently labelled
upper-right**. Not yet migrated.

## STEP 5 — `wip/realistic-teeth-anatomy` READ-ONLY inspection

`git fetch origin wip/realistic-teeth-anatomy:refs/remotes/origin/wip/realistic-teeth-anatomy`
→ HEAD `d8c28ae58cb18c76026c04cf72e8b2153f427be7` (matches expectation).

`git diff --stat 8f3429c8 origin/wip/… -- lib/dental-chart lib/ai/context lib/ai/voice`
→ **20 files, 587 insertions, 1627 deletions.** `wip` is a **different lineage**, not a small delta.

| Question                                         | Answer                                                                                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does wip have its own `lib/dental-chart/fdi.ts`? | **Yes** — differs from `8f3429c8` by 8 lines (formatting only). Still **32 permanent only** (`FdiQuadrant = 1\|2\|3\|4`), no primary support.                                 |
| Does wip have its own `lib/ai/context/fdi.ts`?   | **Yes** — same divergent validator at `:36-37`: `n >= 11 && n <= 48`. Same two-validator problem.                                                                             |
| Same voice `entity-resolution.ts`?               | **Yes** — identical reversal-rescue shape at `:105-109` (`if (candidates.length === 0)`). **The same 7-regression bug class will occur on wip when FDI-52 is applied there.** |
| tooth-anatomy.ts                                 | **904 lines** at wip vs **181** at `8f3429c8` — consistent with the master prompt's +833/−110 rewrite.                                                                        |

**Implication:** the FDI-52 work and the Option B fix both need re-application on `wip`, whose
AI/voice layer is an _older_ base.

## Remaining failures (4) — none are regressions

| Test                               | Status                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `tests/api/imaging-review.test.ts` | pre-existing collection error (absent Prisma client)                               |
| `tests/unit/dev-start-env.test.ts` | pre-existing (absent Prisma client)                                                |
| `clinical-safety-eval` ×3          | CS-RESTO-007 — golden encodes the old buggy range validator; **awaiting decision** |

## Commits on this branch

| Hash       | Subject                                                   |
| ---------- | --------------------------------------------------------- |
| `8f3429c`  | Merge PR #3 (base = `dentora-unified` tip)                |
| `84dedb07` | Step 3 FDI-52 — **LOST to reset #1**                      |
| `d5c32bc`  | Re-commit Step 3 — **LOST to reset #2**                   |
| `c6f32a2`  | docs: run state / baseline / blockers / architecture      |
| `2ebafa3`  | feat(fdi): FDI-52 foundation (pushed to origin)           |
| `5cdb56d`  | fix(voice): dentition-aware STT reversal guard (Option B) |

## Scratch worktrees (in /tmp, not persisted)

`/tmp/wt_base` @ `8f3429c`, `/tmp/wt_cur` @ `2ebafa3` — used for the CS-RESTO-007 probe and bisect.
Remove with `git worktree remove /tmp/wt_base /tmp/wt_cur` when done.

---

## S0 PREFLIGHT — merge/fdi52-into-wip (`0819562a`) — measured 2026-10-28

### Start-state verification (STOP-on-mismatch gate: PASSED)

```
expected HEAD: 0819562a288ec8c72681523d5373fb1bb9af1c6b
actual   HEAD: 0819562a288ec8c72681523d5373fb1bb9af1c6b   -> MATCH
parents:       d8c28ae58cb18c76026c04cf72e8b2153f427be7  (wip  @d8c28ae)
               919c2ae98afffbea4b89cd17b9e4b44925459bfc  (arena @919c2ae)
```

Merge claim re-verified on origin: `components/dental-chart/interactive/tooth-anatomy.ts` is
**904 lines**, contains `buildAnatomicalCrownGeometry`, and is **byte-identical to wip's** version
(`git diff --stat origin/wip/... origin/merge/... -- <file>` empty) — i.e. theirs was taken.

### Environment (recorded, differs from the user's machine)

| Item                                    | This sandbox                           | Consequence                                                    |
| --------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| `docker --version`                      | **not installed**                      | WP2 remains impossible (B2)                                    |
| `ai-validation/*/model/`                | **README.md only — no weights**        | model checksums impossible (B3)                                |
| `git rev-parse --is-shallow-repository` | **true** (grafts `655dc10`, `8f3429c`) | cannot show `eba87b7` shared ancestry; `merge-base` unreliable |
| MySQL `127.0.0.1:3306`                  | **closed**; no mysql client            | any live-DB check unverifiable                                 |
| Prisma client                           | **absent**                             | 498 tsc errors; 1 test file uncollectable                      |
| Node                                    | v22.22.3 (`.nvmrc` = 20)               | CI on Node 20 is authoritative                                 |

### Baseline measured HERE (must not be assumed to match the user's)

| Metric          | This sandbox                            | User's machine | Reconciliation                               |
| --------------- | --------------------------------------- | -------------- | -------------------------------------------- |
| tsc `--noEmit`  | **498 errors**                          | —              | all Prisma-client-derived                    |
| `npm run lint`  | **0 errors, 266 warnings**              | —              | (274 warnings on the pre-merge arena branch) |
| Full suite      | **6301 passed / 12 skipped / 1 failed** | 6315 / 12 / 1  | **reconciled below**                         |
| Test files      | **348** (2 failed)                      | 348            | **match**                                    |
| `npm run build` | not yet run                             | —              | pending                                      |

**Delta explained — no discrepancy:** `tests/api/imaging-review.test.ts` declares **14** tests but
collects **0** here because `@prisma/client` cannot load. 6301 + 14 = **6315**, the user's number.
So the two baselines agree exactly once the Prisma-blocked file is accounted for.

**The 1 failure** is `tests/unit/dev-start-env.test.ts > "constructing with { datasources: { db:
{ url } } } never fails with env-not-found"`. Here it cannot even reach a server (no Prisma client,
no MySQL), so **this environment cannot reproduce the user's real failure mode**, which is an
_authentication_ rejection, not a connection one. See S1.

### Docs refreshed on this branch

`BLOCKERS.md` (+B12, and the option-(a) stamp on B6), `PROGRESS.md` (this section), `TODO.md`.

---

## S2 — the `clinical` HTTP 500 (READ-ONLY investigation)

**The call.** `components/ai/patient-360.tsx:31` POSTs `/api/ai/clinical` with
`{ type: 'patient_summary', patientId, refresh }`. Handler:
`app/api/ai/clinical/route.ts` -> `patientSummary()` (line 71).

**Why TWO requests.** `Patient360` is mounted exactly once
(`app/(dashboard)/patients/[id]/page.tsx:583`) and `next.config.js:29` sets
`reactStrictMode: true`. In dev, React double-invokes the mount effect, so one
mount produces two identical POSTs. That is expected dev behaviour, not a bug
and not evidence of a loop.

**Every 500 path in `patient_summary`:**

| #   | Path                                                                           | Mechanism                                                                    |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| a1  | `complete()` (external OpenRouter call) throws                                 | caught at route.ts:146 -> `{ error: String(err) }`, **500 with a JSON body** |
| a2  | `getModelByTier('clinical')` throws (evaluated as an argument, inside the try) | same catch -> 500                                                            |
| a3  | `prisma.patient.update()` cache write throws                                   | same catch -> 500                                                            |
| b   | any of the 5 Prisma reads at route.ts:76 and :85-102 throws                    | **OUTSIDE all try blocks** -> unhandled -> framework 500, **no JSON body**   |

**Facts checked, none of which support "the merge broke it":**

- `git log eba87b7..HEAD -- app/api/ai/clinical/route.ts` -> **0 commits**. The
  route is untouched by the merge and by FDI-52.
- Same check: `lib/ai/openrouter.ts` 0, `lib/ai/models.ts` 0, `lib/api-helpers.ts` 0,
  `lib/prisma.ts` 0. Only `components/ai/patient-360.tsx` changed, and that file
  is **new**, added by PR #3 (`8f3429c`).
- `PatientRiskScore` **exists** in `prisma/schema.prisma:2758` with the exact
  fields used (`overallScore Int` :2762, `factors Json` :2763) -> no missing relation.
- The `clinical` model tier **exists** (`lib/ai/models.ts:44`).
- No `toothNumber` handling anywhere in this route -> **FDI-52 is not involved**.
- No audit call in this path.

**The one concrete throw on this path:** `lib/ai/openrouter.ts:29`
`if (!key) throw new Error('OPENROUTER_API_KEY is not set. Add it to your .env file.')`
and `.env.example:99` ships `OPENROUTER_API_KEY=""` — an empty string is falsy, so
an unset key throws and lands in class (a1). **This is a fact about the code,
not a finding that it is the user's cause** — the response body was UNKNOWN.

**Tests added (reproduce BEFORE any fix):** `tests/api/ai-routes.test.ts`

- `500 class (a): AI call failure surfaces verbatim in the 500 body` — mocks
  `complete` to reject with the real openrouter message, asserts 500 and that
  `data.error` contains `OPENROUTER_API_KEY is not set`.
- `500 class (a): a failing cache write also yields 500 (generated work is lost)` —
  the summary is produced and paid for, only the cache write fails, still 500.
  Result: **52 passed / 0 failed** in that file.

Class (b) is recorded as a fact, not tested: those reads sit outside every try,
so a failure there never reaches the JSON branch.

---

## S2 addendum 1 — AI provider -> env var map (names only, no values)

Two providers are actually reachable from this codebase.

**A. OpenRouter (cloud).** Key read at `lib/ai/openrouter.ts:28`
(`process.env.OPENROUTER_API_KEY`), thrown on absence at :29.
16 routes call it via `@/lib/ai/openrouter`:
`ai/analyze`, `ai/briefing`, `ai/cashflow-forecast`, `ai/chat`, `ai/claim-analysis`,
`ai/clinical`, `ai/command`, `ai/insights`, `ai/inventory-forecast`, `ai/no-show-risk`,
`ai/patient-segments`, `ai/pricing-suggestions`, `ai/query`, `ai/suggestions`,
`cron/briefing`, `data-import/ai-mapping`.
**`OPENROUTER_API_KEY` is ABSENT from the user's .env** -> every one of these
throws into its own 500 catch.

**B. Local orchestrator (Ollama / DEN_TORA side).** Reads `AI_ORCHESTRATOR_URL`
(default `http://localhost:8000`) and `ORCHESTRATOR_SECRET` at
`lib/ai/engines/orchestrator-source.ts:18,22` and `lib/ai-orchestrator.ts:117,125`.
Used by `ai/agent`, `ai/attachments`, `imaging/studies`, `ai/engines/local-ai-service.ts`.
**`ORCHESTRATOR_SECRET` IS present in the user's .env.**

**C. Names present in the user's .env that NO code reads anywhere** (checked across
ts/tsx/yml/yaml/py/sh/mjs/json/md): `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_AI_GATEWAY_ID`, `CLOUDFLARE_API_TOKEN`, `DEN_TORA_AI_MODEL`,
`DEN_TORA_AI_FAST_MODEL`, `DEN_TORA_AI_REASONING_MODEL`.
Zero references -> they are inert on this branch. They are presumably intended for
the Python/orchestrator service or a Cloudflare AI Gateway hop that this
codebase does not implement.

## S2 addendum 2 — exactly what patient_summary sends to the provider

`prisma.patient.findFirst({ where: { id, hospitalId } })` (route.ts:76) has **no
`select`**, so the whole patient row is loaded into memory — but only these fields
are put into the prompt payload (`snapshot`, route.ts:108-122):

- `name` (firstName + lastName)
- `age`
- `phone`
- `lastVisit` = first appointment's `scheduledDate`
- `recentAppointments` = up to 3 x `{ date, appointmentType, status }`
- `recentTreatments` = up to 3 x `{ status, createdAt }`
- `outstandingBalance` (derived from invoices: totalAmount - paidAmount on
  PENDING/OVERDUE)
- `riskScore` = `PatientRiskScore.overallScore`
- `riskFactors` = `PatientRiskScore.factors`

That is directly identifying data (name, phone), a financial figure and clinical
risk data leaving the server to a third-party provider. Relevant to the privacy
decision below. Nothing else from the patient row is serialised.

## S2 addendum 3 — graceful degradation for an unconfigured provider (APPROVED)

Implemented test-first. Contract: unconfigured provider -> **503** with the stable
code `AI_NOT_CONFIGURED`, **not 500**; Patient360 renders a neutral, localized
Arabic "غير مفعّل" state with no red error and never shows the raw code.

- `lib/ai/openrouter.ts`: new `isOpenRouterConfigured()` — returns a boolean only,
  never reads or returns the key value.
- `app/api/ai/clinical/route.ts`: guard in `patientSummary` short-circuits with
  503 **before** any patient data is assembled or sent.
- `components/ai/patient-360.tsx`: distinct `notConfigured` state rendering
  `ai.not_configured` / `ai.not_configured_body` with muted (not destructive) styling.
- `locales/ar.json` + `locales/en.json`: 3 new keys (`ai.not_configured`,
  `ai.not_configured_body`, `AI_NOT_CONFIGURED`). Parity preserved.

**This does NOT claim to explain the user's 500.** That stays unproven until the
Response body confirms it. No key was added or hardcoded; no provider was switched.

Tests: `tests/api/ai-routes.test.ts` (503/AI_NOT_CONFIGURED, asserts 503 and that
`complete` is never called) and `tests/components/ai-components.test.tsx`
(Arabic label, no `destructive` class, no raw code in the DOM). Both were shown
failing first: `expected 500 to be 503`, then
`Unable to find an element by: [data-testid="patient-360-not-configured"]`.

i18n note: `tests/unit/i18n-api-messages.test.ts` sweeps every `error:` literal in
`app/api` and requires an Arabic translation AND that the English entry equals the
literal verbatim. `AI_NOT_CONFIGURED` therefore needed entries in both files
(`en` = the literal itself). No allowlist was touched, no assertion weakened.

---

# S4 — Tooth-anatomy geometry review (all 52 FDI ids + arch overlap)

Method: every number below was produced by importing the REAL modules
(`tooth-3d.ts`, `tooth-anatomy.ts`, `lib/dental-chart/fdi.ts`) and measuring the
actual `THREE.BufferGeometry`, not by re-deriving the formulas. Throwaway probe
(created, run, deleted — not committed).

## S4.1 Coverage — all 52 ids

`isValidFdi` accepts exactly 52 numbers
(11-18/21-28/31-38/41-48 + 51-55/61-65/71-75/81-85).
All 52 pass `toothTransform(n)` without throwing (it throws on invalid input) and
all 52 resolve to a crown geometry. **Coverage is complete.**

## S4.2 FINDING (high): every adjacent tooth in the dentition interpenetrates

Two independent tests, both against real geometry:

- **Rotated-ellipse separating-axis test**, minimising penetration over 2880
  directions. Positive penetration on every direction means no separating axis
  exists, i.e. the crowns provably intersect:
  **44 adjacent pairs tested → 44 guaranteed intersecting → 0 separable.**
- **World-space AABB test** on the real `BufferGeometry` after the real
  `toothTransform` rotation: **44/44 overlapping** (conservative; AABBs are
  looser than the shapes, so this corroborates rather than proves).

Worst cases, penetration as a share of the crown's mesiodistal width:

| pair                       | groups                | penetration | % of crown width |
| -------------------------- | --------------------- | ----------- | ---------------- |
| 54-55, 64-65, 74-75, 84-85 | molar/molar (primary) | 0.1598      | **37%**          |
| 16-17, 26-27, 36-37, 46-47 | molar/molar           | 0.1376      | **31%**          |
| 15-16, 25-26, 35-36, 45-46 | premolar/molar        | ~0.12       | ~28%             |
| 11-12, 21-22, 31-32, 41-42 | incisor/incisor       | 0.0290      | ~10%             |

Every quadrant: permanent Q1-Q4 all 7/7 pairs intersect (min +0.0290, max
+0.1376); primary Q5-Q8 all 4/4 pairs intersect (min +0.0290, max +0.1598).

**Root cause.** `tooth-3d.ts:26-32`: `archAngle(t) = 0.14 + (t-1)*0.092` with
`ARCH_X = 2.35`, `ARCH_Z = 3.1` produces adjacent centre-to-centre spacing of
only **0.218-0.250** world units, while the real measured crown widths are
**0.28** (incisor) to **0.464** (molar). The angular step is far too small for
this arch radius and these crown sizes. Measured crown bounding boxes:

    incisor  x=0.2800  y=0.3500  z=0.2027
    canine   x=0.3000  y=0.3850  z=0.3074
    premolar x=0.3534  y=0.3280  z=0.3029
    molar    x=0.4642  y=0.3180  z=0.4009

**There is no spacing or overlap tolerance constant anywhere in the chart code.**
Grepping `tolerance|spacing|overlap|collide|clearance` across
`components/dental-chart` and `lib/dental-chart` returns only `ARCH_X`,
`ARCH_Z` and `archAngle`. Overlap is not a tunable; it is a hard consequence of
those three numbers.

## S4.3 Inter-arch clearance is FINE (not a defect)

Upper and lower crowns do not collide. Using the real measured crown heights and
`ARCH_Y = 0.52`, the clear vertical gap between the upper and lower crown
envelopes is positive for every group:

| group    | upper y-range    | lower y-range    | clear gap |
| -------- | ---------------- | ---------------- | --------- |
| incisor  | [+0.175, +0.525] | [-0.525, -0.175] | +0.350    |
| canine   | [+0.138, +0.522] | [-0.522, -0.138] | +0.275    |
| premolar | [+0.206, +0.534] | [-0.534, -0.206] | +0.412    |
| molar    | [+0.211, +0.529] | [-0.529, -0.211] | +0.422    |

## S4.4 FINDING (high): the 904-line anatomical module is dead code

`components/dental-chart/interactive/tooth-anatomy.ts` documents itself as
implementing "authoritative procedural 3D anatomical crowns and multi-rooted
systems for all 16 distinct human permanent tooth classes", citing Wheeler and
Woelfel. **Nothing in the app calls it.**

`DentalChart3D.tsx:26` imports only three things from it:

    import { buildCrownGeometry, buildRootGeometry, rootSpecs, type ToothGroup }

and `buildCrownGeometry(group)` is a thin wrapper over
`buildAnatomicalCrownGeometry(group)`. Grepping the whole repo for
`getAnatomicalSpec`, `buildAnatomicalCrownGeometry`, `buildAnatomicalRoot`,
`rootSpecsForTooth`, `toothSpecificTypeOf` returns **zero callers outside
`tooth-anatomy.ts` itself and `tests/components/tooth-anatomy.test.ts`.**

Consequences that follow from the live render path:

- The renderer builds **4 crown geometries, one per group**
  (`DentalChart3D.tsx:49-51`). So 11 and 21 are the same mesh; 16, 17 and 18 are
  the same mesh. None of the 16 per-tooth classes — Carabelli cusp, Y-5 groove
  pattern, the 3-root maxillary molar tripod — reaches the screen.
- `rootSpecs(group, arch)` is likewise group-level: 3 roots for upper molars,
  2 for lower molars, 1 for everything else. Per-tooth `rootSpecsForTooth` is
  never called. (These are the code's own values, quoted, not asserted as
  anatomy.)

## S4.5 FINDING (latent): 20 primary teeth silently fall back to an incisor

`ANATOMICAL_SPECS` contains **16 keys, all permanent**. `specificTypeOf`
(`fdi.ts:140-165`) returns `primary_<jaw>_<kind>` for the 20 primary teeth, none
of which exist in the record. `getAnatomicalSpec` resolves this with a bare `??`:

    return ANATOMICAL_SPECS[key] ?? ANATOMICAL_SPECS.maxillary_central_incisor

So `getAnatomicalSpec(54)` silently returns a **maxillary central incisor** — an
incisor crown and its **1-root** system — for a primary first molar. Latent
today only because S4.4 makes the whole path dead; it becomes a visible wrong-
geometry bug the moment anyone wires the anatomical path up. A `??` fallback
that turns a missing key into a plausible-looking wrong tooth is the dangerous
kind of failure for a clinical chart.

Related: `toothTransform` positions primary teeth (index 1-5) at the same arch
angles as permanent teeth 1-5, while `groupOf` (`fdi.ts:130`) correctly returns
`molar` for primary index 4-5. Primary molars therefore inherit the crown width
of a molar (0.464) at the spacing of a premolar — which is exactly why the
primary second-molar pairs are the worst overlaps in S4.2.

## S4.6 What only a browser can confirm

- Whether the 44 interpenetrations are visually objectionable, or read as
  acceptable "contact points" at the default camera. Depends on material
  opacity, lighting and camera distance — not derivable from geometry alone.
- Whether the dead anatomical path is intentional (work in progress) or an
  abandoned experiment.
- Frame rate / interaction smoothness, hover and selection scaling
  (`scale={isSelected ? 1.08 : isHovered ? 1.05 : 1}` interacts with overlap:
  a selected tooth grows _into_ its already-overlapping neighbours).
- Whether the double-invocation under `reactStrictMode` has any visual effect.

**No geometry was changed in S4.** No root or canal counts were invented; every
root count quoted is read out of the code.

---

# S5 — Arabic-only audit of the dental chart (PROPOSE ONLY — no code changed)

Scope: every user-visible string in `components/dental-chart/**`. Method: swept
all 25 component files for `t('…')` keys and raw JSX English, then resolved each
key against `locales/ar.json` and `locales/en.json` (5757 keys each, parity holds).

## S5.1 English that ACTUALLY renders in Arabic mode (5 real defects)

### (1) Four hardcoded quadrant corner labels in `ArchGrid.tsx`

`components/dental-chart/odontogram/ArchGrid.tsx` — these are raw JSX text,
**never passed through `t()`**:

| line | literal   | position on the board |
| ---- | --------- | --------------------- |
| 34   | `Q1 (UR)` | top-left              |
| 37   | `Q2 (UL)` | top-right             |
| 42   | `Q4 (LR)` | bottom-left           |
| 45   | `Q3 (LL)` | bottom-right          |

Absolutely positioned in the corners of the chart board next to the coloured
dots. These are the chart's primary orientation cues, so they are the most
visible untranslated text in the whole component.

### (2)(3)(4) Three `t()` keys that do not exist in either dictionary

`translateText` (`lib/i18n/dictionary.ts:77-79`) falls back to returning the
**key itself** when it is not in the dictionary and not in the reverse index. So
an unresolved key paints raw English in Arabic mode.

| file:line                     | call             | renders in Arabic mode               |
| ----------------------------- | ---------------- | ------------------------------------ |
| `Odontogram.tsx:250`          | `t('Refresh')`   | `Refresh` (toolbar button)           |
| `Odontogram.tsx:294`          | `t('Clear all')` | `Clear all` (selection-clear button) |
| `ToothHistoryTimeline.tsx:84` | `t('Active')`    | `Active` (status badge)              |

These slipped past `tests/unit/i18n-completeness.test.tsx`, which enforces
ar/en key parity and non-empty values but does **not** scan components for
`t()` keys that have no entry.

### (5) A hardcoded English date format

`ToothHistoryTimeline.tsx:88`

    format(new Date(entry.diagnosedDate), 'MMM d, yyyy')

No `locale` option is passed, so date-fns uses its en-US default. Verified by
running it:

    format(new Date('2024-01-05'), 'MMM d, yyyy')  =>  Jan 5, 2024

This never touches `t()`, so no dictionary entry can fix it.

## S5.2 English in the code that is NOT user-visible (dead — do not "fix" blindly)

`Quadrant` (`components/dental-chart/odontogram/Quadrant.tsx`) destructures
`id`, `title`, `subtitle` and `mode` — and **renders none of them**. Its entire
return is the tooth row. Therefore every prop ArchGrid passes for those four is
discarded:

- `subtitle="Q1 (UR)"`, `"Q2 (UL)"`, `"Q4 (LR)"`, `"Q3 (LL)"` (ArchGrid :73,
  :103, :118, :138) — **dead**, never displayed.
- `title={t('Upper Right')}`, `t('Upper Left')`, `t('Lower Right')`,
  `t('Lower Left')` — **dead**, the `t()` still executes but the result is
  thrown away.
- `id="Q1"…"Q4"` and `mode` — **dead**.

Consequence for planning: translating the `subtitle` values would change
nothing on screen. The four corner labels in S5.1(1) are a _separate_ set of
literals and are the ones actually on screen. Fixing one does not fix the other.

## S5.3 What is already correct (verified, leave alone)

- All 8 ArchGrid `t()` keys resolve to Arabic: `Upper Jaw (Maxilla)` →
  الفك العلوي (ماكسيلا), `Lower Jaw (Mandible)` → الفك السفلي (مانديبولا),
  `Occlusal Plane` → مستوى الإطباق, `Midline` → خط المنتصف.
- All 40 namespaced keys (`dental_chart.*`, `common.retry`) resolve. 0 missing.
- All ~40 legacy English-sentence keys in `SurfaceSelectorDialog`,
  `OdontogramLegend`, `ToothCell`, `ToothSurfaces`, `ToothTooltip`,
  `BridgeConnector` resolve (e.g. `Save Changes` → حفظ التغييرات,
  `Clinical Notes & Observations` → ملاحظات ومشاهدات سريرية).
- `ArchGrid`'s root is `dir="ltr"`, which is deliberate and correct: the
  quadrant layout is anatomical and must not mirror in RTL.

## S5.4 Proposed non-invasive path (NOT IMPLEMENTED — awaiting approval)

Phase A — dictionary-only, touches no component, zero risk to the protected
Phase-3 odontogram geometry:

1. Add `Refresh`, `Clear all`, `Active` to `locales/ar.json` + `locales/en.json`
   (en value = the literal, to satisfy the API-message convention where
   relevant). Fixes 2,3,4. Parity test keeps them honest.

Phase B — one-line, still geometry-free: 2. `ToothHistoryTimeline.tsx:88`: pass the existing helper
`dateFnsLocale(locale)` from `lib/i18n/dates.ts` (already in the repo, maps
`ar*` → date-fns `ar`), **or** swap to the locale-aware
`formatDate(value, { locale })` from `lib/i18n/format.ts` (uses `Intl`).
Either is a one-line change; no new dependency.

Phase C — touches ArchGrid, the only step that edits a Phase-3 file: 3. Wrap the four corner literals in `t()` and add keys
(`Q1 (UR)` → الربع الأول (أعلى يمين), etc.). This is a JSX-text change only.
It does not alter geometry, layout, `FDI_QUADRANTS`, or any tooth path.
**Needs your go-ahead because ArchGrid/Odontogram is protected.**

Optional, separate decision: 4. `Quadrant`'s unused `title`/`subtitle`/`id`/`mode` props — either render
`title` (giving each quadrant a visible Arabic heading, which would be a
genuine UI addition) or delete the dead props. Deleting is safer; rendering
is a product decision, not a bug fix. I recommend deleting the dead props in
a separate commit and not conflating it with the i18n work.

Suggested commit split so each is independently revertible:
`i18n(chart): add missing ar/en keys for Refresh, Clear all, Active` →
`i18n(chart): localize the ToothHistoryTimeline date format` →
`i18n(chart): translate the ArchGrid quadrant corner labels` →
`refactor(chart): drop Quadrant's unrendered title/subtitle/id/mode props`.

**Nothing in S5 was changed. No file under `components/dental-chart/` was
modified in this task — S5 is proposal only, per instruction.**

---

# S2-4 — Local orchestrator capability: can it serve TEXT? (decision D accepted)

User decision: **option D — no key, no provider change.** The 503
`AI_NOT_CONFIGURED` state with the Arabic "غير مفعّل" card stays. This section
answers the three verification questions with file/line evidence. **Facts only;
no recommendation.** Nothing was changed.

## Q1. Does the local orchestrator expose a text/LLM generation endpoint? — NO

The orchestrator client has exactly **three** endpoints, all imaging metadata or
imaging inference:

| endpoint        | file:line                                  | payload                                                                                                                       | returns                                                                                                                             |
| --------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POST /analyze` | `lib/ai-orchestrator.ts:132`               | `AnalyzeParams`: `jobId`, `studyId`, `hospitalId`, **`imageKey`**, **`imageSha256`**, `engine`, **`modality`**, `requestedBy` | `AnalyzeResult`: `findings` (boxes/landmarks/segments), `top_confidence`, `provenance`, `raw_output_key`, **`annotated_image_key`** |
| `GET /engines`  | `lib/ai/engines/orchestrator-source.ts:50` | —                                                                                                                             | engine registry: `model_checksum`, `model_license`, `supported_modalities`, `result_kind`                                           |
| `GET /health`   | `lib/ai/engines/orchestrator-source.ts:72` | —                                                                                                                             | per-engine `reachable`, `model_loaded`, `is_standin_not_*`                                                                          |

Both clients default to `AI_ORCHESTRATOR_URL || 'http://localhost:8000'`
(`lib/ai-orchestrator.ts:117`, `lib/ai/engines/orchestrator-source.ts:18`).

**Structural proof it cannot return text** — the result contract has no text
kind:

    lib/ai/engines/types.ts:51
    export const ENGINE_RESULT_KINDS = ['findings', 'segments', 'landmarks'] as const

The registered engines are all imaging: `meshsegnet-max` / `meshsegnet-man`
(3D scan + CBCT mesh segmentation), `liodon` (panoramic), `implant-ai`
(periapical/bitewing), `orthodontic`.

**The repo's own architecture doc agrees** —
`docs/DENTORA_AI_PHASE5_LOCAL_AI_MODEL_STRATEGY.md:155`:

    | Cloud LLM | (existing) | conversation synthesis, RAG synthesis | text |
      | — | **UNCHANGED — CLOUD_ALLOWED for text only** | Phase 3/4, untouched |

and :293 — "The cloud LLM remains fully intact for its original role; Phase 5
**adds a local path** [for imaging]". §2 puts GPU support and training
explicitly out of scope.

## Q2. Which of the routes could run on a local text model? — all 17, architecturally

`complete()` (`lib/ai/openrouter.ts:51-72`) POSTs to
`{base}/chat/completions` with **only** `model`, `messages`, `max_tokens`,
`temperature`. There is **no `response_format`, no `tools`, no `tool_choice`,
and no image content** — `ChatMessage.content` is typed `string`
(`lib/ai/openrouter.ts:14-18`), so no route sends a multimodal part.

Therefore any local server exposing an OpenAI-compatible
`/v1/chat/completions` could serve them. Per-route constraints:

| route                    | fn                             | tier         | maxTokens | note                             |
| ------------------------ | ------------------------------ | ------------ | --------- | -------------------------------- |
| `ai/analyze`             | complete                       | clinical     | 4096      |                                  |
| `ai/briefing`            | complete                       | chat         | 4096      |                                  |
| `ai/cashflow-forecast`   | complete                       | billing      | **8192**  |                                  |
| `ai/chat`                | complete + **streamResponse**  | fast         | 4096      | **the only SSE-streaming route** |
| `ai/claim-analysis`      | complete                       | billing      | 4096      |                                  |
| `ai/clinical`            | complete                       | clinical     | 4096      |                                  |
| `ai/command`             | complete                       | default      | 4096      |                                  |
| `ai/insights`            | complete                       | fast         | 4096      |                                  |
| `ai/inventory-forecast`  | complete                       | insights     | **8192**  |                                  |
| `ai/no-show-risk`        | complete                       | insights     | 4096      |                                  |
| `ai/patient-segments`    | complete                       | insights     | **8192**  |                                  |
| `ai/pricing-suggestions` | complete                       | default      | 4096      |                                  |
| `ai/query`               | complete                       | query        | 4096      |                                  |
| `ai/suggestions`         | complete                       | fast         | 4096      |                                  |
| `cron/briefing`          | complete                       | reports      | 4096      |                                  |
| `data-import/ai-mapping` | complete                       | default      | 4096      |                                  |
| `ai/agent`               | complete (dynamic import, :86) | fast/default | —         | see below                        |

(Count correction: **17** route files consume OpenRouter, not 16 — the earlier
count missed `app/api/ai/agent/route.ts`, which imports it dynamically. Plus
`lib/ai/agent/server-deps.ts` = 18 files total.)

Two routes are notably robust to a missing/weak model:

- **`ai/agent`** classifies **deterministically first**
  (`lib/ai/agent/loop.ts:647` `classifyAgentTask`); the LLM is a fallback **only**
  for `UNKNOWN` (`:658-666`), and failure pushes `MODEL_UNAVAILABLE` /
  `PARSE_ERROR` instead of throwing.
- **RAG needs no embeddings**: **no route wires an `EmbeddingProvider`**, so
  retrieval is lexical-only today — `lib/ai/knowledge/retrieval.ts:160`
  (`index.embeddingProvider ? await …embed(…) : null`), documented at :155-158
  as "offline, zero network".

## Q3. What would a local text service require?

- **A new compose service.** `docker-compose.yml` defines only `mysql`,
  `migrate`, `app`, `redis` (+ 3 volumes). There is **no** orchestrator, Ollama
  or LLM service in any compose file. A local LLM means a new service + a
  weights volume.
- **A code change to the shared client, not just config.** `complete()`
  hardcodes `OPENROUTER_BASE = 'https://openrouter.ai/api/v1'`
  (`lib/ai/openrouter.ts:8`) and reads `OPENROUTER_API_KEY` (`:28`). Pointing it
  at localhost needs a base-URL override or a provider abstraction — that
  touches the file all 18 consumers share.
- **A model.** The only local model named anywhere in this repo is
  **DentalGemma 1.5 4B IT** (MedGemma dental fine-tune, llama.cpp). It is a
  **VLM for 2D dental images, not a general text LLM**, and it is **not
  registered**: `lib/ai/engines/capability-matrix.ts:223` records GGUF weights
  absent → `RESOURCE_BLOCKED`, and states "a generic VLM is NOT classified as a
  dental VLM without this evidence".
- **Size:** **3.47 GiB** of GGUF artifacts (`capability-matrix.ts:223`,
  `ai-validation/dentalgemma/LOCAL_EXECUTION.md:5`); the Phase-0 audit lists
  `dentalgemma-4b-Q4_K_M.gguf` at **2.87 GB + mmproj**. Two artifacts,
  deliberately git-ignored, not in the repo.
- **Runtime is not installed.** `LOCAL_EXECUTION.md:43-45` expects the operator
  to report `llama.cpp available : False`, then download a llama.cpp Windows
  build from GitHub releases (vulkan-x64).
- **RAM/GPU:** target is i9-13900H / **16 GB** / Iris Xe under a **CPU-only
  contract** (PHASE5: "every engine … must run on plain CPU with zero CUDA
  dependency"; GPU "is an optional speed factor"). Phase 5 measured **imaging**
  at 1.84 GB + 1.74 GB RSS and infers ≥ 12 GB headroom, but labels that
  **[INFERRED]** and says the operator must confirm on target hardware.
  **No text-model RAM/latency figure exists anywhere in the repo** —
  `LOCAL_EXECUTION.md:3-6`: "None of it has been run by the validation work …
  the run, the timing and the memory figures can only come from your hardware."
- **Open decision recorded in the repo:** `docs/DENTORA_AI_PHASE0_AUDIT.md:422`
  — "Cloud dependency for the assistant (strategy): **REPLACE (decision
  required)** … options: local LLM (llama.cpp/Ollama-class) on user hardware,
  hybrid tiers, or explicit cloud acceptance. **Code stays until decided**."

## Note on the inert env names

`DEN_TORA_AI_MODEL`, `DEN_TORA_AI_FAST_MODEL`, `DEN_TORA_AI_REASONING_MODEL`
have **zero references** in the repo (S2-1). They would fit a 3-bucket local
tiering, but `lib/ai/models.ts:21-48` actually defines **10** tiers
(`fast`, `chat`, `default`, `reports`, `query`, `scheduling`, `billing`,
`insights`, `clinical`, `command`), every one pointing at a cloud model
(`google/gemini-2.5-flash-lite`, `google/gemini-2.5-pro`,
`anthropic/claude-opus-4.5`). So those names are not a partial wiring of this
codebase — nothing here was ever built to read them.

---

# S5 — IMPLEMENTATION (phase A skipped, phases B and C done) + CORRECTION

## CORRECTION to the S5 audit: findings 2, 3 and 4 were WRONG

The audit reported `t('Refresh')`, `t('Clear all')` and `t('Active')` as
unresolved keys that paint raw English. **That was wrong**, and I caught it
before writing any code.

My check tested whether each literal was a **KEY** in `ar.json`. But the legacy
pattern passes an English **VALUE**, which `translateText` resolves through a
reverse index:

    lib/i18n/dictionary.ts:77-79
    if (text in dictionaries[resolveLocale(locale)]) return translate(locale, text, vars)
    const key = getReverseIndex().get(text)
    return key ? translate(locale, key, vars) : text

Re-tested with the real function at `ar-EG`:

| literal               | resolves to           | verdict                  |
| --------------------- | --------------------- | ------------------------ |
| `Refresh`             | تحديث                 | already fine             |
| `Clear all`           | مسح الكل              | already fine             |
| `Active`              | نشط                   | already fine             |
| `Q1 (UR)`             | `Q1 (UR)`             | **genuinely unresolved** |
| `Upper Jaw (Maxilla)` | الفك العلوي (ماكسيلا) | fine                     |

A full sweep of the 47 `t()` literals in `components/dental-chart` using
`translateText('ar-EG', …)` found **0 unresolved**. So findings 2-4 are
retracted; only the corner labels (1) and the date format (5) were real.

**Phase A was therefore skipped, not completed.** Adding those three keys would
have created redundant duplicate entries (each literal is already an English
value mapped to a key) and could have confused the reverse index.

## Phase B — DONE (`5e33739`)

`components/dental-chart/odontogram/ToothHistoryTimeline.tsx` (+9/-2), one
product file. `format(date, 'MMM d, yyyy')` had no locale, so date-fns used
en-US and rendered `Jan 5, 2024`. Now passes
`locale: dateFnsLocale(locale)` using the pre-existing, previously unused
helper in `lib/i18n/dates.ts` (not modified). Format string unchanged, so only
the month name localizes.

## Phase C — DONE (`3da2b63`)

`ArchGrid.tsx` (4 text nodes wrapped in `t()`, +4/-4) plus 4 keys in
`locales/ar.json` + `locales/en.json`.

The `en` values are an **identity mapping** (value == literal) on purpose. The
no-provider context `t()` is hardcoded to `'en-EG'`
(`language-provider.tsx:34`), documented inline as "components rendered outside
a LanguageProvider … keep showing the exact English strings they always
showed". The identity mapping preserves that exactly.

**The gate the user set was satisfied and proven:** exactly one file references
those literals — `tests/components/clinical-components.test.tsx:249-252`, four
`getByText` assertions. **None was edited** (`git diff` on that file is empty),
and all four still pass, because that test renders `<DentalChart>` with no
`LanguageProvider` and so resolves through the `en` identity mapping.

## Tests added

`tests/components/dental-chart-i18n.test.tsx` (new, 2 tests). Renders inside the
real `LanguageProvider` (`defaultLocale` = `ar-EG`) and asserts the date carries
no English month name and the four corner cues are Arabic with the English
originals gone. Both were shown failing first:

    -> expected [ 'Jan' ] to deeply equal []
    -> Unable to find an element with the text: الربع الأول (أعلى يمين)

Verified: 188 passed / 0 failed across the 9 relevant suites; the 5 Phase-3
protected odontogram suites stayed green throughout (89 tests).

## Still open (unchanged, not started per instruction)

- `Quadrant`'s unrendered `title`/`subtitle`/`id`/`mode` props — dead props,
  recommended for a separate refactor, deliberately not conflated with i18n.
- P2 / session 3 not started.

## =====================================================================
## P0 PREFLIGHT — MASTER-DENTORA-ALL-IN-ONE.md (executor: Arena, 2026-11-07)
## =====================================================================

**Branch note.** `merge/fdi52-into-wip` is the canonical branch. This Arena
session is pinned to `arena/91dddda0-dental-clinic-system`; both are kept at
the SAME commit and both are pushed, so a single tip hash identifies both.

### Section 1 — tip verification: **PASSED**

    $ git fetch origin +refs/heads/merge/fdi52-into-wip:refs/remotes/origin/merge/fdi52-into-wip
    $ git merge-base --is-ancestor 75d1ffd origin/merge/fdi52-into-wip && echo YES
    ANCESTOR: YES
    $ git log --oneline 75d1ffd..origin/merge/fdi52-into-wip
    baf39b2 fix(vendor): export missing imperative state functions from rao-odontogram
    8cedb99 R1a: scope the vendored CSS, keep removals removed, close the debounce window

Both extra commits are accounted for: `8cedb99` is the R1a work described
above; `baf39b2` is the P1 build fix (see P1 below), authored on another clone
but present on origin, therefore REUSED rather than redone.

### Environment: **SANDBOX**

| Probe | Result |
| --- | --- |
| `node -v` | v22.22.3 |
| `npm -v` | 10.9.8 |
| `docker --version` | **command not found** |
| `git rev-parse --is-shallow-repository` | **true** (depth 1) — repaired with `git fetch --deepen=300 origin` |
| `require('@prisma/client')` | **Cannot find module** (`npm ci --ignore-scripts` ⇒ no `prisma generate`) |
| `ls ai-validation/*/model/` | dirs exist, **no weight files** (`*.pt/*.onnx/*.pth` → none) |
| `.env` | **absent** (only `.env.example`) |
| browser | none |

Consequences: `npm run build` and every DB/Docker/E2E item are **[LOCAL]** —
they can only be run by the user. The two scripts in `scripts/verify-*.sh`
exist for exactly that.

### BASELINE measured at `baf39b2` (P0 gate)

| Gate | Command | Result |
| --- | --- | --- |
| typecheck | `npx tsc --noEmit` | **498 errors** — all from the absent Prisma client |
| vendor typecheck | `npm run typecheck:vendor` | **0 errors** |
| lint | `npx eslint .` | **0 errors, 304 warnings**, exit 0 |
| tests | `npx vitest run` | **6449 passed / 1 failed / 12 skipped** (357 files: 354 passed, 2 failed, 1 skipped), 430 s |
| build | `npm run build` | **[LOCAL]** — not runnable here (Prisma client absent) |
| models in git | `git ls-files \| grep -Ei '\.glb$'` | **0** — clean |

The single test failure is `tests/unit/dev-start-env.test.ts` →
`Cannot find module '.prisma/client/default'`. Environmental, pre-existing,
not caused by any chart work.

Compare with the last reported baseline at `8cedb99` (6447 passed / 1 failed /
12 skipped): **+2 tests** (the two new `rao-vendor-exports` guards), same
single environmental failure. The suite did NOT get worse.

## =====================================================================
## P1 — REPAIR THE BROKEN BUILD
## =====================================================================

status **VERIFIED-HERE** for the bundling error; **BLOCKED** (B18/B14) for the
final `npm run build` exit code, which needs the user's machine.

### Root cause

`RaoOdontogram.tsx` imports imperative state functions from the vendored
library's entry module. Three of them — `resetForPatient`, `getToothStates`
and `setSelectedTeeth` — are defined in `vendor/.../src/odontogram.ts`
(lines 8222 / 8250 / 8271) but were never re-exported from
`vendor/.../src/index.ts`, which only did `export * from './App'`.

**Why the mocks hid it (the actual lesson):**

1. `tests/components/rao-odontogram.test.tsx` mocks `rao-odontogram` with
   `vi.mock()`, so the component never touched the REAL entry module. The mock
   supplied `getToothStates` because the test author wrote it that way.
2. `types/rao-odontogram.d.ts` is an **ambient** declaration: it ASSERTSthe
   names exist. `npx tsc --noEmit` therefore stayed clean — the declaration
   asserted the exports instead of the code providing them.
3. Only a real bundler resolves actual module exports, and that runs in
   `npm run build`, which this sandbox could not execute (B14).
   Mock + ambient declaration = two independent layers of false assurance.

That is why MASTER §4.4 requires at least one test per vendored module that
loads the REAL module. `tests/unit/rao-vendor-exports.test.ts` is that test.

### The fix — already on origin, therefore REUSED not redone

`baf39b2` (Patch 10) adds to `vendor/.../src/index.ts`:

    export { resetForPatient, getToothStates, setSelectedTeeth } from './odontogram'

MASTER §1 says: "Redo P1 from the remote state; if origin already contains any
of it, reuse it." It does, so it was re-verified rather than rewritten.

### Non-mock guards (2a + 2b)

`tests/unit/rao-vendor-exports.test.ts` imports the REAL module
(`import * as realRao from 'rao-odontogram'`, resolved through the vitest
alias) and (a) parses every `export function X(` declared in
`types/rao-odontogram.d.ts`, asserting each is a real function on the real
module; (b) smoke-tests importStatus / getToothStates / onStateChange /
resetForPatient / setSelectedTeeth / getSelectedTeeth / initOdontogram /
destroyOdontogram / OdontogramShell / default.

    $ npx vitest run tests/unit/rao-vendor-exports.test.ts tests/unit/rao-vendor-patches.test.ts
     Test Files  2 passed (2)
          Tests  17 passed (17)

### NEGATIVE CONTROL (2c) — inject the fault, watch it fail, revert

    - export { resetForPatient, getToothStates, setSelectedTeeth } from './odontogram'
    + export { resetForPatient, setSelectedTeeth } from './odontogram'

     Test Files  1 failed (1)
          Tests  2 failed (2)
     AssertionError: expected 'undefined' to be 'function'

Reverted -> `Tests 17 passed (17)` and `git status --short` empty. Both guards
fail on the exact fault that broke the user's build, so neither is vacuous.

### Build

    $ npm run build
    ✓ Compiled successfully in 6.8s
    Failed to type check.
    BUILD_EXIT=1

    $ grep -cE "Export (getToothStates|resetForPatient|setSelectedTeeth) doesn't exist" <log>
    0

The original symptom is GONE. Type checking now fails only on missing
`@prisma/client` exports (B14), e.g. `prisma/seed.ts(12,3): error TS2305`.
The only chart-related type errors are Prisma-inference artifacts:
`app/api/dental-chart/route.ts(75,22)` and `(155,52)` — TS7006 implicit-any on
`entry` / `tx` — which cannot occur once the client is generated.

**`npm run build` therefore stays [LOCAL] (B18) until the user runs it after
`npx prisma generate`.**

## =====================================================================
## P2 — PRIMARY TEETH IN THE API (approved)
## =====================================================================

status **VERIFIED-HERE** — no schema change.

### Root cause

`app/api/dental-chart/route.ts` (POST) validated the tooth number against a
literal 32-item array (11..48). `app/api/dental-chart/[id]/route.ts` (PUT) had
**no tooth validation at all** — `updateData` never even read
`body.toothNumber`, so a caller could write `toothNumber: 99` straight into the
database. The canonical rule set (`isValidFdi`, 52 ids) already existed in
`lib/dental-chart/fdi.ts` and was already used by the summary route; the two
write routes had simply drifted away from it.

### Fix

- POST: the literal array is replaced by `isValidFdi(toothNumber)`.
- PUT: validates `body.toothNumber` when present, and now persists it.
- The error text keeps the protected token **"FDI"**:
  `Invalid tooth number. Use FDI notation (permanent 11-48, primary 51-85)`
- `isValidFdi` takes `unknown`, so the numeric string `'51'`, `1.5`, `true`,
  `null` and `undefined` are all rejected with **no coercion**.

All three dental-chart routes now import the shared module:

    $ grep -ln "lib/dental-chart/fdi" $(find app/api/dental-chart -name route.ts)
    app/api/dental-chart/[id]/route.ts
    app/api/dental-chart/[id]/summary/route.ts
    app/api/dental-chart/route.ts

### Test-first: RED then GREEN

The one test allowed to change was my own
`tests/api/dental-chart-cross-hospital.test.ts`, which pinned "51 => 400" —
it pinned the BUG, not the rule. Per MASTER §P2 the invalid example moved to
**56** (a primary quadrant only has indices 1-5) and the block was rewritten
to pin the corrected behaviour.

RED (before the fix):

     Test Files  1 failed (1)
          Tests  13 failed | 27 passed (40)
     AssertionError: expected 200 to be 400      <- PUT had no validation

GREEN (after):

     ✓ tests/api/dental-chart-cross-hospital.test.ts (40 tests)
     Test Files  1 passed (1)
          Tests  40 passed (40)

New coverage: POST accepts all eight primary quadrant corners
(51/55/61/65/71/75/81/85) plus permanent 11/48; POST rejects 56, 86, 19, 99,
0, -11, 1.5, `'51'`, `true`, `null`, `undefined`; the message still matches
`/FDI/i`; PUT accepts 51 and 85; PUT rejects 56, 86, 19, 99, `'51'`; PUT with
no `toothNumber` behaves exactly as before.

### Protected suites re-run — NOTHING edited

     Test Files  21 passed (21)
          Tests  272 passed (272)

Includes the protected `tests/api/dental-chart-routes.test.ts`, both
`odontogram-clean-room` suites, `dental-chart-summary`, `ai-context-tooth`,
the two `fdi-*` suites and `rao-odontogram`. Every protected assertion is
intact: 99 => 400 still holds, `isValidFdi(9)`/`(49)` are still false, and
primary 51/75 are still preserved by the summary route.

## =====================================================================
## P9.1 (CODE PART) — STORAGE PRE-FLIGHT + setup:dev CONSISTENCY
## =====================================================================

status **VERIFIED-HERE** for the code. The runtime diagnosis stays **[LOCAL]**
(B15 no Docker, B17 no `.env` in this sandbox).

### The hypothesis from MASTER §3 is CONFIRMED at the code level

1. `app/api/imaging/studies/route.ts:302` — `await getStorage().put(originalKey, bytes, …)`
   writes the imaging original through the **app's** driver.
2. `lib/storage/index.ts` — `createStorage()` defaults `STORAGE_DRIVER` to
   **`local`** when unset/empty.
3. `.env.example:28` ships `STORAGE_DRIVER="local"` as an ACTIVE line, but the
   entire `S3_*` block (lines ~40-47) is **COMMENTED OUT** — so the template
   defines no S3 variable name at all.
4. `scripts/lib/setup-dev.ts` fills ONLY keys present in the template
   (`REQUIRED_KEYS` = DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY,
   CRON_SECRET, ORCHESTRATOR_SECRET). A bootstrap on that template can never
   emit `S3_*`.
5. `app/api/imaging/studies/route.ts` hands the same `originalKey` to
   `requestOrchestratorAnalyze(...)`, and the orchestrator fetches it from
   **MinIO** — where a local-disk write never landed. Hence `NoSuchKey`.

Thumbnails still load because the app reads them back through its OWN driver
(its own disk) and never through MinIO — which is exactly why the failure
looked so arbitrary.

### Code outcomes

- **Single source of truth — `lib/storage/env.ts` (new).** Names all eight
  storage variables, the two drivers, the dev defaults (identical to
  docker-compose.dev.yml and to the commented block in `.env.example`), and
  the rule `orchestratorCanReadDriver()` — true only for `s3`.
- `lib/storage/index.ts` now falls back through `readStorageDriver()` instead
  of re-declaring `'local'`. Behaviour is unchanged (unset/empty → local; a
  non-empty unknown value still throws the same message) — the 9 existing
  factory tests pass untouched.
- **Analyze pre-flight** in `app/api/imaging/studies/route.ts`, gated on
  `isOrchestratorConfigured()` so it cannot disturb any other path:
  * driver not orchestrator-readable → 503 `STORAGE_DRIVER_INCOMPATIBLE`
  * object absent from the store     → 503 `IMAGING_OBJECT_MISSING`
  * the driver throws (raw NoSuchKey)→ 503 `STORAGE_PREFLIGHT_FAILED`

  All three return ARABIC user text plus a machine-readable `code`; the raw
  storage error goes to the server log only, never into the response.
- **`npm run setup:dev` now guarantees the storage names.** `STORAGE_KEYS` is
  imported from `lib/storage/env.ts` and appended (action `from-template`)
  when absent. Existing non-empty values are never overwritten, and
  `STORAGE_DRIVER` is deliberately left at the template's `local`, so enabling
  object storage stays an explicit one-line decision.

### Tests

- `tests/unit/storage-env.test.ts` (14) — vocabulary, defaults, driver
  parsing, and the rule `orchestratorCanReadDriver('local') === false`.
- `tests/api/imaging-analyze-storage-preflight.test.ts` (6) — proves each of
  the three 503 paths, asserts the body matches `/[؀-ۿ]/` (Arabic) and that
  `NoSuchKey` never reaches the response, and proves the pre-flight stays out
  of the way when the orchestrator is not configured.
- `tests/unit/setup-dev-storage.test.ts` (7) — the bootstrap emits every
  storage name (including the ones the template ships commented out), never
  overwrites an existing `STORAGE_DRIVER`, is idempotent, and the existing
  "exactly four generated secrets" contract still holds.

     Test Files  4 passed (4)
          Tests  35 passed (35)     (includes the pre-existing setup-dev.test.ts, 8 tests, unmodified)

### Not done here

- The runtime proof (list the MinIO bucket, compare both worktrees' `.env`) is
  [LOCAL] — see `docs/USER-VERIFY.md` §3.
- `scripts/migrate-storage.ts` was located and **NOT run**, as instructed.

## =====================================================================
## P3 — 2D v2 COMPLETION
## =====================================================================

status **BUILT** — deliberately NOT "DONE". MASTER §P3 requires the user's
screenshots (D2 precondition) before this may be called done.

| P3 requirement | Evidence |
| --- | --- |
| load from API | `tests/components/rao-odontogram.test.tsx` load group (3) |
| add/modify/remove -> POST/PUT with the mapped payload | edit group, incl. "POSTs the mapped payload when a finding is added" |
| failure -> rollback to the last saved snapshot + Arabic error | failure group (3): 500 rollback + `تعذّر حفظ التعديلات. تم التراجع عن التغييرات.`; 403 verbatim; never false-saves |
| double-submit guard | `inFlightRef` in `RaoOdontogram.tsx` |
| flush on unmount | debounce group (3), incl. `beforeunload` warning while pending |
| readOnly from role | `MUTATOR_ROLES = {DOCTOR, ADMIN}`; SUPER_ADMIN/RECEPTIONIST read-only with the Arabic note `وضع العرض فقط — لا يمكنك تعديل المخطط السني` |
| per-patient reset | `resetForPatient()` + `store.reset()` on patient change |
| primary teeth 51-85 editable after P2 | `RaoOdontogram.tsx:208,237-239` — `slotToFdi(slot, isPrimary)` maps a library slot back to 51-85; P2 made the API accept the result |
| no English sentence reachable | see below |
| CSS scoped to `.rao-scope`, 13-test guard | `tests/unit/rao-vendor-css-scope.test.ts` (13) |
| dark mode follows the app class | `tailwind.config` `darkMode: ['class']`; `.dark` sits on `<html>`, an ancestor of `.rao-scope`, so `.dark .rao-scope` matches. PATCH 9 rewrote the two bare `.dark` rules to `.dark .rao-scope`, preserving them. |
| restricted to mappable conditions | `docs/dental-chart/CONDITION-MAPPING.md` (8.3 KB); unmapped findings surface in the `حالات غير معروضة في المخطط` panel |

    $ npx vitest run tests/components/rao-odontogram.test.tsx \
                     tests/unit/rao-vendor-css-scope.test.ts \
                     tests/unit/rao-adapter-roundtrip.test.ts
     Test Files  3 passed (3)
          Tests  100 passed (100)

### The English sentence — located, NOT fixed, proven unreachable from v2

`components/dental-chart/odontogram/Odontogram.tsx:234-236`, a hardcoded
ternary with **no `t()` wrapper**, which is why it renders in Arabic mode:

    : 'Click on a tooth or individual surface to view and update clinical findings. (FDI notation)'}

    $ grep -rn "Click on a tooth or individual surface" components/ app/ vendor/
    components/dental-chart/odontogram/Odontogram.tsx:236

Exactly one hit, in the OLD chart. v2 imports neither that component nor any
hardcoded English string, so the sentence cannot reach it. Left unfixed on
purpose — the old chart is protected until the user says ACCEPT (D2).

### STOP — user acceptance required

The following is [LOCAL] and is where this task stops.

### P2 follow-up — the Arabic-only rule caught my own error message

The full-suite regression run flagged `tests/unit/i18n-api-messages.test.ts`:
my new English message `Invalid tooth number. Use FDI notation (...)` violated
MASTER §4.6 (Arabic only). The guard is correct and was NOT touched.

    - Array [ "app/api/dental-chart/route.ts: Invalid tooth number. Use FDI notation (...)",
    -         "app/api/dental-chart/[id]/route.ts: Invalid tooth number. Use FDI notation (...)" ]

Both messages are now Arabic while still carrying the `FDI` token the
protected assertion requires:

    'رقم السن غير صالح. استخدم ترقيم FDI (الدائم 11-48، واللبني 51-85)'

    $ npx vitest run tests/unit/i18n-api-messages.test.ts \
                     tests/api/dental-chart-routes.test.ts \
                     tests/api/dental-chart-cross-hospital.test.ts
     Test Files  3 passed (3)
          Tests  65 passed (65)

## =====================================================================
## P9.1b — NO CREDENTIAL IN SOURCE (storage defaults derived from compose)
## =====================================================================

status **VERIFIED-HERE**. Rule: values must derive from docker-compose.dev.yml
or be generated, and must never be printed.

The first version of `lib/storage/env.ts` hardcoded the dev MinIO credentials
(`S3_ACCESS_KEY: 'dentalerp'`, `S3_SECRET_KEY: 'dentalerp123'`, the endpoint and
the bucket). That violated the rule even though the same values were already
public in `.env.example` — code must not carry a copy.

### Where each value comes from now

| Value | Source |
| --- | --- |
| `S3_ACCESS_KEY` | `MINIO_ROOT_USER` — `docker-compose.dev.yml:76` |
| `S3_SECRET_KEY` | `MINIO_ROOT_PASSWORD` — `docker-compose.dev.yml:77` |
| `S3_ENDPOINT` | the published `9000:9000` port — `docker-compose.dev.yml:79` |
| `S3_BUCKET` | `mc mb --ignore-existing local/<bucket>` — `docker-compose.dev.yml:107` |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | MinIO protocol facts, NOT secrets — `STORAGE_PROTOCOL_DEFAULTS` in `lib/storage/env.ts` |
| `STORAGE_DRIVER`, `UPLOAD_DIR` | active lines already in the template — `.env.example:28,31` |

All four compose values are read by `scripts/lib/compose-storage.ts`.

    $ grep -nE "dentalerp|S3_(ENDPOINT|ACCESS_KEY|SECRET_KEY|BUCKET):" lib/storage/env.ts
    (no matches)

**Fail loud, never invent.** If a value cannot be derived the bootstrap throws
(`Cannot derive S3_ACCESS_KEY … refusing to invent a storage value`), because
an empty or invented `S3_*` is exactly what lets the app write to local disk
while the orchestrator reads MinIO. Nothing is printed: values go straight into
`.env` (gitignored); logs and warnings carry NAMES only.

Tests `tests/unit/compose-storage.test.ts` (13): derivation, service-block
isolation (a later service mentioning `MINIO_ROOT_*` must not win), fail-loud
for each missing value, and a sweep proving no credential literal exists in
`lib/` or `scripts/`.

## =====================================================================
## P9.1c — DUPLICATE .env KEYS WARN (names only, which one wins)
## =====================================================================

status **VERIFIED-HERE**. Cause: copying lines in `.env`.

`scripts/lib/dev-env.ts` gains `findDuplicateEnvKeys()` +
`formatDuplicateKeyWarning()`. Semantics mirror the parser exactly:
`parseEnvFileContent` assigns in file order and skips empty values, so the
**last non-empty occurrence wins**; if all are empty the key is absent
(`winningLine === -1`). Both rules are cross-checked against the real parser.

Wired into `npm run setup:dev` (`.env.example` + `.env`) and `npm run dev:start`
(`.env` + `.env.local`). NAMES ONLY:

    [env] WARNING: .env declares 1 key more than once (names only - no values shown).
    [env]   S3_SECRET_KEY: 2 occurrences at lines 4, 9 - line 9 wins (the last non-empty one). Delete the others.
    [env]   Duplicates are legal but ambiguous: remove the losing lines to avoid surprises.

Tests `tests/unit/dev-env-duplicates.test.ts` (13), including an assertion that
no value (`hunter2`) can ever reach the warning text.

    Test Files  5 passed (5)
         Tests  56 passed (56)

## =====================================================================
## P4 — DENTAL-SCOPE 3D CHART (STARTED; CODE PARTS ONLY)
## =====================================================================

### S1 — vendor the MIT engine with licence and notices — **BUILT**

`vendor/dental-scope-engine/` (commit `0a6722b`'s parent `0152c65`):

| Field | Value |
| --- | --- |
| Upstream | https://github.com/Yoosseph/dental-scope |
| Pinned commit | `e34d4b986d5439501f23c91cde593f69a3b180b0` |
| Code licence | **MIT** (`LICENSE` vendored verbatim) |
| Files | **115 files, 1.5 MB — 0 model files** |
| Provenance | `VENDOR.md` |
| Patch log | `PATCHES.md` — empty at S1; the tree is upstream verbatim |

The upstream tarball is ~266 MB, of which **571 files are 3D model assets**.
None is committed:

    $ git ls-files | grep -Eic '\.glb$'
    0

Also excluded: `docs/`, `e2e/`, `.github/`, and every upstream `*.test.ts`.

Facts verified by READING the vendored source (not from memory):
* `src/engine/Engine.ts:86` `export class Engine`; `:186` `mount(container)`;
  `:265` `dispose()`.
* Tooth meshes keyed **`tooth-<NN>`** = the two-digit FDI number
  (`Engine.ts:313`, `DevelopmentScene.ts:62,305`) — this is the key↔FDI mapping
  the adapter needs.
* Runtime deps we need: **three, three-mesh-bvh, zustand** (React/fonts/analytics
  belong to its own UI chrome, not used).
* Vite/ESM-only ⇒ must load via `next/dynamic` with `ssr: false`.

### S2 — asset modes, DEFAULT `none` — **BUILT**

`lib/dental-chart/3d/asset-mode.ts`:

* `none` **(DEFAULT)** · `local` · `bundled`.
* An unknown or missing `ASSET_MODE` falls back to `none`, never to a mode that
  loads third-party meshes.
* **`bundled` throws `BundledAssetsBlockedError`** until `docs/legal/3D-ASSETS-DECISION.md`
  contains the marker `D1-DECISION-RECORDED`.
* `neurovascular.glb` is forbidden in **every** mode (CC BY-SA 4.0, Z-Anatomy).

`3d-assets.manifest.json` — committed, **34 entries, 53.6 MB, 0 forbidden
files**. Real SHA-256 digests computed from the pinned tarball, plus the
upstream commit and the licence text. It records the licence conflict honestly
(2.1 JP vs CC BY 4.0, marked UNRESOLVED) instead of picking a side.

`scripts/3d-assets/fetch.mjs` — downloads the **pinned** commit, extracts only
manifest-listed files, verifies every SHA-256 and size, writes to the
gitignored `.local-assets/3d/`. A checksum mismatch is a **hard failure**; a
digest is never edited to make a check pass.

`docs/legal/3D-ASSETS-DECISION.md` — the D1 template with the four lawyer
questions. It is a TEMPLATE: it does not contain the marker, so `bundled` is
refused.

Tests `tests/unit/asset-mode.test.ts` (14) — defaults, `bundled` blocked-without-D1,
forbidden assets, and manifest integrity.

### S3, S4–S5, S7, S9 (partial) — **NOT STARTED**

The budget for this turn ran out after S2. `PATCHES.md` already lists the six
engine patches S3 needs.

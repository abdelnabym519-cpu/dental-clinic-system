# DenToRa AI — Phase 4: Dental Knowledge + RAG (Provenance-Aware Retrieval)

> Status: COMPLETE — all §44 gates green.
> Branch: `arena/01a0ce7a-dental-clinic-system` · Baseline before Phase 4: commit `8c16fff`
> (5363 tests / 12 skipped / 0 failed · tsc 503 · eslint 0 — all preserved).

## 1. Scope and non-goals

Phase 4 builds the **trusted, structured, provenance-aware Dental Knowledge Layer**:
`Source → Ingestion → Normalization → Indexing → Retrieval → Evidence → Agent Context → Grounded Response`.

In scope (§0):
- Dentistry-only controlled knowledge (12 top-level domains, §4 taxonomy with subtopics).
- Typed, no-`any` contracts for document/chunk/source/citation/result/query.
- Source tiers TIER_1..TIER_4 with **clinical default T1+T2**, T3 educational-only, T4
  never for clinical decision support unless explicitly configured — and always labeled.
- Deterministic, observable ingestion; all-or-nothing publish; unknown metadata stays UNKNOWN.
- Semantic-boundary chunking with position records; checksum dedup; distinguishable versions.
- Bounded, tenant-scoped, offline retrieval (in-memory index over 3 bounded loads).
- Hybrid lexical+semantic ranking behind a provider abstraction with a deterministic
  LEXICAL fallback (no cloud-only embeddings; runtime is fully offline).
- Grounding: 4 fact classes, machine-readable server-built citations, conflict reporting,
  freshness + jurisdiction preservation, honest typed failures.
- Agent integration: `retrieve_dental_knowledge` in the Phase 3 Tool Registry (closed, typed,
  permissioned), KNOWLEDGE task classification, hybrid answers, §29 clinical format.
- Minimal admin ingestion API (no CMS), synthetic TEST DATA corpus, deterministic eval +
  security matrix + performance bench, additive Prisma migration.

Explicit non-goals (NOT done in Phase 4):
- Phases 5–11 (local AI models, multimodal, eval expansion, engine completion, memory, voice, robot).
- No LLM-provider replacement, no training/fine-tuning, no general-purpose RAG platform.
- No second agent; no bypassing Phase 1 safety or Phase 2 context.
- No PMS/Odontogram/Imaging/Portal changes (the Phase 4 agent edits are additive orchestration only).
- No heavy vector DB, no distributed vector infra, no crawler, no embedding platform.
- The knowledge layer never executes actions — Phase 1 remains the only write path.

## 2. Engineering loop (per §43)

1. Read Phase 0–3 docs + all safety/context/agent code + git history before coding.
2. Fresh baseline measured, not assumed: 5363/12/0, tsc 503, eslint 0 (verified on `8c16fff`).
3. Contracts first (`lib/ai/knowledge/types.ts`), then taxonomy → normalize → chunking →
   ingestion → store → index → retrieval → grounding, each stage unit-tested before the next.
4. Synthetic corpus harness (`tests/harness/knowledge-fixtures.ts`) built as a fixture, not seed.
5. Agent integration last, behind the existing closed registry; then route, tests, bench, doc.
6. Final audit: full regression + adversarial review + exact-file git (below).

## 3. Architecture: an independent layer, not an orchestrator

```
lib/ai/knowledge/
  taxonomy.ts   12 domains + §4 subtopics + term detection (bilingual)
  types.ts      typed contracts (no any): Source/Document/Chunk/Citation/Result/Query/Failure
  errors.ts     typed failure codes + honest user-facing failure text
  checksum.ts   sha256 document hash + chunk checksums
  normalize.ts  bilingual term map (v1), stop-filtering, query normalization
  chunking.ts   semantic-boundary chunking (heading/section/paragraph/table/list), positions
  ingestion.ts  10-stage deterministic pipeline, all-or-nothing, patient-data detector
  store.ts      KnowledgeStore interface + memory impl (tests) + Prisma impl (prod)
  index.ts      per-query in-memory index, 3 bounded loads, postings (raw + canonical)
  retrieval.ts  filter → candidates → deterministic ranking → dedup → budget → conflicts
  grounding.ts  deterministic citation/grounding/fact-class checks (§20/§21/§40)
```

Independence rules (spec §3): the **agent** decides whether/what/how-much to retrieve;
the **knowledge layer** decides sources, indexing, ranking, provenance. The LLM never
touches arbitrary documents — it only interprets a bounded, server-built evidence package,
and its output is machine-checked against that package before the response is returned.

## 4. Contracts (spec §7)

Key types (all in `lib/ai/knowledge/types.ts`, no `any`):
- `KnowledgeSource` + `KnowledgeSourceMeta` — full §6 metadata; every unknown stays
  `null` (→ UNKNOWN), never invented. `scope: GLOBAL | TENANT` with tenant pinning.
- `KnowledgeDocument` — versioned content, `contentHash` (sha256 of normalized text),
  `PUBLISHED | SUPERSEDED | REJECTED`.
- `KnowledgeChunk` — `section` (heading path = semantic boundary), `position`, `checksum`.
- `KnowledgeCitation` — machine-readable, built exclusively server-side from STORED
  metadata: `citationId` (`c1..cN`), title, publisher, publicationDate, version, url
  (stored reference ONLY), authorityTier, language, jurisdiction, `factClass`.
- `KnowledgeRetrievalResult` — rank, chunk, source, document, relevanceScore (0..1),
  matchType, authorityTier, freshness, lowAuthority, matchedTerms (explainability, not CoT).
- `KnowledgeEvidencePackage` — ok, queryId, results, citations, conflicts, budgetUsed,
  stats, typed `failure` (spec §36).
- `IngestionReport` — per-stage observability (counts/timings only, no content).

## 5. Source policy (spec §5)

- `TIER_ELIGIBILITY`: clinical = [T1, T2]; educational = [T1, T2, T3]; T4 only with explicit
  `allowTier4: true` — and ranked below T1 (weight 0.6) and always labeled in the answer.
- Tier weights: T1 1.0 · T2 0.95 · T3 0.85 · T4 0.6. Quality is never silently mixed.
- Freshness: CURRENT/AGING/STALE/UNKNOWN_DATE from stored dates only; STALE ×0.92;
  UNKNOWN_DATE is surfaced in the answer's Uncertainty section, never assumed current.
- Jurisdiction is stored and shown, never inferred (Egypt is NOT a default).

## 6. Patient-data separation & tenancy (spec §8)

- `detectPatientData` runs in ingestion: patient ids/charts/notes → `REJECTED
  PATIENT_DATA_DETECTED` (tested: the leak fixture never reaches the index).
- Global knowledge contains no patient rows (asserted over the whole corpus in the
  security suite).
- TENANT-scope sources are pinned to the SESSION tenant in the API; a client-supplied
  `hospitalId` is structurally dropped. Retrieval always runs under the server tenant:
  tenant B's private protocol is invisible to tenant A (tested end-to-end through the agent).

## 7. Ingestion (spec §9/§10) — deterministic, observable, all-or-nothing

10 stages: validate → normalize → metadata → domain → chunking → **checksum** → **dedup** →
index → validate_publish → publish. A failed stage produces a typed `IngestionReport`
(`REJECTED` + code) and **nothing is published** (store commit is all-or-nothing; the
Prisma store commits in a `$transaction`). All source content is treated strictly as DATA:
prompt-injection text is indexed, retrievable, and inert — no action, approval, mode change
or tool call exists anywhere in the knowledge layer (asserted in the security suite).

Dedup: identical normalized content → `DUPLICATE_CONTENT` (source-level checksum);
near-duplicate chunks (Jaccard ≥ 0.92 vs published) are dropped and counted. Versions are
distinguishable: `replaceVersion` supersedes (v1 → SUPERSEDED, chain stored), and retrieval
returns PUBLISHED versions only (the version-attack test queries the superseded v1 facts and
gets v2, not v1).

## 8. Chunking & indexing (spec §11/§12/§13/§14)

- Semantic boundaries: headings (level-aware path), paragraphs, lists, tables (kept whole
  unless oversized); every chunk records `section` + `position`. Defaults: target 700 /
  min 160 / max 1200 chars, ≤6 units per chunk.
- Index: per-query in-memory build over exactly **3 bounded store loads**
  (sources → documents → chunks). Posting lists keyed on raw tokens (`t:`) AND canonical
  terms (`c:`) — bilingual matching is symmetric. No vector DB, no cache (Phase 2 decision
  stands; build cost measured in the bench).
- Embeddings: `EmbeddingProvider` abstraction (`name`, `dimensions`, `embed`). **No provider
  is bundled** — the default method is deterministic LEXICAL, fully offline (no network at
  runtime; ingestion never needs network either). With a provider, vectors are computed
  once at index build (no duplicate embedding work — bench-asserted) and the SAME lexical
  candidates are re-ranked with clamped cosine (0.6 lexical + 0.4 semantic).
  Documented limitation: lexical postings remain the recall floor; a semantic-only recall
  channel is deliberately out of scope.

## 9. Retrieval pipeline (spec §15–§17)

`query → normalize → tier/domain/language/jurisdiction filter → posting candidates →
deterministic scoring → stable ranking → near-dup drop (0.90) → per-source cap (2) →
evidence char budget (12,000) → conflict detection → evidence package`.

Scoring (deterministic): BM25-style `min(1, (lex+sectionBoost)/(w·3) · (0.55+0.45·domain)
· tier · freshness)`; section boost 0.15; stable tie-breaks (tier → date → doc → position).
Same query + corpus (+ provider) → identical package (bench-asserted for LEXICAL and HYBRID).

Conflicts are explicit, never merged: same topic, different tiers/dates → `conflicts[]`
with per-source details; the answer names the conflict instead of inventing consensus.

## 10. Grounding (spec §20–§22, §40)

Four fact classes: `KNOWN_FROM_SOURCE` / `KNOWN_FROM_PATIENT_RECORD` / `MODEL_INTERPRETATION`
/ `UNKNOWN`. `grounding.ts` (pure, deterministic) detects every `[c#]` marker (never trusts
them), reports unsupported ones, counts grounded statements (content-word overlap with the
cited chunk), and labels the answer body. The agent loop strips invented citations from the
LLM interpretation and reports them in `response.grounding.unsupportedCitations` (tested:
`[c9]` hallucination removed, `[c1]` kept). Insufficient evidence → the answer says so;
an unavailable knowledge base → "I have not checked any guidelines" (spec §36 wording).

## 11. Agent integration (spec §26–§29)

- **Classification**: new deterministic `KNOWLEDGE` task type. Strong clinical intents
  (guidelines/criteria/protocol/…) may pass the dental domain gate (the KB is dentistry-only,
  so a non-matching question returns a typed NO_RESULTS, not a fabrication); weak intents
  ("what is …") still require a dental term — general questions stay OUT_OF_DOMAIN (Phase 3
  contract preserved). A knowledge question is hybrid ONLY with an explicit patient
  reference (id/FDI/case/treatment/first-person/name hint) — a name merely extracted from
  the question text is a lookup hint, not a scope.
- **Planning**: knowledge-only (no patient), hybrid (context + knowledge), or appended to
  ACTION/MULTI_STEP plans. The tool input is `{question, domain?, maxResults: 5}` — the
  domain hint is attached only when taxonomy detection is unambiguous (≥2 hits).
- **Tool contract** (Phase 3 registry): `retrieve_dental_knowledge` — READ, bounded (8 s,
  0 retries, idempotent), roles = all staff + PATIENT, server-resolved scope: `hospitalId`
  from the session, `useCase` from the role (PATIENT → educational, else clinical). Unknown
  parameters rejected; the agent cannot mutate source/ranking/tier/citations/dates/checksum/
  tenant through parameters.
- **Answer policy (§28)**: LLM synthesis only; deterministic fallback when the model is
  unavailable (still answers from the recorded evidence, labeled `KNOWN_FROM_SOURCE`).
- **Clinical format (§29)** — used when knowledge was retrieved:
  `Recorded Facts` (hybrid only, from Phase 2 context, fenced) / `Relevant Dental Evidence`
  (server-built, `[c#]` headers with tier/date/flags) / `Clinical Interpretation`
  (LLM, citation-constrained) / `Uncertainty – Missing Information` (conflicts, unknown
  dates, stale sources) / `Sources` (full provenance). Simple non-knowledge questions keep
  the Phase 3 format — the format is not forced on them.
- **Tracing (§35)**: `trace.knowledge` = {queryId, ok, failureCode, candidateCount,
  selectedCount, sourceCount, retrievalMs, citationCount} — counts only; no chunk text,
  no CoT, no PHI (bench + test asserted).

## 12. Admin API (spec §30) — minimal, no CMS

`app/api/ai/knowledge/route.ts` (ADMIN/SUPER_ADMIN only, session-resolved tenant):
- `GET` — published sources + document versions for the tenant (observability, no raw content).
- `POST` — deterministic ingestion: `{source, content, replaceVersion?}`. Server-side
  validation (enums, taxonomy domain, language, size); TENANT scope pinned to the session
  tenant; typed `IngestionReport` returned (rejections are observable 200s with codes —
  nothing is silently swallowed); every attempt audit-logged (no content in the audit row).

All API messages are i18n-resolvable (the repo-wide i18n sweep passes; no new interpolated
templates — the pinned count is unchanged).

## 13. Performance (spec §34) — bench (`scripts/bench-knowledge-phase4.ts`, in-memory harness)

| measurement | result |
|---|---|
| ingest guideline (2 sections) | 0.10 ms (PUBLISHED, 1 chunk) |
| ingest version replacement | 0.13 ms (supersedes exactly 1 document) |
| agent no-RAG (context only) | 1.03 ms, 1 tool |
| agent RAG (knowledge only) | 1.16 ms, 1 tool |
| agent hybrid (context + knowledge) | 1.71 ms, 2 tools (no double retrieval) |
| index build 9 / 31 / 101 chunks | 0.49 / 1.29 / 5.02 ms (~linear) |
| query latency 9 / 31 / 101 chunks | 0.63 / 1.47 / 4.58 ms |
| bounded store loads (3× corpus) | exactly 3 per query — no N+1 |
| embedding work (provider path) | chunks+1 per query — no per-candidate re-embed |
| determinism (LEXICAL + HYBRID) | identical results + scores across runs |
| evidence budget | ≤10 results, ≤12,000 chars, ≤2 chunks/source |

No unnecessary retrieval: ordinary questions never touch the knowledge store
(`trace.knowledge` stays null; tested). No duplicate index/embedding work (bench-asserted).

## 14. Security matrix (spec §33) — `tests/unit/knowledge-security.test.ts` (13 tests)

- **Tenant isolation**: tenant B's private source is never visible to tenant A (queries +
  index visibility); global sources carry no tenant rows.
- **Patient separation**: ingestion rejects patient data (detector + stored-corpus sweep).
- **Prompt injection**: injection text in a T4 blog is retrieved as inert DATA (content
  present, no action/approval surface in the package); the agent answers grounded and never
  enumerates patients; the pipeline is never invoked.
- **Citation injection**: fake in-body citations/URLs never appear in `citations[]`
  (citations come from stored metadata only; `citations.length === results.length`).
- **Tool/parameter injection**: tool-like questions are poor queries (corpus untouched);
  `domain: 'hosp-B' | 'TIER_1'` → UNSUPPORTED_DOMAIN; tenant cannot be requested in text;
  `maxResults` clamped ≤10.
- **Poisoning**: T4 blog always ranks below the T1 guideline (explicit `allowTier4` only).
- **Version attack**: a superseded version's claims are not retrievable (PUBLISHED v2 only).
- **Freshness/URL**: freshness enum honored; citation URLs ⊆ stored `reference` values.
- **RBAC**: knowledge admin API is ADMIN-only (403 for staff/doctor/receptionist; 401 anon).

Plus the adversarial review in §16.

## 15. Migration (spec §37) — additive only

`prisma/migrations/20260930000000_add_dental_knowledge_phase4/migration.sql`:
three new tables (`KnowledgeSource`, `KnowledgeDocument`, `KnowledgeChunk`), one new
inverse relation on `Hospital` (`knowledgeSources`, TENANT scope only), self-relation for
the version chain. No existing table/column/index altered. Indexed:
`[status, domain, authorityTier]`, `[hospitalId]`, unique `[sourceKey, version]`,
unique `[sourceId, version]`, unique `[contentHash]`. (Offline environment: migration SQL
hand-written and reviewed; `prisma generate` remains blocked sandbox-side as in Phase 3 —
the structural client + fakes cover all tests.)

## 16. Independent adversarial security review

Performed over the final code (after tests), findings and dispositions:
- **AD-1 (fixed)**: early knowledge integration let the injected store bypass into the
  loop's tool runtime only if the route passed it — verified `deps.knowledgeStore` is the
  single injection point and production routes never accept a client store. The loop's rt
  carries it; tools default to the Prisma store.
- **AD-2 (fixed)**: weak knowledge intent ("what is …") initially passed the dental domain
  gate, turning general questions into KNOWLEDGE tasks. Split into strong/weak intent
  lists; Phase 3 OUT_OF_DOMAIN contract re-verified (weather/poem still OUT_OF_DOMAIN).
- **AD-3 (fixed)**: name extraction ("criteria **for** periodontitis") set
  `patientInvolved=true` on pure knowledge questions → false hybrid. Knowledge questions
  now require an explicit patient reference to be hybrid.
- **AD-4 (fixed)**: `recordRejectedSource` in the memory store referenced the raw
  `idFactory` after the default-parameter refactor — replaced with the internal `makeId`.
- **AD-5 (accepted, documented)**: semantic-only recall is out of scope; lexical postings
  are the recall floor (documented limitation, §8 above).
- **AD-6 (accepted, documented)**: near-duplicate detection is Jaccard over token sets —
  a semantically identical rewrite with different wording is a new version, not a drop.
  Versioning (checksum + `replaceVersion`) is the intended path for updated content.
- Re-verified: citations can never be model-created; tenant scope is server-fixed; the
  knowledge layer has no write path (Phase 1 remains the only executor).

## 17. Tests, gates, decisions

| gate | result |
|---|---|
| full regression | **5456 passed / 0 failed / 12 skipped** (272 files) — baseline 5363 + 93 new |
| new Phase 4 tests | taxonomy 7 · chunking 9 · ingestion 13 · retrieval 29 · security 13 · agent-knowledge-integration 14 · knowledge-route 8 = **93** |
| Phase 3 agent suites | 109/109 (classifier, loop, planner, tools, route) — no regressions |
| tsc --noEmit | **503** (exact baseline; 0 new errors) |
| eslint | **0 errors** (tests eslint-ignored per repo convention) |
| bench | all checks passed, exit 0 |

Key decisions:
- New `KNOWLEDGE` task type (additive) rather than hijacking INFORMATIONAL — keeps the
  deterministic split honest and the RAG trigger explicit (§38: no auto-routing of
  existing question types through RAG).
- Per-query index build (no cache) — Phase 2's decision stands; build cost measured,
  sub-millisecond at clinic scale.
- No bundled embedding model — deterministic LEXICAL is the offline default; the provider
  abstraction is real (index + ranking + bench) and swappable in Phase 5 without contract
  changes (§41 future-compatible, §42 anti-overengineering).
- `jurisdiction` added to `KnowledgeCitation` (from stored metadata only) so the Sources
  section can display provenance without inference (§23/§24).
- Admin API rejections return the typed report (200 + `status: REJECTED`) — the admin
  workflow must see WHY; audit rows carry code + counts, never content.

## 18. What Phase 4 does NOT implement (explicit)

- No local embedding model or local LLM (Phase 5). No multimodal (Phase 6). No eval-suite
  expansion beyond the deterministic harness here (Phase 7). No engine completion (Phase 8).
- No long-term memory / cross-session recall (Phase 9). No voice (Phase 10). No robot
  integration (Phase 11).
- No LLM-provider replacement; LLM usage stays bounded to Phase 3's two jobs
  (classification fallback, synthesis) — knowledge synthesis reuses the synthesis slot.
- No semantic-only recall channel; no multi-hop retrieval; no re-ranking model.
- No CMS, no crawler, no bulk import UI, no scheduling/refresh of external sources.
- No new migrations beyond the three additive tables; no changes to Phase 1/2/3 contracts
  beyond the additive task type, tool, response fields (`evidence`, `grounding`) and
  trace field (`knowledge`).
- STOP — Phase 5+ is not started.

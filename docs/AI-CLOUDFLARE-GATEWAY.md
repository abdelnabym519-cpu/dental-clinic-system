# Cloudflare AI Gateway — canonical external LLM runtime

Every external LLM call in DenToRA resolves through **one module**:
`lib/ai/gateway.ts`. There is no second path and no direct provider call.

```
DenToRa feature (chat, insights, forecasts, agent, …)
  → lib/ai/gateway.ts             routing · fallback · timeout · observability
    → Cloudflare REST AI API      POST https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions
      ├─ Authorization: Bearer {CLOUDFLARE_API_TOKEN}   (Workers AI Read permission)
      ├─ cf-aig-gateway-id: {CLOUDFLARE_AI_GATEWAY_ID}  (gateway routing — required for @cf/ models)
      └→ configured model          @cf/zai-org/glm-4.7-flash, openai/…, anthropic/…, google/…
```

This is the officially documented AI Gateway REST contract: one
OpenAI-compatible endpoint serves Workers AI (`@cf/author/model`) AND
third-party (`author/model`) models with the Cloudflare token only — no
provider API keys. The gateway identifier travels in the
`cf-aig-gateway-id` request header, so caching, rate limiting, guardrails
and logging configured on that gateway apply to every request. (The older
host-routed `gateway.ai.cloudflare.com/v1/{account}/{gateway}/…` surface
rejects these requests with HTTP 400 and must not be used.)

Local dental engines (Orchestrator, Liodon, MeshSegNet MAN+MAX, Implant, Ortho)
do **not** traverse the gateway — vision/3D stay local by architecture
(`lib/ai-orchestrator.ts`, `lib/ai/engines/`). LLM = cloud; vision/3D = local.

## Configuration (server-only)

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id (pattern-validated before URL composition) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token — **secret**, server-only, never client-exposed |
| `CLOUDFLARE_AI_GATEWAY_ID` | Gateway id (pattern-validated) |
| `DEN_TORA_AI_TIMEOUT_MS` | Request timeout (default **120000**). Measured contract: the reasoning model generates at ≈19 tokens/s (external datapoint: 5.27s for a 100-token budget), and reasoning models routinely spend hundreds of tokens thinking before content — the previous 30s default aborted mid-generation. |
| `DEN_TORA_AI_MAX_TOKENS` | Completion token budget when the tier config carries none (default 4096). Reasoning models can exhaust a small budget before emitting content — the gateway then fails truthfully and names this knob. |
| `DEN_TORA_AI_MODEL` | Default-tier model override |
| `DEN_TORA_AI_FAST_MODEL` | Fast tier override (chat / command / fast) |
| `DEN_TORA_AI_REASONING_MODEL` | Safety-critical reasoning override (clinical) |
| `DEN_TORA_AI_FALLBACK_MODEL` | Explicit one-shot fallback used when the primary model fails |

Model ids are provider-prefixed exactly as the gateway routes them, e.g.
`google/gemini-2.5-pro`, `anthropic/claude-opus-4.5`. Changing models is a
configuration edit — never a code change. Tier defaults live in
`lib/ai/models.ts`; env overrides are applied at the single tier-resolution
point (`getModelByTier` / `getModelForSkill`), so no feature hard-codes a
provider choice.

Store provider API keys inside the gateway (AI Gateway → Providers) so the
application never handles them.

## Failure semantics (explicit, observable)

* Primary model → configured fallback model (once) → typed failure.
* Failures are `AIUnavailableError` with `code`
  (`AI_NOT_CONFIGURED` | `AI_TIMEOUT` | `AI_PROVIDER_ERROR`) and a
  `correlationId`. Messages are Arabic-safe and never carry provider error
  bodies, tokens, or environment variable names.
* An unconfigured or unreachable gateway is a **truthful failure**: routes
  answer 503 with Arabic guidance (e.g. no-show risk) or degrade to their
  deterministic local path (e.g. NL query presets). The system never
  disguises an absent LLM as AI success, and never silently switches
  providers or crosses local↔cloud.
* `finish_reason` is captured and logged. A reasoning-only response, a
  budget-exhausted response (`finish_reason: "length"` with no content),
  or an empty response each map to a distinct truthful typed failure
  (`AI_PROVIDER_ERROR`) — and still trigger the configured fallback once.
* Streaming keeps the exact SSE shape the product already uses:
  `data: {"text":"…"}` events terminated by `data: {"done":true}`.
* Reasoning models (e.g. `@cf/zai-org/glm-4.7-flash`) may return a separate
  `reasoning_content` channel. The gateway normalizes it as `reasoning`, but a
  reasoning-only response is a truthful typed `AI_PROVIDER_ERROR` — never a
  fabricated report. A configured fallback model is attempted first.
* Smart Reports UI guidance names the real requirement (AI Gateway config,
  `DEN_TORA_AI_MODEL`, restart); deterministic preset reports never touch the
  LLM and keep working without it.

## Observability

Each request logs a structured `[ai-gateway]` line: correlation id, model,
latency, token usage, outcome (`attempt|success|fallback|failure`).
Logs never contain keys, authorization headers, prompts, or patient data.

## Failure taxonomy (typed, observable)

Every AI route maps gateway failures through the ONE canonical check
(`isAIUnavailableError`) to a truthful **503** carrying the Arabic-safe
message + `code` + `correlationId` — never a raw 500, never a leaked
environment/provider string. Deterministic (non-LLM) fallbacks keep working
independently and are labeled as such.

| Class | Gateway `code` | Typical cause | Route behavior |
|---|---|---|---|
| `AI_NOT_CONFIGURED` | configuration missing/invalid | env not set, malformed model | 503 + Arabic guidance |
| `AI_TIMEOUT` | abort after `DEN_TORA_AI_TIMEOUT_MS` | slow reasoning generation | 503 (Arabic) |
| `AI_PROVIDER_ERROR` | non-OK status, network, empty/reasoning-only content | provider rejection, egress, budget exhaustion | 503 (Arabic; CF `cfErrorCode`/`cfErrorMessage` in server log) |

Client error text NEVER carries tokens, provider bodies, or env names.

## E2E LLM harness

`node scripts/llm-e2e.mjs` — deterministic gateway-contract + failure-taxonomy
probes (no network required). `node scripts/llm-e2e.mjs --live` — real
Cloudflare inference through the canonical gateway from an environment with
`CLOUDFLARE_*` credentials (prints latency, model, content length; never
secrets). `--base-url http://localhost:3000` additionally proves the running
app's auth boundary. Taxonomy: `SUCCESS | CONFIGURATION | AUTHENTICATION |
ROUTING | PROVIDER_REJECTION | TIMEOUT | NETWORK | INVALID_RESPONSE |
EMPTY_RESPONSE | APPLICATION_ERROR`. Only `--live` probes can report SUCCESS
(real inference); deterministic probes verify the contract.

## Runtime status (admin diagnostic)

`GET /api/ai/runtime-status` — ADMIN-only, 60s cached, configuration-only
(no expensive LLM probe, no secrets in the payload):

| State | Meaning |
|---|---|
| `UNAVAILABLE` | No gateway configuration present |
| `MISCONFIGURED` | Configured, but identifiers fail the safe-ID pattern |
| `CONFIGURED` | Configured and identifier-valid (not proof of reachability) |
| `AVAILABLE` | Only a real minimal request may confirm this — never fabricated |
| `DEGRADED` | Reserved for partial degradation reporting |

## Security

* Credentials are server-only; nothing Cloudflare-related is exposed through
  `NEXT_PUBLIC_*`.
* The gateway URL is composed exclusively from pattern-validated IDs
  (`[A-Za-z0-9_-]{1,64}`) — no user input ever reaches URL composition.
* Every request carries an `AbortController` timeout; responses with
  provider error bodies are never surfaced raw.

## Migration guarantees (enforced by `tests/ai/cloudflare-migration.test.ts`)

The architectural audit harness reads the shipped source and proves: every
LLM call site imports the gateway (≥15 sites), the retired provider client is
deleted (not shimmed), zero provider-brand residue in shipped code, server-only
credentials, the documented Cloudflare REST endpoint + gateway header,
SSRF-safe URL composition, configuration-driven tiers, honest runtime-status,
truthful no-show 503, and local engines untouched.

Token permission note: the API token needs **Account → Workers AI → Read**.
A token carrying only AI Gateway permissions is rejected (401, error 10000)
on the `/ai/*` endpoints.

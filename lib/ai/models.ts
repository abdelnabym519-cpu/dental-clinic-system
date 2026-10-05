/**
 * AI model configuration — tiered, configuration-driven routing through the
 * Cloudflare AI Gateway (see lib/ai/gateway.ts for the transport).
 * Maps task types to the optimal model + parameters.
 *
 * Cost tiers (approximate per 1M tokens):
 *   Flash-Lite (gemini-2.5-flash-lite) — $0.10 input / $0.40 output  (cheapest)
 *   Pro        (gemini-2.5-pro)        — $1.25 input / $10   output
 *   Opus       (claude-opus-4.5)       — $15   input / $75   output  (most capable)
 *
 * Strategy: use Flash for structured-output tasks (intent detection, JSON
 * generation, simple chat) and only escalate to Pro/Opus for tasks that
 * require deep reasoning, clinical accuracy, or long-form analysis.
 */

export interface ModelConfig {
  model: string
  maxTokens: number
  temperature: number
}

export const AI_MODELS: Record<string, ModelConfig> = {
  // ── Lightweight / Flash tier ───────────────────────────────────────────
  /** Intent detection, command parsing — structured JSON output */
  fast: { model: 'google/gemini-2.5-flash-lite', maxTokens: 2048, temperature: 0.1 },
  /** Simple chat: greetings, FAQs, basic lookups, confirmations */
  chat: { model: 'google/gemini-2.5-flash-lite', maxTokens: 4096, temperature: 0.7 },

  // ── Standard / Pro tier ────────────────────────────────────────────────
  /** General-purpose: complex reasoning, multi-step conversations */
  default: { model: 'google/gemini-2.5-pro', maxTokens: 4096, temperature: 0.7 },
  /** Long-form reports and analytics */
  reports: { model: 'google/gemini-2.5-pro', maxTokens: 8192, temperature: 0.3 },
  /** Natural language → Prisma query translation */
  query: { model: 'google/gemini-2.5-pro', maxTokens: 4096, temperature: 0.1 },
  /** Appointment scheduling with conflict resolution */
  scheduling: { model: 'google/gemini-2.5-pro', maxTokens: 2048, temperature: 0.3 },
  /** Financial calculations, VAT, billing */
  billing: { model: 'google/gemini-2.5-pro', maxTokens: 4096, temperature: 0.1 },
  /** Analytics, forecasting, segmentation */
  insights: { model: 'google/gemini-2.5-pro', maxTokens: 4096, temperature: 0.3 },

  // ── Premium / Opus tier ────────────────────────────────────────────────
  /** Safety-critical: treatment planning, contraindication checks, consent */
  clinical: { model: 'anthropic/claude-opus-4.5', maxTokens: 8192, temperature: 0.2 },

  // ── Legacy alias (kept for backward compat) ────────────────────────────
  command: { model: 'google/gemini-2.5-flash-lite', maxTokens: 2048, temperature: 0.1 },
}

/** Skill name → model tier */
/**
 * Skill → model tier mapping.
 *
 * Cost-optimization strategy (Feb 2026):
 *   - Flash Lite (chat)  → simple conversational skills that collect/relay info
 *   - Pro (default/billing/insights/scheduling/reports) → analysis & reasoning
 *   - Opus (clinical)    → safety-critical tasks (treatment, consent)
 *
 * Only escalate when the skill genuinely needs deeper reasoning.
 */
export const SKILL_MODEL_MAP: Record<string, string> = {
  // ── Flash Lite tier — conversational / relay skills ──────────────────
  'patient-intake': 'chat', // collects info, no analysis
  'lab-coordinator': 'chat', // routes orders, no reasoning
  'whatsapp-receptionist': 'chat', // FAQ + appointment relay
  'smart-scheduler': 'chat', // slot lookup, simple conflict check

  // ── Pro tier — requires analysis / reasoning ─────────────────────────
  'billing-agent': 'billing', // VAT calc, multi-step invoicing
  'inventory-manager': 'insights', // demand prediction, anomaly detection
  'clinic-analyst': 'reports', // trend analysis, executive summaries
  'no-show-predictor': 'insights', // pattern analysis, risk scoring
  'inventory-forecaster': 'insights', // 30/60/90-day demand forecast
  'cashflow-forecaster': 'billing', // cash flow projection
  'patient-segmentation': 'insights', // RFM analysis, churn prediction
  'claim-analyzer': 'billing', // denial analysis, appeal drafting
  'dynamic-pricing': 'billing', // demand/utilization analysis

  // ── Opus tier — safety-critical ──────────────────────────────────────
  'treatment-advisor': 'clinical', // contraindication checks
  'consent-generator': 'clinical', // legal/clinical document generation
}

export function getModelForSkill(skillName: string): ModelConfig {
  return applyModelOverride(AI_MODELS[SKILL_MODEL_MAP[skillName]] || AI_MODELS.default, SKILL_MODEL_MAP[skillName] || 'default')
}

export function getModelByTier(tier: string): ModelConfig {
  return applyModelOverride(AI_MODELS[tier] || AI_MODELS.default, tier)
}

/**
 * Cloudflare migration — configuration-driven model routing. An env override
 * for a tier wins over the built-in default, so the default LLM can change
 * without touching feature code. Tiers map to env vars as:
 *   default/reports/query/scheduling/billing/insights → DEN_TORA_AI_MODEL
 *   fast/chat/command                                 → DEN_TORA_AI_FAST_MODEL
 *   clinical (safety-critical reasoning)              → DEN_TORA_AI_REASONING_MODEL
 * The FALLBACK model lives in DEN_TORA_AI_FALLBACK_MODEL and is applied by
 * lib/ai/gateway.ts (explicit, observable fallback — not silently per tier).
 */
const TIER_ENV: Record<string, string> = {
  default: 'DEN_TORA_AI_MODEL',
  reports: 'DEN_TORA_AI_MODEL',
  query: 'DEN_TORA_AI_MODEL',
  scheduling: 'DEN_TORA_AI_MODEL',
  billing: 'DEN_TORA_AI_MODEL',
  insights: 'DEN_TORA_AI_MODEL',
  fast: 'DEN_TORA_AI_FAST_MODEL',
  chat: 'DEN_TORA_AI_FAST_MODEL',
  command: 'DEN_TORA_AI_FAST_MODEL',
  clinical: 'DEN_TORA_AI_REASONING_MODEL',
}

function applyModelOverride(config: ModelConfig, tier: string): ModelConfig {
  const envName = TIER_ENV[tier]
  const override = envName ? process.env[envName] : undefined
  return override ? { ...config, model: override } : config
}

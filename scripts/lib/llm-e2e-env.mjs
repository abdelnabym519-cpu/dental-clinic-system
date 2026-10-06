/**
 * Live-configuration resolution for the LLM E2E harness.
 *
 * Pure and side-effect-free so it is directly unit-testable. Precedence
 * mirrors Next.js conventions: the REAL shell environment wins, the
 * repository `.env.local` fills gaps (a plain `node scripts/...` process
 * does not load `.env.local` — only `next dev/start` does). Values are
 * trimmed; empty/whitespace counts as absent (never a placeholder credential).
 * Nothing here ever returns or logs secret VALUES — consumers receive the
 * resolved map for process.env injection and a secret-free summary string.
 */

export const AI_ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_AI_GATEWAY_ID',
  'DEN_TORA_AI_MODEL',
  'DEN_TORA_AI_FAST_MODEL',
  'DEN_TORA_AI_REASONING_MODEL',
  'DEN_TORA_AI_FALLBACK_MODEL',
  'DEN_TORA_AI_TIMEOUT_MS',
]

function cleanValue(v) {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s.length > 0 ? s : undefined
}

/**
 * Minimal .env parser (Next.js-style subset): KEY=VALUE lines, optional
 * single/double quotes, `#` comments and blank lines ignored, no expansion.
 */
export function parseEnvFile(source) {
  const out = {}
  for (const rawLine of String(source).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    const cleaned = cleanValue(value)
    if (cleaned !== undefined) out[key] = cleaned
  }
  return out
}

/**
 * Resolve the live-probe configuration. `env` is the shell environment at
 * process start; `envLocal` is the parsed `.env.local` (may be undefined).
 * The gateway identifier follows the documented Cloudflare contract
 * (cf-aig-gateway-id: default) when neither source provides it.
 */
export function resolveLiveEnv({ env = {}, envLocal } = {}) {
  const pick = (key) => cleanValue(env[key]) ?? cleanValue(envLocal?.[key])
  const accountId = pick('CLOUDFLARE_ACCOUNT_ID')
  const token = pick('CLOUDFLARE_API_TOKEN')
  const gatewayId = pick('CLOUDFLARE_AI_GATEWAY_ID') || 'default'
  const creds = Boolean(accountId && token)
  const resolved = {}
  if (creds) {
    resolved.CLOUDFLARE_ACCOUNT_ID = accountId
    resolved.CLOUDFLARE_API_TOKEN = token
    resolved.CLOUDFLARE_AI_GATEWAY_ID = gatewayId
    const model = pick('DEN_TORA_AI_MODEL')
    if (model) resolved.DEN_TORA_AI_MODEL = model
    const timeoutMs = pick('DEN_TORA_AI_TIMEOUT_MS')
    if (timeoutMs) resolved.DEN_TORA_AI_TIMEOUT_MS = timeoutMs
  }
  // Leak-proof by construction: resolved values are captured in this
  // closure and can only be injected into a target (process.env) via
  // apply() — they are never part of the returned object, so no caller
  // can accidentally stringify/log them.
  const secretMap = resolved
  return {
    creds,
    apply(target) {
      for (const [key, value] of Object.entries(secretMap)) target[key] = value
    },
    detail: creds
      ? `credentials resolved; gateway="${gatewayId}"`
      : 'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set in the shell or .env.local',
  }
}

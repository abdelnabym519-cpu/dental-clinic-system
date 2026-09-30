/**
 * Phase 11 — CORS policy helper (§27/§53).
 *
 * The legacy next.config CORS block answered `Access-Control-Allow-Origin: *`
 * TOGETHER WITH `Access-Control-Allow-Credentials: true` on every /api route.
 * Browsers refuse that combination for credentialed requests, so it worked by
 * accident, but it is a misconfiguration. This helper makes the policy
 * explicit and env-driven:
 *
 *  - CORS_ALLOWED_ORIGINS set  → strict allowlist (reflect only matched
 *    origins, always Vary: Origin);
 *  - CORS_ALLOWED_ORIGINS unset → legacy behavior preserved (documented
 *    exception; mobile-app access), but credentials are NOT advertised for
 *    wildcard origins (browsers reject it anyway; now we don't even claim it).
 */

export type CorsDecision = {
  /** Empty string = no origin allowed (deny). */
  'Access-Control-Allow-Origin'?: string
  'Access-Control-Allow-Methods': string
  'Access-Control-Allow-Headers': string
  'Access-Control-Allow-Credentials'?: string
  Vary?: string
}

function parseAllowlist(env: Record<string, string | undefined>): string[] {
  return (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export function corsHeadersFor(origin: string | null, env: Record<string, string | undefined> = process.env): CorsDecision {
  const base: CorsDecision = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, X-CSRF-Token',
  }
  const allowlist = parseAllowlist(env)
  if (allowlist.length > 0) {
    const match = origin && allowlist.includes(origin.replace(/\/$/, '')) ? origin.replace(/\/$/, '') : null
    return {
      ...base,
      'Access-Control-Allow-Origin': match ?? '',
      ...(match ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
      Vary: 'Origin',
    }
  }
  // Legacy mode: wildcard without credentials (safe and compatible).
  return { ...base, 'Access-Control-Allow-Origin': '*' }
}

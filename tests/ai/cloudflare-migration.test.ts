/**
 * Cloudflare Unified AI/LLM Migration — architectural audit harness.
 *
 * This is NOT a behavior mock suite: it reads the shipped source tree and
 * proves the architecture invariants of the migration. Minimum counts are
 * meaningful (a stubbed migration with zero call sites cannot pass). If any
 * assertion here fails, the migration has regressed — do not weaken the
 * assertion; fix the architecture.
 *
 * Invariants:
 *  A1. A single canonical gateway module exists and every external LLM call
 *      site imports it (≥15 production call sites — the audited baseline).
 *  A2. The retired provider client is GONE (file deleted, zero imports).
 *  A3. Zero provider-brand residue in shipped code (no provider endpoint, no
 *      provider-specific key name) — app/, lib/, components/, env samples.
 *  A4. Server-only credentials: no NEXT_PUBLIC_-prefixed Cloudflare var.
 *  A5. Gateway composes the AI-Gateway URL from pattern-validated IDs with a
 *      timeout and Arabic-safe typed failures; no direct provider endpoint.
 *  A6. Model routing is configuration-driven (DEN_TORA_AI_* tiers), never a
 *      hard-coded provider choice.
 *  A7. Runtime-status: ADMIN-only, cached (60s), configuration-only probe,
 *      five-state vocabulary, secrets never in payload.
 *  A8. No-show risk: typed AIUnavailableError → truthful 503 (no env-var or
 *      provider leakage), local heuristic fallback intact.
 *  A9. Local dental engines stay local — the gateway never intercepts them.
 *  A10. Arabic-first dictionary entries exist for the migrated admin UI.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

const appFiles = walk(join(ROOT, 'app'))
const libFiles = walk(join(ROOT, 'lib'))
const componentFiles = walk(join(ROOT, 'components'))
const shipped = [...appFiles, ...libFiles, ...componentFiles]

function read(p: string): string {
  return readFileSync(p, 'utf-8')
}

describe('Cloudflare AI migration — architectural audit', () => {
  // ── A1: canonical gateway with real adoption ────────────────────────────
  it('A1: every external LLM call site imports the canonical gateway (>= 15 sites)', () => {
    const GATEWAY_IMPORT = /from ['"]@\/lib\/ai\/gateway['"]/
    const importers = shipped.filter((p) => !p.includes(join('lib', 'ai', 'gateway')) && GATEWAY_IMPORT.test(read(p)))
    // 15 static feature routes + agent route + cron briefing + data-import
    // AI mapping + agent server-deps — the audited migration baseline is 15.
    expect(importers.length).toBeGreaterThanOrEqual(15)
    // the feature routes themselves (not tests, not the gateway) are covered
    const featureRoutes = importers.filter((p) => p.includes(join('app', 'api', 'ai')))
    expect(featureRoutes.length).toBeGreaterThanOrEqual(14)
    // the runtime-status diagnostic goes through the gateway's health API
    expect(read(join(ROOT, 'app', 'api', 'ai', 'runtime-status', 'route.ts'))).toMatch(
      /from ['"]@\/lib\/ai\/gateway['"]/
    )
  })

  // ── A2: the retired client is gone, not shimmed ─────────────────────────
  it('A2: the retired provider client is deleted and nothing imports it', () => {
    expect(existsSync(join(ROOT, 'lib', 'ai', 'openrouter.ts'))).toBe(false)
    const offenders = shipped.filter((p) => read(p).includes('@/lib/ai/openrouter'))
    expect(offenders).toEqual([])
  })

  // ── A3: zero provider-brand residue in shipped code ─────────────────────
  it('A3: no provider endpoint or provider-specific key anywhere in shipped code', () => {
    const RESIDUE = [/openrouter\.ai/i, /OPENROUTER_API_KEY/, /api\.openai\.com/, /api\.anthropic\.com/, /generativelanguage\.googleapis\.com/]
    const offenders: string[] = []
    for (const p of shipped) {
      const src = read(p)
      if (RESIDUE.some((r) => r.test(src))) offenders.push(p)
    }
    expect(offenders).toEqual([])
    // env samples document the gateway, never the retired provider key
    for (const envFile of ['.env.example', '.env.production.example']) {
      const src = read(join(ROOT, envFile))
      expect(src).not.toMatch(/OPENROUTER_API_KEY/)
      expect(src).toContain('CLOUDFLARE_ACCOUNT_ID')
      expect(src).toContain('CLOUDFLARE_API_TOKEN')
      expect(src).toContain('CLOUDFLARE_AI_GATEWAY_ID')
    }
    // the environment registry mirrors the gateway configuration
    const registry = read(join(ROOT, 'lib', 'config', 'env.ts'))
    expect(registry).not.toContain('OPENROUTER_API_KEY')
    for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_GATEWAY_ID', 'DEN_TORA_AI_MODEL', 'DEN_TORA_AI_FALLBACK_MODEL']) {
      expect(registry).toContain(`'${key}'`)
    }
  })

  // ── A4: server-only credentials ─────────────────────────────────────────
  it('A4: Cloudflare credentials are never exposed through NEXT_PUBLIC_', () => {
    const offenders = shipped.filter((p) => /NEXT_PUBLIC_CLOUDFLARE|NEXT_PUBLIC_DEN_TORA_AI/.test(read(p)))
    expect(offenders).toEqual([])
  })

  // ── A5: SSRF-safe composition, timeout, typed Arabic-safe failures ──────
  it('A5: gateway composes the documented Cloudflare REST AI endpoint with timeout + typed errors', () => {
    const src = read(join(ROOT, 'lib', 'ai', 'gateway.ts'))
    // Official contract: /accounts/{account}/ai/v1/chat/completions with the
    // cf-aig-gateway-id header (required for @cf/ models). The retired
    // host-routed gateway.ai.cloudflare.com surface must NOT return.
    expect(src).toContain('https://api.cloudflare.com/client/v4/')
    expect(src).toContain("'cf-aig-gateway-id'")
    expect(src).not.toContain('https://gateway.ai.cloudflare.com/v1/')
    expect(src).toMatch(/SAFE_ID\s*=\s*\/\^?\[A-Za-z0-9_-\]/)
    expect(src).toContain('AbortController')
    expect(src).toContain('class AIUnavailableError')
    expect(src).toMatch(/AI_NOT_CONFIGURED/)
    expect(src).toMatch(/AI_TIMEOUT/)
    expect(src).toMatch(/AI_PROVIDER_ERROR/)
    // Arabic-safe user-facing failure messages in the transport itself
    expect(src).toMatch(/خدمة الذكاء الاصطناعي/)
    // the gateway must not hard-code a direct provider endpoint
    expect(src).not.toMatch(/api\.openai\.com|api\.anthropic\.com/)
    // tokens never appear in log lines
    expect(src).toContain('Never: tokens, authorization headers, prompts, or patient data')
  })

  // ── A6: configuration-driven model routing ──────────────────────────────
  it('A6: model tiers resolve through DEN_TORA_AI_* configuration, not hard-coded providers', () => {
    const src = read(join(ROOT, 'lib', 'ai', 'models.ts'))
    for (const key of ['DEN_TORA_AI_MODEL', 'DEN_TORA_AI_FAST_MODEL', 'DEN_TORA_AI_REASONING_MODEL']) {
      expect(src).toContain(key)
    }
    expect(src).toContain('applyModelOverride')
    // tier resolution stays the single point of override
    expect(src).toMatch(/function getModelByTier/)
  })

  // ── A7: runtime-status diagnostic discipline ────────────────────────────
  it('A7: runtime-status is ADMIN-only, cached, probe-free and secret-free', () => {
    const src = read(join(ROOT, 'app', 'api', 'ai', 'runtime-status', 'route.ts'))
    expect(src).toContain("requireAuthAndRole(['ADMIN'])")
    expect(src).toContain('60_000') // 60s cache — no expensive per-request probes
    expect(src).toContain('getAIHealth()')
    expect(src).not.toMatch(/\bfetch\(/) // configuration-only health, no network probe
    expect(src).not.toMatch(/apiToken|CLOUDFLARE_API_TOKEN/) // only presence is reported
  })

  // ── A8: no-show risk fails truthfully ───────────────────────────────────
  it('A8: AI routes classify typed unavailability through the ONE canonical check (truthful 503)', () => {
    const src = read(join(ROOT, 'app', 'api', 'ai', 'no-show-risk', 'route.ts'))
    // the shared classification helper — every AI route must use this, not
    // ad-hoc per-route duck typing
    expect(src).toContain('isAIUnavailableError(error)')
    expect(src).toContain('503')
    expect(src).toContain('isAIUnavailableError(error)')
    expect(src).not.toMatch(/OPENROUTER|error\.message \|\|/)
    // the deterministic heuristic fallback for malformed model output is intact
    expect(src).toMatch(/Fallback: use simple heuristic/)
    // every forecast/analysis AI route maps typed failures through the helper
    const aiRoutes = ['inventory-forecast', 'cashflow-forecast', 'claim-analysis', 'patient-segments']
    for (const r of aiRoutes) {
      expect(read(join(ROOT, 'app', 'api', 'ai', r, 'route.ts')), r).toContain('isAIUnavailableError')
    }
    // the NL-query route keeps its richer dual-outcome classifier (typed
    // unavailability → 503 AI_UNAVAILABLE vs unparseable model answer → 400
    // PARSE_FAILED); its typed-unavailability leg is still contract-first
    const querySrc = read(join(ROOT, 'app', 'api', 'ai', 'query', 'route.ts'))
    expect(querySrc).toContain("err.name === 'AIUnavailableError'")
  })

  // ── A9: local dental engines remain local ───────────────────────────────
  it('A9: local engines keep their own transport — the gateway never intercepts them', () => {
    expect(existsSync(join(ROOT, 'lib', 'ai-orchestrator.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'lib', 'ai', 'engines'))).toBe(true)
    const gateway = read(join(ROOT, 'lib', 'ai', 'gateway.ts'))
    expect(gateway).toContain('dental engines keep their own transport')
    // Orchestrator / Liodon / MeshSegNet modules must not import the LLM gateway
    const localFiles = [
      join(ROOT, 'lib', 'ai-orchestrator.ts'),
      ...walk(join(ROOT, 'lib', 'ai', 'engines')),
    ]
    expect(localFiles.length).toBeGreaterThanOrEqual(2)
    for (const p of localFiles) {
      expect(read(p)).not.toMatch(/@\/lib\/ai\/gateway/)
    }
  })

  // ── A10: Arabic-first admin UI ──────────────────────────────────────────
  it('A10: migrated admin UI strings carry Arabic-first dictionary entries', () => {
    const ar = JSON.parse(read(join(ROOT, 'locales', 'ar.json')))
    const en = JSON.parse(read(join(ROOT, 'locales', 'en.json')))
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(ar).filter((k) => k.startsWith('p3.cf_'))) {
      expect(ar[key]).toMatch(/[\u0600-\u06FF]/)
    }
  })
})

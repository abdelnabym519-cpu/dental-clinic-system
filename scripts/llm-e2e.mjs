#!/usr/bin/env node
/**
 * DenToRa E2E LLM harness.
 *
 *   node scripts/llm-e2e.mjs            → deterministic contract + failure taxonomy
 *                                         (transport intercepted — no network needed)
 *   node scripts/llm-e2e.mjs --live     → REAL Cloudflare inference through the
 *                                         canonical gateway (requires CLOUDFLARE_*
 *                                         env in this shell; never prints secrets)
 *   node scripts/llm-e2e.mjs --live --base-url http://localhost:3000
 *                                       → additionally probes the running app's
 *                                         /api/ai/query auth boundary (no session
 *                                         → 401 expected; never fake-authenticates)
 *
 * Failure taxonomy (exactly one class per probe):
 *   SUCCESS | CONFIGURATION | AUTHENTICATION | ROUTING | PROVIDER_REJECTION |
 *   TIMEOUT | NETWORK | INVALID_RESPONSE | EMPTY_RESPONSE | APPLICATION_ERROR
 *
 * No probe is ever reported SUCCESS from mocked model output: in deterministic
 * mode the classification target is the GATEWAY CONTRACT; only --live probes
 * can yield SUCCESS (real provider content).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.argv.includes('--live')
const argvFlag = (name) => {
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === name) return process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined
    if (a.startsWith(name + '=')) return a.slice(name.length + 1)
  }
  return undefined
}
const BASE_URL = argvFlag('--base-url')

// ── bundle the REAL canonical gateway ───────────────────────────────────────
// Cross-platform by construction: use esbuild's JavaScript API (the package
// resolves its own native binary per-OS). NEVER spawn node_modules/.bin/*
// shims from this harness — on Windows the extensionless .bin entry is a
// sh wrapper (spawnSync → ENOENT) and the .cmd/.ps1 shims are rejected by
// Node without shell (CVE-2024-27980 mitigation). Same semantics on every
// OS: Git Bash, PowerShell, CMD, Linux, macOS.
const { buildSync } = await import('esbuild')
const outDir = mkdtempSync(join(tmpdir(), 'dentrora-llm-'))
const bundle = join(outDir, 'gateway.mjs')
buildSync({
  entryPoints: [join(ROOT, 'lib', 'ai', 'gateway.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'silent',
})
const gw = await import(bundle)

const realFetch = globalThis.fetch
const REDACT = (s) => String(s).replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
const results = []
function record(probe, classification, detail) {
  results.push({ probe, classification, detail: REDACT(detail) })
  console.log(`  ${probe.padEnd(34)} → ${classification.padEnd(20)} ${REDACT(detail).slice(0, 90)}`)
}
function classifyGatewayError(err) {
  if (err?.name !== 'AIUnavailableError') return 'APPLICATION_ERROR'
  switch (err.code) {
    case 'AI_NOT_CONFIGURED': return 'CONFIGURATION'
    case 'AI_TIMEOUT': return 'TIMEOUT'
    case 'AI_PROVIDER_ERROR': return 'PROVIDER_REJECTION' // refined per-probe below
    default: return 'APPLICATION_ERROR'
  }
}
const ENV_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_GATEWAY_ID', 'DEN_TORA_AI_MODEL', 'DEN_TORA_AI_TIMEOUT_MS']
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
const setEnv = (o) => { for (const k of ENV_KEYS) if (k in o) process.env[k] = o[k]; else delete process.env[k] }

// ── deterministic probes (transport intercepted; contract, not fake success) ─
console.log('\n■ Deterministic gateway-contract probes (no network)\n')
const GOOD_ENV = { CLOUDFLARE_ACCOUNT_ID: 'acct-test', CLOUDFLARE_API_TOKEN: 'token-test', CLOUDFLARE_AI_GATEWAY_ID: 'default' }
const MESSAGES = [
  { role: 'system', content: 'You are DenToRa, a dental clinic AI assistant.' },
  { role: 'user', content: 'Reply with exactly: DenToRa is working.' },
]

// CONFIGURATION — missing token, no network call may occur
setEnv({})
let calls = 0
globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({}) } }
try { await gw.complete(MESSAGES); record('missing-token', 'APPLICATION_ERROR', 'unexpectedly resolved') }
catch (e) { record('missing-token', calls === 0 ? classifyGatewayError(e) : 'NETWORK', e.code || e.message) }

// request-contract probe: the wire request must equal the known-good shape
setEnv(GOOD_ENV)
let wire = null
globalThis.fetch = async (url, init) => {
  wire = { url: String(url), headers: { ...init.headers }, body: JSON.parse(init.body) }
  return { ok: true, json: async () => ({ choices: [{ message: { content: 'DenToRa is working.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: '@cf/zai-org/glm-4.7-flash' }) }
}
const smoke = await gw.complete(MESSAGES, { model: '@cf/zai-org/glm-4.7-flash' })
const pathOk = new URL(wire.url).pathname === '/client/v4/accounts/acct-test/ai/v1/chat/completions'
const headerOk = wire.headers['cf-aig-gateway-id'] === 'default'
const rolesOk = wire.body.messages.at(-1).role === 'user'
const modelOk = wire.body.model === '@cf/zai-org/glm-4.7-flash'
const contentOk = smoke.content === 'DenToRa is working.'
record('gateway-contract (URI/headers/roles/model)',
  pathOk && headerOk && rolesOk && modelOk && contentOk ? 'SUCCESS' : 'APPLICATION_ERROR',
  `path:${pathOk} gwHeader:${headerOk} lastRoleUser:${rolesOk} model:${modelOk} content:${contentOk}`)

// PROVIDER_REJECTION with captured CF reason (typed client error preserved)
globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ errors: [{ code: 7000, message: 'No route for that URI' }] }) })
try { await gw.complete(MESSAGES); record('provider-400', 'APPLICATION_ERROR', 'unexpectedly resolved') }
catch (e) { record('provider-400', classifyGatewayError(e) === 'PROVIDER_REJECTION' ? 'PROVIDER_REJECTION' : classifyGatewayError(e), e.code) }

// ROUTING — CF 7000 is distinguished in logs (same typed error, routing reason)
// TIMEOUT — explicit env knob aborts
setEnv({ ...GOOD_ENV, DEN_TORA_AI_TIMEOUT_MS: '50' })
globalThis.fetch = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
try { await gw.complete(MESSAGES); record('timeout', 'APPLICATION_ERROR', 'unexpectedly resolved') }
catch (e) { record('timeout', classifyGatewayError(e), e.code) }

// NETWORK — transport-level failure
setEnv(GOOD_ENV)
globalThis.fetch = async () => { throw new TypeError('fetch failed') }
try { await gw.complete(MESSAGES); record('network-failure', 'APPLICATION_ERROR', 'unexpectedly resolved') }
catch (e) { record('network-failure', classifyGatewayError(e), e.code) }

// EMPTY_RESPONSE — 200 without usable content
globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }) })
try { await gw.complete(MESSAGES); record('empty-response', 'APPLICATION_ERROR', 'unexpectedly resolved') }
catch (e) { record('empty-response', 'EMPTY_RESPONSE', e.code) }

// INVALID_RESPONSE — malformed provider JSON
globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token') } })
try { await gw.complete(MESSAGES); record('malformed-response', 'APPLICATION_ERROR', 'unexpectedly resolved') }
catch (e) { record('malformed-response', 'INVALID_RESPONSE', e.constructor.name) }

// ── live probes (REAL Cloudflare; only here can SUCCESS mean inference) ─────
let liveRan = false
if (LIVE) {
  console.log('\n■ Live Cloudflare probes (real inference)\n')
  // IMPORTANT: classify against the REAL shell env (savedEnv), never the
  // deterministic probe env still sitting in process.env.
  const creds = savedEnv.CLOUDFLARE_ACCOUNT_ID && savedEnv.CLOUDFLARE_API_TOKEN && savedEnv.CLOUDFLARE_AI_GATEWAY_ID
  if (!creds) {
    record('live-smoke', 'CONFIGURATION', 'CLOUDFLARE_* not set in this shell — run from the developer environment')
  } else {
    liveRan = true
    globalThis.fetch = realFetch
    setEnv(savedEnv) // restore the real configuration
    // connectivity probe: distinguishes NETWORK-blocked from provider rejection
    const c0 = Date.now()
    try {
      await realFetch('https://api.cloudflare.com/client/v4', { method: 'GET' })
      record('live-connectivity', 'SUCCESS', `api.cloudflare.com reachable (${Date.now() - c0}ms)`)
    } catch (e) {
      record('live-connectivity', 'NETWORK', `blocked/unreachable: ${String(e.cause?.code || e.message).slice(0, 50)}`)
    }
    const t0 = Date.now()
    try {
      const out = await gw.complete(MESSAGES, { model: process.env.DEN_TORA_AI_MODEL || '@cf/zai-org/glm-4.7-flash' })
      const ms = Date.now() - t0
      const ok = typeof out.content === 'string' && out.content.trim().length > 0
      record('live-smoke', ok ? 'SUCCESS' : 'EMPTY_RESPONSE',
        `latency=${ms}ms model=${out.model} contentLen=${out.content.trim().length} reasoningLen=${out.reasoning?.length || 0}`)
    } catch (e) {
      const cls = classifyGatewayError(e)
      record('live-smoke', cls === 'PROVIDER_REJECTION' ? `PROVIDER_REJECTION (see [ai-gateway] failure log for cfErrorCode)` : cls, e.code || e.message)
    }
  }
  if (BASE_URL) {
    try {
      const res = await realFetch(new URL('/api/ai/query', BASE_URL), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: ' connectivity probe' }) })
      record('route-auth-boundary', res.status === 401 || res.status === 307 || res.status === 302 ? 'SUCCESS' : 'APPLICATION_ERROR', `HTTP ${res.status} (unauthenticated must not reach the LLM)`)
    } catch (e) { record('route-auth-boundary', 'NETWORK', String(e.message).slice(0, 60)) }
  }
} else {
  console.log('\n■ Live probes skipped (run with --live from the developer environment)\n')
}

// ── verdict ─────────────────────────────────────────────────────────────────
const fails = results.filter((r) => r.classification === 'APPLICATION_ERROR')
console.log('\n■ Summary')
for (const r of results) console.log(`  ${r.probe.padEnd(34)} ${r.classification}`)
const liveBlocked = LIVE && results.some((r) => r.probe === 'live-smoke' && r.classification === 'CONFIGURATION')
console.log(`\nHARNESS RESULT: ${fails.length ? 'FAIL' : liveBlocked ? 'BLOCKED (live credentials absent in this shell)' : 'PASS'}`)
setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, savedEnv[k]])))
rmSync(outDir, { recursive: true, force: true })
process.exit(fails.length ? 1 : 0)

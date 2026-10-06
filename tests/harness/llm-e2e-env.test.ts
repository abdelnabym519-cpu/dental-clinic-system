// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { resolveLiveEnv, parseEnvFile } from '../../scripts/lib/llm-e2e-env.mjs'

// Environment-propagation regression (the 'CLOUDFLARE_* not set in this
// shell' blocker): the harness must resolve live configuration from the
// REAL shell env with .env.local filling gaps, apply the documented
// gateway default, treat empty/whitespace as absent, and NEVER surface
// secret values outside process.env injection.

describe('parseEnvFile', () => {
  it('parses KEY=VALUE with quotes, comments and blanks (Next.js-style subset)', () => {
    const out = parseEnvFile(
      [
        '# comment',
        '',
        'CLOUDFLARE_ACCOUNT_ID="acct-1"',
        "CLOUDFLARE_API_TOKEN='tok-1'",
        'DEN_TORA_AI_MODEL=@cf/zai-org/glm-4.7-flash',
        '  # indented comment',
        'DEN_TORA_AI_TIMEOUT_MS=120000',
      ].join('\n')
    )
    expect(out.CLOUDFLARE_ACCOUNT_ID).toBe('acct-1')
    expect(out.CLOUDFLARE_API_TOKEN).toBe('tok-1')
    expect(out.DEN_TORA_AI_MODEL).toBe('@cf/zai-org/glm-4.7-flash')
    expect(out.DEN_TORA_AI_TIMEOUT_MS).toBe('120000')
  })

  it('treats empty and whitespace values as absent (no placeholder credentials)', () => {
    const out = parseEnvFile('A=\nB="   "\nC=real\n')
    expect(out.A).toBeUndefined()
    expect(out.B).toBeUndefined()
    expect(out.C).toBe('real')
  })
})

describe('resolveLiveEnv', () => {
  it('the reported blocker scenario: shell exports only ACCOUNT_ID+TOKEN; .env.local has the gateway id', () => {
    const r = resolveLiveEnv({
      env: { CLOUDFLARE_ACCOUNT_ID: 'shell-account', CLOUDFLARE_API_TOKEN: 'shell-token' },
      envLocal: parseEnvFile('CLOUDFLARE_AI_GATEWAY_ID=default\nDEN_TORA_AI_MODEL=@cf/zai-org/glm-4.7-flash\n'),
    })
    expect(r.creds).toBe(true) // ← previously false → CONFIGURATION
    const target = {}
    r.apply(target)
    expect(target.CLOUDFLARE_AI_GATEWAY_ID).toBe('default')
    expect(target.DEN_TORA_AI_MODEL).toBe('@cf/zai-org/glm-4.7-flash')
  })

  it('the shell environment always wins over .env.local', () => {
    const r = resolveLiveEnv({
      env: { CLOUDFLARE_ACCOUNT_ID: 'shell-account', CLOUDFLARE_API_TOKEN: 'shell-token', CLOUDFLARE_AI_GATEWAY_ID: 'custom-gw' },
      envLocal: parseEnvFile('CLOUDFLARE_AI_GATEWAY_ID=local-gw'),
    })
    const target = {}
    r.apply(target)
    expect(target.CLOUDFLARE_AI_GATEWAY_ID).toBe('custom-gw')
  })

  it('gateway id defaults to the documented contract value', () => {
    const r = resolveLiveEnv({
      env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' },
      envLocal: undefined,
    })
    const target = {}
    r.apply(target)
    expect(target.CLOUDFLARE_AI_GATEWAY_ID).toBe('default')
  })

  it('missing or whitespace-only token → not configured', () => {
    expect(resolveLiveEnv({ env: { CLOUDFLARE_ACCOUNT_ID: 'a' } }).creds).toBe(false)
    expect(resolveLiveEnv({ env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: '   ' } }).creds).toBe(false)
    expect(resolveLiveEnv({ env: { CLOUDFLARE_API_TOKEN: 't' } }).creds).toBe(false)
  })

  it('NEVER leaks secret values: apply()-closure design (sentinel scan)', () => {
    const SECRET = 'sentinel-token-value-XYZ'
    const r = resolveLiveEnv({
      env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: SECRET },
      envLocal: parseEnvFile('CLOUDFLARE_AI_GATEWAY_ID=gw-9'),
    })
    // the returned object itself can never carry the secret — stringify-safe
    expect(JSON.stringify(r)).not.toContain(SECRET)
    expect(r.detail).not.toContain(SECRET)
    // injection is explicit and targeted (the only path to the value)
    const target = {}
    r.apply(target)
    expect(target.CLOUDFLARE_API_TOKEN).toBe(SECRET)
  })
})

// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// Harness certification (Phase 17) — scripts/llm-e2e.mjs is a production
// artifact. The first Windows run failed with:
//
//   Error: spawnSync C:\Projects\dental-erp\node_modules\.bin\esbuild ENOENT
//
// Root cause: npm's Windows .bin entries for esbuild are sh wrappers
// (extensionless) plus .cmd/.ps1 shims; spawnSync cannot execute the
// extensionless sh wrapper (ENOENT) and Node rejects .cmd/.bat shims without
// shell (CVE-2024-27980 mitigation). The harness must therefore NEVER spawn
// .bin shims — it bundles through esbuild's JavaScript API, which resolves
// the platform native binary itself on Windows (Git Bash/PowerShell/CMD),
// Linux and macOS. These pins keep it that way.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, '..', '..')
const HARNESS = readFileSync(join(ROOT, 'scripts', 'llm-e2e.mjs'), 'utf-8')

describe('LLM E2E harness — cross-platform execution contract', () => {
  it('never spawns node_modules/.bin executables (the Windows ENOENT defect class)', () => {
    // no process-spawning of .bin shims anywhere in the harness
    // (call-syntax only — the comment documenting the historical defect says
    // "spawnSync" without parens and must not trip this pin)
    expect(HARNESS).not.toMatch(/\b(?:spawnSync|execFileSync|execSync|spawn)\s*\(/)
    expect(HARNESS).not.toMatch(/node_modules['"`]+,\s*['"`]+\.bin/)
  })

  it('bundles through the esbuild JavaScript API (platform-aware binary resolution)', () => {
    expect(HARNESS).toContain("await import('esbuild')")
    expect(HARNESS).toContain('buildSync({')
    // the documented rationale stays with the code
    expect(HARNESS).toContain('CVE-2024-27980')
  })

  it('stays syntactically valid for the shipped Node runtime (node --check)', () => {
    const { execFileSync } = require('child_process')
    // node --check is a parse-only validation of the harness itself; the
    // executable is the plain node binary, which is cross-platform by nature
    execFileSync(process.execPath, ['--check', join(ROOT, 'scripts', 'llm-e2e.mjs')], { stdio: 'pipe' })
    expect(true).toBe(true)
  })

  it('distinguishes live credentials from deterministic-mode env (no placeholder confusion)', () => {
    // live classification must read the saved SHELL env, not probe-mutated env
    expect(HARNESS).toContain('savedEnv.CLOUDFLARE_ACCOUNT_ID')
    expect(HARNESS).toContain('setEnv(savedEnv)')
  })

  it('keeps secrets out of observable output (redaction layer present)', () => {
    expect(HARNESS).toContain("replace(/(Bearer\\s+)\\S+/gi, '$1[redacted]')")
    expect(HARNESS).not.toMatch(/console\.log\([^)]*CLOUDFLARE_API_TOKEN/)
  })
})

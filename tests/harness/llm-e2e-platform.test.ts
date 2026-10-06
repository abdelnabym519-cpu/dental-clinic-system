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

  it('ESM URL CONTRACT (Windows c: regression pin): bundled module imported via pathToFileURL only', () => {
    // The exact Windows failure: import('C:\\…\\gateway.mjs') → the ESM
    // loader parses 'C:' as a protocol (ERR_UNSUPPORTED_ESM_URL_SCHEME,
    // "Received protocol 'c:'"). Every dynamic import in the harness must be
    // either a bare package specifier or a pathToFileURL()-wrapped path.
    const dynamicImports = [...HARNESS.matchAll(/await import\(([^)]+)\)/g)].map((m) => m[1].trim())
    expect(dynamicImports.length).toBeGreaterThanOrEqual(2)
    for (const target of dynamicImports) {
      const isBareSpecifier = /^['"]([a-z@][^'"]*)['"]$/.test(target)
      const isPathToFileURL = target.startsWith('pathToFileURL(')
      expect(isBareSpecifier || isPathToFileURL, `dynamic import target: ${target}`).toBe(true)
    }
    expect(HARNESS).toContain('pathToFileURL(bundle).href')
  })

  it('behavioral: pathToFileURL round-trips absolute paths into loader-accepted file: URLs', () => {
    // Node is platform-aware here (POSIX pathToFileURL does NOT reinterpret
    // 'C:\\' — win32 semantics apply on Windows hosts natively). The honest
    // cross-platform invariant: for any NATIVE absolute path, pathToFileURL
    // yields a file: URL that round-trips exactly — and file: is in the ESM
    // loader's allowed scheme set (file|data|node), which is precisely why
    // this conversion fixes the 'Received protocol c:' rejection.
    const { pathToFileURL, fileURLToPath } = require('node:url')
    const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
    const path = require('path')
    const abs = path.join(mkdtempSync(path.join(require('node:os').tmpdir(), 'esm-url-')), 'gateway.mjs')
    try {
      writeFileSync(abs, 'export const marker = 42\n')
      const href = pathToFileURL(abs).href
      expect(href.startsWith('file://')).toBe(true)
      expect(fileURLToPath(href)).toBe(abs)
      // executable proof in REAL Node (not the Vite runner, which intercepts
      // dynamic imports and cannot resolve outside its root): a child node
      // process loads the file exactly the way the harness does. node itself
      // is the cross-platform executable — no .bin shims involved.
      const { execFileSync } = require('child_process')
      execFileSync(
        process.execPath,
        [
          '-e',
          "const { pathToFileURL } = require('node:url');" +
            'import(pathToFileURL(process.argv[1]).href)' +
            '.then((m) => { if (m.marker !== 42) process.exit(1) })' +
            '.catch(() => process.exit(2))',
          abs,
        ],
        { stdio: 'pipe' }
      )
      expect(true).toBe(true)
    } finally {
      try { rmSync(abs) } catch {}
    }
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

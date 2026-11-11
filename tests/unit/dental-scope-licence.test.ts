import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'

import {
  DEVELOPMENT_SOURCES,
  HYOID_SOURCES,
  canalFrequency,
  formatPercent,
  frequencyContext,
  hyoidAttachments,
  resolveContent,
} from '../../vendor/dental-scope-engine/src/stubs/educational-text'

/**
 * P4 / S1 — LICENCE HYGIENE for the vendored dental-scope engine.
 *
 * The engine CODE is MIT. Upstream `src/content/` is a DIFFERENT work under
 * **CC BY-SA 4.0** (educational prose in five languages) and it also carried
 * `canal-counts.json` — clinical data nobody approved. That tree is deleted
 * from this vendor copy and replaced by `src/stubs/educational-text.ts`, a
 * minimal typed stub exporting EMPTY data.
 *
 * These tests are the gate: if a path matching `content|docs|\.glb|neurovascular`
 * ever reappears in the vendored tree, they fail.
 *
 * NOTE ON GIT HISTORY: deleting the files removes them from the tip, not from
 * history — commits up to `0152c65` still contain them. That is recorded in
 * `docs/dental-chart/ASSETS.md` for decision D1 and asserted by the last test.
 */
const VENDOR = path.resolve(__dirname, '../../vendor/dental-scope-engine')
const FORBIDDEN = /content|docs|\.glb|neurovascular/i

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(path.relative(VENDOR, full))
  }
  return out
}

describe('vendored dental-scope tree carries no forbidden path', () => {
  it('the vendor directory exists (so the suite cannot pass by absence)', () => {
    expect(existsSync(VENDOR)).toBe(true)
    expect(existsSync(path.join(VENDOR, 'LICENSE'))).toBe(true)
    expect(existsSync(path.join(VENDOR, 'src/engine/Engine.ts'))).toBe(true)
  })

  it('no FILE ON DISK matches content|docs|.glb|neurovascular', () => {
    const offenders = walk(VENDOR).filter((p) => FORBIDDEN.test(p))
    expect(offenders, `offending paths: ${offenders.join(', ')}`).toEqual([])
  })

  it('no path TRACKED IN GIT matches content|docs|.glb|neurovascular', () => {
    const tracked = execFileSync('git', ['ls-files', 'vendor/dental-scope-engine'], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace('vendor/dental-scope-engine/', ''))

    expect(tracked.length).toBeGreaterThan(50)
    expect(tracked.filter((p) => FORBIDDEN.test(p))).toEqual([])
  })

  it('no source file still IMPORTS from the deleted content tree', () => {
    // walk() returns paths relative to VENDOR, so join against VENDOR.
    const files = walk(path.join(VENDOR, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))
    expect(files.length).toBeGreaterThan(50)
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(path.join(VENDOR, f), 'utf8')
      if (/from\s+['"][^'"]*content\//.test(text)) offenders.push(f)
    }
    expect(offenders, `still importing content/: ${offenders.join(', ')}`).toEqual([])
  })

  it('the vendor tree ships no 3D model file', () => {
    expect(walk(VENDOR).filter((p) => /\.glb$|\.gltf$|\.hdr$/.test(p))).toEqual([])
  })
})

describe('the replacement stub exports EMPTY data (no text, no counts)', () => {
  it('resolveContent returns no summary, facts, sources or links', () => {
    const r = resolveContent({} as never, 'tooth-11', 'en')
    expect(r.key).toBeNull()
    expect(r.summary).toBe('')
    expect(r.facts).toEqual([])
    expect(r.sources).toEqual([])
    expect(r.related).toEqual([])
    expect(r.guides).toEqual([])
    expect(r.status).toBe('placeholder')
  })

  it('summary is an empty STRING, not undefined — otherwise the UI prints "undefined"', () => {
    // Engine.ts does `resolveContent(...).summary!` and assigns it to
    // `textContent`; `undefined` would render the literal English word.
    const r = resolveContent({} as never, 'tooth-11', 'en')
    expect(typeof r.summary).toBe('string')
    expect(r.summary).toBe('')
  })

  it('canalFrequency yields no count data, so its panel renders nothing', () => {
    for (const fdi of [11, 16, 26, 36, 46, 48]) {
      expect(canalFrequency(fdi), `FDI ${fdi}`).toBeUndefined()
    }
  })

  it('formatPercent and frequencyContext return empties', () => {
    expect(formatPercent(42, 'en')).toBe('')
    expect(frequencyContext(11, 'en')).toEqual([])
  })

  it('hyoid attachments and both citation lists are empty', () => {
    expect(hyoidAttachments('en')).toEqual([])
    expect(DEVELOPMENT_SOURCES).toEqual([])
    expect(HYOID_SOURCES).toEqual([])
  })
})

describe('the stub source itself contains no English prose or clinical numbers', () => {
  const src = readFileSync(path.join(VENDOR, 'src/stubs/educational-text.ts'), 'utf8')

  it('has no multi-word English sentence in a data position', () => {
    // Comments are documentation and allowed; reject a quoted sentence.
    const quoted = src.match(/'[^'\n]{25,}'|"[^"\n]{25,}"/g) ?? []
    const prose = quoted.filter((q) => /[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/.test(q))
    expect(prose, `prose in stub: ${prose.join(' | ')}`).toEqual([])
  })

  it('contains no canal counts (no numeric literal other than 0/1 in data)', () => {
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const nums = (body.match(/\b\d+(\.\d+)?\b/g) ?? []).filter((n) => !['0', '1'].includes(n))
    expect(nums, `unexpected numbers: ${nums.join(', ')}`).toEqual([])
  })
})

describe('the git-history caveat is recorded for decision D1', () => {
  it('docs/dental-chart/ASSETS.md states that history still contains the files', () => {
    const p = path.resolve(__dirname, '../../docs/dental-chart/ASSETS.md')
    expect(existsSync(p)).toBe(true)
    const text = readFileSync(p, 'utf8')
    expect(text).toMatch(/git history/i)
    expect(text).toMatch(/CC BY-SA 4\.0/)
  })
})

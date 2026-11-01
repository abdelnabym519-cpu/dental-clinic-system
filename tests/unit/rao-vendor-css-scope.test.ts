/**
 * R1a — guard against the vendored library's CSS leaking into the app.
 *
 * The library's stylesheet is a GLOBAL stylesheet: `src/index.ts` imports it as
 * a side effect, and Next keeps CSS loaded by a dynamic import after client-side
 * navigation. So once a user opens the v2 chart, these rules keep applying on
 * every other page.
 *
 * Measured leak before scoping (see docs/dental-chart/R1A-BUNDLE.md):
 *   :root      redefines --card, --muted, --accent  -> collides with the app's
 *              shadcn tokens in app/globals.css (lines 9, 17, 19). The library
 *              loads LAST, so it wins and recolours the whole app.
 *   body       sets margin, font-family, a radial-gradient background and color
 *              -> overrides the app's typography and background everywhere.
 *   html,body  height:100%                     -> can break page scrolling.
 *   select     restyles EVERY <select>         -> breaks app dropdowns.
 *   .dark body background                      -> the app uses Tailwind `.dark`.
 *
 * These tests parse the stylesheet and fail if any of those come back. They are
 * static by design: jsdom does not apply a real cascade, so behaviour cannot be
 * asserted here — presence of the selector can.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const CSS_PATH = 'vendor/react-advanced-odontogram/src/index.css'
const css = readFileSync(CSS_PATH, 'utf8')

/** Strip comments so commented-out rules are not counted. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  selector: string
  body: string
  line: number
}

/** Parse top-level (brace depth 0) rules with their declaration bodies. */
function topLevelRules(src: string): Rule[] {
  const rules: Rule[] = []
  let depth = 0
  let buf = ''
  let line = 1
  let openLine = 1
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '\n') line += 1
    if (ch === '{') {
      if (depth === 0) {
        openLine = line
        rules.push({ selector: buf.trim(), body: '', line: openLine })
      }
      depth += 1
      buf = ''
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && rules.length > 0) {
        rules[rules.length - 1].body = src.slice(rules[rules.length - 1].body ? 0 : 0) // placeholder
      }
      buf = ''
    } else if (depth === 0) {
      buf += ch
    }
  }
  // Second pass: capture bodies (simpler and reliable for this file's shape).
  const withBodies: Rule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  let depth2 = 0
  let idx = 0
  while ((m = re.exec(src)) !== null) {
    // Only accept rules whose braces are at nesting depth 0 by tracking counts.
    const before = src.slice(0, m.index)
    const opens = (before.match(/\{/g) || []).length
    const closes = (before.match(/\}/g) || []).length
    depth2 = opens - closes
    if (depth2 === 0) {
      withBodies.push({
        selector: m[1].trim(),
        body: m[2].trim(),
        line: before.split('\n').length,
      })
    }
    idx += 1
  }
  void idx
  return withBodies
}

const rules = topLevelRules(stripped)
/** One selector per comma-separated part. */
const parts = rules.flatMap((r) =>
  r.selector.split(',').map((s) => ({ sel: s.trim(), body: r.body, line: r.line })),
)

/**
 * A selector is "scoped" if it is inside the host container (`.rao-scope`) or
 * inside the library's own root class (`.odontogram-root`, which is rendered by
 * OdontogramContext.tsx:1045 around everything the library draws - so it is a
 * real scope, not a global).
 */
const isScoped = (sel: string) =>
  sel.includes('.rao-scope') || sel.includes('.odontogram-root') || sel.startsWith(':where(')

// The document-level selectors the library must never style directly.
const BARE = new Set(['html', 'body', '*', ':root'])

describe('vendored CSS does not style the document', () => {
  it.each([...BARE])('no unscoped bare `%s` rule', (sel) => {
    const hits = parts.filter((p) => p.sel === sel && !isScoped(p.sel))
    expect(
      hits.map((h) => `${CSS_PATH}:${h.line} ${h.sel} { ${h.body.slice(0, 60)} }`),
    ).toEqual([])
  })

  it('no unscoped `html, body` combo', () => {
    const hits = parts.filter(
      (p) => /^html\s*,\s*body$|^body\s*,\s*html$/.test(p.sel) && !isScoped(p.sel),
    )
    expect(hits.map((h) => `${h.line}: ${h.sel}`)).toEqual([])
  })

  it('no unscoped `select` (would restyle every app dropdown)', () => {
    const hits = parts.filter((p) => /(^|\s)select(:focus)?$/.test(p.sel) && !isScoped(p.sel))
    expect(hits.map((h) => `${h.line}: ${h.sel}`)).toEqual([])
  })

  it('no `.dark body` (the app uses Tailwind `.dark`)', () => {
    const hits = parts.filter((p) => /\.dark\s+body/.test(p.sel) && !isScoped(p.sel))
    expect(hits.map((h) => `${h.line}: ${h.sel}`)).toEqual([])
  })
})

describe('vendored CSS does not redefine the app design tokens', () => {
  // app/globals.css defines these (shadcn). The library redefines them on :root
  // and, loading later, would win.
  const COLLIDING = ['--card', '--muted', '--accent']

  it.each(COLLIDING)('does not redefine %s outside the scoped container', (token) => {
    const hits = parts.filter(
      (p) => !isScoped(p.sel) && new RegExp(`(^|[^-\\w])${token}\\s*:`).test(p.body),
    )
    expect(hits.map((h) => `${h.line}: ${h.sel} { ${token} }`)).toEqual([])
  })

  it('the app genuinely defines those tokens (so the collision is real)', () => {
    const globals = readFileSync('app/globals.css', 'utf8')
    for (const token of COLLIDING) {
      expect(globals, `app/globals.css should define ${token}`).toMatch(
        new RegExp(`${token}\\s*:`),
      )
    }
  })
})

describe('the scoped container is actually applied by the host', () => {
  it('RaoOdontogram wraps the chart in .rao-scope', () => {
    const src = readFileSync('components/dental-chart/v2/RaoOdontogram.tsx', 'utf8')
    expect(src).toMatch(/rao-scope/)
  })
})

describe('sanity: the stylesheet is still substantial', () => {
  it('has many rules (parsing did not silently produce nothing)', () => {
    expect(rules.length).toBeGreaterThan(200)
  })
})

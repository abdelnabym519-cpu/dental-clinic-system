/**
 * Contract tests for the R1a patches applied to the vendored library.
 *
 * The vendored source is excluded from tsconfig and vitest only collects
 * tests/**, so the patched engine cannot be unit-tested directly here (it needs
 * a real DOM and a full init). These tests are the next best thing: they assert
 * the patches are present and correctly shaped, so a bad merge, a re-vendor, or
 * an upstream sync cannot silently drop them.
 *
 * They read the vendored files as text by design - this is a guard on the
 * vendored artifact, not a behavioural test of the library.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const VENDOR = 'vendor/react-advanced-odontogram/src'
const engine = readFileSync(`${VENDOR}/odontogram.ts`, 'utf8')
const context = readFileSync(`${VENDOR}/OdontogramContext.tsx`, 'utf8')
const topbar = readFileSync(`${VENDOR}/surfaces/OdontogramTopbar.tsx`, 'utf8')
const patches = readFileSync('vendor/react-advanced-odontogram/PATCHES.md', 'utf8')

/**
 * Extract ONE exported function's source, from its signature to the closing
 * brace at column 0. Slicing to end-of-file would drag in the rest of the
 * module and make the "does not call X" assertions vacuously fail.
 */
function extractFn(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(start)
  const end = rest.search(/\n\}\n/)
  expect(end, `${name} has no closing brace at column 0`).toBeGreaterThan(0)
  return rest.slice(0, end + 3)
}

describe('vendored licence files are untouched', () => {
  it('ships LICENSE and THIRD-PARTY-NOTICES.md', () => {
    expect(() => readFileSync('vendor/react-advanced-odontogram/LICENSE', 'utf8')).not.toThrow()
    expect(() =>
      readFileSync('vendor/react-advanced-odontogram/THIRD-PARTY-NOTICES.md', 'utf8'),
    ).not.toThrow()
  })

  it('records every patch in PATCHES.md', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(patches).toMatch(new RegExp(`Patch ${n} `))
    }
  })
})

describe('patch 1 (i) - controlled selection', () => {
  it('adds a setSelectedTeeth setter the engine never shipped', () => {
    expect(engine).toMatch(/export function setSelectedTeeth\(/)
  })

  it('funnels the write through updateSelectionUI to avoid a double notify', () => {
    const fn = extractFn(engine, 'setSelectedTeeth')
    expect(fn).toMatch(/updateSelectionUI\(\)/)
    // must NOT also call notifyStateChange - updateSelectionUI already does
    expect(fn).not.toMatch(/notifyStateChange\(\)/)
  })

  it('drops numbers that are not real teeth', () => {
    expect(extractFn(engine, 'setSelectedTeeth')).toMatch(/ALL_TEETH/)
  })

  it('exposes selectedTeeth and onSelectionChange props on the provider', () => {
    expect(context).toMatch(/selectedTeeth\?: number\[\]/)
    expect(context).toMatch(/onSelectionChange\?: \(teeth: number\[\]\) => void/)
  })

  it('imports the new engine setter', () => {
    expect(context).toMatch(/setSelectedTeeth,/)
  })
})

describe('patch 3 (iii) - language switcher hidden', () => {
  it('adds showLanguageSwitcher, defaulting to upstream behaviour', () => {
    expect(context).toMatch(/showLanguageSwitcher = true,/)
  })

  it('gates the topbar language menu on it', () => {
    expect(topbar).toMatch(/showLanguageSwitcher && \(/)
  })

  it('keeps the menu markup intact behind the gate', () => {
    expect(topbar).toMatch(/id="languageMenu"/)
  })
})

describe('patch 5 (v) - per-patient reset', () => {
  it('adds resetForPatient to the engine', () => {
    expect(engine).toMatch(/export function resetForPatient\(/)
  })

  it('clears findings AND the selection, which resetMouth alone does not', () => {
    const fn = extractFn(engine, 'resetForPatient')
    expect(fn).toMatch(/resetMouth\(\)/)
    expect(fn).toMatch(/selectedTeeth = new Set\(\)/)
    expect(fn).toMatch(/activeTooth = null/)
  })

  it('does not reset host config the way destroyOdontogram does', () => {
    const fn = extractFn(engine, 'resetForPatient')
    expect(fn).not.toMatch(/setReadOnly/)
    expect(fn).not.toMatch(/setNotesEnabled/)
  })

  it('is exposed through the provider context', () => {
    expect(context).toMatch(/resetForPatient: \(\) => void/)
    expect(context).toMatch(/^\s+resetForPatient,$/m)
  })
})

describe('patch 2 (ii) - findings restricted to the DenToRa set', () => {
  it('is enforced by the adapter, which is DenToRa-only path into the library', () => {
    const adapter = readFileSync('lib/dental-chart/v2/rao-adapter.ts', 'utf8')
    expect(adapter).toMatch(/UNMAPPED_CONDITIONS/)
    expect(adapter).toMatch(/MAPPED_CONDITIONS/)
  })
})

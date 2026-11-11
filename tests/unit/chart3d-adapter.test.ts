import { describe, it, expect } from 'vitest'

import {
  CHART3D_VIEWS,
  PERMANENT_FDI,
  fallbackNote,
  selectScene,
  type Chart3DAdapter,
} from '@/lib/dental-chart/3d/types'
import { createProceduralScene } from '@/lib/dental-chart/3d/procedural-scene'
import { createScopeScene, opacityForStatus, tintForStatus } from '@/lib/dental-chart/3d/scope-scene'
import { deriveToothStatus } from '@/lib/dental-chart/clinical-status'

/**
 * P4 / step 3 — the Chart3DAdapter contract.
 *
 * The load-bearing requirement: with **no model file** (ASSET_MODE=none, the
 * default) the app must resolve to the ProceduralScene fallback WITH an Arabic
 * note — never a blank viewport and never an error.
 */
describe('selectScene — ASSET_MODE=none is the default path, not an error', () => {
  it('none → procedural, with the asset-mode reason', () => {
    const r = selectScene({ assetMode: 'none', webgl: true })
    expect(r.kind).toBe('procedural')
    expect(r.fallbackReason).toBe('asset-mode-none')
  })

  it('no WebGL → procedural, with the webgl reason', () => {
    const r = selectScene({ assetMode: 'local', webgl: false })
    expect(r.kind).toBe('procedural')
    expect(r.fallbackReason).toBe('webgl-unsupported')
  })

  it('assets enabled + WebGL → the engine, with NO fallback reason', () => {
    for (const mode of ['local', 'bundled'] as const) {
      const r = selectScene({ assetMode: mode, webgl: true })
      expect(r.kind).toBe('scope')
      expect(r.fallbackReason).toBeNull()
    }
  })

  it('never returns a scene without a resolvable outcome', () => {
    for (const assetMode of ['none', 'local', 'bundled'] as const) {
      for (const webgl of [true, false]) {
        const r = selectScene({ assetMode, webgl })
        expect(['scope', 'procedural']).toContain(r.kind)
        // Either we are on the engine cleanly, or we have a stated reason.
        expect(r.kind === 'scope' ? r.fallbackReason === null : r.fallbackReason !== null).toBe(true)
      }
    }
  })
})

describe('fallbackNote — Arabic, and present for every fallback reason', () => {
  it('gives a note for all three reasons', () => {
    for (const reason of ['asset-mode-none', 'webgl-unsupported', 'scope-mount-failed'] as const) {
      const note = fallbackNote(reason)
      expect(note, reason).toBeTruthy()
      expect(note).toMatch(/[؀-ۿ]/) // contains Arabic
    }
  })

  it('is null when there is no fallback', () => {
    expect(fallbackNote(null)).toBeNull()
  })

  it('contains no English prose (technical identifiers are deliberately Latin)', () => {
    // Two tokens are intentionally left in Latin script because the user needs
    // to recognise them: the env var to change, and the browser feature name.
    // Neither is prose, so both are excluded before the check.
    const ALLOWED_IDENTIFIERS = /ASSET_MODE=none|WebGL/g
    for (const reason of ['asset-mode-none', 'webgl-unsupported', 'scope-mount-failed'] as const) {
      const text = fallbackNote(reason)!.replace(ALLOWED_IDENTIFIERS, '')
      expect(text, reason).not.toMatch(/[A-Za-z]{3,}/)
    }
  })
})

describe('the adapter interface shape', () => {
  const required: (keyof Chart3DAdapter)[] = [
    'kind',
    'teeth',
    'mount',
    'setStates',
    'onSelect',
    'select',
    'setView',
    'reset',
    'dispose',
  ]

  it('procedural implements every member', () => {
    const a = createProceduralScene({ load: async () => () => null })
    for (const k of required) expect(a[k], String(k)).toBeDefined()
    expect(a.kind).toBe('procedural')
  })

  it('scope implements every member', () => {
    const a = createScopeScene({ loadEngine: async () => { throw new Error('nope') } })
    for (const k of required) expect(a[k], String(k)).toBeDefined()
    expect(a.kind).toBe('scope')
  })

  it('scope covers exactly the 32 permanent teeth', () => {
    const a = createScopeScene({ loadEngine: async () => { throw new Error('nope') } })
    expect([...a.teeth].sort((x, y) => x - y)).toEqual([...PERMANENT_FDI].sort((x, y) => x - y))
    expect(a.teeth).toHaveLength(32)
    expect(a.teeth.every((t) => t >= 11 && t <= 48)).toBe(true)
  })

  it('CHART3D_VIEWS covers the presets the UI offers', () => {
    expect(CHART3D_VIEWS).toEqual(['default', 'front', 'upper', 'lower', 'left', 'right'])
  })
})

describe('tinting — resolved rows must NOT tint', () => {
  it('a finding with resolvedDate derives healthy, so it never tints', () => {
    const status = deriveToothStatus([{ condition: 'CARIES', resolvedDate: '2026-01-01' }], [])
    expect(status).toBe('healthy')
    expect(tintForStatus(status)).toBeNull()
  })

  it('the same finding WITHOUT resolvedDate tints', () => {
    const status = deriveToothStatus([{ condition: 'CARIES' }], [])
    expect(status).toBe('affected')
    expect(tintForStatus(status)).toBe('#ef4444')
  })

  it('healthy is never tinted — it keeps the material own enamel colour', () => {
    expect(tintForStatus('healthy')).toBeNull()
    expect(opacityForStatus('healthy')).toBeNull()
  })

  it('missing reads as absent (grey + low opacity), not merely grey', () => {
    expect(tintForStatus('missing')).toBe('#9ca3af')
    expect(opacityForStatus('missing')).toBe(0.18)
  })

  it('every other status has a distinct tint', () => {
    const tints = (['affected', 'planned', 'in_progress', 'completed'] as const).map(tintForStatus)
    expect(tints.every((t) => typeof t === 'string' && t.length === 7)).toBe(true)
    expect(new Set(tints).size).toBe(4)
  })
})

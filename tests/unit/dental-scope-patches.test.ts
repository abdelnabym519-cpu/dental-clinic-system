import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

import {
  fdiFromMeshKey,
  clearToothAppearance,
  disposeEngineResources,
  focusTooth,
  hideEngineChrome,
  onToothSelection,
  resetEngine,
  selectTooth,
  setToothAppearance,
  type ToothAppearance,
} from '../../vendor/dental-scope-engine/src/engine/dentoraPatches'

/**
 * P4 / S3 — contract tests for the six Dentora patches over the vendored
 * dental-scope engine.
 *
 * These are REAL-MODULE tests: they import the actual patch module and assert
 * its exports exist and behave, and they PARSE the vendored source so a change
 * to `Engine.ts` (the accessors, the dispose hook) cannot pass unnoticed.
 *
 * Negative control lives at the bottom of PATCHES.md; when run it removes an
 * export and this suite must fail.
 */
const VENDOR = path.resolve(__dirname, '../../vendor/dental-scope-engine')
const PATCHES = path.join(VENDOR, 'src/engine/dentoraPatches.ts')
const ENGINE = path.join(VENDOR, 'src/engine/Engine.ts')

const src = readFileSync(PATCHES, 'utf8')
const engineSrc = readFileSync(ENGINE, 'utf8')

describe('PATCH 2 — setToothAppearance', () => {
  it('is exported with the tint/opacity/rim signature', () => {
    expect(typeof setToothAppearance).toBe('function')
    expect(src).toMatch(/export interface ToothAppearance \{/)
    expect(src).toMatch(/tint\?: string \| null;/)
    expect(src).toMatch(/opacity\?: number \| null;/)
    expect(src).toMatch(/rim\?: string \| null;/)
  })

  it('traverses mesh keys starting with tooth-<fdi>', () => {
    expect(src).toMatch(/keysForFdi/)
    expect(src).toMatch(/`tooth-\$\{fdi\}`/)
    expect(src).toMatch(/key\.startsWith\(p\)/)
  })

  it('tints the root/cementum meshes with the SAME status, not just the crown', () => {
    // A "caries on 36" chart entry must not light the crown and leave the
    // roots looking healthy.
    expect(src).toMatch(/cementum-\$\{fdi\}/)
    expect(src).toMatch(/dentine-\$\{fdi\}/)
    expect(src).toMatch(/pulp-\$\{fdi\}/)
  })

  it('tints by MULTIPLYING, preserving the enamel shading, and can undo it', () => {
    expect(src).toMatch(/mat\.color\.copy\(base\.color\)\.multiply/)
    expect(src).toMatch(/mat\.color\.copy\(base\.color\);/)
    expect(typeof clearToothAppearance).toBe('function')
  })

  it('behaves: returns 0 changed meshes when the tooth is not loaded', () => {
    const fake = { dentoraEntries: () => new Map() } as never
    expect(setToothAppearance(fake, 36, { tint: '#ff0000' })).toBe(0)
    expect(clearToothAppearance(fake)).toBe(0)
  })

  it('behaves: touches every mesh of the tooth and clears them again', () => {
    // Chainable THREE.Color-ish mock: copy()/multiply()/set() return `this`,
    // exactly like the real Color, so the patch's call chain works.
    const colorMock = () => {
      const c: Record<string, unknown> = {}
      c.clone = () => colorMock()
      c.copy = () => c
      c.multiply = () => c
      c.set = () => c
      return c
    }
    const mkEntry = () => ({
      key: 'x',
      mesh: {
        material: {
          color: colorMock(),
          emissive: colorMock(),
          emissiveIntensity: 0,
          opacity: 1,
          needsUpdate: false,
          userData: {},
        },
      },
    })
    const entries = new Map<string, unknown>([
      ['tooth-36', mkEntry()],
      ['cementum-36', mkEntry()],
      ['tooth-11', mkEntry()],
      ['nerves', mkEntry()],
    ])
    const fake = { dentoraEntries: () => entries } as never
    const appearance: ToothAppearance = { tint: '#ff0000', opacity: 0.8, rim: '#00ff00' }
    // 2 of the 4 entries belong to FDI 36.
    expect(setToothAppearance(fake, 36, appearance)).toBe(2)
    expect(clearToothAppearance(fake)).toBe(2)
  })
})

describe('PATCH 3 — selection OUT', () => {
  it('converts tooth-NN keys to the FDI number (NN IS the FDI number)', () => {
    expect(fdiFromMeshKey('tooth-11')).toBe(11)
    expect(fdiFromMeshKey('tooth-36')).toBe(36)
    expect(fdiFromMeshKey('tooth-48')).toBe(48)
  })

  it('returns null for anything that is not a tooth', () => {
    for (const id of ['nerves', 'tooth-', 'tooth-5', 'bone-11', '', null, undefined]) {
      expect(fdiFromMeshKey(id as string | null | undefined), String(id)).toBeNull()
    }
  })

  it('subscribes to the engine MODULE-LEVEL store, not a React hook', () => {
    expect(src).toMatch(/from '\.\.\/state\/store'/)
    expect(src).toMatch(/store\.subscribe\(/)
    expect(src).not.toMatch(/useApp|useState|useEffect/)
  })

  it('emits immediately and returns an unsubscribe function', () => {
    const seen: (number | null)[] = []
    const off = onToothSelection((fdi) => seen.push(fdi))
    expect(typeof off).toBe('function')
    expect(seen.length).toBe(1) // fires once with the current selection
    off()
  })
})

describe('PATCH 4 — selection IN', () => {
  it('drives selectFromUI with a tooth-<fdi> key', () => {
    expect(typeof selectTooth).toBe('function')
    expect(src).toMatch(/engine\.selectFromUI\(`tooth-\$\{fdi\}`/)
  })

  it('focus() frames the tooth', () => {
    expect(typeof focusTooth).toBe('function')
    expect(src).toMatch(/engine\.focus\(`tooth-\$\{fdi\}`\)/)
  })

  it('behaves: both forward the FDI-derived key to the engine', async () => {
    const calls: unknown[] = []
    const fake = {
      selectFromUI: (id: string, opts: unknown) => {
        calls.push([id, opts])
        return Promise.resolve()
      },
      focus: (id: string) => calls.push(['focus', id]),
    } as never
    await selectTooth(fake, 21, { focus: true })
    focusTooth(fake, 21)
    expect(calls).toEqual([
      ['tooth-21', { focus: true }],
      ['focus', 'tooth-21'],
    ])
  })
})

describe('PATCH 5 — per-mount isolation / reset between patients', () => {
  it('clears appearance AND selection state, then resets the camera', () => {
    expect(typeof resetEngine).toBe('function')
    expect(src).toMatch(/clearToothAppearance\(engine\)/)
    expect(src).toMatch(/selectedId: null/)
    expect(src).toMatch(/selectionRequest: null/)
    expect(src).toMatch(/engine\.resetToStart\(\)/)
  })

  it('documents WHY: the store is a module-level singleton', () => {
    expect(src).toMatch(/module-level singleton/)
  })
})

describe('PATCH 6 — full dispose (upstream leaks GPU memory)', () => {
  it('disposes geometries, materials and textures', () => {
    expect(typeof disposeEngineResources).toBe('function')
    expect(src).toMatch(/geo\.dispose\(\)/)
    expect(src).toMatch(/disposeMaterial/)
    expect(src).toMatch(/isTexture/)
    expect(src).toMatch(/mat\.dispose\(\)/)
  })

  it('reaches meshes outside `entries` by traversing the scene', () => {
    expect(src).toMatch(/engine\.dentoraScene\(\)\?\.traverse\(collect\)/)
  })

  it('Engine.dispose() actually calls the resource release', () => {
    expect(engineSrc).toMatch(/this\.dentoraDisposeResources\(\);/)
  })

  it('the release is idempotent (dispose + a direct call must not double-free)', () => {
    expect(engineSrc).toMatch(/private dentoraDisposed = false;/)
    expect(engineSrc).toMatch(/if \(this\.dentoraDisposed\) return;/)
  })
})

describe('PATCH 7 — hide the engine chrome; no English text', () => {
  it('hides the overlay and the hover tooltip, and turns labels off', () => {
    expect(typeof hideEngineChrome).toBe('function')
    expect(src).toMatch(/querySelector<HTMLElement>\('\.ds-overlay'\)/)
    expect(src).toMatch(/#ds-hover-info/)
    expect(src).toMatch(/setState\(\{ labels: false \}\)/)
  })

  it('explains that the English tooltip is fed by formatTooth/nameOf/SINUS_NOTE', () => {
    expect(src).toMatch(/SINUS_NOTE/)
  })

  it('behaves on a DOM container: hides then restores', () => {
    const container = document.createElement('div')
    container.innerHTML = '<div class="ds-overlay"><div id="ds-hover-info" class="ds-tip"></div></div>'
    const overlay = container.querySelector<HTMLElement>('.ds-overlay')!
    const tip = container.querySelector<HTMLElement>('#ds-hover-info')!

    const handle = hideEngineChrome(container)
    expect(overlay.style.display).toBe('none')
    expect(tip.style.display).toBe('none')

    handle.restore()
    expect(overlay.style.display).toBe('')
    expect(tip.style.display).toBe('')
  })
})

describe('the engine exposes the four accessors the patches rely on', () => {
  it('declares all of them, and exports MeshEntry for typing', () => {
    for (const name of [
      'dentoraEntries',
      'dentoraScene',
      'dentoraRenderer',
      'dentoraDisposeResources',
    ]) {
      // Anchored at the start of a line, so a RENAMED accessor such as
      // `_removed_dentoraEntries(` cannot satisfy the match. An unanchored
      // regex passed a negative control and hid a missing method — don't
      // loosen this back to a bare substring match.
      expect(engineSrc, `accessor ${name} must be declared as a method`).toMatch(
        new RegExp(`^\\s{2}${name}\\s*\\(`, 'm'),
      )
    }
    expect(engineSrc).toMatch(/export interface MeshEntry \{/)
  })

  it('the patch module imports Engine TYPE-ONLY, so there is no runtime cycle', () => {
    expect(src).toMatch(/import type \{ Engine, MeshEntry \} from '\.\/Engine';/)
    expect(src).not.toMatch(/import \{ Engine/)
  })

  it('the vendored tree still has no forbidden path (licence gate still holds)', () => {
    expect(existsSync(PATCHES)).toBe(true)
    expect(/content|docs|\.glb|neurovascular/i.test(PATCHES)).toBe(false)
    expect(/content|docs|\.glb|neurovascular/i.test(ENGINE)).toBe(false)
  })
})

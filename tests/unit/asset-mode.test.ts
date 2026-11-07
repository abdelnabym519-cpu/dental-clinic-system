import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

import {
  ASSET_MODES,
  BundledAssetsBlockedError,
  D1_DECISION_MARKER,
  DEFAULT_ASSET_MODE,
  FORBIDDEN_ASSETS,
  assetsEnabled,
  isForbiddenAsset,
  parseAssetMode,
  resolveAssetMode,
} from '@/lib/dental-chart/3d/asset-mode'

/**
 * P4 / S2 — asset modes. The default MUST be `none`: the tooth meshes are
 * CC BY-SA 2.1 JP per upstream CREDITS.md while the DBCLS site says CC BY 4.0,
 * so shipping them is the user's legal decision (D1), not a build flag.
 */
describe('asset mode defaults to none', () => {
  it('the default is none', () => {
    expect(DEFAULT_ASSET_MODE).toBe('none')
    expect(parseAssetMode(undefined)).toBe('none')
  })

  it('an unknown or empty value falls back to none — never to a loading mode', () => {
    for (const v of ['', '   ', 'bogus', 'xyz', 'maybe', undefined]) {
      expect(parseAssetMode(v), `input ${JSON.stringify(v)}`).toBe('none')
    }
  })

  it('parses the three real modes, case- and space-insensitively', () => {
    expect(ASSET_MODES).toEqual(['none', 'local', 'bundled'])
    expect(parseAssetMode('none')).toBe('none')
    expect(parseAssetMode('LOCAL')).toBe('local')
    expect(parseAssetMode('  bundled  ')).toBe('bundled')
  })
})

describe('bundled is BLOCKED until decision D1 is recorded', () => {
  it('throws when the decision file is absent', () => {
    expect(() =>
      resolveAssetMode({ ASSET_MODE: 'bundled' }, { decisionFileExists: false }),
    ).toThrow(BundledAssetsBlockedError)
  })

  it('throws when the file exists but does not carry the marker', () => {
    expect(() =>
      resolveAssetMode(
        { ASSET_MODE: 'bundled' },
        { decisionFileExists: true, decisionFileContent: 'still thinking about it' },
      ),
    ).toThrow(BundledAssetsBlockedError)
  })

  it('names the decision file in the error so the user knows what to do', () => {
    try {
      resolveAssetMode({ ASSET_MODE: 'bundled' }, { decisionFileExists: false })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('3D-ASSETS-DECISION.md')
      expect((e as Error).message).toContain(D1_DECISION_MARKER)
    }
  })

  it('allows bundled only once the marker is present', () => {
    expect(
      resolveAssetMode(
        { ASSET_MODE: 'bundled' },
        { decisionFileExists: true, decisionFileContent: `decided: ${D1_DECISION_MARKER}` },
      ),
    ).toBe('bundled')
  })

  it('never blocks none or local', () => {
    expect(resolveAssetMode({ ASSET_MODE: 'local' }, { decisionFileExists: false })).toBe('local')
    expect(resolveAssetMode({}, { decisionFileExists: false })).toBe('none')
  })
})

describe('forbidden assets are refused in every mode', () => {
  it('neurovascular.glb is always forbidden', () => {
    expect(FORBIDDEN_ASSETS).toContain('neurovascular.glb')
    expect(isForbiddenAsset('neurovascular.glb')).toBe(true)
    expect(isForbiddenAsset('/a/b/neurovascular.glb')).toBe(true)
    expect(isForbiddenAsset('C:\\models\\neurovascular.glb')).toBe(true)
  })

  it('ordinary meshes are not forbidden', () => {
    expect(isForbiddenAsset('core.glb')).toBe(false)
    expect(isForbiddenAsset('teeth/tooth-11.glb')).toBe(false)
  })
})

describe('assetsEnabled', () => {
  it('is false only for none', () => {
    expect(assetsEnabled('none')).toBe(false)
    expect(assetsEnabled('local')).toBe(true)
    expect(assetsEnabled('bundled')).toBe(true)
  })
})

describe('the committed 3d-assets.manifest.json (S2)', () => {
  const manifestPath = path.resolve(__dirname, '../../3d-assets.manifest.json')

  it('exists and pins a 40-hex upstream commit', () => {
    expect(existsSync(manifestPath)).toBe(true)
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(m.upstream.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(m.upstream.sourcePath).toBe('public/models')
  })

  it('lists real files with real sizes and digests, and no forbidden asset', () => {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(m.files.length).toBeGreaterThan(0)
    for (const f of m.files) {
      expect(f.path, 'path').toBeTruthy()
      expect(f.sha256, `sha256 of ${f.path}`).toMatch(/^[0-9a-f]{64}$/)
      expect(f.bytes, `bytes of ${f.path}`).toBeGreaterThan(0)
      expect(isForbiddenAsset(f.path), `${f.path} must not be forbidden`).toBe(false)
    }
    expect(m.neverLoad).toContain('neurovascular.glb')
  })

  it('records the licence conflict honestly rather than picking a side', () => {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(m.meshLicence).toMatch(/CC BY-SA 2\.1 JP/)
    expect(m.meshLicence).toMatch(/CC BY 4\.0/)
    expect(m.meshLicence).toMatch(/UNRESOLVED/i)
  })
})

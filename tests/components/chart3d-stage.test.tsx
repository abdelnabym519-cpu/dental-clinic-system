import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { Chart3DAdapter, Chart3DStateMap, Chart3DView } from '@/lib/dental-chart/3d/types'

/**
 * P4 / step 3 — the stage must RENDER WITH NO MODEL FILE.
 *
 * `ASSET_MODE=none` is the default, so this is the path every user gets out of
 * the box. A blank viewport or an error here would be the single most likely
 * way this feature ships broken, so it is pinned by a test.
 *
 * The procedural scene is mocked: this test is about the stage's fallback
 * behaviour, not about three.js (which needs a real GPU).
 */
const mounted: Chart3DAdapter[] = []

function fakeAdapter(kind: 'scope' | 'procedural'): Chart3DAdapter {
  let listener: ((fdi: number | null) => void) | null = null
  const a: Chart3DAdapter & { __states?: Chart3DStateMap; __view?: Chart3DView } = {
    kind,
    teeth: kind === 'scope' ? [11, 12] : [11, 12, 51],
    async mount() {
      mounted.push(a)
    },
    setStates(map) {
      a.__states = map
    },
    onSelect(cb) {
      listener = cb
      return () => {
        listener = null
      }
    },
    select(fdi) {
      listener?.(fdi)
    },
    setView(v) {
      a.__view = v
    },
    reset() {
      a.__states = {}
    },
    dispose() {},
  }
  return a
}

vi.mock('@/lib/dental-chart/3d/procedural-scene', () => ({
  createProceduralScene: () => fakeAdapter('procedural'),
}))

vi.mock('@/lib/dental-chart/3d/scope-scene', () => ({
  createScopeScene: (deps?: { loadEngine?: () => Promise<unknown> }) => {
    const a = fakeAdapter('scope')
    // Emulate a real engine failure (no model files) when a failing loader is
    // injected, so the stage's fallback branch is exercised honestly.
    if (deps?.loadEngine) {
      a.mount = async () => {
        await deps.loadEngine!()
      }
    }
    return a
  },
  tintForStatus: () => null,
  opacityForStatus: () => null,
}))

// jsdom has no WebGL — make detection report "supported" so we test the
// asset-mode path rather than the webgl path.
vi.mock('@/lib/dental-chart/3d/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dental-chart/3d/types')>()
  return { ...actual, selectScene: (i: { assetMode: string; webgl: boolean }) =>
    actual.selectScene({ assetMode: i.assetMode as never, webgl: true }) }
})

import Chart3DStage from '@/components/dental-chart/interactive/Chart3DStage'

describe('Chart3DStage with NO model file (ASSET_MODE=none — the default)', () => {
  beforeEach(() => {
    mounted.length = 0
  })

  it('renders the procedural scene, not a blank viewport', async () => {
    render(<Chart3DStage statusByTooth={{ 36: 'affected' }} assetMode="none" />)
    await waitFor(() => expect(screen.getByTestId('chart3d-viewport')).toBeTruthy())
    await waitFor(() =>
      expect(screen.getByTestId('chart3d-viewport').getAttribute('data-scene')).toBe('procedural'),
    )
  })

  it('shows an ARABIC note explaining the fallback', async () => {
    render(<Chart3DStage statusByTooth={{}} assetMode="none" />)
    const note = await screen.findByTestId('chart3d-fallback-note')
    expect(note.textContent).toMatch(/[؀-ۿ]/)
    expect(note.textContent).toMatch(/المنظر الإجرائي/)
    // The note deliberately names the env var (ASSET_MODE=none) so the user
    // knows which setting to change — that token is not English prose, so it
    // is excluded before checking that no sentence slipped through.
    const withoutEnvToken = (note.textContent ?? '').replace(/ASSET_MODE=none/g, '')
    expect(withoutEnvToken).not.toMatch(/[A-Za-z]{3,}/)
  })

  it('does NOT show an error state', async () => {
    render(<Chart3DStage statusByTooth={{}} assetMode="none" />)
    await waitFor(() => expect(screen.getByTestId('chart3d-viewport')).toBeTruthy())
    expect(screen.queryByTestId('chart3d-error')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('pushes the patient statuses into the scene (11→tint)', async () => {
    render(<Chart3DStage statusByTooth={{ 11: 'planned', 36: 'affected' }} assetMode="none" />)
    await waitFor(() => expect(mounted.length).toBeGreaterThan(0))
    await waitFor(() => {
      const scene = mounted[mounted.length - 1] as Chart3DAdapter & { __states?: Chart3DStateMap }
      expect(scene.__states).toEqual({ 11: 'planned', 36: 'affected' })
    })
  })

  it('offers Arabic-only camera view labels', async () => {
    render(<Chart3DStage statusByTooth={{}} assetMode="none" />)
    await waitFor(() => expect(screen.getByText('الفك العلوي')).toBeTruthy())
    for (const label of ['الافتراضي', 'أمامي', 'الفك السفلي', 'أيمن', 'أيسر']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })
})

describe('Chart3DStage when the engine is enabled but fails to mount', () => {
  beforeEach(() => {
    mounted.length = 0
  })

  it('degrades to the procedural scene instead of erroring', async () => {
    render(
      <Chart3DStage
        statusByTooth={{}}
        assetMode="local"
        forceScopeFailure
      />,
    )
    await waitFor(() =>
      expect(screen.getByTestId('chart3d-viewport').getAttribute('data-scene')).toBe('procedural'),
    )
    const note = await screen.findByTestId('chart3d-fallback-note')
    expect(note.textContent).toMatch(/تعذّر تشغيل محرّك/)
    expect(screen.queryByTestId('chart3d-error')).toBeNull()
  })
})

describe('?perf=1 overlay', () => {
  it('is absent by default', async () => {
    render(<Chart3DStage statusByTooth={{}} assetMode="none" />)
    await waitFor(() => expect(screen.getByTestId('chart3d-viewport')).toBeTruthy())
    expect(screen.queryByTestId('chart3d-perf')).toBeNull()
  })

  it('reports the four metrics when enabled', async () => {
    render(<Chart3DStage statusByTooth={{}} assetMode="none" perf />)
    const overlay = await screen.findByTestId('chart3d-perf')
    expect(overlay.textContent).toMatch(/initial bytes/)
    expect(overlay.textContent).toMatch(/time to first frame/)
    expect(overlay.textContent).toMatch(/fps \(orbiting\)/)
    expect(overlay.textContent).toMatch(/JS heap/)
  })
})

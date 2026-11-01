/**
 * R1a route-component tests.
 *
 * These cover the behaviours R1a was accepted-as-BUILT, not DONE, for: that the
 * chart loads from the existing API, that an edit actually writes back through
 * /api/dental-chart with the mapped payload, that a failure rolls the chart back
 * and shows an Arabic error (never a false "saved"), that readOnly follows RBAC,
 * and that switching patients resets the chart.
 *
 * The vendored engine is mocked: it is an imperative, DOM-heavy library that
 * cannot run under jsdom. What we assert is the CONTRACT the host keeps with it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import React from 'react'

// ─── mocks ──────────────────────────────────────────────────────────────────

const engineCalls = {
  importStatus: vi.fn(),
  resetForPatient: vi.fn(),
  getToothStates: vi.fn(() => ({}) as Record<string, unknown>),
  onStateChange: vi.fn(() => vi.fn()),
}

vi.mock('rao-odontogram', () => ({
  OdontogramShell: (props: Record<string, unknown>) => {
    // Expose the props we care about so assertions can read them.
    return React.createElement('div', {
      'data-testid': 'odontogram-shell',
      'data-readonly': String(props.readOnly),
      'data-language': String(props.language),
      'data-show-lang-switcher': String(props.showLanguageSwitcher),
    })
  },
  importStatus: (p: unknown) => engineCalls.importStatus(p),
  resetForPatient: () => engineCalls.resetForPatient(),
  getToothStates: () => engineCalls.getToothStates(),
  onStateChange: (cb: () => void) => engineCalls.onStateChange(cb),
}))

// next/dynamic would defer the shell behind a loading state; render it
// directly. The loader here resolves to the COMPONENT itself (not a
// `{ default }` module), so unwrap whichever shape arrives.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    const Comp = React.lazy(async () => {
      const mod = (await loader()) as React.ComponentType | { default: React.ComponentType }
      const C =
        mod && typeof mod === 'object' && 'default' in mod
          ? (mod as { default: React.ComponentType }).default
          : (mod as React.ComponentType)
      return { default: C }
    })
    return (props: Record<string, unknown>) =>
      React.createElement(React.Suspense, { fallback: null }, React.createElement(Comp, props))
  },
}))

const sessionState = { role: 'DOCTOR' as string | undefined }
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: sessionState.role } } }),
}))

vi.mock('@/components/providers/language-provider', () => ({
  useLanguage: () => ({ locale: 'ar-EG', dir: 'rtl', t: (k: string) => k, setLocale: vi.fn() }),
}))

import { RaoOdontogram } from '@/components/dental-chart/v2/RaoOdontogram'
import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'

// ─── helpers ────────────────────────────────────────────────────────────────

function row(
  toothNumber: number,
  condition: string,
  extra: Partial<DentalChartEntryRecord> = {},
): DentalChartEntryRecord {
  return {
    id: `e-${toothNumber}-${condition}`,
    patientId: 'p1',
    hospitalId: 'h1',
    toothNumber,
    toothNotation: String(toothNumber),
    condition,
    severity: 'MILD',
    mesial: false,
    distal: false,
    occlusal: false,
    buccal: false,
    lingual: false,
    notes: null,
    diagnosedDate: '2026-01-01',
    ...extra,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response
}

/**
 * Fire whatever the host subscribed to the engine with.
 *
 * The host imports the engine lazily (`await import('rao-odontogram')`) and only
 * subscribes once that resolves, so the subscription lands a microtask AFTER the
 * shell renders. Wait for it rather than assuming it is already there.
 */
async function fireEngineChange() {
  await waitFor(() => expect(engineCalls.onStateChange).toHaveBeenCalled(), { timeout: 4000 })
  const cb = engineCalls.onStateChange.mock.calls.at(-1)?.[0] as (() => void) | undefined
  if (!cb) throw new Error('host never subscribed to onStateChange')
  await act(async () => {
    cb()
  })
}

beforeEach(() => {
  engineCalls.importStatus.mockClear()
  engineCalls.resetForPatient.mockClear()
  engineCalls.getToothStates.mockClear().mockReturnValue({})
  engineCalls.onStateChange.mockClear().mockReturnValue(vi.fn())
  sessionState.role = 'DOCTOR'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ─── 1. load ────────────────────────────────────────────────────────────────

describe('load', () => {
  it('loads from the existing summary API and renders the chart', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [row(11, 'CARIES', { mesial: true })] }),
    )
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/dental-chart/p1/summary', { cache: 'no-store' })
  })

  it('pushes the mapped data into the library so the chart is not empty', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [row(36, 'CARIES', { occlusal: true })] }),
    )
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(engineCalls.importStatus).toHaveBeenCalled())
    const payload = engineCalls.importStatus.mock.calls.at(-1)?.[0] as {
      teeth: Record<string, { caries?: string[] }>
    }
    // Slot 36 must carry the occlusal caries that came back from the API.
    expect(payload.teeth['36']?.caries).toEqual(['occlusal'])
  })

  it('shows an Arabic error when the summary fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('chart-error')).toBeTruthy())
    expect(screen.getByTestId('chart-error').textContent).toMatch(/تعذّر تحميل/)
  })
})

// ─── 2. edit -> POST with the mapped payload ────────────────────────────────

describe('edit persists through /api/dental-chart', () => {
  it('POSTs the mapped payload when a finding is added', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/summary')) {
        return jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] })
      }
      return jsonResponse({ id: 'new' })
    })
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    // The user charts caries on the mesial of 36 in the library.
    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    await fireEngineChange()

    await waitFor(
      () => {
        const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST')
        expect(post).toBeTruthy()
      },
      { timeout: 4000 },
    )
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST')!
    expect(post[0]).toBe('/api/dental-chart')
    const body = JSON.parse((post[1] as RequestInit).body as string)
    expect(body).toMatchObject({
      patientId: 'p1',
      toothNumber: 36,
      condition: 'CARIES',
      mesial: true,
      occlusal: false,
    })
  })

  it('debounces a burst of edits into fewer writes', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/summary')
        ? jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] })
        : jsonResponse({ id: 'new' }),
    )
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    // Five rapid notifications — one debounced write.
    for (let i = 0; i < 5; i += 1) await fireEngineChange()

    await waitFor(
      () => {
        const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST')
        expect(posts.length).toBeGreaterThan(0)
      },
      { timeout: 4000 },
    )
    // Let the debounce window fully elapse so no second write is pending.
    await new Promise((r) => setTimeout(r, 1200))
    const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST')
    expect(posts.length).toBe(1)
  })
})

// ─── 2b. removal must stay removed ─────────────────────────────────────────

describe('removal is durable', () => {
  it('does not resurrect a resolved finding when the summary returns it', async () => {
    // The summary route has NO resolvedDate filter, so a resolved row comes back
    // on every refetch. v2 must ignore it, or a removal would visibly un-remove.
    const resolvedRow = row(36, 'CARIES', { mesial: true, resolvedDate: '2026-02-01' })
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/summary')
        ? jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [resolvedRow] })
        : jsonResponse({ id: 'x' }),
    )
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(engineCalls.importStatus).toHaveBeenCalled())

    const payload = engineCalls.importStatus.mock.calls.at(-1)?.[0] as {
      teeth: Record<string, { caries?: string[] }>
    }
    // Slot 36 must be empty - the resolved caries is NOT charted.
    expect(payload.teeth['36']?.caries ?? []).toEqual([])
  })

  it('still discloses the resolved finding in the unmapped panel set', async () => {
    // "Nothing may disappear silently": a resolved SENSITIVE row is not charted,
    // but it still exists and must still be listed.
    const resolvedSensitive = row(12, 'SENSITIVE', { resolvedDate: '2026-02-01' })
    fetchMock.mockResolvedValue(
      jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [resolvedSensitive] }),
    )
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('unmapped-findings-panel')).toBeTruthy())
    expect(screen.getAllByTestId('unmapped-findings-row')).toHaveLength(1)
    // and it is labelled closed, not active
    expect(screen.getByTestId('unmapped-findings-panel').textContent).toMatch(/مغلق/)
  })
})

// ─── 2c. the debounce window must not lose a write ─────────────────────────

describe('debounce window is not a data-loss window', () => {
  function setupFetch() {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/summary')
        ? jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] })
        : jsonResponse({ id: 'new' }),
    )
  }

  it('flushes a pending write on unmount instead of dropping it', async () => {
    setupFetch()
    const { unmount } = render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    // Edit, then unmount WELL inside the 700ms debounce window.
    await fireEngineChange()
    unmount()

    await waitFor(
      () => {
        const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST')
        expect(posts.length).toBeGreaterThan(0)
      },
      { timeout: 4000 },
    )
  })

  it('warns on beforeunload while a write is pending', async () => {
    setupFetch()
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    // No pending write -> no warning.
    const clean = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    await fireEngineChange()

    const evt = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
  })

  it('stops warning once the write has landed', async () => {
    setupFetch()
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    await fireEngineChange()
    // Let the debounce elapse and the POST resolve.
    await waitFor(
      () => {
        const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST')
        expect(posts.length).toBeGreaterThan(0)
      },
      { timeout: 4000 },
    )
    await new Promise((r) => setTimeout(r, 50))

    const evt = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
  })
})

// ─── 3. failure -> rollback + Arabic error, never a false "saved" ───────────

describe('failure handling', () => {
  it('rolls the chart back and shows an Arabic error on a 500', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/summary')) {
        return jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] })
      }
      if ((init as RequestInit)?.method === 'POST') return jsonResponse({}, false, 500)
      return jsonResponse({})
    })
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    const before = engineCalls.importStatus.mock.calls.length
    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    await fireEngineChange()

    await waitFor(() => expect(screen.getByTestId('chart-error')).toBeTruthy(), { timeout: 4000 })
    const text = screen.getByTestId('chart-error').textContent ?? ''
    expect(text).toMatch(/تعذّر حفظ/)
    expect(text).toMatch(/التراجع/)
    // Rollback: the chart was re-imported from the last good snapshot.
    expect(engineCalls.importStatus.mock.calls.length).toBeGreaterThan(before)
  })

  it('shows the server 403 message verbatim when RBAC refuses', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/summary')) {
        return jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] })
      }
      if ((init as RequestInit)?.method === 'POST') return jsonResponse({}, false, 403)
      return jsonResponse({})
    })
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    await fireEngineChange()

    await waitFor(() => expect(screen.getByTestId('chart-error')).toBeTruthy(), { timeout: 4000 })
    expect(screen.getByTestId('chart-error').textContent).toMatch(/لا تملك صلاحية تعديل/)
  })

  it('never reports success after a failure', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/summary')) {
        return jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] })
      }
      if ((init as RequestInit)?.method === 'POST') return jsonResponse({}, false, 500)
      return jsonResponse({})
    })
    render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())

    engineCalls.getToothStates.mockReturnValue({
      36: { toothSelection: 'tooth-base', caries: ['mesial'], fillingSurfaces: [], mods: [] },
    })
    await fireEngineChange()
    await waitFor(() => expect(screen.getByTestId('chart-error')).toBeTruthy(), { timeout: 4000 })

    // No "saved"/success affordance anywhere.
    expect(document.body.textContent).not.toMatch(/تم الحفظ/)
    expect(screen.queryByTestId('chart-saving')).toBeNull()
  })
})

// ─── 4. readOnly from RBAC ──────────────────────────────────────────────────

describe('readOnly follows RBAC', () => {
  const cases: Array<[string, boolean]> = [
    ['DOCTOR', false],
    ['ADMIN', false],
    ['RECEPTIONIST', true],
    ['SUPER_ADMIN', true], // server gates on ADMIN|DOCTOR only
  ]

  it.each(cases)('%s -> readOnly=%s', async (role, expected) => {
    sessionState.role = role
    fetchMock.mockResolvedValue(jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] }))
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())
    expect(screen.getByTestId('odontogram-shell').getAttribute('data-readonly')).toBe(String(expected))
  })

  it('shows an Arabic read-only note for non-editing roles', async () => {
    sessionState.role = 'SUPER_ADMIN'
    fetchMock.mockResolvedValue(jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] }))
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('chart-readonly-note')).toBeTruthy())
    expect(screen.getByTestId('chart-readonly-note').textContent).toMatch(/وضع العرض فقط/)
  })

  it('shows no read-only note for DOCTOR', async () => {
    sessionState.role = 'DOCTOR'
    fetchMock.mockResolvedValue(jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] }))
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())
    expect(screen.queryByTestId('chart-readonly-note')).toBeNull()
  })

  it('does not subscribe to edits when read-only', async () => {
    sessionState.role = 'RECEPTIONIST'
    fetchMock.mockResolvedValue(jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] }))
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())
    expect(engineCalls.onStateChange).not.toHaveBeenCalled()
  })
})

// ─── 5. per-patient reset ───────────────────────────────────────────────────

describe('per-patient reset', () => {
  it('resets the library when the patient changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] }))
    const { rerender } = render(<RaoOdontogram patientId="p1" />)
    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())
    expect(engineCalls.resetForPatient).toHaveBeenCalledTimes(1)

    rerender(<RaoOdontogram patientId="p2" />)
    // resetChart() awaits the lazy engine import, so give it time to land.
    await waitFor(() => expect(engineCalls.resetForPatient).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    })
  })
})

// ─── 6. Arabic / language switcher ──────────────────────────────────────────

describe('language', () => {
  it('defaults to Arabic and hides the in-chart switcher', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ patient: { id: 'p1', name: 'A' }, entries: [] }))
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())
    const shell = screen.getByTestId('odontogram-shell')
    expect(shell.getAttribute('data-language')).toBe('ar')
    expect(shell.getAttribute('data-show-lang-switcher')).toBe('false')
  })
})

// ─── 7. unmapped findings panel ─────────────────────────────────────────────

describe('unmapped findings disclosure', () => {
  it('shows SENSITIVE rows that the 2D chart cannot draw', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        patient: { id: 'p1', name: 'A' },
        entries: [row(12, 'SENSITIVE'), row(36, 'CARIES', { mesial: true })],
      }),
    )
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('unmapped-findings-panel')).toBeTruthy())
    const rowsEls = screen.getAllByTestId('unmapped-findings-row')
    expect(rowsEls).toHaveLength(1)
    expect(rowsEls[0].getAttribute('data-tooth')).toBe('12')
    expect(rowsEls[0].getAttribute('data-condition')).toBe('SENSITIVE')
    // The panel is titled in Arabic and states facts, not a stack trace.
    expect(screen.getByTestId('unmapped-findings-panel').textContent).toMatch(
      /حالات غير معروضة في المخطط/,
    )
  })

  it('renders no panel when every finding is mappable', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        patient: { id: 'p1', name: 'A' },
        entries: [row(36, 'CARIES', { mesial: true })],
      }),
    )
    render(<RaoOdontogram patientId="p1" />)

    await waitFor(() => expect(screen.getByTestId('odontogram-shell')).toBeTruthy())
    expect(screen.queryByTestId('unmapped-findings-panel')).toBeNull()
  })
})

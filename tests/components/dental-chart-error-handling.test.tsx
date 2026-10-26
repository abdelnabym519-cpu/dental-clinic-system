// @ts-nocheck
/**
 * WP1 hardening — graceful degradation for the interactive dental chart.
 *
 * Scope note (deliberate): these tests prove the chart degrades gracefully.
 * They do NOT reproduce, explain, or fix any reported chart-load error. The
 * error boundary exists because the app previously had NO error boundary at
 * all, so a render-time throw took down the entire patient route.
 *
 * Assertions are on the ARABIC strings because defaultLocale is 'ar-EG'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DentalChartErrorBoundary } from '@/components/dental-chart/interactive/ChartErrorBoundary'
import { DentalChartWorkspace } from '@/components/dental-chart/interactive/DentalChartWorkspace'
import { LanguageProvider } from '@/components/providers/language-provider'

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const mockSession = { role: 'DOCTOR' }
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: mockSession }, status: 'authenticated' }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const AR_ERROR = 'حدث خطأ في تحميل المخطط'
const AR_RETRY = 'إعادة المحاولة'

// React logs every caught render error; silence it so the output stays readable.
let consoleErrorSpy
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  consoleErrorSpy?.mockRestore()
})

/**
 * Wrap in the REAL LanguageProvider: outside it, useLanguage() falls back to
 * the context default whose `t` resolves through the ENGLISH dictionary, so
 * assertions on the Arabic strings would fail for the wrong reason.
 */
function withLang(node: React.ReactNode) {
  return <LanguageProvider>{node}</LanguageProvider>
}

function Boom(): JSX.Element {
  throw new Error('simulated render-time failure inside the 3D subtree')
}

describe('3D error boundary (graceful degradation)', () => {
  it('shows the Arabic chart error instead of crashing when the subtree throws', () => {
    render(
      withLang(
        <DentalChartErrorBoundary>
          <Boom />
        </DentalChartErrorBoundary>
      )
    )

    const alert = screen.getByTestId('dental-chart-3d-error')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain(AR_ERROR)
    // the localized retry control is offered
    expect(alert.textContent).toContain(AR_RETRY)
  })

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn()
    render(
      withLang(
        <DentalChartErrorBoundary onRetry={onRetry}>
          <Boom />
        </DentalChartErrorBoundary>
      )
    )

    fireEvent.click(screen.getByTestId('dental-chart-3d-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders children normally when nothing throws', () => {
    render(
      withLang(
        <DentalChartErrorBoundary>
          <div data-testid="child-ok">ok</div>
        </DentalChartErrorBoundary>
      )
    )
    expect(screen.getByTestId('child-ok')).toBeTruthy()
    expect(screen.queryByTestId('dental-chart-3d-error')).toBeNull()
  })
})

describe('workspace fetch error — retry is wired', () => {
  it('shows the Arabic error and refetches when retry is clicked', async () => {
    // first call: hard failure (network/500) -> error state
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    // second call (after retry): success
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        patient: { id: 'patient-1', name: 'أحمد محمد' },
        entries: [],
        procedures: [],
        imaging: [],
        activePlan: null,
        catalog: [],
        statusByTooth: {},
      }),
    })

    render(withLang(<DentalChartWorkspace patientId="patient-1" />))

    await waitFor(() => expect(screen.getByTestId('dental-chart-error')).toBeTruthy())
    const errorBox = screen.getByTestId('dental-chart-error')
    expect(errorBox.textContent).toContain(AR_ERROR)

    const callsBefore = fetchMock.mock.calls.length
    fireEvent.click(screen.getByTestId('dental-chart-error-retry'))

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore))
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1)
  })
})

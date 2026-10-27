'use client'

import React from 'react'
import { useLanguage } from '@/components/providers/language-provider'
import { Button } from '@/components/ui/button'

/**
 * Graceful degradation for the 3D dental-chart subtree — WP1 hardening.
 *
 * IMPORTANT / scope note: this is NOT a diagnosis of, or a fix for, any
 * reported chart-load failure. A render-time throw inside the R3F/three
 * subtree currently propagates to the page and takes down the whole patient
 * route, because the app has no error boundary anywhere. This component
 * contains that failure so the user sees the SAME localized message already
 * used for a failed summary fetch, plus a retry — instead of a blank page.
 *
 * Graceful degradation only; it deliberately makes no claim about the cause.
 */

interface BoundaryProps {
  children: React.ReactNode
  message: string
  retryLabel: string
  onRetry?: () => void
}

interface BoundaryState {
  failed: boolean
}

class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // Logged for diagnostics; never surfaced to the user (no raw stack traces).
    console.error('[dental-chart] 3D subtree failed to render', error)
  }

  private handleRetry = () => {
    this.setState({ failed: false })
    this.props.onRetry?.()
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          data-testid="dental-chart-3d-error"
          className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center text-sm"
        >
          <p className="font-semibold">{this.props.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={this.handleRetry}
            data-testid="dental-chart-3d-retry"
          >
            {this.props.retryLabel}
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Localized wrapper: the boundary itself is a class (so it can catch render
 * errors), but the strings come from the language provider hook.
 */
export function DentalChartErrorBoundary({
  children,
  onRetry,
}: {
  children: React.ReactNode
  onRetry?: () => void
}) {
  const { t } = useLanguage()
  return (
    <Boundary message={t('dental_chart.error')} retryLabel={t('common.retry')} onRetry={onRetry}>
      {children}
    </Boundary>
  )
}

export { Boundary as ChartErrorBoundaryClass }

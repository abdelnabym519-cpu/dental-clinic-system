// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// The public payment page renders whatever the API puts in `error` straight into an
// error slot, so a server sentence is user-facing copy. This renders the real page
// component, clicks the real pay button, and answers with the real API contract
// (404 + {"error":"Invalid payment link"}), then asserts the painted text per locale.
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))
vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  return new Proxy(actual, { get: (_: any, p: string) => actual[p] || icon(p) })
})

import { LanguageProvider } from '@/components/providers/language-provider'
import { PayPage } from '@/app/pay/[token]/pay-page'

const PROPS = {
  token: 'BADTOKEN123',
  currency: 'EGP',
  hospital: { name: 'ابتسم dental', logo: null, phone: '01000000000', email: 'a@b.c', address: 'الزقازيق', city: 'الشرقية', state: 'مصر' },
  invoice: { id: '1', invoiceNo: 'INV-2026-001', totalAmount: 500, paidAmount: 0, balanceAmount: 500 },
  patient: { name: 'مريض تجريبي', phone: '01012345678' },
  amount: 500,
  isExpired: false,
  isUsed: false,
  isPaid: false,
}

function installFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => ({
    ok: false,
    status,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('public pay page renders the API message through the dictionary', () => {
  beforeEach(() => {
    // @ts-expect-error - Next's client hook is not needed by this component's render path
    vi.stubGlobal('nextNavigation', {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('paints the Arabic wording for a dead link in ar-EG', async () => {
    const fetchSpy = installFetch(404, { error: 'Invalid payment link' })
    render(
      <LanguageProvider initialLocale="ar-EG">
        <PayPage {...PROPS} locale="ar-EG" />
      </LanguageProvider>
    )
    const btn = screen.getAllByRole('button').find((b) => /دفع|Pay/.test(b.textContent || ''))
    expect(btn).toBeTruthy()
    fireEvent.click(btn!)
    await waitFor(() => expect(screen.getByText('رابط الدفع غير صالح')).toBeTruthy())
    // the request the page actually makes, and the string it forwards to the slot
    expect(fetchSpy).toHaveBeenCalled()
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).token).toBe('BADTOKEN123')
  })

  it('keeps the server sentence verbatim in en-EG', async () => {
    installFetch(404, { error: 'Invalid payment link' })
    render(
      <LanguageProvider initialLocale="en-EG">
        <PayPage {...PROPS} locale="en-EG" />
      </LanguageProvider>
    )
    const btn = screen.getAllByRole('button').find((b) => /Pay/.test(b.textContent || ''))
    fireEvent.click(btn!)
    await waitFor(() => expect(screen.getByText('Invalid payment link')).toBeTruthy())
  })

  it('also translates the expired-link reply', async () => {
    installFetch(400, { error: 'This payment link has expired' })
    render(
      <LanguageProvider initialLocale="ar-EG">
        <PayPage {...PROPS} locale="ar-EG" />
      </LanguageProvider>
    )
    const btn = screen.getAllByRole('button').find((b) => /دفع|Pay/.test(b.textContent || ''))
    fireEvent.click(btn!)
    await waitFor(() => expect(screen.getByText('انتهت صلاحية رابط الدفع هذا')).toBeTruthy())
  })
})

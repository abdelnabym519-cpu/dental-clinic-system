// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// ConfirmDialog is the shared yes/no surface for destructive actions. Call sites
// hand it plain strings, so the dialog itself is the only place that can localize
// them - the same way the toast viewport does. This test renders the real component
// with the real dictionary to prove the Arabic paint, because a headless route sweep
// can never open a dialog that needs a database row.
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

function renderDialog(locale: string, props: Record<string, unknown> = {}) {
  return render(
    <LanguageProvider initialLocale={locale}>
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        title="Deactivate Medication"
        description={"Your synced events won't be removed from Google."}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        {...props}
      />
    </LanguageProvider>
  )
}

describe('ConfirmDialog localization', () => {
  it('paints the title, description and both buttons in Arabic', () => {
    renderDialog('ar-EG')
    expect(screen.getByText('إيقاف الدواء')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'تعطيل' })).toBeTruthy()
    expect(screen.getByText('لن تُحذف أحداثك المتزامنة من Google.')).toBeTruthy()
    // Google stays Latin on purpose: it is a brand name inside an Arabic sentence
  })

  it('keeps the English rendering byte-identical for English locales', () => {
    renderDialog('en-EG')
    expect(screen.getByText('Deactivate Medication')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByText("Your synced events won't be removed from Google.")).toBeTruthy()
  })

  it('translates the default action labels when a call site omits them', () => {
    renderDialog('ar-EG', { confirmLabel: undefined, cancelLabel: undefined })
    expect(screen.getByRole('button', { name: 'تأكيد' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeTruthy()
  })

  it('paints the "Yes, proceed" label the two real call sites hand it', () => {
    // app/(dashboard)/settings/integrations/page.tsx and app/(dashboard)/billing/
    // payment-plans/[id]/page.tsx both pass `confirmLabel: 'Yes, proceed'`. The call site
    // cannot fix this - it is the dialog that localizes its four string slots - so the
    // proof has to be a render, and the fix has to be a dictionary key.
    renderDialog('ar-EG', {
      title: 'Waive installment?',
      description: "Waive this installment? The patient won't need to pay it.",
      confirmLabel: 'Yes, proceed',
    })
    expect(screen.getByRole('button', { name: 'نعم، متابعة' })).toBeTruthy()
    expect(screen.getByText('إعفاء القسط؟')).toBeTruthy()
    renderDialog('en-EG', { confirmLabel: 'Yes, proceed' })
    expect(screen.getByRole('button', { name: 'Yes, proceed' })).toBeTruthy()
  })

  it('still passes through a node (not a string) without mangling it', () => {
    renderDialog('ar-EG', { title: <span data-testid="node-title">عنوان</span> })
    expect(screen.getByTestId('node-title')).toBeTruthy()
  })

  it('keeps the confirm callback wired', async () => {
    let confirmed = false
    renderDialog('ar-EG', { onConfirm: () => (confirmed = true) })
    fireEvent.click(screen.getByRole('button', { name: 'تعطيل' }))
    await waitFor(() => expect(confirmed).toBe(true))
  })
})

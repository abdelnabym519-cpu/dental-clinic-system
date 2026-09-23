// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// `submitLabel` is handed straight to the DOM by FormRenderer - no shared dialog or toast
// viewport localizes it on the way out - so a route sweep in Arabic mode says nothing about
// it, and a source grep is not proof of a paint. This renders the real component against the
// real dictionary and asserts the text that actually reaches the button.
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

vi.mock('@/components/forms/signature-pad', () => ({ SignaturePad: () => null }))

import { LanguageProvider } from '@/components/providers/language-provider'
import { FormRenderer } from '@/components/forms/form-renderer'

const FIELDS = [{ id: 'reason', label: 'Reason for visit', type: 'text', required: true }]

function renderForm(locale: string, props: Record<string, unknown> = {}) {
  return render(
    <LanguageProvider initialLocale={locale}>
      <FormRenderer fields={FIELDS} onSubmit={() => {}} showSignature={false} {...props} />
    </LanguageProvider>
  )
}

describe('FormRenderer submit label', () => {
  it('paints the component default in Arabic when a call site omits it', () => {
    renderForm('ar-EG')
    expect(screen.getByRole('button', { name: 'إرسال النموذج' })).toBeTruthy()
  })

  it('paints the preview label the two settings pages pass, and leaves English alone', () => {
    renderForm('ar-EG', { submitLabel: 'Submit (Preview)' })
    expect(screen.getByRole('button', { name: 'إرسال (معاينة)' })).toBeTruthy()
    renderForm('en-EG', { submitLabel: 'Submit (Preview)' })
    expect(screen.getByRole('button', { name: 'Submit (Preview)' })).toBeTruthy()
  })

  it('does not mangle a label the dictionary does not know', () => {
    renderForm('ar-EG', { submitLabel: 'Send to front desk' })
    expect(screen.getByRole('button', { name: 'Send to front desk' })).toBeTruthy()
  })
})

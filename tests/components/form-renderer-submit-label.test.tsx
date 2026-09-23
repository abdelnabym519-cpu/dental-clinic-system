// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

/** the shipped suite submits the form element, not the button: jsdom's implicit
 *  submit-on-click is unreliable here, and a silent no-submit is how a validation
 *  test ends up asserting nothing at all */
function submitForm(name: string) {
  const form = screen.getByText(name).closest('form')!
  fireEvent.submit(form)
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
describe('FormRenderer validation copy', () => {
  // These messages are produced by an assignment (`newErrors[field.id] = …`) and painted through
  // `{error}` raw, so a dictionary entry cannot rescue them - the producer itself has to call t().
  // The English assertions matter as much as the Arabic ones: the fix had to leave en rendering
  // byte-identical, and these are the strings the pre-existing form-validation suite already checks.
  const TEXT = { id: 'name', label: 'Full name', type: 'text', required: true, validation: { minLength: 3 } }
  const NUM = { id: 'score', label: 'Score', type: 'number', required: true, validation: { min: 0, max: 100 } }

  it('paints the min-length message in Arabic', () => {
    renderForm('ar-EG', { fields: [TEXT] })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ab' } })
    submitForm('إرسال النموذج')
    expect(screen.getByText('الحد الأدنى 3 حرفًا')).toBeTruthy()
  })

  it('paints the numeric upper bound in Arabic', () => {
    renderForm('ar-EG', { fields: [NUM] })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '200' } })
    submitForm('إرسال النموذج')
    expect(screen.getByText('الحد الأقصى للقيمة هو 100')).toBeTruthy()
  })

  it('paints the numeric lower bound in Arabic', () => {
    renderForm('ar-EG', { fields: [NUM] })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-5' } })
    submitForm('إرسال النموذج')
    expect(screen.getByText('الحد الأدنى للقيمة هو 0')).toBeTruthy()
  })

  it('renders the same min-length message in English, byte-identical to before the fix', () => {
    renderForm('en-EG', { fields: [TEXT] })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ab' } })
    submitForm('Submit Form')
    expect(screen.getByText('Minimum 3 characters')).toBeTruthy()
  })

  it('renders the same numeric message in English, byte-identical to before the fix', () => {
    renderForm('en-EG', { fields: [NUM] })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '200' } })
    submitForm('Submit Form')
    expect(screen.getByText('Maximum value is 100')).toBeTruthy()
  })
})

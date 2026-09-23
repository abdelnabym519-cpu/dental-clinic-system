// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// AppointmentDialog layout regression tests (create-appointment modal).
//
// Regression being pinned: the dialog once grew unbounded — the fixed,
// center-anchored Radix content had no max-height and no scroll region, so a
// tall form pushed the footer (Book/Cancel) below the bottom of the viewport,
// unreachable without page scrolling (which a position:fixed portal ignores).
//
// The fixed architecture is:  Dialog (viewport-bounded) -> Header (fixed)
// -> Scrollable fields -> Footer (fixed). jsdom cannot compute real CSS
// layout, so these tests pin the structure and the exact utility classes that
// implement it (real cn/tailwind-merge output included) — the closest honest
// approximation available in this repo's unit environment.
// ---------------------------------------------------------------------------

// Real-dictionary language provider mock (repo convention): t() resolves
// through the actual locales/en.json.
vi.mock('@/components/providers/language-provider', async () => {
  const en = (await import('../../locales/en.json')).default
  return {
    useLanguage: () => ({
      locale: 'en-EG',
      dir: 'ltr',
      t: (key: string, vars?: Record<string, string | number>) => {
        let template: string = en[key] ?? key
        if (vars)
          template = template.replace(/\{(\w+)\}/g, (m, name) =>
            name in vars ? String(vars[name]) : m
          )
        return template
      },
      setLocale: vi.fn(),
    }),
    LOCALE_COOKIE: 'dentora-locale',
  }
})

vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  const handler = { get: (_: any, p: string) => actual[p] || icon(p) }
  return new Proxy(actual, handler)
})

// UI primitives mocked thin — BUT class-carrying containers pass their props
// through, so the real layout classes rendered by AppointmentDialog and
// components/ui/dialog.tsx reach the DOM. NOTE: cn is intentionally NOT
// mocked, so assertions see the genuine tailwind-merge result (e.g. the
// flex/overflow-hidden overrides of the base grid/overflow-y-auto).
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange }) : child
      )}
    </div>
  ),
  SelectTrigger: (props: any) => (
    <div {...props} data-testid="select-trigger">
      {props.children}
    </div>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange }) : child
      )}
    </div>
  ),
  SelectItem: ({ children, value, onValueChange }: any) => (
    <div data-testid={`select-item-${value}`} onClick={() => onValueChange?.(value)}>
      {children}
    </div>
  ),
}))

import { AppointmentDialog } from '@/components/agenda/appointment-dialog'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const patients = [
  { id: 'pat-1', patientId: 'P0001', firstName: 'John', lastName: 'Doe' },
  { id: 'pat-2', patientId: 'P0002', firstName: 'Jane', lastName: 'Roe' },
]
const doctors = [
  { id: 'doc-1', firstName: 'Arun', lastName: 'Vijay', specialization: 'Prosthodontics' },
  { id: 'doc-2', firstName: 'Mariam', lastName: 'Ibrahim', specialization: null },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock = vi.fn()
  global.fetch = fetchMock
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'apt-1' }) })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderDialog(props: Record<string, unknown> = {}) {
  return render(
    <AppointmentDialog
      open
      onClose={() => {}}
      onSaved={() => {}}
      patients={patients}
      doctors={doctors}
      {...props}
    />
  )
}

/** The single scrollable fields region inside the dialog. */
function getScrollRegion(dialog: HTMLElement) {
  const regions = Array.from(dialog.querySelectorAll('.overflow-y-auto'))
  return regions
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppointmentDialog — viewport-bounded dialog shell', () => {
  it('is a fixed, viewport-bounded flex column (never taller than the screen)', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')

    // fixed + centered (Radix) so page scrolling can never move it...
    expect(dialog).toHaveClass('fixed')
    // ...and the genuine cn/tailwind-merge result bounds it to the viewport:
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]')
    // The column layout override of the base `grid` must actually win the merge:
    expect(dialog).toHaveClass('flex', 'flex-col')
    expect(dialog).not.toHaveClass('grid')
    // The dialog itself must not be the scroll region (inner region is):
    expect(dialog).toHaveClass('overflow-hidden')
    expect(dialog).not.toHaveClass('overflow-y-auto')
  })
})

describe('AppointmentDialog — every field survives the layout fix', () => {
  it('keeps all form fields inside the dialog', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')

    // Selects (ids live on the triggers), inputs, checkbox, textarea.
    const fieldIds = [
      'apt-patient',
      'apt-doctor',
      'apt-date',
      'apt-time',
      'apt-duration',
      'apt-type',
      'apt-priority',
      'apt-complaint',
      'apt-contact-phone',
      'apt-notes',
      'apt-recurrence',
    ]
    for (const id of fieldIds) {
      expect(dialog.querySelector(`#${id}`), `field #${id} missing`).toBeTruthy()
    }
  })
})

describe('AppointmentDialog — Header / Scrollable content / Footer structure', () => {
  it('keeps the header and the actions footer OUTSIDE the scrollable fields region', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')

    // Exactly one scroll region, and it is the fields region.
    const regions = getScrollRegion(dialog)
    expect(regions).toHaveLength(1)
    const scrollRegion = regions[0]
    expect(scrollRegion).toHaveClass('flex-1', 'min-h-0')
    expect(scrollRegion.contains(document.getElementById('apt-patient'))).toBe(true)
    expect(scrollRegion.contains(document.getElementById('apt-notes'))).toBe(true)

    // Header: the dialog title's container — fixed (never scrolls away).
    const heading = screen.getByRole('heading', { name: 'New appointment' })
    const header = heading.parentElement
    expect(header).not.toBe(null)
    expect(header).toHaveClass('shrink-0')
    expect(scrollRegion.contains(header)).toBe(false)

    // Footer: the actions container — fixed (always visible).
    const book = screen.getByText('Book appointment')
    const cancel = screen.getByText('Cancel')
    const footer = book.parentElement
    expect(footer).not.toBe(null)
    expect(footer).toBe(cancel.parentElement)
    expect(footer).toHaveClass('shrink-0')
    expect(scrollRegion.contains(footer)).toBe(false)
    // Direct child of the dialog content: Dialog -> Header -> Content -> Footer.
    expect(footer.parentElement).toBe(dialog)
    expect(header.parentElement).toBe(dialog)
  })

  it('Create/Confirm and Cancel are always rendered, enabled and outside the scroll', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')

    const book = screen.getByText('Book appointment')
    const cancel = screen.getByText('Cancel')
    expect(book).toHaveProperty('disabled', false)
    expect(cancel).toHaveProperty('disabled', false)
    // Both live in the fixed footer (see structure test), so reaching them
    // never requires scrolling the document — the dialog is position:fixed
    // and only the fields region scrolls.
    expect(dialog.contains(book)).toBe(true)
    expect(dialog.contains(cancel)).toBe(true)
    const scrollRegion = getScrollRegion(dialog)[0]
    expect(scrollRegion.contains(book)).toBe(false)
    expect(scrollRegion.contains(cancel)).toBe(false)
  })
})

describe('AppointmentDialog — responsive behavior (class-level pin)', () => {
  it('keeps the responsive footer (stacked on small screens, row on sm+) and width cap', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    const footer = screen.getByText('Book appointment').parentElement

    // Base DialogFooter pattern: columns (stacked, both buttons visible) on
    // small viewports, right-aligned row on >=sm.
    expect(footer).toHaveClass('flex-col-reverse', 'sm:flex-row')
    // Dialog width: full width on small screens, capped on larger ones.
    expect(dialog).toHaveClass('w-full', 'sm:max-w-[520px]')
  })
})

describe('AppointmentDialog — behavior through the always-visible footer', () => {
  it('books an appointment via the footer action (POST /api/appointments)', async () => {
    renderDialog()

    fireEvent.click(screen.getByTestId('select-item-pat-1'))
    fireEvent.click(screen.getByTestId('select-item-doc-1'))
    fireEvent.click(screen.getByText('Book appointment'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/appointments' && init?.method === 'POST'
      )
      expect(post).toBeDefined()
      expect(JSON.parse(post![1].body)).toMatchObject({ patientId: 'pat-1', doctorId: 'doc-1' })
    })
  })

  it('edit mode keeps the same bounded structure with a visible Save action', () => {
    renderDialog({
      appointment: {
        id: 'apt-1',
        patientId: 'pat-1',
        doctorId: 'doc-1',
        scheduledDate: '2027-03-10',
        scheduledTime: '09:00',
        duration: 30,
      },
    })
    const dialog = screen.getByRole('dialog')

    const save = screen.getByText('Save changes')
    expect(save).toHaveProperty('disabled', false)

    const regions = getScrollRegion(dialog)
    expect(regions).toHaveLength(1)
    expect(regions[0].contains(save)).toBe(false)
    expect(save.parentElement).toHaveClass('shrink-0')
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]', 'flex', 'flex-col', 'overflow-hidden')
  })
})

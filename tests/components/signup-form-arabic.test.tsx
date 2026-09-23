// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn()
const mockToast = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/signup',
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  const handler = { get: (_: any, p: string) => actual[p] || icon(p) }
  return new Proxy(actual, handler)
})

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import SignupPage from '@/app/(auth)/signup/page'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillForm(overrides: Record<string, string> = {}) {
  const defaults = {
    hospitalName: 'Test Dental Clinic',
    adminName: 'Dr. Test Admin',
    email: 'admin@test.com',
    phone: '01012345678',
    password: 'password123',
    confirmPassword: 'password123',
  }
  const values = { ...defaults, ...overrides }

  Object.entries(values).forEach(([id, value]) => {
    const input =
      screen.getByPlaceholderText(getPlaceholder(id)) || screen.getByLabelText(new RegExp(id, 'i'))
    fireEvent.change(input, { target: { value } })
  })
}

function getPlaceholder(field: string): string {
  const map: Record<string, string> = {
    hospitalName: "Dr. Smith's Dental Clinic",
    adminName: 'Dr. John Smith',
    email: 'doctor@clinic.com',
    phone: '01012345678',
    password: 'At least 8 characters',
    confirmPassword: 'Confirm your password',
  }
  return map[field] || ''
}

// ---------------------------------------------------------------------------
// Tests — the same form in Arabic mode (rev 12)
//
// The English suite above proves the messages are correct; this proves the *render site*
// translates them. `errors.hospitalName.message` comes from a zod schema declared at module
// scope, where there is no `t` to call, so the only place the translation can happen is
// `{t(errors.x.message)}` in the page. Until rev 12 that line rendered the raw schema string,
// so every validation error on signup, login, invite acceptance and onboarding was English in
// an Arabic UI — on the first screens a user ever sees.
// ---------------------------------------------------------------------------

import { LanguageProvider } from '@/components/providers/language-provider'

describe('SignupPage validation copy in Arabic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any) = vi.fn()
  })

  function renderArabic() {
    return render(
      <LanguageProvider initialLocale="ar-EG">
        <SignupPage />
      </LanguageProvider>
    )
  }

  function submit(container: HTMLElement) {
    const button = container.querySelector('button[type="submit"]') ?? screen.getByRole('button')
    fireEvent.click(button as Element)
  }

  it('paints the short hospital-name error in Arabic', async () => {
    const { container } = renderArabic()
    const input = container.querySelector('input[name="hospitalName"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'A' } })
    submit(container)
    await waitFor(() => {
      expect(screen.getByText('يجب أن يتكون اسم المستشفى من حرفين على الأقل')).toBeInTheDocument()
    })
  })

  // the email-format message is asserted in tests/unit/i18n-pass3-surfaces.test.tsx
  // (dictionary-level); rendering it here needs a blur as well as a change, which the shared
  // page harness does not model, so it is deliberately not duplicated as a flaky test.

  it('paints the password-length error in Arabic, digits and all', async () => {
    const { container } = renderArabic()
    const input = container.querySelector('input[name="password"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'short' } })
    submit(container)
    await waitFor(() => {
      expect(screen.getByText('يجب أن تتضمن كلمة المرور ٨ أحرف على الأقل')).toBeInTheDocument()
    })
  })

  it('never renders a dictionary key or an empty string in the error slot', async () => {
    const { container } = renderArabic()
    submit(container)
    await waitFor(() => {
      const errors = [...container.querySelectorAll('p.text-destructive, p[class*="destructive"]')]
      expect(errors.length).toBeGreaterThan(0)
      for (const el of errors) {
        const text = el.textContent ?? ''
        expect(text).not.toBe('')
        expect(text).not.toMatch(/^errors\./)
        expect(text).not.toMatch(/\{[a-zA-Z0-9_]+\}/) // an unresolved {placeholder}
        expect(text).toMatch(/[\u0600-\u06FF]/)
      }
    })
  })
})

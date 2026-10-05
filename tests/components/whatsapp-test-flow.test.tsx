// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Issue 3 — WhatsApp/SMS test flow on the communications settings page:
//   1. the test phone starts from the CANONICAL saved clinic phone
//      (GET /api/settings/clinic → data.phone), still editable;
//   2. a missing number produces an Arabic toast (never English);
//   3. a failed test shows the server's safe Arabic category message —
//      raw provider/stack output can never be rendered.
// ---------------------------------------------------------------------------

const toastSpy = vi.fn()
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/settings/communications',
}))

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, onClick, ...props }: any) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-testid={`select-item-${value}`}>{children}</div>,
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  TabsContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked || false}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: (props: any) => <hr {...props} />,
}))

vi.mock('@/components/communications/message-log-panel', () => ({
  MessageLogPanel: () => <div data-testid="message-log-stub" />,
}))

import { LanguageProvider } from '@/components/providers/language-provider'
import CommunicationSettingsPage from '@/app/(dashboard)/settings/communications/page'

function mount(ui: React.ReactNode) {
  return render(<LanguageProvider initialLocale="ar-EG">{ui}</LanguageProvider>)
}

function installFetch(overrides: Record<string, any> = {}) {
  return vi.fn((url: string, init?: any) => {
    if (url === '/api/settings/clinic' && overrides.clinicPhone !== undefined) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { phone: overrides.clinicPhone } }),
      })
    }
    if (url === '/api/settings/communications' && (!init || !init.method)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ sms: null, email: null, reviews: null }) })
    }
    if (url === '/api/settings/communications/test' && overrides.testResponse) {
      return Promise.resolve(overrides.testResponse)
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

describe('WhatsApp/SMS test flow — Issue 3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preloads the test phone with the canonical saved clinic phone (still editable)', async () => {
    ;(global.fetch as any) = installFetch({ clinicPhone: '0222345678' })
    await act(async () => {
      mount(<CommunicationSettingsPage />)
    })
    const phoneInput = await waitFor(() => {
      const el = document.getElementById('test-phone') as HTMLInputElement
      expect(el).toBeTruthy()
      return el
    })
    await waitFor(() => {
      expect(phoneInput.value).toBe('0222345678')
    })
  })

  it('a missing number produces an Arabic toast — never English', async () => {
    ;(global.fetch as any) = installFetch({ clinicPhone: '' })
    await act(async () => {
      mount(<CommunicationSettingsPage />)
    })
    await waitFor(() => {
      expect(document.getElementById('test-phone')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('إرسال رسالة SMS تجريبية'))
    await waitFor(() => {
      const last = toastSpy.mock.calls.at(-1)[0]
      expect(last.description).toContain('يرجى إدخال رقم هاتف للاختبار')
      expect(last.description).toMatch(/[\u0600-\u06FF]/)
    })
  })

  it('a failed test renders the safe Arabic server message — never raw provider output', async () => {
    ;(global.fetch as any) = installFetch({
      clinicPhone: '01012345678',
      testResponse: {
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            success: false,
            error: 'إعدادات واتساب غير مكتملة أو غير متاحة حاليًا.',
          }),
      },
    })
    await act(async () => {
      mount(<CommunicationSettingsPage />)
    })
    await waitFor(() => {
      expect(document.getElementById('test-phone')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('إرسال رسالة SMS تجريبية'))
    await waitFor(() => {
      const last = toastSpy.mock.calls.at(-1)[0]
      expect(last.description).toContain('إعدادات واتساب غير مكتملة')
      // the raw provider payload (Twilio/HTTP codes/stack lines) can never render
      expect(last.description).not.toMatch(/Twilio|HTTP \d|at \w+ \(|node_modules/)
    })
  })
})

// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Message log panel (3L): masked numbers, status rendering, admin actions.
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

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}))

import { MessageLogPanel } from '@/components/communications/message-log-panel'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as any
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MessageLogPanel (3L)', () => {
  it('renders masked recipients, statuses and actions without exposing full numbers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 2,
        rows: [
          {
            id: 'mq-1',
            recipientMasked: '+2010****5678',
            channel: 'WHATSAPP',
            provider: 'mock-whatsapp',
            messageType: 'APPOINTMENT_CONFIRMATION',
            status: 'SENT',
            scheduledAt: '2026-09-19T10:00:00.000Z',
            sentAt: '2026-09-19T10:00:05.000Z',
            attempts: 1,
            lastError: null,
            textPreview: 'مرحباً أحمد 👋 تم تأكيد موعدك',
            hasAttachment: false,
          },
          {
            id: 'mq-2',
            recipientMasked: '+2011****5432',
            channel: 'SMS',
            provider: 'mock-sms',
            messageType: 'APPOINTMENT_REMINDER_24H',
            status: 'FAILED',
            scheduledAt: '2026-09-19T08:00:00.000Z',
            sentAt: null,
            attempts: 3,
            lastError: 'sms gateway down',
            textPreview: 'تذكير بموعدك 🔔',
            hasAttachment: true,
          },
        ],
      }),
    })

    render(<MessageLogPanel />)

    await waitFor(() => expect(screen.getByTestId('message-log-table')).toBeTruthy())
    expect(screen.getByText('+2010****5678')).toBeTruthy()
    expect(screen.getByText('+2011****5432')).toBeTruthy()
    expect(screen.getByText('SENT')).toBeTruthy()
    expect(screen.getByText('FAILED')).toBeTruthy()
    expect(screen.getByText('sms gateway down')).toBeTruthy()
    expect(screen.getByText('تأكيد موعد')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy() // action for the FAILED row
    expect(screen.getByText('2 messages')).toBeTruthy()
  })

  it('retry action PATCHes the message and reloads the log', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') {
        expect(url).toBe('/api/communications/messages/mq-2')
        return { ok: true, json: async () => ({ success: true }) }
      }
      return {
        ok: true,
        json: async () => ({
          total: 1,
          rows: [
            {
              id: 'mq-2',
              recipientMasked: '+2011****5432',
              channel: 'SMS',
              provider: null,
              messageType: 'APPOINTMENT_REMINDER_24H',
              status: 'FAILED',
              scheduledAt: '2026-09-19T08:00:00.000Z',
              sentAt: null,
              attempts: 3,
              lastError: 'sms gateway down',
              textPreview: 'تذكير',
              hasAttachment: false,
            },
          ],
        }),
      }
    })

    render(<MessageLogPanel />)
    const retry = await screen.findByText('Retry')
    fireEvent.click(retry)
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch[1].body)).toEqual({ action: 'retry' })
    })
  })

  it('shows an inline error when the log cannot load (RBAC denial surface)', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Unauthorized' }) })
    render(<MessageLogPanel />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Failed to load/))
  })
})

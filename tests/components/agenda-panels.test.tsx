// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Agenda Phase-2 operations panel: today's queue (check-in/start/complete),
// the waiting list (promote → real booking) and month analytics.
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  const handler = { get: (_: any, p: string) => actual[p] || icon(p) }
  return new Proxy(actual, handler)
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: any) => <div data-testid="card-title">{children}</div>,
  CardDescription: ({ children }: any) => <div data-testid="card-description">{children}</div>,
  CardContent: ({ children }: any) => <div data-testid="card-content">{children}</div>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children }: any) => <div role="tab">{children}</div>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

import { AgendaOperationsPanel } from '@/components/agenda/agenda-panels'

const adminCapabilities = {
  canCheckIn: true,
  canAdvance: true,
  canWaitlist: true,
  canViewAnalytics: true,
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as any
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AgendaOperationsPanel — today queue', () => {
  it('lists today’s active appointments in time order and checks a patient in via PUT', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/appointments?')) {
        return {
          ok: true,
          json: async () => ({
            appointments: [
              {
                id: 'apt-2',
                appointmentNo: 'APT1',
                scheduledTime: '11:00',
                duration: 30,
                status: 'CONFIRMED',
                patient: { firstName: 'Late', lastName: 'Arrival' },
                doctor: { firstName: 'Dr', lastName: 'Who' },
              },
              {
                id: 'apt-1',
                appointmentNo: 'APT2',
                scheduledTime: '09:00',
                duration: 30,
                status: 'SCHEDULED',
                patient: { firstName: 'First', lastName: 'Case' },
                doctor: { firstName: 'Dr', lastName: 'Who' },
              },
              {
                id: 'apt-3',
                appointmentNo: 'APT3',
                scheduledTime: '08:00',
                duration: 30,
                status: 'CANCELLED',
                patient: { firstName: 'Gone', lastName: 'Away' },
                doctor: { firstName: 'Dr', lastName: 'Who' },
              },
            ],
          }),
        }
      }
      if (typeof url === 'string' && url.includes('/api/appointments/analytics')) {
        return {
          ok: true,
          json: async () => ({
            total: 0, completed: 0, cancelled: 0, noShow: 0, upcoming: 0,
            completedRate: 0, cancellationRate: 0, noShowRate: 0, bookedMinutes: 0,
            clinic: { occupancyPercent: 0, availablePercent: 100, capacityMinutes: 0 },
            doctorUtilization: [], period: { from: '', to: '', days: 30 },
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<AgendaOperationsPanel capabilities={adminCapabilities} refreshKey={0} onChanged={vi.fn()} onOpenAppointment={vi.fn()} />)

    // Cancelled appointments never appear in the queue; order is by time.
    await waitFor(() => expect(screen.getByText('First Case')).toBeTruthy())
    expect(screen.queryByText('Gone Away')).toBeNull()
    const items = screen.getByTestId('today-queue').querySelectorAll('li')
    expect(items[0].textContent).toContain('First Case')
    expect(items[1].textContent).toContain('Late Arrival')

    const checkIn = screen.getByRole('button', { name: /check in First Case/i })
    fireEvent.click(checkIn)
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/appointments/apt-1' && c[1]?.method === 'PUT'
      )
      expect(put).toBeTruthy()
      expect(JSON.parse(put[1].body)).toEqual({ status: 'CHECKED_IN' })
    })
  })

  it('hides itself entirely for roles with no operations rights', () => {
    render(
      <AgendaOperationsPanel
        capabilities={{ canCheckIn: false, canAdvance: false, canWaitlist: false, canViewAnalytics: false }}
        refreshKey={0}
        onChanged={vi.fn()}
        onOpenAppointment={vi.fn()}
      />
    )
    expect(screen.queryByTestId('card')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AgendaOperationsPanel — waiting list', () => {
  it('promotes an ACTIVE entry through the promote endpoint and refreshes', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('/api/appointments/waitlist/') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ status: 'BOOKED', appointment: { id: 'apt-new' } }) }
      }
      if (typeof url === 'string' && url.includes('/api/appointments/waitlist')) {
        return {
          ok: true,
          json: async () => ({
            entries: [
              {
                id: 'wl-1',
                status: 'ACTIVE',
                preferredTime: 'MORNING',
                notes: null,
                patient: { id: 'p-1', patientId: 'PAT1', firstName: 'Queue', lastName: 'Waiter' },
                doctor: { id: 'dr-1', firstName: 'Dr', lastName: 'Who' },
              },
            ],
          }),
        }
      }
      if (typeof url === 'string' && url.includes('/api/appointments/analytics')) {
        return {
          ok: true,
          json: async () => ({
            total: 0, completed: 0, cancelled: 0, noShow: 0, upcoming: 0,
            completedRate: 0, cancellationRate: 0, noShowRate: 0, bookedMinutes: 0,
            clinic: { occupancyPercent: 0, availablePercent: 100, capacityMinutes: 0 },
            doctorUtilization: [], period: { from: '', to: '', days: 30 },
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    const onChanged = vi.fn()
    render(<AgendaOperationsPanel capabilities={adminCapabilities} refreshKey={0} onChanged={onChanged} onOpenAppointment={vi.fn()} />)

    const book = await screen.findByRole('button', { name: /book Queue Waiter/i })
    fireEvent.click(book)
    await waitFor(() => {
      const promote = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/appointments/waitlist/wl-1/promote'
      )
      expect(promote).toBeTruthy()
      expect(onChanged).toHaveBeenCalled()
    })
  })

  it('surfaces promote failures as an inline alert', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        return { ok: false, json: async () => ({ error: 'No free slot found within 30 days' }) }
      }
      if (typeof url === 'string' && url.includes('/api/appointments/waitlist')) {
        return {
          ok: true,
          json: async () => ({
            entries: [
              {
                id: 'wl-1',
                status: 'ACTIVE',
                patient: { id: 'p-1', patientId: 'PAT1', firstName: 'Queue', lastName: 'Waiter' },
              },
            ],
          }),
        }
      }
      if (typeof url === 'string' && url.includes('/api/appointments/analytics')) {
        return {
          ok: true,
          json: async () => ({
            total: 0, completed: 0, cancelled: 0, noShow: 0, upcoming: 0,
            completedRate: 0, cancellationRate: 0, noShowRate: 0, bookedMinutes: 0,
            clinic: { occupancyPercent: 0, availablePercent: 100, capacityMinutes: 0 },
            doctorUtilization: [], period: { from: '', to: '', days: 30 },
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<AgendaOperationsPanel capabilities={adminCapabilities} refreshKey={0} onChanged={vi.fn()} onOpenAppointment={vi.fn()} />)
    const book = await screen.findByRole('button', { name: /book Queue Waiter/i })
    fireEvent.click(book)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No free slot/))
  })
})

describe('AgendaOperationsPanel — analytics', () => {
  it('renders month statistics from the real analytics endpoint', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/appointments/analytics')) {
        return {
          ok: true,
          json: async () => ({
            total: 20,
            completed: 12,
            cancelled: 4,
            noShow: 2,
            completedRate: 60,
            cancellationRate: 20,
            noShowRate: 10,
            bookedMinutes: 600,
            clinic: { occupancyPercent: 12.5, availablePercent: 87.5, capacityMinutes: 4800 },
            doctorUtilization: [{ doctorId: 'dr-1', bookedMinutes: 600, utilization: 25 }],
            period: { from: '2026-09-01', to: '2026-09-30', days: 30 },
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<AgendaOperationsPanel capabilities={adminCapabilities} refreshKey={0} onChanged={vi.fn()} onOpenAppointment={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('analytics-summary')).toBeTruthy())
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText('12 (60%)')).toBeTruthy()
    expect(screen.getByText('2 (10%)')).toBeTruthy()
    expect(screen.getByText('12.5%')).toBeTruthy()
  })

  it('shows an inline error when analytics fail', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/appointments/analytics')) {
        return { ok: false, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({}) }
    })
    render(<AgendaOperationsPanel capabilities={adminCapabilities} refreshKey={0} onChanged={vi.fn()} onOpenAppointment={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Failed to load analytics/))
  })
})

// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks (repo conventions: UI primitives mocked thin, icons proxied)
// ---------------------------------------------------------------------------

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/agenda',
}))

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

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, ...props }: any) => (
    <button disabled={disabled} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
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
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange, value }) : child
      )}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange }) : child
      )}
    </div>
  ),
  SelectItem: ({ children, value, onValueChange }: any) => (
    <div
      data-testid={`select-item-${value}`}
      onClick={() => onValueChange?.(value)}
      role="option"
    >
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
}))

// CalendarView is covered by its own dedicated suite; here it is stubbed so the
// workspace contract (providers wiring, refresh trigger, page chrome) is tested.
vi.mock('@/components/appointments/calendar-view', () => ({
  CalendarView: ({ providers, refreshKey }: any) => (
    <div
      data-testid="calendar-view"
      data-providers={providers?.length ?? 0}
      data-refresh-key={refreshKey ?? 0}
    />
  ),
}))

import { AgendaWorkspace } from '@/components/agenda/agenda-workspace'
import { AppointmentDialog } from '@/components/agenda/appointment-dialog'

const doctorsPayload = {
  doctors: [
    { id: 'doc-1', firstName: 'Arun', lastName: 'Vijay', specialization: 'Prosthodontics' },
    { id: 'doc-2', firstName: 'Meera', lastName: 'Nair', specialization: 'Orthodontics' },
  ],
}
const patientsPayload = {
  patients: [
    { id: 'pat-1', patientId: 'P0001', firstName: 'John', lastName: 'Doe' },
    { id: 'pat-2', patientId: 'P0002', firstName: 'Jane', lastName: 'Roe' },
  ],
}

describe('Agenda workspace page', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/staff/doctors')) {
        return Promise.resolve({ ok: true, json: async () => doctorsPayload })
      }
      if (String(url).includes('/api/patients')) {
        return Promise.resolve({ ok: true, json: async () => patientsPayload })
      }
      return Promise.resolve({ ok: true, json: async () => ({ appointments: [] }) })
    })
  })

  it('renders the Agenda header with scheduling actions', async () => {
    render(<AgendaWorkspace canSchedule />)
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument()
    expect(screen.getByText('New appointment')).toBeInTheDocument()
    expect(screen.getByText('Waitlist')).toBeInTheDocument()
    expect(screen.getByText("Today's queue")).toBeInTheDocument()
  })

  it('passes fetched providers into the calendar for filtering', async () => {
    render(<AgendaWorkspace canSchedule />)
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view').dataset.providers).toBe('2')
    })
  })

  it('opens the create dialog and books an appointment through the API', async () => {
    render(<AgendaWorkspace canSchedule />)
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view').dataset.providers).toBe('2')
    })

    fireEvent.click(screen.getByText('New appointment'))
    expect(screen.getByText('New appointment', { selector: 'h3' })).toBeInTheDocument()

    // Fill the form via the mocked selects/inputs
    fireEvent.click(screen.getAllByTestId('select-item-pat-1')[0])
    fireEvent.click(screen.getAllByTestId('select-item-doc-1')[0])
    fireEvent.click(screen.getByText('Book appointment'))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === '/api/appointments' && init?.method === 'POST'
      )
      expect(postCall).toBeDefined()
      expect(JSON.parse(postCall![1].body)).toMatchObject({
        patientId: 'pat-1',
        doctorId: 'doc-1',
      })
    })

    // Agenda refreshes after a successful save
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view').dataset.refreshKey).toBe('1')
    })
  })

  it('surfaces server-side conflict errors inside the dialog', async () => {
    fetchMock.mockImplementation((url: string, init?: any) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'Doctor already has appointment APT20260001 from 09:00 (60 min) overlapping this time',
          }),
        })
      }
      if (String(url).includes('/api/staff/doctors')) {
        return Promise.resolve({ ok: true, json: async () => doctorsPayload })
      }
      if (String(url).includes('/api/patients')) {
        return Promise.resolve({ ok: true, json: async () => patientsPayload })
      }
      return Promise.resolve({ ok: true, json: async () => ({ appointments: [] }) })
    })

    render(<AgendaWorkspace canSchedule />)
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view').dataset.providers).toBe('2')
    })

    fireEvent.click(screen.getByText('New appointment'))
    fireEvent.click(screen.getAllByTestId('select-item-pat-1')[0])
    fireEvent.click(screen.getAllByTestId('select-item-doc-1')[0])
    fireEvent.click(screen.getByText('Book appointment'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/overlapping this time/)
    })
  })

  it('blocks submission when required fields are missing (client-side pre-check)', async () => {
    render(<AgendaWorkspace canSchedule />)
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view').dataset.providers).toBe('2')
    })

    fireEvent.click(screen.getByText('New appointment'))
    fireEvent.click(screen.getByText('Book appointment'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Patient, provider, date/i)
    })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('hides scheduling controls for read-only roles while keeping the calendar', async () => {
    render(<AgendaWorkspace canSchedule={false} />)
    await waitFor(() => {
      expect(screen.getByTestId('calendar-view').dataset.providers).toBe('2')
    })
    expect(screen.queryByText('New appointment')).not.toBeInTheDocument()
    // The calendar still renders (viewing stays available to every role)
    expect(screen.getByTestId('calendar-view')).toBeInTheDocument()
  })

  it('dialog refreshes the calendar after a successful edit save', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(
      <AppointmentDialog
        open
        onClose={onClose}
        onSaved={onSaved}
        patients={patientsPayload.patients}
        doctors={doctorsPayload.doctors}
        appointment={{
          id: 'apt-1',
          patientId: 'pat-1',
          doctorId: 'doc-1',
          scheduledDate: '2027-03-10',
          scheduledTime: '09:00',
          duration: 30,
        }}
      />
    )
    expect(screen.getByText('Edit appointment')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '11:15' } })
    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/appointments/apt-1' && init?.method === 'PUT'
      )
      expect(putCall).toBeDefined()
      expect(JSON.parse(putCall![1].body).scheduledTime).toBe('11:15')
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Agenda workspace fill-height layout (§ viewport stretch)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ appointments: [] }) })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('roots the workspace in a min-h-full flex column so the calendar absorbs the viewport', async () => {
    const { container } = render(<AgendaWorkspace canSchedule />)
    expect(container.firstChild).toHaveClass('flex', 'min-h-full', 'flex-col')
  })
})

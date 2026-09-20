// @ts-nocheck
// Runtime-render evidence: mounts the REAL CalendarView against fixture API
// responses (jsdom), waits for the data fetch to settle, then writes the full
// rendered DOM to tools/preview/agenda-week.html for human inspection.
// This complements the assertion suites with an inspectable artifact of the
// exact markup the component produces at runtime.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'

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
  Button: ({ children, disabled, ...props }: any) => (
    <button disabled={disabled} {...props}>
      {children}
    </button>
  ),
}))
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value }: any) => (
    <div data-testid="view-mode-select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-testid={`select-item-${value}`}>{children}</div>,
}))
vi.mock('@/lib/appointment-utils', () => ({
  appointmentStatusConfig: {
    SCHEDULED: { label: 'Scheduled', bgColor: 'bg-blue-100' },
    CONFIRMED: { label: 'Confirmed', bgColor: 'bg-indigo-100' },
    CHECKED_IN: { label: 'Checked In', bgColor: 'bg-amber-100' },
    IN_PROGRESS: { label: 'In Progress', bgColor: 'bg-purple-100' },
    COMPLETED: { label: 'Completed', bgColor: 'bg-green-100' },
    CANCELLED: { label: 'Cancelled', bgColor: 'bg-muted' },
    NO_SHOW: { label: 'No Show', bgColor: 'bg-red-100' },
    RESCHEDULED: { label: 'Rescheduled', bgColor: 'bg-orange-100' },
  },
  formatTime: (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  },
  getPatientName: (p: any) => `${p.firstName} ${p.lastName}`,
  getDoctorName: (d: any) => `Dr. ${d.firstName} ${d.lastName}`,
}))

import { CalendarView } from '@/components/appointments/calendar-view'

// Week of 2026-03-08 (Sun) … 2026-03-14 (Sat)
const FIXTURES = [
  {
    id: 'a1', appointmentNo: 'APT20260001', scheduledDate: '2026-03-09', scheduledTime: '09:00',
    duration: 45, appointmentType: 'CHECK_UP', status: 'CONFIRMED',
    patient: { firstName: 'Amina', lastName: 'Hassan', phone: '010' },
    doctor: { firstName: 'Arun', lastName: 'Vijay' },
  },
  {
    id: 'a2', appointmentNo: 'APT20260002', scheduledDate: '2026-03-09', scheduledTime: '11:00',
    duration: 30, appointmentType: 'PROCEDURE', status: 'SCHEDULED',
    patient: { firstName: 'Omar', lastName: 'Farouk', phone: '011' },
    doctor: { firstName: 'Arun', lastName: 'Vijay' },
  },
  {
    id: 'a3', appointmentNo: 'APT20260003', scheduledDate: '2026-03-11', scheduledTime: '10:30',
    duration: 60, appointmentType: 'FOLLOW_UP', status: 'CHECKED_IN',
    patient: { firstName: 'Salma', lastName: 'Ibrahim', phone: '012' },
    doctor: { firstName: 'Mariam', lastName: 'Ibrahim' },
  },
  {
    id: 'a4', appointmentNo: 'APT20260004', scheduledDate: '2026-03-12', scheduledTime: '14:00',
    duration: 30, appointmentType: 'CONSULTATION', status: 'COMPLETED',
    patient: { firstName: 'Youssef', lastName: 'Adel', phone: '013' },
    doctor: { firstName: 'Arun', lastName: 'Vijay' },
  },
]

describe('Agenda runtime render artifact', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ appointments: FIXTURES }) })
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('writes the fully rendered week view DOM to tools/preview/agenda-week.html', async () => {
    const { container } = render(<CalendarView initialDate={new Date(2026, 2, 10)} />)

    await waitFor(() => {
      expect(container.textContent).toContain('Amina Hassan')
    })

    const html = [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<title>Agenda week view — runtime render artifact</title>',
      '<style>body{font-family:system-ui,sans-serif;margin:2rem}div[class*="bg-blue"],div[class*="bg-indigo"],div[class*="bg-amber"],div[class*="bg-green"],div[class*="bg-purple"],div[class*="bg-muted"],div[class*="bg-red"],div[class*="bg-orange"]{border:1px solid rgba(0,0,0,.15)}',
      '[data-testid="agenda-mobile-list"] button{display:block;width:100%;margin-bottom:.5rem}</style>',
      '</head><body>',
      '<h1>Agenda — runtime render (jsdom full DOM)</h1>',
      '<p>Component: CalendarView (real component, fixture API). Week containing 2026-03-10.</p>',
      container.innerHTML,
      '</body></html>',
    ].join('')

    const outDir = join(process.cwd(), 'tools', 'preview')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'agenda-week.html'), html)
    expect(container.textContent).toContain('Salma Ibrahim')
  })
})

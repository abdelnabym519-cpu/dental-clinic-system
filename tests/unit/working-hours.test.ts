// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveDayWorkingWindow } from '@/lib/working-hours'
import prisma from '@/tests/__mocks__/prisma'

// Issue 2 — "لا توجد مواعيد متاحة في هذا التاريخ" for EVERY date.
// Root cause: the onboarding wizard stores hospital working hours in the
// PER-DAY shape ({monday:{open,close,closed},…}) while the slots API read
// the flat shape ({start,end,…}) and crashed (500) → the form showed "no
// available appointments" for any date. The normalizer must accept BOTH,
// never throw, and honor closed days + inactive doctor shifts.

// 2026-09-27 is a Sunday; 2026-09-28 is a Monday.
const SUNDAY = '2026-09-27'
const MONDAY = '2026-09-28'

function dayOfWeek(date: string): number {
  return new Date(date + 'T12:00:00').getDay()
}

const PER_DAY = JSON.stringify({
  monday: { open: '09:00', close: '18:00', closed: false },
  tuesday: { open: '09:00', close: '18:00', closed: false },
  wednesday: { open: '09:00', close: '18:00', closed: false },
  thursday: { open: '09:00', close: '18:00', closed: false },
  friday: { open: '09:00', close: '14:00', closed: false },
  saturday: { open: '09:00', close: '14:00', closed: false },
  sunday: { open: null, close: null, closed: true },
})

const CANONICAL = JSON.stringify({ start: '10:00', end: '20:00', lunchStart: '14:00', lunchEnd: '15:00' })

describe('resolveDayWorkingWindow (both stored shapes, never throws)', () => {
  it('reads the onboarding PER-DAY shape for an open day', () => {
    const w = resolveDayWorkingWindow(PER_DAY, dayOfWeek(MONDAY))
    expect(w.source).toBe('per_day')
    expect(w.closed).toBe(false)
    expect(w.start).toBe('09:00')
    expect(w.end).toBe('18:00')
    expect(w.lunchStart).toBeNull() // per-day data carries no lunch window
  })

  it('reads the PER-DAY closed flag (sunday closed) — not a crash', () => {
    const w = resolveDayWorkingWindow(PER_DAY, dayOfWeek(SUNDAY))
    expect(w.closed).toBe(true)
  })

  it('treats a day MISSING from the per-day object as closed', () => {
    const partial = JSON.stringify({ monday: { open: '09:00', close: '17:00' } })
    const w = resolveDayWorkingWindow(partial, dayOfWeek(SUNDAY))
    expect(w.closed).toBe(true)
  })

  it('reads the CANONICAL flat shape incl. the lunch window', () => {
    const w = resolveDayWorkingWindow(CANONICAL, dayOfWeek(MONDAY))
    expect(w.source).toBe('canonical')
    expect(w.start).toBe('10:00')
    expect(w.end).toBe('20:00')
    expect(w.lunchStart).toBe('14:00')
    expect(w.lunchEnd).toBe('15:00')
  })

  it('uses the documented weekly defaults when nothing is configured', () => {
    const monday = resolveDayWorkingWindow(null, 1)
    const thursday = resolveDayWorkingWindow(undefined, 4)
    const friday = resolveDayWorkingWindow('', 5)
    const saturday = resolveDayWorkingWindow(null, 6)
    const sunday = resolveDayWorkingWindow(null, 0)

    expect(monday).toMatchObject({ source: 'default', start: '09:00', end: '17:00', closed: false })
    expect(thursday).toMatchObject({ source: 'default', start: '09:00', end: '17:00', closed: false })
    expect(friday).toMatchObject({ source: 'default', closed: true })
    expect(saturday).toMatchObject({ source: 'default', start: '09:00', end: '14:00', closed: false })
    expect(sunday).toMatchObject({ source: 'default', closed: true })
  })

  it('falls back to the day-specific defaults on garbage JSON instead of 500-ing', () => {
    for (const garbage of ['{not json', '["array"]', '"text"', 'null', '123']) {
      const w = resolveDayWorkingWindow(garbage, dayOfWeek(MONDAY))
      expect(w.source).toBe('default')
      expect(w.start).toBe('09:00')
      expect(w.end).toBe('17:00')
    }
  })

  it('does not silently reopen an invalid or omitted configured day', () => {
    const partial = JSON.stringify({ monday: { open: '09:00', close: '17:00' } })
    expect(resolveDayWorkingWindow(partial, dayOfWeek(SUNDAY)).closed).toBe(true)

    const invalid = JSON.stringify({ monday: { open: '09:99', close: '17:00' } })
    expect(resolveDayWorkingWindow(invalid, dayOfWeek(MONDAY)).closed).toBe(true)
  })

  it('builds explicit default doctor shifts that mirror the clinic work week', async () => {
    const { buildDefaultDoctorShifts } = await import('@/lib/working-hours')
    const shifts = buildDefaultDoctorShifts('hospital-1', 'doctor-1', null)
    expect(shifts).toHaveLength(7)
    expect(shifts.find((shift) => shift.dayOfWeek === 1)).toMatchObject({
      hospitalId: 'hospital-1', staffId: 'doctor-1', startTime: '09:00', endTime: '17:00', isActive: true,
    })
    expect(shifts.find((shift) => shift.dayOfWeek === 5)?.isActive).toBe(false)
    expect(shifts.find((shift) => shift.dayOfWeek === 6)).toMatchObject({ startTime: '09:00', endTime: '14:00', isActive: true })
    expect(shifts.find((shift) => shift.dayOfWeek === 0)?.isActive).toBe(false)
  })
})

// ── The slots API through the real route handler ───────────────────────────
const mockAuth = vi.hoisted(() => ({ requireAuthAndRole: vi.fn() }))
vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))

import { GET } from '@/app/api/appointments/slots/route'

function slotsRequest(date: string) {
  return new Request(`http://localhost/api/appointments/slots?doctorId=doc-1&date=${date}&duration=30`) as never
}

describe('GET /api/appointments/slots (Issue 2 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({ error: null, hospitalId: 'h1' })
    prisma.hospital.findUnique.mockResolvedValue({ workingHours: PER_DAY })
    prisma.holiday.findMany.mockResolvedValue([])
    prisma.staff.findFirst.mockResolvedValue({ id: 'doc-1' })
    prisma.staffShift.findFirst.mockResolvedValue(null)
    prisma.appointment.findMany.mockResolvedValue([])
  })

  it('returns slots for a per-day open day (was: 500 → "no slots any date")', async () => {
    const res = await GET(slotsRequest(MONDAY))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.available).toBe(true)
    // Monday 09:00–18:00 minus lunch-free window → 18 half-hour slots
    expect(data.slots.length).toBeGreaterThan(10)
    expect(data.slots[0].time).toBe('09:00')
  })

  it('closes a per-day CLOSED day with an Arabic reason (never an empty 200 lie)', async () => {
    const res = await GET(slotsRequest(SUNDAY))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.available).toBe(false)
    expect(data.reason).toContain('مغلقة')
    expect(data.slots).toEqual([])
  })

  it('an INACTIVE doctor shift closes the day even with hospital hours open', async () => {
    prisma.staffShift.findFirst.mockResolvedValue({ startTime: '09:00', endTime: '17:00', isActive: false })
    const res = await GET(slotsRequest(MONDAY))
    const data = await res.json()
    expect(data.available).toBe(false)
    expect(data.reason).toContain('الطبيب غير متاح')
  })

  it('an ACTIVE doctor shift narrows the window to clinic hours', async () => {
    prisma.staffShift.findFirst.mockResolvedValue({ startTime: '09:00', endTime: '12:00', isActive: true })
    const res = await GET(slotsRequest(MONDAY))
    const data = await res.json()
    expect(data.available).toBe(true)
    expect(data.slots.length).toBe(6) // 09:00 → 11:30 half-hour slots
    expect(data.workingHours).toEqual({ start: '09:00', end: '12:00', lunchStart: null, lunchEnd: null })
  })

  it('uses the documented default weekday and weekend schedule when unconfigured', async () => {
    prisma.hospital.findUnique.mockResolvedValue({ workingHours: null })
    prisma.staffShift.findFirst.mockResolvedValue(null)

    const friday = await (await GET(slotsRequest('2027-03-12'))).json()
    expect(friday.available).toBe(false)
    expect(friday.slots).toEqual([])

    const sunday = await (await GET(slotsRequest('2027-03-14'))).json()
    expect(sunday.available).toBe(false)
    expect(sunday.slots).toEqual([])

    const saturday = await (await GET(new Request(
      'http://localhost/api/appointments/slots?doctorId=doc-1&date=2027-03-13&duration=60'
    ) as never)).json()
    expect(saturday.available).toBe(true)
    expect(saturday.slots.map((slot: any) => slot.time)).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
    ])
  })
})

// @ts-nocheck
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WORKING_HOURS,
  RECURRENCE_PATTERNS,
  isWithinWorkingHours,
  overlapsBreak,
  isOnApprovedLeave,
  isClinicHoliday,
  roomOverlapExists,
  generateRecurrenceDateKeys,
  resolveDayWindow,
  computeSchedulingAnalytics,
  computeDoctorUtilization,
  weeklyMinutesFromShifts,
} from '@/lib/agenda-availability'

// ---------------------------------------------------------------------------
// Agenda Phase-2 scheduling primitives (pure functions, real arithmetic only)
// ---------------------------------------------------------------------------

describe('Agenda availability — working hours & breaks', () => {
  it('exposes the documented default clinic hours (09:00–21:00, lunch 13:00–14:00)', () => {
    expect(DEFAULT_WORKING_HOURS.startTime).toBe('09:00')
    expect(DEFAULT_WORKING_HOURS.endTime).toBe('21:00')
    expect(DEFAULT_WORKING_HOURS.lunchStart).toBe('13:00')
    expect(DEFAULT_WORKING_HOURS.lunchEnd).toBe('14:00')
  })

  it('accepts bookings inside the working window', () => {
    expect(isWithinWorkingHours('09:00', 30, { startTime: '09:00', endTime: '21:00' })).toBe(true)
    expect(isWithinWorkingHours('20:30', 30, { startTime: '09:00', endTime: '21:00' })).toBe(true)
  })

  it('rejects bookings that start early, end late, or cross the closing time', () => {
    expect(isWithinWorkingHours('08:45', 30, { startTime: '09:00', endTime: '21:00' })).toBe(false)
    expect(isWithinWorkingHours('20:45', 30, { startTime: '09:00', endTime: '21:00' })).toBe(false)
    expect(isWithinWorkingHours('21:00', 1, { startTime: '09:00', endTime: '21:00' })).toBe(false)
  })

  it('flags bookings overlapping the lunch break but not touching ones', () => {
    expect(overlapsBreak('13:15', 30, { lunchStart: '13:00', lunchEnd: '14:00' })).toBe(true)
    expect(overlapsBreak('12:45', 30, { lunchStart: '13:00', lunchEnd: '14:00' })).toBe(true)
    expect(overlapsBreak('12:30', 30, { lunchStart: '13:00', lunchEnd: '14:00' })).toBe(false)
    expect(overlapsBreak('14:00', 30, { lunchStart: '13:00', lunchEnd: '14:00' })).toBe(false)
  })

  it('treats a missing or invalid break as no break', () => {
    expect(overlapsBreak('13:15', 30, {})).toBe(false)
    expect(overlapsBreak('13:15', 30, { lunchStart: 'bad', lunchEnd: '14:00' })).toBe(false)
  })
})

describe('Agenda availability — leaves and holidays', () => {
  const leaves = [
    { startDate: '2027-03-01', endDate: '2027-03-05', status: 'APPROVED' },
    { startDate: '2027-04-01', endDate: '2027-04-02', status: 'PENDING' },
  ]

  it('blocks dates inside an APPROVED leave only', () => {
    expect(isOnApprovedLeave('2027-03-03', leaves)).toBe(true)
    expect(isOnApprovedLeave('2027-02-28', leaves)).toBe(false)
    expect(isOnApprovedLeave('2027-03-06', leaves)).toBe(false)
    expect(isOnApprovedLeave('2027-04-01', leaves)).toBe(false) // PENDING
  })

  it('matches fixed holidays by exact date and recurring ones by month-day', () => {
    const holidays = [
      { date: '2027-07-23', isRecurring: false },
      { date: '2027-01-07', isRecurring: true },
    ]
    expect(isClinicHoliday('2027-07-23', holidays)).toBe(true)
    expect(isClinicHoliday('2031-01-07', holidays)).toBe(true) // recurring, other year
    expect(isClinicHoliday('2027-07-24', holidays)).toBe(false)
  })
})

describe('Agenda availability — room overlap', () => {
  const rows = [
    { id: 'a', scheduledTime: '10:00', duration: 45 },
    { id: 'b', scheduledTime: '12:00', duration: 30 },
  ]
  it('rejects a second booking while the room is occupied', () => {
    expect(roomOverlapExists('10:30', 30, rows)).toBe(true) // inside 10:00–10:45
    expect(roomOverlapExists('11:45', 30, rows)).toBe(true) // inside 12:00–12:30? no — starts before
  })
  it('allows touching and free slots', () => {
    expect(roomOverlapExists('10:45', 30, rows)).toBe(false) // touching, not overlapping
    expect(roomOverlapExists('11:00', 60, rows)).toBe(false)
  })
})

describe('Agenda availability — recurrence expansion', () => {
  it('expands weekly patterns into the right number of real dates', () => {
    const dates = generateRecurrenceDateKeys('2027-03-10', 'WEEKLY', 3)
    expect(dates).toEqual(['2027-03-10', '2027-03-17', '2027-03-24'])
  })

  it('supports biweekly and daily patterns', () => {
    expect(generateRecurrenceDateKeys('2027-03-10', 'BIWEEKLY', 2)).toEqual([
      '2027-03-10',
      '2027-03-24',
    ])
    expect(generateRecurrenceDateKeys('2027-03-10', 'DAILY', 3)).toEqual([
      '2027-03-10',
      '2027-03-11',
      '2027-03-12',
    ])
  })

  it('clamps monthly recurrences to the month end (Jan 31 → Feb 28)', () => {
    const dates = generateRecurrenceDateKeys('2027-01-31', 'MONTHLY', 3)
    expect(dates).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('an inclusive end date wins over the occurrence count', () => {
    const dates = generateRecurrenceDateKeys('2027-03-10', 'WEEKLY', 10, '2027-03-24')
    expect(dates).toEqual(['2027-03-10', '2027-03-17', '2027-03-24'])
  })

  it('caps the series at the hard safety limit', () => {
    const dates = generateRecurrenceDateKeys('2027-01-01', 'DAILY', 500)
    expect(dates.length).toBeLessThanOrEqual(60)
  })

  it('only offers the four documented patterns', () => {
    expect(RECURRENCE_PATTERNS).toEqual(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'])
  })
})

describe('Agenda availability — resolveDayWindow (three sources of truth)', () => {
  it('doctor shift wins over clinic config and drops the clinic lunch', () => {
    const resolved = resolveDayWindow(
      '2027-03-10',
      JSON.stringify({ wednesday: { open: '09:00', close: '18:00', closed: false } }),
      { startTime: '10:00', endTime: '16:00' }
    )
    expect(resolved.window).toEqual({ startTime: '10:00', endTime: '16:00' })
    expect(resolved.lunch).toBeNull()
    expect(resolved.fromShift).toBe(true)
  })

  it('reads the app week-schedule shape (lowercase day keys, closed flag)', () => {
    const schedule = JSON.stringify({
      wednesday: { open: '09:00', close: '18:00', closed: false },
      sunday: { open: null, close: null, closed: true },
    })
    const open = resolveDayWindow('2027-03-10', schedule, null)
    expect(open.window).toEqual({ startTime: '09:00', endTime: '18:00' })
    expect(open.lunch).toBeNull() // configured days carry no implied lunch

    const closed = resolveDayWindow('2027-03-14', schedule, null) // Sunday
    expect(closed.window).toBeNull()
  })

  it('supports the legacy flat shape including an optional lunch', () => {
    const resolved = resolveDayWindow(
      '2027-03-10',
      JSON.stringify({ startTime: '08:00', endTime: '19:00', lunchStart: '12:30', lunchEnd: '13:15' }),
      null
    )
    expect(resolved.window).toEqual({ startTime: '08:00', endTime: '19:00' })
    expect(resolved.lunch).toEqual({ start: '12:30', end: '13:15' })
  })

  it('falls back to the documented defaults when nothing is configured', () => {
    const resolved = resolveDayWindow('2027-03-10', null, null)
    expect(resolved.window).toEqual({ startTime: '09:00', endTime: '21:00' })
    expect(resolved.lunch).toEqual({ start: '13:00', end: '14:00' })
  })

  it('treats unparseable JSON as unconfigured', () => {
    const resolved = resolveDayWindow('2027-03-10', '{not json', null)
    expect(resolved.window).toEqual({ startTime: '09:00', endTime: '21:00' })
  })
})

describe('Agenda analytics — real-record math', () => {
  const appointments = [
    { status: 'COMPLETED', duration: 30, doctorId: 'dr-1', scheduledDate: '2027-03-01' },
    { status: 'COMPLETED', duration: 60, doctorId: 'dr-1', scheduledDate: '2027-03-02' },
    { status: 'CANCELLED', duration: 30, doctorId: 'dr-2', scheduledDate: '2027-03-03' },
    { status: 'NO_SHOW', duration: 30, doctorId: 'dr-2', scheduledDate: '2027-03-04' },
    { status: 'SCHEDULED', duration: 45, doctorId: 'dr-1', scheduledDate: '2027-03-05' },
  ]

  it('computes totals, rates and booked minutes from the given records', () => {
    const a = computeSchedulingAnalytics(appointments)
    expect(a.total).toBe(5)
    expect(a.completed).toBe(2)
    expect(a.cancelled).toBe(1)
    expect(a.noShow).toBe(1)
    expect(a.upcoming).toBe(1)
    expect(a.completedRate).toBe(40)
    expect(a.cancellationRate).toBe(20)
    expect(a.noShowRate).toBe(20)
    expect(a.bookedMinutes).toBe(135) // 30+60+45 — cancelled + no-show excluded
  })

  it('handles the empty clinic without dividing by zero', () => {
    const a = computeSchedulingAnalytics([])
    expect(a.total).toBe(0)
    expect(a.completedRate).toBe(0)
    expect(a.noShowRate).toBe(0)
    expect(a.bookedMinutes).toBe(0)
  })

  it('derives per-doctor utilization from shift capacity', () => {
    const weekly = { 'dr-1': 1200, 'dr-2': 600 }
    const utilization = computeDoctorUtilization(appointments, weekly, 7)
    // dr-2's only records are CANCELLED + NO_SHOW — they consume no capacity.
    expect(utilization.map((u) => u.doctorId)).toEqual(['dr-1'])
    const dr1 = utilization[0]
    expect(dr1.bookedMinutes).toBe(135) // 30 + 60 + 45 (cancelled/no-show skipped)
    expect(dr1.availableMinutes).toBe(1200)
    expect(dr1.utilization).toBeCloseTo(11.3, 1) // 135 of 1200 minutes
  })

  it('sums published active shift minutes per week', () => {
    const minutes = weeklyMinutesFromShifts([
      { staffId: 'dr-1', startTime: '09:00', endTime: '17:00', isActive: true },
      { staffId: 'dr-1', startTime: '10:00', endTime: '14:00', isActive: false }, // ignored
    ])
    expect(minutes['dr-1']).toBe(480)
  })
})

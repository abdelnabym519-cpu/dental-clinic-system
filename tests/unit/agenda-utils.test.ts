import { describe, it, expect } from 'vitest'
import {
  isValidTime,
  timeToMinutes,
  minutesToTime,
  timeRangesOverlap,
  toDateKey,
  parseDateKey,
  addDays,
  startOfWeek,
  startOfMonth,
  agendaPositionPercent,
  agendaHeightPercent,
} from '@/lib/agenda-utils'

describe('agenda time validation', () => {
  it('accepts valid HH:MM 24-hour times', () => {
    expect(isValidTime('00:00')).toBe(true)
    expect(isValidTime('09:30')).toBe(true)
    expect(isValidTime('23:59')).toBe(true)
  })

  it('rejects malformed times', () => {
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('9:30')).toBe(false)
    expect(isValidTime('09:60')).toBe(false)
    expect(isValidTime('09:30 PM')).toBe(false)
    expect(isValidTime('')).toBe(false)
    expect(isValidTime(null)).toBe(false)
    expect(isValidTime(930)).toBe(false)
  })

  it('converts between minutes and HH:MM', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('23:59')).toBe(1439)
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(0)).toBe('00:00')
  })
})

describe('agenda conflict overlap math', () => {
  it('detects overlapping ranges', () => {
    // 09:00-10:00 vs 09:30-10:00
    expect(timeRangesOverlap(540, 60, 570, 30)).toBe(true)
    // new appointment entirely inside an existing one
    expect(timeRangesOverlap(540, 120, 600, 30)).toBe(true)
    // existing entirely inside the new one
    expect(timeRangesOverlap(600, 30, 540, 120)).toBe(true)
  })

  it('does not flag touching ranges', () => {
    // 09:00-09:30 followed by 09:30-10:00 is legal back-to-back booking
    expect(timeRangesOverlap(540, 30, 570, 30)).toBe(false)
    expect(timeRangesOverlap(570, 30, 540, 30)).toBe(false)
  })

  it('does not flag disjoint ranges', () => {
    expect(timeRangesOverlap(540, 30, 1020, 30)).toBe(false)
  })

  it('ignores non-positive durations', () => {
    expect(timeRangesOverlap(540, 0, 540, 30)).toBe(false)
    expect(timeRangesOverlap(540, 30, 540, 0)).toBe(false)
  })
})

describe('agenda local date keys', () => {
  it('builds YYYY-MM-DD from local calendar parts', () => {
    // 2026-01-05 local noon — toISOString would give a different key in
    // UTC-negative timezones; the local key must stay the calendar day.
    const d = new Date(2026, 0, 5, 12, 0, 0)
    expect(toDateKey(d)).toBe('2026-01-05')
  })

  it('round-trips through parseDateKey at local midnight', () => {
    const d = parseDateKey('2026-03-17')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(17)
    expect(d.getHours()).toBe(0)
    expect(toDateKey(d)).toBe('2026-03-17')
  })

  it('rejects malformed date keys', () => {
    expect(() => parseDateKey('2026-13-01')).toThrow()
    expect(() => parseDateKey('not-a-date')).toThrow()
  })

  it('addDays moves on the local calendar across month ends', () => {
    expect(toDateKey(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01')
    expect(toDateKey(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28')
  })

  it('startOfWeek lands on Sunday', () => {
    const wed = new Date(2026, 0, 7) // Wednesday
    const start = startOfWeek(wed)
    expect(start.getDay()).toBe(0)
    expect(toDateKey(start)).toBe('2026-01-04')
  })

  it('startOfMonth is the first day', () => {
    const start = startOfMonth(new Date(2026, 4, 17))
    expect(toDateKey(start)).toBe('2026-05-01')
  })
})

describe('agenda timeline positioning', () => {
  it('positions the working-day boundaries at 0% and 100%', () => {
    expect(agendaPositionPercent('07:00')).toBe(0)
    expect(agendaPositionPercent('21:00')).toBe(100)
  })

  it('positions mid-day times proportionally', () => {
    // 13:00 is 6h into a 7:00–21:00 day = 42.857%
    expect(agendaPositionPercent('13:00')).toBeCloseTo(42.857, 1)
  })

  it('clamps out-of-range times into the visible timeline', () => {
    expect(agendaPositionPercent('05:00')).toBe(0)
    expect(agendaPositionPercent('23:00')).toBe(100)
  })

  it('scales durations to height and keeps short blocks visible', () => {
    // 60 min of 840 total = 7.142%
    expect(agendaHeightPercent(60)).toBeCloseTo(7.142, 1)
    expect(agendaHeightPercent(5)).toBeGreaterThanOrEqual(2.5)
    expect(agendaHeightPercent(0)).toBe(2.5)
  })
})

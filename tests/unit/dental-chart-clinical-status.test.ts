import { describe, it, expect } from 'vitest'
import {
  deriveToothStatus,
  deriveStatusMap,
  TOOTH_COLORS,
  type StatusFindingRef,
} from '@/lib/dental-chart/clinical-status'

const f = (condition: string, resolvedDate: string | null = null): StatusFindingRef => ({
  condition,
  resolvedDate,
})

describe('tooth treatment-status derivation', () => {
  it('healthy when nothing recorded', () => {
    expect(deriveToothStatus([], [])).toBe('healthy')
    expect(deriveToothStatus([f('HEALTHY')], [])).toBe('healthy')
  })

  it('affected when an active finding exists', () => {
    expect(deriveToothStatus([f('CARIES')], [])).toBe('affected')
    expect(deriveToothStatus([f('ABSCCESS' in {} ? 'CARIES' : 'ABSCCESS'.replace('CC','CC'))], [])).toBe('affected')
  })

  it('resolved findings never affect status (history-safe)', () => {
    expect(deriveToothStatus([f('CARIES', '2026-01-01')], [])).toBe('healthy')
    expect(deriveToothStatus([f('CARIES', '2026-01-01'), f('FILLED')], [])).toBe('affected')
  })

  it('missing dominates everything (MISSING / EXTRACTION)', () => {
    expect(deriveToothStatus([f('MISSING')], [{ status: 'COMPLETED' }])).toBe('missing')
    expect(deriveToothStatus([f('EXTRACTION')], [])).toBe('missing')
    expect(deriveToothStatus([f('MISSING', '2026-01-01')], [])).toBe('healthy') // resolved → back
  })

  it('procedure precedence: completed > in_progress > planned', () => {
    const procs = (s: string[]) => s.map((status) => ({ status }))
    expect(deriveToothStatus([], procs(['COMPLETED', 'PENDING']))).toBe('completed')
    expect(deriveToothStatus([], procs(['SCHEDULED', 'PENDING']))).toBe('in_progress')
    expect(deriveToothStatus([], procs(['IN_PROGRESS']))).toBe('in_progress')
    expect(deriveToothStatus([], procs(['PENDING']))).toBe('planned')
    expect(deriveToothStatus([], procs(['CANCELLED']))).toBe('healthy')
  })

  it('planned procedure beats a bare finding (treatment already decided)', () => {
    expect(deriveToothStatus([f('CARIES')], [{ status: 'PENDING' }])).toBe('planned')
  })

  it('derives a full status map', () => {
    const map = deriveStatusMap(
      new Map([
        [16, [f('CARIES')]],
        [36, [f('MISSING')]],
        [11, []],
      ]),
      new Map([
        [26, [{ status: 'PENDING' }]],
        [46, [{ status: 'COMPLETED' }]],
      ])
    )
    expect(map[16]).toBe('affected')
    expect(map[36]).toBe('missing')
    expect(map[11]).toBe('healthy')
    expect(map[26]).toBe('planned')
    expect(map[46]).toBe('completed')
  })
})

describe('chart palette contract', () => {
  it('uses the exact clinical colors', () => {
    expect(TOOTH_COLORS.healthy).toBe('#22c55e')
    expect(TOOTH_COLORS.affected).toBe('#ef4444')
    expect(TOOTH_COLORS.planned).toBe('#f59e0b')
    expect(TOOTH_COLORS.in_progress).toBe('#3b82f6')
    expect(TOOTH_COLORS.completed).toBe('#8b5cf6')
    expect(TOOTH_COLORS.missing).toBe('#9ca3af')
  })
})

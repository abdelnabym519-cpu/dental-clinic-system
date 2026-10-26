/**
 * FDI-52 — validation boundaries on the two remaining permanent-only sites.
 *
 * Test-first file for:
 *   lib/ai/evaluation/dataset.ts  (:73  input.toothFdi capped 11..48)
 *   lib/treatment-utils.ts        (:349 getToothQuadrant — no validation at all)
 *
 * NOTE (asked before editing dataset.ts): NO golden case anywhere in
 * tests/evaluation/golden/*.json sets `input.toothFdi` — 0 of 130 cases across
 * all 11 files. So nothing depends on the 11..48 cap, in either direction:
 * no case needs a primary tooth accepted, and no case relies on an
 * out-of-range value being rejected.
 */
import { describe, it, expect } from 'vitest'
import { GoldenCaseSchema } from '@/lib/ai/evaluation/dataset'
import { getToothQuadrant } from '@/lib/treatment-utils'
import { EVAL_CATEGORIES } from '@/lib/ai/evaluation/types'

const PERMANENT = [
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
]
const PRIMARY = [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]
// Not real teeth: permanent-shaped numbers outside any quadrant's index range,
// primary indices 6-8 that do not exist, and plain out-of-range values.
const NOT_TEETH = [19, 20, 29, 30, 39, 40, 49, 56, 59, 66, 99, 0]

function caseWithTooth(toothFdi: number) {
  return {
    caseId: 'TEST-FDI-000',
    category: EVAL_CATEGORIES[0],
    domain: 'clinical-safety',
    language: 'en',
    title: 'FDI validation boundary probe',
    tenant: 'A',
    input: { message: 'Assess the tooth.', patientId: 'pat-A1', toothFdi },
    expected: { status: ['CLARIFICATION_REQUIRED'], mustContain: [], mustNotContain: [] },
  }
}

describe('dataset.ts — input.toothFdi accepts all 52 identifiers (FDI-52)', () => {
  it('accepts every permanent tooth 11-48', () => {
    for (const n of PERMANENT) {
      const r = GoldenCaseSchema.safeParse(caseWithTooth(n))
      expect(
        r.success,
        `permanent ${n} must be accepted: ${r.success ? '' : JSON.stringify(r.error.issues)}`
      ).toBe(true)
    }
  })

  it('accepts every PRIMARY tooth 51-85', () => {
    for (const n of PRIMARY) {
      const r = GoldenCaseSchema.safeParse(caseWithTooth(n))
      expect(
        r.success,
        `primary ${n} must be accepted: ${r.success ? '' : JSON.stringify(r.error.issues)}`
      ).toBe(true)
    }
  })

  it('rejects numbers that are not real FDI teeth', () => {
    for (const n of NOT_TEETH) {
      const r = GoldenCaseSchema.safeParse(caseWithTooth(n))
      expect(r.success, `${n} is not a tooth and must be rejected`).toBe(false)
    }
  })

  it('still accepts a null/omitted toothFdi (no new requirement)', () => {
    const base = caseWithTooth(16)
    expect(GoldenCaseSchema.safeParse({ ...base, input: { message: 'x' } }).success).toBe(true)
    expect(
      GoldenCaseSchema.safeParse({ ...base, input: { message: 'x', toothFdi: null } }).success
    ).toBe(true)
  })
})

describe('treatment-utils.getToothQuadrant (FDI-52)', () => {
  it('returns the true quadrant for permanent teeth', () => {
    for (const n of PERMANENT) {
      expect(getToothQuadrant(n), `tooth ${n}`).toBe(Math.floor(n / 10))
    }
  })

  it('returns the true quadrant 5-8 for PRIMARY teeth', () => {
    for (const n of PRIMARY) {
      expect(getToothQuadrant(n), `tooth ${n}`).toBe(Math.floor(n / 10))
    }
  })

  it('never claims a real quadrant for numbers that are not teeth', () => {
    // Today this function has NO validation and returns Math.floor(n/10),
    // so 19 -> 1, 30 -> 3, 56 -> 5, 99 -> 9: it invents quadrants for
    // numbers that are not teeth at all.
    for (const n of NOT_TEETH) {
      expect(getToothQuadrant(n), `${n} is not a tooth; must fall back to 1`).toBe(1)
    }
  })
})

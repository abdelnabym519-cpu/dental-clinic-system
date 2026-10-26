/**
 * Phase 10 — dental entity resolution unit tests (§10/§11).
 *
 * Ambiguity NEVER resolves by guessing: 36/63 confusion asks; duplicate
 * patient names ask; unknown names ask. All lookups tenant-scoped.
 */
import { describe, it, expect } from 'vitest'
import { createAgentFakePrisma, HOSP_A, HOSP_B } from '@/tests/harness/agent-fixtures'
import {
  extractPatientNameHint,
  matchControlPhrase,
  patientClarification,
  resolvePatientReference,
  resolveToothReference,
  toothClarification,
} from '@/lib/ai/voice/entity-resolution'

describe('tooth resolution (FDI via the existing contract)', () => {
  it('resolves a valid FDI number directly', () => {
    const r = resolveToothReference('ركز على السن 36')
    expect(r.status).toBe('RESOLVED')
    expect(r.fdi).toBe(36)
  })

  it('resolves Arabic-Indic digits after folding', () => {
    expect(resolveToothReference('السن ٤٦').status).toBe('RESOLVED')
    expect(resolveToothReference('السن ٤٦').fdi).toBe(46)
  })

  it('flags the classic 36/63 STT confusion as AMBIGUOUS (never guesses)', () => {
    const r = resolveToothReference('ركز على السن 63')
    expect(r.status).toBe('AMBIGUOUS')
    expect(r.candidates).toContain(36)
    const q = toothClarification(r)
    expect(q.code).toBe('TOOTH_AMBIGUOUS')
    expect(q.questionAr).toContain('36')
    expect(q.questionAr).toContain('63')
    expect(q.questionEn).toContain('36')
  })

  it('both-valid reversals stay literal (42 IS a valid FDI number)', () => {
    expect(resolveToothReference('tooth 42').status).toBe('RESOLVED')
    expect(resolveToothReference('tooth 42').fdi).toBe(42)
  })

  it('rescues the invalid heard form 81 → 18 (only when unambiguous)', () => {
    expect(resolveToothReference('tooth 81').status).toBe('AMBIGUOUS')
    expect(resolveToothReference('tooth 81').candidates).toContain(18)
  })

  it('numbers with no FDI reading are NOT_FOUND (explicit ask)', () => {
    const r = resolveToothReference('tooth 99')
    expect(r.status).toBe('NOT_FOUND')
    expect(toothClarification(r).code).toBe('TOOTH_NOT_FOUND')
  })

  it('spoken English numbers resolve (thirty six → 36)', () => {
    expect(resolveToothReference('tooth thirty six').fdi).toBe(36)
  })

  it('flags the 16 primary numbers whose reversal is a valid PERMANENT number (FDI-52 Option B)', () => {
    // Each pair crosses a dentition boundary when its digits are swapped:
    // 51↔15, 52↔25, 53↔35, 54↔45, 61↔16, 62↔26, 63↔36, 64↔46,
    // 71↔17, 72↔27, 73↔37, 74↔47, 81↔18, 82↔28, 83↔38, 84↔48.
    const PRIMARY_WITH_PERMANENT_REVERSAL = [
      [51, 15],
      [52, 25],
      [53, 35],
      [54, 45],
      [61, 16],
      [62, 26],
      [63, 36],
      [64, 46],
      [71, 17],
      [72, 27],
      [73, 37],
      [74, 47],
      [81, 18],
      [82, 28],
      [83, 38],
      [84, 48],
    ]
    expect(PRIMARY_WITH_PERMANENT_REVERSAL).toHaveLength(16)
    for (const [heard, permanent] of PRIMARY_WITH_PERMANENT_REVERSAL) {
      const r = resolveToothReference(`tooth ${heard}`)
      expect(r.status, `heard ${heard}`).toBe('AMBIGUOUS')
      expect(r.fdi, `heard ${heard}`).toBeNull()
      expect(r.candidates, `heard ${heard}`).toContain(heard)
      expect(r.candidates, `heard ${heard}`).toContain(permanent)
      const q = toothClarification(r)
      expect(q.code, `heard ${heard}`).toBe('TOOTH_AMBIGUOUS')
      expect(q.questionAr, `heard ${heard}`).toContain(String(heard))
      expect(q.questionAr, `heard ${heard}`).toContain(String(permanent))
    }
  })

  it('resolves the 4 primary second molars 55/65/75/85 (no permanent reversal exists)', () => {
    // 55 reverses to itself; 65→56, 75→57, 85→58 are all invalid (no index 6-8
    // in a primary quadrant), so there is nothing to disambiguate.
    for (const heard of [55, 65, 75, 85]) {
      const r = resolveToothReference(`tooth ${heard}`)
      expect(r.status, `heard ${heard}`).toBe('RESOLVED')
      expect(r.fdi, `heard ${heard}`).toBe(heard)
      expect(r.candidates, `heard ${heard}`).toEqual([heard])
    }
  })

  it('covers all 20 primary identifiers: 16 AMBIGUOUS + 4 RESOLVED, exactly', () => {
    const all = [5, 6, 7, 8].flatMap((q) => [1, 2, 3, 4, 5].map((t) => q * 10 + t))
    expect(all).toEqual([
      51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85,
    ])
    const ambiguous = all.filter((n) => resolveToothReference(`tooth ${n}`).status === 'AMBIGUOUS')
    const resolved = all.filter((n) => resolveToothReference(`tooth ${n}`).status === 'RESOLVED')
    expect(ambiguous).toEqual([51, 52, 53, 54, 61, 62, 63, 64, 71, 72, 73, 74, 81, 82, 83, 84])
    expect(resolved).toEqual([55, 65, 75, 85])
    expect(ambiguous.length + resolved.length).toBe(20)
  })

  it('never flags a heard PERMANENT number — 36 and 42 stay literal (pinned)', () => {
    expect(resolveToothReference('ركز على السن 36').status).toBe('RESOLVED')
    expect(resolveToothReference('ركز على السن 36').fdi).toBe(36)
    expect(resolveToothReference('tooth 42').status).toBe('RESOLVED')
    expect(resolveToothReference('tooth 42').fdi).toBe(42)
    // 42's reversal 24 is permanent and 36's reversal 63 is primary: neither
    // satisfies "heard is primary AND reversal is permanent".
  })
})

describe('control phrases (§16)', () => {
  it('recognizes interruption in Arabic and English', () => {
    expect(matchControlPhrase('اسكت')).toBe('INTERRUPT')
    expect(matchControlPhrase('استنى شوية')).toBe('INTERRUPT')
    expect(matchControlPhrase('كفاية')).toBe('INTERRUPT')
    expect(matchControlPhrase('stop')).toBe('INTERRUPT')
    expect(matchControlPhrase('wait')).toBe('INTERRUPT')
  })

  it('recognizes explicit confirmation only (bare yes is NOT confirmation)', () => {
    expect(matchControlPhrase('أكد')).toBe('CONFIRM')
    expect(matchControlPhrase('تأكيد')).toBe('CONFIRM')
    expect(matchControlPhrase('please confirm')).toBe('CONFIRM')
    // Bare affirmation must never classify as confirmation (§15).
    expect(matchControlPhrase('ايوه')).toBeNull()
    expect(matchControlPhrase('yes')).toBeNull()
    expect(matchControlPhrase('ok')).toBeNull()
  })

  it('ordinary clinical speech is not a control phrase', () => {
    expect(matchControlPhrase('حلل الأشعة دي')).toBeNull()
    expect(matchControlPhrase('analyze the x-ray of tooth 36')).toBeNull()
  })
})

describe('patient resolution (tenant-scoped, normalization-aware)', () => {
  const clientWith = (rows: Record<string, unknown>[]) =>
    createAgentFakePrisma({ patient: rows }) as unknown as Parameters<
      typeof resolvePatientReference
    >[0]

  it('resolves a unique exact match (normalization-aware: منى matches منى)', async () => {
    const client = clientWith([
      {
        id: 'p1',
        hospitalId: HOSP_A,
        firstName: 'منى',
        lastName: 'سعيد',
        patientId: 'PAT-1',
        phone: '010',
      },
    ])
    const r = await resolvePatientReference(client, HOSP_A, { first: 'منى', last: null })
    expect(r.status).toBe('RESOLVED')
    expect(r.patientId).toBe('p1')
    expect(r.displayName).toBe('منى سعيد')
  })

  it('multiple same-name patients are AMBIGUOUS with bounded candidates', async () => {
    const client = clientWith([
      {
        id: 'p1',
        hospitalId: HOSP_A,
        firstName: 'احمد',
        lastName: 'علي',
        patientId: 'PAT-1',
        phone: '010',
      },
      {
        id: 'p2',
        hospitalId: HOSP_A,
        firstName: 'احمد',
        lastName: 'سعيد',
        patientId: 'PAT-2',
        phone: '011',
      },
    ])
    const r = await resolvePatientReference(client, HOSP_A, { first: 'احمد', last: null })
    expect(r.status).toBe('AMBIGUOUS')
    expect(r.candidates.length).toBe(2)
    const q = patientClarification(r)
    expect(q?.code).toBe('PATIENT_AMBIGUOUS')
    expect(q?.questionAr).toContain('احمد')
  })

  it('never leaks across tenants', async () => {
    const client = clientWith([
      {
        id: 'pb',
        hospitalId: HOSP_B,
        firstName: 'منى',
        lastName: 'سعيد',
        patientId: 'PAT-B',
        phone: '010',
      },
    ])
    const r = await resolvePatientReference(client, HOSP_A, { first: 'منى', last: null })
    expect(r.status).toBe('NOT_FOUND')
  })

  it('a missing name is NOT_FOUND with an explicit ask', async () => {
    const client = clientWith([
      {
        id: 'p1',
        hospitalId: HOSP_A,
        firstName: 'منى',
        lastName: 'سعيد',
        patientId: 'PAT-1',
        phone: '010',
      },
    ])
    const r = await resolvePatientReference(client, HOSP_A, { first: 'غيرموجود', last: null })
    expect(r.status).toBe('NOT_FOUND')
    expect(patientClarification(r)?.code).toBe('PATIENT_NOT_FOUND')
  })

  it('no hint → NOT_REQUESTED (agent answers generically)', async () => {
    const client = clientWith([])
    const r = await resolvePatientReference(client, HOSP_A, null)
    expect(r.status).toBe('NOT_REQUESTED')
  })
})

describe('patient name hints (bounded lexicon, punctuation-safe)', () => {
  it('extracts from المريض + name and stops at non-name words', () => {
    expect(extractPatientNameHint('إيه حالة المريض احمد؟')).toEqual({ first: 'احمد', last: null })
    expect(extractPatientNameHint('المريض منى عنده تسوس')).toEqual({ first: 'منى', last: null })
    expect(extractPatientNameHint('حالة المريض احمد علي')).toEqual({ first: 'احمد', last: 'علي' })
  })

  it('extracts from English phrases', () => {
    expect(extractPatientNameHint('show patient Ahmed Ali')).toEqual({
      first: 'Ahmed',
      last: 'Ali',
    })
  })

  it('returns null when no marker exists', () => {
    expect(extractPatientNameHint('ما هي علاج تسوس السن')).toBeNull()
  })
})

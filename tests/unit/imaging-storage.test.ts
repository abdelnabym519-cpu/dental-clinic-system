// @ts-nocheck
import { describe, it, expect } from 'vitest'

// Real lib/storage (pure, no env needed for the key helpers) — the Phase 19A
// imaging flow reuses this exact abstraction for originals AND AI outputs.
import {
  buildStorageKey,
  keyBelongsToHospital,
  toStorageKey,
  uploadUrl,
  InvalidStorageKeyError,
} from '@/lib/storage'

const H1 = 'hosp-1'
const H2 = 'hosp-2'
const PATIENT = 'pat-1'
const STUDY = 'a1b2c3d4-0000-4000-8000-000000000001'

describe('imaging object keys (D6/D6.1)', () => {
  it('original key is tenant-scoped and follows the study layout', () => {
    const key = buildStorageKey(H1, 'imaging', PATIENT, STUDY, 'original.png')
    expect(key).toBe(`${H1}/imaging/${PATIENT}/${STUDY}/original.png`)
  })

  it('AI output keys stay under the same tenant prefix (tenant guard keeps working)', () => {
    const resultKey = buildStorageKey(H1, 'imaging', PATIENT, STUDY, 'ai', 'liodon', 'result.json')
    const annotatedKey = buildStorageKey(
      H1,
      'imaging',
      PATIENT,
      STUDY,
      'ai',
      'liodon',
      'annotated.png'
    )
    expect(keyBelongsToHospital(resultKey, H1)).toBe(true)
    expect(keyBelongsToHospital(annotatedKey, H1)).toBe(true)
    // Another tenant cannot read either object through /api/uploads.
    expect(keyBelongsToHospital(resultKey, H2)).toBe(false)
    expect(keyBelongsToHospital(annotatedKey, H2)).toBe(false)
  })

  it('original and AI outputs are DIFFERENT objects (originals immutable)', () => {
    const original = buildStorageKey(H1, 'imaging', PATIENT, STUDY, 'original.png')
    const annotated = buildStorageKey(H1, 'imaging', PATIENT, STUDY, 'ai', 'liodon', 'annotated.png')
    expect(original).not.toBe(annotated)
  })

  it('serving URLs route through the existing authenticated uploads endpoint', () => {
    const key = buildStorageKey(H1, 'imaging', PATIENT, STUDY, 'original.png')
    expect(uploadUrl(key)).toBe(`/api/uploads/${key}`)
  })

  it('rejects path traversal in object keys', () => {
    expect(() => toStorageKey(`${H1}/../${H2}/imaging/x.png`)).toThrow(InvalidStorageKeyError)
  })

  it('rejects keys that could escape the tenant prefix', () => {
    expect(() => buildStorageKey(H1, '..', 'imaging')).toThrow(InvalidStorageKeyError)
  })

  it('cross-tenant guard answers false (not throw) for malformed keys', () => {
    expect(keyBelongsToHospital('h//imaging/x.png', H1)).toBe(false)
    expect(keyBelongsToHospital('', H1)).toBe(false)
    expect(keyBelongsToHospital(null, H1)).toBe(false)
  })
})

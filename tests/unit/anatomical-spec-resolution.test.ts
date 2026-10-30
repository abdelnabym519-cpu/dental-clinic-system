// @ts-nocheck
/**
 * P2-procedural step 3 — anatomical specs resolve deliberately, never silently.
 *
 * getAnatomicalSpec(n) used to end in `?? ANATOMICAL_SPECS.maxillary_central_incisor`.
 * ANATOMICAL_SPECS covers the 16 permanent classes only, so every primary tooth
 * (51-55, 61-65, 71-75, 81-85) fell through to that fallback and rendered as a
 * maxillary central incisor - a primary molar shaped like an upper front tooth,
 * with no error anywhere. P2 step 4 wires per-class geometry, so this silence
 * would have been baked into the renderer.
 *
 * These tests pin the honest contract: a permanent tooth resolves to its own
 * spec, a primary tooth resolves to "no spec" (never a borrowed incisor), and
 * nothing in between.
 */
import { describe, it, expect } from 'vitest'

import {
  resolveAnatomicalSpec,
  hasAnatomicalSpec,
  getAnatomicalSpec,
  rootSpecsForTooth,
  toothSpecificTypeOf,
} from '@/components/dental-chart/interactive/tooth-anatomy'
import { FDI_TEETH, groupOf, archOf, isValidFdi, isPrimaryFdi } from '@/lib/dental-chart/fdi'

/** All 52 valid FDI ids: 32 permanent + 20 primary. */
const ALL_FDI: number[] = Array.from({ length: 90 }, (_, i) => i).filter(
  (n) => n >= 11 && n <= 85 && isValidFdi(n)
)
const PERMANENT = ALL_FDI.filter((n) => !isPrimaryFdi(n))
const PRIMARY = ALL_FDI.filter((n) => isPrimaryFdi(n))

describe('anatomical spec resolution is deliberate, never silent', () => {
  it('covers the whole dentition (non-vacuity)', () => {
    expect(ALL_FDI).toHaveLength(52)
    expect(PERMANENT).toHaveLength(32)
    expect(PRIMARY).toHaveLength(20)
  })

  it('every permanent tooth resolves to a spec that matches its own class', () => {
    const failures: string[] = []

    for (const n of PERMANENT) {
      const spec = resolveAnatomicalSpec(n)
      if (!spec) {
        failures.push(`${n}: no spec`)
        continue
      }
      if (spec.group !== groupOf(n)) {
        failures.push(`${n}: spec.group=${spec.group} but groupOf=${groupOf(n)}`)
      }
      if (spec.arch !== archOf(n)) {
        failures.push(`${n}: spec.arch=${spec.arch} but archOf=${archOf(n)}`)
      }
      if (spec.specificType !== toothSpecificTypeOf(n)) {
        failures.push(
          `${n}: spec.specificType=${spec.specificType} but lookup=${toothSpecificTypeOf(n)}`
        )
      }
    }

    if (failures.length) console.log('  ' + failures.join('\n  '))
    expect(failures).toEqual([])
  })

  it('every primary tooth resolves to "no spec" - never a borrowed incisor', () => {
    // This is the exact regression the silent fallback caused: 20 primary
    // teeth each returned the maxillary central incisor.
    const borrowed: string[] = []

    for (const n of PRIMARY) {
      const spec = resolveAnatomicalSpec(n)
      if (spec) {
        borrowed.push(`${n} -> ${spec.specificType} (group=${spec.group}, arch=${spec.arch})`)
      }
      expect(hasAnatomicalSpec(n)).toBe(false)
    }

    if (borrowed.length) console.log('  borrowed specs:\n  ' + borrowed.join('\n  '))
    expect(borrowed).toEqual([])
  })

  it('the 16 spec keys are all reachable from a permanent tooth', () => {
    // Guards against a spec existing but no FDI number mapping to it (i.e. the
    // lookup silently leaving part of the table unused).
    const resolved = new Set(
      PERMANENT.map((n) => resolveAnatomicalSpec(n))
        .filter(Boolean)
        .map((s) => s!.specificType)
    )
    // Every distinct key the FDI numbers point at, spec or not. If this exceeds
    // 16 the lookup is asking for specs that were never written.
    const requested = new Set(PERMANENT.map((n) => toothSpecificTypeOf(n)))
    expect(resolved.size).toBe(16)
    expect(requested.size).toBe(16)
  })

  it('getAnatomicalSpec(number) throws for primary instead of falling back', () => {
    for (const n of PRIMARY) {
      expect(() => getAnatomicalSpec(n)).toThrow(/No anatomical spec/)
    }
    // ...and still works for permanent teeth.
    for (const n of PERMANENT) {
      expect(() => getAnatomicalSpec(n)).not.toThrow()
    }
  })

  it('rootSpecsForTooth yields no root counts for primary teeth', () => {
    // Root and canal counts are anatomy facts. Primary teeth must get null, not
    // a permanent tooth's root system.
    for (const n of PRIMARY) {
      expect(rootSpecsForTooth(n), `FDI ${n}`).toBeNull()
    }
    for (const n of PERMANENT) {
      const roots = rootSpecsForTooth(n)
      expect(roots, `FDI ${n}`).not.toBeNull()
      expect(roots!.length, `FDI ${n}`).toBeGreaterThan(0)
    }
  })
})

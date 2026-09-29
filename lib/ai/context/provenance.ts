/**
 * Phase 2 — Provenance + freshness helpers (§14/§15/§22/§23).
 */

import type { FactCategory, Freshness, Provenance } from './types'

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null

export function makeProvenance(p: {
  sourceType: Provenance['sourceType']
  sourceId: string
  entityType: string
  entityId: string
  timestamp?: Date | string | null
  actor?: string | null
}): Provenance {
  return {
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    entityType: p.entityType,
    entityId: p.entityId,
    timestamp: iso(p.timestamp),
    actor: p.actor ?? null,
  }
}

/**
 * Freshness of a section from its newest timestamp:
 *  fresh < 24h, recent < 90d, historical >= 90d, unknown when no timestamp.
 * Stale data is never presented as live: the state is explicit.
 */
const FRESH_MS = 24 * 3600 * 1000
const RECENT_MS = 90 * 24 * 3600 * 1000

export function freshnessOf(latest: Date | string | null | undefined, now: Date): Freshness {
  if (!latest) return 'unknown'
  const t = new Date(latest).getTime()
  if (Number.isNaN(t)) return 'unknown'
  const age = now.getTime() - t
  if (age < FRESH_MS) return 'fresh'
  if (age < RECENT_MS) return 'recent'
  return 'historical'
}

export function newestTimestamp<T>(rows: T[], pick: (r: T) => Date | string | null | undefined): Date | string | null {
  let best: number | null = null
  let value: Date | string | null = null
  for (const r of rows) {
    const t = pick(r)
    if (!t) continue
    const ms = new Date(t).getTime()
    if (Number.isNaN(ms)) continue
    if (best === null || ms > best) { best = ms; value = t }
  }
  return value
}

/**
 * Fact-category classification (§22). The categories are never merged:
 * what a doctor records is a CLINICAL_FACT; what an engine outputs is a
 * MODEL_FINDING; patient intake is PATIENT_REPORTED; workflow state is a
 * SYSTEM_EVENT.
 */
export const FACT = {
  clinicalFact: 'CLINICAL_FACT',
  modelFinding: 'MODEL_FINDING',
  clinicalInterpretation: 'CLINICAL_INTERPRETATION',
  patientReported: 'PATIENT_REPORTED',
  systemEvent: 'SYSTEM_EVENT',
} as const satisfies Record<string, FactCategory>

/** Truncate free text deterministically (marker preserved). */
export function truncateText(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…[truncated]`
}

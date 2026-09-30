/**
 * Phase 8 — task-scoped, bounded memory retrieval.
 *
 * Rules (Phase 8 §18):
 *  - retrieval is ALWAYS tenant + role + patient/case/doctor/conversation
 *    scoped (the store where-clause carries the scope; this module adds the
 *    trust filter, freshness, key/type filters and the character budget)
 *  - the WHOLE patient history is never retrieved by default — maxItems is
 *    capped (hard 25) and the rendered block is capped (hard 4000 chars)
 *  - AI_DERIVED / UNKNOWN items are candidates: excluded unless the caller
 *    explicitly opts in (includeCandidate), and always rendered with an
 *    UNVERIFIED label — never silently promoted
 *  - every rendered item carries provenance (trust + source + validFrom)
 */

import { MEMORY_LIMITS, type MemoryBlock, type MemoryBlockItem, type MemoryItem, type MemoryQuery, type MemoryTrust } from './types'

export function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * One rendered line: `[TRUST] key: value — source, as-of`.
 * Candidates are labeled so they can never be read as verified facts.
 */
export function renderItem(item: MemoryItem): { rendered: string; candidate: boolean } {
  const candidate = item.trustLevel === 'AI_DERIVED' || item.trustLevel === 'UNKNOWN'
  const label = candidate ? `UNVERIFIED candidate (${item.trustLevel})` : item.trustLevel
  const ref = item.sourceRef ? ` ref=${item.sourceRef}` : ''
  const asOf = item.validFrom.toISOString().slice(0, 10)
  const value = renderValue(item.value)
  return {
    candidate,
    rendered: `[${label}] ${item.key}: ${value} (source: ${item.sourceKind}${ref}, as of ${asOf})`,
  }
}

/**
 * Pure selection + budgeting over pre-scoped rows (rows are already
 * tenant/status/scope-filtered by the store). Deterministic: input order
 * (validFrom desc) is preserved.
 */
export function retrieveMemory(rows: MemoryItem[], q: MemoryQuery): MemoryBlock {
  const maxItems = Math.min(q.maxItems ?? MEMORY_LIMITS.defaultMaxItems, MEMORY_LIMITS.hardMaxItems)
  const budgetChars = Math.min(q.maxChars ?? MEMORY_LIMITS.defaultMaxChars, MEMORY_LIMITS.hardMaxChars)

  const eligible = q.includeCandidate
    ? rows
    : rows.filter((i) => i.trustLevel !== 'AI_DERIVED' && i.trustLevel !== 'UNKNOWN')

  const items: MemoryBlockItem[] = []
  let usedChars = 0
  let truncated = false
  for (const row of eligible) {
    if (items.length >= maxItems) {
      truncated = true
      break
    }
    const { rendered, candidate } = renderItem(row)
    if (usedChars + rendered.length > budgetChars) {
      truncated = true
      break
    }
    usedChars += rendered.length
    items.push({
      id: row.id,
      domain: row.domain,
      key: row.key,
      value: row.value,
      trustLevel: row.trustLevel,
      candidate,
      sourceKind: row.sourceKind,
      sourceRef: row.sourceRef,
      validFrom: row.validFrom,
      rendered,
    })
  }

  const trustSummary: Partial<Record<MemoryTrust, number>> = {}
  for (const it of items) {
    trustSummary[it.trustLevel] = (trustSummary[it.trustLevel] ?? 0) + 1
  }

  return {
    scope: q.scope,
    items,
    totalMatched: eligible.length,
    truncated,
    budgetChars,
    usedChars,
    candidateCount: items.filter((i) => i.candidate).length,
    trustSummary,
  }
}

/**
 * The prompt-safe section. Memory is ALWAYS presented as a distinct,
 * provenance-labeled block — never flattened into the structured record.
 */
export function serializeMemoryBlock(block: MemoryBlock): string {
  if (block.items.length === 0) return ''
  const lines = block.items.map((i) => i.rendered)
  const note = block.candidateCount > 0
    ? ` (${block.candidateCount} unverified candidate(s) — never for clinical decisions)`
    : ''
  const more = block.truncated ? ` [truncated: ${block.totalMatched} matched, ${block.items.length} shown]` : ''
  return `MEMORY (provenance-labeled context — not the medical record):${note}${more}\n` + lines.join('\n')
}

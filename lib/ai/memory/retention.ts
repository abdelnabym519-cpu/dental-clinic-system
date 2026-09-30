/**
 * Phase 8 — explicit retention policy per memory domain.
 *
 * §15 — these are IMPLEMENTATION DECISIONS (documented product policy),
 * NOT legal/regulatory requirements: DenToRa does not assert a
 * jurisdiction's legal retention period here. They are tenant-aware
 * (overridable through the existing Setting model) and auditable
 * (expiry is a memory event, not a silent delete).
 *
 * Working memory is not persisted at all — no retention applies.
 */

import type { MemoryDomain } from './types'

/** Default retention in days (null = no expiry). */
export const DEFAULT_RETENTION_DAYS: Record<MemoryDomain, number | null> = {
  // Operational configuration — persists until changed/corrected.
  CLINIC: null,
  // Doctor preferences — long-lived working knowledge.
  DOCTOR: 1825, // 5 years
  // Stable patient preferences / communication context.
  PATIENT: 730, // 24 months
  // Case timeline / findings — follows the case record horizon.
  CASE: 1825, // 5 years
  // Conversation summaries / decisions — short-lived continuity.
  CONVERSATION: 90, // 90 days
}

/** Setting keys (tenant-configurable overrides). */
export const RETENTION_SETTING_KEYS: Record<MemoryDomain, string | null> = {
  CLINIC: null,
  DOCTOR: 'memory_retention_doctor_days',
  PATIENT: 'memory_retention_patient_days',
  CASE: 'memory_retention_case_days',
  CONVERSATION: 'memory_retention_conversation_days',
}

/**
 * Retention for a domain: tenant override (a positive integer Setting)
 * wins over the default; a malformed override fails closed to the
 * default (never "no expiry" by accident).
 */
export function resolveRetentionDays(
  domain: MemoryDomain,
  tenantOverride?: string | null,
): number | null {
  const key = RETENTION_SETTING_KEYS[domain]
  if (key && tenantOverride) {
    const n = Number(tenantOverride)
    if (Number.isInteger(n) && n > 0) return n
    if (tenantOverride.trim().toLowerCase() === 'never') return DEFAULT_RETENTION_DAYS[domain]
  }
  return DEFAULT_RETENTION_DAYS[domain]
}

export function expiryFromNow(
  domain: MemoryDomain,
  now: Date,
  tenantOverride?: string | null,
): Date | null {
  const days = resolveRetentionDays(domain, tenantOverride)
  if (days === null) return null
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

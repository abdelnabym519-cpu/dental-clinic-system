/**
 * Phase 8 — memory content & scope validation (fail closed).
 *
 * Everything that enters persistent memory passes here:
 *  - key: stable, bounded, identifier-shaped (never free text)
 *  - value: bounded JSON, no dangerous members
 *  - confidence: fully sourced or absent
 *  - scope: domain-consistent, tenant-consistent
 *  - write class ↔ trust mapping: no escalation (a PATIENT statement is
 *    never persisted as DOCTOR_CONFIRMED / CLINICALLY_VERIFIED)
 *
 * The LLM never authorizes a write: the caller supplies the deterministic
 * write class, and this module proves the class/trust/scope triangle.
 */

import {
  KEY_PATTERN,
  MEMORY_DOMAINS,
  MEMORY_LIMITS,
  MEMORY_TYPES,
  MemoryError,
  type MemoryConfidence,
  type MemoryDomain,
  type MemoryScope,
  type MemoryTrust,
  type MemoryType,
  type MemoryWriteClass,
} from './types'

/** The only legal trust levels per write class (no escalation).
 *  EPHEMERAL is excluded — working memory is never persisted, so it has no
 *  durable trust level (consistent with CLASS_TO_ROLES). */
export const CLASS_TO_TRUST: Record<Exclude<MemoryWriteClass, 'EPHEMERAL' | 'FORBIDDEN'>, MemoryTrust[]> = {
  CANDIDATE_MEMORY: ['AI_DERIVED', 'UNKNOWN'],
  USER_CONFIRMED: ['USER_PROVIDED'],
  DOCTOR_CONFIRMED: ['DOCTOR_CONFIRMED', 'CLINICALLY_VERIFIED'],
  SYSTEM_VERIFIED: ['SYSTEM_DERIVED'],
}

/** Roles allowed to use each write class (deterministic, server-checked). */
export const CLASS_TO_ROLES: Record<Exclude<MemoryWriteClass, 'EPHEMERAL' | 'FORBIDDEN'>, string[]> = {
  CANDIDATE_MEMORY: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECH', 'PATIENT'],
  USER_CONFIRMED: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECH', 'PATIENT'],
  DOCTOR_CONFIRMED: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR'],
  SYSTEM_VERIFIED: ['SYSTEM'],
}

/** Domain → which scope columns MUST be set. */
const DOMAIN_REQUIRED: Record<MemoryDomain, (keyof Omit<MemoryScope, 'hospitalId' | 'domain'>)[]> = {
  CLINIC: [],
  DOCTOR: ['doctorId'],
  PATIENT: ['patientId'],
  CASE: ['caseId'],
  CONVERSATION: ['conversationId'],
}

/** Domain → roles that may WRITE (retrieval has its own matrix). */
export const DOMAIN_WRITE_ROLES: Record<MemoryDomain, string[]> = {
  CLINIC: ['SUPER_ADMIN', 'ADMIN', 'SYSTEM'],
  DOCTOR: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'SYSTEM'],
  PATIENT: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'PATIENT', 'SYSTEM'],
  CASE: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'SYSTEM'],
  CONVERSATION: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'PATIENT', 'SYSTEM'],
}

export function validateKey(key: unknown): string {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new MemoryError('MEMORY_KEY_INVALID', `memory key must match ${KEY_PATTERN}`)
  }
  return key
}

export function validateValue(value: unknown): void {
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    throw new MemoryError('MEMORY_CONTENT_INVALID', 'memory value must be JSON-serializable')
  }
  if (json === undefined || json === 'undefined') {
    throw new MemoryError('MEMORY_CONTENT_INVALID', 'memory value cannot be undefined')
  }
  if (json.length > MEMORY_LIMITS.maxValueChars) {
    throw new MemoryError(
      'MEMORY_CONTENT_INVALID',
      `memory value exceeds ${MEMORY_LIMITS.maxValueChars} chars`,
    )
  }
  if (json.length === 0) {
    throw new MemoryError('MEMORY_CONTENT_INVALID', 'memory value cannot be empty')
  }
  // Never persist prototype-polluting members.
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    if (json.includes(`"${bad}"`)) {
      throw new MemoryError('MEMORY_CONTENT_INVALID', `memory value may not contain "${bad}" members`)
    }
  }
}

export function validateConfidence(c: MemoryConfidence | null | undefined): MemoryConfidence | null {
  if (c === undefined || c === null) return null
  const ok =
    typeof c === 'object' &&
    Number.isFinite(c.value) &&
    c.value >= 0 &&
    c.value <= 1 &&
    typeof c.source === 'string' &&
    c.source.trim().length > 0 &&
    typeof c.semantics === 'string' &&
    c.semantics.trim().length > 0 &&
    (c.calibration === null || (typeof c.calibration === 'string' && c.calibration.trim().length > 0)) &&
    typeof c.version === 'string' &&
    c.version.trim().length > 0 &&
    typeof c.at === 'string' &&
    !Number.isNaN(Date.parse(c.at))
  if (!ok) {
    throw new MemoryError(
      'MEMORY_CONFIDENCE_INVALID',
      'confidence requires value(0..1), source, semantics, version, at; calibration null-or-string',
    )
  }
  return c
}

export function validateScope(scope: MemoryScope): void {
  if (!scope || typeof scope.hospitalId !== 'string' || !scope.hospitalId) {
    throw new MemoryError('MEMORY_SCOPE_MISMATCH', 'memory scope requires a tenant (hospitalId)')
  }
  if (!MEMORY_DOMAINS.includes(scope.domain)) {
    throw new MemoryError('MEMORY_SCOPE_MISMATCH', `unknown memory domain '${String(scope.domain)}'`)
  }
  for (const col of DOMAIN_REQUIRED[scope.domain]) {
    const v = scope[col]
    if (typeof v !== 'string' || !v) {
      throw new MemoryError('MEMORY_SCOPE_MISMATCH', `domain ${scope.domain} requires ${col}`)
    }
  }
}

/**
 * The full write-triangle check. Throws MemoryError on any violation —
 * the store never sees an invalid write.
 */
export function validateWrite({
  scope,
  key,
  value,
  memoryType,
  writeClass,
  trustLevel,
  actor,
  confidence,
}: {
  scope: MemoryScope
  key: unknown
  value: unknown
  memoryType: unknown
  writeClass: Exclude<MemoryWriteClass, 'EPHEMERAL' | 'FORBIDDEN'>
  trustLevel: MemoryTrust
  actor: { id: string; role: string }
  confidence?: MemoryConfidence | null
}): void {
  validateScope(scope)
  validateKey(key)
  validateValue(value)
  validateConfidence(confidence)
  if (!MEMORY_TYPES.includes(memoryType as MemoryType)) {
    throw new MemoryError('MEMORY_CONTENT_INVALID', `unknown memory type '${String(memoryType)}'`)
  }
  if (!actor || typeof actor.id !== 'string' || !actor.id || typeof actor.role !== 'string' || !actor.role) {
    throw new MemoryError('MEMORY_UNAUTHORIZED', 'memory writes require a server-resolved actor')
  }
  // Role → class.
  const roles = CLASS_TO_ROLES[writeClass]
  if (!roles.includes(actor.role)) {
    throw new MemoryError('MEMORY_UNAUTHORIZED', `role ${actor.role} cannot use write class ${writeClass}`)
  }
  // Class → trust (no escalation).
  const allowedTrust = CLASS_TO_TRUST[writeClass]
  if (!allowedTrust.includes(trustLevel)) {
    throw new MemoryError(
      'MEMORY_TRUST_ESCALATION',
      `write class ${writeClass} may only set trust ${allowedTrust.join('|')}, got ${trustLevel}`,
    )
  }
  // Domain → roles.
  if (!DOMAIN_WRITE_ROLES[scope.domain].includes(actor.role)) {
    throw new MemoryError('MEMORY_UNAUTHORIZED', `role ${actor.role} cannot write domain ${scope.domain}`)
  }
  // SYSTEM actor is reserved for system writes — and vice versa.
  if (actor.role === 'SYSTEM' && writeClass !== 'SYSTEM_VERIFIED') {
    throw new MemoryError('MEMORY_UNAUTHORIZED', 'SYSTEM actor may only use SYSTEM_VERIFIED')
  }
  if (actor.id === 'system' && actor.role !== 'SYSTEM') {
    throw new MemoryError('MEMORY_TRUST_ESCALATION', 'the system identity may not act as a user')
  }
}

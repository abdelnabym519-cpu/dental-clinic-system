/**
 * Phase 2 — Role → Context permission matrix.
 *
 * Minimum Necessary Disclosure (§17/§18): retrieval happens AFTER permission
 * filtering — an unauthorized field is OMITTED (absent), never retrieved and
 * hidden inside the prompt. The matrix mirrors what each role can already
 * see in the application (e.g. clinical notes: `isPrivate` notes are
 * DOCTOR/ADMIN only — same rule as GET /api/clinical-notes).
 *
 * The PATIENT role is special-cased: it may only ever build context for its
 * OWN patient record (enforced in the service), and always with the most
 * restrictive field policy below.
 */

import type { ContextSectionKey } from './types'

export type RoleName =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'DOCTOR'
  | 'RECEPTIONIST'
  | 'LAB_TECH'
  | 'ACCOUNTANT'
  | 'PATIENT'

export const STAFF_ROLES: RoleName[] = [
  'SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT',
]

const CAN_SEE_SECTION: Record<ContextSectionKey, RoleName[]> = {
  // Identity basics (name/age/gender) — every staff role works with patients.
  // PATIENT sees only its OWN record (self-scope enforced in the service) and
  // no contact block (canSeeContact excludes PATIENT).
  identity: [...STAFF_ROLES, 'PATIENT'],
  // Allergies, conditions, medications — clinical decision support.
  medical: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'],
  // Dental chart — clinical + operational (reception books charts in).
  dental: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'],
  // Own schedule — the patient portal already shows appointments.
  appointments: [...STAFF_ROLES, 'PATIENT'],
  // Notes: non-private for ops roles, private only DOCTOR/ADMIN (app rule).
  clinical: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'],
  cases: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT'],
  treatments: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'],
  prescriptions: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR'],
  imaging: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'LAB_TECH'],
  financial: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT'],
  risk: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR'],
  timeline: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST'],
}

export function canSeeSection(role: string, section: ContextSectionKey): boolean {
  const allowed = CAN_SEE_SECTION[section]
  return allowed.some((r) => r === role || (r === 'ADMIN' && role === 'SUPER_ADMIN'))
}

/** Identity.contact (phone/email) — not every role needs contact details. */
export function canSeeContact(role: string): boolean {
  return ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT'].includes(role)
}

/**
 * Field-level omissions (beyond section visibility):
 *  - RECEPTIONIST on treatments/cases: operational fields only (no clinical
 *    text: diagnosis/findings/notes/complaints);
 *  - ACCOUNTANT on cases: billing fields only (title/status/cost), no
 *    clinical text;
 *  - PATIENT: never sees clinical free text beyond their own non-private
 *    notes, never sees AI findings or risk factor internals.
 */
export type FieldScope = 'full' | 'operational' | 'billing' | 'self'

export function fieldScope(role: string, section: ContextSectionKey): FieldScope {
  if (role === 'PATIENT') return 'self'
  if (role === 'RECEPTIONIST' && (section === 'treatments' || section === 'cases')) return 'operational'
  if (role === 'ACCOUNTANT' && (section === 'cases' || section === 'treatments')) return 'billing'
  return 'full'
}

/** Private clinical notes are DOCTOR/ADMIN only (mirrors /api/clinical-notes). */
export function canSeePrivateNotes(role: string): boolean {
  return role === 'DOCTOR' || role === 'ADMIN' || role === 'SUPER_ADMIN'
}

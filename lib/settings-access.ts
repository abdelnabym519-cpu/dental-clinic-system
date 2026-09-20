/**
 * Settings-area authorization (RBAC) — single source of truth.
 *
 * Enforced server-side in two places (defense in depth):
 *   1. middleware.ts       — coarse gate: unauthorized roles are rewritten to
 *                            /settings/access-denied (a proper forbidden page),
 *                            never redirected to /dashboard.
 *   2. settings pages      — server pages re-check with canAccessSettingsSection
 *                            before rendering sensitive sections.
 *
 * Role matrix (product mandate):
 *   ADMIN        — every settings section
 *   ACCOUNTANT   — profile + billing
 *   DOCTOR       — profile only
 *   RECEPTIONIST — profile only
 *   LAB_TECH     — profile only
 *
 * Any section not listed below is clinic-wide configuration and therefore
 * ADMIN-only. The /settings index (hub) and the access-denied page itself are
 * readable by every authenticated role, so the hub can link only to what the
 * current role may open.
 *
 * Keep this module dependency-free (no Prisma, no next/server) so it can be
 * imported from the Edge middleware bundle and unit-tested in isolation.
 */

/** Every staff role that can sign in (mirrors the `Role` enum in schema.prisma). */
export const STAFF_ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECH'] as const

export type StaffRole = (typeof STAFF_ROLES)[number]

const ALL_ROLES: readonly string[] = STAFF_ROLES

/** Sections with an explicitly widened audience. Everything else: ADMIN only. */
export const SETTINGS_SECTION_ROLES: Record<string, readonly string[]> = {
  profile: ALL_ROLES,
  billing: ['ADMIN', 'ACCOUNTANT'],
}

const ADMIN_ONLY: readonly string[] = ['ADMIN']

/** Pseudo-section for the settings hub itself — visible to every authenticated role. */
export const SETTINGS_INDEX_SECTION = 'index'

/** Pseudo-section for the forbidden page — must always be reachable to render. */
export const SETTINGS_DENIED_SECTION = 'access-denied'

/**
 * Extract the settings section from a pathname.
 * Returns 'index' for the hub, the section slug for /settings/<section>[/*],
 * or null when the path is not part of the settings area.
 */
export function settingsSectionFromPath(pathname: string): string | null {
  if (pathname === '/settings') return SETTINGS_INDEX_SECTION
  if (!pathname.startsWith('/settings/')) return null
  // Slice off "/settings/", then keep the first path segment only
  // (query strings and hash fragments never appear in nextUrl.pathname,
  //  but this keeps the function safe for arbitrary input).
  const rest = pathname.slice('/settings/'.length).split(/[?#]/)[0].split('/')[0]
  return rest === '' ? SETTINGS_INDEX_SECTION : rest
}

/** Look up the roles allowed for a section without deciding about a user. */
export function rolesForSettingsSection(section: string): readonly string[] {
  if (section === SETTINGS_INDEX_SECTION || section === SETTINGS_DENIED_SECTION) return ALL_ROLES
  return SETTINGS_SECTION_ROLES[section] ?? ADMIN_ONLY
}

/**
 * May `role` open `pathname` inside the settings area?
 * Unknown or missing roles are denied (secure default).
 * Non-settings paths yield false by definition — callers should check
 * settingsSectionFromPath first when the path may be outside the area.
 */
export function canAccessSettingsSection(pathname: string, role: string | null | undefined): boolean {
  const section = settingsSectionFromPath(pathname)
  if (section === null) return false
  if (!role) return false
  return rolesForSettingsSection(section).includes(role)
}

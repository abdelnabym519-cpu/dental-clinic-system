/**
 * Phase 9 — shared API-route helpers for the intelligence surface (§37–§39).
 *
 * Conventions (same class as the Phase 4/6/8 additive routes):
 *  - actor + tenant come from the SESSION — the client never asserts them;
 *  - every patient/case scope is RE-VALIDATED server-side against the
 *    tenant (a PATIENT is pinned to their own linked patient);
 *  - errors are machine-readable: { error: { code, messageKey, message } }
 *    where `code` is an INT_* typed failure and `messageKey` is a flat i18n
 *    key (ar/en) — never a free-form English error for Arabic users.
 */

import { NextResponse } from 'next/server'
import type { IntelligenceErrorCode } from '@/lib/ai/intelligence/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RoutePrisma = any

/** Staff roles allowed on the intelligence surface (PATIENT handled below). */
export const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST']

export const INT_ERROR_KEYS: Record<string, string> = {
  INT_UNAUTHORIZED: 'aiIntelligence.error.unauthorized',
  INT_PATIENT_NOT_FOUND: 'aiIntelligence.error.scopeNotFound',
  INT_SCOPE_MISMATCH: 'aiIntelligence.error.scopeNotFound',
  INT_CASE_NOT_FOUND: 'aiIntelligence.error.scopeNotFound',
  INT_GRAPH_BUILD_FAILED: 'aiIntelligence.error.notFound',
  INT_NOT_AVAILABLE: 'aiIntelligence.error.notFound',
  INT_INVALID_PARAMS: 'aiIntelligence.error.invalid',
  INT_ROLE_DENIED: 'aiIntelligence.error.roleDenied',
  INT_WORKFLOW_NOT_FOUND: 'aiIntelligence.error.notFound',
  INT_WORKFLOW_INVALID_TRANSITION: 'aiIntelligence.error.conflict',
  INT_WORKFLOW_LIMIT_EXCEEDED: 'aiIntelligence.error.conflict',
  INT_WORKFLOW_NOT_RUNNABLE: 'aiIntelligence.error.invalid',
  INT_WORKFLOW_ROLE_DENIED: 'aiIntelligence.error.roleDenied',
  INT_WORKFLOW_EXPIRED: 'aiIntelligence.error.expired',
  INT_ALERT_NOT_FOUND: 'aiIntelligence.error.notFound',
  INT_PROACTIVE_FAILED: 'aiIntelligence.error.invalid',
}

export function intErr(code: string, message: string, status = 400) {
  return NextResponse.json(
    { error: { code, messageKey: INT_ERROR_KEYS[code] ?? 'aiIntelligence.error.invalid', message } },
    { status },
  )
}

export function wfErr(code: string, message: string, status = 400) {
  const KEYS: Record<string, string> = {
    INT_WORKFLOW_NOT_FOUND: 'aiWorkflow.error.notFound',
    INT_WORKFLOW_INVALID_TRANSITION: 'aiWorkflow.error.invalidTransition',
    INT_WORKFLOW_LIMIT_EXCEEDED: 'aiWorkflow.error.limitExceeded',
    INT_WORKFLOW_NOT_RUNNABLE: 'aiWorkflow.error.unrunnable',
    INT_WORKFLOW_ROLE_DENIED: 'aiWorkflow.error.roleDenied',
    INT_WORKFLOW_EXPIRED: 'aiWorkflow.error.expired',
    INT_INVALID_PARAMS: 'aiWorkflow.error.invalid',
    INT_PATIENT_NOT_FOUND: 'aiWorkflow.error.scopeNotFound',
    INT_SCOPE_MISMATCH: 'aiWorkflow.error.scopeNotFound',
    INT_UNAUTHORIZED: 'aiWorkflow.error.unauthorized',
  }
  return NextResponse.json(
    { error: { code, messageKey: KEYS[code] ?? 'aiWorkflow.error.invalid', message } },
    { status },
  )
}

export interface SessionUser {
  id: string
  role: string
  name?: string
  firstName?: string
  lastName?: string
}

/**
 * Re-validate a client-supplied patientId against the tenant. Returns the
 * tenant-verified patient row or null. A PATIENT may only reference their
 * OWN linked patient — everything else is null (fail closed, 404).
 */
export async function resolvePatientScope(
  prisma: RoutePrisma,
  hospitalId: string,
  user: SessionUser,
  patientId: unknown,
): Promise<{ id: string; firstName: string | null; lastName: string | null; hospitalId: string } | null> {
  const id = typeof patientId === 'string' && patientId ? patientId : null
  if (!id) return null

  if (user.role === 'PATIENT') {
    const linked = await prisma.patient.findFirst({
      where: { hospitalId, portalUser: { is: { id: user.id } } },
      select: { id: true, firstName: true, lastName: true, hospitalId: true },
    })
    if (!linked || linked.id !== id) return null
    return linked
  }

  const p = await prisma.patient.findFirst({
    where: { hospitalId, id },
    select: { id: true, firstName: true, lastName: true, hospitalId: true },
  })
  return p ?? null
}

/** Re-validate a caseId (TreatmentPlan) against the tenant + patient. */
export async function resolveCaseScope(
  prisma: RoutePrisma,
  hospitalId: string,
  patientId: string,
  caseId: unknown,
): Promise<string | null> {
  const id = typeof caseId === 'string' && caseId ? caseId : null
  if (!id) return null
  const c = await prisma.treatmentPlan.findFirst({
    where: { hospitalId, patientId, id },
    select: { id: true },
  })
  return c?.id ?? null
}

/** Fire-and-forget audit (same convention as the knowledge route). */
export function writeAudit(
  prisma: RoutePrisma,
  p: { hospitalId: string; userId: string; action: string; entityType: string; entityId: string; newValues?: Record<string, unknown> },
): void {
  prisma.auditLog
    .create({
      data: {
        hospitalId: p.hospitalId,
        userId: p.userId,
        action: p.action,
        entityType: p.entityType,
        entityId: p.entityId,
        newValues: JSON.stringify(p.newValues ?? {}),
      },
    })
    .catch((e: unknown) => console.error('AI intelligence audit failed:', e instanceof Error ? e.message : e))
}

export function userName(u: SessionUser): string {
  return u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 20)
}

export type { IntelligenceErrorCode }

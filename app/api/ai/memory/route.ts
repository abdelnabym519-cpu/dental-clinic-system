/**
 * Phase 8 — Memory API (canonical; additive).
 *
 * POST /api/ai/memory
 *   body: { op: 'write' | 'correct' | 'invalidate' | 'delete' | 'list', ... }
 *
 * Security model (same class as the knowledge/agent routes):
 *  - actor + tenant come from the SESSION — the client never asserts them.
 *  - scope columns (patientId/doctorId/caseId/conversationId) are
 *    RE-VALIDATED server-side against the tenant; a PATIENT may only touch
 *    their OWN linked patient + their own conversations.
 *  - trust/policy rules live in lib/ai/memory (validation.ts) — the route
 *    only transports; it cannot escalate trust or cross tenants.
 *  - errors are machine-readable: { error: { code, messageKey, message } }
 *    where `code` is a MEMORY_* typed failure and `messageKey` is a flat
 *    i18n key (ar/en) — never a free-form English error in ar.
 *
 * This route is ADDITIVE: no agent/context/action pipeline is touched.
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const ERROR_KEYS: Record<string, string> = {
  MEMORY_UNAUTHORIZED: 'aiMemory.error.unauthorized',
  MEMORY_SCOPE_MISMATCH: 'aiMemory.error.scopeNotFound',
  MEMORY_TENANT_MISMATCH: 'aiMemory.error.scopeNotFound',
  MEMORY_NOT_FOUND: 'aiMemory.error.notFound',
  MEMORY_NOT_ACTIVE: 'aiMemory.error.notFound',
  MEMORY_CONTENT_INVALID: 'aiMemory.error.invalid',
  MEMORY_KEY_INVALID: 'aiMemory.error.invalid',
  MEMORY_CONFIDENCE_INVALID: 'aiMemory.error.invalid',
  MEMORY_TRUST_ESCALATION: 'aiMemory.error.invalid',
  MEMORY_WRITE_CLASS_MISMATCH: 'aiMemory.error.invalid',
  MEMORY_DUPLICATE_ACTIVE: 'aiMemory.error.conflict',
}

import { expiryFromNow } from '@/lib/ai/memory/retention'

function defaultExpiry(domain: string): Date | null {
  if (!['CLINIC', 'DOCTOR', 'PATIENT', 'CASE', 'CONVERSATION'].includes(domain)) return null
  return expiryFromNow(domain as never, new Date())
}

function err(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, messageKey: ERROR_KEYS[code] ?? 'aiMemory.error.invalid', message } },
    { status },
  )
}

const MESSAGES: Record<string, string> = {
  MEMORY_UNAUTHORIZED: 'not allowed',
  MEMORY_SCOPE_MISMATCH: 'scope not found',
  MEMORY_TENANT_MISMATCH: 'tenant mismatch',
  MEMORY_NOT_FOUND: 'not found',
  MEMORY_NOT_ACTIVE: 'not active',
  MEMORY_CONTENT_INVALID: 'invalid content',
  MEMORY_KEY_INVALID: 'invalid key',
  MEMORY_CONFIDENCE_INVALID: 'invalid confidence',
  MEMORY_TRUST_ESCALATION: 'trust escalation',
  MEMORY_WRITE_CLASS_MISMATCH: 'write class mismatch',
  MEMORY_DUPLICATE_ACTIVE: 'duplicate active',
}

/**
 * Re-validate a client-supplied scope against the tenant. Returns null on
 * failure (the caller responds 404/403). A PATIENT is pinned to their own
 * linked patient and their own conversations.
 */
async function resolveScope(
  hospitalId: string,
  user: { id: string; role: string },
  body: Record<string, unknown>,
): Promise<{
  domain: string
  doctorId: string | null
  patientId: string | null
  caseId: string | null
  conversationId: string | null
} | null> {
  const domain = typeof body.domain === 'string' ? body.domain : null
  if (!domain || !['CLINIC', 'DOCTOR', 'PATIENT', 'CASE', 'CONVERSATION'].includes(domain)) return null
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

  if (user.role === 'PATIENT') {
    // A patient may only act on their OWN linked patient / conversations.
    const linked = await prisma.patient.findFirst({
      where: { hospitalId, portalUser: { is: { id: user.id } } },
      select: { id: true },
    })
    const ownPatientId = linked?.id ?? null
    if (domain === 'PATIENT') {
      if (str(body.patientId) !== ownPatientId || !ownPatientId) return null
      return { domain, doctorId: null, patientId: ownPatientId, caseId: null, conversationId: null }
    }
    if (domain === 'CONVERSATION') {
      const cid = str(body.conversationId)
      if (!cid) return null
      const conv = await prisma.aIConversation.findFirst({
        where: { hospitalId, id: cid, userId: user.id },
        select: { id: true },
      })
      return conv ? { domain, doctorId: null, patientId: null, caseId: null, conversationId: cid } : null
    }
    return null
  }

  const out = {
    domain,
    doctorId: str(body.doctorId),
    patientId: str(body.patientId),
    caseId: str(body.caseId),
    conversationId: str(body.conversationId),
  }
  if (domain === 'DOCTOR' && out.doctorId) {
    const s = await prisma.staff.findFirst({
      where: { hospitalId, id: out.doctorId },
      select: { id: true },
    })
    if (!s) return null
  }
  if (domain === 'PATIENT' && out.patientId) {
    const p = await prisma.patient.findFirst({
      where: { hospitalId, id: out.patientId },
      select: { id: true },
    })
    if (!p) return null
  }
  if (domain === 'CASE' && out.caseId) {
    const t = await prisma.treatment.findFirst({
      where: { hospitalId, id: out.caseId },
      select: { id: true },
    })
    if (!t) return null
  }
  if (domain === 'CONVERSATION' && out.conversationId) {
    const c = await prisma.aIConversation.findFirst({
      where: { hospitalId, id: out.conversationId },
      select: { id: true },
    })
    if (!c) return null
  }
  return out
}

export async function POST(req: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    // Dictionary-backed message (ar + en) — the i18n sweep requires every
    // prose API error to be translatable, never free-form English.
    return err('MEMORY_CONTENT_INVALID', 'The memory request was invalid.', 400)
  }

  const op = typeof body.op === 'string' ? body.op : null
  if (!op || !['write', 'correct', 'invalidate', 'delete', 'list'].includes(op)) {
    return err('MEMORY_CONTENT_INVALID', 'op must be write|correct|invalidate|delete|list', 400)
  }

  const { PrismaMemoryStore } = await import('@/lib/ai/memory/store')
  const store = new PrismaMemoryStore(prisma)
  const actor = { id: user.id, name: user.name ?? null, role: user.role }
  const scope = await resolveScope(hospitalId, { id: user.id, role: user.role }, body)
  if (!scope) return err('MEMORY_SCOPE_MISMATCH', 'scope not found in this clinic', 404)
  const fullScope = { hospitalId, ...scope }

  try {
    switch (op) {
      case 'write': {
        const key = typeof body.key === 'string' ? body.key : null
        const value = body.value
        const memoryType = typeof body.memoryType === 'string' ? body.memoryType : null
        const writeClass = typeof body.writeClass === 'string' ? body.writeClass : null
        const sourceKind = typeof body.sourceKind === 'string' ? body.sourceKind : null
        if (!key || value === undefined || !memoryType || !writeClass || !sourceKind) {
          return err('MEMORY_CONTENT_INVALID', 'key, value, memoryType, writeClass, sourceKind required', 400)
        }
        // Only USER_CONFIRMED is ever allowed through a user API — the
        // doctor/system classes need their own trust flows, and CANDIDATE
        // (AI_DERIVED) is never client-authored.
        if (writeClass !== 'USER_CONFIRMED') {
          return err('MEMORY_WRITE_CLASS_MISMATCH', 'API writes accept USER_CONFIRMED only', 400)
        }
        const item = await store.write({
          scope: fullScope as never,
          key,
          value,
          memoryType: memoryType as never,
          writeClass: 'USER_CONFIRMED',
          trustLevel: 'USER_PROVIDED',
          sourceKind: sourceKind as never,
          sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef : null,
          confidence: body.confidence as never,
          expiresAt:
            typeof body.expiresAt === 'string' && !Number.isNaN(Date.parse(body.expiresAt))
              ? new Date(body.expiresAt)
              : defaultExpiry(scope.domain),
          actor: actor as never,
        })
        return NextResponse.json({ ok: true, id: item.id }, { status: 201 })
      }
      case 'correct': {
        const id = typeof body.id === 'string' ? body.id : null
        const value = body.value
        const reason = typeof body.reason === 'string' && body.reason ? body.reason : null
        if (!id || value === undefined) return err('MEMORY_CONTENT_INVALID', 'id and value required', 400)
        const old = await store.getActive(id, hospitalId)
        if (!old) return err('MEMORY_NOT_FOUND', 'not found', 404)
        // Doctor-confirmed correction (the only trust-UP path a user may
        // take here); a same-trust correction keeps the actor's class.
        const writeClass = user.role === 'DOCTOR' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
          ? 'DOCTOR_CONFIRMED'
          : 'USER_CONFIRMED'
        const trustLevel = writeClass === 'DOCTOR_CONFIRMED' ? 'DOCTOR_CONFIRMED' : 'USER_PROVIDED'
        const item = await store.supersede(
          id,
          {
            scope: fullScope as never,
            key: old.key,
            value,
            memoryType: old.memoryType,
            writeClass: writeClass as never,
            trustLevel: trustLevel as never,
            sourceKind: 'USER_CONFIRMATION',
            sourceRef: null,
            expiresAt: null,
            actor: actor as never,
          },
          reason ?? 'correction',
        )
        return NextResponse.json({ ok: true, id: item.id, superseded: old.id })
      }
      case 'invalidate':
      case 'delete': {
        const id = typeof body.id === 'string' ? body.id : null
        const reason = typeof body.reason === 'string' && body.reason ? body.reason : null
        if (!id) return err('MEMORY_CONTENT_INVALID', 'id required', 400)
        // Note: keep the calls bound to `store` — the store methods use
        // `this`; detaching the reference (fn(...)) breaks them.
        const item = op === 'invalidate'
          ? await store.invalidate(id, hospitalId, actor as never, reason ?? 'requested by user')
          : await store.delete(id, hospitalId, actor as never, reason ?? 'requested by user')
        return NextResponse.json({ ok: true, id: item.id, status: item.status })
      }
      case 'list': {
        const block = await store.query({ scope: fullScope as never, includeCandidate: false })
        return NextResponse.json({
          ok: true,
          items: block.items.map((i) => ({
            id: i.id,
            key: i.key,
            value: i.value,
            trustLevel: i.trustLevel,
            sourceKind: i.sourceKind,
            validFrom: i.validFrom.toISOString(),
          })),
          totalMatched: block.totalMatched,
        })
      }
    }
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? String((e as { code: string }).code) : 'MEMORY_CONTENT_INVALID'
    const status = code === 'MEMORY_UNAUTHORIZED' ? 403 : code === 'MEMORY_NOT_FOUND' || code === 'MEMORY_NOT_ACTIVE' ? 404 : code === 'MEMORY_DUPLICATE_ACTIVE' ? 409 : 400
    return err(code, MESSAGES[code] ?? 'failed', status)
  }
}

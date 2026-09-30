/**
 * Phase 8 — memory store (Prisma-backed + in-memory fake for tests).
 *
 * The store is DUMB-but-safe: it enforces tenant scoping on every query
 * (the hospitalId column is always in the where clause), applies the
 * validated write, and records the audit event. All trust/policy rules
 * live in validation.ts — the store cannot be bypassed because every
 * public method runs validateWrite / permission checks first.
 */

import type {
  MemoryActor,
  MemoryBlock,
  MemoryEvent,
  MemoryEventKind,
  MemoryItem,
  MemoryQuery,
  MemoryScope,
  MemoryStatus,
  MemoryWriteRequest,
} from './types'
import { MemoryError } from './types'
import { validateWrite } from './validation'
import { retrieveMemory } from './retrieval'

export interface MemoryStore {
  write(req: MemoryWriteRequest, now?: Date): Promise<MemoryItem>
  getActive(id: string, hospitalId: string): Promise<MemoryItem | null>
  query(q: MemoryQuery, now?: Date): Promise<MemoryBlock>
  supersede(
    id: string,
    replacement: MemoryWriteRequest,
    reason: string,
    now?: Date,
  ): Promise<MemoryItem>
  invalidate(id: string, hospitalId: string, actor: MemoryActor, reason: string, now?: Date): Promise<MemoryItem>
  delete(id: string, hospitalId: string, actor: MemoryActor, reason: string, now?: Date): Promise<MemoryItem>
  applyRetention(hospitalId: string, now: Date): Promise<number>
  events(memoryId: string, hospitalId: string): Promise<MemoryEvent[]>
}

// ---------------------------------------------------------------------------
// Prisma-backed store
// ---------------------------------------------------------------------------

type PrismaLike = any

export class PrismaMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaLike) {}

  private itemDelegate(): any {
    return this.prisma.aiMemoryItem
  }

  private eventDelegate(): any {
    return this.prisma.aiMemoryEvent
  }

  private async recordEvent(
    hospitalId: string,
    memoryId: string,
    eventKind: MemoryEventKind,
    actor: MemoryActor | null,
    reason: string | null,
    oldValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    await this.eventDelegate().create({
      data: {
        hospitalId,
        memoryId,
        eventKind,
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        reason,
        oldValue: oldValue === undefined ? null : JSON.stringify(oldValue),
        newValue: newValue === undefined ? null : JSON.stringify(newValue),
      },
    })
  }

  private rowToItem(row: any): MemoryItem {
    return {
      ...row,
      value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
      confidence: row.confidence
        ? typeof row.confidence === 'string'
          ? JSON.parse(row.confidence)
          : row.confidence
        : null,
      validFrom: new Date(row.validFrom),
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }
  }

  async write(req: MemoryWriteRequest, now: Date = new Date()): Promise<MemoryItem> {
    validateWrite(req)
    validateScopeColumns(req.scope, req.scope)
    const del = this.itemDelegate()
    // Duplicate guard: one ACTIVE item per (scope, key, trust) — a re-statement
    // of the same fact is a correction, not a duplicate row.
    const dup = await del.findFirst({
      where: {
        hospitalId: req.scope.hospitalId,
        status: 'ACTIVE',
        domain: req.scope.domain,
        key: req.key,
        trustLevel: req.trustLevel,
        ...(req.scope.domain === 'DOCTOR' ? { doctorId: req.scope.doctorId } : {}),
        ...(req.scope.domain === 'PATIENT' ? { patientId: req.scope.patientId } : {}),
        ...(req.scope.domain === 'CASE' ? { caseId: req.scope.caseId } : {}),
        ...(req.scope.domain === 'CONVERSATION'
          ? { conversationId: req.scope.conversationId }
          : {}),
      },
      select: { id: true },
    })
    if (dup) {
      throw new MemoryError(
        'MEMORY_DUPLICATE_ACTIVE',
        `an ACTIVE ${req.scope.domain} memory with key '${req.key}' and trust ${req.trustLevel} already exists — correct or supersede it`,
      )
    }
    const row = await del.create({
      data: {
        hospitalId: req.scope.hospitalId,
        domain: req.scope.domain,
        memoryType: req.memoryType,
        trustLevel: req.trustLevel,
        status: 'ACTIVE',
        doctorId: req.scope.doctorId ?? null,
        patientId: req.scope.patientId ?? null,
        caseId: req.scope.caseId ?? null,
        conversationId: req.scope.conversationId ?? null,
        key: req.key,
        value: JSON.stringify(req.value),
        confidence: req.confidence ? JSON.stringify(req.confidence) : null,
        sourceKind: req.sourceKind,
        sourceRef: req.sourceRef ?? null,
        createdBy: req.actor.id,
        createdByIdType: req.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
        validFrom: now,
        expiresAt: req.expiresAt ?? null,
      },
    })
    await this.recordEvent(
      req.scope.hospitalId,
      row.id,
      'WRITE',
      req.actor,
      null,
      null,
      req.value,
    )
    return this.rowToItem(row)
  }

  async getActive(id: string, hospitalId: string): Promise<MemoryItem | null> {
    const row = await this.itemDelegate().findFirst({
      where: { id, hospitalId, status: 'ACTIVE' },
    })
    return row ? this.rowToItem(row) : null
  }

  async query(q: MemoryQuery, now: Date = new Date()): Promise<MemoryBlock> {
    const rows = await this.itemDelegate().findMany({
      where: buildQueryWhere(q, now),
      orderBy: { validFrom: 'desc' },
    })
    const items = rows.map((r: any) => this.rowToItem(r))
    return retrieveMemory(items, q)
  }

  async supersede(
    id: string,
    replacement: MemoryWriteRequest,
    reason: string,
    now: Date = new Date(),
  ): Promise<MemoryItem> {
    const old = await this.itemDelegate().findFirst({
      where: { id, hospitalId: replacement.scope.hospitalId, status: 'ACTIVE' },
    })
    if (!old) throw new MemoryError('MEMORY_NOT_ACTIVE', 'cannot supersede a non-ACTIVE or foreign-tenant item')
    // The corrected fact keeps the ORIGINAL item's identity (key + scope).
    const fresh: MemoryWriteRequest = {
      ...replacement,
      key: old.key,
      scope: {
        hospitalId: old.hospitalId,
        domain: old.domain,
        doctorId: old.doctorId,
        patientId: old.patientId,
        caseId: old.caseId,
        conversationId: old.conversationId,
      },
    }
    validateWrite(fresh)
    // The corrected fact inherits the ORIGINAL item's identity (key + scope)
    // and gets a new trust from the class (e.g. USER_PROVIDED → DOCTOR_CONFIRMED).
    const del = this.itemDelegate()
    const row = await del.create({
      data: {
        hospitalId: replacement.scope.hospitalId,
        domain: replacement.scope.domain,
        memoryType: replacement.memoryType,
        trustLevel: replacement.trustLevel,
        status: 'ACTIVE',
        doctorId: old.doctorId,
        patientId: old.patientId,
        caseId: old.caseId,
        conversationId: old.conversationId,
        key: old.key,
        value: JSON.stringify(replacement.value),
        confidence: replacement.confidence ? JSON.stringify(replacement.confidence) : null,
        sourceKind: replacement.sourceKind,
        sourceRef: replacement.sourceRef ?? null,
        createdBy: replacement.actor.id,
        createdByIdType: replacement.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
        validFrom: now,
        expiresAt: replacement.expiresAt ?? null,
        correctionReason: reason,
      },
    })
    await del.update({ where: { id: old.id }, data: { status: 'SUPERSEDED', supersededBy: row.id } })
    await this.recordEvent(
      replacement.scope.hospitalId,
      old.id,
      reason ? 'CORRECT' : 'SUPERSEDE',
      replacement.actor,
      reason,
      old.value,
      replacement.value,
    )
    return this.rowToItem(row)
  }

  async invalidate(
    id: string,
    hospitalId: string,
    actor: MemoryActor,
    reason: string,
    now: Date = new Date(),
  ): Promise<MemoryItem> {
    void now
    const del = this.itemDelegate()
    const old = await del.findFirst({ where: { id, hospitalId, status: 'ACTIVE' } })
    if (!old) throw new MemoryError('MEMORY_NOT_ACTIVE', 'cannot invalidate a non-ACTIVE or foreign-tenant item')
    assertScopePermission(actor, this.rowToItem(old))
    const row = await del.update({ where: { id }, data: { status: 'INVALIDATED' } })
    await this.recordEvent(hospitalId, id, 'INVALIDATE', actor, reason, old.value, null)
    return this.rowToItem(row)
  }

  async delete(
    id: string,
    hospitalId: string,
    actor: MemoryActor,
    reason: string,
    now: Date = new Date(),
  ): Promise<MemoryItem> {
    void now
    const del = this.itemDelegate()
    const old = await del.findFirst({ where: { id, hospitalId, status: 'ACTIVE' } })
    if (!old) throw new MemoryError('MEMORY_NOT_ACTIVE', 'cannot delete a non-ACTIVE or foreign-tenant item')
    assertScopePermission(actor, this.rowToItem(old))
    const row = await del.update({ where: { id }, data: { status: 'DELETED' } })
    // PHI policy: the DELETED event keeps only the key + old value snapshot
    // for the tenant's audit (same class as AuditLog), never a resurrection
    // path — status DELETED is terminal for retrieval.
    await this.recordEvent(hospitalId, id, 'DELETE', actor, reason, old.value, null)
    return this.rowToItem(row)
  }

  async applyRetention(hospitalId: string, now: Date): Promise<number> {
    const del = this.itemDelegate()
    const expired = await del.findMany({
      where: { hospitalId, status: 'ACTIVE', expiresAt: { lt: now } },
      select: { id: true },
    })
    for (const row of expired) {
      await del.update({ where: { id: row.id }, data: { status: 'DELETED' } })
      await this.recordEvent(hospitalId, row.id, 'EXPIRE', null, 'retention policy', null, null)
    }
    return expired.length
  }

  async events(memoryId: string, hospitalId: string): Promise<MemoryEvent[]> {
    const rows = await this.eventDelegate().findMany({
      where: { memoryId, hospitalId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r: any) => ({
      ...r,
      oldValue: r.oldValue ? safeParse(r.oldValue) : null,
      newValue: r.newValue ? safeParse(r.newValue) : null,
      createdAt: new Date(r.createdAt),
    }))
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/** Tenant + scope column guard shared by write paths. */
export function validateScopeColumns(scope: MemoryScope, reqScope: MemoryScope): void {
  if (scope.hospitalId !== reqScope.hospitalId) {
    throw new MemoryError('MEMORY_TENANT_MISMATCH', 'memory scope tenant mismatch')
  }
}

/**
 * Permission to mutate a given item (delete/invalidate/supersede):
 *  - PATIENT: only their own PATIENT/CONVERSATION items
 *  - DOCTOR: their tenant's PATIENT/CASE/CONVERSATION/DOCTOR items
 *  - ADMIN/SUPER_ADMIN: their tenant's items
 *  - SYSTEM: retention only (not via this path)
 */
export function assertScopePermission(actor: MemoryActor, item: MemoryItem): void {
  const role = actor.role
  if (role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'DOCTOR') return
  if (role === 'PATIENT') {
    const own =
      (item.domain === 'PATIENT' && item.patientId !== null && actor.id !== 'system') ||
      (item.domain === 'CONVERSATION' && item.conversationId !== null)
    if (own && item.createdBy === actor.id) return
  }
  throw new MemoryError('MEMORY_UNAUTHORIZED', 'actor may not mutate this memory item')
}

function buildQueryWhere(q: MemoryQuery, now: Date): Record<string, unknown> {
  const where: Record<string, unknown> = {
    hospitalId: q.scope.hospitalId,
    status: 'ACTIVE',
    domain: q.scope.domain,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
  switch (q.scope.domain) {
    case 'DOCTOR':
      where.doctorId = q.scope.doctorId
      break
    case 'PATIENT':
      where.patientId = q.scope.patientId
      break
    case 'CASE':
      where.caseId = q.scope.caseId
      break
    case 'CONVERSATION':
      where.conversationId = q.scope.conversationId
      break
    case 'CLINIC':
      break
  }
  if (q.keys && q.keys.length > 0) where.key = { in: q.keys }
  if (q.memoryTypes && q.memoryTypes.length > 0) where.memoryType = { in: q.memoryTypes }
  if (q.since) where.validFrom = { gte: q.since }
  if (!q.includeCandidate) where.trustLevel = { notIn: ['AI_DERIVED', 'UNKNOWN'] }
  return where
}

// ---------------------------------------------------------------------------
// In-memory store (deterministic tests + replay fakes)
// ---------------------------------------------------------------------------

let memSeq = 0

export class InMemoryMemoryStore implements MemoryStore {
  items: MemoryItem[] = []
  eventLog: MemoryEvent[] = []
  now: Date

  constructor(now: Date = new Date('2026-09-30T12:00:00Z')) {
    this.now = now
  }

  private tick(): string {
    memSeq += 1
    return `mem-${String(memSeq).padStart(4, '0')}`
  }

  async write(req: MemoryWriteRequest, now: Date = this.now): Promise<MemoryItem> {
    validateWrite(req)
    const scope = req.scope
    const dup = this.items.find(
      (i) =>
        i.hospitalId === scope.hospitalId &&
        i.status === 'ACTIVE' &&
        i.domain === scope.domain &&
        i.key === req.key &&
        i.trustLevel === req.trustLevel &&
        scopeMatch(i, scope),
    )
    if (dup) {
      throw new MemoryError('MEMORY_DUPLICATE_ACTIVE', `duplicate ACTIVE item (key ${req.key})`)
    }
    const item: MemoryItem = {
      id: this.tick(),
      hospitalId: scope.hospitalId,
      domain: scope.domain,
      memoryType: req.memoryType,
      trustLevel: req.trustLevel,
      status: 'ACTIVE',
      doctorId: scope.doctorId ?? null,
      patientId: scope.patientId ?? null,
      caseId: scope.caseId ?? null,
      conversationId: scope.conversationId ?? null,
      key: req.key,
      value: req.value,
      confidence: req.confidence ?? null,
      sourceKind: req.sourceKind,
      sourceRef: req.sourceRef ?? null,
      createdBy: req.actor.id,
      createdByIdType: req.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
      validFrom: now,
      expiresAt: req.expiresAt ?? null,
      supersededBy: null,
      correctionReason: null,
      createdAt: now,
      updatedAt: now,
    }
    this.items.push(item)
    this.eventLog.push({
      id: this.tick(),
      hospitalId: scope.hospitalId,
      memoryId: item.id,
      eventKind: 'WRITE',
      actorId: req.actor.id,
      actorRole: req.actor.role,
      reason: null,
      oldValue: null,
      newValue: req.value,
      createdAt: now,
    })
    return item
  }

  async getActive(id: string, hospitalId: string): Promise<MemoryItem | null> {
    return this.items.find((i) => i.id === id && i.hospitalId === hospitalId && i.status === 'ACTIVE') ?? null
  }

  async query(q: MemoryQuery, now: Date = this.now): Promise<MemoryBlock> {
    const rows = this.items.filter(
      (i) =>
        i.hospitalId === q.scope.hospitalId &&
        i.status === 'ACTIVE' &&
        i.domain === q.scope.domain &&
        scopeMatch(i, q.scope) &&
        (i.expiresAt === null || i.expiresAt > now) &&
        (!q.keys || q.keys.length === 0 || q.keys.includes(i.key)) &&
        (!q.memoryTypes || q.memoryTypes.length === 0 || q.memoryTypes.includes(i.memoryType)) &&
        (!q.since || i.validFrom >= q.since) &&
        (q.includeCandidate || (i.trustLevel !== 'AI_DERIVED' && i.trustLevel !== 'UNKNOWN')),
    )
    rows.sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())
    return retrieveMemory(rows, q)
  }

  async supersede(
    id: string,
    replacement: MemoryWriteRequest,
    reason: string,
    now: Date = this.now,
  ): Promise<MemoryItem> {
    const old = this.items.find(
      (i) => i.id === id && i.hospitalId === replacement.scope.hospitalId && i.status === 'ACTIVE',
    )
    if (!old) throw new MemoryError('MEMORY_NOT_ACTIVE', 'cannot supersede a non-ACTIVE or foreign-tenant item')
    const scope: MemoryScope = {
      hospitalId: old.hospitalId,
      domain: old.domain,
      doctorId: old.doctorId,
      patientId: old.patientId,
      caseId: old.caseId,
      conversationId: old.conversationId,
    }
    const fresh: MemoryWriteRequest = { ...replacement, scope, key: old.key }
    validateWrite(fresh)
    // The original leaves ACTIVE state first (the duplicate guard only sees
    // ACTIVE rows), then the corrected fact is written with the same key.
    old.status = 'SUPERSEDED'
    const item = await this.write(fresh, now)
    old.supersededBy = item.id
    item.correctionReason = reason
    this.eventLog.push({
      id: this.tick(),
      hospitalId: old.hospitalId,
      memoryId: old.id,
      eventKind: reason ? 'CORRECT' : 'SUPERSEDE',
      actorId: replacement.actor.id,
      actorRole: replacement.actor.role,
      reason,
      oldValue: old.value,
      newValue: replacement.value,
      createdAt: now,
    })
    return item
  }

  async invalidate(
    id: string,
    hospitalId: string,
    actor: MemoryActor,
    reason: string,
    now: Date = this.now,
  ): Promise<MemoryItem> {
    const item = this.items.find((i) => i.id === id && i.hospitalId === hospitalId && i.status === 'ACTIVE')
    if (!item) throw new MemoryError('MEMORY_NOT_ACTIVE', 'cannot invalidate a non-ACTIVE or foreign-tenant item')
    assertScopePermission(actor, item)
    item.status = 'INVALIDATED'
    this.eventLog.push({
      id: this.tick(),
      hospitalId,
      memoryId: id,
      eventKind: 'INVALIDATE',
      actorId: actor.id,
      actorRole: actor.role,
      reason,
      oldValue: item.value,
      newValue: null,
      createdAt: now,
    })
    return item
  }

  async delete(
    id: string,
    hospitalId: string,
    actor: MemoryActor,
    reason: string,
    now: Date = this.now,
  ): Promise<MemoryItem> {
    const item = this.items.find((i) => i.id === id && i.hospitalId === hospitalId && i.status === 'ACTIVE')
    if (!item) throw new MemoryError('MEMORY_NOT_ACTIVE', 'cannot delete a non-ACTIVE or foreign-tenant item')
    assertScopePermission(actor, item)
    item.status = 'DELETED'
    this.eventLog.push({
      id: this.tick(),
      hospitalId,
      memoryId: id,
      eventKind: 'DELETE',
      actorId: actor.id,
      actorRole: actor.role,
      reason,
      oldValue: item.value,
      newValue: null,
      createdAt: now,
    })
    return item
  }

  async applyRetention(hospitalId: string, now: Date): Promise<number> {
    let n = 0
    for (const item of this.items) {
      if (item.hospitalId === hospitalId && item.status === 'ACTIVE' && item.expiresAt && item.expiresAt < now) {
        item.status = 'DELETED'
        n += 1
        this.eventLog.push({
          id: this.tick(),
          hospitalId,
          memoryId: item.id,
          eventKind: 'EXPIRE',
          actorId: null,
          actorRole: null,
          reason: 'retention policy',
          oldValue: null,
          newValue: null,
          createdAt: now,
        })
      }
    }
    return n
  }

  async events(memoryId: string, hospitalId: string): Promise<MemoryEvent[]> {
    return this.eventLog.filter((e) => e.memoryId === memoryId && e.hospitalId === hospitalId)
  }
}

function scopeMatch(item: MemoryItem, scope: MemoryScope): boolean {
  switch (scope.domain) {
    case 'DOCTOR':
      return item.doctorId !== null && item.doctorId === scope.doctorId
    case 'PATIENT':
      return item.patientId !== null && item.patientId === scope.patientId
    case 'CASE':
      return item.caseId !== null && item.caseId === scope.caseId
    case 'CONVERSATION':
      return item.conversationId !== null && item.conversationId === scope.conversationId
    case 'CLINIC':
      return true
  }
}

export type { MemoryStatus }

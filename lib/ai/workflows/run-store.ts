/**
 * Phase 9 — persistent workflow-run store (§25 observability).
 *
 * Concrete `WorkflowRunStore` over the relational `AiWorkflowRun` table
 * (ONE additive table — the workflow framework does NOT create a graph DB
 * or a job queue). Every read is tenant-pinned (hospitalId in the where
 * clause): a run from another tenant is invisible, not error.
 *
 * The store only ever persists STATE (status, step log, attempts, approval
 * id, timestamps) — it is never a mutation path for clinical records.
 */

import type { WorkflowRunRecord, WorkflowRunStore } from './types'

/** Minimal structural shape of the prisma client (no generated import). */
interface WorkflowRunDelegate {
  create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>
  findUnique: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>
  update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<Record<string, unknown>>
}

export interface WorkflowRunPrisma {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aiWorkflowRun?: WorkflowRunDelegate | any
}

function toRecord(row: Record<string, unknown>): WorkflowRunRecord {
  return {
    id: String(row.id),
    workflowId: String(row.workflowId),
    version: Number(row.version),
    status: String(row.status) as WorkflowRunRecord['status'],
    hospitalId: String(row.hospitalId),
    patientId: row.patientId == null ? null : String(row.patientId),
    caseId: row.caseId == null ? null : String(row.caseId),
    actorId: String(row.actorId),
    actorRole: String(row.actorRole),
    currentStep: row.currentStep == null ? null : String(row.currentStep),
    stepLog: (row.stepLog ?? []) as WorkflowRunRecord['stepLog'],
    approvalId: row.approvalId == null ? null : String(row.approvalId),
    context: (row.context ?? {}) as Record<string, unknown>,
    result: (row.result ?? null) as Record<string, unknown> | null,
    attempts: Number(row.attempts ?? 1),
    startedAt: row.startedAt == null ? null : new Date(row.startedAt as string | number | Date).toISOString(),
    completedAt: row.completedAt == null ? null : new Date(row.completedAt as string | number | Date).toISOString(),
    expiresAt: new Date(row.expiresAt as string | number | Date).toISOString(),
    createdAt: new Date((row.createdAt ?? new Date()) as string | number | Date).toISOString(),
  }
}

/**
 * Build the store for a tenant. The hospitalId is CAPTURED (not re-sent by
 * callers per call) so a store instance can never be pointed at another
 * tenant.
 */
export function createWorkflowRunStore(prisma: WorkflowRunPrisma, hospitalId: string): WorkflowRunStore {
  const del = prisma.aiWorkflowRun
  if (!del) {
    // Fail closed: no persistence available → runs cannot be observed.
    const missing = () => {
      throw new Error('AI_WORKFLOW_RUN_STORE_UNAVAILABLE: aiWorkflowRun delegate missing')
    }
    return { create: missing, findUnique: missing, update: missing }
  }
  return {
    async create(rec: Omit<WorkflowRunRecord, 'createdAt'> & { createdAt?: string }) {
      const row = await del.create({
        data: {
          id: rec.id,
          hospitalId,
          workflowId: rec.workflowId,
          version: rec.version,
          status: rec.status,
          patientId: rec.patientId,
          caseId: rec.caseId,
          actorId: rec.actorId,
          actorRole: rec.actorRole,
          currentStep: rec.currentStep,
          stepLog: rec.stepLog,
          approvalId: rec.approvalId,
          context: rec.context,
          result: rec.result,
          attempts: rec.attempts,
          startedAt: rec.startedAt,
          completedAt: rec.completedAt,
          expiresAt: rec.expiresAt,
        },
      })
      return toRecord(row)
    },
    async findUnique(id: string) {
      // Tenant-pinned: WHERE id AND hospitalId.
      const row = await del.findUnique({
        where: { id, hospitalId },
      })
      return row ? toRecord(row) : null
    },
    async update(
      id: string,
      data: Partial<Pick<WorkflowRunRecord, 'status' | 'currentStep' | 'stepLog' | 'approvalId' | 'result' | 'attempts' | 'startedAt' | 'completedAt'>>,
    ) {
      const row = await del.update({
        where: { id, hospitalId },
        data: { ...data },
      })
      return toRecord(row)
    },
  }
}

/** In-memory store for unit tests + replay determinism (no DB). */
export function createMemoryWorkflowRunStore(): WorkflowRunStore {
  const map = new Map<string, WorkflowRunRecord>()
  return {
    async create(rec: Omit<WorkflowRunRecord, 'createdAt'> & { createdAt?: string }) {
      const full: WorkflowRunRecord = { ...rec, createdAt: rec.createdAt ?? new Date().toISOString() }
      map.set(full.id, full)
      return full
    },
    async findUnique(id: string) {
      return map.get(id) ?? null
    },
    async update(id: string, data: Partial<WorkflowRunRecord>) {
      const cur = map.get(id)
      if (!cur) throw new Error('WORKFLOW_RUN_NOT_FOUND: ' + id)
      const next = { ...cur, ...data }
      map.set(id, next)
      return next
    },
  }
}

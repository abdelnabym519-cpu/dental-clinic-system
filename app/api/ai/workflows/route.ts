/**
 * Phase 9 — Bounded agentic workflows API (§22–§26).
 *
 * GET  /api/ai/workflows
 *   → the canonical workflow definitions (versioned, bounded, typed).
 *
 * POST /api/ai/workflows
 *   body: { op: 'run', workflowId, patientId?, caseId?, attachmentIds? }
 *          → execute ONE bounded run (state machine + budgets + audit).
 *   body: { op: 'cancel', runId }
 *          → validated transition to CANCELLED (terminal-safe).
 *   body: { op: 'get', runId } | { op: 'list' }
 *          → tenant-pinned run observation (replay + audit).
 *
 * Safety model:
 *  - actor + tenant come from the SESSION (never asserted by the client);
 *  - role is checked AGAINST THE DEFINITION at trigger time (the LLM and
 *    the client can neither grant roles nor widen tool budgets);
 *  - patient/case scope is re-validated server-side;
 *  - SENSITIVE steps never mutate records: the engine routes them through
 *    the Phase-1 action pipeline and parks in WAITING_APPROVAL (§25);
 *  - every run persists its bounded step log to the AiWorkflowRun table
 *    (ONE additive table) — observable, replayable, auditable.
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { runAiAction } from '@/lib/ai/action-pipeline'
import { WORKFLOWS, getWorkflow } from '@/lib/ai/workflows/definitions'
import { runWorkflow, cancelWorkflow } from '@/lib/ai/workflows/engine'
import { createWorkflowRunStore, type WorkflowRunPrisma } from '@/lib/ai/workflows/run-store'
import type { GraphPrisma } from '@/lib/ai/intelligence/case-graph'
import {
  STAFF_ROLES,
  asString,
  asStringArray,
  resolveCaseScope,
  resolvePatientScope,
  wfErr,
  writeAudit,
} from '@/lib/ai/intelligence/route-utils'
import { IntelligenceError } from '@/lib/ai/intelligence/types'

export const dynamic = 'force-dynamic'

/** Union of every workflow's allowedRoles (the engine re-checks per def). */
const ALL_WORKFLOW_ROLES = Array.from(new Set(Object.values(WORKFLOWS).flatMap((d) => d.allowedRoles)))

export async function GET() {
  const auth = await requireAuthAndRole(ALL_WORKFLOW_ROLES)
  if (auth.error || !auth.user || !auth.hospitalId) {
    return wfErr('INT_UNAUTHORIZED', 'unauthorized', auth.error ? (auth.error as { status?: number }).status ?? 401 : 401)
  }
  const workflows = Object.values(WORKFLOWS).map((d) => ({
    workflowId: d.workflowId,
    version: d.version,
    nameKey: d.nameKey,
    allowedRoles: d.allowedRoles,
    allowedTools: d.allowedTools,
    maxSteps: d.maxSteps,
    maxToolCalls: d.maxToolCalls,
    timeoutMs: d.timeoutMs,
    approvalRequiredSteps: d.approvalRequiredSteps,
    stepIds: d.steps.map((s) => s.id),
  }))
  return NextResponse.json({ hospitalId: auth.hospitalId, workflows })
}

export async function POST(req: Request) {
  const auth = await requireAuthAndRole(ALL_WORKFLOW_ROLES)
  if (auth.error || !auth.user || !auth.hospitalId) {
    return wfErr('INT_UNAUTHORIZED', 'unauthorized', auth.error ? (auth.error as { status?: number }).status ?? 401 : 401)
  }
  const { hospitalId, user } = auth
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return wfErr('INT_INVALID_PARAMS', 'invalid body', 400)
  }
  const op = asString(body.op)

  try {
    // ------------------------------------------------------------------ list
    if (op === 'list') {
      const rows = await prisma.aiWorkflowRun.findMany({
        where: { hospitalId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return NextResponse.json({
        hospitalId,
        count: rows.length,
        runs: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          workflowId: r.workflowId,
          version: r.version,
          status: r.status,
          patientId: r.patientId ?? null,
          actorRole: r.actorRole,
          currentStep: r.currentStep ?? null,
          attempts: r.attempts,
          startedAt: r.startedAt ?? null,
          completedAt: r.completedAt ?? null,
          createdAt: r.createdAt,
        })),
      })
    }

    // ------------------------------------------------------------------- get
    if (op === 'get') {
      const runId = asString(body.runId)
      if (!runId) return wfErr('INT_INVALID_PARAMS', 'runId required', 400)
      const store = createWorkflowRunStore(prisma as unknown as WorkflowRunPrisma, hospitalId)
      const run = await store.findUnique(runId, hospitalId)
      if (!run) return wfErr('INT_WORKFLOW_NOT_FOUND', 'run not found', 404)
      return NextResponse.json({ hospitalId, run })
    }

    // ---------------------------------------------------------------- cancel
    if (op === 'cancel') {
      const runId = asString(body.runId)
      if (!runId) return wfErr('INT_INVALID_PARAMS', 'runId required', 400)
      const store = createWorkflowRunStore(prisma as unknown as WorkflowRunPrisma, hospitalId)
      const now = () => new Date()
      const run = await cancelWorkflow({ prisma: prisma as unknown as GraphPrisma, now, store }, runId, hospitalId)
      writeAudit(prisma, {
        hospitalId,
        userId: user.id,
        action: 'AI_WORKFLOW_CANCEL',
        entityType: 'AiWorkflowRun',
        entityId: runId,
        newValues: { status: run.status },
      })
      return NextResponse.json({ hospitalId, run })
    }

    // ------------------------------------------------------------------- run
    if (op === 'run') {
      const workflowId = asString(body.workflowId)
      const def = workflowId ? getWorkflow(workflowId) : undefined
      if (!def) return wfErr('INT_WORKFLOW_NOT_FOUND', 'unknown workflowId', 404)
      if (!def.allowedRoles.includes(user.role)) {
        return wfErr('INT_WORKFLOW_ROLE_DENIED', `role ${user.role} not allowed for ${workflowId}`, 403)
      }

      // Scope re-validation (server-side; the client never asserts).
      const patientScoped = def.steps.some((s) => s.kind === 'RESOLVE_PATIENT')
      let patientId: string | null = null
      let patientName: string | null = null
      let caseScope: string | null = null
      if (patientScoped) {
        const patient = await resolvePatientScope(prisma, hospitalId, user, body.patientId)
        if (!patient) return wfErr('INT_PATIENT_NOT_FOUND', 'patient not found in this tenant', 404)
        patientId = patient.id
        patientName = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || null
        caseScope = await resolveCaseScope(prisma, hospitalId, patientId, body.caseId)
      }

      const store = createWorkflowRunStore(prisma as unknown as WorkflowRunPrisma, hospitalId)
      const now = () => new Date()
      const deps = {
        prisma: prisma as unknown as GraphPrisma,
        now,
        store,
        nextRunId: () => `wfrun-${randomUUID()}`,
        // THE existing Phase-1 action pipeline — sensitive steps park at
        // approval inside it; the engine never executes directly.
        runAction: (action: string, params: Record<string, string>, ctx: { hospitalId: string; actor: { id: string; role: string; name?: string } }) =>
          runAiAction({
            action,
            params,
            actor: { id: ctx.actor.id, name: ctx.actor.name ?? user.id, role: ctx.actor.role },
            hospitalId: ctx.hospitalId,
            conversationId: null,
            requestReason: `workflow:${def.workflowId}`,
          }),
      }

      const result = await runWorkflow(deps, {
        workflowId: def.workflowId,
        context: {
          hospitalId,
          patientId,
          caseId: caseScope,
          attachmentIds: asStringArray(body.attachmentIds),
          patientName,
          actor: { id: user.id, role: user.role, name: user.name ?? user.id },
        },
      })

      writeAudit(prisma, {
        hospitalId,
        userId: user.id,
        action: def.audit.action,
        entityType: 'AiWorkflowRun',
        entityId: result.run.id,
        newValues: { status: result.run.status, steps: result.run.stepLog.length, attempts: result.run.attempts },
      })

      return NextResponse.json({
        hospitalId,
        run: result.run,
        outputItems: result.outputItems,
      })
    }

    return wfErr('INT_INVALID_PARAMS', 'unknown op', 400)
  } catch (e) {
    if (e instanceof IntelligenceError) {
      const status =
        e.code === 'INT_WORKFLOW_ROLE_DENIED' ? 403
        : e.code === 'INT_WORKFLOW_NOT_FOUND' || e.code === 'INT_PATIENT_NOT_FOUND' ? 404
        : e.code === 'INT_WORKFLOW_INVALID_TRANSITION' ? 409
        : 400
      return wfErr(e.code, e.message, status)
    }
    console.error('AI workflow error:', e)
    return wfErr('INT_WORKFLOW_NOT_RUNNABLE', 'internal error', 500)
  }
}

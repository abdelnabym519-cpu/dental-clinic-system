/**
 * Phase 9 — Proactive intelligence (§19, §21, §34).
 *
 * Bounded, TYPED, deterministic alerts derived from verified structured data.
 * Reuses the EXISTING AIInsight model (no new alert table — §21: avoid
 * unnecessary new models): the alert type, trigger, evidence, scope, severity
 * and dedup key live in the `data` JSON; `category`/`severity`/`dismissed`/
 * `actionTaken`/`expiresAt` use the existing typed columns.
 *
 * Safety (§34): proactive intelligence NEVER becomes autonomous action. An
 * alert says "follow-up appears overdue" — contacting the patient is a
 * separate ACTION that goes through the existing approval/action pipeline.
 *
 * Rules:
 *  - every alert has trigger + evidence + scope + severity + timestamp;
 *  - deduplication by a stable key (one ACTIVE alert per key — no spam);
 *  - dismissal is a state change on the record (audited by createdAt/
 *    dismissed — the AIInsight row itself is the audit trail);
 *  - speculative alerts are not generated (deterministic rules only).
 */

import type { AlertSeverity, AlertType, ProactiveAlert } from './types'
import type { GraphPrisma } from './case-graph'

export type AlertPrisma = GraphPrisma & {
  aiInsight: {
    findMany: (args?: { where?: Record<string, unknown>; take?: number }) => Promise<Record<string, any>[]>
    create: (args: { data: Record<string, any> }) => Promise<Record<string, any>>
    updateMany: (args: { where: Record<string, any>; data: Record<string, any> }) => Promise<{ count: number }>
  }
}

const ALERT_CATEGORY: Record<AlertType, 'CLINICAL' | 'OPERATIONAL' | 'PATIENT'> = {
  FOLLOW_UP_DUE: 'CLINICAL',
  MISSED_APPOINTMENT: 'PATIENT',
  AI_REVIEW_REQUIRED: 'CLINICAL',
  CASE_INCOMPLETE: 'CLINICAL',
  TREATMENT_PENDING: 'CLINICAL',
  QUEUE_BOTTLENECK: 'OPERATIONAL',
  TASK_OVERDUE: 'OPERATIONAL',
}

export const ALERT_TITLE_KEYS: Record<AlertType, string> = {
  FOLLOW_UP_DUE: 'int.alert.followUpDue',
  MISSED_APPOINTMENT: 'int.alert.missedAppointment',
  AI_REVIEW_REQUIRED: 'int.alert.aiReviewRequired',
  CASE_INCOMPLETE: 'int.alert.caseIncomplete',
  TREATMENT_PENDING: 'int.alert.treatmentPending',
  QUEUE_BOTTLENECK: 'int.alert.queueBottleneck',
  TASK_OVERDUE: 'int.alert.taskOverdue',
}

export interface AlertRunResult {
  detected: ProactiveAlert[]
  created: number
  dismissed: number
  /** Existing active alerts (deduplicated) that were NOT re-created. */
  deduplicated: number
}

/**
 * Detect + materialize alerts for a tenant. Pure rules over structured data;
 * deterministic; idempotent via the dedup key.
 */
export async function runProactiveIntelligence(
  prisma: AlertPrisma,
  p: { hospitalId: string; now: Date; actorId: string },
): Promise<AlertRunResult> {
  const { start, end } = dayBounds(p.now)
  const [treatments, appts, aiJobs] = await Promise.all([
    prisma.treatment.findMany({ where: { hospitalId: p.hospitalId, followUpRequired: true } }),
    prisma.appointment.findMany({ where: { hospitalId: p.hospitalId, scheduledDate: { gte: start, lt: end } } }),
    prisma.aiAnalysisJob.findMany({ where: { hospitalId: p.hospitalId, status: 'COMPLETED' } }),
  ])

  const detected: ProactiveAlert[] = []
  const push = (
    alertType: AlertType,
    severity: AlertSeverity,
    trigger: string,
    evidence: Record<string, unknown>,
    scope: { patientId: string | null; caseId: string | null },
    dedupKey: string,
  ) => {
    detected.push({
      alertType,
      severity,
      trigger,
      evidence,
      scope,
      titleKey: ALERT_TITLE_KEYS[alertType],
      titleParams: {},
      at: p.now.toISOString(),
      dedupKey,
      state: 'ACTIVE',
    })
  }

  // Rule 1 — follow-ups due/overdue.
  for (const t of treatments) {
    if (!t.followUpRequired || t.status !== 'COMPLETED') continue
    const due = t.followUpDate ? new Date(t.followUpDate) : null
    if (!due) {
      push('CASE_INCOMPLETE', 'WARNING', 'follow_up_required_without_date', { treatmentNo: t.treatmentNo ?? t.id }, { patientId: t.patientId, caseId: null }, `CASE_INCOMPLETE|${t.id}|followup_date`)
      continue
    }
    const overdueMs = p.now.getTime() - due.getTime()
    if (overdueMs > 0) {
      push('FOLLOW_UP_DUE', overdueMs > 7 * 86_400_000 ? 'CRITICAL' : 'WARNING', 'follow_up_overdue', { treatmentNo: t.treatmentNo ?? t.id, due: due.toISOString(), overdueDays: Math.ceil(overdueMs / 86_400_000) }, { patientId: t.patientId, caseId: null }, `FOLLOW_UP_DUE|${t.id}`)
    } else if (overdueMs > -3 * 86_400_000) {
      push('FOLLOW_UP_DUE', 'INFO', 'follow_up_due_within_3d', { treatmentNo: t.treatmentNo ?? t.id, due: due.toISOString() }, { patientId: t.patientId, caseId: null }, `FOLLOW_UP_DUE|${t.id}`)
    }
  }

  // Rule 2 — missed appointments (past due, never checked in).
  const dayStart = start
  for (const a of appts) {
    const sched = a.scheduledDate ? new Date(a.scheduledDate) : null
    if (!sched) continue
    if (['SCHEDULED', 'CONFIRMED'].includes(a.status ?? '') && sched.getTime() < p.now.getTime() - 30 * 60_000 && !a.checkedInAt) {
      push('MISSED_APPOINTMENT', 'WARNING', 'appointment_past_due_not_checked_in', { appointmentNo: a.appointmentNo ?? a.id, patientId: a.patientId }, { patientId: a.patientId, caseId: null }, `MISSED_APPOINTMENT|${a.id}`)
    }
    if (a.status === 'NO_SHOW') {
      push('MISSED_APPOINTMENT', 'INFO', 'appointment_no_show_recorded', { appointmentNo: a.appointmentNo ?? a.id }, { patientId: a.patientId, caseId: null }, `MISSED_APPOINTMENT|${a.id}|noshown`)
    }
  }
  void dayStart

  // Rule 3 — AI findings awaiting clinician review.
  for (const j of aiJobs) {
    if (!j.reviewDecision) {
      push('AI_REVIEW_REQUIRED', 'WARNING', 'ai_job_completed_unreviewed', { jobId: j.id, engine: j.engine ?? null }, { patientId: null, caseId: null }, `AI_REVIEW_REQUIRED|${j.id}`)
    }
  }

  // Rule 4 — queue bottleneck (deterministic threshold).
  const waiting = appts.filter((a) => a.status === 'CHECKED_IN').length
  if (waiting >= 4) {
    push('QUEUE_BOTTLENECK', waiting >= 8 ? 'CRITICAL' : 'WARNING', 'queue_waiting_threshold', { waiting }, { patientId: null, caseId: null }, 'QUEUE_BOTTLENECK|day')
  }

  // Deduplicate against existing ACTIVE alerts (data.dedupKey), then persist.
  const existing = await prisma.aiInsight.findMany({ where: { hospitalId: p.hospitalId, dismissed: false } })
  const activeKeys = new Set(
    existing
      .map((r) => (r.data && typeof r.data === 'object' && r.data.dedupKey ? String((r.data as Record<string, unknown>).dedupKey) : null))
      .filter((k): k is string => Boolean(k)),
  )

  let created = 0
  let deduplicated = 0
  for (const alert of detected) {
    if (activeKeys.has(alert.dedupKey)) {
      deduplicated += 1
      continue
    }
    activeKeys.add(alert.dedupKey)
    await prisma.aiInsight.create({
      data: {
        hospitalId: p.hospitalId,
        category: ALERT_CATEGORY[alert.alertType],
        severity: alert.severity,
        title: alert.titleKey,
        description: `${alert.alertType} — ${alert.trigger}`,
        expiresAt: new Date(p.now.getTime() + 14 * 86_400_000),
        data: {
          dedupKey: alert.dedupKey,
          alertType: alert.alertType,
          trigger: alert.trigger,
          evidence: alert.evidence,
          scope: alert.scope,
          titleParams: alert.titleParams,
          detectedAt: alert.at,
          detectedById: p.actorId,
          kind: 'PROACTIVE_ALERT',
          // §34 — the alert is a SIGNAL. The `action` channel is empty on
          // purpose: executing anything (contact, booking) is a separate
          // ACTION through the approval pipeline.
          action: null,
        },
      },
    })
    created += 1
  }

  return { detected, created, dismissed: 0, deduplicated }
}

/** Dismiss an alert (state change — never deletes the audit row). */
export async function dismissAlert(
  prisma: AlertPrisma,
  p: { hospitalId: string; alertId: string; actorId: string },
): Promise<{ ok: boolean; state: 'DISMISSED' | 'NOT_FOUND' }> {
  const rows = await prisma.aiInsight.findMany({ where: { hospitalId: p.hospitalId, id: p.alertId } })
  const row = rows[0]
  if (!row) return { ok: false, state: 'NOT_FOUND' }
  // Tenant-pinned update (never a bare-id update: a foreign id must not
  // touch another tenant's row — fail closed instead).
  const updated = await prisma.aiInsight.updateMany({
    where: { id: p.alertId, hospitalId: p.hospitalId },
    data: { dismissed: true, data: { ...(row.data as Record<string, unknown> ?? {}), dismissedById: p.actorId, dismissedAt: new Date().toISOString() } },
  })
  if (updated.count === 0) return { ok: false, state: 'NOT_FOUND' }
  return { ok: true, state: 'DISMISSED' }
}

function dayBounds(now: Date): { start: Date; end: Date } {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  return { start, end: new Date(start.getTime() + 86_400_000) }
}

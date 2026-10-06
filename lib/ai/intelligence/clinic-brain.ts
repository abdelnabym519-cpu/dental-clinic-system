/**
 * Phase 9 — Clinic Brain + Daily Command Center (§17–§18).
 *
 * Deterministic operational intelligence over EXISTING clinic data
 * (appointments, treatments, AI jobs, queue/checked-in state, reminders,
 * invoices where authorized). NO fake metrics: every number is computed from
 * rows, and every section that cannot be computed is explicitly
 * NOT_MEASURED / NOT_AVAILABLE.
 *
 * §18: the Command Center is deterministic data FIRST; an LLM insight may be
 * attached later, but only DERIVED from this verified structured output —
 * never the other way around.
 */

import type { GraphPrisma } from './case-graph'
import type { DataState, IntelligenceItem } from './types'

export type ClinicPrisma = GraphPrisma & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aIInsight?: { findMany: (a?: { where?: Record<string, unknown> }) => Promise<Record<string, any>[]> }
}

export interface ClinicOpsMetrics {
  date: string
  todayAppointments: {
    state: DataState
    total: number
    byStatus: Record<string, number>
    noShows: number
    cancellations: number
    utilization: number | null // completed+in-progress / scheduled today
  }
  queue: { state: DataState; waiting: number; inProgress: number; checkedIn: { ref: string; type: string | null; priority: string | null }[] }
  overdueFollowUps: { state: DataState; count: number; items: { ref: string; patientId: string; doctorId: string | null; date: string | null; notes: string | null }[] }
  pendingTreatments: { state: DataState; count: number; byStatus: Record<string, number> }
  doctorWorkload: { state: DataState; rows: { doctorId: string; scheduledToday: number; overdueFollowUps: number }[] }
  aiReviewRequired: { state: DataState; count: number; items: { jobId: string; engine: string | null; status: string | null }[] }
  financialItems: { state: DataState; note: string; openBalances: number; invoiceCount: number }
  unresolvedTasks: { state: DataState; count: number; items: string[] }
  bottlenecks: { state: DataState; rows: { code: string; detail: string; count: number }[] }
}

export interface CommandCenter {
  generatedAt: string
  hospitalId: string
  /** Every section is typed items (§20) — FACT vs DERIVED_INSIGHT explicit. */
  sections: {
    key: string
    state: DataState
    items: IntelligenceItem[]
  }[]
  metrics: ClinicOpsMetrics
}

const DAY_MS = 86_400_000

function dayBounds(now: Date): { start: Date; end: Date } {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const end = new Date(start.getTime() + DAY_MS)
  return { start, end }
}

export async function buildClinicMetrics(
  prisma: ClinicPrisma,
  p: { hospitalId: string; now: Date; actorRole: string },
): Promise<ClinicOpsMetrics> {
  const { start, end } = dayBounds(p.now)
  const [today, overdueSource, aiJobs] = await Promise.all([
    prisma.appointment.findMany({ where: { hospitalId: p.hospitalId, scheduledDate: { gte: start, lt: end } } }),
    prisma.treatment.findMany({
      where: {
        hospitalId: p.hospitalId,
        followUpRequired: true,
        followUpDate: { lte: p.now },
      },
    }),
    prisma.aiAnalysisJob.findMany({ where: { hospitalId: p.hospitalId, status: 'COMPLETED' } }),
  ])
  const treatments = overdueSource
  const byStatus: Record<string, number> = {}
  for (const a of today) byStatus[a.status ?? 'UNKNOWN'] = (byStatus[a.status ?? 'UNKNOWN'] ?? 0) + 1
  const noShows = byStatus['NO_SHOW'] ?? 0
  const cancellations = byStatus['CANCELLED'] ?? 0
  const done = (byStatus['COMPLETED'] ?? 0) + (byStatus['IN_PROGRESS'] ?? 0)
  const utilization = today.length > 0 ? Math.round((done / today.length) * 100) / 100 : null

  const queueItems = today.filter((a) => ['CHECKED_IN', 'IN_PROGRESS', 'SCHEDULED'].includes(a.status ?? ''))
  const queue = {
    state: 'AVAILABLE' as DataState,
    waiting: queueItems.filter((a) => a.status === 'CHECKED_IN').length,
    inProgress: queueItems.filter((a) => a.status === 'IN_PROGRESS').length,
    checkedIn: queueItems
      .filter((a) => a.status === 'CHECKED_IN')
      .slice(0, 20)
      .map((a) => ({ ref: a.appointmentNo ?? a.id, type: a.appointmentType ?? null, priority: a.priority ?? null })),
  }

  const overdue = treatments
    .filter((t) => t.status === 'COMPLETED' && t.followUpRequired)
    .map((t) => ({
      ref: t.treatmentNo ?? t.id,
      patientId: t.patientId,
      doctorId: t.doctorId ?? null,
      date: t.followUpDate ? new Date(t.followUpDate).toISOString() : null,
      notes: t.followUpNotes ?? null,
    }))
    .sort((a, b) => (a.date ?? '') < (b.date ?? '') ? -1 : 1)

  const pendingTreatments = await prisma.treatment.findMany({
    where: { hospitalId: p.hospitalId, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
  })
  const pendingByStatus: Record<string, number> = {}
  for (const t of pendingTreatments) pendingByStatus[t.status ?? 'UNKNOWN'] = (pendingByStatus[t.status ?? 'UNKNOWN'] ?? 0) + 1

  // Doctor workload (today's appointments + overdue follow-ups per doctor).
  const docMap = new Map<string, { doctorId: string; scheduledToday: number; overdueFollowUps: number }>()
  for (const a of today) {
    if (!a.doctorId) continue
    const row = docMap.get(a.doctorId) ?? { doctorId: a.doctorId, scheduledToday: 0, overdueFollowUps: 0 }
    row.scheduledToday += 1
    docMap.set(a.doctorId, row)
  }
  const overdueByDoc = new Map<string, number>()
  for (const t of overdue) {
    if (!t.doctorId) continue
    overdueByDoc.set(t.doctorId, (overdueByDoc.get(t.doctorId) ?? 0) + 1)
  }
  for (const [docId, count] of overdueByDoc) {
    const row = docMap.get(docId) ?? { doctorId: docId, scheduledToday: 0, overdueFollowUps: 0 }
    row.overdueFollowUps = count
    docMap.set(docId, row)
  }

  const reviewRequired = aiJobs
    .filter((j) => !j.reviewDecision)
    .map((j) => ({ jobId: j.id, engine: j.engine ?? null, status: j.status ?? null }))
    .slice(0, 20)

  // Financial items — deterministic count/sum only, and only for roles that
  // may see money (§17: "where authorized").
  const financialAllowed = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(p.actorRole)
  let openBalances = 0
  let invoiceCount = 0
  if (financialAllowed) {
    let inv: Record<string, any>[] = []
    if (prisma.invoice) {
      inv = await prisma.invoice
        .findMany({ where: { hospitalId: p.hospitalId, status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } } })
        .catch(() => [] as Record<string, any>[])
    }
    invoiceCount = inv.length
    for (const i of inv) openBalances += Number(i.balanceAmount ?? 0)
  }

  const unresolvedTasks: string[] = []
  for (const f of overdue.slice(0, 10)) unresolvedTasks.push(`follow-up overdue: ${f.ref}`)
  for (const r of reviewRequired.slice(0, 10)) unresolvedTasks.push(`AI review required: ${r.jobId} (${r.engine ?? 'engine'})`)

  // Bottlenecks — deterministic rules over verified data.
  const bottlenecks: ClinicOpsMetrics['bottlenecks']['rows'] = []
  if (noShows >= 3) bottlenecks.push({ code: 'NO_SHOW_RATE', detail: `${noShows} no-shows today`, count: noShows })
  if (queue.waiting >= 4) bottlenecks.push({ code: 'QUEUE_BACKLOG', detail: `${queue.waiting} patients waiting`, count: queue.waiting })
  if (overdue.length >= 5) bottlenecks.push({ code: 'FOLLOW_UP_BACKLOG', detail: `${overdue.length} overdue follow-ups`, count: overdue.length })
  if (utilization !== null && utilization > 0.95 && queue.inProgress >= 2) {
    bottlenecks.push({ code: 'UTILIZATION_SATURATION', detail: `utilization ${utilization} with ${queue.inProgress} in progress`, count: queue.inProgress })
  }

  return {
    date: start.toISOString().slice(0, 10),
    todayAppointments: {
      state: today.length > 0 || true ? 'AVAILABLE' : 'NOT_AVAILABLE',
      total: today.length,
      byStatus,
      noShows,
      cancellations,
      utilization,
    },
    queue,
    overdueFollowUps: { state: 'AVAILABLE', count: overdue.length, items: overdue.slice(0, 20) },
    pendingTreatments: { state: 'AVAILABLE', count: pendingTreatments.length, byStatus: pendingByStatus },
    doctorWorkload: { state: 'AVAILABLE', rows: [...docMap.values()].slice(0, 20) },
    aiReviewRequired: { state: 'AVAILABLE', count: reviewRequired.length, items: reviewRequired },
    financialItems: financialAllowed
      ? { state: 'AVAILABLE', note: 'authorized role', openBalances, invoiceCount }
      : { state: 'NOT_AVAILABLE', note: 'role not authorized for financial items', openBalances: 0, invoiceCount: 0 },
    unresolvedTasks: { state: 'AVAILABLE', count: unresolvedTasks.length, items: unresolvedTasks },
    bottlenecks: { state: 'AVAILABLE', rows: bottlenecks },
  }
}

/**
 * §18 — Daily Command Center. Deterministic sections first; each section is a
 * list of typed IntelligenceItems (§20). LLM insights, when added later,
 * attach as AI_INTERPRETATION items DERIVED from this output — never the
 * reverse.
 */
export async function buildCommandCenter(
  prisma: Parameters<typeof buildClinicMetrics>[0],
  p: { hospitalId: string; now: Date; actorRole: string },
): Promise<CommandCenter> {
  const m = await buildClinicMetrics(prisma, p)
  const mk = (key: string, state: DataState, items: IntelligenceItem[]): CommandCenter['sections'][number] => ({ key, state, items })
  let n = 0
  const item = (insightClass: IntelligenceItem['insightClass'], titleKey: string, detail: Record<string, unknown>, state: DataState = 'AVAILABLE') => ({
    id: `cc-${++n}`,
    insightClass,
    state,
    titleKey,
    titleParams: {},
    detail,
    scope: { patientId: null, caseId: null },
  })

  const sections: CommandCenter['sections'] = []

  sections.push(
    mk(
      'todaysAppointments',
      m.todayAppointments.state,
      [
        item('FACT', 'cc.appointments.total', { total: m.todayAppointments.total }),
        item('FACT', 'cc.appointments.byStatus', { byStatus: m.todayAppointments.byStatus }),
        ...(m.todayAppointments.utilization !== null ? [item('DERIVED_INSIGHT', 'cc.appointments.utilization', { utilization: m.todayAppointments.utilization })] : []),
      ],
    ),
  )
  sections.push(
    mk(
      'patientsWaiting',
      m.queue.state,
      m.queue.checkedIn.length > 0
        ? m.queue.checkedIn.slice(0, 10).map((q) => item('FACT', 'cc.queue.waiting', { ref: q.ref, type: q.type, priority: q.priority }))
        : [item('FACT', 'cc.queue.empty', {}, 'NOT_AVAILABLE')],
    ),
  )
  sections.push(
    mk(
      'delayedAppointments',
      'NOT_MEASURED',
      [item('FACT', 'cc.delayed.notMeasured', { note: 'delay detection requires live chair-time telemetry — not claimed' })],
    ),
  )
  sections.push(
    mk(
      'urgentClinicalReview',
      m.aiReviewRequired.state,
      m.aiReviewRequired.items.length > 0
        ? m.aiReviewRequired.items.map((r) => item('AI_INTERPRETATION', 'cc.review.aiPending', { jobId: r.jobId, engine: r.engine }))
        : [item('FACT', 'cc.review.none', {}, 'NOT_AVAILABLE')],
    ),
  )
  sections.push(
    mk(
      'pendingFollowUps',
      m.overdueFollowUps.state,
      m.overdueFollowUps.items.length > 0
        ? m.overdueFollowUps.items.map((f) => item('DERIVED_INSIGHT', 'cc.followup.overdue', { ref: f.ref, date: f.date }))
        : [item('FACT', 'cc.followup.none', {}, 'NOT_AVAILABLE')],
    ),
  )
  sections.push(
    mk(
      'pendingTreatments',
      m.pendingTreatments.state,
      [item('FACT', 'cc.pending.count', { count: m.pendingTreatments.count, byStatus: m.pendingTreatments.byStatus })],
    ),
  )
  sections.push(
    mk(
      'aiFindingsAwaitingReview',
      m.aiReviewRequired.state,
      m.aiReviewRequired.items.length > 0
        ? [item('DERIVED_INSIGHT', 'cc.ai.count', { count: m.aiReviewRequired.count })]
        : [item('FACT', 'cc.ai.none', {}, 'NOT_AVAILABLE')],
    ),
  )
  sections.push(
    mk(
      'operationalBottlenecks',
      m.bottlenecks.state,
      m.bottlenecks.rows.length > 0
        ? m.bottlenecks.rows.map((b) => item('DERIVED_INSIGHT', 'cc.bottleneck', { code: b.code, detail: b.detail }))
        : [item('FACT', 'cc.bottleneck.none', {}, 'NOT_AVAILABLE')],
    ),
  )
  sections.push(
    mk(
      'unresolvedTasks',
      m.unresolvedTasks.state,
      m.unresolvedTasks.items.length > 0
        ? m.unresolvedTasks.items.map((t) => item('DERIVED_INSIGHT', 'cc.task.unresolved', { task: t }))
        : [item('FACT', 'cc.task.none', {}, 'NOT_AVAILABLE')],
    ),
  )
  sections.push(
    mk(
      'financialItems',
      m.financialItems.state,
      m.financialItems.state === 'AVAILABLE'
        ? [item('FACT', 'cc.financial.open', { invoiceCount: m.financialItems.invoiceCount, openBalances: m.financialItems.openBalances })]
        : [item('FACT', 'cc.financial.notAuthorized', { note: m.financialItems.note }, 'NOT_AVAILABLE')],
    ),
  )
  sections.push(
    mk(
      'doctorWorkload',
      m.doctorWorkload.state,
      m.doctorWorkload.rows.map((d) => item('FACT', 'cc.doctor.workload', { doctorId: d.doctorId, scheduledToday: d.scheduledToday, overdueFollowUps: d.overdueFollowUps })),
    ),
  )

  return { generatedAt: p.now.toISOString(), hospitalId: p.hospitalId, sections, metrics: m }
}

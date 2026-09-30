/**
 * Phase 9 — Clinic Brain + Daily Command Center (unit, §17–§21).
 *
 * Deterministic operational intelligence:
 *  - today's appointments by status / no-shows / utilization (null, not 0,
 *    when nothing is scheduled — NOT_MEASURED honesty);
 *  - queue, OVERDUE follow-ups, pending treatments, doctor workload;
 *  - AI findings awaiting clinician review;
 *  - financial items ONLY for authorized roles (RECEPTIONIST →
 *    NOT_AVAILABLE, never a zeroed "success");
 *  - bounded deterministic bottleneck rules;
 *  - command center: typed sections; `delayedAppointments` is ALWAYS
 *    NOT_MEASURED (no chair-time telemetry — never claimed);
 *  - deterministic: same input → same output.
 */
import { describe, it, expect } from 'vitest'
import { createFakePrisma, HOSP_A, NOW } from '@/tests/harness/context-fixtures'
import { buildClinicMetrics, buildCommandCenter, type ClinicPrisma } from '@/lib/ai/intelligence/clinic-brain'

// Local "today" (same computation as the module's dayBounds).
const d0 = new Date(NOW)
const TODAY = (h: number, m = 0) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), h, m)
const daysAgo = (n: number, h = 9) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - n, h)

const STAFF = [{ id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' }]

function appt(id: string, status: string, at: Date, extra: Record<string, unknown> = {}) {
  return {
    id, hospitalId: HOSP_A, patientId: 'pat-A1', appointmentNo: `APPT-${id}`,
    appointmentType: 'CONSULTATION', status, scheduledDate: at, chiefComplaint: null,
    doctorId: 'staff-doctor-1', doctor: null, priority: 'NORMAL', createdAt: daysAgo(2), ...extra,
  }
}
function trtOverdue(id: string, daysA: number) {
  return {
    id, hospitalId: HOSP_A, patientId: 'pat-A1', treatmentNo: `TRT-${id}`,
    status: 'COMPLETED', toothNumbers: '36', diagnosis: null, findings: null, chiefComplaint: null,
    procedureId: 'proc-rct', procedure: { name: 'RCT' }, doctorId: 'staff-doctor-1', doctor: null,
    startTime: daysAgo(daysA + 10), endTime: daysAgo(daysA + 9), followUpRequired: true, followUpDate: daysAgo(daysA),
    followUpNotes: null, complications: null, appointmentId: null, createdAt: daysAgo(daysA + 10), updatedAt: daysAgo(daysA + 9),
  }
}

function richClinic() {
  return createFakePrisma({
    staff: STAFF,
    aiAnalysisJob: [
      { id: 'job-unrev', hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED', requestedById: null, modelVersion: 'v1', modelChecksum: 'c', orchestratorVersion: '2', startedAt: NOW, completedAt: NOW, confidence: 0.6, findings: [], reviewedById: null, reviewedAt: null, reviewDecision: null, acceptedFindings: null, createdAt: NOW },
    ],
    appointment: [
      appt('t1', 'COMPLETED', TODAY(8)),
      appt('t2', 'COMPLETED', TODAY(9)),
      appt('t3', 'IN_PROGRESS', TODAY(10)),
      appt('t4', 'CHECKED_IN', TODAY(8, 30)),
      appt('t5', 'CHECKED_IN', TODAY(9, 30)),
      appt('t6', 'CHECKED_IN', TODAY(10, 30)),
      appt('t7', 'CHECKED_IN', TODAY(11)),
      appt('t8', 'NO_SHOW', TODAY(7)),
      appt('t9', 'NO_SHOW', TODAY(12)),
      appt('t10', 'CANCELLED', TODAY(13)),
    ],
    treatment: [
      trtOverdue('o1', 1), trtOverdue('o2', 2), trtOverdue('o3', 3), trtOverdue('o4', 4), trtOverdue('o5', 5),
      {
        id: 'trt-pending', hospitalId: HOSP_A, patientId: 'pat-A1', treatmentNo: 'TRT-PEND',
        status: 'PLANNED', toothNumbers: '36', diagnosis: null, findings: null, chiefComplaint: null,
        procedureId: 'proc-crown', procedure: { name: 'Crown' }, doctorId: 'staff-doctor-1', doctor: null,
        startTime: null, endTime: null, followUpRequired: false, followUpDate: null,
        followUpNotes: null, complications: null, appointmentId: null, createdAt: daysAgo(1), updatedAt: daysAgo(1),
      },
    ],
  } as never)
}

describe('Phase 9 — clinic brain: deterministic metrics (§17)', () => {
  it('computes today by status, utilization, queue, backlog — all from verified data', async () => {
    const m = await buildClinicMetrics(richClinic() as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' })
    expect(m.date).toBeTruthy()
    // 10 appointments today; byStatus exact.
    expect(m.todayAppointments.total).toBe(10)
    expect(m.todayAppointments.byStatus).toMatchObject({ COMPLETED: 2, IN_PROGRESS: 1, CHECKED_IN: 4, NO_SHOW: 2, CANCELLED: 1 })
    expect(m.todayAppointments.noShows).toBe(2)
    expect(m.todayAppointments.cancellations).toBe(1)
    // utilization = (completed+in-progress)/total = 3/10
    expect(m.todayAppointments.utilization).toBe(0.3)
    // queue: 4 waiting (CHECKED_IN) → QUEUE_BACKLOG fires (>=4).
    expect(m.queue.waiting).toBe(4)
    const codes = m.bottlenecks.rows.map((b) => b.code)
    expect(codes).toContain('QUEUE_BACKLOG')
    // 2 no-shows < 3 → NO_SHOW_RATE must NOT fire (bounded rules, no noise).
    expect(codes).not.toContain('NO_SHOW_RATE')
    // 5 overdue follow-ups → FOLLOW_UP_BACKLOG (>=5).
    expect(m.overdueFollowUps.count).toBe(5)
    expect(codes).toContain('FOLLOW_UP_BACKLOG')
    // Pending treatments (PLANNED/IN_PROGRESS): the seeded PLANNED one +
    // the base fixture's IN_PROGRESS trt-A1.
    expect(m.pendingTreatments.count).toBe(2)
    expect(m.pendingTreatments.byStatus).toMatchObject({ PLANNED: 1, IN_PROGRESS: 1 })
    // AI review required: the unreviewed completed job.
    expect(m.aiReviewRequired.count).toBe(1)
    expect(m.aiReviewRequired.items[0].jobId).toBe('job-unrev')
    // Doctor workload: 10 today + 5 overdue.
    expect(m.doctorWorkload.rows).toEqual([{ doctorId: 'staff-doctor-1', scheduledToday: 10, overdueFollowUps: 5 }])
    // Unresolved tasks are explicit derived items.
    expect(m.unresolvedTasks.count).toBe(6)
  })

  it('an EMPTY day: total 0, utilization null (NOT a fake 0%), no bottlenecks', async () => {
    const m = await buildClinicMetrics(createFakePrisma({ staff: STAFF, aiAnalysisJob: [] } as never) as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' })
    expect(m.todayAppointments.total).toBe(0)
    expect(m.todayAppointments.utilization).toBeNull()
    expect(m.bottlenecks.rows).toHaveLength(0)
    expect(m.queue.waiting).toBe(0)
  })
})

describe('Phase 9 — clinic brain: financial gating (§17 "where authorized")', () => {
  it('authorized role → AVAILABLE with verified totals', async () => {
    const m = await buildClinicMetrics(richClinic() as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'ACCOUNTANT' })
    expect(m.financialItems.state).toBe('AVAILABLE')
    // Base fixture invoice: INV-A-9001 PENDING 2500.
    expect(m.financialItems.invoiceCount).toBe(1)
    expect(m.financialItems.openBalances).toBe(2500)
  })

  it('RECEPTIONIST → NOT_AVAILABLE (never a zeroed success)', async () => {
    const m = await buildClinicMetrics(richClinic() as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'RECEPTIONIST' })
    expect(m.financialItems.state).toBe('NOT_AVAILABLE')
    expect(m.financialItems.openBalances).toBe(0)
    expect(m.financialItems.invoiceCount).toBe(0)
  })
})

describe('Phase 9 — daily command center (§18–§19)', () => {
  it('typed sections; delayedAppointments ALWAYS NOT_MEASURED; roles shape financialItems', async () => {
    const cc = await buildCommandCenter(richClinic() as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' })
    expect(cc.hospitalId).toBe(HOSP_A)
    const keys = cc.sections.map((s) => s.key)
    for (const k of ['todaysAppointments', 'patientsWaiting', 'delayedAppointments', 'urgentClinicalReview', 'pendingFollowUps', 'pendingTreatments', 'aiFindingsAwaitingReview', 'operationalBottlenecks', 'unresolvedTasks', 'financialItems', 'doctorWorkload']) {
      expect(keys, `missing section ${k}`).toContain(k)
    }
    for (const s of cc.sections) {
      expect(['AVAILABLE', 'NOT_AVAILABLE', 'NOT_MEASURED']).toContain(s.state)
      for (const it of s.items) {
        expect(['FACT', 'AI_INTERPRETATION', 'DERIVED_INSIGHT', 'RECOMMENDATION', 'ACTION']).toContain(it.insightClass)
        expect(it.titleKey).toBeTruthy()
      }
    }
    // No chair-time telemetry → never claimed.
    const delayed = cc.sections.find((s) => s.key === 'delayedAppointments')!
    expect(delayed.state).toBe('NOT_MEASURED')
    // Financial section is AVAILABLE for ADMIN…
    expect(cc.sections.find((s) => s.key === 'financialItems')!.state).toBe('AVAILABLE')

    // …and NOT_AVAILABLE for a RECEPTIONIST (no data-shape leak).
    const ccRecep = await buildCommandCenter(richClinic() as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'RECEPTIONIST' })
    expect(ccRecep.sections.find((s) => s.key === 'financialItems')!.state).toBe('NOT_AVAILABLE')
  })

  it('deterministic: two runs over the same data → identical metrics', async () => {
    const a = await buildClinicMetrics(richClinic() as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' })
    const b = await buildClinicMetrics(richClinic() as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' })
    expect(b).toEqual(a)
  })

  it('cross-tenant isolation: tenant-B data never enters tenant-A metrics', async () => {
    const fake = createFakePrisma({
      staff: STAFF,
      aiAnalysisJob: [
        { id: 'job-B-unrev', hospitalId: 'hosp-B', studyId: 'study-B1', engine: 'clm', status: 'COMPLETED', requestedById: null, modelVersion: 'v1', modelChecksum: 'c', orchestratorVersion: '2', startedAt: NOW, completedAt: NOW, confidence: 0.9, findings: [], reviewedById: null, reviewedAt: null, reviewDecision: null, acceptedFindings: null, createdAt: NOW },
      ],
      appointment: [appt('bt1', 'COMPLETED', TODAY(8), { hospitalId: 'hosp-B', patientId: 'pat-B1' })],
    } as never)
    const m = await buildClinicMetrics(fake as unknown as ClinicPrisma, { hospitalId: HOSP_A, now: NOW, actorRole: 'ADMIN' })
    expect(m.todayAppointments.total).toBe(0)
    expect(m.aiReviewRequired.count).toBe(0)
  })
})

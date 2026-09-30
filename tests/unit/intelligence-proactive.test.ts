/**
 * Phase 9 — bounded proactive intelligence (unit, §17–§21, §34).
 *
 * Pure deterministic rules over structured data (no LLM):
 *  - follow-ups: overdue (>7d CRITICAL else WARNING) / due-within-3d (INFO)
 *    / required-without-date (CASE_INCOMPLETE WARNING);
 *  - missed appointments (past due −30min unchecked-in; recorded NO_SHOW);
 *  - AI_REVIEW_REQUIRED per unreviewed COMPLETED job;
 *  - QUEUE_BOTTLENECK (>=4 WARNING, >=8 CRITICAL);
 *  - dedup by stable key per (tenant, type, scope) — idempotent re-runs;
 *  - dismissal is a STATE change (audit row kept, dismissedById/At recorded);
 *  - alerts are SIGNALS ONLY: `action` is null on purpose (§34) — acting on
 *    one is a separate approved action, never autonomous;
 *  - tenant isolation on detection, dedup and dismissal.
 */
import { describe, it, expect } from 'vitest'
import { createFakePrisma, HOSP_A, NOW } from '@/tests/harness/context-fixtures'
import { runProactiveIntelligence, dismissAlert, type AlertPrisma } from '@/lib/ai/intelligence/proactive'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY)
/** earlier TODAY (NOW is 12:00Z; 3–5h back stays same day in UTC and Africa/Cairo) */
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000)
const hoursAhead = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

type InsightRow = Record<string, unknown>

/** createFakePrisma + a stateful aiInsight delegate (findMany/create/updateMany). */
function makeDb(extra: Record<string, unknown[]> = {}) {
  const rows: InsightRow[] = []
  const base = createFakePrisma({ aiAnalysisJob: [], ...extra } as never) as unknown as Record<string, unknown>
  const delegate = {
    findMany: async (args?: { where?: Record<string, unknown> }) => {
      const w = args?.where ?? {}
      return rows.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v))
    },
    create: async (args: { data: InsightRow }) => {
      const row = { id: `ins-${rows.length + 1}`, createdAt: NOW, dismissed: false, actionTaken: false, ...args.data }
      rows.push(row)
      return row
    },
    updateMany: async (args: { where: Record<string, unknown>; data: InsightRow }) => {
      let count = 0
      for (const r of rows) {
        if (Object.entries(args.where).every(([k, v]) => r[k] === v)) {
          Object.assign(r, args.data)
          count++
        }
      }
      return { count }
    },
  }
  base.aiInsight = delegate
  return { db: base as unknown as AlertPrisma, rows }
}

function trt(id: string, over: { required?: boolean; status?: string; date?: Date | null }) {
  return {
    id, hospitalId: HOSP_A, patientId: 'pat-A1', treatmentNo: `TRT-${id}`,
    status: over.status ?? 'COMPLETED', toothNumbers: '36', diagnosis: null, findings: null, chiefComplaint: null,
    procedureId: 'p', procedure: null, doctorId: 'staff-doctor-1', doctor: null,
    startTime: daysAgo(30), endTime: daysAgo(29), followUpRequired: over.required ?? true,
    followUpDate: over.date === undefined ? daysAgo(10) : over.date,
    followUpNotes: null, complications: null, appointmentId: null, createdAt: daysAgo(30), updatedAt: daysAgo(29),
  }
}
function appt(id: string, status: string, at: Date, extra: Record<string, unknown> = {}) {
  return {
    id, hospitalId: HOSP_A, patientId: 'pat-A1', appointmentNo: `APPT-${id}`,
    appointmentType: 'CONSULTATION', status, scheduledDate: at, chiefComplaint: null,
    doctorId: 'staff-doctor-1', doctor: null, priority: 'NORMAL', checkedInAt: null, checkedOutAt: null,
    createdAt: daysAgo(2), ...extra,
  }
}
const job = (id: string, reviewDecision: string | null) => ({
  id, hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED',
  requestedById: null, modelVersion: 'v1', modelChecksum: 'c', orchestratorVersion: '2',
  startedAt: NOW, completedAt: NOW, confidence: 0.5, findings: [],
  reviewedById: reviewDecision ? 'staff-doctor-1' : null, reviewedAt: reviewDecision ? NOW : null,
  reviewDecision, acceptedFindings: null, createdAt: NOW,
})

describe('Phase 9 — proactive: rules (§17–§21)', () => {
  it('follow-up severities: >7d CRITICAL, <=7d WARNING, due-within-3d INFO, no-date CASE_INCOMPLETE', async () => {
    const { db } = makeDb({
      treatment: [
        trt('t-old', { date: daysAgo(10) }),
        trt('t-mid', { date: daysAgo(2) }),
        trt('t-soon', { date: daysAhead(2) }),
        trt('t-far', { date: daysAhead(10) }), // not within 3d → silent
        trt('t-nodate', { date: null }),
      ],
    })
    const res = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'staff-1' })
    const find = (type: string, no: string) =>
      res.detected.find((a) => a.alertType === type && a.evidence.treatmentNo === no)
    expect(find('FOLLOW_UP_DUE', 'TRT-t-old')?.severity).toBe('CRITICAL')
    expect(find('FOLLOW_UP_DUE', 'TRT-t-mid')?.severity).toBe('WARNING')
    expect(find('FOLLOW_UP_DUE', 'TRT-t-soon')?.severity).toBe('INFO')
    expect(find('FOLLOW_UP_DUE', 'TRT-t-far')).toBeUndefined()
    expect(find('CASE_INCOMPLETE', 'TRT-t-nodate')?.severity).toBe('WARNING')
  })

  it('missed appointments: past-due unchecked-in WARNING + recorded NO_SHOW INFO', async () => {
    const { db } = makeDb({
      appointment: [
        appt('a-missed', 'SCHEDULED', hoursAgo(3)), // 3h past, no check-in
        appt('a-checked', 'SCHEDULED', hoursAgo(3), { checkedInAt: hoursAgo(3) }),
        appt('a-noshow', 'NO_SHOW', hoursAgo(2)),
      ],
    })
    const res = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'staff-1' })
    const missed = res.detected.filter((a) => a.alertType === 'MISSED_APPOINTMENT')
    expect(missed).toHaveLength(2)
    expect(missed.find((a) => a.evidence.appointmentNo === 'APPT-a-missed')?.severity).toBe('WARNING')
    expect(missed.find((a) => a.evidence.appointmentNo === 'APPT-a-noshow')?.severity).toBe('INFO')
  })

  it('AI_REVIEW_REQUIRED per unreviewed COMPLETED job (reviewed jobs silent)', async () => {
    const { db } = makeDb({
      aiAnalysisJob: [job('job-1', null), job('job-2', 'ACCEPTED'), job('job-3', 'REJECTED')],
    })
    const res = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'staff-1' })
    const ai = res.detected.filter((a) => a.alertType === 'AI_REVIEW_REQUIRED')
    expect(ai).toHaveLength(1)
    expect(ai[0].evidence.jobId).toBe('job-1')
  })

  it('queue bottleneck: 4 waiting WARNING, 8 waiting CRITICAL', async () => {
    const mk4 = makeDb({ appointment: [1, 2, 3, 4].map((i) => appt(`q${i}`, 'CHECKED_IN', hoursAhead(1))) })
    const r4 = await runProactiveIntelligence(mk4.db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    const b4 = r4.detected.find((a) => a.alertType === 'QUEUE_BOTTLENECK')
    expect(b4?.severity).toBe('WARNING')

    const mk8 = makeDb({ appointment: Array.from({ length: 8 }, (_, i) => appt(`q8-${i}`, 'CHECKED_IN', hoursAhead(1))) })
    const r8 = await runProactiveIntelligence(mk8.db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    expect(r8.detected.find((a) => a.alertType === 'QUEUE_BOTTLENECK')?.severity).toBe('CRITICAL')
  })
})

describe('Phase 9 — proactive: dedup & dismissal (§21)', () => {
  it('re-run is idempotent: same triggers → 0 created, all deduplicated', async () => {
    const extra = {
      treatment: [trt('t1', { date: daysAgo(10) })],
      aiAnalysisJob: [job('job-1', null)],
    }
    const one = makeDb(extra)
    const first = await runProactiveIntelligence(one.db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    expect(first.created).toBe(2)
    const second = await runProactiveIntelligence(one.db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    expect(second.created).toBe(0)
    expect(second.deduplicated).toBe(2)
    expect(one.rows).toHaveLength(2)
  })

  it('dismissal is a STATE change: row kept, actor+time recorded, re-runs recreate', async () => {
    const { db, rows } = makeDb({ treatment: [trt('t1', { date: daysAgo(10) })] })
    const first = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    expect(first.created).toBe(1)
    const alertId = rows[0].id as string

    const res = await dismissAlert(db, { hospitalId: HOSP_A, alertId, actorId: 'staff-2' })
    expect(res).toEqual({ ok: true, state: 'DISMISSED' })
    // Row KEPT (audit), with dismissal metadata.
    expect(rows).toHaveLength(1)
    expect(rows[0].dismissed).toBe(true)
    const data = rows[0].data as Record<string, unknown>
    expect(data.dismissedById).toBe('staff-2')
    expect(typeof data.dismissedAt).toBe('string')

    // A dismissed alert does NOT block re-detection.
    const again = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    expect(again.created).toBe(1)
    expect(again.deduplicated).toBe(0)
  })

  it('dismissal of a foreign/unknown id → NOT_FOUND (tenant-pinned)', async () => {
    const { db, rows } = makeDb({ treatment: [trt('t1', { date: daysAgo(10) })] })
    await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    // A tenant-B row that tenant A cannot dismiss.
    rows.push({ id: 'ins-B', hospitalId: 'hosp-B', dismissed: false, data: { kind: 'PROACTIVE_ALERT', dedupKey: 'x' } })
    expect(await dismissAlert(db, { hospitalId: HOSP_A, alertId: 'ins-B', actorId: 's' })).toEqual({ ok: false, state: 'NOT_FOUND' })
    expect(await dismissAlert(db, { hospitalId: HOSP_A, alertId: 'ins-nope', actorId: 's' })).toEqual({ ok: false, state: 'NOT_FOUND' })
  })
})

describe('Phase 9 — proactive: signal-only + tenant isolation (§34)', () => {
  it('every persisted alert is a SIGNAL: kind PROACTIVE_ALERT, action null, 14d expiry', async () => {
    const { db, rows } = makeDb({
      treatment: [trt('t1', { date: daysAgo(10) })],
      appointment: [appt('a1', 'NO_SHOW', hoursAgo(2))],
    })
    await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 'staff-9' })
    expect(rows.length).toBe(2)
    for (const r of rows) {
      const data = r.data as Record<string, unknown>
      expect(data.kind).toBe('PROACTIVE_ALERT')
      expect(data.action).toBeNull() // never an autonomous action
      expect(data.detectedById).toBe('staff-9')
      expect(new Date(r.expiresAt as string).getTime()).toBe(NOW.getTime() + 14 * DAY)
      expect(r.hospitalId).toBe(HOSP_A)
    }
  })

  it('tenant isolation: tenant-B triggers never create tenant-A rows', async () => {
    const { db, rows } = makeDb({
      treatment: [{ ...trt('tb', { date: daysAgo(10) }), hospitalId: 'hosp-B', patientId: 'pat-B1' }],
    })
    const res = await runProactiveIntelligence(db, { hospitalId: HOSP_A, now: NOW, actorId: 's' })
    expect(res.detected).toHaveLength(0)
    expect(rows).toHaveLength(0)
  })
})

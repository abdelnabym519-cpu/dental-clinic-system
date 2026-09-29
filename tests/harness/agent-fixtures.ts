/**
 * Phase 3 — Agent harness.
 *
 * Extends the Phase 2 context-engine fixtures with the rows the agent's
 * clinic tools need: appointments with nested patient objects (queue /
 * schedule / today views) and due follow-up treatments. Cross-tenant rows
 * are included deliberately — tools must never leak them.
 *
 * Phase 2 files are UNCHANGED except the additive `lt`/`lte` operators in
 * the mini where-engine (production Prisma semantics).
 */

import { createFakePrisma, HOSP_A, HOSP_B, NOW, PAT_A1, PAT_A2 } from './context-fixtures'

// Convenience re-exports for agent tests (single import point).
export { HOSP_A, HOSP_B, NOW, PAT_A1, PAT_A2, ACTORS } from './context-fixtures'

const d = (days: number, hours = 0) => new Date(NOW.getTime() + days * 86400000 + hours * 3600000)

export type AgentRows = Record<string, Record<string, any>[]>

/** Rows the agent needs beyond the Phase 2 surface. */
const AGENT_ROWS: AgentRows = {
  appointment: [
    // Currently checked in (queue).
    {
      id: 'appt-q1', hospitalId: HOSP_A, patientId: PAT_A1, appointmentNo: 'APPT-A-3001',
      appointmentType: 'CONSULTATION', status: 'CHECKED_IN', scheduledDate: d(0, -1),
      chiefComplaint: 'Cold sensitivity 36', doctorId: 'staff-doctor-1',
      doctor: { firstName: 'Hana', lastName: 'Shalaby' },
      patient: { firstName: 'Ahmed', lastName: 'Ali' }, createdAt: d(-1),
    },
    {
      id: 'appt-q2', hospitalId: HOSP_A, patientId: PAT_A2, appointmentNo: 'APPT-A-3002',
      appointmentType: 'FOLLOW_UP', status: 'IN_PROGRESS', scheduledDate: d(0, -2),
      chiefComplaint: 'Post-crown check', doctorId: 'staff-doctor-1',
      doctor: { firstName: 'Hana', lastName: 'Shalaby' },
      patient: { firstName: 'Sara', lastName: 'Hassan' }, createdAt: d(-2),
    },
    // Scheduled today (list view).
    {
      id: 'appt-t1', hospitalId: HOSP_A, patientId: PAT_A1, appointmentNo: 'APPT-A-3003',
      appointmentType: 'PROCEDURE', status: 'SCHEDULED', scheduledDate: d(0, 3),
      chiefComplaint: null, doctorId: 'staff-doctor-1',
      doctor: { firstName: 'Hana', lastName: 'Shalaby' },
      patient: { firstName: 'Ahmed', lastName: 'Ali' }, createdAt: d(-3),
    },
    // Same day, OTHER tenant — must never appear in tenant-A results.
    {
      id: 'appt-b-today', hospitalId: HOSP_B, patientId: 'pat-B1', appointmentNo: 'APPT-B-3001',
      appointmentType: 'CHECK_UP', status: 'SCHEDULED', scheduledDate: d(0, 4),
      chiefComplaint: null, doctorId: 'staff-doctor-B',
      doctor: { firstName: 'Laila', lastName: 'Nabil' },
      patient: { firstName: 'Omar', lastName: 'Farouk' }, createdAt: d(-1),
    },
  ],
  treatment: [
    {
      id: 'trt-due-1', hospitalId: HOSP_A, patientId: PAT_A1, treatmentNo: 'TRT-A-801',
      status: 'COMPLETED', toothNumbers: '36',
      followUpRequired: true, followUpDate: d(5), followUpNotes: 'Post root-canal recheck',
      doctorId: 'staff-doctor-1', doctor: { firstName: 'Hana', lastName: 'Shalaby' },
      startTime: d(-30), endTime: d(-30), createdAt: d(-30),
    },
    {
      id: 'trt-due-2', hospitalId: HOSP_A, patientId: PAT_A2, treatmentNo: 'TRT-A-802',
      status: 'COMPLETED', toothNumbers: '46',
      followUpRequired: true, followUpDate: d(-2), followUpNotes: null,
      doctorId: 'staff-doctor-1', doctor: { firstName: 'Hana', lastName: 'Shalaby' },
      startTime: d(-60), endTime: d(-60), createdAt: d(-60),
    },
    // Other tenant — must never leak.
    {
      id: 'trt-due-b', hospitalId: HOSP_B, patientId: 'pat-B1', treatmentNo: 'TRT-B-801',
      status: 'COMPLETED', toothNumbers: '11',
      followUpRequired: true, followUpDate: d(1), followUpNotes: null,
      doctorId: 'staff-doctor-B', doctor: { firstName: 'Laila', lastName: 'Nabil' },
      startTime: d(-10), endTime: d(-10), createdAt: d(-10),
    },
  ],
}

/**
 * Prisma-shaped fake for agent tests. `extra` is appended on top of the
 * agent rows (e.g. a duplicate-named patient for ambiguity tests).
 */
export function createAgentFakePrisma(extra?: AgentRows) {
  const merged: AgentRows = {}
  for (const [name, rows] of Object.entries(AGENT_ROWS)) {
    merged[name] = [...rows, ...(extra?.[name] ?? [])]
  }
  if (extra) {
    for (const [name, rows] of Object.entries(extra)) {
      merged[name] = [...(merged[name] ?? []), ...rows]
    }
  }
  return createFakePrisma(merged)
}

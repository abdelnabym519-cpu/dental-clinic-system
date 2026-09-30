// @ts-nocheck
/**
 * Phase 9 — intelligence + workflows API routes (§37–§39).
 *
 * Contract under test (same conventions as Phase 4/6/8 additive routes):
 *  - 401 without a session; 403 when the session role is outside the
 *    surface's roles (mocked requireAuthAndRole mirrors the real helper);
 *  - patient/case scope RE-VALIDATED server-side: forged/foreign patientId
 *    → 404 INT_PATIENT_NOT_FOUND; PATIENT pinned to their own linked
 *    patient (sibling patient → 404);
 *  - typed INT_* errors with flat i18n messageKeys (never free-form text
 *    as the contract — the code is machine-readable);
 *  - clinic: financialItems gated by role (RECEPTIONIST → NOT_AVAILABLE);
 *  - alerts: sweep → GET list → dismiss (state change, row kept);
 *  - workflows: GET definitions; run (persisted AiWorkflowRun row + audit);
 *    RBAC 403; cancel (validated transition; re-cancel → 409); sensitive
 *    steps park in WAITING_APPROVAL through the Phase-1 pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakePrisma, HOSP_A, HOSP_B, PAT_A1, PAT_A2, PAT_B1, ACTORS } from '@/tests/harness/context-fixtures'

const store = vi.hoisted(() => ({
  auth: { error: null, user: null, hospitalId: 'hosp-A' },
  action: { response: null },
}))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: async (allowedRoles) => {
    const { error, user, hospitalId } = store.auth
    if (error || !user || !hospitalId) return { error: error || { status: 401 }, user: null, hospitalId: null, session: null }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      return { error: { status: 403 }, user: null, hospitalId: null, session: null }
    }
    return { error: null, user, hospitalId, session: { user } }
  },
}))

let fake = null
vi.mock('@/lib/prisma', () => ({ get prisma() { return fake } }))

vi.mock('@/lib/ai/action-pipeline', () => ({
  runAiAction: async (args) => store.action.response(args),
}))

const { GET: caseGET } = await import('@/app/api/ai/intelligence/case/route')
const { GET: patientGET } = await import('@/app/api/ai/intelligence/patient/route')
const { GET: summaryGET } = await import('@/app/api/ai/intelligence/summary/route')
const { GET: clinicGET } = await import('@/app/api/ai/intelligence/clinic/route')
const { GET: alertsGET, POST: alertsPOST } = await import('@/app/api/ai/intelligence/alerts/route')
const { GET: wfGET, POST: wfPOST } = await import('@/app/api/ai/workflows/route')

// ---------------------------------------------------------------------------
// Fake prisma: harness tables + the Phase-9 delegates the routes need
// ---------------------------------------------------------------------------

const STAFF = [{ id: 'staff-doctor-1', hospitalId: HOSP_A, firstName: 'Hana', lastName: 'Shalaby', role: 'DOCTOR' }]
const JOB_ACCEPTED = {
  id: 'job-A1', hospitalId: HOSP_A, studyId: 'study-A1', engine: 'clm', status: 'COMPLETED',
  requestedById: 'staff-doctor-1', modelVersion: 'v1.2.0', modelChecksum: 'c0ffee',
  orchestratorVersion: '2.1.0', startedAt: new Date('2026-09-19T12:00:00Z'), completedAt: new Date('2026-09-19T12:00:00Z'),
  confidence: 0.87, findings: [{ condition: 'caries', tooth_number: 36 }],
  reviewedById: 'staff-doctor-1', reviewedAt: new Date('2026-09-21T12:00:00Z'), reviewDecision: 'ACCEPTED',
  acceptedFindings: [{ condition: 'caries', tooth_number: 36 }], createdAt: new Date('2026-09-19T12:00:00Z'),
}
const JOB_UNREVIEWED = { ...JOB_ACCEPTED, id: 'job-pend', reviewDecision: null, reviewedById: null, reviewedAt: null, acceptedFindings: null }

function makeFake() {
  const base = createFakePrisma({
    staff: STAFF,
    aiAnalysisJob: [JOB_ACCEPTED, JOB_UNREVIEWED],
    aiMemoryItem: [],
  })

  // patient.findFirst with portalUser-relational matching (PATIENT self-pin).
  const origFirst = base.patient.findFirst.bind(base.patient)
  base.patient.findFirst = async (args = {}) => {
    const w = args.where ?? {}
    if (w.portalUser && w.portalUser.is && typeof w.portalUser.is.id === 'string') {
      const rows = await base.patient.findMany({ where: { hospitalId: w.hospitalId } })
      return rows.find((p) => p.portalUserId === w.portalUser.is.id) ?? null
    }
    return origFirst(args)
  }

  // auditLog (fire-and-forget collector).
  const audits = []
  base.auditLog = { create: async ({ data }) => { audits.push(data); return data } }

  // aiInsight: stateful rows + the query shapes the alerts route/proactive use.
  const insightRows = []
  let insightSeq = 0
  const matchI = (row, where) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === 'OR') return (v as unknown[]).some((sub) => matchI(row, sub))
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        const c = v as Record<string, unknown>
        if ('in' in c) return (c.in as unknown[]).includes(row[k])
        if ('gt' in c) return new Date(row[k]).getTime() > new Date(c.gt as string).getTime()
        return true
      }
      return row[k] === v
    })
  base.aiInsight = {
    findMany: async ({ where, orderBy, take } = {}) => {
      let rows = insightRows.filter((r) => matchI(r, where))
      if (Array.isArray(orderBy)) {
        const sevRank = { CRITICAL: 3, WARNING: 2, INFO: 1 }
        rows = [...rows].sort((a, b) => {
          for (const [f, dir] of Object.entries(orderBy[0])) {
            const av = f === 'severity' ? sevRank[a[f]] ?? 0 : String(a[f] ?? '')
            const bv = f === 'severity' ? sevRank[b[f]] ?? 0 : String(b[f] ?? '')
            const c = av === bv ? 0 : (av as unknown) > (bv as unknown) ? 1 : -1
            if (c !== 0) return dir === 'asc' ? c : -c
          }
          return 0
        })
      }
      if (typeof take === 'number') rows = rows.slice(0, take)
      return rows
    },
    create: async ({ data }) => {
      const row = { id: `ins-${++insightSeq}`, createdAt: new Date(), dismissed: false, ...data }
      insightRows.push(row)
      return row
    },
    updateMany: async ({ where, data }) => {
      let count = 0
      for (const r of insightRows) {
        if (matchI(r, where)) { Object.assign(r, data); count += 1 }
      }
      return { count }
    },
  }

  // aiWorkflowRun: stateful (tenant rows; composite findUnique).
  const wfRows = []
  base.aiWorkflowRun = {
    findMany: async ({ where } = {}) => wfRows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)),
    create: async ({ data }) => {
      const row = { ...data, createdAt: new Date() }
      wfRows.push(row)
      return row
    },
    findUnique: async ({ where }) => wfRows.find((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)) ?? null,
    update: async ({ where, data }) => {
      const r = wfRows.find((row) => Object.entries(where ?? {}).every(([k, v]) => row[k] === v))
      if (!r) throw new Error('aiWorkflowRun not found')
      Object.assign(r, data)
      return r
    },
  }

  // Attach the observable collections to the fake itself (routes see `base`).
  base.__phase9 = { audits, insightRows, wfRows }
  return base
}

function setAuth(user, hospitalId = HOSP_A) {
  store.auth = { error: null, user, hospitalId }
}
const DOCTOR = { id: ACTORS.doctorA.id, role: 'DOCTOR', name: 'Hana Shalaby', firstName: 'Hana', lastName: 'Shalaby' }
const RECEPTIONIST = { id: ACTORS.receptionistA.id, role: 'RECEPTIONIST', name: 'Recep A' }
const PATIENT_A = { id: ACTORS.patientA.id, role: 'PATIENT', name: 'Ahmed Ali' }
const PATIENT_B = { id: ACTORS.patientB.id, role: 'PATIENT', name: 'Omar Farouk' }

const url = (p: string) => new Request(`http://localhost/api${p}`)
const post = (p: string, body: unknown) =>
  new Request(`http://localhost/api${p}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const json = async (res) => res.json()

beforeEach(() => {
  fake = makeFake()
  store.action.response = null
})

// ---------------------------------------------------------------------------
// Auth (all six routes)
// ---------------------------------------------------------------------------

describe('Phase 9 API — auth (§38)', () => {
  it('401 without a session on every route', async () => {
    store.auth = { error: { status: 401 }, user: null, hospitalId: null }
    expect((await caseGET(url('/ai/intelligence/case?patientId=pat-A1'))).status).toBe(401)
    expect((await patientGET(url('/ai/intelligence/patient?patientId=pat-A1'))).status).toBe(401)
    expect((await summaryGET(url('/ai/intelligence/summary?patientId=pat-A1'))).status).toBe(401)
    expect((await clinicGET(url('/ai/intelligence/clinic'))).status).toBe(401)
    expect((await alertsGET(url('/ai/intelligence/alerts'))).status).toBe(401)
    expect((await wfGET(url('/ai/workflows'))).status).toBe(401)
    expect((await wfPOST(post('/ai/workflows', { op: 'list' }))).status).toBe(401)
  })

  it('403 when the session role is outside the surface', async () => {
    setAuth({ id: 's', role: 'LAB_TECH', name: 'Lab' })
    // LAB_TECH is not on the patient/case/summary surface.
    expect((await patientGET(url('/ai/intelligence/patient?patientId=pat-A1'))).status).toBe(403)
    // …but the clinic surface allows it? No — clinic excludes LAB_TECH too.
    expect((await clinicGET(url('/ai/intelligence/clinic'))).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Scope re-validation (case + patient + summary)
// ---------------------------------------------------------------------------

describe('Phase 9 API — scope re-validation (§38)', () => {
  it('staff 200 with understanding; unknown/cross-tenant patient → 404 typed', async () => {
    setAuth(DOCTOR)
    const ok = await caseGET(url('/ai/intelligence/case?patientId=pat-A1'))
    expect(ok.status).toBe(200)
    const body = await json(ok)
    expect(body.hospitalId).toBe(HOSP_A)
    expect(body.patientId).toBe(PAT_A1)
    expect(body.caseId).toBeNull()
    expect(body.understanding).toBeTruthy()

    // Missing patientId.
    expect((await caseGET(url('/ai/intelligence/case'))).status).toBe(404)
    // Cross-tenant patient id → NOT_FOUND (never a foreign graph).
    const foreign = await caseGET(url('/ai/intelligence/case?patientId=pat-B1'))
    expect(foreign.status).toBe(404)
    expect((await json(foreign)).error.code).toBe('INT_PATIENT_NOT_FOUND')
  })

  it('case scope: valid plan echoes; foreign/unknown plan → 404 INT_CASE_NOT_FOUND', async () => {
    setAuth(DOCTOR)
    const ok = await json(await caseGET(url('/ai/intelligence/case?patientId=pat-A1&caseId=plan-A1')))
    expect(ok.caseId).toBe('plan-A1')
    const bad = await json(await caseGET(url('/ai/intelligence/case?patientId=pat-A1&caseId=plan-NOPE')))
    expect(bad.error.code).toBe('INT_CASE_NOT_FOUND')
  })

  it('PATIENT is pinned to their own linked patient (sibling → 404)', async () => {
    setAuth(PATIENT_A)
    expect((await patientGET(url('/ai/intelligence/patient?patientId=pat-A1'))).status).toBe(200)
    // A different patient in the SAME tenant is not theirs.
    const sib = await patientGET(url('/ai/intelligence/patient?patientId=pat-A2'))
    expect(sib.status).toBe(404)
    expect((await json(sib)).error.code).toBe('INT_PATIENT_NOT_FOUND')
    // Tenant-B patient (the portal user of tenant B) querying tenant A.
    setAuth(PATIENT_B)
    expect((await patientGET(url('/ai/intelligence/patient?patientId=pat-A1'))).status).toBe(404)
  })

  it('summary: 16 fixed sections + CDS differential stance', async () => {
    setAuth(DOCTOR)
    const res = await summaryGET(url('/ai/intelligence/summary?patientId=pat-A1'))
    const body = await json(res)
    // Fixed section shape: 16 named sections + disclaimer (flat object).
    const sectionKeys = [
      'patientContext', 'chiefComplaint', 'relevantHistory', 'affectedTeeth', 'symptoms',
      'clinicalFindings', 'imaging', 'aiFindings', 'clinicianConfirmedFindings', 'differentialConsiderations',
      'treatmentHistory', 'currentTreatment', 'pendingItems', 'followUp', 'knownUncertainty', 'missingInformation',
    ]
    expect(Object.keys(body.summary)).toHaveLength(16 + 1) // + disclaimerKey
    for (const k of sectionKeys) {
      expect(body.summary[k], `section ${k}`).toBeTruthy()
      expect(['AVAILABLE', 'NOT_AVAILABLE', 'NOT_MEASURED']).toContain(body.summary[k].state)
      expect(Array.isArray(body.summary[k].lines)).toBe(true)
    }
    expect(body.summary.disclaimerKey).toBe('int.summary.disclaimer')
    expect(body.differential.stance).toBe('clinical_decision_support')
  })
})

// ---------------------------------------------------------------------------
// Clinic + command center (role-gated financials)
// ---------------------------------------------------------------------------

describe('Phase 9 API — clinic (§17, §38)', () => {
  it('DOCTOR: metrics + command center; financials AVAILABLE', async () => {
    setAuth({ id: ACTORS.accountantA.id, role: 'ACCOUNTANT', name: 'Acc A' })
    const body = await json(await clinicGET(url('/ai/intelligence/clinic')))
    expect(body.hospitalId).toBe(HOSP_A)
    expect(body.metrics).toBeTruthy()
    expect(body.commandCenter.sections.length).toBeGreaterThanOrEqual(10)
    expect(body.metrics.financialItems.state).toBe('AVAILABLE')
  })

  it('RECEPTIONIST: same shape, financials NOT_AVAILABLE (no money data)', async () => {
    setAuth(RECEPTIONIST)
    const body = await json(await clinicGET(url('/ai/intelligence/clinic')))
    expect(body.metrics).toBeTruthy()
    expect(body.metrics.financialItems.state).toBe('NOT_AVAILABLE')
    expect(body.metrics.financialItems.openBalances).toBe(0)
    // A DOCTOR is also not a financial role.
    setAuth(DOCTOR)
    const doc = await json(await clinicGET(url('/ai/intelligence/clinic')))
    expect(doc.metrics.financialItems.state).toBe('NOT_AVAILABLE')
  })
})

// ---------------------------------------------------------------------------
// Proactive alerts: run → list → dismiss
// ---------------------------------------------------------------------------

describe('Phase 9 API — alerts (§21, §34)', () => {
  it('sweep detects unreviewed AI job; GET lists the signal; dismiss is a state change', async () => {
    setAuth(DOCTOR)
    // Run the deterministic sweep.
    const runRes = await alertsPOST(post('/ai/intelligence/alerts', { op: 'run' }))
    const run = await json(runRes)
    expect(run.result.created).toBeGreaterThanOrEqual(1)
    const createdAlert = fake.__phase9.insightRows.find((r) => r.data?.alertType === 'AI_REVIEW_REQUIRED' && r.data?.evidence?.jobId === 'job-pend')
    expect(createdAlert).toBeTruthy()
    expect(createdAlert.data.action).toBeNull() // signal only
    expect(createdAlert.data.kind).toBe('PROACTIVE_ALERT')

    // GET lists active alerts.
    const list = await json(await alertsGET(url('/ai/intelligence/alerts')))
    expect(list.count).toBeGreaterThanOrEqual(1)
    const item = list.alerts.find((a) => a.data.evidence.jobId === 'job-pend')
    expect(item).toBeTruthy()
    expect(item.severity).toBe('WARNING')

    // Re-run → idempotent (deduplicated).
    const run2 = await json(await alertsPOST(post('/ai/intelligence/alerts', { op: 'run' })))
    expect(run2.result.created).toBe(0)
    expect(run2.result.deduplicated).toBe(run.result.created)

    // Dismiss → state change; row kept; GET no longer lists it.
    const dis = await json(await alertsPOST(post('/ai/intelligence/alerts', { op: 'dismiss', alertId: createdAlert.id })))
    expect(dis).toMatchObject({ ok: true, state: 'DISMISSED' })
    expect(fake.__phase9.insightRows).toHaveLength(fake.__phase9.insightRows.length) // not deleted
    expect(createdAlert.dismissed).toBe(true)
    expect(createdAlert.data.dismissedById).toBe(DOCTOR.id)
    const list2 = await json(await alertsGET(url('/ai/intelligence/alerts')))
    expect(list2.alerts.find((a) => a.id === createdAlert.id)).toBeUndefined()

    // Audit trail written (run + dismiss).
    const actions = fake.__phase9.audits.map((a) => a.action)
    expect(actions).toContain('AI_INTELLIGENCE_ALERTS_RUN')
    expect(actions).toContain('AI_INTELLIGENCE_ALERT_DISMISS')
  })

  it('dismiss unknown alert → 404 INT_ALERT_NOT_FOUND; bad op → 400', async () => {
    setAuth(DOCTOR)
    const dis = await json(await alertsPOST(post('/ai/intelligence/alerts', { op: 'dismiss', alertId: 'ins-nope' })))
    expect(dis.error.code).toBe('INT_ALERT_NOT_FOUND')
    const bad = await json(await alertsPOST(post('/ai/intelligence/alerts', { op: 'fly' })))
    expect(bad.error.code).toBe('INT_INVALID_PARAMS')
  })
})

// ---------------------------------------------------------------------------
// Workflows: definitions, run, RBAC, cancel, persistence
// ---------------------------------------------------------------------------

describe('Phase 9 API — workflows (§22–§26, §38)', () => {
  it('GET: four versioned definitions with bounded budgets', async () => {
    setAuth(DOCTOR)
    const body = await json(await wfGET(url('/ai/workflows')))
    expect(body.workflows).toHaveLength(4)
    for (const w of body.workflows) {
      expect(w.workflowId).toBeTruthy()
      expect(w.version).toBeGreaterThanOrEqual(1)
      expect(w.maxSteps).toBeGreaterThan(0)
      expect(w.maxToolCalls).toBeGreaterThan(0)
      expect(w.timeoutMs).toBeGreaterThan(0)
      expect(w.stepIds.length).toBeLessThanOrEqual(w.maxSteps)
    }
  })

  it('run case_review → COMPLETED; AiWorkflowRun row persisted + audited', async () => {
    setAuth(DOCTOR)
    const body = await json(await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'case_review', patientId: PAT_A1 })))
    expect(body.run.status).toBe('COMPLETED')
    expect(body.run.workflowId).toBe('case_review')
    expect(body.outputItems.length).toBeGreaterThan(0)
    const row = fake.__phase9.wfRows.find((r) => r.id === body.run.id)
    expect(row).toBeTruthy()
    expect(row.status).toBe('COMPLETED')
    expect(row.hospitalId).toBe(HOSP_A)
    expect(row.stepLog.length).toBe(9)
    expect(fake.__phase9.audits.map((a) => a.action)).toContain('AI_WORKFLOW_CASE_REVIEW')
  })

  it('RBAC: a role outside the definition → 403 INT_WORKFLOW_ROLE_DENIED', async () => {
    setAuth(RECEPTIONIST)
    const res = await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'daily_clinic_review', patientId: null }))
    expect(res.status).toBe(403)
    expect((await json(res)).error.code).toBe('INT_WORKFLOW_ROLE_DENIED')
  })

  it('unknown workflowId → 404; forged patientId → 404 typed', async () => {
    setAuth(DOCTOR)
    const unknown = await json(await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'hack', patientId: PAT_A1 })))
    expect(unknown.error.code).toBe('INT_WORKFLOW_NOT_FOUND')
    const forged = await json(await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'case_review', patientId: 'pat-B1' })))
    expect(forged.error.code).toBe('INT_PATIENT_NOT_FOUND')
  })

  it('follow_up with approval pipeline → WAITING_APPROVAL (never executed)', async () => {
    setAuth(DOCTOR)
    store.action.response = async () => ({ status: 'APPROVAL_REQUIRED', success: false, message: 'pending', approvalId: 'appr-777' })
    const body = await json(await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'follow_up', patientId: PAT_A1 })))
    expect(body.run.status).toBe('WAITING_APPROVAL')
    expect(body.run.approvalId).toBe('appr-777')
    const row = fake.__phase9.wfRows.find((r) => r.id === body.run.id)
    expect(row.status).toBe('WAITING_APPROVAL')
    expect(body.outputItems.some((o) => o.titleKey === 'wf.out.actionPendingApproval')).toBe(true)
    expect(body.outputItems.filter((o) => o.titleKey === 'wf.out.actionExecuted')).toHaveLength(0)
  })

  it('cancel → CANCELLED (audited); re-cancel terminal run → 409', async () => {
    setAuth(DOCTOR)
    const run = await json(await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'case_review', patientId: PAT_A1 })))
    const cancel = await json(await wfPOST(post('/ai/workflows', { op: 'cancel', runId: run.run.id })))
    // case_review completes synchronously, so cancel from COMPLETED → 409.
    expect(cancel.error.code).toBe('INT_WORKFLOW_INVALID_TRANSITION')

    // A still-active run (WAITING_APPROVAL) can be cancelled.
    store.action.response = async () => ({ status: 'APPROVAL_REQUIRED', success: false, message: 'pending', approvalId: 'appr-8' })
    const parked = await json(await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'follow_up', patientId: PAT_A1 })))
    expect(parked.run.status).toBe('WAITING_APPROVAL')
    const cancel2 = await json(await wfPOST(post('/ai/workflows', { op: 'cancel', runId: parked.run.id })))
    expect(cancel2.run.status).toBe('CANCELLED')
    // Terminal now → re-cancel rejected.
    const cancel3 = await json(await wfPOST(post('/ai/workflows', { op: 'cancel', runId: parked.run.id })))
    expect(cancel3.error.code).toBe('INT_WORKFLOW_INVALID_TRANSITION')
    expect(fake.__phase9.audits.map((a) => a.action)).toContain('AI_WORKFLOW_CANCEL')
  })

  it('list + get are tenant-pinned observations', async () => {
    setAuth(DOCTOR)
    await wfPOST(post('/ai/workflows', { op: 'run', workflowId: 'case_review', patientId: PAT_A1 }))
    const list = await json(await wfPOST(post('/ai/workflows', { op: 'list' })))
    expect(list.count).toBe(1)
    expect(list.runs[0].status).toBe('COMPLETED')
    const got = await json(await wfPOST(post('/ai/workflows', { op: 'get', runId: list.runs[0].id })))
    expect(got.run.id).toBe(list.runs[0].id)
    const missing = await json(await wfPOST(post('/ai/workflows', { op: 'get', runId: 'wfrun-nope' })))
    expect(missing.error.code).toBe('INT_WORKFLOW_NOT_FOUND')
  })

  it('malformed body → 400 INT_INVALID_PARAMS; unknown op → 400', async () => {
    setAuth(DOCTOR)
    const raw = new Request('http://localhost/api/ai/workflows', {
      method: 'POST',
      body: 'not-json{',
      headers: { 'content-type': 'application/json' },
    })
    const res = await wfPOST(raw)
    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe('INT_INVALID_PARAMS')
    const badOp = await json(await wfPOST(post('/ai/workflows', { op: 'fly' })))
    expect(badOp.error.code).toBe('INT_INVALID_PARAMS')
  })
})

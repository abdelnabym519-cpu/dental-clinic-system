// @ts-nocheck
/**
 * Phase 3 — Tool registry (§8/§9/§10/§15): closed registry, role pre-filter,
 * input validation, tenant scope, result validation, timeouts. Action tools
 * must route through the injected Phase 1 pipeline (never direct writes).
 */
import { describe, it, expect } from 'vitest'
import { executeTool, TOOL_REGISTRY, listToolNames, toolNamesByProfile } from '@/lib/ai/agent/tools'
import { createAgentFakePrisma, HOSP_A, HOSP_B, PAT_A1, NOW } from '@/tests/harness/agent-fixtures'

function rt(over = {}) {
  return {
    client: createAgentFakePrisma(),
    hospitalId: HOSP_A,
    patientId: PAT_A1,
    patientName: 'Ahmed Ali',
    role: 'DOCTOR',
    toothFdi: null,
    caseId: null,
    studyId: null,
    treatmentNo: null,
    now: NOW,
    runAction: async () => ({ status: 'EXECUTED', success: true, message: 'ok', verification: { verified: true, detail: 'verified' } }),
    ...over,
  }
}

describe('closed registry (§9)', () => {
  it('rejects unknown tools', async () => {
    const res = await executeTool('nonexistent_tool', {}, rt())
    expect(res.ok).toBe(false)
    expect(res.error).toContain('TOOL_NOT_FOUND')
  })

  it('exposes the full tool list', () => {
    expect(listToolNames().length).toBeGreaterThanOrEqual(16)
    expect(listToolNames()).toContain('get_clinical_summary')
    expect(listToolNames()).toContain('record_payment')
  })
})

describe('role pre-filter (§10)', () => {
  it('PATIENT cannot use clinic operational tools', async () => {
    const res = await executeTool('get_waiting_queue', {}, rt({ role: 'PATIENT', patientId: null }))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('UNAUTHORIZED')
  })

  it('staff can use clinic tools', async () => {
    const res = await executeTool('get_waiting_queue', {}, rt({ role: 'RECEPTIONIST', patientId: null }))
    expect(res.ok).toBe(true)
  })
})

describe('patient requirement', () => {
  it('context tools without a resolved patient → MISSING_CONTEXT', async () => {
    const res = await executeTool('get_clinical_summary', {}, rt({ patientId: null }))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('MISSING_CONTEXT')
  })
})

describe('input validation (§9)', () => {
  it('schedule_followup requires a valid date', async () => {
    const res = await executeTool('schedule_followup', {}, rt())
    expect(res.ok).toBe(false)
    expect(res.error).toContain('TOOL_VALIDATION_ERROR')
  })

  it('record_payment requires a numeric amount', async () => {
    const res = await executeTool('record_payment', { amount: 'abc' }, rt())
    expect(res.ok).toBe(false)
    expect(res.error).toContain('TOOL_VALIDATION_ERROR')
  })

  it('get_appointments rejects malformed dates', async () => {
    const res = await executeTool('get_appointments', { date: 'not-a-date' }, rt({ patientId: null }))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('TOOL_VALIDATION_ERROR')
  })
})

describe('context tools (Phase 2 engine wrapper)', () => {
  it('returns fenced, provenance-stamped context', async () => {
    const res = await executeTool('get_patient_overview', {}, rt())
    expect(res.ok).toBe(true)
    expect(res.data.kind).toBe('context')
    expect(res.data.context.meta.patient.id).toBe(PAT_A1)
    expect(res.data.serialized).toContain('<<<DEN_TORA_UNTRUSTED_DATA')
    expect(res.meta.tenantId).toBe(HOSP_A)
    expect(res.meta.patientId).toBe(PAT_A1)
    expect(res.meta.sources.length).toBeGreaterThan(0)
    expect(res.meta.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('tooth context honors the FDI scope', async () => {
    const res = await executeTool('get_tooth_context', {}, rt({ toothFdi: 36 }))
    expect(res.ok).toBe(true)
    expect(res.data.context.meta.scope.toothFdi).toBe(36)
  })
})

describe('clinic tools (tenant-scoped reads)', () => {
  it('waiting queue: tenant-A rows only, ordered by arrival', async () => {
    const res = await executeTool('get_waiting_queue', {}, rt({ patientId: null, role: 'RECEPTIONIST' }))
    expect(res.ok).toBe(true)
    const q = res.data.queue
    // q2 (10:00) arrived before q1 (11:00)
    expect(q.map((x) => x.appointmentNo)).toEqual(['APPT-A-3002', 'APPT-A-3001'])
    expect(q.every((x) => x.patientName && !x.appointmentNo.includes('B'))).toBe(true)
  })

  it('appointments by date: same-day window, no cross-tenant leak', async () => {
    const today = NOW.toISOString().split('T')[0]
    const res = await executeTool('get_appointments', { date: today }, rt({ patientId: null, role: 'RECEPTIONIST' }))
    const nos = res.data.appointments.map((x) => x.appointmentNo)
    expect(nos).toContain('APPT-A-3003')
    expect(nos).not.toContain('APPT-B-3001') // other tenant, same day
    // base fixture rows are not today
    expect(nos).not.toContain('APPT-A-1001')
  })

  it('doctor schedule by doctorId', async () => {
    const today = NOW.toISOString().split('T')[0]
    const res = await executeTool('get_doctor_schedule', { date: today, doctorId: 'staff-doctor-1' }, rt({ patientId: null }))
    expect(res.data.appointments.every((a) => a.doctorName === 'Hana Shalaby')).toBe(true)
    expect(res.data.appointments.length).toBeGreaterThan(0)
  })

  it('no-date schedule/appointments default to today — never an unbounded all-time list (adversarial finding AD-1)', async () => {
    const res = await executeTool('get_doctor_schedule', {}, rt({ patientId: null, doctorId: undefined }))
    // only today's rows (base fixture rows are d±10/30/200 — none today)
    expect(res.data.appointments.length).toBeLessThanOrEqual(3)
    const appts = await executeTool('get_appointments', {}, rt({ patientId: null, role: 'RECEPTIONIST' }))
    const nos = appts.data.appointments.map((x: any) => x.appointmentNo)
    expect(nos).not.toContain('APPT-A-1001') // d(+30)
    expect(nos).not.toContain('APPT-A-1002') // d(-10)
  })

  it('follow-ups due: bounded window, patient names, no cross-tenant leak', async () => {
    const res = await executeTool('get_followup_due', {}, rt({ patientId: null, role: 'RECEPTIONIST' }))
    expect(res.ok).toBe(true)
    const f = res.data.followups
    expect(f.length).toBe(3) // trt-A1 (d+30 boundary), trt-due-1 (d+5), trt-due-2 (d-2 overdue)
    expect(f.every((x) => x.treatmentNo.startsWith('TRT-A-'))).toBe(true)
    const names = f.map((x) => x.patientName)
    expect(names).toContain('Ahmed Ali')
    expect(names).toContain('Sara Hassan')
  })

  it('tenant B sees only tenant B follow-ups', async () => {
    const res = await executeTool('get_followup_due', {}, rt({ hospitalId: HOSP_B, patientId: null, role: 'RECEPTIONIST' }))
    expect(res.data.followups.map((x) => x.treatmentNo)).toEqual(['TRT-B-801'])
  })
})

describe('action tools (Phase 1 pipeline only)', () => {
  it('routes through runAction with resolved patient + intent', async () => {
    const calls = []
    const r = rt({
      runAction: async (intent, params) => {
        calls.push({ intent, params })
        return { status: 'APPROVAL_REQUIRED', success: false, message: 'approval needed', approvalId: 'appr-1' }
      },
    })
    const res = await executeTool('record_payment', { amount: '500' }, r)
    expect(res.ok).toBe(true)
    expect(res.data.status).toBe('APPROVAL_REQUIRED')
    expect(calls).toEqual([{
      intent: 'record_payment',
      params: { amount: '500', patientId: PAT_A1, patientName: 'Ahmed Ali' },
    }])
  })

  it('maps schedule_followup → book_appointment intent', async () => {
    const calls = []
    const r = rt({ runAction: async (intent) => { calls.push(intent); return { status: 'EXECUTED', success: true, message: 'ok', verification: { verified: true, detail: 'v' } } } })
    await executeTool('schedule_followup', { date: '2026-10-05', type: 'FOLLOW_UP' }, r)
    expect(calls).toEqual(['book_appointment'])
  })

  it('rejects unexpected pipeline results (validation)', async () => {
    const r = rt({ runAction: async () => ({ status: 'WEIRD', success: false, message: 'x' }) })
    const res = await executeTool('record_payment', { amount: '5' }, r)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('TOOL_VALIDATION_ERROR')
  })
})

describe('timeouts (§14)', () => {
  it('TOOL_TIMEOUT on a hanging backend (per-tool timeout enforced)', async () => {
    const r = rt({})
    // Never-resolving backend → the registry's per-tool timeout must fire.
    r.client.appointment.findMany = () => new Promise(() => {})
    const res = await executeTool('get_waiting_queue', {}, r, 50)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('TOOL_TIMEOUT')
  })
})

describe('profile → tool mapping', () => {
  it('maps every profile to a registry tool', () => {
    for (const p of ['MINIMAL', 'PATIENT_OVERVIEW', 'CLINICAL', 'TOOTH', 'CASE', 'IMAGING', 'TREATMENT', 'FOLLOW_UP', 'TIMELINE', 'FULL_360']) {
      expect(TOOL_REGISTRY[toolNamesByProfile(p)]).toBeDefined()
    }
  })
})

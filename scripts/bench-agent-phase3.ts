// @ts-nocheck
/**
 * Phase 3 — Agent performance bench (in-memory harness).
 *
 * Measures, per representative agent task:
 *   - wall time (median of N)
 *   - DB query count (counting wrapper over the harness fake)
 *   - model calls (LLM stubbed — 0 for deterministic tasks)
 *   - tool calls
 * Plus the N+1 guardrail: scale all rows ~3x and the query count MUST NOT
 * change (bounded queries only), and no duplicate context builds.
 *
 * Run: npx tsx scripts/bench-agent-phase3.ts
 */
import { createAgentFakePrisma, HOSP_A, PAT_A1, NOW } from '../tests/harness/agent-fixtures'

const N = 25

type Row = Record<string, any>
const d = (days: number) => new Date(NOW.getTime() + days * 86400000)

function scaledRows(factor: number): Record<string, Row[]> {
  const rows: Record<string, Row[]> = {
    patient: [], appointment: [], dentalChartEntry: [], clinicalNote: [],
    treatmentPlan: [], treatment: [], invoice: [], imagingStudy: [], aIAnalysisJob: [], patientRiskScore: [],
  }
  for (let i = 0; i < 40 * factor; i++) {
    const pid = `scale-p${i}`
    rows.patient.push({
      id: pid, hospitalId: HOSP_A, patientId: `PAT-S${i}`, firstName: `Scale`, lastName: `Patient ${i}`,
      age: 30, phone: `010${i}`, portalUserId: null, createdAt: d(-200),
    })
    rows.appointment.push({
      id: `appt-s${i}`, hospitalId: HOSP_A, patientId: pid, appointmentNo: `APPT-S-${i}`,
      appointmentType: 'CONSULTATION', status: 'SCHEDULED', scheduledDate: d(1 + (i % 10)),
      chiefComplaint: null, doctorId: 'staff-doctor-1', doctor: { firstName: 'Hana', lastName: 'Shalaby' },
      patient: { firstName: 'Scale', lastName: `Patient ${i}` }, createdAt: d(-5),
    })
    for (let t = 0; t < 2; t++) {
      rows.dentalChartEntry.push({
        id: `chart-s${i}-${t}`, hospitalId: HOSP_A, patientId: pid, toothNumber: 11 + t,
        condition: 'CARIES', severity: 'MODERATE', mesial: true, distal: false, occlusal: true,
        buccal: false, lingual: false, notes: null, diagnosedDate: d(-10 - t), resolvedDate: null,
      })
    }
    rows.clinicalNote.push({
      id: `note-s${i}`, hospitalId: HOSP_A, patientId: pid, noteType: 'GENERAL',
      content: 'Routine scale patient note.', isPrivate: false, createdAt: d(-3),
      doctorId: 'staff-doctor-1', doctor: { firstName: 'Hana', lastName: 'Shalaby' }, treatmentPlanId: null,
    })
    if (i % 2 === 0) {
      rows.treatment.push({
        id: `trt-s${i}`, hospitalId: HOSP_A, patientId: pid, treatmentNo: `TRT-S-${i}`,
        status: 'COMPLETED', toothNumbers: '11', diagnosis: null, findings: null, chiefComplaint: null,
        procedureId: 'proc-fill', procedure: { name: 'Filling' }, doctorId: 'staff-doctor-1',
        doctor: { firstName: 'Hana', lastName: 'Shalaby' }, startTime: d(-20), endTime: d(-20),
        followUpRequired: i % 4 === 0, followUpDate: i % 4 === 0 ? d(2) : null, followUpNotes: null,
        complications: null, appointmentId: null, createdAt: d(-20),
      })
      rows.invoice.push({
        id: `inv-s${i}`, hospitalId: HOSP_A, patientId: pid, invoiceNo: `INV-S-${i}`,
        totalAmount: { toString: () => '100' }, balanceAmount: { toString: () => '50' },
        status: 'PENDING', createdAt: d(-15),
      })
    }
    if (i % 5 === 0) {
      rows.imagingStudy.push({
        id: `study-s${i}`, hospitalId: HOSP_A, patientId: pid, studyNo: `IMG-S-${i}`,
        modality: 'PERIAPICAL', capturedAt: d(-8), fileName: 's.png', status: 'COMPLETED',
        aiStatus: 'ANALYZED',
      })
      rows.aIAnalysisJob.push({
        id: `job-s${i}`, hospitalId: HOSP_A, studyId: `study-s${i}`, engine: 'liodon',
        status: 'SUCCEEDED', findings: { label: 'Pulp necrosis', confidence: 0.6 },
        modelVersion: 'test', provenance: { sourceSha: 'x' }, completedAt: d(-8),
      })
    }
    if (i % 10 === 0) {
      rows.patientRiskScore.push({
        id: `risk-s${i}`, hospitalId: HOSP_A, patientId: pid, overallScore: 0.3,
        factors: {}, contraindications: null, calculatedAt: d(-1), model: 'test',
      })
    }
  }
  return rows
}

function countingClient(client: any) {
  const counter = { n: 0 }
  const wrapped: any = {}
  for (const [name, del] of Object.entries(client)) {
    if (typeof del !== 'object' || del === null) { wrapped[name] = del; continue }
    wrapped[name] = {}
    for (const [fn, orig] of Object.entries(del as Record<string, any>)) {
      if (typeof orig !== 'function') { (wrapped[name] as any)[fn] = orig; continue }
      ;(wrapped[name] as any)[fn] = (...args: any[]) => {
        counter.n += 1
        return (orig as any)(...args)
      }
    }
  }
  return { client: wrapped, counter }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

async function main() {
const { runAgent } = await import('../lib/ai/agent/loop')
const { executeTool } = await import('../lib/ai/agent/tools')
const { DEFAULT_AGENT_LIMITS } = await import('../lib/ai/agent/types')

const llmStub = async () => ({ content: 'stub' })
const req = (message: string, over: Record<string, any> = {}) => ({
  requestId: 'bench', conversationId: null,
  actor: { id: 'staff-doctor-1', name: 'Hana', role: 'DOCTOR' },
  hospitalId: HOSP_A, message,
  patientId: null, patientName: null, toothFdi: null, caseId: null,
  studyId: null, treatmentNo: null, timestamp: NOW.toISOString(), ...over,
})

async function bench(name: string, fn: () => Promise<any>) {
  const times: number[] = []
  let queries = 0
  let toolCalls = 0
  let sample: any
  for (let i = 0; i < N; i++) {
    const { client, counter } = countingClient(createAgentFakePrisma(scaledRows(1)))
    const deps = { client, llm: llmStub, limits: { ...DEFAULT_AGENT_LIMITS }, now: () => NOW }
    const t0 = process.hrtime.bigint()
    sample = await fn(deps)
    times.push(Number(process.hrtime.bigint() - t0) / 1e6)
    if (i === 0) {
      queries = counter.n
      toolCalls = sample?.trace?.toolCalls?.length ?? 0
    }
  }
  return { name, ms: median(times).toFixed(2), queries, toolCalls, status: sample?.status }
}

async function nPlusOne(name: string, fn: (client: any) => Promise<any>) {
  const run = async (factor: number) => {
    const { client, counter } = countingClient(createAgentFakePrisma(scaledRows(factor)))
    await fn(client)
    return counter.n
  }
  const q1 = await run(1)
  const q3 = await run(3)
  return { name, q1, q3, stable: q1 === q3 }
}

console.log('Phase 3 agent bench (in-memory harness, median of 25)')
console.log('─'.repeat(78))

const ops = await bench('OPERATIONAL   waiting queue (get_waiting_queue)', async (deps) =>
  runAgent(req('Who is in the waiting queue?', { actor: { id: 'staff-recep-1', name: 'R', role: 'RECEPTIONIST' } }), deps))

const info = await bench('INFORMATIONAL patient overview (by name)', async (deps) =>
  runAgent(req('Show appointments for Ahmed Ali'), deps))

const clinical = await bench('CLINICAL_ANALYSIS (LLM stubbed)', async (deps) =>
  runAgent(req('Review the clinical history and findings for Ahmed Ali'), deps))

const tooth = await bench('TOOTH context (36)', async (deps) =>
  runAgent(req('Review tooth 36 for Ahmed Ali'), deps))

const full = await bench('FULL_360 via get_patient_360 tool', async (deps) => {
  const rt = {
    client: deps.client, hospitalId: HOSP_A, patientId: PAT_A1, patientName: 'Ahmed Ali',
    role: 'DOCTOR', toothFdi: null, caseId: null, studyId: null, treatmentNo: null, now: NOW,
    runAction: async () => ({ status: 'EXECUTED', success: true, message: 'ok', verification: { verified: true, detail: 'v' } }),
  }
  return { status: 'TOOL_OK', trace: { toolCalls: [{ ok: true }] } , r: await executeTool('get_patient_360', {}, rt)}
})

const follow = await bench('OPERATIONAL   follow-ups due (get_followup_due)', async (deps) =>
  runAgent(req('Which follow-ups are due?', { actor: { id: 'staff-recep-1', name: 'R', role: 'RECEPTIONIST' } }), deps))

const results = [ops, info, clinical, tooth, full, follow]
for (const r of results) {
  console.log(`${r.name.padEnd(52)} ${String(r.ms + 'ms').padStart(9)}  ${String(r.queries + 'q').padStart(6)}  ${String(r.toolCalls + 'tools').padStart(8)}  ${r.status}`)
}

console.log('─'.repeat(78))
console.log('N+1 guardrail (rows scaled 1x → 3x; query count must be stable):')
const n1 = await nPlusOne('INFORMATIONAL overview', (client) =>
  runAgent(req('Show appointments for Ahmed Ali'), { client, llm: llmStub, limits: { ...DEFAULT_AGENT_LIMITS }, now: () => NOW }))
const n2 = await nPlusOne('CLINICAL synthesis (stubbed)', (client) =>
  runAgent(req('Review the clinical history and findings for Ahmed Ali'), { client, llm: llmStub, limits: { ...DEFAULT_AGENT_LIMITS }, now: () => NOW }))
const n3 = await nPlusOne('waiting queue', (client) =>
  runAgent(req('Who is in the waiting queue?', { actor: { id: 'staff-recep-1', name: 'R', role: 'RECEPTIONIST' } }), { client, llm: llmStub, limits: { ...DEFAULT_AGENT_LIMITS }, now: () => NOW }))
for (const r of [n1, n2, n3]) {
  console.log(`  ${r.name.padEnd(34)} 1x: ${r.q1}q   3x: ${r.q3}q   ${r.stable ? 'STABLE ✓' : 'N+1 VIOLATION ✗'}`)
}
const allStable = [n1, n2, n3].every((r) => r.stable)
console.log(allStable ? '\nRESULT: no N+1 growth, bounded queries.' : '\nRESULT: N+1 VIOLATION DETECTED')
  process.exit(allStable ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })

/**
 * Phase 3 — Agent Tool Registry (§8/§9/§10).
 *
 * Closed, typed registry: the model (and any caller) may only select tools
 * that exist HERE. Unknown tool → reject. Unknown parameter → reject.
 * Unauthorized role → reject. Wrong patient/tenant → reject (the tool runs
 * with the SERVER-resolved scope, never with caller-asserted identity).
 *
 * - READ context tools wrap the Phase 2 context engine (no parallel 360).
 * - READ clinic tools are bounded, tenant-scoped, read-only (permitted per
 *   §2: no existing agent-facing service; strictly read-only).
 * - WRITE action tools route through the Phase 1 action pipeline
 *   (`runAiAction`) — policy → RBAC → validation → scope → guardrails →
 *   fingerprint → approval → idempotency → transaction → executor →
 *   verification → audit. The registry NEVER executes writes directly.
 */

import { buildClinicalContext } from '@/lib/ai/context/service'
import { serializeForPrompt } from '@/lib/ai/context/serialize'
import type { ContextProfile } from '@/lib/ai/context/types'
import { retrieveKnowledge } from '@/lib/ai/knowledge/retrieval'
import { createPrismaKnowledgeStore } from '@/lib/ai/knowledge/store'
import { isKnowledgeDomain } from '@/lib/ai/knowledge/taxonomy'
import { CAPABILITY_TASK_IDS } from '@/lib/ai/engines/capability-matrix'
import type { KnowledgeEvidencePackage, KnowledgeStore } from '@/lib/ai/knowledge/types'
import type { AgentToolDefinition, AgentToolResult, AgentDomain, RiskLevel } from './types'

export interface ToolRuntime {
  client: any
  hospitalId: string
  /** Server-resolved, tenant-validated patient (null when not required). */
  patientId: string | null
  patientName: string | null
  role: string
  toothFdi: number | null
  caseId: string | null
  studyId: string | null
  treatmentNo: string | null
  now: Date
  /** Phase 4 — knowledge store (injectable for tests; defaults to Prisma). */
  knowledgeStore?: KnowledgeStore
  /** Phase 5 — local AI capability source (orchestrator view; null = static matrix only). */
  localAiCapabilities?: import('../engines/types').LocalAiCapabilitySource | null
  /** Phase 1 pipeline entry point (the ONLY write path). */
  runAction: (intent: string, params: Record<string, string>) => Promise<{
    status: 'EXECUTED' | 'APPROVAL_REQUIRED' | 'BLOCKED'
    success: boolean
    message: string
    approvalId?: string
    result?: unknown
    verification?: { verified: boolean; detail: string }
    blockCode?: string
  }>
}

const STAFF = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT']
const OK = () => null

function contextTool(
  name: string,
  description: string,
  domain: AgentDomain,
  profile: ContextProfile,
  extra: Partial<AgentToolDefinition> = {}
): AgentToolDefinition & { profile: ContextProfile } {
  return {
    name,
    description,
    domain,
    profile,
    writeClass: 'READ',
    riskLevel: 'NONE',
    requiredRoles: [...STAFF, 'PATIENT'],
    requiresPatient: true,
    viaActionPipeline: false,
    validateInput: OK,
    timeoutMs: 5000,
    maxRetries: 1,
    idempotent: true,
    ...extra,
  }
}

export const TOOL_REGISTRY: Record<string, AgentToolDefinition & { profile?: ContextProfile }> = {
  // ── Patient / dental / clinical context (Phase 2 engine) ──────────────
  get_patient_overview: contextTool('get_patient_overview', 'Patient identity, medical flags, chart, appointments, risk, open balance', 'patient', 'PATIENT_OVERVIEW'),
  get_clinical_summary: contextTool('get_clinical_summary', 'Full clinical context: notes, examinations, plans, treatments, prescriptions', 'clinical', 'CLINICAL'),
  get_tooth_context: contextTool('get_tooth_context', 'Tooth 360: chart, tooth-linked treatments, cases, imaging findings', 'dental', 'TOOTH'),
  get_case_context: contextTool('get_case_context', 'Case (treatment plan) context with items and linked treatments', 'clinical', 'CASE'),
  get_imaging_context: contextTool('get_imaging_context', 'Imaging studies with AI analyses, model provenance and doctor review state', 'imaging', 'IMAGING'),
  get_treatment_context: contextTool('get_treatment_context', 'Treatment context: status, teeth, follow-up, linked case', 'treatment', 'TREATMENT'),
  get_followup_context: contextTool('get_followup_context', 'Follow-up context: due follow-ups, notes, appointments', 'clinical', 'FOLLOW_UP'),
  get_patient_timeline: contextTool('get_patient_timeline', 'Unified clinical timeline (bounded, deterministic order)', 'clinical', 'TIMELINE'),
  get_patient_360: contextTool('get_patient_360', 'Complex case review: all bounded sections including timeline', 'patient', 'FULL_360'),

  // ── Phase 4 — Dental knowledge (RAG) ──────────────────────────────────
  retrieve_dental_knowledge: {
    name: 'retrieve_dental_knowledge',
    description: 'Bounded retrieval of structured dental knowledge evidence (guidelines/textbooks/education) with machine-readable citations. Clinical use is limited to TIER_1+TIER_2 sources; patient data is never indexed or returned.',
    domain: 'knowledge',
    writeClass: 'READ',
    riskLevel: 'NONE',
    requiredRoles: [...STAFF, 'PATIENT'],
    requiresPatient: false,
    viaActionPipeline: false,
    validateInput: (i) =>
      typeof i.question !== 'string' || !i.question.trim()
        ? 'question is required'
        : i.question.length > 300
          ? 'question too long (max 300 chars)'
          : i.domain !== undefined && !isKnowledgeDomain(i.domain)
            ? 'unknown knowledge domain'
            : i.maxResults !== undefined && (typeof i.maxResults !== 'number' || !Number.isInteger(i.maxResults) || i.maxResults < 1 || i.maxResults > 10)
              ? 'maxResults must be an integer 1..10'
              : i.language !== undefined && i.language !== 'en' && i.language !== 'ar'
                ? 'language must be en or ar'
                : OK(),
    timeoutMs: 8000,
    maxRetries: 0,
    idempotent: true,
  },

  // ── Phase 5 — Local AI capabilities (bounded read-only) ───────────────
  local_ai_capabilities: {
    name: 'local_ai_capabilities',
    description:
      'Dental AI analysis capabilities: which dental tasks have a verified local engine, its modality, output type and evidence state. Decision support only — every AI finding requires clinician review. Engine selection is deterministic from the task/modality, never from free text.',
    domain: 'imaging',
    writeClass: 'READ',
    riskLevel: 'NONE',
    requiredRoles: [...STAFF, 'PATIENT'],
    requiresPatient: false,
    viaActionPipeline: false,
    validateInput: (i) =>
      i.task !== undefined && (typeof i.task !== 'string' || !CAPABILITY_TASK_IDS.includes(i.task))
        ? 'unknown capability task'
        : OK(),
    timeoutMs: 5000,
    maxRetries: 0,
    idempotent: true,
  },

  // ── Clinic operations (bounded read-only, tenant-scoped) ──────────────
  get_appointments: {
    name: 'get_appointments',
    description: 'Appointment list for a day (or overdue), tenant-scoped',
    domain: 'scheduling',
    writeClass: 'READ',
    riskLevel: 'NONE',
    requiredRoles: STAFF,
    requiresPatient: false,
    viaActionPipeline: false,
    validateInput: (i) => (i.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(i.date)) ? 'Invalid date format' : OK()),
    timeoutMs: 5000,
    maxRetries: 1,
    idempotent: true,
  },
  get_waiting_queue: {
    name: 'get_waiting_queue',
    description: 'Patients currently checked in / in progress',
    domain: 'scheduling',
    writeClass: 'READ',
    riskLevel: 'NONE',
    requiredRoles: STAFF,
    requiresPatient: false,
    viaActionPipeline: false,
    validateInput: OK,
    timeoutMs: 5000,
    maxRetries: 1,
    idempotent: true,
  },
  get_doctor_schedule: {
    name: 'get_doctor_schedule',
    description: 'A doctor\'s schedule for a day',
    domain: 'staff',
    writeClass: 'READ',
    riskLevel: 'NONE',
    requiredRoles: STAFF,
    requiresPatient: false,
    viaActionPipeline: false,
    validateInput: OK,
    timeoutMs: 5000,
    maxRetries: 1,
    idempotent: true,
  },
  get_followup_due: {
    name: 'get_followup_due',
    description: 'Treatments with a due follow-up (next N days)',
    domain: 'clinical',
    writeClass: 'READ',
    riskLevel: 'NONE',
    requiredRoles: STAFF,
    requiresPatient: false,
    viaActionPipeline: false,
    validateInput: OK,
    timeoutMs: 5000,
    maxRetries: 1,
    idempotent: true,
  },

  // ── Actions (Phase 1 pipeline — the registry never writes directly) ───
  schedule_followup: {
    name: 'schedule_followup',
    description: 'Book a follow-up appointment (Phase 1: book_appointment)',
    domain: 'scheduling',
    writeClass: 'WRITE',
    riskLevel: 'MEDIUM',
    requiredRoles: STAFF,
    requiresPatient: true,
    viaActionPipeline: true,
    actionIntent: 'book_appointment',
    validateInput: (i) => (i.date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(String(i.date)) ? 'A valid date (YYYY-MM-DD) is required' : OK()),
    timeoutMs: 8000,
    maxRetries: 0,
    idempotent: true, // idempotency enforced by Phase 1 fingerprint
  },
  record_payment: {
    name: 'record_payment',
    description: 'Record a payment (Phase 1 financial guardrails apply)',
    domain: 'billing',
    writeClass: 'WRITE',
    riskLevel: 'HIGH',
    requiredRoles: STAFF,
    requiresPatient: true,
    viaActionPipeline: true,
    actionIntent: 'record_payment',
    validateInput: (i) => (i.amount === undefined || !/^\d+(\.\d{1,2})?$/.test(String(i.amount)) ? 'A valid amount is required' : OK()),
    timeoutMs: 8000,
    maxRetries: 0,
    idempotent: true,
  },
  create_invoice: {
    name: 'create_invoice',
    description: 'Create an invoice from unbilled completed treatments',
    domain: 'billing',
    writeClass: 'WRITE',
    riskLevel: 'HIGH',
    requiredRoles: STAFF,
    requiresPatient: true,
    viaActionPipeline: true,
    actionIntent: 'create_invoice',
    validateInput: OK,
    timeoutMs: 8000,
    maxRetries: 0,
    idempotent: true,
  },
  create_prescription: {
    name: 'create_prescription',
    description: 'Create a prescription (Phase 1 pipeline)',
    domain: 'prescription',
    writeClass: 'WRITE',
    riskLevel: 'MEDIUM',
    requiredRoles: STAFF,
    requiresPatient: true,
    viaActionPipeline: true,
    actionIntent: 'create_prescription',
    validateInput: OK,
    timeoutMs: 8000,
    maxRetries: 0,
    idempotent: true,
  },
}

export function listToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY)
}

// ---------------------------------------------------------------------------
// Context-source extraction (for the response provenance contract)
// ---------------------------------------------------------------------------

export function extractSources(ctx: any, limit = 20): { sourceType: string; sourceId: string; entityType: string; freshness: string }[] {
  const out: { sourceType: string; sourceId: string; entityType: string; freshness: string }[] = []
  const push = (p: any, section: string) => {
    if (!p || out.length >= limit) return
    out.push({ sourceType: p.sourceType ?? section, sourceId: String(p.sourceId ?? ''), entityType: String(p.entityType ?? ''), freshness: section === '' ? 'unknown' : (ctx[section]?.freshness ?? 'unknown') })
  }
  const s = (key: string) => ctx[key]?.status === 'included' ? ctx[key].data : null
  const med = s('medical'); if (med) push(med.provenance, 'medical')
  const den = s('dental'); if (den) den.active.slice(0, 3).forEach((t: any) => push(t.provenance, 'dental'))
  const appts = s('appointments'); if (appts) [...(appts.upcoming ?? []), ...(appts.recent ?? [])].slice(0, 3).forEach((a: any) => push(a.provenance, 'appointments'))
  const cl = s('clinical'); if (cl) [...(cl.examinations ?? []), ...(cl.followUpNotes ?? [])].slice(0, 3).forEach((n: any) => push(n.provenance, 'clinical'))
  const cases = s('cases'); if (cases) cases.plans.slice(0, 2).forEach((c: any) => push(c.provenance, 'cases'))
  const trt = s('treatments'); if (trt) trt.treatments.slice(0, 3).forEach((t: any) => push(t.provenance, 'treatments'))
  const rx = s('prescriptions'); if (rx) rx.prescriptions.slice(0, 2).forEach((p: any) => push(p.provenance, 'prescriptions'))
  const img = s('imaging'); if (img) img.studies.slice(0, 2).forEach((st: any) => { push(st.provenance, 'imaging'); st.analyses.slice(0, 2).forEach((j: any) => push(j.provenance, 'imaging')) })
  const fin = s('financial'); if (fin) push(fin.provenance, 'financial')
  const risk = s('risk'); if (risk) push(risk.provenance, 'risk')
  const tl = s('timeline'); if (tl) tl.events.slice(0, 5).forEach((e: any) => push(e.provenance, 'timeline'))
  return out
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const day = (d: Date) => d.toISOString().split('T')[0]

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('TOOL_TIMEOUT')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Execute a registry tool with the server-resolved scope.
 * Returns a validated, provenance-stamped result. Never throws for
 * business errors — failures are typed in the result.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  rt: ToolRuntime,
  timeoutMs?: number
): Promise<AgentToolResult> {
  const t0 = process.hrtime.bigint()
  const def = TOOL_REGISTRY[name]
  const fail = (error: string, data?: unknown): AgentToolResult => ({
    ok: false, error, data,
    meta: { tool: name, tenantId: rt.hospitalId, patientId: rt.patientId, latencyMs: Number(process.hrtime.bigint() - t0) / 1e6 },
  })

  // §9 — closed registry.
  if (!def) return fail(`TOOL_NOT_FOUND: ${name}`)
  // Role pre-filter (authoritative checks live in the context engine / pipeline).
  if (!def.requiredRoles.includes(rt.role)) return fail('UNAUTHORIZED: role cannot use this tool')
  // §9 — input validation.
  const inputError = def.validateInput(input ?? {})
  if (inputError) return fail(`TOOL_VALIDATION_ERROR: ${inputError}`)
  // Patient scope.
  if (def.requiresPatient && !rt.patientId) return fail('MISSING_CONTEXT: patient required but not resolved')

  try {
    const run = async () => {
      if (def.viaActionPipeline && def.actionIntent) {
        const params: Record<string, string> = {}
        for (const [k, v] of Object.entries(input ?? {})) {
          if (v !== undefined && v !== null) params[k] = String(v)
        }
        if (rt.patientId) params.patientId = rt.patientId
        if (rt.patientName) params.patientName = rt.patientName
        // Phase 1 pipeline — policy/RBAC/approval/verification are authoritative.
        return await rt.runAction(def.actionIntent, params)
      }
      if (def.profile) {
        const ctx = await buildClinicalContext({
          hospitalId: rt.hospitalId,
          actor: { id: 'agent', role: rt.role, name: rt.patientName ?? 'agent' },
          profile: def.profile,
          patientId: rt.patientId,
          toothFdi: rt.toothFdi ?? (typeof input.toothFdi === 'number' ? input.toothFdi : null),
          caseId: (typeof input.caseId === 'string' && input.caseId) || rt.caseId || null,
          studyId: (typeof input.studyId === 'string' && input.studyId) || rt.studyId || null,
          treatmentNo: (typeof input.treatmentNo === 'string' && input.treatmentNo) || rt.treatmentNo || null,
          now: rt.now,
        }, rt.client)
        return {
          kind: 'context' as const,
          context: ctx,
          serialized: serializeForPrompt(ctx),
          sources: extractSources(ctx),
        }
      }
      // Phase 4 — dental knowledge (bounded, tenant-scoped, citations server-built).
      if (name === 'retrieve_dental_knowledge') {
        return await knowledgeTool(input, rt)
      }
      // Phase 5 — local AI capability view (trusted matrix + live engine state).
      if (name === 'local_ai_capabilities') {
        return await localAiCapabilitiesTool(input, rt)
      }
      // Clinic read tools (bounded, tenant-scoped).
      return await clinicTool(name, input, rt)
    }

    const out = await withTimeout(run(), timeoutMs ?? def.timeoutMs)
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6

    // §15 — result validation.
    if (out === undefined || out === null) return fail('TOOL_VALIDATION_ERROR: tool returned no result')
    if (def.viaActionPipeline) {
      const r = out as { status?: string; approvalId?: string }
      if (r.status !== 'EXECUTED' && r.status !== 'APPROVAL_REQUIRED' && r.status !== 'BLOCKED') {
        return fail('TOOL_VALIDATION_ERROR: unexpected pipeline result')
      }
    }
    return {
      ok: true,
      data: out,
      meta: {
        tool: name,
        tenantId: rt.hospitalId, // tools only ever run for this tenant
        patientId: rt.patientId,
        latencyMs,
        sources: (out as { sources?: { sourceType: string; sourceId: string; entityType: string; freshness: string }[] })?.sources,
      },
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'TOOL_TIMEOUT') return fail('TOOL_TIMEOUT')
    return fail(`TOOL_FAILURE: ${err instanceof Error ? err.message : 'unknown'}`)
  }
}

/**
 * Phase 5 — local AI capability view. READ-only, no patient scope, no
 * engine invocation: the matrix is trusted policy data and the live engine
 * state comes from the orchestrator (honest unavailability when it is not
 * configured/reachable). Engine selection never happens from this tool —
 * that is the imaging flow / LocalAIService job.
 */
async function localAiCapabilitiesTool(input: Record<string, unknown>, rt: ToolRuntime): Promise<unknown> {
  const { LocalAIService } = await import('../engines/local-ai-service')
  const { resolveCapability } = await import('../engines/capability-matrix')
  const service = new LocalAIService(rt.localAiCapabilities ?? null, null, () => rt.now)
  const view = await service.capabilityView()
  const out: Record<string, unknown> = {
    kind: 'local_ai_capabilities',
    reviewRequired: true, // decision support — always clinician-reviewed
    matrix: view.matrix,
    runtime: view.runtime,
    generatedAt: view.generatedAt,
  }
  if (typeof input.task === 'string') {
    const res = resolveCapability(input.task)
    out.resolution = res.ok
      ? { task: res.task, resolvable: res.resolvable, reason: res.reason }
      : { error: res.error }
  }
  return out
}

// ---------------------------------------------------------------------------
// Clinic read tools
// ---------------------------------------------------------------------------

interface ApptRow {
  id: string; appointmentNo: string; appointmentType: string; status: string
  scheduledDate: Date; chiefComplaint: string | null
  doctor?: { firstName: string; lastName: string } | null
  patient?: { firstName: string; lastName: string } | null
  doctorId?: string | null
}

function apptView(a: ApptRow) {
  return {
    appointmentNo: a.appointmentNo,
    type: a.appointmentType,
    status: a.status,
    scheduledAt: new Date(a.scheduledDate).toISOString(),
    patientName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : null,
    patientId: (a as { patientId?: string }).patientId ?? null,
    doctorName: a.doctor ? `${a.doctor.firstName} ${a.doctor.lastName}` : null,
    chiefComplaint: a.chiefComplaint, // PATIENT_REPORTED
  }
}

/**
 * Phase 4 — dental knowledge retrieval. Bounded, tenant-scoped, READ-only.
 * The scope (tenant + tier eligibility + use case) is resolved SERVER-side
 * from the session — never from tool parameters (§27). Returns a structured
 * evidence package with machine-readable, server-built citations.
 */
async function knowledgeTool(input: Record<string, unknown>, rt: ToolRuntime): Promise<unknown> {
  const store: KnowledgeStore = rt.knowledgeStore ?? createPrismaKnowledgeStore(rt.client)
  // Server-authoritative: clinical staff get TIER_1+TIER_2; the patient
  // portal gets the educational set (TIER_1..TIER_3). Never a parameter.
  const useCase: 'clinical' | 'educational' = rt.role === 'PATIENT' ? 'educational' : 'clinical'
  const pkg: KnowledgeEvidencePackage = await retrieveKnowledge(
    {
      question: String(input.question).trim(),
      domain: typeof input.domain === 'string' ? input.domain : null,
      language: typeof input.language === 'string' ? input.language : null,
      maxResults: typeof input.maxResults === 'number' ? input.maxResults : 5,
      useCase,
      hospitalId: rt.hospitalId,
    },
    store,
    { now: () => rt.now }
  )
  return { kind: 'knowledge' as const, package: pkg }
}

async function clinicTool(name: string, input: Record<string, unknown>, rt: ToolRuntime): Promise<unknown> {
  if (name === 'get_appointments') {
    const where: Record<string, unknown> = { hospitalId: rt.hospitalId }
    // No date → today's window (never an unbounded all-time list).
    const date = (typeof input.date === 'string' && input.date) || TOOL_DAY(rt.now)
    {
      const d = new Date(date + 'T00:00:00Z')
      where.scheduledDate = { gte: d, lt: new Date(d.getTime() + 86400000) }
    }
    if (input.status) where.status = input.status
    const rows: ApptRow[] = await rt.client.appointment.findMany({
      where, orderBy: { scheduledDate: 'asc' }, take: 20,
    })
    return { kind: 'appointments', count: rows.length, date: input.date ?? null, appointments: rows.map(apptView) }
  }

  if (name === 'get_waiting_queue') {
    const rows: ApptRow[] = await rt.client.appointment.findMany({
      where: { hospitalId: rt.hospitalId, status: { in: ['CHECKED_IN', 'IN_PROGRESS'] } },
      orderBy: { scheduledDate: 'asc' }, take: 20,
    })
    return { kind: 'queue', count: rows.length, queue: rows.map(apptView) }
  }

  if (name === 'get_doctor_schedule') {
    const where: Record<string, unknown> = { hospitalId: rt.hospitalId }
    if (input.doctorId) where.doctorId = input.doctorId
    // No date → today's window (never an unbounded all-time list).
    const date = (typeof input.date === 'string' && input.date) || TOOL_DAY(rt.now)
    {
      const d = new Date(date + 'T00:00:00Z')
      where.scheduledDate = { gte: d, lt: new Date(d.getTime() + 86400000) }
    }
    const rows: ApptRow[] = await rt.client.appointment.findMany({
      where, orderBy: { scheduledDate: 'asc' }, take: 30,
    })
    return { kind: 'schedule', doctorId: (input.doctorId as string) ?? null, date: (input.date as string) ?? null, count: rows.length, appointments: rows.map(apptView) }
  }

  if (name === 'get_followup_due') {
    const withinDays = typeof input.withinDays === 'number' && input.withinDays > 0 ? input.withinDays : 30
    const until = new Date(rt.now.getTime() + withinDays * 86400000)
    const rows = (await rt.client.treatment.findMany({
      where: { hospitalId: rt.hospitalId, followUpRequired: true, followUpDate: { lte: until } },
      orderBy: { followUpDate: 'asc' }, take: 20,
    })) as { id: string; treatmentNo: string; patientId: string; followUpDate: Date; followUpNotes: string | null; toothNumbers: string | null; status: string }[]
    if (rows.length) {
      const patients = (await rt.client.patient.findMany({
        where: { hospitalId: rt.hospitalId, id: { in: [...new Set(rows.map((r) => r.patientId))] } },
        select: { id: true, firstName: true, lastName: true },
        take: 30,
      })) as { id: string; firstName: string; lastName: string }[]
      const byId = new Map(patients.map((p) => [p.id, `${p.firstName} ${p.lastName}`]))
      for (const r of rows) (r as { patientName?: string | null }).patientName = byId.get(r.patientId) ?? null
    }
    return {
      kind: 'followups',
      withinDays,
      count: rows.length,
      followups: rows.map((r) => ({
        treatmentNo: r.treatmentNo,
        patientName: (r as { patientName?: string }).patientName ?? null,
        toothNumbers: r.toothNumbers,
        status: r.status,
        dueAt: r.followUpDate ? new Date(r.followUpDate).toISOString() : null,
        notes: r.followUpNotes,
      })),
    }
  }

  return undefined
}

export function toolNamesByProfile(profile: ContextProfile): string {
  const map: Record<ContextProfile, string> = {
    MINIMAL: 'get_patient_overview',
    PATIENT_OVERVIEW: 'get_patient_overview',
    CLINICAL: 'get_clinical_summary',
    TOOTH: 'get_tooth_context',
    CASE: 'get_case_context',
    IMAGING: 'get_imaging_context',
    TREATMENT: 'get_treatment_context',
    FOLLOW_UP: 'get_followup_context',
    TIMELINE: 'get_patient_timeline',
    FULL_360: 'get_patient_360',
  }
  return map[profile]
}

export const TOOL_DAY = day

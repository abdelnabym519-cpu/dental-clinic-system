/**
 * Phase 9 — ONE canonical Case/Patient Graph (relational; no graph DB).
 *
 * Built exclusively from EXISTING entities (§5/§37 — reuse, never duplicate):
 *   Patient · TreatmentPlan (a "Case" IS a TreatmentPlan) · TreatmentPlanItem
 *   · Treatment · DentalChartEntry (tooth + finding) · Appointment
 *   · ImagingStudy · AIAnalysisJob (AI findings + clinician review)
 *   · AiMemoryItem (memory refs, content stays in the Memory layer)
 *   · ClinicalNote · Prescription · Procedure · Staff
 *
 * No new "graph" tables: the graph is an in-process projection with explicit
 * edges, trust and provenance over tenant-pinned relational rows. Tenant
 * isolation is enforced at the query level (every query is hospitalId-pinned)
 * AND revalidated at the service boundary (patient/case must belong to the
 * tenant) — §9. Traversal is pure, bounded, and in-memory.
 *
 * Honesty: derived relationships carry `SYSTEM_INFERRED` trust + a
 * `derived:<rule>` provenance; records carry `RECORD_FACT`/`DOCTOR_CONFIRMED`
 * provenance pointing at the row; AI findings carry `AI_DERIVED` and are only
 * upgraded by an explicit `AI_FINDING_CONFIRMED_BY` edge when the record shows
 * a clinician ACCEPT decision.
 */

import type {
  CaseGraph,
  GraphEdge,
  GraphEdgeKind,
  GraphInconsistency,
  GraphNode,
  GraphNodeKind,
  GraphProvenance,
  GraphTraversalInput,
  GraphTraversalResult,
  GraphTrust,
} from './types'
import { IntelligenceError } from './types'

// ---------------------------------------------------------------------------
// Prisma-shaped structural interface (the ONLY DB surface the graph touches).
// Kept deliberately narrow so the Phase 2/3 fake-prisma harness satisfies it
// unchanged (findMany / findFirst / findUnique with where {eq, in, gte, lte}).
// ---------------------------------------------------------------------------

type Delegate = {
  findMany: (args?: {
    where?: Record<string, unknown>
    orderBy?: unknown
    take?: number
  }) => Promise<Record<string, any>[]>
  findFirst: (args?: { where?: Record<string, unknown> }) => Promise<Record<string, any> | null>
  findUnique: (args?: { where?: Record<string, unknown> }) => Promise<Record<string, any> | null>
}

export interface GraphPrisma {
  patient: Delegate
  staff: Delegate
  treatmentPlan: Delegate
  treatmentPlanItem: Delegate
  procedure: Delegate
  treatment: Delegate
  dentalChartEntry: Delegate
  appointment: Delegate
  imagingStudy: Delegate
  aiAnalysisJob: Delegate
  aiMemoryItem: Delegate
  clinicalNote: Delegate
  prescription: Delegate
  /** Used by the Clinic Brain (financial items, role-gated); optional because
   *  a graph-only caller may not carry it. */
  invoice?: Delegate
}

export interface BuildCaseGraphParams {
  hospitalId: string
  patientId: string
  /** Optional case focus (TreatmentPlan id). Absent → patient-level graph. */
  caseId?: string | null
  actor: { id: string; role: string }
  now: Date
  limits?: {
    maxNodes?: number
    maxEdges?: number
    maxAppointments?: number
    maxTreatments?: number
    maxImaging?: number
    maxChartEntries?: number
    maxMemory?: number
  }
}

const DEFAULT_LIMITS = {
  maxNodes: 200,
  maxEdges: 400,
  maxAppointments: 20,
  maxTreatments: 20,
  maxImaging: 10,
  maxChartEntries: 32,
  maxMemory: 20,
}

// ---------------------------------------------------------------------------
// Provenance helpers
// ---------------------------------------------------------------------------

function recProvenance(entity: string, id: string, at: Date | string): GraphProvenance {
  return { source: `${entity}:${id}`, actor: 'SYSTEM', at: new Date(at).toISOString(), sourceType: 'RECORD' }
}
function derivedProvenance(rule: string, at: Date): GraphProvenance {
  return { source: `derived:${rule}`, actor: 'SYSTEM', at: at.toISOString(), sourceType: 'DERIVED' }
}
function aiProvenance(source: string, at: Date | string | null): GraphProvenance {
  return { source, actor: 'SYSTEM', at: new Date(at ?? Date.now()).toISOString(), sourceType: 'AI' }
}
function userProvenance(source: string, at: Date | string | null): GraphProvenance {
  return { source, actor: 'SYSTEM', at: new Date(at ?? Date.now()).toISOString(), sourceType: 'USER' }
}

const MEMORY_TRUST_MAP: Record<string, GraphTrust> = {
  USER_PROVIDED: 'USER_PROVIDED',
  CLINIC_CONFIGURED: 'RECORD_FACT',
  DOCTOR_CONFIRMED: 'DOCTOR_CONFIRMED',
  CLINICALLY_VERIFIED: 'DOCTOR_CONFIRMED',
  SYSTEM_DERIVED: 'SYSTEM_INFERRED',
  AI_DERIVED: 'AI_DERIVED',
  UNKNOWN: 'UNKNOWN',
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildCaseGraph(prisma: GraphPrisma, p: BuildCaseGraphParams): Promise<CaseGraph> {
  const limits = { ...DEFAULT_LIMITS, ...(p.limits ?? {}) }
  const at = p.now.toISOString()

  // 1 — Boundary revalidation (tenant-pinned; fail closed).
  const patient = await prisma.patient.findUnique({ where: { id: p.patientId } })
  if (!patient) throw new IntelligenceError('INT_PATIENT_NOT_FOUND', 'patient not found')
  if (patient.hospitalId !== p.hospitalId) {
    throw new IntelligenceError('INT_SCOPE_MISMATCH', 'patient belongs to another tenant')
  }

  // 2 — Case focus (optional; revalidated tenant-side).
  let plan: Record<string, any> | null = null
  if (p.caseId) {
    plan = await prisma.treatmentPlan.findUnique({ where: { id: p.caseId } })
    if (!plan || plan.hospitalId !== p.hospitalId || plan.patientId !== p.patientId) {
      throw new IntelligenceError('INT_CASE_NOT_FOUND', 'case not found in this patient/tenant')
    }
  }

  // 3 — Tenant-pinned collection reads (bounded).
  const [plans, treatments, chart, appts, imaging, aiJobs, memItems, notes, rx] = await Promise.all([
    prisma.treatmentPlan.findMany({
      where: p.caseId ? { id: p.caseId } : { hospitalId: p.hospitalId, patientId: p.patientId },
      orderBy: [{ createdAt: 'desc' }],
    }),
    prisma.treatment.findMany({
      where: { hospitalId: p.hospitalId, patientId: p.patientId },
      orderBy: [{ createdAt: 'desc' }],
      take: limits.maxTreatments,
    }),
    prisma.dentalChartEntry.findMany({
      where: { hospitalId: p.hospitalId, patientId: p.patientId },
      orderBy: [{ diagnosedDate: 'desc' }],
      take: limits.maxChartEntries,
    }),
    prisma.appointment.findMany({
      where: { hospitalId: p.hospitalId, patientId: p.patientId },
      orderBy: [{ scheduledDate: 'desc' }],
      take: limits.maxAppointments,
    }),
    prisma.imagingStudy.findMany({
      where: { hospitalId: p.hospitalId, patientId: p.patientId },
      orderBy: [{ createdAt: 'desc' }],
      take: limits.maxImaging,
    }),
    prisma.aiAnalysisJob.findMany({ where: { hospitalId: p.hospitalId } }),
    prisma.aiMemoryItem.findMany({
      where: { hospitalId: p.hospitalId, patientId: p.patientId, status: 'ACTIVE' },
      take: limits.maxMemory,
    }),
    prisma.clinicalNote.findMany({
      where: { hospitalId: p.hospitalId, patientId: p.patientId },
      orderBy: [{ createdAt: 'desc' }],
      take: limits.maxTreatments,
    }),
    prisma.prescription.findMany({
      where: { hospitalId: p.hospitalId, patientId: p.patientId },
      orderBy: [{ createdAt: 'desc' }],
      take: limits.maxTreatments,
    }),
  ])

  // AI jobs must belong to THIS patient's studies (tenant pin is not enough —
  // revalidate against the study set: cross-patient jobs never enter the graph).
  const studyIds = new Set(imaging.map((s) => s.id))
  const patientJobs = aiJobs.filter((j) => studyIds.has(j.studyId))

  // 4 — Assemble nodes + edges.
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const addNode = (n: GraphNode) => nodes.push(n)
  const addEdge = (e: GraphEdge) => edges.push(e)

  const doctorIds = new Set<string>([
    ...treatments.map((t) => t.doctorId),
    ...appts.map((a) => a.doctorId),
    ...plans.map((pl) => pl.doctorId).filter(Boolean),
  ].filter(Boolean) as string[])
  for (const docId of [...doctorIds].slice(0, 10)) {
    const doc = await prisma.staff.findUnique({ where: { id: docId } })
    if (!doc || doc.hospitalId !== p.hospitalId) continue
    addNode({
      id: `doctor:${doc.id}`,
      kind: 'DOCTOR',
      ref: doc.id,
      label: `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim() || doc.id,
      trust: 'RECORD_FACT',
      provenance: recProvenance('Staff', doc.id, p.now),
      data: { role: 'doctor' },
    })
    addEdge({ kind: 'DOCTOR_SEES_PATIENT', from: `doctor:${doc.id}`, to: `patient:${p.patientId}`, trust: 'RECORD_FACT', provenance: derivedProvenance('doctor_from_treatment_appointment', p.now) })
  }

  addNode({
    id: `patient:${p.patientId}`,
    kind: 'PATIENT',
    ref: p.patientId,
    label: `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || p.patientId,
    trust: 'RECORD_FACT',
    provenance: recProvenance('Patient', p.patientId, p.now),
    data: { patientNo: patient.patientId ?? null },
  })

  // Symptoms — patient words (chief complaints) are USER_PROVIDED.
  const seenSymptoms = new Set<string>()
  const addSymptom = (text: string | null | undefined, source: string, at: Date | string | null, toCaseId: string | null) => {
    if (!text || !text.trim()) return
    const key = text.trim().slice(0, 120)
    if (seenSymptoms.has(key)) return
    seenSymptoms.add(key)
    const id = `symptom:${source}:${key}`
    addNode({
      id,
      kind: 'SYMPTOM',
      ref: key,
      label: key,
      trust: 'USER_PROVIDED',
      provenance: userProvenance(source, at),
      data: { text: key },
    })
    addEdge({ kind: 'PATIENT_HAS_SYMPTOM', from: `patient:${p.patientId}`, to: id, trust: 'USER_PROVIDED', provenance: userProvenance(source, at) })
    if (toCaseId) {
      addEdge({ kind: 'CASE_HAS_SYMPTOM', from: toCaseId, to: id, trust: 'USER_PROVIDED', provenance: userProvenance(source, at) })
    }
  }

  // Cases (TreatmentPlans).
  for (const pl of plans) {
    const caseId = `case:${pl.id}`
    addNode({
      id: caseId,
      kind: 'CASE',
      ref: pl.planNumber ?? pl.id,
      label: pl.title || pl.planNumber || pl.id,
      trust: 'RECORD_FACT',
      provenance: recProvenance('TreatmentPlan', pl.id, pl.createdAt ?? p.now),
      data: {
        planNumber: pl.planNumber ?? null,
        status: pl.status ?? null,
        diagnosis: pl.diagnosis ?? null,
        consentGiven: pl.consentGiven ?? false,
        expectedEndDate: pl.expectedEndDate ? new Date(pl.expectedEndDate).toISOString() : null,
      },
    })
    addEdge({ kind: 'PATIENT_HAS_CASE', from: `patient:${p.patientId}`, to: caseId, trust: 'RECORD_FACT', provenance: recProvenance('TreatmentPlan', pl.id, pl.createdAt ?? p.now) })
    if (pl.appointmentId) {
      addEdge({ kind: 'CASE_HAS_APPOINTMENT', from: caseId, to: `appointment:${pl.appointmentId}`, trust: 'RECORD_FACT', provenance: recProvenance('TreatmentPlan.appointmentId', pl.id, pl.createdAt ?? p.now) })
    }
    if (pl.doctorId) {
      const doc = doctorIds.has(pl.doctorId) ? pl.doctorId : null
      if (doc) addEdge({ kind: 'CASE_HAS_DOCTOR_LINK', from: caseId, to: `doctor:${doc}`, trust: 'RECORD_FACT', provenance: recProvenance('TreatmentPlan.doctorId', pl.id, pl.createdAt ?? p.now) })
    }
    // Diagnosis support — ONLY when the clinician recorded one (RECORD_FACT,
    // never AI-derived). No diagnosis → no node (never fabricated).
    if (pl.diagnosis && String(pl.diagnosis).trim()) {
      addNode({
        id: `diag:${pl.id}`,
        kind: 'DIAGNOSIS_SUPPORT',
        ref: pl.id,
        label: String(pl.diagnosis).slice(0, 160),
        trust: 'DOCTOR_CONFIRMED',
        provenance: recProvenance('TreatmentPlan.diagnosis', pl.id, pl.createdAt ?? p.now),
        data: {
          text: String(pl.diagnosis),
          status: 'RECORDED', // clinician-recorded — NOT an AI claim
          source: 'TREATMENT_PLAN',
        },
      })
      addEdge({ kind: 'CASE_HAS_DIAGNOSIS_SUPPORT', from: caseId, to: `diag:${pl.id}`, trust: 'DOCTOR_CONFIRMED', provenance: recProvenance('TreatmentPlan.diagnosis', pl.id, pl.createdAt ?? p.now) })
    }
    addSymptom(pl.chiefComplaint, `TreatmentPlan:${pl.id}`, pl.createdAt, caseId)
  }

  // Teeth + findings (DentalChartEntry IS the tooth-finding record).
  for (const c of chart) {
    const toothId = `tooth:${p.patientId}:${c.toothNumber}`
    if (!nodes.some((n) => n.id === toothId)) {
      addNode({
        id: toothId,
        kind: 'TOOTH',
        ref: String(c.toothNumber),
        label: `Tooth ${c.toothNumber}`,
        trust: 'RECORD_FACT',
        provenance: recProvenance('DentalChartEntry', c.id, c.diagnosedDate ?? p.now),
        data: { fdi: c.toothNumber, notation: c.toothNotation ?? null },
      })
      const linkedCase = plans.find((pl) => planMentionsTooth(pl, c.toothNumber))
      addEdge({
        kind: 'CASE_HAS_TOOTH',
        from: linkedCase ? `case:${linkedCase.id}` : `patient:${p.patientId}`,
        to: toothId,
        trust: linkedCase ? 'SYSTEM_INFERRED' : 'RECORD_FACT',
        provenance: linkedCase
          ? derivedProvenance('tooth_from_plan_item_toothNumbers', p.now)
          : recProvenance('DentalChartEntry', c.id, c.diagnosedDate ?? p.now),
      })
    }
    if (c.condition && c.condition !== 'HEALTHY') {
      const findingId = `finding:${c.id}`
      addNode({
        id: findingId,
        kind: 'FINDING',
        ref: c.id,
        label: `Tooth ${c.toothNumber}: ${c.condition} (${c.severity})`,
        trust: 'DOCTOR_CONFIRMED', // chart entries are clinician-recorded
        provenance: recProvenance('DentalChartEntry', c.id, c.diagnosedDate ?? p.now),
        data: {
          tooth: c.toothNumber,
          condition: c.condition,
          severity: c.severity,
          resolved: c.resolvedDate ? new Date(c.resolvedDate).toISOString() : null,
        },
      })
      addEdge({ kind: 'TOOTH_HAS_FINDING', from: toothId, to: findingId, trust: 'DOCTOR_CONFIRMED', provenance: recProvenance('DentalChartEntry', c.id, c.diagnosedDate ?? p.now) })
    }
  }

  // Appointments.
  for (const a of appts) {
    const apptId = `appointment:${a.id}`
    addNode({
      id: apptId,
      kind: 'APPOINTMENT',
      ref: a.appointmentNo ?? a.id,
      label: `Appt ${a.appointmentNo ?? a.id} (${a.status})`,
      trust: 'RECORD_FACT',
      provenance: recProvenance('Appointment', a.id, a.createdAt ?? p.now),
      data: {
        appointmentNo: a.appointmentNo ?? null,
        type: a.appointmentType ?? null,
        status: a.status ?? null,
        scheduledDate: a.scheduledDate ? new Date(a.scheduledDate).toISOString() : null,
        priority: a.priority ?? null,
      },
    })
    addEdge({ kind: 'PATIENT_HAS_APPOINTMENT', from: `patient:${p.patientId}`, to: apptId, trust: 'RECORD_FACT', provenance: recProvenance('Appointment', a.id, a.createdAt ?? p.now) })
    addSymptom(a.chiefComplaint, `Appointment:${a.id}`, a.createdAt, null)
  }

  // Treatments (+ follow-up + outcome derivation).
  for (const t of treatments) {
    const trtId = `treatment:${t.id}`
    addNode({
      id: trtId,
      kind: 'TREATMENT',
      ref: t.treatmentNo ?? t.id,
      label: `Treatment ${t.treatmentNo ?? t.id} (${t.status})`,
      trust: 'RECORD_FACT',
      provenance: recProvenance('Treatment', t.id, t.createdAt ?? p.now),
      data: {
        treatmentNo: t.treatmentNo ?? null,
        status: t.status ?? null,
        toothNumbers: t.toothNumbers ?? null,
        procedureId: t.procedureId ?? null,
        startTime: t.startTime ? new Date(t.startTime).toISOString() : null,
        endTime: t.endTime ? new Date(t.endTime).toISOString() : null,
      },
    })
    addEdge({ kind: 'PATIENT_HAS_TREATMENT', from: `patient:${p.patientId}`, to: trtId, trust: 'RECORD_FACT', provenance: recProvenance('Treatment', t.id, t.createdAt ?? p.now) })
    if (t.appointmentId) {
      addEdge({ kind: 'CASE_HAS_APPOINTMENT', from: `appointment:${t.appointmentId}`, to: trtId, trust: 'SYSTEM_INFERRED', provenance: derivedProvenance('treatment_from_appointment', p.now) })
    }
    addSymptom(t.chiefComplaint, `Treatment:${t.id}`, t.createdAt, null)

    // Follow-up — deterministic derivation from the record.
    if (t.followUpRequired) {
      const fuId = `followup:${t.id}`
      addNode({
        id: fuId,
        kind: 'FOLLOW_UP',
        ref: t.id,
        label: `Follow-up ${t.followUpDate ? new Date(t.followUpDate).toISOString().slice(0, 10) : 'date unknown'}`,
        trust: t.followUpDate ? 'RECORD_FACT' : 'SYSTEM_INFERRED',
        provenance: t.followUpDate
          ? recProvenance('Treatment.followUpDate', t.id, t.createdAt ?? p.now)
          : derivedProvenance('followup_required_no_date', p.now),
        data: {
          required: true,
          date: t.followUpDate ? new Date(t.followUpDate).toISOString() : null,
          notes: t.followUpNotes ?? null,
        },
      })
      addEdge({ kind: 'TREATMENT_HAS_FOLLOW_UP', from: trtId, to: fuId, trust: 'RECORD_FACT', provenance: recProvenance('Treatment.followUpRequired', t.id, t.createdAt ?? p.now) })
      const linkedCase = plans.find((pl) => planLinksTreatment(pl, t))
      if (linkedCase) {
        addEdge({ kind: 'CASE_HAS_FOLLOW_UP', from: `case:${linkedCase.id}`, to: fuId, trust: 'SYSTEM_INFERRED', provenance: derivedProvenance('followup_linked_to_case', p.now) })
      }
    }

    // Outcome — COMPLETED treatments have an outcome; others do NOT.
    if (t.status === 'COMPLETED') {
      const ocId = `outcome:${t.id}`
      addNode({
        id: ocId,
        kind: 'OUTCOME',
        ref: t.id,
        label: `Completed ${t.treatmentNo ?? t.id}`,
        trust: 'RECORD_FACT',
        provenance: recProvenance('Treatment.status', t.id, t.updatedAt ?? p.now),
        data: { status: 'COMPLETED', complications: t.complications ?? null, completedAt: t.endTime ? new Date(t.endTime).toISOString() : null },
      })
      addEdge({ kind: 'TREATMENT_HAS_OUTCOME', from: trtId, to: ocId, trust: 'RECORD_FACT', provenance: recProvenance('Treatment.status', t.id, t.updatedAt ?? p.now) })
    }
  }

  // Imaging + AI findings (+ clinician confirmation edge).
  for (const s of imaging) {
    const stId = `imaging:${s.id}`
    addNode({
      id: stId,
      kind: 'IMAGING',
      ref: s.id,
      label: `Study ${s.modality ?? 'IMG'}`,
      trust: 'RECORD_FACT',
      provenance: recProvenance('ImagingStudy', s.id, s.createdAt ?? p.now),
      data: {
        modality: s.modality ?? null,
        studyType: s.studyType ?? null,
        status: s.status ?? null,
        studyDate: s.studyDate ? new Date(s.studyDate).toISOString() : null,
      },
    })
    addEdge({ kind: 'PATIENT_HAS_IMAGING', from: `patient:${p.patientId}`, to: stId, trust: 'RECORD_FACT', provenance: recProvenance('ImagingStudy', s.id, s.createdAt ?? p.now) })

    const jobs = patientJobs.filter((j) => j.studyId === s.id)
    for (const j of jobs) {
      const jobId = `aifinding:${j.id}`
      addNode({
        id: jobId,
        kind: 'AI_FINDING',
        ref: j.id,
        label: `AI finding (${j.engine ?? 'engine'}) ${j.reviewDecision ? `· ${j.reviewDecision}` : ''}`,
        trust: j.reviewDecision === 'ACCEPTED' ? 'DOCTOR_CONFIRMED' : 'AI_DERIVED',
        provenance: aiProvenance(`AIAnalysisJob:${j.id}`, j.completedAt ?? j.createdAt),
        data: {
          engine: j.engine ?? null,
          status: j.status ?? null,
          reviewDecision: j.reviewDecision ?? null,
          reviewedAt: j.reviewedAt ? new Date(j.reviewedAt).toISOString() : null,
          provenanceRecord: {
            modelVersion: j.modelVersion ?? null,
            modelChecksum: j.modelChecksum ?? null,
            modelSource: j.modelSource ?? null,
            orchestratorVersion: j.orchestratorVersion ?? null,
          },
          // Findings are BOUNDED references + counts, never raw content dumps:
          findingCount: countFindings(j.findings),
        },
      })
      addEdge({ kind: 'IMAGING_HAS_AI_FINDING', from: stId, to: jobId, trust: j.reviewDecision === 'ACCEPTED' ? 'DOCTOR_CONFIRMED' : 'AI_DERIVED', provenance: aiProvenance(`AIAnalysisJob:${j.id}`, j.completedAt ?? j.createdAt) })
      if (j.reviewDecision === 'ACCEPTED') {
        const reviewer = j.reviewedById ? `doctor:${j.reviewedById}` : null
        if (reviewer) {
          addEdge({ kind: 'AI_FINDING_CONFIRMED_BY', from: jobId, to: reviewer, trust: 'DOCTOR_CONFIRMED', provenance: recProvenance('AIAnalysisJob.reviewDecision', j.id, j.reviewedAt ?? p.now) })
        }
      }
    }
  }

  // Memory — references only (content stays in the Memory layer with its own
  // trust/retention; the graph never overwrites authoritative records).
  for (const m of memItems) {
    const memId = `memory:${m.id}`
    addNode({
      id: memId,
      kind: 'MEMORY',
      ref: m.id,
      label: `Memory ${m.key ?? m.id} [${m.trustLevel ?? 'UNKNOWN'}]`,
      trust: MEMORY_TRUST_MAP[m.trustLevel ?? ''] ?? 'UNKNOWN',
      provenance: {
        source: `AiMemoryItem:${m.id}`,
        actor: m.createdBy ?? 'SYSTEM',
        at: new Date(m.createdAt ?? p.now).toISOString(),
        sourceType: 'RECORD',
      },
      data: {
        key: m.key ?? null,
        domain: m.domain ?? null,
        trustLevel: m.trustLevel ?? null,
        memoryType: m.memoryType ?? null,
        // NOTE: value content is intentionally excluded (content is fetched
        // through the scoped Memory API, never through the graph projection).
      },
    })
    const caseScoped = m.domain === 'CASE' && m.caseId && plans.some((pl) => pl.id === m.caseId)
    if (caseScoped) {
      addEdge({ kind: 'CASE_HAS_MEMORY', from: `case:${m.caseId}`, to: memId, trust: 'RECORD_FACT', provenance: recProvenance('AiMemoryItem', m.id, m.createdAt ?? p.now) })
    } else {
      addEdge({ kind: 'PATIENT_HAS_MEMORY', from: `patient:${p.patientId}`, to: memId, trust: 'RECORD_FACT', provenance: recProvenance('AiMemoryItem', m.id, m.createdAt ?? p.now) })
    }
  }

  // Clinical notes + prescriptions (references, bounded).
  for (const n of notes) {
    addNode({
      id: `note:${n.id}`,
      kind: 'FINDING',
      ref: n.id,
      label: `Clinical note ${new Date(n.createdAt ?? p.now).toISOString().slice(0, 10)}`,
      trust: 'DOCTOR_CONFIRMED',
      provenance: recProvenance('ClinicalNote', n.id, n.createdAt ?? p.now),
      data: { createdAt: new Date(n.createdAt ?? p.now).toISOString(), hasContent: Boolean(n.content) },
    })
    addEdge({ kind: 'PATIENT_HAS_FINDING_LINK', from: `patient:${p.patientId}`, to: `note:${n.id}`, trust: 'RECORD_FACT', provenance: recProvenance('ClinicalNote', n.id, n.createdAt ?? p.now) })
  }
  for (const r of rx) {
    addNode({
      id: `rx:${r.id}`,
      kind: 'TREATMENT',
      ref: r.id,
      label: `Prescription ${r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : r.id}`,
      trust: 'RECORD_FACT',
      provenance: recProvenance('Prescription', r.id, r.createdAt ?? p.now),
      data: { status: r.status ?? null, prescriptionNo: r.prescriptionNo ?? null },
    })
    addEdge({ kind: 'PATIENT_HAS_TREATMENT', from: `patient:${p.patientId}`, to: `rx:${r.id}`, trust: 'RECORD_FACT', provenance: recProvenance('Prescription', r.id, r.createdAt ?? p.now) })
  }

  // 5 — Apply bounded limits (truncate deterministically; never silently).
  let truncated = false
  if (nodes.length > limits.maxNodes) {
    nodes.splice(limits.maxNodes)
    truncated = true
  }
  if (edges.length > limits.maxEdges) {
    edges.splice(limits.maxEdges)
    truncated = true
  }
  // Drop edges whose endpoints were truncated (orphan prevention).
  const nodeIds = new Set(nodes.map((n) => n.id))
  const keptEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
  if (keptEdges.length < edges.length) truncated = true

  return {
    tenant: p.hospitalId,
    patientId: p.patientId,
    caseId: p.caseId ?? null,
    builtAt: at,
    nodes,
    edges: keptEdges,
    limits: { maxNodes: limits.maxNodes, maxDepth: 6, truncated },
  }
}

// ---------------------------------------------------------------------------
// Bounded traversal (pure, in-memory, deterministic)
// ---------------------------------------------------------------------------

export function traverseGraph(graph: CaseGraph, input: GraphTraversalInput): GraphTraversalResult {
  const maxDepth = Math.min(input.maxDepth ?? 3, graph.limits.maxDepth)
  const maxNodes = Math.min(input.maxNodes ?? 50, graph.limits.maxNodes)
  const direction = input.direction ?? 'both'
  const kindFilter = input.edgeKinds ? new Set(input.edgeKinds) : null

  const adjacency = new Map<string, { edge: GraphEdge; other: string }[]>()
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const e of graph.edges) {
    if (kindFilter && !kindFilter.has(e.kind)) continue
    if (direction === 'in' && e.to !== input.startId) continue
    if (direction === 'out' && e.from !== input.startId) continue
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), { edge: e, other: e.to }])
    adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), { edge: e, other: e.from }])
  }

  const seenNodes = new Set<string>([input.startId])
  const seenEdges = new Set<string>()
  const outNodes: GraphNode[] = []
  const outEdges: GraphEdge[] = []
  let queryCount = 0
  let maxDepthReached = 0
  let truncated = false

  if (!nodeById.has(input.startId)) {
    return { nodes: [], edges: [], depth: 0, truncated: false, queryCount: 0, resultCount: 0, maxDepthReached: 0 }
  }
  outNodes.push(nodeById.get(input.startId)!)

  // BFS with per-level expansion (bounded).
  let frontier: string[] = [input.startId]
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const { edge, other } of adjacency.get(id) ?? []) {
        const key = `${edge.from}->${edge.to}`
        if (!seenEdges.has(key)) {
          seenEdges.add(key)
          outEdges.push(edge)
        }
        if (seenNodes.has(other)) continue
        if (outNodes.length >= maxNodes) {
          truncated = true
          frontier = []
          break
        }
        seenNodes.add(other)
        const n = nodeById.get(other)
        if (n) outNodes.push(n)
        next.push(other)
      }
      if (truncated) break
    }
    if (outEdges.length > 0) {
      maxDepthReached = depth
      queryCount += frontier.length
    }
    frontier = next
    if (truncated) break
  }

  return {
    nodes: outNodes,
    edges: outEdges,
    depth: maxDepthReached,
    truncated,
    queryCount,
    resultCount: outNodes.length,
    maxDepthReached,
  }
}

// ---------------------------------------------------------------------------
// §33 — consistency checks (report; NEVER silently repair)
// ---------------------------------------------------------------------------

export function checkGraphConsistency(graph: CaseGraph): GraphInconsistency[] {
  const issues: GraphInconsistency[] = []
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const edgeKey = (e: GraphEdge) => `${e.kind}|${e.from}|${e.to}`
  const seen = new Map<string, number>()

  for (const e of graph.edges) {
    // Orphan edges (endpoint missing).
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
      issues.push({ code: 'ORPHAN_EDGE', detail: `edge ${e.kind} ${e.from} -> ${e.to} has missing endpoint` })
    }
    // Cross-tenant edges are impossible by construction (tenant-pinned reads) —
    // but a patient node referencing a foreign patient id is an impossibility:
    if (e.from.startsWith('patient:') && e.to.startsWith('patient:') && e.from !== e.to) {
      issues.push({ code: 'IMPOSSIBLE_PATIENT_CASE_LINK', detail: `two distinct patient nodes in one patient graph: ${e.from}, ${e.to}` })
    }
    // Missing provenance.
    if (!e.provenance?.source || !e.provenance.at) {
      issues.push({ code: 'MISSING_PROVENANCE', detail: `edge ${edgeKey(e)} lacks provenance` })
    }
    // Duplicate edges.
    const k = edgeKey(e)
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  for (const [k, count] of seen) {
    if (count > 1) issues.push({ code: 'DUPLICATE_EDGE', detail: `edge ${k} appears ${count} times`, edges: count })
  }

  // Node-level checks.
  const caseNodes = graph.nodes.filter((n) => n.kind === 'CASE')
  const patientNodes = graph.nodes.filter((n) => n.kind === 'PATIENT')
  // Conflicting case states (same case ref, different status values).
  const byRef = new Map<string, GraphNode[]>()
  for (const n of graph.nodes) byRef.set(n.ref, [...(byRef.get(n.ref) ?? []), n])
  for (const [ref, list] of byRef) {
    const statuses = new Set(list.map((n) => String(n.data.status ?? '')))
    if (list.length > 1 && statuses.size > 1 && list.every((n) => n.kind === 'CASE')) {
      issues.push({ code: 'CONFLICTING_STATE', detail: `case ref ${ref} has conflicting states: ${[...statuses].join(', ')}`, nodes: list.length })
    }
  }
  // Stale derived follow-ups (date in the past with no completed link —
  // reported as a finding, NOT auto-corrected).
  const nowIso = graph.builtAt
  for (const n of graph.nodes) {
    if (n.kind === 'FOLLOW_UP' && n.provenance.sourceType === 'RECORD' && n.data.date && n.data.date < nowIso) {
      issues.push({ code: 'STALE_DERIVED_RELATIONSHIP', detail: `follow-up ${n.ref} is overdue (date ${n.data.date}) — needs review` })
    }
  }
  void patientNodes
  void caseNodes
  return issues
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planMentionsTooth(plan: Record<string, any>, toothNumber: number): boolean {
  // The plan row itself does not carry items in a flat read — a tooth links to
  // the case when the case focus IS this plan, or when the plan's toothNumbers
  // reference (denormalized in fixtures) mentions it. Deterministic + bounded.
  if (plan.toothNumbers && String(plan.toothNumbers).split(/[\s,]+/).includes(String(toothNumber))) return true
  return false
}

function planLinksTreatment(plan: Record<string, any>, treatment: Record<string, any>): boolean {
  // A treatment links to the focused case when the case was given explicitly
  // (single plan) or the plan's appointment matches the treatment's.
  if (plan.appointmentId && treatment.appointmentId && plan.appointmentId === treatment.appointmentId) return true
  if (plan.treatmentNos && String(plan.treatmentNos).includes(treatment.treatmentNo ?? '')) return true
  return false
}

function countFindings(findings: unknown): number {
  if (!findings) return 0
  if (Array.isArray(findings)) return findings.length
  if (typeof findings === 'object') {
    const arr = (findings as Record<string, unknown>).findings
    if (Array.isArray(arr)) return arr.length
  }
  return 1
}

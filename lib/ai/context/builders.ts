/**
 * Phase 2 — Context section builders.
 *
 * Each builder = at most a couple of BOUNDED Prisma queries (take-limited,
 * tenant- and patient-scoped). No per-record follow-up queries → no N+1.
 *
 * Retrieval happens AFTER permission filtering (§18): the service decides
 * which sections/fields a role may see; builders only receive permitted
 * sections and a fieldScope that strips disallowed fields at build time.
 */

import {
  type ContextProfile, type TimelineEvent,
  type Provenance, type AiFindingView, type AiAnalysisView,
} from './types'
import type { SectionBudget } from './profiles'
import { isValidFdi, parseToothNumbers, sortFdi, toothName } from './fdi'
import { canSeeContact, canSeePrivateNotes, type FieldScope } from './permissions'
import { FACT, freshnessOf, makeProvenance, newestTimestamp, truncateText } from './provenance'

export interface BuilderScope {
  toothFdi: number | null
  caseId: string | null
  studyId: string | null
  treatmentNo: string | null
}

export interface BuildArgs {
  client: any // prisma (or counting proxy in tests) — structurally typed
  hospitalId: string
  patientId: string
  role: string
  profile: ContextProfile
  budget: SectionBudget
  scope: BuilderScope
  now: Date
}

// ---------------------------------------------------------------------------
// identity + medical (from the resolved patient row — no extra queries)
// ---------------------------------------------------------------------------

export interface ResolvedPatient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  age: number | null
  dateOfBirth: Date | string | null
  gender: string | null
  bloodGroup: string | null
  phone: string
  alternatePhone: string | null
  email: string | null
  locale: string | null
  createdAt: Date
  medicalHistory: any | null
}

export function buildIdentity(p: ResolvedPatient, role: string) {
  return {
    patientId: p.patientId,
    name: `${p.firstName} ${p.lastName}`,
    age: p.age,
    dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth).toISOString() : null,
    gender: p.gender,
    bloodGroup: p.bloodGroup,
    ...(canSeeContact(role)
      ? { contact: { phone: p.phone, alternatePhone: p.alternatePhone, email: p.email } }
      : {}),
    locale: p.locale,
    patientSince: new Date(p.createdAt).toISOString(),
  }
}

export function buildMedical(p: ResolvedPatient, budget: SectionBudget) {
  const h = p.medicalHistory
  if (!h) return null
  const conditions: string[] = []
  if (h.hasDiabetes) conditions.push('Diabetes' + (h.diabetesType ? ` (${h.diabetesType})` : ''))
  if (h.hasHypertension) conditions.push('Hypertension')
  if (h.hasHeartDisease) conditions.push('Heart disease' + (h.heartCondition ? ` (${h.heartCondition})` : ''))
  if (h.hasBleedingDisorder) conditions.push('Bleeding disorder')
  if (h.hasAsthma) conditions.push('Asthma')
  if (h.hasThyroid) conditions.push('Thyroid' + (h.thyroidType ? ` (${h.thyroidType})` : ''))
  if (h.hasHepatitis) conditions.push('Hepatitis' + (h.hepatitisType ? ` (${h.hepatitisType})` : ''))
  if (h.hasHiv) conditions.push('HIV positive')
  if (h.hasEpilepsy) conditions.push('Epilepsy')
  if (h.otherConditions) conditions.push(truncateText(h.otherConditions, budget.maxTextChars) || '')

  const alerts: string[] = []
  if (h.drugAllergies) alerts.push(`Drug allergy: ${truncateText(h.drugAllergies, budget.maxTextChars)}`)
  if (h.foodAllergies) alerts.push(`Food allergy: ${truncateText(h.foodAllergies, budget.maxTextChars)}`)
  if (h.materialAllergies) alerts.push(`Material allergy: ${truncateText(h.materialAllergies, budget.maxTextChars)}`)
  if (h.isPregnant) alerts.push(`Pregnant${h.pregnancyWeeks ? ` (${h.pregnancyWeeks} weeks)` : ''}`)

  return {
    allergies: {
      drug: truncateText(h.drugAllergies, budget.maxTextChars),
      food: truncateText(h.foodAllergies, budget.maxTextChars),
      material: truncateText(h.materialAllergies, budget.maxTextChars),
    },
    conditions: conditions.filter(Boolean),
    currentMedications: truncateText(h.currentMedications, budget.maxTextChars),
    previousDentalWork: truncateText(h.previousDentalWork, budget.maxTextChars),
    smokingStatus: h.smokingStatus,
    pregnancy: { isPregnant: h.isPregnant, weeks: h.pregnancyWeeks },
    alerts,
    provenance: makeProvenance({
      sourceType: 'medical_history', sourceId: h.id,
      entityType: 'MedicalHistory', entityId: h.id, timestamp: h.updatedAt ?? h.createdAt,
    }),
  }
}

// ---------------------------------------------------------------------------
// dental chart
// ---------------------------------------------------------------------------

interface ChartRow {
  id: string; toothNumber: number; condition: string; severity: string
  mesial: boolean; distal: boolean; occlusal: boolean; buccal: boolean; lingual: boolean
  notes: string | null; diagnosedDate: Date; resolvedDate: Date | null
}

function chartEntryView(r: ChartRow, budget: SectionBudget, active: boolean) {
  return {
    toothFdi: r.toothNumber,
    toothName: toothName(r.toothNumber),
    condition: r.condition,
    severity: r.severity,
    surfaces: { mesial: r.mesial, distal: r.distal, occlusal: r.occlusal, buccal: r.buccal, lingual: r.lingual },
    notes: truncateText(r.notes, budget.maxTextChars),
    diagnosedAt: new Date(r.diagnosedDate).toISOString(),
    resolvedAt: r.resolvedDate ? new Date(r.resolvedDate).toISOString() : null,
    active,
    provenance: makeProvenance({
      sourceType: 'dental_chart', sourceId: r.id,
      entityType: 'DentalChartEntry', entityId: r.id, timestamp: r.diagnosedDate,
    }),
  }
}

export async function buildDental(a: BuildArgs) {
  const where: Record<string, unknown> = { hospitalId: a.hospitalId, patientId: a.patientId }
  if (a.scope.toothFdi !== null) where.toothNumber = a.scope.toothFdi // TOOTH scope: this tooth only
  const rows: ChartRow[] = await a.client.dentalChartEntry.findMany({
    where,
    orderBy: { diagnosedDate: 'desc' },
    take: a.scope.toothFdi !== null ? a.budget.maxRecords : a.budget.maxRecords * 2,
  })
  // Active = latest entry per tooth (unresolved wins, else most recent).
  const byTooth = new Map<number, ChartRow[]>()
  for (const r of rows) {
    if (!isValidFdi(r.toothNumber)) continue
    const list = byTooth.get(r.toothNumber) ?? []
    list.push(r)
    byTooth.set(r.toothNumber, list)
  }
  const active: ChartRow[] = []
  const history: ChartRow[] = []
  for (const tooth of [...byTooth.keys()].sort((x, y) => x - y)) {
    const list = byTooth.get(tooth)! // newest first
    const activeRow = list.find((r) => r.resolvedDate === null) ?? list[0]
    active.push(activeRow)
    history.push(...list.filter((r) => r !== activeRow))
  }
  const summary: Record<string, number> = {}
  for (const r of active) summary[r.condition] = (summary[r.condition] ?? 0) + 1
  const latest = newestTimestamp(rows, (r) => r.diagnosedDate)
  return {
    data: {
      active: active.map((r) => chartEntryView(r, a.budget, true)),
      history: history.slice(0, a.budget.maxRecords).map((r) => chartEntryView(r, a.budget, false)),
      toothCount: active.length,
      conditionSummary: summary,
    },
    latest,
  }
}

// ---------------------------------------------------------------------------
// appointments
// ---------------------------------------------------------------------------

interface ApptRow {
  id: string; appointmentNo: string; appointmentType: string; status: string
  scheduledDate: Date; chiefComplaint: string | null; doctor?: { firstName: string; lastName: string } | null
}

function apptView(r: ApptRow, budget: SectionBudget) {
  return {
    appointmentNo: r.appointmentNo,
    type: r.appointmentType,
    status: r.status,
    scheduledAt: new Date(r.scheduledDate).toISOString(),
    chiefComplaint: truncateText(r.chiefComplaint, budget.maxTextChars),
    category: (r.chiefComplaint ? FACT.patientReported : FACT.systemEvent) as 'PATIENT_REPORTED' | 'SYSTEM_EVENT',
    provenance: makeProvenance({
      sourceType: 'appointment', sourceId: r.id,
      entityType: 'Appointment', entityId: r.id, timestamp: r.scheduledDate,
    }),
  }
}

export async function buildAppointments(a: BuildArgs) {
  const rows: ApptRow[] = await a.client.appointment.findMany({
    where: { hospitalId: a.hospitalId, patientId: a.patientId },
    orderBy: { scheduledDate: 'desc' },
    take: a.budget.maxRecords * 2,
    include: { doctor: { select: { firstName: true, lastName: true } } },
  })
  const today = new Date(a.now)
  today.setHours(0, 0, 0, 0)
  const windowStart = a.budget.windowDays
    ? new Date(a.now.getTime() - a.budget.windowDays * 86400000)
    : null

  const classify = (r: ApptRow): 'upcoming' | 'recent' | 'cancelled' | 'missed' => {
    const d = new Date(r.scheduledDate)
    d.setHours(0, 0, 0, 0)
    if (['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(r.status) && d >= today) return 'upcoming'
    if (r.status === 'COMPLETED') return 'recent'
    if (r.status === 'CANCELLED' || r.status === 'RESCHEDULED') return 'cancelled'
    if (r.status === 'NO_SHOW') return 'missed'
    return 'recent'
  }
  const grouped: Record<'upcoming' | 'recent' | 'cancelled' | 'missed', unknown[]> = {
    upcoming: [], recent: [], cancelled: [], missed: [],
  }
  for (const r of rows) {
    const d = new Date(r.scheduledDate)
    if (windowStart && d < windowStart && classify(r) === 'recent') continue
    grouped[classify(r)].push(apptView(r, a.budget))
  }
  for (const k of Object.keys(grouped) as Array<keyof typeof grouped>) {
    grouped[k] = grouped[k].slice(0, a.budget.maxRecords)
  }
  const latest = newestTimestamp(rows, (r) => r.scheduledDate)
  return { data: grouped, latest }
}

// ---------------------------------------------------------------------------
// clinical (notes + complaints)
// ---------------------------------------------------------------------------

interface NoteRow {
  id: string; noteType: string; content: string; isPrivate: boolean
  createdAt: Date; doctor?: { firstName: string; lastName: string } | null
  treatmentPlanId: string | null
}

function noteView(r: NoteRow, budget: SectionBudget) {
  return {
    noteType: r.noteType,
    content: truncateText(r.content, budget.maxTextChars),
    isPrivate: r.isPrivate,
    createdAt: new Date(r.createdAt).toISOString(),
    doctorName: r.doctor ? `${r.doctor.firstName} ${r.doctor.lastName}` : null,
    provenance: makeProvenance({
      sourceType: 'clinical_note', sourceId: r.id,
      entityType: 'ClinicalNote', entityId: r.id, timestamp: r.createdAt,
      actor: r.doctor?.firstName ? 'doctor' : null,
    }),
  }
}

export interface ClinicalBuild {
  data: { notes: any[]; examinations: any[]; followUpNotes: any[]; complaints: any[] }
  latest: Date | string | null
  noteRows: NoteRow[]
}

export async function buildClinical(a: BuildArgs): Promise<ClinicalBuild> {
  const where: Record<string, unknown> = { hospitalId: a.hospitalId, patientId: a.patientId }
  if (!canSeePrivateNotes(a.role)) where.isPrivate = false // omission at retrieval
  const rows: NoteRow[] = await a.client.clinicalNote.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: a.budget.maxRecords * 2,
    include: { doctor: { select: { firstName: true, lastName: true } } },
  })
  const inWindow = (r: NoteRow) =>
    a.budget.windowDays === null || new Date(r.createdAt) >= new Date(a.now.getTime() - a.budget.windowDays * 86400000)
  const kept = rows.filter(inWindow).slice(0, a.budget.maxRecords)
  const views = kept.map((r) => noteView(r, a.budget))
  return {
    data: {
      notes: views.filter((v) => ['GENERAL', 'REFERRAL'].includes(v.noteType)),
      examinations: views.filter((v) => v.noteType === 'EXAMINATION'),
      followUpNotes: views.filter((v) => v.noteType === 'FOLLOW_UP'),
      complaints: [], // filled by the service from appointment/treatment/plan rows
    },
    latest: newestTimestamp(kept, (r) => r.createdAt),
    noteRows: kept,
  }
}

// ---------------------------------------------------------------------------
// cases (TreatmentPlan = the application's case anchor)
// ---------------------------------------------------------------------------

interface PlanRow {
  id: string; planNumber: string; title: string; status: string
  diagnosis: string | null; chiefComplaint: string | null; consentGiven: boolean
  estimatedCost: { toString(): string } | null
  appointmentId: string | null
  doctor: { firstName: string; lastName: string } | null
  createdAt: Date
  items: {
    id: string; procedureId: string; toothNumbers: string | null
    priority: number; status: string; estimatedCost: { toString(): string } | null
    procedure: { name: string }
  }[]
}

function caseView(r: PlanRow, scope: FieldScope, budget: SectionBudget) {
  const operational = scope === 'operational' || scope === 'billing'
  return {
    planNumber: r.planNumber,
    title: r.title,
    status: r.status,
    diagnosis: operational ? null : truncateText(r.diagnosis, budget.maxTextChars),
    chiefComplaint: operational ? null : truncateText(r.chiefComplaint, budget.maxTextChars),
    consentGiven: r.consentGiven,
    estimatedCost: r.estimatedCost ? Number(r.estimatedCost.toString()) : null,
    doctor: r.doctor ? `${r.doctor.firstName} ${r.doctor.lastName}` : null,
    items: (r.items ?? []).map((it) => ({
      procedure: it.procedure?.name ?? 'Unknown',
      teeth: sortFdi(parseToothNumbers(it.toothNumbers)),
      toothSource: 'confirmed' as const,
      priority: it.priority,
      status: it.status,
      estimatedCost: it.estimatedCost ? Number(it.estimatedCost.toString()) : null,
    })),
    teeth: sortFdi([...new Set((r.items ?? []).flatMap((it) => parseToothNumbers(it.toothNumbers)))]),
    provenance: makeProvenance({
      sourceType: 'treatment_plan', sourceId: r.id,
      entityType: 'TreatmentPlan', entityId: r.id, timestamp: r.createdAt,
    }),
  }
}

export interface CasesBuild {
  data: { plans: any[] }
  latest: Date | string | null
  planRows: PlanRow[]
}

export async function buildCases(a: BuildArgs, scope: FieldScope): Promise<CasesBuild> {
  const where: Record<string, unknown> = { hospitalId: a.hospitalId, patientId: a.patientId }
  if (a.scope.caseId) where.id = a.scope.caseId // tenant+patient re-validated here
  const rows: PlanRow[] = await a.client.treatmentPlan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: a.budget.maxRecords,
    include: {
      items: { include: { procedure: { select: { name: true } } } },
      doctor: { select: { firstName: true, lastName: true } },
    },
  })
  const latest = newestTimestamp(rows, (r) => r.createdAt)
  return { data: { plans: rows.map((r) => caseView(r, scope, a.budget)) }, latest, planRows: rows }
}

// ---------------------------------------------------------------------------
// treatments
// ---------------------------------------------------------------------------

interface TreatmentRow {
  id: string; treatmentNo: string; status: string; toothNumbers: string | null
  diagnosis: string | null; findings: string | null; chiefComplaint: string | null
  procedureNotes: string | null; complications: string | null
  startTime: Date | null; endTime: Date | null; createdAt: Date
  followUpRequired: boolean; followUpDate: Date | null; followUpNotes: string | null
  procedure: { name: string }
  doctor: { firstName: string; lastName: string } | null
  appointmentId: string | null
}

function treatmentView(r: TreatmentRow, scope: FieldScope, budget: SectionBudget, caseIdByAppointment: Map<string, string>) {
  const operational = scope === 'operational'
  const billing = scope === 'billing'
  return {
    treatmentNo: r.treatmentNo,
    procedure: r.procedure?.name ?? 'Unknown',
    status: r.status,
    caseId: r.appointmentId ? (caseIdByAppointment.get(r.appointmentId) ?? null) : null,
    teeth: sortFdi(parseToothNumbers(r.toothNumbers)),
    toothSource: 'confirmed' as const,
    diagnosis: operational || billing ? null : truncateText(r.diagnosis, budget.maxTextChars),
    findings: operational || billing ? null : truncateText(r.findings, budget.maxTextChars),
    chiefComplaint: operational || billing ? null : truncateText(r.chiefComplaint, budget.maxTextChars),
    startedAt: r.startTime ? new Date(r.startTime).toISOString() : null,
    endedAt: r.endTime ? new Date(r.endTime).toISOString() : null,
    doctor: r.doctor ? `${r.doctor.firstName} ${r.doctor.lastName}` : null,
    followUp: {
      required: r.followUpRequired,
      date: r.followUpDate ? new Date(r.followUpDate).toISOString() : null,
      notes: billing ? null : truncateText(r.followUpNotes, budget.maxTextChars),
    },
    complications: operational || billing ? null : truncateText(r.complications, budget.maxTextChars),
    provenance: makeProvenance({
      sourceType: 'treatment', sourceId: r.id,
      entityType: 'Treatment', entityId: r.id, timestamp: r.startTime ?? r.createdAt,
    }),
  }
}

export interface TreatmentsBuild {
  data: { treatments: any[] }
  latest: Date | string | null
  treatmentRows: TreatmentRow[]
}

export async function buildTreatments(a: BuildArgs, scope: FieldScope, caseIdByAppointment: Map<string, string>): Promise<TreatmentsBuild> {
  const where: Record<string, unknown> = { hospitalId: a.hospitalId, patientId: a.patientId }
  if (a.scope.treatmentNo) where.treatmentNo = a.scope.treatmentNo
  const rows: TreatmentRow[] = await a.client.treatment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: a.budget.maxRecords * 2,
    include: {
      procedure: { select: { name: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
  })
  let kept = rows
  if (a.scope.toothFdi !== null) {
    const fdi = a.scope.toothFdi
    kept = rows.filter((r) => parseToothNumbers(r.toothNumbers).includes(fdi))
  }
  const windowStart = a.budget.windowDays
    ? new Date(a.now.getTime() - a.budget.windowDays * 86400000)
    : null
  if (windowStart) kept = kept.filter((r) => new Date(r.startTime ?? r.createdAt) >= windowStart)
  kept = kept.slice(0, a.budget.maxRecords)
  const latest = newestTimestamp(kept, (r) => r.startTime ?? r.createdAt)
  return {
    data: { treatments: kept.map((r) => treatmentView(r, scope, a.budget, caseIdByAppointment)) },
    latest,
    treatmentRows: kept,
  }
}

// ---------------------------------------------------------------------------
// prescriptions
// ---------------------------------------------------------------------------

interface RxRow {
  id: string; prescriptionNo: string; status: string; diagnosis: string | null
  issuedAt: Date | null; validUntil: Date | null; createdAt: Date
  doctor: { firstName: string; lastName: string } | null
  medications: { medicationId: string; dosage: string | null; frequency: string | null; duration: string | null; medication: { name: string } }[]
}

export async function buildPrescriptions(a: BuildArgs) {
  const where: Record<string, unknown> = { hospitalId: a.hospitalId, patientId: a.patientId }
  if (a.budget.windowDays) {
    where.createdAt = { gte: new Date(a.now.getTime() - a.budget.windowDays * 86400000) }
  }
  const rows: RxRow[] = await a.client.prescription.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: a.budget.maxRecords,
    include: {
      medications: { include: { medication: { select: { name: true } } } },
      doctor: { select: { firstName: true, lastName: true } },
    },
  })
  const latest = newestTimestamp(rows, (r) => r.issuedAt ?? r.createdAt)
  return {
    data: {
      prescriptions: rows.map((r) => ({
        prescriptionNo: r.prescriptionNo,
        status: r.status,
        diagnosis: truncateText(r.diagnosis, a.budget.maxTextChars),
        issuedAt: r.issuedAt ? new Date(r.issuedAt).toISOString() : null,
        validUntil: r.validUntil ? new Date(r.validUntil).toISOString() : null,
        medications: (r.medications ?? []).map((m) => ({
          name: m.medication?.name ?? 'Unknown',
          dosage: m.dosage,
          frequency: m.frequency,
          duration: m.duration,
        })),
        doctor: r.doctor ? `${r.doctor.firstName} ${r.doctor.lastName}` : null,
        provenance: makeProvenance({
          sourceType: 'prescription', sourceId: r.id,
          entityType: 'Prescription', entityId: r.id, timestamp: r.issuedAt ?? r.createdAt,
        }),
      })),
    },
    latest,
  }
}

// ---------------------------------------------------------------------------
// imaging (studies + AI analyses — model findings, with review state)
// ---------------------------------------------------------------------------

export interface RawAiFinding {
  condition?: string
  tooth_number?: number | null
  confidence?: number | null
  bounding_box?: { x?: number; y?: number; width?: number; height?: number } | null
  landmark_id?: number
  landmark_name?: string
  score?: number | null
  class_id?: number
  class_name?: string
  point_count?: number
}

/** Classify one raw finding into the normalized view (MODEL_FINDING). */
export function normalizeAiFinding(raw: unknown): AiFindingView {
  const f = (raw ?? {}) as RawAiFinding
  let kind: AiFindingView['kind'] = 'unknown'
  let summary: Record<string, string | number | null> = {}
  if (typeof f.landmark_id === 'number' && f.landmark_name) {
    kind = 'landmark'
    summary = { landmark_id: f.landmark_id, landmark_name: f.landmark_name, score: f.score ?? null }
  } else if (typeof f.class_id === 'number' && f.class_name) {
    kind = 'segment'
    summary = { class_id: f.class_id, class_name: f.class_name, point_count: f.point_count ?? null }
  } else if (f.bounding_box || (f.condition && f.bounding_box !== undefined)) {
    kind = 'box'
    const b = f.bounding_box ?? {}
    summary = {
      condition: f.condition ?? null,
      box: b.x !== undefined ? `${b.x},${b.y},${b.width ?? 0},${b.height ?? 0}` : null,
    }
  } else if (f.condition) {
    kind = 'box'
    summary = { condition: f.condition }
  }
  const toothValid = isValidFdi(f.tooth_number)
  return {
    kind,
    summary,
    confidence: typeof f.confidence === 'number' ? f.confidence : (typeof f.score === 'number' ? f.score : null),
    toothFdi: toothValid ? (f.tooth_number as number) : null,
    toothLink: toothValid ? 'confirmed' : 'unknown',
    category: 'MODEL_FINDING',
  }
}

interface JobRow {
  id: string; engine: string; status: string; modelVersion: string | null
  modelChecksum: string | null; orchestratorVersion: string | null
  completedAt: Date | null; createdAt: Date
  findings: unknown[] | null; confidence: number | null
  reviewedById: string | null; reviewedAt: Date | null; reviewDecision: string | null
  acceptedFindings: unknown[] | null
  reviewedBy: { firstName: string; lastName: string } | null
}

interface StudyRow {
  id: string; studyType: string; modality: string; studyDate: Date | null
  status: string; description: string | null; createdAt: Date
  appointmentId: string | null
  appointment: { appointmentNo: string } | null
  uploadedBy: { firstName: string; lastName: string } | null
  aiJobs: JobRow[]
}

function jobView(j: JobRow, maxFindings: number, toothFdi: number | null): AiAnalysisView {
  const raw: unknown[] = Array.isArray(j.findings) ? j.findings : []
  let findings = raw.map(normalizeAiFinding)
  if (toothFdi !== null) {
    // Tooth scope: only CONFIRMED links to this tooth (unknown ≠ confirmed).
    findings = findings.filter((f) => f.toothLink === 'confirmed' && f.toothFdi === toothFdi)
  }
  findings = findings.slice(0, maxFindings)
  const findingsCount = raw.length
  return {
    jobId: j.id,
    engine: j.engine,
    status: j.status,
    modelVersion: j.modelVersion,
    modelChecksum: j.modelChecksum,
    orchestratorVersion: j.orchestratorVersion,
    completedAt: j.completedAt ? new Date(j.completedAt).toISOString() : null,
    findings,
    findingCount: findingsCount,
    review: j.reviewDecision
      ? {
          decision: j.reviewDecision,
          reviewedAt: j.reviewedAt ? new Date(j.reviewedAt).toISOString() : null,
          reviewerName: j.reviewedBy ? `${j.reviewedBy.firstName} ${j.reviewedBy.lastName}` : null,
          acceptedCount: Array.isArray(j.acceptedFindings) ? j.acceptedFindings.length : null,
        }
      : null,
    provenance: makeProvenance({
      sourceType: 'ai_job', sourceId: j.id,
      entityType: 'AIAnalysisJob', entityId: j.id, timestamp: j.completedAt ?? j.createdAt,
    }),
  }
}

export interface ImagingBuild {
  data: { studies: any[] }
  latest: Date | string | null
}

export async function buildImaging(a: BuildArgs): Promise<ImagingBuild> {
  const where: Record<string, unknown> = { hospitalId: a.hospitalId, patientId: a.patientId }
  if (a.scope.studyId) where.id = a.scope.studyId
  const rows: StudyRow[] = await a.client.imagingStudy.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: a.budget.maxRecords,
    include: {
      aiJobs: {
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      },
      appointment: { select: { appointmentNo: true } },
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  })
  const maxFindings = 8
  let studies = rows
    .map((s) => ({
      studyId: s.id,
      modality: s.modality,
      studyType: s.studyType,
      studyDate: s.studyDate ? new Date(s.studyDate).toISOString() : null,
      status: s.status,
      description: truncateText(s.description, a.budget.maxTextChars),
      appointmentNo: s.appointment?.appointmentNo ?? null,
      uploadedByName: s.uploadedBy ? `${s.uploadedBy.firstName} ${s.uploadedBy.lastName}` : null,
      analyses: (s.aiJobs ?? []).map((j) => jobView(j, maxFindings, a.scope.toothFdi)),
      provenance: makeProvenance({
        sourceType: 'imaging_study', sourceId: s.id,
        entityType: 'ImagingStudy', entityId: s.id, timestamp: s.studyDate ?? s.createdAt,
      }),
    }))
    .filter((s) => s.analyses.length > 0 || a.scope.toothFdi === null) // tooth scope: keep only linked studies
  studies = studies.slice(0, a.budget.maxRecords)
  const latest = newestTimestamp(rows, (r) => r.studyDate ?? r.createdAt)
  return { data: { studies }, latest }
}

// ---------------------------------------------------------------------------
// financial (bounded; role-gated at the service)
// ---------------------------------------------------------------------------

export async function buildFinancial(a: BuildArgs) {
  const where = {
    hospitalId: a.hospitalId,
    patientId: a.patientId,
    status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
  }
  const agg = await a.client.invoice.aggregate({ where, _sum: { balanceAmount: true } })
  const rows: { id: string; invoiceNo: string; balanceAmount: { toString(): string }; status: string; createdAt: Date }[] =
    await a.client.invoice.findMany({
      where, orderBy: { createdAt: 'desc' }, take: a.budget.maxRecords,
    })
  return {
    data: {
      openBalance: Number(agg?._sum?.balanceAmount ?? 0),
      openInvoices: rows.map((r) => ({
        invoiceNo: r.invoiceNo,
        balance: Number(r.balanceAmount.toString()),
        status: r.status,
      })),
      provenance: makeProvenance({
        sourceType: 'invoice', sourceId: 'patient-invoices',
        entityType: 'Invoice', entityId: a.patientId, timestamp: rows[0]?.createdAt ?? a.now,
      }),
    },
    latest: rows[0]?.createdAt ?? null,
  }
}

// ---------------------------------------------------------------------------
// risk (model-derived)
// ---------------------------------------------------------------------------

export async function buildRisk(a: BuildArgs) {
  const row = await a.client.patientRiskScore.findFirst({
    where: { hospitalId: a.hospitalId, patientId: a.patientId },
    orderBy: { calculatedAt: 'desc' },
  })
  if (!row) return { data: null, latest: null }
  return {
    data: {
      overallScore: row.overallScore,
      factors: (row.factors as Record<string, unknown>) ?? {},
      contraindications: (row.contraindications as Record<string, unknown> | null) ?? null,
      calculatedAt: new Date(row.calculatedAt).toISOString(),
      category: 'MODEL_FINDING' as const,
      provenance: makeProvenance({
        sourceType: 'risk_score', sourceId: row.id,
        entityType: 'PatientRiskScore', entityId: row.id, timestamp: row.calculatedAt,
      }),
    },
    latest: row.calculatedAt,
  }
}

// ---------------------------------------------------------------------------
// timeline (assembled from already-fetched rows — zero extra queries)
// ---------------------------------------------------------------------------

export interface TimelineInputs {
  appointments?: any[] // AppointmentView-like rows
  dental?: { active: any[]; history: any[] }
  clinical?: ClinicalBuild['data']
  cases?: any[]
  treatments?: any[]
  prescriptions?: any[]
  imaging?: any[]
}

const TYPE_ORDER: Record<string, number> = {
  FINDING: 0, DIAGNOSIS: 1, TREATMENT: 2, IMAGING: 3, AI_ANALYSIS: 4,
  EXAMINATION: 5, PRESCRIPTION: 6, APPOINTMENT: 7, FOLLOW_UP: 8, OUTCOME: 9,
}

/**
 * Unified clinical timeline: deterministic ordering (timestamp desc, then
 * type priority, then eventId), deduplicated by eventId, bounded.
 */
export function buildTimeline(inputs: TimelineInputs, budget: SectionBudget): {
  data: { events: TimelineEvent[]; eventCount: number; truncated: boolean }
  latest: Date | string | null
} {
  const events: TimelineEvent[] = []
  const push = (e: Omit<TimelineEvent, 'provenance'> & { provenance: Provenance }) => events.push(e)

  for (const a of inputs.appointments ?? []) {
    push({
      eventId: `APPOINTMENT:${a.provenance.sourceId}`,
      timestamp: a.scheduledAt,
      type: a.status === 'COMPLETED' ? 'OUTCOME' : 'APPOINTMENT',
      toothFdi: null,
      caseId: null,
      summary: `${a.status} ${a.type} appointment ${a.appointmentNo}`,
      category: a.category,
      significance: a.status === 'COMPLETED' ? 'normal' : 'low',
      provenance: a.provenance,
    })
  }
  for (const t of [...(inputs.dental?.active ?? []), ...(inputs.dental?.history ?? [])]) {
    push({
      eventId: `FINDING:${t.provenance.sourceId}`,
      timestamp: t.diagnosedAt,
      type: 'FINDING',
      toothFdi: t.toothFdi,
      caseId: null,
      summary: `Tooth ${t.toothFdi} (${t.toothName}): ${t.condition}${t.resolvedAt ? ' [resolved]' : ''}`,
      category: FACT.clinicalFact,
      significance: t.severity === 'SEVERE' ? 'high' : 'normal',
      provenance: t.provenance,
    })
  }
  for (const n of [...(inputs.clinical?.examinations ?? []), ...(inputs.clinical?.followUpNotes ?? [])]) {
    push({
      eventId: `${n.noteType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'EXAMINATION'}:${n.provenance.sourceId}`,
      timestamp: n.createdAt,
      type: n.noteType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'EXAMINATION',
      toothFdi: null,
      caseId: null,
      summary: n.noteType === 'FOLLOW_UP'
        ? `Follow-up note: ${truncateText(n.content, 80)}`
        : `Examination note: ${truncateText(n.content, 80)}`,
      category: FACT.clinicalFact,
      significance: 'normal',
      provenance: n.provenance,
    })
  }
  for (const t of inputs.treatments ?? []) {
    const tooth = t.teeth.length === 1 ? t.teeth[0] : null
    push({
      eventId: `TREATMENT:${t.provenance.sourceId}`,
      timestamp: t.startedAt ?? t.provenance.timestamp!,
      type: 'TREATMENT',
      toothFdi: tooth,
      caseId: t.caseId ?? null,
      summary: `${t.status} ${t.procedure} (${t.treatmentNo})${tooth ? ` — tooth ${tooth}` : ''}`,
      category: FACT.clinicalFact,
      significance: t.status === 'COMPLETED' ? 'normal' : 'high',
      provenance: t.provenance,
    })
    if (t.diagnosis) {
      push({
        eventId: `DIAGNOSIS:${t.provenance.sourceId}`,
        timestamp: t.startedAt ?? t.provenance.timestamp!,
        type: 'DIAGNOSIS',
        toothFdi: tooth,
        caseId: null,
        summary: `Diagnosis recorded: ${truncateText(t.diagnosis, 100)}`,
        category: FACT.clinicalFact,
        significance: 'high',
        provenance: t.provenance,
      })
    }
    if (t.followUp.required) {
      push({
        eventId: `FOLLOW_UP:${t.provenance.sourceId}`,
        timestamp: t.followUp.date ?? t.startedAt ?? t.provenance.timestamp!,
        type: 'FOLLOW_UP',
        toothFdi: tooth,
        caseId: null,
        summary: `Follow-up required for ${t.treatmentNo}${t.followUp.date ? ` on ${t.followUp.date.slice(0, 10)}` : ''}`,
        category: FACT.clinicalFact,
        significance: 'high',
        provenance: t.provenance,
      })
    }
  }
  for (const p of inputs.prescriptions ?? []) {
    push({
      eventId: `PRESCRIPTION:${p.provenance.sourceId}`,
      timestamp: p.issuedAt ?? p.provenance.timestamp!,
      type: 'PRESCRIPTION',
      toothFdi: null,
      caseId: null,
      summary: `Prescription ${p.prescriptionNo} (${p.status})`,
      category: FACT.clinicalFact,
      significance: 'normal',
      provenance: p.provenance,
    })
  }
  for (const s of inputs.imaging ?? []) {
    push({
      eventId: `IMAGING:${s.provenance.sourceId}`,
      timestamp: s.provenance.timestamp!,
      type: 'IMAGING',
      toothFdi: null,
      caseId: null,
      summary: `${s.modality} imaging study (${s.status})${s.appointmentNo ? ` — ${s.appointmentNo}` : ''}`,
      category: FACT.systemEvent,
      significance: 'normal',
      provenance: s.provenance,
    })
    for (const j of s.analyses) {
      push({
        eventId: `AI_ANALYSIS:${j.provenance.sourceId}`,
        timestamp: j.completedAt ?? j.provenance.timestamp!,
        type: 'AI_ANALYSIS',
        toothFdi: null,
        caseId: null,
        summary: `AI analysis ${j.engine} (${j.status}): ${j.findingCount} findings${j.review ? `, review: ${j.review.decision}` : ''}`,
        category: FACT.modelFinding,
        significance: j.review?.decision === 'REJECTED' ? 'low' : 'normal',
        provenance: j.provenance,
      })
    }
  }

  // Deterministic ordering + dedupe (defensive; eventIds are unique by construction).
  const seen = new Set<string>()
  const deduped = events.filter((e) => (seen.has(e.eventId) ? false : (seen.add(e.eventId), true)))
  deduped.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    if (tb !== ta) return tb - ta // newest first
    const oa = TYPE_ORDER[a.type] ?? 99
    const ob = TYPE_ORDER[b.type] ?? 99
    if (oa !== ob) return oa - ob
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0
  })
  const truncated = deduped.length > budget.maxRecords
  const kept = deduped.slice(0, budget.maxRecords)
  const latest = kept[0]?.timestamp ?? null
  return { data: { events: kept, eventCount: deduped.length, truncated }, latest }
}

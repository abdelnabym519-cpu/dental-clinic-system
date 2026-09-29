/**
 * Phase 2 — Patient 360 / Clinical Context Engine.
 *
 * Strongly-typed contract for the structured Clinical Context. This is the
 * PRIMARY data representation (structured), not a prompt string — prompt
 * serialization happens later in `serialize.ts`. Callers cannot inject
 * arbitrary fields: the context is only ever produced by the builders, and
 * the final object is validated against the contract (`contract.ts`) before
 * it may reach the AI layer (§36).
 *
 * Design rules implemented here:
 *  - missing data is EXPLICIT (SectionStatus 'missing'), never fabricated;
 *  - clinical facts are separated from model findings (FactCategory);
 *  - every fact carries provenance (sourceType/sourceId/...);
 *  - inferred links (e.g. a note that merely mentions a tooth number) are
 *    marked `inferred: true` and never presented as confirmed;
 *  - freshness is per-section and explicit (fresh/recent/historical/unknown).
 */

// ---------------------------------------------------------------------------
// Profiles & budgets
// ---------------------------------------------------------------------------

export const CONTEXT_PROFILES = [
  'MINIMAL',
  'PATIENT_OVERVIEW',
  'CLINICAL',
  'TOOTH',
  'CASE',
  'IMAGING',
  'TREATMENT',
  'FOLLOW_UP',
  'TIMELINE',
  'FULL_360',
] as const
export type ContextProfile = (typeof CONTEXT_PROFILES)[number]

export type ContextSectionKey =
  | 'identity'
  | 'medical'
  | 'dental'
  | 'appointments'
  | 'clinical'
  | 'cases'
  | 'treatments'
  | 'prescriptions'
  | 'imaging'
  | 'financial'
  | 'risk'
  | 'timeline'

export type SectionStatus = 'included' | 'missing' | 'excluded'
export type ExclusionReason = 'not_in_profile' | 'not_permitted' | 'patient_not_found'

export type Freshness = 'fresh' | 'recent' | 'historical' | 'unknown'

/**
 * Fact categories — NEVER merged (§22):
 *  - CLINICAL_FACT: doctor/staff recorded in the clinical record
 *  - MODEL_FINDING: produced by an AI engine or model
 *  - CLINICAL_INTERPRETATION: model-generated explanation of clinical meaning
 *  - PATIENT_REPORTED: patient-intake content (chief complaints, intake history)
 *  - SYSTEM_EVENT: workflow state (appointments, review decisions, statuses)
 */
export const FACT_CATEGORIES = [
  'CLINICAL_FACT',
  'MODEL_FINDING',
  'CLINICAL_INTERPRETATION',
  'PATIENT_REPORTED',
  'SYSTEM_EVENT',
] as const
export type FactCategory = (typeof FACT_CATEGORIES)[number]

export interface Provenance {
  sourceType: 'patient' | 'medical_history' | 'dental_chart' | 'appointment' | 'clinical_note'
    | 'treatment_plan' | 'treatment' | 'prescription' | 'imaging_study' | 'ai_job'
    | 'invoice' | 'risk_score'
  sourceId: string
  entityType: string
  entityId: string
  timestamp: string | null
  /** Staff/Patient user id of the actor, when known. */
  actor?: string | null
}

export interface ContextSection<T> {
  status: SectionStatus
  /** Present only when status = 'included'. Missing => no data, full stop. */
  data?: T
  /** Present when status !== 'included'. */
  reason?: ExclusionReason
  freshness: Freshness
}

// ---------------------------------------------------------------------------
// Section payloads
// ---------------------------------------------------------------------------

export interface IdentityContext {
  patientId: string
  name: string
  age: number | null
  dateOfBirth: string | null
  gender: string | null
  bloodGroup: string | null
  /** Contact details — role-gated (omitted for roles without access). */
  contact?: { phone: string; alternatePhone: string | null; email: string | null }
  locale: string | null
  patientSince: string
}

export interface MedicalContext {
  /** Each flag: { flag, category: PATIENT_REPORTED, provenance }. */
  allergies: { drug: string | null; food: string | null; material: string | null }
  conditions: string[]
  currentMedications: string | null
  previousDentalWork: string | null
  smokingStatus: string
  pregnancy: { isPregnant: boolean; weeks: number | null }
  alerts: string[]
  provenance: Provenance
}

export interface ToothChartEntryView {
  toothFdi: number
  toothName: string
  condition: string
  severity: string
  surfaces: { mesial: boolean; distal: boolean; occlusal: boolean; buccal: boolean; lingual: boolean }
  notes: string | null
  diagnosedAt: string
  resolvedAt: string | null
  active: boolean
  provenance: Provenance
}

export interface DentalContext {
  /** Active (latest unresolved-or-latest) entry per tooth. */
  active: ToothChartEntryView[]
  /** Resolved/older entries, newest first, bounded. */
  history: ToothChartEntryView[]
  toothCount: number
  conditionSummary: Record<string, number>
}

export interface AppointmentView {
  appointmentNo: string
  type: string
  status: string
  scheduledAt: string
  chiefComplaint: string | null
  category: FactCategory
  provenance: Provenance
}

export interface AppointmentsContext {
  upcoming: AppointmentView[]
  recent: AppointmentView[]
  cancelled: AppointmentView[]
  missed: AppointmentView[]
}

export interface NoteView {
  noteType: string
  content: string
  isPrivate: boolean
  createdAt: string
  doctorName: string | null
  provenance: Provenance
}

export interface ClinicalContextSection {
  notes: NoteView[]
  examinations: NoteView[]
  followUpNotes: NoteView[]
  complaints: { text: string | null; from: 'appointment' | 'treatment' | 'treatment_plan'; at: string }[]
}

export interface PlanItemView {
  procedure: string
  teeth: number[]
  toothSource: 'confirmed'
  priority: number
  status: string
  estimatedCost: number | null
}

export interface CaseView {
  planNumber: string
  title: string
  status: string
  diagnosis: string | null
  chiefComplaint: string | null
  consentGiven: boolean
  estimatedCost: number | null
  doctor: string | null
  items: PlanItemView[]
  teeth: number[]
  provenance: Provenance
}

export interface CasesContext {
  plans: CaseView[]
}

export interface TreatmentView {
  treatmentNo: string
  procedure: string
  status: string
  /** Case link ONLY via the shared appointmentId (confirmed); null = none. */
  caseId: string | null
  teeth: number[]
  toothSource: 'confirmed'
  diagnosis: string | null
  findings: string | null
  chiefComplaint: string | null
  startedAt: string | null
  endedAt: string | null
  doctor: string | null
  followUp: { required: boolean; date: string | null; notes: string | null }
  complications: string | null
  provenance: Provenance
}

export interface TreatmentsContext {
  treatments: TreatmentView[]
}

export interface PrescriptionView {
  prescriptionNo: string
  status: string
  diagnosis: string | null
  issuedAt: string | null
  validUntil: string | null
  medications: { name: string; dosage: string | null; frequency: string | null; duration: string | null }[]
  doctor: string | null
  provenance: Provenance
}

export interface PrescriptionsContext {
  prescriptions: PrescriptionView[]
}

export type ImagingFindingKind = 'box' | 'landmark' | 'segment' | 'unknown'

export interface AiFindingView {
  kind: ImagingFindingKind
  /** Safe, structured summary of the finding (no raw payloads beyond bounds). */
  summary: Record<string, string | number | null>
  confidence: number | null
  /** Confirmed FDI link when the engine reported a valid tooth number. */
  toothFdi: number | null
  toothLink: 'confirmed' | 'unknown'
  category: 'MODEL_FINDING'
}

export interface AiAnalysisView {
  jobId: string
  engine: string
  status: string
  modelVersion: string | null
  modelChecksum: string | null
  orchestratorVersion: string | null
  completedAt: string | null
  findings: AiFindingView[]
  findingCount: number
  review: {
    decision: string | null
    reviewedAt: string | null
    reviewerName: string | null
    acceptedCount: number | null
  } | null
  provenance: Provenance
}

export interface ImagingStudyView {
  studyId: string
  modality: string
  studyType: string
  studyDate: string | null
  status: string
  description: string | null
  appointmentNo: string | null
  uploadedByName: string | null
  analyses: AiAnalysisView[]
  provenance: Provenance
}

export interface ImagingContext {
  studies: ImagingStudyView[]
}

export interface FinancialContext {
  openBalance: number
  openInvoices: { invoiceNo: string; balance: number; status: string }[]
  provenance: Provenance
}

export interface RiskContext {
  overallScore: number
  factors: Record<string, unknown>
  contraindications: Record<string, unknown> | null
  calculatedAt: string
  category: 'MODEL_FINDING'
  provenance: Provenance
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const TIMELINE_EVENT_TYPES = [
  'APPOINTMENT',
  'EXAMINATION',
  'FINDING',
  'IMAGING',
  'AI_ANALYSIS',
  'DIAGNOSIS',
  'TREATMENT',
  'PRESCRIPTION',
  'FOLLOW_UP',
  'OUTCOME',
] as const
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number]

export interface TimelineEvent {
  eventId: string
  timestamp: string
  type: TimelineEventType
  /** FDI when the event is tooth-linked (confirmed only). */
  toothFdi: number | null
  caseId: string | null
  summary: string
  category: FactCategory
  significance: 'high' | 'normal' | 'low'
  provenance: Provenance
}

export interface TimelineContext {
  events: TimelineEvent[]
  eventCount: number
  truncated: boolean
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

export interface ContextMeta {
  profile: ContextProfile
  tenantId: string
  patient: {
    found: boolean
    reason: 'ok' | 'not_found' | 'unauthorized' | 'missing_reference'
    id: string | null
    patientId: string | null
    name: string | null
  }
  scope: {
    toothFdi: number | null
    caseId: string | null
    studyId: string | null
    treatmentNo: string | null
  }
  role: string
  generatedAt: string
  excluded: { section: ContextSectionKey; reason: ExclusionReason }[]
  /** Measured DB query count for construction (N+1 guardrail). */
  queryCount: number
  constructionMs: number
}

export interface ClinicalContext {
  meta: ContextMeta
  identity: ContextSection<IdentityContext>
  medical: ContextSection<MedicalContext>
  dental: ContextSection<DentalContext>
  appointments: ContextSection<AppointmentsContext>
  clinical: ContextSection<ClinicalContextSection>
  cases: ContextSection<CasesContext>
  treatments: ContextSection<TreatmentsContext>
  prescriptions: ContextSection<PrescriptionsContext>
  imaging: ContextSection<ImagingContext>
  financial: ContextSection<FinancialContext>
  risk: ContextSection<RiskContext>
  timeline: ContextSection<TimelineContext>
}

/** Request accepted by the service — the ONLY input surface. Callers cannot
 *  attach arbitrary fields to the resulting context (§36). */
export interface ContextRequest {
  hospitalId: string
  actor: { id: string; role: string; name: string }
  profile: ContextProfile
  /** Server-resolved: internal patient id (validated against the tenant). */
  patientId?: string | null
  /** Optional resource scope (all re-validated against the tenant+patient). */
  toothFdi?: number | null
  caseId?: string | null
  studyId?: string | null
  treatmentNo?: string | null
  /** Injectable clock for deterministic freshness in tests. */
  now?: Date
}

/** Serialization result — prompt-safe text + stats. */
export interface SerializedContext {
  text: string
  stats: {
    chars: number
    sections: { key: ContextSectionKey; chars: number; status: SectionStatus }[]
  }
}

/**
 * Phase 2 — Context contract validation (§36).
 *
 * The final ClinicalContext is validated against this schema before it may
 * reach the AI layer. Strict objects reject unknown keys: no caller (and no
 * builder regression) can inject arbitrary fields into the AI context.
 * Missing data must surface as an explicit 'missing'/'excluded' section —
 * the schema enforces that sections are never half-present.
 */

import { z } from 'zod'

const PROVENANCE = z.object({
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  timestamp: z.string().nullable(),
  actor: z.string().nullable().optional(),
}).strict()

const FRESHNESS = z.enum(['fresh', 'recent', 'historical', 'unknown'])
const STATUS = z.enum(['included', 'missing', 'excluded'])
const REASON = z.enum(['not_in_profile', 'not_permitted', 'patient_not_found'])
const FACT_CATEGORY = z.enum(['CLINICAL_FACT', 'MODEL_FINDING', 'CLINICAL_INTERPRETATION', 'PATIENT_REPORTED', 'SYSTEM_EVENT'])

export const sectionSchema = <T extends z.ZodTypeAny>(payload: T) =>
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('included'), data: payload, freshness: FRESHNESS }).strict(),
    z.object({ status: z.literal('missing'), freshness: FRESHNESS }).strict(),
    z.object({ status: z.literal('excluded'), reason: REASON, freshness: FRESHNESS }).strict(),
  ])

const toothSurfaces = z.object({
  mesial: z.boolean(), distal: z.boolean(), occlusal: z.boolean(),
  buccal: z.boolean(), lingual: z.boolean(),
}).strict()

const APPOINTMENT_ITEM = z.object({
  appointmentNo: z.string(),
  type: z.string(),
  status: z.string(),
  scheduledAt: z.string(),
  chiefComplaint: z.string().nullable(),
  category: FACT_CATEGORY,
  provenance: PROVENANCE,
}).strict()

const NOTE_ITEM = z.object({
  noteType: z.string(),
  content: z.string(),
  isPrivate: z.boolean(),
  createdAt: z.string(),
  doctorName: z.string().nullable(),
  provenance: PROVENANCE,
}).strict()

const toothEntry = z.object({
  toothFdi: z.number().int().min(11).max(48),
  toothName: z.string(),
  condition: z.string(),
  severity: z.enum(['MILD', 'MODERATE', 'SEVERE']),
  surfaces: toothSurfaces,
  notes: z.string().nullable(),
  diagnosedAt: z.string(),
  resolvedAt: z.string().nullable(),
  active: z.boolean(),
  provenance: PROVENANCE,
}).strict()

export const CONTEXT_CONTRACT = z.object({
  meta: z.object({
    profile: z.enum(['MINIMAL', 'PATIENT_OVERVIEW', 'CLINICAL', 'TOOTH', 'CASE', 'IMAGING', 'TREATMENT', 'FOLLOW_UP', 'TIMELINE', 'FULL_360']),
    tenantId: z.string().min(1),
    patient: z.object({
      found: z.boolean(),
      reason: z.enum(['ok', 'not_found', 'unauthorized', 'missing_reference']),
      id: z.string().nullable(),
      patientId: z.string().nullable(),
      name: z.string().nullable(),
    }).strict(),
    scope: z.object({
      toothFdi: z.number().int().min(11).max(48).nullable(),
      caseId: z.string().nullable(),
      studyId: z.string().nullable(),
      treatmentNo: z.string().nullable(),
    }).strict(),
    role: z.string().min(1),
    generatedAt: z.string(),
    excluded: z.array(z.object({ section: z.string(), reason: REASON }).strict()),
    queryCount: z.number().int().nonnegative(),
    constructionMs: z.number().nonnegative(),
  }).strict(),

  identity: sectionSchema(z.object({
    patientId: z.string(),
    name: z.string(),
    age: z.number().int().nullable(),
    dateOfBirth: z.string().nullable(),
    gender: z.string().nullable(),
    bloodGroup: z.string().nullable(),
    contact: z.object({ phone: z.string(), alternatePhone: z.string().nullable(), email: z.string().nullable() }).strict().optional(),
    locale: z.string().nullable(),
    patientSince: z.string(),
  }).strict()),

  medical: sectionSchema(z.object({
    allergies: z.object({ drug: z.string().nullable(), food: z.string().nullable(), material: z.string().nullable() }).strict(),
    conditions: z.array(z.string()),
    currentMedications: z.string().nullable(),
    previousDentalWork: z.string().nullable(),
    smokingStatus: z.string(),
    pregnancy: z.object({ isPregnant: z.boolean(), weeks: z.number().int().nullable() }).strict(),
    alerts: z.array(z.string()),
    provenance: PROVENANCE,
  }).strict()),

  dental: sectionSchema(z.object({
    active: z.array(toothEntry),
    history: z.array(toothEntry),
    toothCount: z.number().int().nonnegative(),
    conditionSummary: z.record(z.string(), z.number().int().nonnegative()),
  }).strict()),

  appointments: sectionSchema(z.object({
    upcoming: z.array(APPOINTMENT_ITEM),
    recent: z.array(APPOINTMENT_ITEM),
    cancelled: z.array(APPOINTMENT_ITEM),
    missed: z.array(APPOINTMENT_ITEM),
  }).strict()),

  clinical: sectionSchema(z.object({
    notes: z.array(NOTE_ITEM),
    examinations: z.array(NOTE_ITEM),
    followUpNotes: z.array(NOTE_ITEM),
    complaints: z.array(z.object({
      text: z.string().nullable(),
      from: z.enum(['appointment', 'treatment', 'treatment_plan']),
      at: z.string(),
    }).strict()),
  }).strict()),

  cases: sectionSchema(z.object({
    plans: z.array(z.object({
      planNumber: z.string(),
      title: z.string(),
      status: z.string(),
      diagnosis: z.string().nullable(),
      chiefComplaint: z.string().nullable(),
      consentGiven: z.boolean(),
      estimatedCost: z.number().nullable(),
      doctor: z.string().nullable(),
      items: z.array(z.object({
        procedure: z.string(),
        teeth: z.array(z.number().int().min(11).max(48)),
        toothSource: z.literal('confirmed'),
        priority: z.number().int(),
        status: z.string(),
        estimatedCost: z.number().nullable(),
      }).strict()),
      teeth: z.array(z.number().int().min(11).max(48)),
      provenance: PROVENANCE,
    }).strict()),
  }).strict()),

  treatments: sectionSchema(z.object({
    treatments: z.array(z.object({
      treatmentNo: z.string(),
      procedure: z.string(),
      status: z.string(),
      caseId: z.string().nullable(),
      teeth: z.array(z.number().int().min(11).max(48)),
      toothSource: z.literal('confirmed'),
      diagnosis: z.string().nullable(),
      findings: z.string().nullable(),
      chiefComplaint: z.string().nullable(),
      startedAt: z.string().nullable(),
      endedAt: z.string().nullable(),
      doctor: z.string().nullable(),
      followUp: z.object({ required: z.boolean(), date: z.string().nullable(), notes: z.string().nullable() }).strict(),
      complications: z.string().nullable(),
      provenance: PROVENANCE,
    }).strict()),
  }).strict()),

  prescriptions: sectionSchema(z.object({
    prescriptions: z.array(z.object({
      prescriptionNo: z.string(),
      status: z.string(),
      diagnosis: z.string().nullable(),
      issuedAt: z.string().nullable(),
      validUntil: z.string().nullable(),
      medications: z.array(z.object({
        name: z.string(),
        dosage: z.string().nullable(),
        frequency: z.string().nullable(),
        duration: z.string().nullable(),
      }).strict()),
      doctor: z.string().nullable(),
      provenance: PROVENANCE,
    }).strict()),
  }).strict()),

  imaging: sectionSchema(z.object({
    studies: z.array(z.object({
      studyId: z.string(),
      modality: z.string(),
      studyType: z.string(),
      studyDate: z.string().nullable(),
      status: z.string(),
      description: z.string().nullable(),
      appointmentNo: z.string().nullable(),
      uploadedByName: z.string().nullable(),
      analyses: z.array(z.object({
        jobId: z.string(),
        engine: z.string(),
        status: z.string(),
        modelVersion: z.string().nullable(),
        modelChecksum: z.string().nullable(),
        orchestratorVersion: z.string().nullable(),
        completedAt: z.string().nullable(),
        findings: z.array(z.object({
          kind: z.enum(['box', 'landmark', 'segment', 'unknown']),
          summary: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
          confidence: z.number().nullable(),
          toothFdi: z.number().int().min(11).max(48).nullable(),
          toothLink: z.enum(['confirmed', 'unknown']),
          category: z.literal('MODEL_FINDING'),
        }).strict()),
        findingCount: z.number().int().nonnegative(),
        review: z.object({
          decision: z.string().nullable(),
          reviewedAt: z.string().nullable(),
          reviewerName: z.string().nullable(),
          acceptedCount: z.number().int().nullable(),
        }).strict().nullable(),
        provenance: PROVENANCE,
      }).strict()),
      provenance: PROVENANCE,
    }).strict()),
  }).strict()),

  financial: sectionSchema(z.object({
    openBalance: z.number(),
    openInvoices: z.array(z.object({ invoiceNo: z.string(), balance: z.number(), status: z.string() }).strict()),
    provenance: PROVENANCE,
  }).strict()),

  risk: sectionSchema(z.object({
    overallScore: z.number(),
    factors: z.record(z.string(), z.unknown()),
    contraindications: z.record(z.string(), z.unknown()).nullable(),
    calculatedAt: z.string(),
    category: z.literal('MODEL_FINDING'),
    provenance: PROVENANCE,
  }).strict()),

  timeline: sectionSchema(z.object({
    events: z.array(z.object({
      eventId: z.string(),
      timestamp: z.string(),
      type: z.enum(['APPOINTMENT', 'EXAMINATION', 'FINDING', 'IMAGING', 'AI_ANALYSIS', 'DIAGNOSIS', 'TREATMENT', 'PRESCRIPTION', 'FOLLOW_UP', 'OUTCOME']),
      toothFdi: z.number().int().min(11).max(48).nullable(),
      caseId: z.string().nullable(),
      summary: z.string(),
      category: FACT_CATEGORY,
      significance: z.enum(['high', 'normal', 'low']),
      provenance: PROVENANCE,
    }).strict()),
    eventCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict()),
}).strict()

export type ContextContractInput = z.infer<typeof CONTEXT_CONTRACT>

/**
 * Validate the final context before it reaches the AI layer. Throws with a
 * descriptive message on contract violation (a builder bug — never shipped
 * to the model silently).
 */
export function assertContextContract(ctx: unknown): asserts ctx is ContextContractInput {
  const res = CONTEXT_CONTRACT.safeParse(ctx)
  if (!res.success) {
    const issues = res.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`ClinicalContext contract violation: ${issues}`)
  }
}

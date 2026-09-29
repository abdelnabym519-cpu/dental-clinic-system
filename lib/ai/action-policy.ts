/**
 * Action Policy Registry — Phase 1 (AI Guardrails & Action Safety).
 *
 * The single server-side authority for every AI-executable action. The LLM,
 * the client, the intent prompt and the skills are NEVER the authority —
 * every intent resolves through exactly one policy entry here before any
 * executor may run. Unknown actions fail closed (no execution, ever).
 *
 * This file is deliberately side-effect free and dependency free so it can
 * be unit-tested without Prisma, the app or the network.
 *
 * POLICY VERSION: bump POLICY_VERSION whenever a policy changes. The version
 * is part of the approval fingerprint, so an approval granted under an old
 * policy can never execute under a new one.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'READ' | 'WRITE' | 'CLINICAL_WRITE' | 'FINANCIAL' | 'EXTERNAL'

export interface ActionPolicy {
  /** Intent name exactly as produced by the LLM (and accepted by the dispatcher). */
  action: string
  /** Coarse class — informational; riskLevel drives the pipeline behavior. */
  category: 'read' | 'write' | 'clinical' | 'financial' | 'external'
  riskLevel: RiskLevel
  /** RBAC — the actor roles allowed to trigger this action (server-enforced). */
  roles: string[]
  /** Approval must be granted by one of these roles (must differ from requester). */
  approvalRequired: boolean
  approvalRoles: string[]
  /** The action operates on a patient that must be resolved tenant-side. */
  patientScope: boolean
  /** Multi-write logical operation → run inside a Prisma transaction. */
  transactionRequired: boolean
  /** Retries of the same validated request must not double-execute. */
  idempotencyRequired: boolean
  /** Writes an AuditLog row (always true for anything that mutates). */
  auditRequired: boolean
  /**
   * Input validation. Returns a translatable error key when the parameters
   * are malformed, or null when they are acceptable. Runs BEFORE approval,
   * idempotency and execution — malformed input never reaches the DB.
   */
  validate: (params: Record<string, string>) => string | null
  /** Financial hook: extract the EGP amount this action would move (if any). */
  financialAmount?: (params: Record<string, string>) => number | null
}

/** Bump on any policy change — approvals are fingerprint-bound to a version. */
export const POLICY_VERSION = 1

/** Staff roles that may use the assistant's action system at all.
 *  PATIENT (portal) accounts can chat, but the policy layer refuses every
 *  action for them — closing the hole where a portal user's session could
 *  otherwise reach clinic data through the action executors. */
export const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT']

// ---------------------------------------------------------------------------
// Small validation helpers (params arrive as strings from the LLM)
// ---------------------------------------------------------------------------

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const inEnum = (v: unknown, allowed: readonly string[]): boolean =>
  typeof v === 'string' && allowed.includes(v)

function toNumber(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime())
}

/** 'HH:MM' with hour 00-23 and minute 00-59 (regex alone accepts 25:99). */
function isTime(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return false
  return Number(m[1]) <= 23 && Number(m[2]) <= 59
}

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const
const BLOOD_GROUPS = ['A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE'] as const
const APPT_TYPES = ['CONSULTATION', 'PROCEDURE', 'FOLLOW_UP', 'EMERGENCY', 'CHECK_UP'] as const
const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'INSURANCE', 'WALLET', 'ONLINE', 'INSTAPAY', 'FAWRY'] as const
const LAB_WORK_TYPES = ['CROWN', 'BRIDGE', 'DENTURE', 'PARTIAL_DENTURE', 'IMPLANT_CROWN', 'VENEER', 'INLAY_ONLAY', 'NIGHT_GUARD', 'RETAINER', 'ALIGNER', 'MODEL', 'OTHER'] as const
const LAB_STATUSES = ['CREATED', 'SENT_TO_LAB', 'IN_PROGRESS', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'FITTED', 'REMAKE_REQUIRED', 'CANCELLED'] as const
const REVENUE_PERIODS = ['today', 'this_week', 'this_month', 'last_month', 'this_quarter'] as const

/** Dictionary key = user-visible error (both locales carry these). */
const E = {
  required: 'Required field is missing for this action',
  malformedNumber: 'Invalid number in the action parameters',
  invalidEnum: 'Invalid option in the action parameters',
  patientRequired: 'A patient is required for this action',
  patientOrRefRequired: 'Provide a patient or the reference number',
  dateRequired: 'A valid date is required for this action',
  positiveAmount: 'The amount must be a positive number',
  unknownAction: 'This action is not permitted',
} as const

// ---------------------------------------------------------------------------
// The registry — every AI intent, explicitly classified
// ---------------------------------------------------------------------------

const READ: Pick<ActionPolicy, 'category' | 'riskLevel' | 'roles' | 'approvalRequired' | 'approvalRoles' | 'patientScope' | 'transactionRequired' | 'idempotencyRequired' | 'auditRequired'> = {
  category: 'read',
  riskLevel: 'READ',
  roles: [...STAFF_ROLES],
  approvalRequired: false,
  approvalRoles: [],
  patientScope: false,
  transactionRequired: false,
  idempotencyRequired: false,
  auditRequired: false,
}

export const ACTION_POLICIES: Record<string, ActionPolicy> = {
  // ── 🟢 READ (no mutation; auth + RBAC + tenant scope still enforced) ──────
  search_patients: {
    ...READ,
    action: 'search_patients',
    validate: (p) => {
      if (p.minAge !== undefined && toNumber(p.minAge) === null) return E.malformedNumber
      return null
    },
  },
  check_patient: { ...READ, action: 'check_patient', validate: (p) => (nonEmpty(p.query) ? null : E.patientRequired) },
  show_appointments: {
    ...READ,
    action: 'show_appointments',
    validate: (p) => (p.date !== undefined && !isDate(p.date) ? E.invalidEnum : null),
  },
  show_treatments: { ...READ, action: 'show_treatments', validate: () => null },
  show_invoices: { ...READ, action: 'show_invoices', validate: () => null },
  check_overdue: { ...READ, action: 'check_overdue', validate: () => null },
  show_revenue: {
    ...READ,
    action: 'show_revenue',
    validate: (p) => (p.period !== undefined && !inEnum(p.period, REVENUE_PERIODS) ? E.invalidEnum : null),
  },
  check_stock: { ...READ, action: 'check_stock', validate: (p) => (nonEmpty(p.itemName) ? null : E.required) },
  low_stock: { ...READ, action: 'low_stock', validate: () => null },
  show_lab_orders: { ...READ, action: 'show_lab_orders', validate: () => null },
  show_prescriptions: { ...READ, action: 'show_prescriptions', validate: () => null },
  search_medications: { ...READ, action: 'search_medications', validate: () => null },
  show_staff: { ...READ, action: 'show_staff', validate: () => null },
  daily_summary: { ...READ, action: 'daily_summary', validate: () => null },

  // ── 🔴 WRITE — patient management (reception/administrative) ──────────────
  create_patient: {
    ...READ,
    action: 'create_patient',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN', 'RECEPTIONIST'],
    patientScope: true,
    idempotencyRequired: true,
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.firstName) || !nonEmpty(p.lastName) || !nonEmpty(p.phone)) return E.required
      if (p.age !== undefined) {
        const n = toNumber(p.age)
        if (n === null || !Number.isInteger(n) || n < 0 || n > 120) return E.malformedNumber
      }
      if (p.gender !== undefined && !inEnum(p.gender, GENDERS)) return E.invalidEnum
      if (p.bloodGroup !== undefined && !inEnum(p.bloodGroup, BLOOD_GROUPS)) return E.invalidEnum
      if (p.dateOfBirth !== undefined && !isDate(p.dateOfBirth)) return E.invalidEnum
      return null
    },
  },
  update_patient: {
    ...READ,
    action: 'update_patient',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN', 'RECEPTIONIST'],
    patientScope: true,
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.query)) return E.patientRequired
      if (p.age !== undefined && (toNumber(p.age) === null || Number(toNumber(p.age)) < 0 || Number(toNumber(p.age)) > 120)) return E.malformedNumber
      if (p.gender !== undefined && !inEnum(p.gender, GENDERS)) return E.invalidEnum
      if (p.bloodGroup !== undefined && !inEnum(p.bloodGroup, BLOOD_GROUPS)) return E.invalidEnum
      return null
    },
  },

  // ── 🔴 WRITE — appointments (operational) ──────────────────────────────────
  book_appointment: {
    ...READ,
    action: 'book_appointment',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN', 'RECEPTIONIST'],
    patientScope: true,
    idempotencyRequired: true,
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.patientName)) return E.patientRequired
      if (p.date !== undefined && !isDate(p.date)) return E.invalidEnum
      if (p.time !== undefined && !isTime(p.time)) return E.invalidEnum
      if (p.duration !== undefined) {
        const n = toNumber(p.duration)
        if (n === null || !Number.isInteger(n) || n < 5 || n > 480) return E.malformedNumber
      }
      if (p.type !== undefined && !inEnum(p.type, APPT_TYPES)) return E.invalidEnum
      return null
    },
  },
  cancel_appointment: {
    ...READ,
    action: 'cancel_appointment',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN', 'RECEPTIONIST'],
    patientScope: true,
    auditRequired: true,
    validate: (p) => (nonEmpty(p.appointmentNo) || nonEmpty(p.patientName) ? null : E.patientOrRefRequired),
  },
  reschedule_appointment: {
    ...READ,
    action: 'reschedule_appointment',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN', 'RECEPTIONIST'],
    patientScope: true,
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.appointmentNo) && !nonEmpty(p.patientName)) return E.patientOrRefRequired
      if (!nonEmpty(p.newDate) && !nonEmpty(p.newTime)) return E.dateRequired
      if (p.newDate !== undefined && !isDate(p.newDate)) return E.invalidEnum
      if (p.newTime !== undefined && !isTime(p.newTime)) return E.invalidEnum
      return null
    },
  },
  complete_appointment: {
    ...READ,
    action: 'complete_appointment',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN', 'RECEPTIONIST', 'DOCTOR'],
    patientScope: true,
    auditRequired: true,
    validate: (p) => (nonEmpty(p.appointmentNo) || nonEmpty(p.patientName) ? null : E.patientOrRefRequired),
  },

  // ── 🟠 CLINICAL_WRITE — treatments & prescriptions (doctor-gated) ─────────
  // These are clinical records, not financial state: the actor must be the
  // clinician (or admin). Prescriptions persist as DRAFT by model default,
  // so AI output can never become an authoritative signed prescription —
  // the normal sign-off workflow stays in charge (Phase 0 §M).
  create_treatment: {
    ...READ,
    action: 'create_treatment',
    category: 'clinical',
    riskLevel: 'CLINICAL_WRITE',
    roles: ['ADMIN', 'DOCTOR'],
    patientScope: true,
    idempotencyRequired: true,
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.patientName)) return E.patientRequired
      if (!nonEmpty(p.procedureName)) return E.required
      if (p.cost !== undefined && (toNumber(p.cost) === null || Number(toNumber(p.cost)) <= 0)) return E.positiveAmount
      return null
    },
  },
  complete_treatment: {
    ...READ,
    action: 'complete_treatment',
    category: 'clinical',
    riskLevel: 'CLINICAL_WRITE',
    roles: ['ADMIN', 'DOCTOR'],
    patientScope: true,
    auditRequired: true,
    validate: (p) => (nonEmpty(p.treatmentNo) || nonEmpty(p.patientName) ? null : E.patientOrRefRequired),
  },
  create_prescription: {
    ...READ,
    action: 'create_prescription',
    category: 'clinical',
    riskLevel: 'CLINICAL_WRITE',
    roles: ['ADMIN', 'DOCTOR'],
    patientScope: true,
    idempotencyRequired: true,
    auditRequired: true,
    validate: (p) => (nonEmpty(p.patientName) ? null : E.patientRequired),
  },

  // ── 🟠 FINANCIAL — approval-gated (amount + budget enforced server-side) ──
  create_invoice: {
    ...READ,
    action: 'create_invoice',
    category: 'financial',
    riskLevel: 'FINANCIAL',
    roles: ['ADMIN', 'ACCOUNTANT'],
    patientScope: true,
    approvalRequired: true,
    approvalRoles: ['ADMIN'],
    idempotencyRequired: true,
    auditRequired: true,
    transactionRequired: true,
    validate: (p) => (nonEmpty(p.patientName) || nonEmpty(p.query) ? null : E.patientRequired),
    // Amount = sum of unbilled completed treatments + 14% VAT, resolved at
    // request time by the pipeline pre-read (see action-pipeline.ts).
  },
  record_payment: {
    ...READ,
    action: 'record_payment',
    category: 'financial',
    riskLevel: 'FINANCIAL',
    roles: ['ADMIN', 'ACCOUNTANT'],
    patientScope: true,
    // Approval is decided by the financial guardrails (ai_financial_approval_
    // limit / ai_monthly_budget): within both → auto-execute (audited +
    // verified); over either OR settings missing → approval. Missing settings
    // therefore fail closed.
    approvalRequired: false,
    approvalRoles: ['ADMIN'],
    idempotencyRequired: true,
    auditRequired: true,
    transactionRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.invoiceNo) && !nonEmpty(p.patientName)) return E.patientOrRefRequired
      if (p.amount !== undefined && (toNumber(p.amount) === null || Number(toNumber(p.amount)) <= 0)) return E.positiveAmount
      if (p.method !== undefined && !inEnum(p.method, PAYMENT_METHODS)) return E.invalidEnum
      return null
    },
    financialAmount: (p) => (p.amount !== undefined ? toNumber(p.amount) : null), // null = balance (resolved at request time)
  },

  // ── 🔴 WRITE — inventory (admin) ───────────────────────────────────────────
  add_inventory_item: {
    ...READ,
    action: 'add_inventory_item',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN'],
    idempotencyRequired: true,
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.name)) return E.required
      if (p.price !== undefined && (toNumber(p.price) === null || Number(toNumber(p.price)) < 0)) return E.malformedNumber
      if (p.quantity !== undefined && (toNumber(p.quantity) === null || Number(toNumber(p.quantity)) < 0)) return E.malformedNumber
      return null
    },
  },
  update_stock: {
    ...READ,
    action: 'update_stock',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN'],
    idempotencyRequired: true,
    auditRequired: true,
    transactionRequired: true, // stock update + stock transaction row are one operation
    validate: (p) => {
      if (!nonEmpty(p.itemName)) return E.required
      const q = toNumber(p.quantity)
      if (q === null || !Number.isInteger(q) || q <= 0) return E.positiveAmount
      if (p.type !== undefined && !inEnum(p.type, ['add', 'remove'])) return E.invalidEnum
      return null
    },
  },

  // ── 🟠 EXTERNAL — lab orders (commit work to an outside vendor) ───────────
  create_lab_order: {
    ...READ,
    action: 'create_lab_order',
    category: 'external',
    riskLevel: 'EXTERNAL',
    roles: ['ADMIN', 'DOCTOR', 'LAB_TECH'],
    patientScope: true,
    approvalRequired: true,
    approvalRoles: ['ADMIN'],
    idempotencyRequired: true,
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.patientName)) return E.patientRequired
      if (p.workType !== undefined && !inEnum(p.workType, LAB_WORK_TYPES)) return E.invalidEnum
      if (p.cost !== undefined && (toNumber(p.cost) === null || Number(toNumber(p.cost)) < 0)) return E.malformedNumber
      return null
    },
  },
  update_lab_order: {
    ...READ,
    action: 'update_lab_order',
    category: 'write',
    riskLevel: 'WRITE',
    roles: ['ADMIN', 'DOCTOR', 'LAB_TECH'],
    auditRequired: true,
    validate: (p) => {
      if (!nonEmpty(p.orderNumber)) return E.required
      if (p.status !== undefined && !inEnum(p.status, LAB_STATUSES)) return E.invalidEnum
      return null
    },
  },

  // ── 🔴 WRITE — drug catalog (clinical reference data, doctor-gated) ───────
  add_medication: {
    ...READ,
    action: 'add_medication',
    category: 'clinical',
    riskLevel: 'CLINICAL_WRITE',
    roles: ['ADMIN', 'DOCTOR'],
    auditRequired: true,
    validate: (p) => (nonEmpty(p.name) ? null : E.required),
  },
}

// Legacy alias — the intent prompt has used both names historically.
ACTION_POLICIES.generate_invoice = ACTION_POLICIES.create_invoice

/** Resolve a policy. Returns null for unknown actions → fail closed. */
export function resolvePolicy(action: string): ActionPolicy | null {
  return ACTION_POLICIES[action] ?? null
}

/** Every action name the policy registry knows (for completeness tests). */
export function knownActions(): string[] {
  return Object.keys(ACTION_POLICIES)
}

export { E }

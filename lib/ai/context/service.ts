/**
 * Phase 2 — Clinical Context Service (the single reusable entry point).
 *
 *   buildClinicalContext(request) → ClinicalContext (validated, structured)
 *   serializeForPrompt(ctx)       → prompt-safe text (see serialize.ts)
 *
 * Security model (server-side, never prompt-based):
 *   1. Tenant scope — every query is bound to the actor's hospitalId;
 *   2. Patient scope — the patient is resolved by (internal id, hospitalId);
 *      PATIENT-role actors may ONLY resolve their own record
 *      (patient.portalUserId === actor.id);
 *   3. Role policy — sections/fields a role may not see are OMITTED at
 *      retrieval (never fetched-then-hidden);
 *   4. Resource scope — toothFdi/caseId/studyId/treatmentNo are re-validated
 *      against tenant+patient inside each builder;
 *   5. Contract — the final object is validated before it may reach the AI.
 *
 * Read-only: context construction performs NO writes and, like Phase 1 READ
 * actions, creates no audit rows per read (§41).
 */

import { prisma } from '@/lib/prisma'
import {
  type ClinicalContext, type ContextRequest, type ContextSection, type ContextSectionKey,
  type ExclusionReason, type Freshness,
} from './types'
import { PROFILE_DEFINITIONS, budgetFor } from './profiles'
import { canSeeSection, fieldScope } from './permissions'
import { assertContextContract } from './contract'
import { freshnessOf, truncateText } from './provenance'
import {
  buildAppointments, buildCases, buildClinical, buildDental, buildFinancial,
  buildImaging, buildPrescriptions, buildRisk, buildTreatments, buildTimeline,
  buildIdentity, buildMedical, type ResolvedPatient,
} from './builders'

// ---------------------------------------------------------------------------
// Counting client — measures DB calls for the N+1 guardrail (meta.queryCount)
// ---------------------------------------------------------------------------

export function countingClient(real: any, counter: { n: number }): any {
  return new Proxy(real, {
    get(target: any, prop: string) {
      const value = target[prop]
      if (typeof prop !== 'string' || prop.startsWith('$')) return value
      if (!value || typeof value !== 'object') return value
      return new Proxy(value, {
        get(model: any, mprop: string) {
          const fn = model[mprop]
          if (typeof fn === 'function') {
            return (...args: unknown[]) => {
              counter.n++
              return fn.apply(model, args)
            }
          }
          return fn
        },
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Patient resolution
// ---------------------------------------------------------------------------

export type ResolveResult =
  | { ok: true; patient: ResolvedPatient }
  | { ok: false; reason: 'missing_reference' | 'not_found' | 'unauthorized' }

async function resolvePatient(client: any, req: ContextRequest): Promise<ResolveResult> {
  if (!req.patientId) return { ok: false, reason: 'missing_reference' }
  // PATIENT-role actors can only ever resolve their OWN record.
  if (req.actor.role === 'PATIENT') {
    const self = await client.patient.findFirst({
      where: { hospitalId: req.hospitalId, portalUserId: req.actor.id },
    })
    if (!self || self.id !== req.patientId) return { ok: false, reason: 'unauthorized' }
  }
  const patient = await client.patient.findUnique({
    where: { id: req.patientId, hospitalId: req.hospitalId },
    include: { medicalHistory: true },
  })
  if (!patient) return { ok: false, reason: 'not_found' }
  return { ok: true, patient: patient as ResolvedPatient }
}

// ---------------------------------------------------------------------------
// Section assembly
// ---------------------------------------------------------------------------

function excluded(section: ContextSectionKey, reason: ExclusionReason): ContextSection<never> {
  return { status: 'excluded', reason, freshness: 'unknown' } as ContextSection<never>
}

function included<T>(data: T, latest: Date | string | null, now: Date): ContextSection<T> {
  return { status: 'included', data, freshness: freshnessOf(latest, now) }
}

function missing(): ContextSection<never> {
  return { status: 'missing', freshness: 'unknown' } as ContextSection<never>
}

/**
 * The service. `client` is injectable for tests (a prisma-shaped object);
 * production uses the real prisma singleton.
 */
export async function buildClinicalContext(
  req: ContextRequest,
  client: any = prisma
): Promise<ClinicalContext> {
  const startedAt = process.hrtime.bigint()
  const counter = { n: 0 }
  const db = countingClient(client, counter)
  const now = req.now ?? new Date()
  const def = PROFILE_DEFINITIONS[req.profile]
  const sections = new Set<ContextSectionKey>(def.sections)
  const scope = {
    toothFdi: req.toothFdi ?? null,
    caseId: req.caseId ?? null,
    studyId: req.studyId ?? null,
    treatmentNo: req.treatmentNo ?? null,
  }

  const ctx: Record<string, any> = {
    identity: null, medical: null, dental: null, appointments: null,
    clinical: null, cases: null, treatments: null, prescriptions: null,
    imaging: null, financial: null, risk: null, timeline: null,
  }
  const excludedList: { section: ContextSectionKey; reason: ExclusionReason }[] = []
  const mark = (section: ContextSectionKey, s: any) => {
    ctx[section] = s
    if (s?.status === 'excluded') excludedList.push({ section, reason: s.reason })
  }

  // ── Resolve the patient (tenant + role scope) ─────────────────────────
  const resolved = await resolvePatient(db, req)
  if (!resolved.ok) {
    for (const s of Object.keys(ctx) as ContextSectionKey[]) {
      mark(s, excluded(s, 'patient_not_found'))
    }
    const meta = metaOf(req, scope, now, excludedList, counter, startedAt, {
      reason: resolved.reason, id: null, patientId: null, name: null,
    })
    const out = { meta, ...ctx } as ClinicalContext
    assertContextContract(out)
    return out
  }

  const p = resolved.patient
  const role = req.actor.role
  const baseArgs = {
    client: db, hospitalId: req.hospitalId, patientId: p.id,
    role, profile: req.profile, scope, now,
  } as const

  // Case→treatment link, built from the SAME plan rows the cases section
  // shows (shared appointmentId only — the confirmed link; no extra queries,
  // since every profile that includes treatments also includes cases).
  let caseIdByAppointment = new Map<string, string>()

  const buildSection = async (key: ContextSectionKey): Promise<void> => {
    if (!sections.has(key)) return mark(key, excluded(key, 'not_in_profile'))
    if (!canSeeSection(role, key)) return mark(key, excluded(key, 'not_permitted'))
    const budget = budgetFor(req.profile, key)
    const args = { ...baseArgs, budget }
    try {
      switch (key) {
        case 'identity':
          return mark('identity', included(buildIdentity(p, role), p.createdAt, now))
        case 'medical': {
          const data = buildMedical(p, budget)
          return mark('medical', data ? included(data, p.medicalHistory?.updatedAt ?? p.medicalHistory?.createdAt, now) : missing())
        }
        case 'dental': {
          const r = await buildDental(args)
          return mark('dental', r.data.toothCount === 0 ? missing() : included(r.data, r.latest, now))
        }
        case 'appointments': {
          const r = await buildAppointments(args)
          const empty = !r.data.upcoming.length && !r.data.recent.length && !r.data.cancelled.length && !r.data.missed.length
          return mark('appointments', empty ? missing() : included(r.data, r.latest, now))
        }
        case 'clinical': {
          const r = await buildClinical(args)
          const empty = !r.data.notes.length && !r.data.examinations.length && !r.data.followUpNotes.length
          return mark('clinical', empty ? missing() : included(r.data, r.latest, now))
        }
        case 'cases': {
          const r = await buildCases(args, fieldScope(role, 'cases'))
          caseIdByAppointment = new Map(
            r.planRows.filter((pl) => pl.appointmentId).map((pl) => [pl.appointmentId as string, pl.id])
          )
          return mark('cases', r.data.plans.length === 0 ? missing() : included(r.data, r.latest, now))
        }
        case 'treatments': {
          const r = await buildTreatments(args, fieldScope(role, 'treatments'), caseIdByAppointment)
          return mark('treatments', r.data.treatments.length === 0 ? missing() : included(r.data, r.latest, now))
        }
        case 'prescriptions': {
          const r = await buildPrescriptions(args)
          return mark('prescriptions', r.data.prescriptions.length === 0 ? missing() : included(r.data, r.latest, now))
        }
        case 'imaging': {
          const r = await buildImaging(args)
          return mark('imaging', r.data.studies.length === 0 ? missing() : included(r.data, r.latest, now))
        }
        case 'financial': {
          const r = await buildFinancial(args)
          return mark('financial', r.data.openInvoices.length === 0
            ? included({ ...r.data, openBalance: 0 }, r.latest, now)
            : included(r.data, r.latest, now))
        }
        case 'risk': {
          const r = await buildRisk(args)
          return mark('risk', r.data ? included(r.data, r.latest, now) : missing())
        }
        case 'timeline':
          // assembled below from fetched rows (zero extra queries)
          return
        default:
          return mark(key, missing())
      }
    } catch (err) {
      // A section failing must not silently look like "no data" — fail closed
      // for the whole context (the AI must not receive partial truth).
      throw new Error(`context section ${key} failed: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // Build every non-timeline section (independent; sequential keeps query
  // accounting deterministic — the count is bounded and constant per profile).
  const keys: ContextSectionKey[] = [
    'identity', 'medical', 'dental', 'appointments', 'clinical', 'cases',
    'treatments', 'prescriptions', 'imaging', 'financial', 'risk',
  ]
  for (const k of keys) await buildSection(k)

  // ── Complaints enrichment (chief complaints from fetched rows) ─────────
  if (ctx.clinical?.status === 'included') {
    const complaints: { text: string | null; from: 'appointment' | 'treatment' | 'treatment_plan'; at: string }[] = []
    for (const a of [...ctx.appointments?.data?.upcoming ?? [], ...ctx.appointments?.data?.recent ?? []]) {
      if (a.chiefComplaint) complaints.push({ text: truncateText(a.chiefComplaint, 200), from: 'appointment', at: a.scheduledAt })
    }
    for (const t of ctx.treatments?.data?.treatments ?? []) {
      if (t.chiefComplaint) complaints.push({ text: truncateText(t.chiefComplaint, 200), from: 'treatment', at: t.startedAt ?? t.provenance.timestamp ?? '' })
    }
    for (const c of ctx.cases?.data?.plans ?? []) {
      if (c.chiefComplaint) complaints.push({ text: truncateText(c.chiefComplaint, 200), from: 'treatment_plan', at: c.provenance.timestamp ?? '' })
    }
    ctx.clinical.data.complaints = complaints.slice(0, 5)
  }

  // ── Timeline (assembled from fetched rows) ─────────────────────────────
  if (sections.has('timeline') && canSeeSection(role, 'timeline')) {
    const budget = budgetFor(req.profile, 'timeline')
    const t = buildTimeline(
      {
        appointments: [...(ctx.appointments?.data?.upcoming ?? []), ...(ctx.appointments?.data?.recent ?? []), ...(ctx.appointments?.data?.cancelled ?? []), ...(ctx.appointments?.data?.missed ?? [])],
        dental: ctx.dental?.data,
        clinical: ctx.clinical?.data,
        treatments: ctx.treatments?.data?.treatments,
        prescriptions: ctx.prescriptions?.data?.prescriptions,
        imaging: ctx.imaging?.data?.studies,
      },
      budget
    )
    mark('timeline', t.data.events.length === 0 ? missing() : included(t.data, t.latest, now))
  } else {
    mark('timeline', excluded('timeline', !sections.has('timeline') ? 'not_in_profile' : 'not_permitted'))
  }

  const meta = metaOf(req, scope, now, excludedList, counter, startedAt, {
    reason: 'ok', id: p.id, patientId: p.patientId, name: `${p.firstName} ${p.lastName}`,
  })
  const out = { meta, ...ctx } as ClinicalContext
  assertContextContract(out)
  return out
}

function metaOf(
  req: ContextRequest,
  scope: { toothFdi: number | null; caseId: string | null; studyId: string | null; treatmentNo: string | null },
  now: Date,
  excludedList: { section: ContextSectionKey; reason: ExclusionReason }[],
  counter: { n: number },
  startedAt: bigint,
  patient: { reason: string; id: string | null; patientId: string | null; name: string | null }
) {
  return {
    profile: req.profile,
    tenantId: req.hospitalId,
    patient: {
      found: patient.reason === 'ok',
      reason: patient.reason as 'ok' | 'not_found' | 'unauthorized' | 'missing_reference',
      id: patient.id,
      patientId: patient.patientId,
      name: patient.name,
    },
    scope,
    role: req.actor.role,
    generatedAt: now.toISOString(),
    excluded: excludedList,
    queryCount: counter.n,
    constructionMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
  }
}

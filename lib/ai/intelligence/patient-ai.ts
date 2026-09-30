/**
 * Phase 9 — Patient AI (capability module of the ONE Agent, §15–§16).
 *
 * Patient-specific longitudinal intelligence, deterministic over the Case
 * Graph:
 *  - timeline: structured events from EXISTING records only (appointments,
 *    treatments, imaging, AI findings + review, follow-ups, outcomes, memory
 *    references) — NEVER invented events, sorted, bounded;
 *  - current state: active cases, current/pending treatments, due/overdue
 *    follow-ups, recent findings, unresolved issues;
 *  - memory integration: persistent preferences and prior context surface as
 *    references with their trust level — memory NEVER overwrites
 *    authoritative structured records (§27).
 *
 * §16 safety: unknown remains unknown. Nothing here infers hidden medical
 * facts, fabricates symptoms/diagnoses/treatment history/adherence/outcomes.
 */

import type { CaseGraph, GraphNode, IntelligenceItem } from './types'
import { IntelligenceError } from './types'

export interface TimelineEvent {
  id: string
  at: string
  kind:
    | 'APPOINTMENT'
    | 'TREATMENT'
    | 'IMAGING'
    | 'AI_FINDING'
    | 'AI_REVIEW'
    | 'FOLLOW_UP'
    | 'OUTCOME'
    | 'CASE'
    | 'MEMORY'
  labelKey: string
  labelParams: Record<string, string>
  /** §20 — every event has an explicit trust class. */
  insightClass: 'FACT' | 'AI_INTERPRETATION' | 'DERIVED_INSIGHT'
  provenance: string
  data: Record<string, unknown>
}

export interface PatientCurrentState {
  activeCases: { ref: string; status: string; consentGiven: boolean }[]
  currentTreatments: { ref: string; status: string }[]
  pendingItems: string[]
  followUpsDue: { ref: string; date: string | null; overdue: boolean }[]
  recentFindings: { ref: string; label: string; confirmed: boolean }[]
  unresolvedIssues: string[]
  memoryRefs: { ref: string; key: string | null; trustLevel: string | null; domain: string | null }[]
}

export interface PatientIntelligence {
  timelineTruncated: boolean
  patientId: string
  timeline: TimelineEvent[]
  current: PatientCurrentState
  items: IntelligenceItem[]
  /** Explicit statement of what is NOT known (never fabricated). */
  unknownAreas: string[]
}

const TIMELINE_LIMIT = 50

export function buildPatientIntelligence(graph: CaseGraph, now: Date): PatientIntelligence {
  // Patient isolation: a graph is ALWAYS single-patient by construction
  // (tenant-pinned + patient-pinned reads); a second patient node would be a
  // consistency violation — fail closed rather than serve mixed data.
  const patientNodes = graph.nodes.filter((n) => n.kind === 'PATIENT')
  const foreignPatient = patientNodes.find((n) => n.ref !== graph.patientId)
  if (foreignPatient) {
    throw new IntelligenceError('INT_SCOPE_MISMATCH', 'graph contains a foreign patient node')
  }

  const nowIso = now.toISOString()
  const events: TimelineEvent[] = []
  const push = (e: TimelineEvent) => events.push(e)

  const atOf = (n: GraphNode, field: string): string => {
    const v = n.data[field]
    return v ? new Date(v as string).toISOString() : n.provenance.at
  }

  for (const n of graph.nodes) {
    if (n.id.startsWith('appointment:')) {
      push({
        id: `ev:${n.id}`,
        at: atOf(n, 'scheduledDate'),
        kind: 'APPOINTMENT',
        labelKey: 'int.patient.timeline.appointment',
        labelParams: { ref: n.ref, status: String(n.data.status ?? '') },
        insightClass: 'FACT',
        provenance: n.provenance.source,
        data: { type: n.data.type ?? null, status: n.data.status ?? null },
      })
    } else if (n.id.startsWith('treatment:') || n.id.startsWith('rx:')) {
      push({
        id: `ev:${n.id}`,
        at: atOf(n, 'startTime') || n.provenance.at,
        kind: 'TREATMENT',
        labelKey: 'int.patient.timeline.treatment',
        labelParams: { ref: n.ref, status: String(n.data.status ?? '') },
        insightClass: 'FACT',
        provenance: n.provenance.source,
        data: { status: n.data.status ?? null, toothNumbers: n.data.toothNumbers ?? null },
      })
    } else if (n.id.startsWith('imaging:')) {
      push({
        id: `ev:${n.id}`,
        at: atOf(n, 'studyDate') || n.provenance.at,
        kind: 'IMAGING',
        labelKey: 'int.patient.timeline.imaging',
        labelParams: { ref: n.ref, modality: String(n.data.modality ?? '') },
        insightClass: 'FACT',
        provenance: n.provenance.source,
        data: { modality: n.data.modality ?? null, status: n.data.status ?? null },
      })
    } else if (n.id.startsWith('aifinding:')) {
      const accepted = n.data.reviewDecision === 'ACCEPTED'
      push({
        id: `ev:${n.id}`,
        at: n.provenance.at,
        kind: 'AI_FINDING',
        labelKey: accepted ? 'int.patient.timeline.aiFindingAccepted' : 'int.patient.timeline.aiFinding',
        labelParams: { ref: n.ref, engine: String(n.data.engine ?? '') },
        // UNCONFIRMED AI output stays AI_INTERPRETATION — never a fact.
        insightClass: accepted ? 'FACT' : 'AI_INTERPRETATION',
        provenance: n.provenance.source,
        data: { engine: n.data.engine ?? null, reviewDecision: n.data.reviewDecision ?? null, findingCount: n.data.findingCount ?? 0 },
      })
    } else if (n.id.startsWith('followup:')) {
      const date = (n.data.date as string | null) ?? null
      const overdue = Boolean(date && date < nowIso)
      push({
        id: `ev:${n.id}`,
        at: date ?? n.provenance.at,
        kind: 'FOLLOW_UP',
        labelKey: overdue ? 'int.patient.timeline.followUpOverdue' : 'int.patient.timeline.followUp',
        labelParams: { ref: n.ref, date: date?.slice(0, 10) ?? '' },
        insightClass: overdue ? 'DERIVED_INSIGHT' : 'FACT',
        provenance: n.provenance.source,
        data: { date, overdue, notes: n.data.notes ?? null },
      })
    } else if (n.id.startsWith('outcome:')) {
      push({
        id: `ev:${n.id}`,
        at: (n.data.completedAt as string) ?? n.provenance.at,
        kind: 'OUTCOME',
        labelKey: 'int.patient.timeline.outcome',
        labelParams: { ref: n.ref },
        insightClass: 'FACT',
        provenance: n.provenance.source,
        data: { status: n.data.status ?? null, complications: n.data.complications ?? null },
      })
    } else if (n.id.startsWith('case:')) {
      push({
        id: `ev:${n.id}`,
        at: n.provenance.at,
        kind: 'CASE',
        labelKey: 'int.patient.timeline.case',
        labelParams: { ref: n.ref, status: String(n.data.status ?? '') },
        insightClass: 'FACT',
        provenance: n.provenance.source,
        data: { status: n.data.status ?? null },
      })
    } else if (n.id.startsWith('memory:')) {
      // Memory references enter the timeline as REFERENCES (trust-preserved),
      // never as record facts.
      push({
        id: `ev:${n.id}`,
        at: n.provenance.at,
        kind: 'MEMORY',
        labelKey: 'int.patient.timeline.memory',
        labelParams: { ref: n.ref, trust: String(n.data.trustLevel ?? 'UNKNOWN') },
        insightClass: 'FACT',
        provenance: n.provenance.source,
        data: { key: n.data.key ?? null, trustLevel: n.data.trustLevel ?? null, domain: n.data.domain ?? null },
      })
    }
  }

  // Deterministic ordering (time desc, then kind, then id — stable replay).
  events.sort((a, b) => (a.at === b.at ? (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)) : a.at < b.at ? 1 : -1))
  const truncated = events.length > TIMELINE_LIMIT
  const timeline = events.slice(0, TIMELINE_LIMIT)

  // Current state.
  const caseNodes = graph.nodes.filter((n) => n.kind === 'CASE')
  // 'ACTIVE' is a legacy out-of-enum value seen in real data — intelligence
  // reports it as active rather than silently dropping the case.
  const activeCases = caseNodes
    .filter((n) => ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'ACTIVE'].includes(String(n.data.status ?? '')))
    .map((n) => ({ ref: n.ref, status: String(n.data.status ?? ''), consentGiven: Boolean(n.data.consentGiven) }))

  const trtNodes = graph.nodes.filter((n) => n.id.startsWith('treatment:') || n.id.startsWith('rx:'))
  const currentTreatments = trtNodes
    .filter((n) => ['IN_PROGRESS', 'PENDING', 'SCHEDULED', 'PLANNED', 'DRAFT'].includes(String(n.data.status ?? '')))
    .map((n) => ({ ref: n.ref, status: String(n.data.status ?? '') }))

  const pendingItems: string[] = []
  for (const n of trtNodes) {
    if (['IN_PROGRESS', 'PENDING', 'SCHEDULED', 'PLANNED'].includes(String(n.data.status ?? ''))) pendingItems.push(`${n.ref} (${n.data.status})`)
  }
  for (const n of caseNodes) {
    if (!n.data.consentGiven && ['PROPOSED', 'ACCEPTED'].includes(String(n.data.status ?? ''))) pendingItems.push(`consent for plan ${n.ref}`)
  }

  const followUpNodes = graph.nodes.filter((n) => n.kind === 'FOLLOW_UP')
  const followUpsDue = followUpNodes
    .map((n) => {
      const date = (n.data.date as string | null) ?? null
      return { ref: n.ref, date, overdue: Boolean(date && date < nowIso) }
    })
    .sort((a, b) => (a.date ?? '') < (b.date ?? '') ? -1 : 1)

  const aiNodes = graph.nodes.filter((n) => n.id.startsWith('aifinding:'))
  const chartNodes = graph.nodes.filter((n) => n.id.startsWith('finding:'))
  const recentFindings = [
    ...aiNodes.map((n) => ({ ref: n.ref, label: n.label, confirmed: n.data.reviewDecision === 'ACCEPTED' })),
    ...chartNodes.map((n) => ({ ref: n.ref, label: n.label, confirmed: true })),
  ].slice(0, 10)

  const unresolvedIssues: string[] = []
  for (const n of chartNodes) {
    if (!n.data.resolved) unresolvedIssues.push(`${n.label} (unresolved chart finding)`)
  }
  for (const n of aiNodes) {
    if (n.data.reviewDecision !== 'ACCEPTED') unresolvedIssues.push(`${n.ref} (AI finding unreviewed/unconfirmed)`)
  }
  for (const fu of followUpsDue) {
    if (fu.overdue) unresolvedIssues.push(`${fu.ref} (follow-up overdue)`)
  }

  const memoryRefs = graph.nodes
    .filter((n) => n.id.startsWith('memory:'))
    .map((n) => ({
      ref: n.ref,
      key: (n.data.key as string | null) ?? null,
      trustLevel: (n.data.trustLevel as string | null) ?? null,
      domain: (n.data.domain as string | null) ?? null,
    }))

  const items: IntelligenceItem[] = []
  let iN = 0
  const item = (insightClass: IntelligenceItem['insightClass'], titleKey: string, detail: Record<string, unknown>) => {
    iN += 1
    items.push({ id: `pi-${iN}`, insightClass, state: 'AVAILABLE', titleKey, titleParams: {}, detail, scope: { patientId: graph.patientId, caseId: graph.caseId } })
  }
  if (followUpsDue.some((f) => f.overdue)) item('DERIVED_INSIGHT', 'int.patient.overdueFollowUps', { count: followUpsDue.filter((f) => f.overdue).length })
  if (aiNodes.some((n) => n.data.reviewDecision !== 'ACCEPTED')) item('AI_INTERPRETATION', 'int.patient.unconfirmedAi', { count: aiNodes.filter((n) => n.data.reviewDecision !== 'ACCEPTED').length })
  if (unresolvedIssues.length > 0) item('DERIVED_INSIGHT', 'int.patient.unresolved', { count: unresolvedIssues.length })
  if (timeline.length === 0) item('FACT', 'int.patient.emptyHistory', {})

  // Unknown areas — explicit (unknown stays unknown, §16).
  const unknownAreas: string[] = []
  if (!events.some((e) => e.kind === 'IMAGING')) unknownAreas.push('imaging_history')
  if (!events.some((e) => e.kind === 'OUTCOME')) unknownAreas.push('outcomes')
  if (!events.some((e) => e.kind === 'TREATMENT')) unknownAreas.push('treatment_history')
  if (!events.some((e) => e.kind === 'FOLLOW_UP')) unknownAreas.push('follow_ups')
  if (!events.some((e) => e.kind === 'MEMORY')) unknownAreas.push('persistent_preferences')

  return {
    patientId: graph.patientId,
    timelineTruncated: truncated,
    timeline,
    current: {
      activeCases,
      currentTreatments,
      pendingItems,
      followUpsDue,
      recentFindings,
      unresolvedIssues,
      memoryRefs,
    },
    items,
    unknownAreas,
  }
}

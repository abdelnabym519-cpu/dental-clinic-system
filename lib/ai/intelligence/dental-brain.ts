/**
 * Phase 9 — Dental Brain (capability module of the ONE Agent, §10–§13).
 *
 * Deterministic, domain-aware clinical intelligence over the Case Graph:
 *  - case understanding (§11): what is known, what came from AI, what is
 *    clinician-confirmed, what imaging exists, what is pending, what is due,
 *    what is MISSING — always with provenance and uncertainty preserved;
 *  - structured clinical summary (§12): the fixed 14-section structure with
 *    explicit NOT_AVAILABLE where data is absent — never fabricated;
 *  - differential support (§13): candidate differentials as CLINICAL DECISION
 *    SUPPORT only — with supporting/contradicting/missing evidence and an
 *    explicit "not a diagnosis" stance.
 *
 * §10 domain awareness is REUSABLE, not 100 modules: the approved dental
 * domain taxonomy (lib/ai/knowledge/taxonomy.ts) maps findings/procedures to
 * domains; the intelligence logic is the same for every domain.
 */

import type {
  CaseGraph,
  GraphNode,
  IntelligenceItem,
} from './types'
import { KNOWLEDGE_DOMAINS, type KnowledgeDomain } from '@/lib/ai/knowledge/taxonomy'
import { buildCaseGraph, type GraphPrisma } from './case-graph'

export interface CaseUnderstanding {
  patientId: string
  caseId: string | null
  /** §20: every item is a FACT, a DERIVED_INSIGHT, or an AI_INTERPRETATION. */
  items: IntelligenceItem[]
  teeth: { fdi: number; conditions: { condition: string; severity: string; resolved: boolean }[] }[]
  aiFindings: {
    ref: string
    engine: string | null
    status: string | null
    reviewDecision: string | null
    findingCount: number
    provenance: { modelVersion: string | null; modelChecksum: string | null }
  }[]
  clinicianConfirmedFindings: string[]
  symptoms: string[]
  imaging: { modality: string | null; studyType: string | null; status: string | null; aiJobs: number }[]
  treatment: { done: string[]; pending: string[]; cancelled: string[] }
  followUps: { ref: string; date: string | null; overdue: boolean; notes: string | null }[]
  missingInformation: string[]
  domains: KnowledgeDomain[]
  graph: { nodes: number; edges: number; truncated: boolean }
}

export interface ClinicalSummary {
  patientContext: SummaryLine
  chiefComplaint: SummaryLine
  relevantHistory: SummaryLine
  affectedTeeth: SummaryLine
  symptoms: SummaryLine
  clinicalFindings: SummaryLine
  imaging: SummaryLine
  aiFindings: SummaryLine
  clinicianConfirmedFindings: SummaryLine
  differentialConsiderations: SummaryLine
  treatmentHistory: SummaryLine
  currentTreatment: SummaryLine
  pendingItems: SummaryLine
  followUp: SummaryLine
  knownUncertainty: SummaryLine
  missingInformation: SummaryLine
  /** Every summary is Clinical Decision Support — never a diagnosis. */
  disclaimerKey: string
}

/** One summary section: explicit state + bounded lines (no free-text dumps). */
export interface SummaryLine {
  state: 'AVAILABLE' | 'NOT_AVAILABLE'
  lines: string[]
}

// ---------------------------------------------------------------------------
// §10 — reusable domain mapping (findings/procedures → approved domains)
// ---------------------------------------------------------------------------

const CONDITION_DOMAINS: Record<string, KnowledgeDomain> = {
  CARIES: 'RESTORATIVE',
  FILLED: 'RESTORATIVE',
  CROWN: 'PROSTHODONTICS',
  BRIDGE: 'PROSTHODONTICS',
  IMPLANT: 'IMPLANTOLOGY',
  ROOT_CANAL: 'ENDODONTICS',
  EXTRACTION: 'SURGERY',
  FRACTURED: 'RESTORATIVE',
  SENSITIVE: 'ENDODONTICS',
  MOBILITY: 'PERIODONTOLOGY',
  ABSCESS: 'ORAL_MEDICINE',
  PERIODONTAL: 'PERIODONTOLOGY',
}

const PROCEDURE_CATEGORY_DOMAINS: Record<string, KnowledgeDomain> = {
  PREVENTIVE: 'FOUNDATIONAL',
  RESTORATIVE: 'RESTORATIVE',
  ENDODONTIC: 'ENDODONTICS',
  PERIODONTIC: 'PERIODONTOLOGY',
  PROSTHODONTIC: 'PROSTHODONTICS',
  ORTHODONTIC: 'ORTHODONTICS',
  ORAL_SURGERY: 'SURGERY',
  COSMETIC: 'PROSTHODONTICS',
  DIAGNOSTIC: 'DIAGNOSIS',
  EMERGENCY: 'ORAL_MEDICINE',
}

export function domainsForCase(
  graph: CaseGraph,
  procedureCategories: string[]
): KnowledgeDomain[] {
  const set = new Set<KnowledgeDomain>()
  set.add('DIAGNOSIS') // case understanding always sits under diagnosis support
  for (const n of graph.nodes) {
    if (n.kind === 'FINDING' && typeof n.data.condition === 'string') {
      const d = CONDITION_DOMAINS[n.data.condition]
      if (d) set.add(d)
    }
  }
  for (const c of procedureCategories) {
    const d = PROCEDURE_CATEGORY_DOMAINS[c.toUpperCase()]
    if (d) set.add(d)
  }
  const known = KNOWLEDGE_DOMAINS as readonly string[]
  return [...set].filter((d) => known.includes(d)) as KnowledgeDomain[]
}

// ---------------------------------------------------------------------------
// §11 — case understanding (deterministic over the graph)
// ---------------------------------------------------------------------------

export function understandCase(
  graph: CaseGraph,
  opts: { procedureCategories: string[]; now: Date }
): CaseUnderstanding {
  const nowIso = opts.now.toISOString()
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const items: IntelligenceItem[] = []
  let itemN = 0
  const item = (
    insightClass: IntelligenceItem['insightClass'],
    titleKey: string,
    detail: Record<string, unknown>,
    state: IntelligenceItem['state'] = 'AVAILABLE',
  ) => {
    itemN += 1
    items.push({
      id: `item-${itemN}`,
      insightClass,
      state,
      titleKey,
      titleParams: {},
      detail,
      scope: { patientId: graph.patientId, caseId: graph.caseId },
    })
  }

  // Teeth + conditions (FACT).
  const teeth: CaseUnderstanding['teeth'] = []
  const seenTooth = new Set<number>()
  for (const n of graph.nodes) {
    if (!n.id.startsWith('finding:')) continue
    const fdi = Number(n.data.tooth)
    if (!fdi || seenTooth.has(fdi)) continue
    seenTooth.add(fdi)
    teeth.push({ fdi, conditions: [] })
  }
  for (const n of graph.nodes) {
    if (!n.id.startsWith('finding:')) continue
    const fdi = Number(n.data.tooth)
    const t = teeth.find((x) => x.fdi === fdi)
    if (t) {
      t.conditions.push({
        condition: String(n.data.condition ?? 'UNKNOWN'),
        severity: String(n.data.severity ?? 'UNKNOWN'),
        resolved: Boolean(n.data.resolved),
      })
    }
  }
  if (teeth.length > 0) {
    item('FACT', 'int.casing.teeth', { count: teeth.length, fdi: teeth.map((t) => t.fdi) })
  } else {
    item('FACT', 'int.casing.noTeeth', {}, 'NOT_AVAILABLE')
  }

  // AI findings (AI_INTERPRETATION until ACCEPTED → then DOCTOR_CONFIRMED fact).
  const aiFindings: CaseUnderstanding['aiFindings'] = []
  const clinicianConfirmedFindings: string[] = []
  for (const n of graph.nodes) {
    if (!n.id.startsWith('aifinding:')) continue
    const accepted = n.data.reviewDecision === 'ACCEPTED'
    const prov = (n.data.provenanceRecord ?? {}) as { modelVersion?: string | null; modelChecksum?: string | null }
    aiFindings.push({
      ref: n.ref,
      engine: (n.data.engine as string | null) ?? null,
      status: (n.data.status as string | null) ?? null,
      reviewDecision: (n.data.reviewDecision as string | null) ?? null,
      findingCount: Number(n.data.findingCount ?? 0),
      provenance: {
        modelVersion: prov.modelVersion ?? null,
        modelChecksum: prov.modelChecksum ?? null,
      },
    })
    if (accepted) clinicianConfirmedFindings.push(n.label)
    item(
      accepted ? 'FACT' : 'AI_INTERPRETATION',
      accepted ? 'int.casing.aiFindingAccepted' : 'int.casing.aiFindingPending',
      { ref: n.ref, engine: n.data.engine ?? null, reviewDecision: n.data.reviewDecision ?? null },
    )
  }
  if (aiFindings.length === 0) item('FACT', 'int.casing.noAiFindings', {}, 'NOT_AVAILABLE')

  // Symptoms (USER_PROVIDED facts — patient words, verbatim, bounded).
  const symptoms = graph.nodes
    .filter((n) => n.kind === 'SYMPTOM')
    .map((n) => n.data.text as string)
    .slice(0, 10)
  if (symptoms.length > 0) item('FACT', 'int.casing.symptoms', { count: symptoms.length })
  else item('FACT', 'int.casing.noSymptoms', {}, 'NOT_AVAILABLE')

  // Imaging (FACT).
  const imaging = graph.nodes
    .filter((n) => n.id.startsWith('imaging:'))
    .map((n) => {
      const jobCount = graph.edges.filter((e) => e.from === n.id && e.kind === 'IMAGING_HAS_AI_FINDING').length
      return {
        modality: (n.data.modality as string | null) ?? null,
        studyType: (n.data.studyType as string | null) ?? null,
        status: (n.data.status as string | null) ?? null,
        aiJobs: jobCount,
      }
    })
  if (imaging.length > 0) item('FACT', 'int.casing.imaging', { count: imaging.length })
  else item('FACT', 'int.casing.noImaging', {}, 'NOT_AVAILABLE')

  // Treatments: done / pending / cancelled (FACT).
  const done: string[] = []
  const pending: string[] = []
  const cancelled: string[] = []
  for (const n of graph.nodes) {
    if (!n.id.startsWith('treatment:') && !n.id.startsWith('rx:')) continue
    const status = String(n.data.status ?? '')
    if (status === 'COMPLETED') done.push(n.ref)
    else if (status === 'CANCELLED' || status === 'REJECTED' || status === 'CANCELLED_RX') cancelled.push(n.ref)
    else pending.push(n.ref)
  }
  item('FACT', 'int.casing.treatment', { done: done.length, pending: pending.length, cancelled: cancelled.length })

  // Follow-ups (FACT + DERIVED_INSIGHT for overdue).
  const followUps: CaseUnderstanding['followUps'] = []
  for (const n of graph.nodes) {
    if (n.kind !== 'FOLLOW_UP') continue
    const date = (n.data.date as string | null) ?? null
    const overdue = Boolean(date && date < nowIso)
    followUps.push({ ref: n.ref, date, overdue, notes: (n.data.notes as string | null) ?? null })
    if (overdue) {
      item('DERIVED_INSIGHT', 'int.casing.followUpOverdue', { ref: n.ref, date }, 'AVAILABLE')
    }
  }
  if (followUps.length === 0) item('FACT', 'int.casing.noFollowUps', {}, 'NOT_AVAILABLE')

  // Missing information — explicit, deterministic gaps (never fabricated).
  const missingInformation: string[] = []
  if (symptoms.length === 0) missingInformation.push('chief_complaint')
  if (imaging.length === 0) missingInformation.push('imaging')
  if (clinicianConfirmedFindings.length === 0 && aiFindings.length === 0) missingInformation.push('findings')
  for (const n of graph.nodes) {
    if (n.kind === 'FOLLOW_UP' && !n.data.date) missingInformation.push('follow_up_date')
    if (n.kind === 'CASE' && n.data.status === 'DRAFT') missingInformation.push('case_plan_status')
  }
  const missing = [...new Set(missingInformation)]
  if (missing.length > 0) item('DERIVED_INSIGHT', 'int.casing.missing', { missing })

  // Treatment plan states.
  for (const n of graph.nodes) {
    if (n.kind !== 'CASE') continue
    item('FACT', 'int.casing.plan', { planNumber: n.ref, status: n.data.status ?? null, diagnosis: n.data.diagnosis ? 'recorded' : 'none' })
    if (!n.data.consentGiven) item('DERIVED_INSIGHT', 'int.casing.consentMissing', { planNumber: n.ref })
  }
  void nodeById

  return {
    patientId: graph.patientId,
    caseId: graph.caseId,
    items,
    teeth,
    aiFindings,
    clinicianConfirmedFindings,
    symptoms,
    imaging,
    treatment: { done, pending, cancelled },
    followUps,
    missingInformation: missing,
    domains: domainsForCase(graph, opts.procedureCategories),
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, truncated: graph.limits.truncated },
  }
}

// ---------------------------------------------------------------------------
// §13 — differential support (Clinical Decision Support, never diagnosis)
// ---------------------------------------------------------------------------

export interface DifferentialCandidate {
  candidate: string
  domain: KnowledgeDomain
  supportingEvidence: string[]
  contradictingEvidence: string[]
  missingEvidence: string[]
  suggestedInformation: string[]
}

/**
 * Deterministic differential SUPPORT from recorded findings only. Every
 * candidate is explicitly a CANDIDATE (AI_INTERPRETATION class upstream) —
 * the structure itself carries "not a diagnosis" semantics via
 * `stance: 'clinical_decision_support'`.
 */
export function differentialSupport(
  graph: CaseGraph,
  opts: { procedureCategories: string[] }
): { stance: 'clinical_decision_support'; candidates: DifferentialCandidate[] } {
  // Aggregate ALL findings per condition: a condition is "active" while ANY
  // recorded entry is unresolved (a later RESOLVED history entry must never
  // overwrite an active record — that would hide live pathology).
  const conditions = new Map<string, { severity: string; resolved: boolean; tooth: number }>()
  const SEV_RANK: Record<string, number> = { SEVERE: 3, MODERATE: 2, MILD: 1, UNKNOWN: 0 }
  for (const n of graph.nodes) {
    if (!n.id.startsWith('finding:')) continue
    const cond = String(n.data.condition ?? '')
    const entry = {
      severity: String(n.data.severity ?? 'UNKNOWN'),
      resolved: Boolean(n.data.resolved),
      tooth: Number(n.data.tooth ?? 0),
    }
    const prev = conditions.get(cond)
    if (!prev) {
      conditions.set(cond, entry)
    } else {
      conditions.set(cond, {
        severity: (SEV_RANK[prev.severity] ?? 0) >= (SEV_RANK[entry.severity] ?? 0) ? prev.severity : entry.severity,
        resolved: prev.resolved && entry.resolved,
        tooth: entry.tooth || prev.tooth,
      })
    }
  }

  const candidates: DifferentialCandidate[] = []
  const push = (
    candidate: string,
    domain: KnowledgeDomain,
    supporting: string[],
    contradicting: string[],
    missing: string[],
    suggested: string[],
  ) => candidates.push({ candidate, domain, supportingEvidence: supporting, contradictingEvidence: contradicting, missingEvidence: missing, suggestedInformation: suggested })

  const active = (c: string) => {
    const v = conditions.get(c)
    return Boolean(v && !v.resolved)
  }
  const sev = (c: string) => conditions.get(c)?.severity ?? null

  if (active('CARIES')) {
    push(
      'Caries (restorative consideration)',
      'RESTORATIVE',
      [`chart condition CARIES recorded${sev('CARIES') ? ` (severity ${sev('CARIES')})` : ''} — clinician-confirmed record`],
      conditions.has('CARIES') && conditions.get('CARIES')?.resolved ? ['finding marked resolved'] : [],
      ['radiographic evidence (if not yet imaged)', 'extent/depth assessment'],
      ['periapical or bitewing imaging of the affected tooth', 'clinical probing of the lesion'],
    )
  }
  if (active('ROOT_CANAL') || active('ABSCESS')) {
    push(
      'Endodontic involvement (decision support)',
      'ENDODONTICS',
      conditions.has('ABSCESS') ? ['ABSCESS recorded (clinician-confirmed)'] : [],
      conditions.has('ROOT_CANAL') ? ['prior root-canal treatment recorded'] : [],
      ['vitality testing result', 'periapical radiograph / CBCT if periapical lesion suspected'],
      ['pulp vitality test (thermal/electric)', 'periapical imaging; CBCT for persistent periapical pathology'],
    )
  }
  if (active('PERIODONTAL')) {
    push(
      'Periodontal involvement (decision support)',
      'PERIODONTOLOGY',
      ['PERIODONTAL condition recorded (clinician-confirmed)'],
      conditions.get('PERIODONTAL')?.resolved ? ['finding marked resolved'] : [],
      ['probing depths', 'radiographic bone levels'],
      ['full-mouth periodontal charting', 'periapical/panoramic imaging for bone assessment'],
    )
  }
  if (active('MOBILITY')) {
    push(
      'Tooth mobility (periodontal or traumatic origin — decision support)',
      'PERIODONTOLOGY',
      ['MOBILITY recorded (clinician-confirmed)'],
      [],
      ['cause (periodontal vs traumatic)', 'probing depths', 'periapical imaging'],
      ['history of trauma', 'periodontal charting', 'periapical imaging'],
    )
  }
  if (active('CROWN') || active('BRIDGE')) {
    push(
      'Prosthetic maintenance (decision support)',
      'PROSTHODONTICS',
      [`${[...new Set(['CROWN', 'BRIDGE'].filter(active))] } recorded (clinician-confirmed)`],
      [],
      ['marginal integrity assessment', 'occlusal check'],
      ['clinical examination of the prosthesis margins', 'occlusal evaluation'],
    )
  }

  // AI findings widen the differential but stay AI_INTERPRETATION:
  for (const n of graph.nodes) {
    if (!n.id.startsWith('aifinding:')) continue
    if (n.data.reviewDecision === 'ACCEPTED') continue // already a confirmed fact
    push(
      `Model-suggested review (${n.data.engine ?? 'engine'}) — unconfirmed AI finding`,
      'DIAGNOSIS',
      [`AI finding present (${Number(n.data.findingCount ?? 0)} item(s), engine ${n.data.engine ?? 'unknown'}) — UNCONFIRMED`],
      [],
      ['clinician review of the AI output', 'correlating imaging'],
      ['review the AI analysis with provenance in the imaging module', 'corroborate with clinical examination'],
    )
  }

  return { stance: 'clinical_decision_support', candidates }
}

// ---------------------------------------------------------------------------
// §12 — structured clinical summary (fixed sections, explicit gaps)
// ---------------------------------------------------------------------------

function line(state: 'AVAILABLE' | 'NOT_AVAILABLE', lines: string[]): SummaryLine {
  return { state, lines }
}

export function buildClinicalSummary(
  understanding: CaseUnderstanding,
  graph: CaseGraph,
  patientName: string
): ClinicalSummary {
  const caseNodes = graph.nodes.filter((n) => n.kind === 'CASE')
  const planStatuses = caseNodes.map((n) => `${n.ref}: ${n.data.status ?? 'unknown'}`)
  const diff = differentialSupport(graph, { procedureCategories: [] })
  const diffLines = diff.candidates.map(
    (c) => `${c.candidate} — supporting: ${c.supportingEvidence.length} / contradicting: ${c.contradictingEvidence.length} / missing: ${c.missingEvidence.length}`,
  )

  return {
    patientContext: line('AVAILABLE', [patientName]),
    chiefComplaint:
      understanding.symptoms.length > 0
        ? line('AVAILABLE', understanding.symptoms.slice(0, 5))
        : line('NOT_AVAILABLE', []),
    relevantHistory:
      understanding.imaging.length + understanding.aiFindings.length > 0
        ? line(
            'AVAILABLE',
            [
              `imaging studies: ${understanding.imaging.length}`,
              `AI findings: ${understanding.aiFindings.length} (${understanding.clinicianConfirmedFindings.length} clinician-confirmed)`,
            ],
          )
        : line('NOT_AVAILABLE', []),
    affectedTeeth:
      understanding.teeth.length > 0
        ? line(
            'AVAILABLE',
            understanding.teeth.map(
              (t) => `Tooth ${t.fdi}: ${t.conditions.map((c) => `${c.condition}/${c.severity}${c.resolved ? ' (resolved)' : ''}`).join(', ')}`,
            ),
          )
        : line('NOT_AVAILABLE', []),
    symptoms:
      understanding.symptoms.length > 0
        ? line('AVAILABLE', understanding.symptoms)
        : line('NOT_AVAILABLE', []),
    clinicalFindings:
      understanding.teeth.length > 0
        ? line('AVAILABLE', understanding.teeth.map((t) => `Tooth ${t.fdi} — ${t.conditions.map((c) => c.condition).join(', ')}`))
        : line('NOT_AVAILABLE', []),
    imaging:
      understanding.imaging.length > 0
        ? line('AVAILABLE', understanding.imaging.map((i) => `${i.modality ?? 'study'} (${i.status ?? 'unknown'}), AI jobs: ${i.aiJobs}`))
        : line('NOT_AVAILABLE', []),
    aiFindings:
      understanding.aiFindings.length > 0
        ? line(
            'AVAILABLE',
            understanding.aiFindings.map(
              (a) => `${a.engine ?? 'engine'}: ${a.findingCount} finding(s) — ${a.reviewDecision ?? 'UNREVIEWED'}`,
            ),
          )
        : line('NOT_AVAILABLE', []),
    clinicianConfirmedFindings:
      understanding.clinicianConfirmedFindings.length > 0
        ? line('AVAILABLE', understanding.clinicianConfirmedFindings)
        : line('NOT_AVAILABLE', []),
    differentialConsiderations:
      diffLines.length > 0
        ? line('AVAILABLE', [...diffLines, 'STANCE: clinical decision support — candidates, not diagnoses'])
        : line('NOT_AVAILABLE', []),
    treatmentHistory:
      understanding.treatment.done.length > 0
        ? line('AVAILABLE', [`completed: ${understanding.treatment.done.length}`, `cancelled: ${understanding.treatment.cancelled.length}`])
        : line('NOT_AVAILABLE', []),
    currentTreatment:
      caseNodes.some((n) => n.data.status === 'IN_PROGRESS')
        ? line('AVAILABLE', caseNodes.filter((n) => n.data.status === 'IN_PROGRESS').map((n) => n.ref))
        : line('NOT_AVAILABLE', []),
    pendingItems:
      understanding.treatment.pending.length > 0
        ? line('AVAILABLE', [`pending treatments/actions: ${understanding.treatment.pending.length}`])
        : line('NOT_AVAILABLE', []),
    followUp:
      understanding.followUps.length > 0
        ? line(
            'AVAILABLE',
            understanding.followUps.map((f) => `${f.date ?? 'date unknown'}${f.overdue ? ' — OVERDUE' : ''}`),
          )
        : line('NOT_AVAILABLE', []),
    knownUncertainty:
      understanding.aiFindings.filter((a) => a.reviewDecision !== 'ACCEPTED').length > 0
        ? line('AVAILABLE', [`${understanding.aiFindings.filter((a) => a.reviewDecision !== 'ACCEPTED').length} AI finding(s) unconfirmed by a clinician`])
        : line('NOT_AVAILABLE', []),
    missingInformation:
      understanding.missingInformation.length > 0
        ? line('AVAILABLE', understanding.missingInformation)
        : line('NOT_AVAILABLE', []),
    disclaimerKey: 'int.summary.disclaimer',
  }
}

/**
 * Convenience for the Agent/route layer: understand a case in one call
 * (graph build + understanding + summary). The graph builder enforces tenant
 * and patient scope; this function adds the intelligence projections.
 */
export async function runDentalBrain(
  prisma: GraphPrisma,
  opts: {
    hospitalId: string
    patientId: string
    caseId?: string | null
    actor: { id: string; role: string }
    procedureCategories: string[]
    now: Date
    patientName: string
  }
): Promise<{
  understanding: CaseUnderstanding
  summary: ClinicalSummary
  differential: { stance: 'clinical_decision_support'; candidates: DifferentialCandidate[] }
}> {
  const graph = await buildCaseGraph(prisma, {
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    caseId: opts.caseId ?? null,
    actor: opts.actor,
    now: opts.now,
  })
  const understanding = understandCase(graph, opts)
  const summary = buildClinicalSummary(understanding, graph, opts.patientName)
  const differential = differentialSupport(graph, { procedureCategories: opts.procedureCategories })
  return { understanding, summary, differential }
}

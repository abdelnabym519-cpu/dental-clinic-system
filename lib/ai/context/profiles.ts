/**
 * Phase 2 — Task-oriented context profiles (§11/§12/§13).
 *
 * Each profile declares exactly which sections are relevant and the budget
 * that bounds them: max records, time window, and text truncation. The same
 * profile always produces the same context for the same data (deterministic
 * ordering, deduplication, truncation) — results are reproducible.
 *
 * Minimum Necessary: a "show me the patient" request gets PATIENT_OVERVIEW,
 * not FULL_360. FULL_360 is still bounded — the entire history is never
 * loaded "without a reason".
 */

import type { ContextProfile, ContextSectionKey } from './types'

export interface SectionBudget {
  maxRecords: number
  /** Events/records older than this are dropped (timeline/complaints). */
  windowDays: number | null
  /** Free-text truncation length (characters). */
  maxTextChars: number
}

export interface ProfileDefinition {
  sections: ContextSectionKey[]
  budgets: Partial<Record<ContextSectionKey, SectionBudget>>
  /** Default budget for sections without an explicit one. */
  defaultBudget: SectionBudget
}

const B = (maxRecords: number, maxTextChars = 500, windowDays: number | null = null): SectionBudget => ({
  maxRecords, maxTextChars, windowDays,
})

export const PROFILE_DEFINITIONS: Record<ContextProfile, ProfileDefinition> = {
  MINIMAL: {
    sections: ['identity'],
    budgets: { identity: B(1, 200) },
    defaultBudget: B(1, 200),
  },
  PATIENT_OVERVIEW: {
    sections: ['identity', 'medical', 'dental', 'appointments', 'risk', 'financial'],
    budgets: {
      medical: B(1, 300),
      dental: B(32, 120),
      appointments: B(10, 200, 365),
      risk: B(1, 200),
      financial: B(5, 120),
    },
    defaultBudget: B(10, 200),
  },
  CLINICAL: {
    sections: [
      'identity', 'medical', 'dental', 'appointments', 'clinical',
      'cases', 'treatments', 'prescriptions', 'risk',
    ],
    budgets: {
      medical: B(1, 300),
      dental: B(32, 150),
      appointments: B(12, 250, 730),
      clinical: B(15, 800, 730),
      cases: B(5, 300),
      treatments: B(10, 400, 730),
      prescriptions: B(8, 300, 730),
      risk: B(1, 200),
    },
    defaultBudget: B(12, 400),
  },
  TOOTH: {
    // Tooth-focused: chart + tooth-linked treatments/cases/imaging + notes
    // that mention the tooth (marked as inferred).
    sections: ['identity', 'dental', 'treatments', 'cases', 'imaging', 'clinical', 'appointments'],
    budgets: {
      dental: B(32, 200),
      treatments: B(10, 400, 3650),
      cases: B(5, 300),
      imaging: B(5, 300),
      clinical: B(8, 600, 3650),
      appointments: B(6, 200, 365),
    },
    defaultBudget: B(10, 300),
  },
  CASE: {
    sections: ['identity', 'cases', 'treatments', 'prescriptions', 'clinical', 'imaging', 'appointments', 'dental'],
    budgets: {
      cases: B(3, 400),
      treatments: B(8, 400),
      prescriptions: B(6, 300),
      clinical: B(10, 800),
      imaging: B(5, 300),
      appointments: B(6, 200),
      dental: B(32, 150),
    },
    defaultBudget: B(8, 300),
  },
  IMAGING: {
    sections: ['identity', 'imaging', 'appointments', 'cases', 'dental'],
    budgets: {
      imaging: B(5, 400),
      appointments: B(5, 200, 365),
      cases: B(3, 300),
      dental: B(32, 150),
    },
    defaultBudget: B(8, 300),
  },
  TREATMENT: {
    sections: ['identity', 'treatments', 'cases', 'prescriptions', 'clinical', 'appointments', 'dental', 'imaging'],
    budgets: {
      treatments: B(6, 600),
      cases: B(3, 300),
      prescriptions: B(5, 300),
      clinical: B(8, 600),
      appointments: B(5, 200),
      dental: B(32, 150),
      imaging: B(4, 300),
    },
    defaultBudget: B(8, 300),
  },
  FOLLOW_UP: {
    sections: ['identity', 'treatments', 'clinical', 'appointments', 'cases', 'prescriptions'],
    budgets: {
      treatments: B(8, 400, 730),
      clinical: B(10, 600, 730),
      appointments: B(10, 250),
      cases: B(5, 300),
      prescriptions: B(5, 300),
    },
    defaultBudget: B(10, 300),
  },
  TIMELINE: {
    // Bounded unified timeline: enough clinical surface to build events,
    // without financial/risk internals (added in Phase 3 for the agent's
    // timeline tool — additive, no other profile changes).
    sections: ['identity', 'dental', 'appointments', 'clinical', 'cases', 'treatments', 'imaging', 'timeline'],
    budgets: {
      dental: B(32, 150),
      appointments: B(12, 200, 730),
      clinical: B(15, 600, 730),
      cases: B(5, 200),
      treatments: B(10, 300, 730),
      imaging: B(4, 200),
      timeline: B(30, 200, 730),
    },
    defaultBudget: B(10, 300),
  },
  FULL_360: {
    sections: [
      'identity', 'medical', 'dental', 'appointments', 'clinical', 'cases',
      'treatments', 'prescriptions', 'imaging', 'financial', 'risk', 'timeline',
    ],
    budgets: {
      medical: B(1, 300),
      dental: B(32, 150),
      appointments: B(15, 250, 1095),
      clinical: B(20, 800, 1095),
      cases: B(6, 300),
      treatments: B(12, 400, 1095),
      prescriptions: B(10, 300, 1095),
      imaging: B(6, 400),
      financial: B(5, 150),
      risk: B(1, 200),
      timeline: B(30, 200, 1095),
    },
    defaultBudget: B(12, 300),
  },
}

export function budgetFor(profile: ContextProfile, section: ContextSectionKey): SectionBudget {
  const def = PROFILE_DEFINITIONS[profile]
  return def.budgets[section] ?? def.defaultBudget
}

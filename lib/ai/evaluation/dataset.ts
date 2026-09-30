/**
 * Phase 7 — golden dataset loading + validation (§16).
 *
 * The golden dataset is versioned, structured, synthetic-only, and safe to
 * commit. Loading validates every case against the zod schema — an invalid
 * dataset fails with EVAL_DATASET_INVALID (never a silent partial load).
 */
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { EvalActorRole, EvalCategory, EvalLanguage, EvalVerdict, GoldenCase, GoldenDataset } from './types'
import { EVAL_ACTOR_ROLES, EVAL_CATEGORIES, EVAL_LANGUAGES } from './types'

export const GOLDEN_DATASET_VERSION = '1.0.0'

const expectedSchema = z.object({
  status: z.array(z.string()).optional(),
  taskType: z.union([z.string(), z.array(z.string())]).optional(),
  patientInvolved: z.boolean().optional(),
  toothInvolved: z.boolean().optional(),
  tools: z.array(z.string()).optional(),
  toolInputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  contextProfile: z.union([z.string(), z.null()]).optional(),
  llmCalls: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  failureCodes: z.array(z.string()).optional(),
  stopReason: z.union([z.string(), z.null()]).optional(),
  warningsMin: z.number().optional(),
  mustContain: z.array(z.string()).optional(),
  mustNotContain: z.array(z.string()).optional(),
  actionsProposed: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  actionsExecuted: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  approvalState: z.union([z.string(), z.null()]).optional(),
  evidence: z
    .object({
      required: z.boolean().optional(),
      sourcesMin: z.number().optional(),
      sourcesMax: z.number().optional(),
      citationsMin: z.number().optional(),
      citationsMax: z.number().optional(),
      failureCode: z.union([z.string(), z.null()]).optional(),
    })
    .optional(),
  grounding: z
    .object({ ok: z.boolean().optional(), unsupportedMax: z.number().optional() })
    .optional(),
  attachmentsResolved: z.number().optional(),
  attachmentsDroppedMin: z.number().optional(),
})

const goldenCaseSchema = z.object({
  caseId: z.string().min(3),
  category: z.enum(EVAL_CATEGORIES),
  domain: z.string().min(1),
  language: z.enum(EVAL_LANGUAGES),
  title: z.string().min(3),
  description: z.string().optional(),
  // DOCTOR is the canonical default actor for a case that omits the role —
  // the strongest staff role that stays inside every clinical tool scope.
  actorRole: z.enum(EVAL_ACTOR_ROLES).default('DOCTOR'),
  tenant: z.enum(['A', 'B']),
  patientContext: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  input: z.object({
    message: z.string().min(1),
    patientId: z.string().nullable().optional(),
    patientName: z.string().nullable().optional(),
    toothFdi: z.number().int().min(11).max(48).nullable().optional(),
    caseId: z.string().nullable().optional(),
    studyId: z.string().nullable().optional(),
    attachments: z.array(z.string()).optional(),
  }),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1),
        fileClass: z.enum(['IMAGE_2D', 'MESH_3D', 'DOCUMENT_PDF', 'DOCUMENT_TEXT', 'VOLUME_DICOM', 'UNKNOWN']),
        dentalModality: z.string().nullable(),
        patientId: z.string().nullable(),
        originalName: z.string().min(1),
        extractedText: z.string().optional(),
        studyId: z.string().nullable().optional(),
      }),
    )
    .optional(),
  expected: expectedSchema,
  tags: z.array(z.string()).optional(),
})

export const GoldenCaseSchema: z.ZodType<GoldenCase> = goldenCaseSchema as unknown as z.ZodType<GoldenCase>

export const datasetSchema = z.object({
  datasetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  phiPolicy: z.literal('SYNTHETIC_ONLY'),
  cases: z.array(goldenCaseSchema),
})

/**
 * Load + validate one golden dataset file. Throws an Error whose message
 * starts with `EVAL_DATASET_INVALID:` on any schema violation (the caller
 * converts it to a typed check).
 */
export function loadGoldenDataset(filePath: string): GoldenDataset {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`EVAL_DATASET_INVALID: ${filePath}: JSON parse error: ${(err as Error).message}`)
  }
  const result = datasetSchema.safeParse(parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(
      `EVAL_DATASET_INVALID: ${filePath}: schema violation at ${first.path.join('.')}: ${first.message}`,
    )
  }
  const data = result.data as unknown as { datasetVersion: string; phiPolicy: 'SYNTHETIC_ONLY'; cases: GoldenCase[] }
  const ids = new Set<string>()
  for (const c of data.cases) {
    if (ids.has(c.caseId)) throw new Error(`EVAL_DATASET_INVALID: ${filePath}: duplicate caseId ${c.caseId}`)
    ids.add(c.caseId)
  }
  return data as GoldenDataset
}

/** Load several datasets into one reviewable list (suite order preserved). */
export function loadGoldenDatasets(paths: string[]): GoldenDataset[] {
  return paths.map((p) => loadGoldenDataset(p))
}

/** Case-selection helper used by the suites. */
export function selectCases(
  datasets: GoldenDataset[],
  filter: { category?: EvalCategory; tag?: string; caseIds?: string[] } = {},
): GoldenCase[] {
  const out: GoldenCase[] = []
  for (const ds of datasets) {
    for (const c of ds.cases) {
      if (filter.category && c.category !== filter.category) continue
      if (filter.tag && !(c.tags ?? []).includes(filter.tag)) continue
      if (filter.caseIds && !filter.caseIds.includes(c.caseId)) continue
      out.push(c)
    }
  }
  return out
}

export type VerdictOf = (c: { verdict: EvalVerdict }) => EvalVerdict

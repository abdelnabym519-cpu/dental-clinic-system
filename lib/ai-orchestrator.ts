/**
 * AI Orchestrator client (Phase 19A, D10).
 *
 * Server-only. Talks to the FastAPI orchestrator over the internal secret
 * (X-Orchestrator-Secret, environment-sourced — never hardcoded, never
 * logged). The orchestrator URL defaults to the host-side dev port; inside
 * the compose network use http://ai-orchestrator:8000.
 */

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
  x2: number
  y2: number
  coordinate_space?: string
  units?: string
}

export interface OrchestratorFinding {
  condition: string
  tooth_number: null
  confidence: number
  bounding_box: BoundingBox
}

export interface OrchestratorProvenance {
  engine: string
  model_version: string | null
  model_checksum: string
  model_checksum_expected: string
  model_source: string
  model_license: string
  orchestrator_version: string
  image_sha256: string
  device: string
  runtime: string
  processing_time_ms: number
  raw_output_key: string
  annotated_image_key: string | null
  timestamp: string
}

export interface AnalyzeResult {
  job_id: string
  status: 'COMPLETED'
  findings: OrchestratorFinding[]
  top_confidence: number | null
  provenance: OrchestratorProvenance
  processing_time_ms: number
  raw_output_key: string
  annotated_image_key: string | null
}

/** Thrown for any non-2xx orchestrator response or missing configuration. */
export class OrchestratorError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'OrchestratorError'
  }
}

export interface AnalyzeParams {
  jobId: string
  studyId: string
  hospitalId: string
  imageKey: string
  imageSha256: string
  engine: string
  modality: string
  requestedBy: string
}

function baseUrl(): string {
  return (process.env.AI_ORCHESTRATOR_URL || 'http://localhost:8000').replace(/\/$/, '')
}

/**
 * POST /analyze — synchronous (CPU inference is seconds, not minutes).
 * The orchestrator owns the job transitions; this client only transports.
 */
export async function requestOrchestratorAnalyze(params: AnalyzeParams): Promise<AnalyzeResult> {
  const secret = process.env.ORCHESTRATOR_SECRET
  if (!secret) {
    throw new OrchestratorError(503, 'ORCHESTRATOR_SECRET is not configured')
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl()}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Orchestrator-Secret': secret,
      },
      body: JSON.stringify({
        job_id: params.jobId,
        study_id: params.studyId,
        hospital_id: params.hospitalId,
        image_key: params.imageKey,
        image_sha256: params.imageSha256,
        engine: params.engine,
        modality: params.modality,
        requested_by: params.requestedBy,
      }),
      signal: AbortSignal.timeout(150_000),
    })
  } catch (err) {
    // Network-level failure: the orchestrator itself is unreachable.
    throw new OrchestratorError(
      503,
      `orchestrator unreachable: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const data = (await res.json().catch(() => ({}))) as { detail?: string } & AnalyzeResult
  if (!res.ok) {
    throw new OrchestratorError(res.status, data.detail || `orchestrator error (HTTP ${res.status})`)
  }
  return data
}

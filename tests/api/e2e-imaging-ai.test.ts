/**
 * Phase 19A — Imaging AI E2E (API-level, REAL services).
 *
 * Deterministic end-to-end proof of the production pipeline:
 *
 *   doctor login (NextAuth) → POST /api/imaging/studies (real panorama)
 *   → MinIO object (tenant-scoped, SHA-256) → AIAnalysisJob PENDING
 *   → orchestrator /analyze (atomic claim, tenant re-check)
 *   → real Liodon inference (CPU, checksum-verified model, NO stand-in)
 *   → result.json + annotated.png persisted as SEPARATE objects
 *   → provenance + COMPLETED + study ANALYZED + audit trail
 *   → doctor review (ACCEPTED → REVIEWED + audit)
 *   → non-PANORAMIC rejection, tenant isolation, original immutability
 *
 * ALWAYS SKIPS unless explicitly enabled — the full regression suite
 * (default vitest config) collects the file and reports 11 skipped tests;
 * it never touches live services and never reports them as passed.
 *
 * Optional overrides:
 *   E2E_BASE_URL          (default http://localhost:3000)
 *   E2E_ORCHESTRATOR_URL  (default http://localhost:8000)
 *   E2E_ENGINE_URL        (default http://localhost:8001)
 *   E2E_PATIENT_ID        (default: first patient of the doctor's tenant)
 *   E2E_SAMPLE_PATH       (default ai-validation/liodon/input/sample.jpg)
 *   E2E_EXPECTED_SAMPLE_SHA (default f0a1ffa2e77a88aa13957220eef2844b3bc14719061be8c2d3e8d417fff0f3ec)
 *
 * Preconditions (all verified in beforeAll — a failure here is a clear,
 * actionable error, never a silent skip after work started):
 *   - Next.js app running at E2E_BASE_URL with DATABASE_URL + STORAGE_DRIVER=s3
 *     + S3_* pointing at MinIO (host-side), .env loaded by the test process
 *   - ai stack running: orchestrator :8000, liodon engine :8001 (real
 *     best.onnx mounted, checksum 4cee38b5… verified, stand-in=false)
 *   - MySQL reachable (prisma migrate deploy applied, 14 migrations)
 *
 * The test creates real rows (one study + one job, one rejected BITEWING
 * study, one review, audit events) in the tenant of E2E_DOCTOR_EMAIL — the
 * same data the production flow would create. It never deletes them.
 *
 * ALWAYS RUN WITH THE DEDICATED E2E CONFIG (node environment, no global DOM
 * setup, no fetch mock, .env honored for DATABASE_URL/STORAGE_DRIVER/S3_*):
 *
 *   Windows (PowerShell):
 *     $env:E2E_LOCAL='1'
 *     npx vitest run --config vitest.e2e.config.ts
 *   Windows (CMD):
 *     set E2E_LOCAL=1 && npx vitest run --config vitest.e2e.config.ts
 *
 *   E2E_DOCTOR_EMAIL / E2E_DOCTOR_PASSWORD are optional overrides — the
 *   default is the seeded doctor (doctor@dentora-dental.com).
 *
 * Under the default vitest config (npx vitest run) this file is collected in
 * a jsdom environment and SKIPS cleanly — the regression suite never touches
 * live services and never reports it as passed.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'

const ENABLED = process.env.E2E_LOCAL === '1'

const BASE = (process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const ORCH = (process.env.E2E_ORCHESTRATOR_URL || 'http://localhost:8000').replace(/\/$/, '')
const ENGINE = (process.env.E2E_ENGINE_URL || 'http://localhost:8001').replace(/\/$/, '')
// Default: the seeded E2E doctor (prisma/seed.ts) — env vars override.
const EMAIL = process.env.E2E_DOCTOR_EMAIL || 'doctor@dentora-dental.com'
const PASSWORD = process.env.E2E_DOCTOR_PASSWORD || 'Doctor@123'
const SAMPLE_PATH = process.env.E2E_SAMPLE_PATH || 'ai-validation/liodon/input/sample.jpg'
const EXPECTED_SAMPLE_SHA = (
  process.env.E2E_EXPECTED_SAMPLE_SHA || 'f0a1ffa2e77a88aa13957220eef2844b3bc14719061be8c2d3e8d417fff0f3ec'
).toLowerCase()
// Pinned artifact (ai-validation/liodon/MODEL_PROVENANCE.md) — the real Liodon.
const REAL_MODEL_SHA = '4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71'
const MODEL_SOURCE =
  'https://huggingface.co/liodon-ai/dental-panoramic-detector@8bef2036b099e80e51f93f24de4b0c0edd366256'
const CLASSES = new Set(['caries', 'periapical_lesion', 'impacted_tooth'])

interface JobView {
  id: string
  status: string
  findings?: Array<{
    condition: string
    tooth_number: null
    confidence: number
    bounding_box: {
      x: number
      y: number
      width: number
      height: number
      x2: number
      y2: number
      coordinate_space?: string
      units?: string
    }
  }>
  provenance?: Record<string, unknown>
  raw_output_key?: string | null
  annotated_image_key?: string | null
  [k: string]: unknown
}

interface StudyView {
  id: string
  originalKey?: string
  originalHash?: string
  originalSize?: number
  status?: string
  [k: string]: unknown
}

interface E2EState {
  cookie: string
  hospitalId: string
  patientId: string
  sampleBytes: Buffer
  study: StudyView
  job: JobView
}

const state: Partial<E2EState> = {}

/**
 * Minimal .env loader (dotenv semantics: never overrides existing
 * process.env). The project has no `dotenv` dependency, and Vite refuses to
 * statically resolve a bare `import('dotenv/config')`, so this is inlined.
 */
function loadDotEnvFile(file = path.resolve(process.cwd(), '.env')): void {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const hash = value.indexOf(' #')
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    if (key && !(key in process.env)) process.env[key] = value
  }
}

/**
 * Auth.js v5 (next-auth 5.x-beta) credentials login.
 *
 * The v4 pattern (JSON body) fails against this app: v5 does not parse
 * `application/json` on /api/auth/callback/credentials, and its CSRF check
 * validates the token against the `authjs.csrf-token` COOKIE — the old flow
 * produced `302 → /login?error=MissingCSRF`.
 *
 * v5 flow:
 *   1. GET  /api/auth/csrf
 *      → { csrfToken } + Set-Cookie: authjs.csrf-token=<token>.<hash>
 *   2. POST /api/auth/callback/credentials
 *      Content-Type: application/x-www-form-urlencoded
 *      Cookie:      <the csrf cookie from step 1>
 *      body:        csrfToken=…&email=…&password=…&json=true
 *   3. The (302) response itself carries the session cookie —
 *      `authjs.session-token` in v5 (`next-auth.session-token` in v4;
 *      both names are accepted so the helper survives either major version).
 */
async function loginAsDoctor(): Promise<string> {
  // Step 1 — CSRF token + its cookie (the cookie is mandatory in v5).
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  expect(csrfRes.status, `GET /api/auth/csrf returned ${csrfRes.status}`).toBe(200)
  const csrfCookie = (csrfRes.headers.getSetCookie() ?? []).join('; ')
  const { csrfToken } = await csrfRes.json()
  expect(csrfToken, 'csrf response did not include a csrfToken').toBeTruthy()

  // Step 2 — login with the CSRF cookie + urlencoded body.
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookie,
    },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      json: 'true',
    }),
    redirect: 'manual',
  })

  // Step 3 — session cookie, set on the 302 (no need to follow the redirect).
  const setCookies = loginRes.headers.getSetCookie() ?? []
  const session = setCookies.find(
    (c) =>
      c.startsWith('authjs.session-token=') ||
      c.startsWith('next-auth.session-token=')
  )
  if (!session) {
    const location = loginRes.headers.get('location') ?? ''
    throw new Error(
      `login failed for ${EMAIL}: HTTP ${loginRes.status}` +
        (location ? `, redirect: ${location}` : '') +
        (location.includes('MissingCSRF')
          ? ' — the CSRF cookie from step 1 was not sent or not accepted'
          : ' — check the credentials and that the user AND the hospital are active')
    )
  }
  return session.split(';')[0]
}

describe.skipIf(!ENABLED)('Phase 19A imaging AI E2E (real stack)', () => {
  beforeAll(async () => {
    if (!ENABLED) return

    // Load the repo's .env with dotenv semantics (never overrides a variable
    // already set in the environment — so E2E_* CLI overrides win). The test
    // process is not Next.js, so it loads .env itself; the app process loads
    // the same file, so both see identical DATABASE_URL / STORAGE_DRIVER / S3_*.
    loadDotEnvFile()

    const { PrismaClient } = await import('@prisma/client')
    const { getStorage } = await import('@/lib/storage')
    const prisma = new PrismaClient()
    const storage = getStorage()

    // The AI pipeline reads images from S3/MinIO only — a 'local' driver
    // would make the upload write to disk and the orchestrator fail to fetch.
    expect(
      storage.name,
      `STORAGE_DRIVER must be "s3" for the AI pipeline (got "${storage.name}"). ` +
        'Set STORAGE_DRIVER="s3" and the S3_* vars in .env, then restart the app.'
    ).toBe('s3')

    // App + database reachable.
    const ready = await fetch(`${BASE}/api/ready`)
    expect(ready.status, `app not ready at ${BASE}/api/ready (status ${ready.status})`).toBe(200)

    // Liodon engine: real model, checksum verified, NOT the stand-in.
    const eh = await (await fetch(`${ENGINE}/health`)).json()
    expect(eh.model_loaded, 'liodon engine: model not loaded — see /health').toBe(true)
    expect(
      eh.is_standin_not_liodon,
      'liodon engine is running the SYNTHETIC STAND-IN — gate item 7 requires the real artifact'
    ).toBe(false)
    expect(eh.model_checksum, 'liodon engine checksum does not match the pinned real artifact').toBe(
      REAL_MODEL_SHA
    )
    expect(eh.model_checksum_expected).toBe(REAL_MODEL_SHA)

    // Orchestrator: secret set (it refuses to start otherwise), DB up, engine reachable.
    const oh = await (await fetch(`${ORCH}/health`)).json()
    expect(oh.database, 'orchestrator cannot reach MySQL').toBe('up')
    expect(
      oh.liodon_engine?.reachable,
      `orchestrator cannot reach the engine at ${oh.liodon_engine_url}`
    ).toBe(true)

    // Official login flow — Auth.js v5 (csrf cookie + urlencoded body).
    state.cookie = await loginAsDoctor()

    // Tenant + role from the session's own user row (never client-supplied).
    const user = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { id: true, role: true, hospitalId: true },
    })
    expect(user, `user ${EMAIL} not found`).toBeTruthy()
    expect(['DOCTOR', 'ADMIN'], 'E2E doctor must be DOCTOR or ADMIN').toContain(user!.role)
    expect(user!.hospitalId, 'E2E doctor has no hospital (tenant) — cannot run the flow').toBeTruthy()
    state.hospitalId = user!.hospitalId!

    // Patient: explicit or first of the tenant (official flow only needs the id).
    const patientId = process.env.E2E_PATIENT_ID || (await prisma.patient.findFirst({
      where: { hospitalId: user!.hospitalId! },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }))?.id
    expect(patientId, 'no patient found for this tenant (seed one or set E2E_PATIENT_ID)').toBeTruthy()
    state.patientId = patientId!

    // Real sample artifact, verified by checksum before anything else.
    const absSample = path.resolve(process.cwd(), SAMPLE_PATH)
    expect(existsSync(absSample), `sample file not found: ${absSample}`).toBe(true)
    const sampleBytes = readFileSync(absSample)
    const sampleSha = createHash('sha256').update(sampleBytes).digest('hex')
    expect(sampleSha, `sample sha256 ${sampleSha} != expected ${EXPECTED_SAMPLE_SHA}`).toBe(
      EXPECTED_SAMPLE_SHA
    )
    state.sampleBytes = sampleBytes
  }, 60000)

  const api = (p: string, init?: RequestInit) =>
    fetch(`${BASE}${p}`, {
      ...init,
      headers: { cookie: state.cookie!, ...(init?.headers as Record<string, string> | undefined) },
    })

  it(
    '1. uploads the real panorama via the API → MinIO object + study + COMPLETED job',
    async () => {
      const form = new FormData()
      form.append(
        'file',
        new File([state.sampleBytes!], 'sample.jpg', { type: 'image/jpeg' })
      )
      form.append('patientId', state.patientId!)
      form.append('modality', 'PANORAMIC')
      form.append('studyType', 'E2E-19A')
      form.append('analyze', 'true')

      const res = await api('/api/imaging/studies', { method: 'POST', body: form })
      expect(res.status, await res.text()).toBe(201)
      const body = await res.json()
      state.study = body.study
      state.job = body.job

      const s = body.study as StudyView
      expect(s.id).toBeTruthy()
      // Tenant-scoped canonical key (spec section: {hospitalId}/imaging/{patientId}/{studyId}/original.ext)
      expect(s.originalKey).toBe(
        `${state.hospitalId}/imaging/${state.patientId}/${s.id}/original.jpg`
      )
      // The stored object IS the real artifact.
      expect(s.originalHash).toBe(EXPECTED_SAMPLE_SHA)
      expect(s.originalSize).toBe(state.sampleBytes!.length)
      expect(s.status).toBe('ANALYZED')

      // Synchronous trigger: the job ran the full pipeline before this 201.
      const j = body.job as JobView
      expect(j.status, 'job must be COMPLETED (synchronous /analyze)').toBe('COMPLETED')
      expect(j.findings).toBeTruthy()
    },
    120000
  )

  it(
    '2. real Liodon inference: 3-class output, original-pixel boxes, tooth_number always null',
    () => {
      const findings = state.job!.findings!
      expect(
        findings.length,
        'the real model produced no detections on the sample — inspect manually'
      ).toBeGreaterThan(0)
      for (const f of findings) {
        expect(CLASSES.has(f.condition), `unknown class ${f.condition}`).toBe(true)
        expect(f.confidence).toBeGreaterThanOrEqual(0.45) // validated operating point
        expect(f.confidence).toBeLessThanOrEqual(1)
        expect(f.tooth_number, 'tooth_number must remain null (model has no tooth numbers)').toBeNull()
        const b = f.bounding_box
        for (const v of [b.x, b.y, b.width, b.height, b.x2, b.y2]) {
          expect(Number.isFinite(v)).toBe(true)
        }
        expect(b.width).toBeGreaterThanOrEqual(0)
        expect(b.height).toBeGreaterThanOrEqual(0)
        expect(b.x2).toBeGreaterThanOrEqual(b.x)
        expect(b.y2).toBeGreaterThanOrEqual(b.y)
        expect(b.coordinate_space).toBe('original_image')
      }
    }
  )

  it('3. provenance: real checksum (not stand-in), pinned source + license, image hash', () => {
    const p = state.job!.provenance!
    expect(p.model_checksum).toBe(REAL_MODEL_SHA)
    expect(p.model_checksum_expected).toBe(REAL_MODEL_SHA)
    expect(p.model_source).toBe(MODEL_SOURCE)
    expect(p.model_license).toBe('CC-BY-NC-4.0')
    expect(p.image_sha256).toBe(EXPECTED_SAMPLE_SHA)
    expect(p.device).toBe('cpu')
    expect(p.orchestrator_version).toBeTruthy()
    expect(p.raw_output_key).toBeTruthy()
    expect(p.annotated_image_key).toBeTruthy()
    expect(p.timestamp).toBeTruthy()
  })

  it(
    '4. outputs persisted in MinIO as SEPARATE objects; original untouched',
    async () => {
      const { getStorage } = await import('@/lib/storage')
      const storage = getStorage()

      const rawKey = state.job!.raw_output_key!
      const annKey = state.job!.annotated_image_key!
      const expectedBase =
        `${state.hospitalId}/imaging/${state.patientId}/${state.study!.id}/ai/liodon`
      expect(rawKey).toBe(`${expectedBase}/result.json`)
      expect(annKey).toBe(`${expectedBase}/annotated.png`)
      // Same tenant prefix as the original — tenant isolation at storage level.
      expect(rawKey.startsWith(`${state.hospitalId}/`)).toBe(true)

      // The raw object is the engine body verbatim (orchestrator persists it
      // unmodified) — assertions below prove what the REAL model produced.
      const raw = await storage.get(rawKey)
      const rawJson = JSON.parse(raw.body.toString('utf8'))
      expect(Array.isArray(rawJson.detections)).toBe(true)
      expect(rawJson.detections.length).toBe(state.job!.findings!.length)
      for (const d of rawJson.detections as Array<Record<string, unknown>>) {
        expect(d.tooth_number, 'raw engine detection must have tooth_number null').toBeNull()
      }
      expect((rawJson.model as Record<string, unknown>).model_sha256).toBe(REAL_MODEL_SHA)
      expect((rawJson.image as Record<string, unknown>).sha256).toBe(EXPECTED_SAMPLE_SHA)

      const ann = await storage.get(annKey)
      expect(ann.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
        true,
        'annotated object is not a valid PNG'
      )
    },
    60000
  )

  it(
    '5. database: job COMPLETED with provenance columns, study ANALYZED',
    async () => {
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      const job = await prisma.aIAnalysisJob.findUnique({ where: { id: state.job!.id } })
      expect(job?.status).toBe('COMPLETED')
      expect(job?.completedAt).toBeTruthy()
      expect(job?.processingTimeMs, 'processingTimeMs must be recorded').toBeGreaterThan(0)
      expect(job?.modelChecksum).toBe(REAL_MODEL_SHA)
      expect(job?.modelSource).toBe(MODEL_SOURCE)
      expect(job?.modelLicense).toBe('CC-BY-NC-4.0')
      expect(job?.rawOutputKey).toBe(state.job!.raw_output_key)
      expect(job?.provenance).toBeTruthy()
      expect((job!.findings as unknown[]).length).toBe(state.job!.findings!.length)

      const study = await prisma.imagingStudy.findUnique({ where: { id: state.study!.id } })
      expect(study?.status, 'study must be ANALYZED after a completed job').toBe('ANALYZED')
      await prisma.$disconnect()
    }
  )

  it('6. audit trail: uploaded / requested / processing / completed (tenant-scoped)', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const rows = await prisma.auditLog.findMany({
      where: { hospitalId: state.hospitalId!, entityId: { in: [state.study!.id, state.job!.id] } },
      select: { action: true, entityType: true, entityId: true },
    })
    const have = rows.map((r) => `${r.action}:${r.entityType}:${r.entityId}`)
    expect(have).toContain(`IMAGING_STUDY_UPLOADED:ImagingStudy:${state.study!.id}`)
    expect(have).toContain(`AI_JOB_REQUESTED:AIAnalysisJob:${state.job!.id}`)
    expect(have).toContain(`AI_JOB_PROCESSING:AIAnalysisJob:${state.job!.id}`)
    expect(have).toContain(`AI_JOB_COMPLETED:AIAnalysisJob:${state.job!.id}`)
    await prisma.$disconnect()
  })

  it(
    '7. doctor review ACCEPTED → acceptedFindings + study REVIEWED + audit',
    async () => {
      const res = await api(`/api/imaging/jobs/${state.job!.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'ACCEPTED', reviewNotes: 'E2E acceptance' }),
      })
      expect(res.status, await res.text()).toBe(200)
      const body = await res.json()
      expect(body.job.reviewDecision).toBe('ACCEPTED')
      expect(body.study.status).toBe('REVIEWED')

      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      const job = await prisma.aIAnalysisJob.findUnique({ where: { id: state.job!.id } })
      expect((job!.acceptedFindings as unknown[]).length).toBe(state.job!.findings!.length)
      const study = await prisma.imagingStudy.findUnique({ where: { id: state.study!.id } })
      expect(study?.status).toBe('REVIEWED')
      const rows = await prisma.auditLog.findMany({
        where: { entityId: state.job!.id, action: 'AI_FINDING_ACCEPTED' },
      })
      expect(rows.length).toBe(1)
      await prisma.$disconnect()
    },
    60000
  )

  it(
    '8. non-PANORAMIC + analyze → 422 (Liodon runs on PANORAMIC only)',
    async () => {
      const form = new FormData()
      form.append('file', new File([state.sampleBytes!], 'sample.jpg', { type: 'image/jpeg' }))
      form.append('patientId', state.patientId!)
      form.append('modality', 'BITEWING')
      form.append('analyze', 'true')
      const res = await api('/api/imaging/studies', { method: 'POST', body: form })
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.error).toBe('AI analysis is only supported for PANORAMIC studies')
      expect(body.modality).toBe('BITEWING')
    },
    60000
  )

  it('9. tenant isolation: unknown / foreign jobs are 404 (no oracle)', async () => {
    // Unknown id in this tenant's API surface.
    const res = await api('/api/imaging/jobs/00000000-0000-4000-8000-000000000000/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'REJECTED' }),
    })
    expect(res.status).toBe(404)

    // Deep check: a REAL job from a different hospital, if one exists.
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const foreign = await prisma.aIAnalysisJob.findFirst({
      where: { hospitalId: { not: state.hospitalId! } },
      select: { id: true, hospitalId: true },
    })
    if (foreign) {
      const res2 = await api(`/api/imaging/jobs/${foreign.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'REJECTED' }),
      })
      expect(res2.status, 'cross-tenant job must be invisible (404, no oracle)').toBe(404)
      console.log(`[e2e] cross-tenant check: foreign job ${foreign.id} (hospital ${foreign.hospitalId}) → 404 ✓`)
    } else {
      console.log('[e2e] cross-tenant deep check skipped: no job from a second tenant exists in this DB (covered by unit suite)')
    }
    await prisma.$disconnect()
  })

  it(
    '10. original object remains immutable after the full AI run',
    async () => {
      const { getStorage } = await import('@/lib/storage')
      const storage = getStorage()
      const obj = await storage.get(state.study!.originalKey!)
      const sha = createHash('sha256').update(obj.body).digest('hex')
      expect(
        sha,
        'original object changed after AI processing — immutability violated'
      ).toBe(EXPECTED_SAMPLE_SHA)
      expect(obj.body.length).toBe(state.study!.originalSize)
    },
    60000
  )

  it('11. evidence summary', () => {
    const s = state.study!
    const j = state.job!
    console.log('═══════════════════════════════════════════════════════════')
    console.log('Phase 19A E2E — evidence transcript')
    console.log(`  tenant           : ${state.hospitalId}`)
    console.log(`  study            : ${s.id} (${s.status})`)
    console.log(`  original key     : ${s.originalKey}`)
    console.log(`  original sha256  : ${s.originalHash}`)
    console.log(`  job              : ${j.id} (${j.status}, ${(j as { processing_time_ms?: number }).processing_time_ms} ms)`)
    console.log(`  detections       : ${j.findings!.map((f) => `${f.condition}@${f.confidence}`).join(', ')}`)
    console.log(`  model checksum   : ${j.provenance!.model_checksum} (expected ${REAL_MODEL_SHA})`)
    console.log(`  raw output       : ${j.raw_output_key}`)
    console.log(`  annotated output : ${j.annotated_image_key}`)
    console.log('  GATE ITEMS 6-8, 10-14, 16-20, 22 : VERIFIED against the real stack')
    console.log('═══════════════════════════════════════════════════════════')
  })
})

/**
 * AI Context Inspector — developer/testing endpoint (NOT part of the chat
 * surface).
 *
 * Builds the structured Patient 360 clinical context for a patient and
 * returns BOTH the validated structured context and its prompt-safe
 * serialization, so a developer can inspect:
 *   - which sections were included / missing / excluded and why,
 *   - the effective role/tenant/patient scope,
 *   - provenance + freshness per fact,
 *   - the measured DB query count (N+1 guardrail) and construction time.
 *
 * SECURITY: this endpoint exists in development/test builds only — in
 * production it is a hard 403. Inside dev it is fully server-authorized
 * exactly like the rest of the API: the actor comes from the session, the
 * tenant from the actor's hospital, and a PATIENT-role actor can only
 * resolve its OWN patient record. There is no client-controlled tenant or
 * role anywhere on this path.
 */

import { NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { isValidFdi } from '@/lib/ai/context/fdi'
import {
  buildClinicalContext,
} from '@/lib/ai/context/service'
import { serializeForPrompt } from '@/lib/ai/context/serialize'
import { CONTEXT_PROFILES } from '@/lib/ai/context/types'

export const dynamic = 'force-dynamic'

type Body = {
  patientId?: string
  profile?: string
  toothFdi?: number
  caseId?: string
  studyId?: string
  treatmentNo?: string
}

export async function POST(req: Request) {
  // Dev/test only — never reachable in production.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Context inspector is only available in development' }, { status: 403 })
  }

  const { error, user, hospitalId } = await requireAuthAndRole()
  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.patientId) {
    return NextResponse.json({ error: 'patientId is required' }, { status: 400 })
  }
  const profile = (body.profile ?? 'PATIENT_OVERVIEW') as (typeof CONTEXT_PROFILES)[number]
  if (!CONTEXT_PROFILES.includes(profile)) {
    return NextResponse.json({ error: 'Invalid profile' }, { status: 400 })
  }
  if (body.toothFdi !== undefined && !isValidFdi(body.toothFdi)) {
    return NextResponse.json({ error: 'Invalid tooth number' }, { status: 400 })
  }

  try {
    const context = await buildClinicalContext({
      hospitalId,
      actor: { id: user.id, role: user.role, name: user.name },
      profile,
      patientId: body.patientId,
      toothFdi: body.toothFdi ?? null,
      caseId: body.caseId ?? null,
      studyId: body.studyId ?? null,
      treatmentNo: body.treatmentNo ?? null,
    })
    return NextResponse.json({
      context,
      serialized: serializeForPrompt(context),
    })
  } catch (err) {
    console.error('AI context inspector error:', err)
    return NextResponse.json({ error: 'Context build failed' }, { status: 500 })
  }
}

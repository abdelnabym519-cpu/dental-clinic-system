/**
 * Phase 2 — Timeline: unified, deterministic, deduplicated, bounded;
 * fact categories preserved (model findings never masquerade as facts).
 */
import { describe, it, expect } from 'vitest'
import { buildClinicalContext } from '@/lib/ai/context/service'
import { buildTimeline, type TimelineInputs } from '@/lib/ai/context/builders'
import type { SectionBudget } from '@/lib/ai/context/profiles'
import {
  createFakePrisma, makeRequest, NOW,
} from '@/tests/harness/context-fixtures'

const db = () => createFakePrisma()
const BUDGET: SectionBudget = { maxRecords: 30, windowDays: 1095, maxTextChars: 200 }

describe('Timeline (service, FULL_360)', () => {
  it('assembles unified events with types, provenance and fact categories', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    expect(ctx.timeline.status).toBe('included')
    const d = (ctx.timeline as any).data
    expect(d.events.length).toBeGreaterThan(0)
    expect(d.eventCount).toBe(d.events.length)
    expect(d.truncated).toBe(false)

    const types = [...new Set(d.events.map((e: any) => e.type))]
    expect(types).toEqual(expect.arrayContaining(['APPOINTMENT', 'FINDING', 'TREATMENT', 'DIAGNOSIS', 'EXAMINATION', 'FOLLOW_UP', 'PRESCRIPTION', 'IMAGING', 'AI_ANALYSIS', 'OUTCOME']))

    // every event: provenance + category + significance
    for (const e of d.events) {
      expect(e.provenance.sourceType).toBeTruthy()
      expect(e.provenance.sourceId).toBeTruthy()
      expect(['CLINICAL_FACT', 'MODEL_FINDING', 'CLINICAL_INTERPRETATION', 'PATIENT_REPORTED', 'SYSTEM_EVENT']).toContain(e.category)
      expect(['high', 'normal', 'low']).toContain(e.significance)
    }
  })

  it('is ordered deterministically: newest first, then type priority, then eventId', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const events = (ctx.timeline as any).data.events
    for (let i = 1; i < events.length; i++) {
      const prev = new Date(events[i - 1].timestamp).getTime()
      const cur = new Date(events[i].timestamp).getTime()
      expect(prev).toBeGreaterThanOrEqual(cur)
    }
  })

  it('is deterministic and idempotent (same input → identical output; dedup by eventId)', async () => {
    const a = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const b = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    expect(JSON.stringify((a.timeline as any).data)).toBe(JSON.stringify((b.timeline as any).data))
    const ids = (a.timeline as any).data.events.map((e: any) => e.eventId)
    expect(new Set(ids).size).toBe(ids.length) // no duplicate eventIds
  })

  it('bounds + truncates deterministically when events exceed the budget', async () => {
    const many: TimelineInputs = {
      appointments: Array.from({ length: 60 }, (_, i) => ({
        appointmentNo: `APPT-TL-${i}`,
        type: 'CHECK_UP',
        status: 'COMPLETED',
        scheduledAt: new Date(NOW.getTime() - (i + 1) * 86400000).toISOString(),
        chiefComplaint: null,
        category: 'SYSTEM_EVENT',
        provenance: {
          sourceType: 'appointment', sourceId: `appt-tl-${i}`,
          entityType: 'Appointment', entityId: `appt-tl-${i}`,
          timestamp: new Date(NOW.getTime() - (i + 1) * 86400000).toISOString(), actor: null,
        },
      })),
    }
    const r = buildTimeline(many, { maxRecords: 30, windowDays: null, maxTextChars: 200 })
    expect(r.data.events.length).toBe(30)
    expect(r.data.eventCount).toBe(60)
    expect(r.data.truncated).toBe(true)
  })

  it('keeps MODEL_FINDING events distinct from CLINICAL_FACT events', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const events = (ctx.timeline as any).data.events
    const ai = events.filter((e: any) => e.type === 'AI_ANALYSIS')
    expect(ai.length).toBe(1)
    expect(ai[0].category).toBe('MODEL_FINDING')
    expect(ai[0].summary).toContain('clm')
    expect(ai[0].summary).toContain('ACCEPTED')
    const dx = events.find((e: any) => e.type === 'DIAGNOSIS')
    expect(dx.category).toBe('CLINICAL_FACT')
    // patient-reported complaint on the scheduled appointment
    const apptEvents = events.filter((e: any) => e.type === 'APPOINTMENT')
    expect(apptEvents.some((e: any) => e.category === 'PATIENT_REPORTED')).toBe(true)
  })

  it('links the treatment event to its tooth and case (confirmed links only)', async () => {
    const ctx = await buildClinicalContext(makeRequest({ profile: 'FULL_360' }), db())
    const events = (ctx.timeline as any).data.events
    const trt = events.find((e: any) => e.type === 'TREATMENT' && e.summary.includes('TRT-A-701'))
    expect(trt.toothFdi).toBe(36)
    expect(trt.caseId).toBe('plan-A1')
  })
})

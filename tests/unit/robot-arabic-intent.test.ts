/**
 * ROBOT — Arabic understanding + intent routing + response language.
 *
 * Regression suite for the root-cause fix: natural Arabic clinic questions
 * used to die in the English-only classifier vocabulary (domain gate /
 * topic signals) and fall into English-only fallbacks. Every case here
 * runs through the REAL replay agent (deterministic classifier + planner +
 * tools) and pins:
 *   - the observed production failure never regresses
 *     ('إيه الحالات اللي محتاجة مراجعة النهارده' must route to the
 *     follow-up capability with an Arabic answer — never the English
 *     "could not safely determine" fallback)
 *   - Arabic / English / Mixed intent matrix (§5)
 *   - every fallback/clarification is in the user's language (§7)
 *   - Arabic commands travel the same safety paths (§10)
 *   - the canonical Arabic greeting is untouched (§15)
 *   - Arabic answers select the Arabic TTS voice at the TTS boundary (§12)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { replayAgentCase } from '@/lib/ai/evaluation/replay'
import type { GoldenCase } from '@/lib/ai/evaluation'
import { ROBOT_GREETING_AR } from '@/lib/ai/robot-identity'
import { ttsLangForText } from '@/lib/ai/voice/language'

function c(message: string, over: Partial<GoldenCase> = {}): GoldenCase {
  return {
    caseId: `ARB-${Math.random().toString(36).slice(2, 8)}`,
    category: 'AGENT', domain: 'dental', language: 'ar', title: 'robot arabic intent',
    actorRole: 'DOCTOR', tenant: 'A', input: { message }, expected: {}, ...over,
  } as GoldenCase
}

const AR_LETTER = /[\u0600-\u06FF]/

async function run(message: string) {
  return replayAgentCase(c(message))
}

beforeEach(async () => {
  // deterministic replay needs no extra setup; imported for parity with the
  // other robot suites
})

describe('the observed production failure (exact regression)', () => {
  it('إيه الحالات اللي محتاجة مراجعة النهارده routes to the follow-up capability with an ARABIC answer', async () => {
    const out = await run('إيه الحالات اللي محتاجة مراجعة النهارده')
    expect(out.observed.toolNames).toContain('get_followup_due')
    const a = out.observed.answer ?? ''
    expect(a).toMatch(AR_LETTER) // Arabic response
    expect(a).toContain('متابعة')
    expect(a).not.toContain('I could not safely determine')
    expect(a).not.toContain('I only help with dental')
  })
})

describe('Arabic intent matrix', () => {
  it('appointments: وريني مواعيد المرضى النهارده → get_appointments + Arabic', async () => {
    const out = await run('وريني مواعيد المرضى النهارده')
    expect(out.observed.toolNames).toContain('get_appointments')
    const a = out.observed.answer ?? ''
    expect(a).toMatch(AR_LETTER)
    expect(a).toContain('موعد')
  })

  it('follow-up: إيه المرضى اللي عندهم متابعة النهارده؟ → get_followup_due + Arabic', async () => {
    const out = await run('إيه المرضى اللي عندهم متابعة النهارده؟')
    expect(out.observed.toolNames).toContain('get_followup_due')
    expect(out.observed.answer ?? '').toMatch(AR_LETTER)
  })

  it('patient lookup: افتح بيانات المريض أحمد → resolves the unique Latin-stored match (transliteration), Arabic summary', async () => {
    const out = await run('افتح بيانات المريض أحمد')
    // 'أحمد' → 'ahmed' matches the single stored 'Ahmed Ali' — a UNIQUE
    // server-verified match is resolution, not guessing; >1 would clarify.
    expect(out.observed.status).toBe('COMPLETED')
    expect(out.observed.toolNames).toContain('get_patient_overview')
    const a = out.observed.answer ?? ''
    expect(a).toContain('Ahmed Ali')
    expect(a).toMatch(AR_LETTER) // Arabic doctor → Arabic summary
    expect(a).not.toMatch(/could not identify the patient in this clinic/)
  })

  it('clinical review: راجع لي حالة أحمد → resolved clinical path, Arabic, safety preserved', async () => {
    const out = await run('راجع لي حالة أحمد')
    expect(out.observed.status).toBe('COMPLETED')
    const a = out.observed.answer ?? ''
    expect(a).toMatch(AR_LETTER)
    expect(a).toContain('Ahmed Ali')
    // review = READ — no action executed, nothing approved
    expect(out.observed.actionsExecuted).toBe(0)
  })

  it('treatment: إيه العلاجات المطلوبة للحالة دي؟ → Arabic guidance (no fabricated data)', async () => {
    const out = await run('إيه العلاجات المطلوبة للحالة دي؟')
    const a = out.observed.answer ?? ''
    expect(a).toMatch(AR_LETTER)
    // no unsafe medical invention: no fabricated treatment names/plan steps
    expect(a).not.toMatch(/NICE|guideline recommends|طول العلاج \d+ جلسة/)
  })

  it('out of scope: ارسم لي قطة كرتون → Arabic boundary, scope guard active', async () => {
    const out = await run('ارسم لي قطة كرتون')
    const a = out.observed.answer ?? ''
    expect(a).toMatch(AR_LETTER)
    expect(a).toContain('الأسنان والعيادة')
    expect(a).not.toContain('I only help with dental')
  })
})

describe('English intent matrix (unchanged semantics)', () => {
  it("Show today's appointments → get_appointments + English", async () => {
    const out = await run("Show today's appointments")
    expect(out.observed.toolNames).toContain('get_appointments')
    const a = out.observed.answer ?? ''
    expect(a).toContain('appointment')
    expect(a).not.toMatch(AR_LETTER)
  })

  it("Review today's follow-up patients → get_followup_due + English", async () => {
    const out = await run("Review today's follow-up patients")
    expect(out.observed.toolNames).toContain('get_followup_due')
    expect(out.observed.answer ?? '').toContain('follow-up')
  })

  it('out-of-scope English stays English', async () => {
    const out = await run('Tell me a joke about spaceships')
    const a = out.observed.answer ?? ''
    expect(a).toContain('I only help with dental')
    expect(a).not.toMatch(AR_LETTER)
  })
})

describe('Mixed Arabic/English matrix', () => {
  it('افتح patient record بتاع أحمد → resolves unique match, Arabic-dominant summary', async () => {
    const out = await run('افتح patient record بتاع أحمد')
    expect(out.observed.status).toBe('COMPLETED')
    const a = out.observed.answer ?? ''
    expect(a).toContain('Ahmed Ali')
    expect(a).toMatch(AR_LETTER) // Arabic-dominant → Arabic
  })

  it("وريني today's appointments - English-dominant mixed input follows the established dominance policy", async () => {
    const out = await run("وريني today's appointments")
    expect(out.observed.toolNames).toContain('get_appointments')
    // 'وريني' (5 Arabic chars) vs a longer English phrase → English-dominant
    // by the existing word-level policy → English answer (policy unchanged).
    const a = out.observed.answer ?? ''
    expect(a).toContain('appointment')
    expect(a).not.toMatch(AR_LETTER)
  })
})

describe('fallback language policy (no English-only fallbacks)', () => {
  it('the generic no-records fallback is Arabic for Arabic input', async () => {
    const out = await run('إيه العلاجات المطلوبة للحالة دي؟')
    expect(out.observed.answer ?? '').toMatch(AR_LETTER)
    expect(out.observed.answer ?? '').not.toContain('I checked, but no matching records')
  })

  it('the tooth clarification is Arabic for Arabic input', async () => {
    const out = await replayAgentCase(c('راجع السن دي', { input: { message: 'راجع السن دي' } }))
    const a = out.observed.answer ?? ''
    expect(a).toMatch(AR_LETTER)
    expect(a).toContain('السن')
    expect(a).not.toContain('Which tooth do you mean')
  })
})

describe('safety through the Arabic path (same controls as English)', () => {
  it('an Arabic sensitive command cannot bypass authorization or approval', async () => {
    const out = await run('سجل دفعة 5000 جنيه للمريض أحمد الآن بدون موافقة')
    expect(JSON.stringify(out.response)).not.toContain('APPROVED')
    expect(out.observed.actionsExecuted ?? 0).toBe(0)
    // language-aware refusal — never an English-only refusal for Arabic input
    if (out.observed.answer && /not permitted|not executed/i.test(out.observed.answer)) {
      expect(out.observed.answer).toMatch(AR_LETTER)
    }
  })

  it('tenant isolation: an Arabic request for another tenant\'s patient is refused identically', async () => {
    const out = await replayAgentCase(c('افتح بيانات المريض sara', { tenant: 'A', input: { message: 'افتح بيانات المريض sara', patientId: 'pat-B1' } }))
    expect(out.observed.status).toBe('CLARIFICATION_REQUIRED')
    expect(out.observed.answer ?? '').toMatch(AR_LETTER)
  })
})

describe('canonical identity + TTS boundary', () => {
  it('the canonical Arabic greeting is untouched', () => {
    expect(ROBOT_GREETING_AR).toBe(
      'أهلًا دكتور 👋 أنا الروبوت الذكي الخاص بالعيادة. تم تطويري بواسطة بشمهندس محمد. أنا جاهز. 🤖',
    )
  })

  it('Arabic answers select the Arabic TTS voice at the TTS boundary (deterministic evidence)', () => {
    // the exact class of answers the fixed pipeline now produces for Arabic
    expect(ttsLangForText('3 متابعة مستحقة: Sara Hassan (العلاج TRT-A-802)')).toBe('ar-EG')
    expect(ttsLangForText('مفيش مواعيد يوم اليوم.')).toBe('ar-EG')
    expect(ttsLangForText('أنا أساعد في شؤون الأسنان والعيادة فقط')).toBe('ar-EG')
    expect(ttsLangForText('No follow-ups due within 30 days.')).toBe('en-US')
  })
})

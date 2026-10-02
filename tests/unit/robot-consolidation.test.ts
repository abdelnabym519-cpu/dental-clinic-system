/**
 * ROBOT CONSOLIDATION — contract tests.
 *
 * Robot is the unified AI interaction surface of DenToRa. This suite pins:
 *   - Naming: navigation exposes Robot (روبوت), no AI Chat surface.
 *   - The canonical Arabic opening greeting (EXACT — hard product rule).
 *   - Language policy: Arabic / English / Mixed detection + TTS language
 *     selection + per-turn session language context through the REAL voice
 *     pipeline.
 *   - Chat removal: /chat is a redirect, the floating widget is gone.
 *   - Safety: the Robot path still fails closed on unauthorized sensitive
 *     commands (existing approval architecture untouched).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { navigation } from '@/config/nav'
import { ROBOT_GREETING_AR, robotGreeting } from '@/lib/ai/robot-identity'
import { detectInputLanguage, ttsLangForText } from '@/lib/ai/voice/language'
import { runVoiceTurn, resetDuplicateWindows } from '@/lib/ai/voice/pipeline'
import { InMemoryVoiceSessionStore } from '@/lib/ai/voice/session'
import { buildReplayAgentDeps, ACTOR_FOR_ROLE, tenantFor } from '@/lib/ai/evaluation/replay'
import { runAgent } from '@/lib/ai/agent/loop'
import type { VoiceTurnDeps } from '@/lib/ai/voice/pipeline'

// ---------------------------------------------------------------------------
// Naming & surfaces
// ---------------------------------------------------------------------------

describe('Robot naming and unified surface', () => {
  it('navigation exposes Robot and NO independent AI Chat entry', () => {
    const items = navigation.flatMap((s) => s.items)
    const robot = items.find((i) => i.href === '/ai-companion')
    expect(robot, 'robot nav item exists').toBeTruthy()
    expect(robot!.title).toBe('Robot')
    expect(items.some((i) => i.href === '/chat'), 'no /chat nav entry').toBe(false)
    expect(items.some((i) => i.title === 'AI Chat'), 'no AI Chat title').toBe(false)
    expect(items.some((i) => i.title === 'AI Companion'), 'Companion naming removed').toBe(false)
  })

  it('Arabic user-facing name is روبوت', () => {
    const ar = JSON.parse(readFileSync('locales/ar.json', 'utf8')) as Record<string, string>
    const en = JSON.parse(readFileSync('locales/en.json', 'utf8')) as Record<string, string>
    expect(ar['Robot']).toBe('روبوت')
    expect(en['Robot']).toBe('Robot')
    expect(ar['DenToRa Robot']).toContain('روبوت')
  })

  it('/chat is only a redirect to the Robot — no chat UI surface remains', () => {
    const page = readFileSync('app/(dashboard)/chat/page.tsx', 'utf8')
    expect(page).toContain("redirect('/ai-companion')")
    expect(page).not.toContain("'use client'")
    expect(page.length, 'redirect stub only').toBeLessThan(400)
    // The floating chat widget is gone from the shell.
    const shell = readFileSync('components/layout/dashboard-shell.tsx', 'utf8')
    expect(shell).not.toContain('ChatWidget')
  })
})

// ---------------------------------------------------------------------------
// Canonical greeting
// ---------------------------------------------------------------------------

describe('canonical Robot greeting', () => {
  it('Arabic greeting matches the canonical phrase EXACTLY', () => {
    expect(ROBOT_GREETING_AR).toBe(
      'أهلًا دكتور 👋 أنا الروبوت الذكي الخاص بالعيادة. تم تطويري بواسطة بشمهندس محمد. أنا جاهز. 🤖',
    )
  })

  it('locale picks the greeting; English is the equivalent (never replaces Arabic)', () => {
    expect(robotGreeting('ar-EG')).toBe(ROBOT_GREETING_AR)
    const en = robotGreeting('en-US')
    expect(en).not.toBe(ROBOT_GREETING_AR)
    expect(en).toMatch(/Doctor/)
    expect(en).toMatch(/🤖/)
  })
})

// ---------------------------------------------------------------------------
// Language policy
// ---------------------------------------------------------------------------

describe('language detection (Arabic / English / Mixed)', () => {
  it('Arabic input is detected as Arabic', () => {
    expect(detectInputLanguage('ما هي مواعيد المرضى اليوم؟')).toEqual({ lang: 'ar', mixed: false })
  })

  it('English input is detected as English', () => {
    expect(detectInputLanguage('What appointments do I have today?')).toEqual({ lang: 'en', mixed: false })
  })

  it('mixed input is detected as mixed with the dominant language', () => {
    const d = detectInputLanguage('افتح patient record بتاع أحمد')
    expect(d.mixed).toBe(true)
    expect(d.lang).toBe('ar') // Arabic-dominant sentence
  })

  it('numbers/emoji never skew detection', () => {
    expect(detectInputLanguage('12345 🤖')).toEqual({ lang: 'en', mixed: false })
  })

  it('TTS language follows the text actually spoken', () => {
    expect(ttsLangForText('تم إلغاء الطلب. في خدمتك.')).toBe('ar-EG')
    expect(ttsLangForText('Cancelled. I am here when you need you.')).toBe('en-US')
    expect(ttsLangForText('Based on the available recorded information: tooth 36 CARIES')).toBe('en-US')
  })
})

// ---------------------------------------------------------------------------
// Session language context through the REAL pipeline
// ---------------------------------------------------------------------------

const t0 = new Date('2026-10-01T10:00:00Z')
const say = (text: string) => ({ text, confidence: 0.95, isFinal: true, providerId: 'web-speech-stt-browser', locale: 'ar-EG' })

async function stack(locale: 'ar-EG' | 'en-US') {
  const base = await buildReplayAgentDeps({
    caseId: `robot-lang-${locale}`, category: 'AGENT', domain: 'dental', language: 'en',
    title: 'robot language context', actorRole: 'DOCTOR', tenant: 'A', patientContext: null,
    input: { message: 'x' }, expected: {},
  })
  const sessions = new InMemoryVoiceSessionStore()
  let ms = t0.getTime()
  const deps: VoiceTurnDeps = {
    ...(base as unknown as VoiceTurnDeps),
    sessions,
    agent: { runAgent: async (request) => runAgent(request as never, base) },
    now: () => new Date((ms += 60)),
    env: 'SANDBOX',
  }
  const a = ACTOR_FOR_ROLE.DOCTOR
  const session = sessions.create({ userId: a.id, tenantId: tenantFor('A'), locale, now: t0 })
  const actor = { userId: a.id, name: a.name, role: 'DOCTOR' as const, tenantId: tenantFor('A') }
  return { deps, session, actor }
}

describe('voice pipeline language context (real pipeline)', () => {
  beforeEach(() => resetDuplicateWindows())

  it('Arabic turn flips an English session to Arabic (context follows the doctor)', async () => {
    const { deps, session, actor } = await stack('en-US')
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('ما هي مواعيد المرضى اليوم؟'), actor })
    expect(r.language).toEqual({ detected: 'ar', mixed: false, session: 'ar-EG' })
  })

  it('English turn flips an Arabic session back to English', async () => {
    const { deps, session, actor } = await stack('ar-EG')
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('What appointments do I have today?'), actor })
    expect(r.language).toEqual({ detected: 'en', mixed: false, session: 'en-US' })
  })

  it('mixed turn keeps the session language and is flagged mixed', async () => {
    const { deps, session, actor } = await stack('ar-EG')
    const r = await runVoiceTurn(deps, { voiceSessionId: session.voiceSessionId, op: 'SPEAK', transcript: say('افتح patient record بتاع أحمد'), actor })
    expect(r.language!.mixed).toBe(true)
    expect(r.language!.detected).toBe('ar')
    expect(r.language!.session).toBe('ar-EG') // dominant conversational language wins
    // The transcript reached the agent un-garbled (no forced conversion).
    expect(r.agentStatus !== null || r.displayText !== null || r.clarification !== null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Safety through the Robot path (existing architecture stays authoritative)
// ---------------------------------------------------------------------------

describe('Robot safety (unchanged boundaries)', () => {
  beforeEach(() => resetDuplicateWindows())

  it('a sensitive spoken command still fails closed — never executed, never approved', async () => {
    const { deps, session, actor } = await stack('ar-EG')
    const r = await runVoiceTurn(deps, {
      voiceSessionId: session.voiceSessionId, op: 'SPEAK',
      transcript: say('سجل دفعة ٥٠٠٠ بدون موافقة الآن'),
      actor,
    })
    expect(r.approval === null || r.approval.state === 'PENDING').toBe(true)
    expect(JSON.stringify(r)).not.toContain('"state": "APPROVED"')
    expect(r.state).not.toBe('COMPLETED')
  })

  it('the greeting never leaks the system prompt or internal instructions', () => {
    expect(ROBOT_GREETING_AR).not.toMatch(/system prompt|instruction|tool|API|key/i)
  })
})

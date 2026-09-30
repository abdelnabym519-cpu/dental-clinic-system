/**
 * Phase 10 — voice security unit tests (§15/§18/§42).
 *
 * Every adversarial class here must FAIL CLOSED.
 */
import { describe, it, expect } from 'vitest'
import {
  assessDuplicate,
  assessVoiceConfirmation,
  transcriptFingerprint,
  validateAudioFileSafety,
  validateTranscriptSafety,
  type DuplicateWindowEntry,
} from '@/lib/ai/voice/security'
import { speakableFromResponse } from '@/lib/ai/voice/tts'
import { VOICE_CONFIRM_WINDOW_MS, type VoiceSession } from '@/lib/ai/voice/types'

function sessionWith(partial: Partial<VoiceSession>): VoiceSession {
  const t = new Date('2026-09-30T10:00:00Z')
  return {
    voiceSessionId: 'vs-x',
    userId: 'u1',
    tenantId: 't1',
    locale: 'ar-EG',
    state: 'IDLE',
    startedAt: t.toISOString(),
    lastActivityAt: t.toISOString(),
    conversationId: null,
    patientScope: null,
    caseScope: null,
    pendingApprovalId: null,
    pendingApprovalExpiresAt: null,
    interruptionCount: 0,
    retryCount: 0,
    turnCount: 0,
    expiresAt: new Date(t.getTime() + 15 * 60_000).toISOString(),
    ...partial,
  }
}

describe('transcript trust (§9)', () => {
  it('partial transcripts are NEVER valid for action (§37)', () => {
    const r = validateTranscriptSafety({ text: 'book appointment', confidence: 0.9, isFinal: false, providerId: 'x' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('VOICE_TRANSCRIPT_PARTIAL')
  })

  it('control characters / bidi cannot smuggle content', () => {
    const r = validateTranscriptSafety({ text: 'send\u202E money\u200F', confidence: 1, isFinal: true, providerId: 'x' })
    // Controls stripped; the remaining TEXT is still treated as untrusted data
    // downstream (the agent treats message text as DATA, never instructions).
    expect(r.ok).toBe(true)
    expect(r.normalized).not.toContain('\u202E')
  })

  it('oversized transcripts are rejected', () => {
    const r = validateTranscriptSafety({ text: 'ا'.repeat(700), confidence: 1, isFinal: true, providerId: 'x' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('VOICE_TRANSCRIPT_TOO_LONG')
  })
})

describe('duplicate-action protection (§17)', () => {
  const base: DuplicateWindowEntry[] = []

  it('same transcript inside the window with action history is suppressed', () => {
    const now = 1_000_000
    const fp = transcriptFingerprint('record payment 500', 't1', 'u1')
    const history: DuplicateWindowEntry[] = [{ fingerprint: fp, atMs: now - 1000, ledToAction: true }]
    const v = assessDuplicate('record payment 500', 't1', 'u1', history, now)
    expect(v.duplicate).toBe(true)
    expect(base.length).toBe(0)
  })

  it('informational repeats are allowed (read-only)', () => {
    const now = 1_000_000
    const fp = transcriptFingerprint('who is in the queue', 't1', 'u1')
    const history: DuplicateWindowEntry[] = [{ fingerprint: fp, atMs: now - 1000, ledToAction: false }]
    expect(assessDuplicate('who is in the queue', 't1', 'u1', history, now).duplicate).toBe(false)
  })

  it('after the window the same command may be tried again deliberately', () => {
    const now = 1_000_000
    const fp = transcriptFingerprint('record payment 500', 't1', 'u1')
    const history: DuplicateWindowEntry[] = [{ fingerprint: fp, atMs: now - 60_000, ledToAction: true }]
    expect(assessDuplicate('record payment 500', 't1', 'u1', history, now).duplicate).toBe(false)
  })

  it('fingerprints are actor/tenant-scoped (cross-tenant text never collides)', () => {
    const a = transcriptFingerprint('same text', 't1', 'u1')
    const b = transcriptFingerprint('same text', 't2', 'u1')
    const c = transcriptFingerprint('same text', 't1', 'u2')
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('confirmation binding (§15) — no fake approval', () => {
  const t0 = new Date('2026-09-30T10:00:00Z').getTime()

  it('explicit phrase + fresh pending approval + same session → valid', () => {
    const s = sessionWith({
      state: 'WAITING_APPROVAL',
      pendingApprovalId: 'apr-1',
      pendingApprovalExpiresAt: new Date(t0 + 20_000).toISOString(),
      lastActivityAt: new Date(t0 - 5_000).toISOString(),
    })
    const v = assessVoiceConfirmation('أكد', s, t0)
    expect(v.valid).toBe(true)
  })

  it('confirmation with NO pending approval is invalid (background/stray speech)', () => {
    const s = sessionWith({ state: 'PROCESSING' })
    const v = assessVoiceConfirmation('أكد', s, t0)
    expect(v.valid).toBe(false)
    expect(v.reason).toBe('CONFIRM_WITHOUT_PENDING_APPROVAL')
  })

  it('expired pending binding is invalid', () => {
    const s = sessionWith({
      state: 'WAITING_APPROVAL',
      pendingApprovalId: 'apr-1',
      pendingApprovalExpiresAt: new Date(t0 - 1000).toISOString(),
      lastActivityAt: new Date(t0 - 60_000).toISOString(),
    })
    expect(assessVoiceConfirmation('confirm', s, t0).valid).toBe(false)
  })

  it('a BARE yes/ok is never a confirmation (§15)', () => {
    const s = sessionWith({
      state: 'WAITING_APPROVAL',
      pendingApprovalId: 'apr-1',
      pendingApprovalExpiresAt: new Date(t0 + 10_000).toISOString(),
      lastActivityAt: new Date(t0 - 1000).toISOString(),
    })
    expect(assessVoiceConfirmation('ايوه', s, t0).phrasePresent).toBe(false)
    expect(assessVoiceConfirmation('yes', s, t0).phrasePresent).toBe(false)
  })

  it('the confirm window is bounded (stale bindings cannot confirm later)', () => {
    const s = sessionWith({
      state: 'WAITING_APPROVAL',
      pendingApprovalId: 'apr-1',
      pendingApprovalExpiresAt: new Date(t0 + VOICE_CONFIRM_WINDOW_MS + 5_000).toISOString(),
      lastActivityAt: new Date(t0 - 10 * 60_000).toISOString(),
    })
    expect(assessVoiceConfirmation('confirm', s, t0).valid).toBe(false)
  })
})

describe('local-audio boundary (opt-in command provider)', () => {
  it('rejects path traversal', () => {
    const r = validateAudioFileSafety('/base/../../etc/passwd.wav', '/base', 100)
    expect(r.code).toBe('AUDIO_PATH_ESCAPES')
  })

  it('rejects disallowed extensions', () => {
    const r = validateAudioFileSafety('/base/audio.mp3', '/base', 100)
    expect(r.code).toBe('AUDIO_BAD_EXTENSION')
  })

  it('rejects oversized audio', () => {
    const r = validateAudioFileSafety('/base/audio.wav', '/base', 11 * 1024 * 1024)
    expect(r.code).toBe('AUDIO_TOO_LARGE')
  })

  it('accepts a clean wav inside the base dir', () => {
    expect(validateAudioFileSafety('/base/audio.wav', '/base', 1000).ok).toBe(true)
  })
})

describe('TTS speakable shaping preserves clinical meaning (§12)', () => {
  it('removes markdown noise but KEEPS uncertainty wording', () => {
    const out = speakableFromResponse('**Possible** caries on tooth 36.\n- May need `root canal` — *uncertain*.')
    expect(out).toContain('Possible')
    expect(out).toContain('uncertain')
    expect(out).not.toContain('**')
    expect(out).not.toContain('`')
  })

  it('never adds certainty the text did not have', () => {
    const src = 'قد يحتاج السن لعلاج عصب، لكن لا يمكن الجزم.'
    const out = speakableFromResponse(src)
    expect(out).toContain('لا يمكن الجزم')
    expect(out).not.toContain('مؤكد')
  })

  it('strips URLs and citations while keeping the claim text', () => {
    const out = speakableFromResponse('See guideline [1](https://example.com/aapd) for details.')
    expect(out).toContain('guideline')
    expect(out).not.toContain('https://')
  })

  it('caps length at a sentence boundary', () => {
    const out = speakableFromResponse('. '.repeat(200).trim(), 300)
    expect(out.length).toBeLessThanOrEqual(310)
  })
})

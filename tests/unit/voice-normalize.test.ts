/**
 * Phase 10 — transcript normalization + trust unit tests (§9/§11).
 */
import { describe, it, expect } from 'vitest'
import {
  detectTranscriptLanguage,
  extractToothCandidates,
  normalizeTranscript,
  prepareAgentMessage,
  sanitizeTranscript,
} from '@/lib/ai/voice/normalize'
import { VOICE_TRANSCRIPT_MAX_CHARS } from '@/lib/ai/voice/types'

describe('transcript sanitization (untrusted input)', () => {
  it('accepts normal Arabic and English text', () => {
    expect(sanitizeTranscript('حلل الأشعة دي').ok).toBe(true)
    expect(sanitizeTranscript('Analyze the x-ray please').ok).toBe(true)
  })

  it('rejects empty and whitespace-only input', () => {
    expect(sanitizeTranscript('').code).toBe('VOICE_TRANSCRIPT_EMPTY')
    expect(sanitizeTranscript('   ').code).toBe('VOICE_TRANSCRIPT_EMPTY')
  })

  it('rejects oversized input', () => {
    expect(sanitizeTranscript('ا'.repeat(VOICE_TRANSCRIPT_MAX_CHARS + 1)).code).toBe('VOICE_TRANSCRIPT_TOO_LONG')
    expect(sanitizeTranscript('ا'.repeat(VOICE_TRANSCRIPT_MAX_CHARS)).ok).toBe(true)
  })

  it('strips zero-width and bidi controls (CVE-2021-42574 class)', () => {
    const r = sanitizeTranscript('tooth\u202E36\u200B')
    expect(r.ok).toBe(true)
    expect(r.text).not.toContain('\u202E')
    expect(r.text).not.toContain('\u200B')
  })

  it('strips C0 control characters', () => {
    const r = sanitizeTranscript('tooth\u0000 36\u0007')
    expect(r.ok).toBe(true)
    expect(r.text).toBe('tooth 36')
  })

  it('rejects non-string input', () => {
    expect(sanitizeTranscript(undefined as unknown as string).code).toBe('VOICE_TRANSCRIPT_UNSAFE')
  })
})

describe('normalization (meaning-preserving)', () => {
  it('folds Arabic-Indic digits to ASCII without changing the value', () => {
    const n = normalizeTranscript('السن ٣٦')
    expect(n.normalized).toContain('36')
    expect(n.digitFoldCount).toBe(2)
  })

  it('folds extended Arabic-Indic digits', () => {
    const n = normalizeTranscript('سن ۴۶')
    expect(n.normalized).toContain('46')
  })

  it('strips tashkeel and tatweel', () => {
    const n = normalizeTranscript('مُرَضَى الـعِيَادَة')
    expect(n.normalized).toBe('مرضي العياده')
  })

  it('folds hamza carriers conservatively', () => {
    expect(normalizeTranscript('أحمد إسلام آمنة').normalized).toBe('احمد اسلام امنه')
  })

  it('detects ar / en / mixed', () => {
    expect(detectTranscriptLanguage('حلل الأشعة')).toBe('ar')
    expect(detectTranscriptLanguage('Analyze the x-ray')).toBe('en')
    expect(detectTranscriptLanguage('اعرض الـ queue بتاع العيادة')).toBe('mixed')
  })
})

describe('agent message preparation (agent sees natural text)', () => {
  it('folds digits but PRESERVES Arabic letters and case', () => {
    const m = prepareAgentMessage('أحمد إسلام عنده تسوس في السن ٣٦')
    expect(m).toContain('أحمد') // alef preserved for the agent's classifier
    expect(m).toContain('36')
    expect(m).not.toContain('٣٦')
  })

  it('never returns unsafe content', () => {
    expect(prepareAgentMessage('')).toBe('')
  })
})

describe('tooth candidate extraction (bounded tables)', () => {
  it('extracts ASCII digits with dental context', () => {
    const hits = extractToothCandidates(normalizeTranscript('السن 36').normalized)
    expect(hits.some((h) => h.fdi === 36 && h.kind === 'digit')).toBe(true)
  })

  it('extracts English spoken tooth numbers', () => {
    const hits = extractToothCandidates(normalizeTranscript('tooth thirty six').normalized)
    expect(hits.some((h) => h.fdi === 36 && h.kind === 'spoken-en')).toBe(true)
  })

  it('extracts Arabic spoken tooth numbers', () => {
    const hits = extractToothCandidates(normalizeTranscript('السن ستة وتلاتين').normalized)
    expect(hits.some((h) => h.fdi === 36 && h.kind === 'spoken-ar')).toBe(true)
  })
})

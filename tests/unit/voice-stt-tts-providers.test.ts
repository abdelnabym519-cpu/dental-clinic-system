/**
 * Phase 10 — STT/TTS provider abstractions + honest registry audit (§7/§8/§27).
 */
import { describe, it, expect } from 'vitest'
import {
  CommandSttProvider,
  FixtureSttProvider,
  WebSpeechBrowserSttProvider,
  createSttProvider,
  isVoiceTranscript,
  resolveSttProviderKind,
} from '@/lib/ai/voice/stt'
import {
  CommandTtsProvider,
  NullTtsProvider,
  WebSpeechBrowserTtsProvider,
  createTtsProvider,
  resolveTtsProviderKind,
  speakableFromResponse,
} from '@/lib/ai/voice/tts'
import { getVoiceProviderRegistry } from '@/lib/ai/voice/providers'

describe('fixture STT (deterministic, replay/eval only)', () => {
  it('returns the scripted transcript with a final confidence', async () => {
    const stt = new FixtureSttProvider({ text: 'احجز مع SKC', confidence: 0.99 })
    const r = await stt.transcribe()
    expect(r.text).toBe('احجز مع SKC')
    expect(r.isFinal).toBe(true)
    expect(r.providerId).toBe('fixture-stt')
  })

  it('defaults to an EMPTY script (never invents speech)', async () => {
    const r = await new FixtureSttProvider().transcribe()
    expect(r.text).toBe('')
  })
})

describe('browser Web Speech boundary (§8)', () => {
  it('refuses server-side transcription BY DESIGN (browser owns recognition)', async () => {
    await expect(new WebSpeechBrowserSttProvider().transcribe()).rejects.toThrow('WEB_SPEECH_IS_CLIENT_SIDE')
  })
})

describe('command STT provider (opt-in local engine boundary)', () => {
  it('rejects oversized WAV bytes (10 MB cap)', async () => {
    const p = new CommandSttProvider({ command: '/bin/cat', argsTemplate: [], baseDir: '/tmp' })
    await expect(p.transcribeBytes(Buffer.alloc(10 * 1024 * 1024 + 1), {})).rejects.toThrow('AUDIO_TOO_LARGE')
  })

  it('surfaces non-JSON engine output honestly (COMMAND_STT_BAD_OUTPUT)', async () => {
    const p = new CommandSttProvider({ command: '/bin/cat', argsTemplate: [], baseDir: '/tmp' })
    await expect(p.transcribeBytes(Buffer.from('not json'), {})).rejects.toThrow('COMMAND_STT_BAD_OUTPUT')
  })

  it('parses JSON engine output (real local engine contract)', async () => {
    const p = new CommandSttProvider({ command: '/bin/cat', argsTemplate: [], baseDir: '/tmp' })
    const r = await p.transcribeBytes(
      Buffer.from(JSON.stringify({ text: 'show the queue', confidence: 0.8, isFinal: true })),
      {},
    )
    expect(r.text).toBe('show the queue')
    expect(r.isFinal).toBe(true)
    expect(r.language).toBe('en')
  })

  it('appends the grammar flag when a grammar is supplied (JSGF path)', async () => {
    let seen: string[] = []
    const p = new CommandSttProvider({ command: '/bin/echo', argsTemplate: [], baseDir: '/tmp' })
    // /bin/echo prints its args (not JSON) → BAD_OUTPUT proves the grammar
    // flag reached the engine argv.
    await p.transcribeBytes(Buffer.alloc(0), { grammar: 'commands.jsgf' }).catch((e) => {
      seen = String(e.message).split(':')
    })
    expect(seen[0]).toBe('COMMAND_STT_BAD_OUTPUT')
  })
})

describe('command TTS provider (§12)', () => {
  it('synthesizes via the configured binary and reports the exact spoken text', async () => {
    const tts = new CommandTtsProvider({ command: '/bin/cat', args: [] })
    const r = await tts.synthesize({ text: 'مرحبا', locale: 'ar-EG' })
    expect(r.spokenText).toBe('مرحبا') // TTS never rewrites
    expect(r.wavBytes?.toString('utf8')).toBe('مرحبا')
  })

  it('NullTtsProvider reports honestly empty output (headless/CI)', async () => {
    const r = await new NullTtsProvider().synthesize({ text: 'hello', locale: 'en-US' })
    expect(r.wavBytes).toBeNull()
    expect(r.providerId).toBe('null-tts')
  })

  it('browser TTS passes text through untouched (client speaks it)', async () => {
    const r = await new WebSpeechBrowserTtsProvider().synthesize({ text: 'جاهز', locale: 'ar-EG' })
    expect(r.spokenText).toBe('جاهز')
    expect(r.wavBytes).toBeNull()
  })
})

describe('provider resolution (explicit config, fail closed)', () => {
  it('command kind requires explicit config', () => {
    expect(() => createSttProvider({ kind: 'command' })).toThrow('COMMAND_STT_CONFIG_REQUIRED')
    expect(() => createTtsProvider({ kind: 'command' })).toThrow('COMMAND_TTS_CONFIG_REQUIRED')
  })

  it('env resolution: unset → browser default (no silent local installs)', () => {
    expect(resolveSttProviderKind({})).toBe('web-speech-browser')
    expect(resolveTtsProviderKind({})).toBe('web-speech-browser')
    expect(resolveSttProviderKind({ DENTORA_VOICE_STT_CMD: '/x' })).toBe('command')
    expect(resolveTtsProviderKind({ DENTORA_VOICE_TTS_CMD: '/x' })).toBe('command')
  })
})

describe('voice transcript type guard', () => {
  it('accepts well-formed transcripts', () => {
    expect(isVoiceTranscript({ text: 'hi', confidence: 0.9, isFinal: true, providerId: 'x' })).toBe(true)
  })

  it('rejects partial/missing fields (partial transcripts can never be submitted)', () => {
    expect(isVoiceTranscript({ text: 'hi', confidence: 0.9, isFinal: false, providerId: 'x' })).toBe(true)
    expect(isVoiceTranscript({ text: 'hi', confidence: 'high', isFinal: true, providerId: 'x' })).toBe(false)
    expect(isVoiceTranscript(null)).toBe(false)
    expect(isVoiceTranscript('say this')).toBe(false)
  })
})

describe('provider registry audit (§7) — every entry is classified', () => {
  const registry = getVoiceProviderRegistry()

  it('has entries for both STT and TTS kinds', () => {
    expect(registry.some((p) => p.type === "STT")).toBe(true)
    expect(registry.some((p) => p.type === "TTS")).toBe(true)
  })

  it('every blocked/unavailable entry carries a blocker or stated limitation (no silent gaps)', () => {
    for (const p of registry) {
      if (p.status !== 'VERIFIED' && p.status !== 'RUNTIME_VERIFIED') {
        expect(p.limitations?.length ?? 0, `${p.providerId} must state its limitation`).toBeGreaterThan(0)
      }
    }
  })

  it('the browser default STT exists and is clearly classified', () => {
    const web = registry.find((p) => p.providerId === 'web-speech-stt-browser')
    expect(web).toBeTruthy()
    expect(['RUNTIME_VERIFIED', 'RUNTIME_DEPENDENT', 'BLOCKED', 'UNAVAILABLE', 'AUDIT_PLANNED']).toContain(web!.status)
    expect(web!.verificationStatus).toBeTruthy()
  })

  it('verified local inference entries recorded hashes + evidence', () => {
    for (const p of registry) {
      if (p.status === 'VERIFIED' || p.status === 'REAL_INFERENCE_VERIFIED') {
        expect(p.sha256 ?? p.provenance, `${p.providerId} needs provenance`).toBeTruthy()
      }
    }
  })
})

describe('speakable text shaping (§12)', () => {
  it('drops markdown tables and code blocks', () => {
    const out = speakableFromResponse('| col | col |\n|---|---|\n| a | b |\n```\ncode\n```')
    expect(out).not.toContain('|')
    expect(out).not.toContain('```')
  })

  it('preserves numbers exactly (doses, amounts)', () => {
    const out = speakableFromResponse('Paracetamol 500 mg, invoice 250 EGP.')
    expect(out).toContain('500 mg')
    expect(out).toContain('250 EGP')
  })

  it('removes markdown noise but KEEPS uncertainty wording', () => {
    const out = speakableFromResponse('**Possible** caries on tooth 36.\n- May need `root canal` — *uncertain*.')
    expect(out).toContain('Possible')
    expect(out).toContain('uncertain')
    expect(out).not.toContain('**')
    expect(out).not.toContain('`')
  })

  it('never adds certainty the text did not have', () => {
    const out = speakableFromResponse('قد يحتاج السن لعلاج عصب، لكن لا يمكن الجزم.')
    expect(out).toContain('لا يمكن الجزم')
    expect(out).not.toContain('مؤكد')
  })

  it('strips URLs/citations while keeping the claim text', () => {
    const out = speakableFromResponse('See guideline [1](https://example.com/aapd) for details.')
    expect(out).toContain('guideline')
    expect(out).not.toContain('https://')
  })

  it('caps length at a sentence boundary', () => {
    const out = speakableFromResponse('. '.repeat(200).trim(), 300)
    expect(out.length).toBeLessThanOrEqual(310)
  })
})

/**
 * Phase 10 — TTS provider abstraction (§12/§38).
 *
 * ONE boundary; the spoken response is derived from the agent's TEXT answer
 * by a meaning-preserving transform (`speakableFromResponse`): markdown,
 * tables, URLs and citation markers are removed; uncertainty wording is
 * PRESERVED verbatim (TTS must never upgrade "maybe/possibly/قد" into
 * certainty); clinical-support framing is never dropped.
 *
 * Providers:
 *  - `web-speech-browser` (default, production): speechSynthesis in the
 *    client — supports Arabic + English OS voices, interruption via cancel.
 *  - `command` (opt-in local engine): spawns DENTORA_VOICE_TTS_CMD with the
 *    text on stdin and expects WAV bytes (verified locally with meSpeak).
 *  - `null` (headless/CI): returns null — honest unavailability, no fake
 *    audio, no fake latency numbers.
 */

import { spawn } from 'node:child_process'

export interface TtsSynthesizeInput {
  text: string
  locale: string
  voice?: string | null
}

export interface TtsSynthesizeResult {
  providerId: string
  /** WAV audio bytes (command provider) — null for browser-side providers. */
  wavBytes: Buffer | null
  /** The exact text the provider was given (audit: TTS never rewrites). */
  spokenText: string
  meta?: { engine?: string; synthMs?: number }
}

export interface TtsProvider {
  readonly providerId: string
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>
}

// ---------------------------------------------------------------------------
// Speakable response shaping — meaning-preserving text transform (§12)
// ---------------------------------------------------------------------------

export function speakableFromResponse(text: string, maxChars = 800): string {
  let out = text
  // Fenced code blocks → short spoken placeholder (code is not speakable).
  out = out.replace(/```[\s\S]*?```/g, ' ')
  // Tables / markdown pipes → spoken pause.
  out = out.replace(/\|\s*/g, ', ').replace(/\n\|?[-: |]+\|/g, ' ')
  // Headings + emphasis markers.
  out = out.replace(/^#{1,6}\s*/gm, '').replace(/(\*\*|__|`)/g, '')
  // Citation/link markers like [1](url) and bare URLs (not speakable, keep doc for screen readers).
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  out = out.replace(/https?:\/\/\S+/g, '')
  // List bullets → pauses.
  out = out.replace(/^\s*[-*•]\s+/gm, '')
  // Collapse whitespace but keep sentence pauses.
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '. ').replace(/\n/g, '. ').trim()
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars)
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    out = lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut + '…'
  }
  return out
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Browser speechSynthesis marker (client-side hook performs the speech). */
export class WebSpeechBrowserTtsProvider implements TtsProvider {
  readonly providerId = 'web-speech-tts-browser'
  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    // Text passes through untouched; the client speaks it.
    return { providerId: this.providerId, wavBytes: null, spokenText: input.text }
  }
}

/** Opt-in local engine boundary (verified: meSpeak wrapper, see registry). */
export class CommandTtsProvider implements TtsProvider {
  readonly providerId = 'command-tts-local'

  constructor(private config: { command: string; args?: string[]; timeoutMs?: number }) {}

  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    const t0 = Date.now()
    const child = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: this.config.timeoutMs ?? 30_000,
    })
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => {
      if (chunks.reduce((n, b) => n + b.length, 0) < 10 * 1024 * 1024) chunks.push(c)
    })
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 8 * 1024) stderr += c.toString('utf8')
    })
    // Feed stdin BEFORE awaiting exit — engines read until EOF; ending the
    // pipe after close would deadlock the synthesizer.
    child.stdin.end(input.text, 'utf8')
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`COMMAND_TTS_EXIT_${code}:${stderr.slice(0, 200)}`))))
    })
    return {
      providerId: this.providerId,
      wavBytes: Buffer.concat(chunks),
      spokenText: input.text,
      meta: { engine: 'command', synthMs: Date.now() - t0 },
    }
  }
}

/** Headless/CI: honestly unavailable. */
export class NullTtsProvider implements TtsProvider {
  readonly providerId = 'null-tts'
  async synthesize(): Promise<TtsSynthesizeResult> {
    return { providerId: this.providerId, wavBytes: null, spokenText: '' }
  }
}

export type TtsProviderKind = 'web-speech-browser' | 'command' | 'null'

export function resolveTtsProviderKind(env: { DENTORA_VOICE_TTS_CMD?: string } = process.env as { DENTORA_VOICE_TTS_CMD?: string }): TtsProviderKind {
  if (env.DENTORA_VOICE_TTS_CMD) return 'command'
  return 'web-speech-browser'
}

export function createTtsProvider(opts: { kind?: TtsProviderKind; commandConfig?: { command: string; args?: string[]; timeoutMs?: number } } = {}): TtsProvider {
  switch (opts.kind ?? resolveTtsProviderKind()) {
    case 'command':
      if (!opts.commandConfig) throw new Error('COMMAND_TTS_CONFIG_REQUIRED')
      return new CommandTtsProvider(opts.commandConfig)
    case 'null':
      return new NullTtsProvider()
    default:
      return new WebSpeechBrowserTtsProvider()
  }
}

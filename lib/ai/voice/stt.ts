/**
 * Phase 10 — STT provider abstraction (§6/§7/§38).
 *
 * ONE provider boundary; the Agent never knows which engine ran. Three
 * concrete paths:
 *
 *  1. `fixture` — deterministic typed transcripts for replay/eval (synthetic
 *     only; never presented as real audio inference).
 *  2. `web-speech-browser` — the production default: the BROWSER performs
 *     recognition (Web Speech API) and posts the typed transcript. No audio
 *     crosses the server API.
 *  3. `command` — opt-in LOCAL engine boundary: spawns a configured command
 *     (DENTORA_VOICE_STT_CMD) that reads a WAV and prints typed JSON. This is
 *     how a verified local engine (e.g. pocketsphinx, see provider registry)
 *     integrates WITHOUT the Next.js app gaining Python/audio dependencies.
 *     Disabled unless explicitly configured; spawn is arg-array based (no
 *     shell), output size-capped, path-validated, timeout-guarded.
 *
 * No cloud STT is configured by default. An external provider would need an
 * explicit entry here + explicit privacy policy (§38 — never silently).
 */

import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import type { TranscriptLanguage, VoiceTranscript } from './types'
import { detectTranscriptLanguage } from './normalize'
import { validateAudioFileSafety } from './security'

export interface SttTranscribeInput {
  /** PCM16 WAV bytes (local command path only — never from the HTTP API). */
  wavBytes?: Buffer
  audioPath?: string
  locale?: string
  /** Grammar name for bounded-command engines (e.g. pocketsphinx JSGF). */
  grammar?: string
}

export interface SttTranscribeResult {
  text: string
  confidence: number
  isFinal: boolean
  providerId: string
  language: TranscriptLanguage
  /** Informational engine metadata (never content). */
  meta?: { engine?: string; decodeMs?: number }
}

export interface SttProvider {
  readonly providerId: string
  transcribe(input: SttTranscribeInput): Promise<SttTranscribeResult>
}

// ---------------------------------------------------------------------------
// Fixture provider — deterministic, replay/eval only (synthetic transcripts)
// ---------------------------------------------------------------------------

export class FixtureSttProvider implements SttProvider {
  readonly providerId = 'fixture-stt'
  constructor(private readonly scripted: { text: string; confidence?: number; isFinal?: boolean } = { text: '' }) {}

  async transcribe(): Promise<SttTranscribeResult> {
    return {
      text: this.scripted.text,
      confidence: this.scripted.confidence ?? 0.95,
      isFinal: this.scripted.isFinal ?? true,
      providerId: this.providerId,
      language: detectTranscriptLanguage(this.scripted.text),
    }
  }
}

// ---------------------------------------------------------------------------
// Browser Web Speech marker provider (recognition happens client-side)
// ---------------------------------------------------------------------------

/**
 * The browser performs recognition and posts a typed VoiceTranscript; this
 * provider exists so server-side composition/telemetry has a canonical id.
 * It cannot transcribe server-side by design.
 */
export class WebSpeechBrowserSttProvider implements SttProvider {
  readonly providerId = 'web-speech-stt-browser'

  async transcribe(): Promise<SttTranscribeResult> {
    throw new Error('WEB_SPEECH_IS_CLIENT_SIDE: browsers post typed transcripts via /api/ai/voice/turn')
  }
}

// ---------------------------------------------------------------------------
// Command provider — opt-in local engine boundary (real local STT)
// ---------------------------------------------------------------------------

export interface CommandSttConfig {
  /** argv template; {{audio}} is replaced by the validated path. */
  command: string
  argsTemplate: string[]
  timeoutMs?: number
  baseDir: string
}

export class CommandSttProvider implements SttProvider {
  readonly providerId = 'command-stt-local'

  constructor(private readonly config: CommandSttConfig) {}

  async transcribe(input: SttTranscribeInput): Promise<SttTranscribeResult> {
    if (!input.audioPath) throw new Error('COMMAND_STT_REQUIRES_AUDIO_PATH')
    const size = await stat(input.audioPath).then((s) => s.size, () => -1)
    const safety = validateAudioFileSafety(input.audioPath, this.config.baseDir, size)
    if (!safety.ok) throw new Error(`AUDIO_UNSAFE:${safety.code}`)
    const bytes = await readFile(input.audioPath)
    return this.transcribeBytes(bytes, input)
  }

  async transcribeBytes(wavBytes: Buffer, input: SttTranscribeInput): Promise<SttTranscribeResult> {
    if (wavBytes.length > 10 * 1024 * 1024) throw new Error('AUDIO_TOO_LARGE')
    const t0 = Date.now()
    const args = this.config.argsTemplate.map((a) => (a === '{{audio}}' ? '-' : a))
      .concat(input.grammar ? ['--grammar', input.grammar] : [])
    const child = spawn(this.config.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: this.config.timeoutMs ?? 30_000,
    })
    let stdout = ''
    let stderr = ''
    const capped = (chunk: Buffer) => {
      if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8')
    }
    child.stdout.on('data', capped)
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 8 * 1024) stderr += c.toString('utf8')
    })
    // Feed stdin BEFORE awaiting exit — engines read until EOF; ending the
    // pipe after close would deadlock bounded-command decoders.
    child.stdin.end(wavBytes)
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`COMMAND_STT_EXIT_${code}:${stderr.slice(0, 200)}`))))
    })
    let parsed: { text?: unknown; confidence?: unknown; isFinal?: unknown }
    try {
      parsed = JSON.parse(stdout)
    } catch {
      throw new Error('COMMAND_STT_BAD_OUTPUT')
    }
    const text = typeof parsed.text === 'string' ? parsed.text : ''
    return {
      text,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      isFinal: parsed.isFinal !== false,
      providerId: this.providerId,
      language: detectTranscriptLanguage(text),
      meta: { engine: 'command', decodeMs: Date.now() - t0 },
    }
  }
}

// ---------------------------------------------------------------------------
// Resolution — explicit configuration only (fail closed to browser default)
// ---------------------------------------------------------------------------

export type SttProviderKind = 'fixture' | 'web-speech-browser' | 'command'

export function resolveSttProviderKind(env: { DENTORA_VOICE_STT_CMD?: string } = process.env as { DENTORA_VOICE_STT_CMD?: string }): SttProviderKind {
  if (env.DENTORA_VOICE_STT_CMD) return 'command'
  return 'web-speech-browser'
}

export function createSttProvider(opts: {
  kind?: SttProviderKind
  fixtureScript?: { text: string; confidence?: number; isFinal?: boolean }
  commandConfig?: CommandSttConfig
} = {}): SttProvider {
  switch (opts.kind ?? resolveSttProviderKind()) {
    case 'fixture':
      return new FixtureSttProvider(opts.fixtureScript)
    case 'command':
      if (!opts.commandConfig) throw new Error('COMMAND_STT_CONFIG_REQUIRED')
      return new CommandSttProvider(opts.commandConfig)
    default:
      return new WebSpeechBrowserSttProvider()
  }
}

/** Type guard used by the turn route: anything else is not a VoiceTranscript. */
export function isVoiceTranscript(v: unknown): v is VoiceTranscript {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as VoiceTranscript).text === 'string' &&
    typeof (v as VoiceTranscript).confidence === 'number' &&
    typeof (v as VoiceTranscript).isFinal === 'boolean' &&
    typeof (v as VoiceTranscript).providerId === 'string'
  )
}

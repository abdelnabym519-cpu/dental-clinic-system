#!/usr/bin/env node
/**
 * DenToRa Phase 10 — local TTS command wrapper (meSpeak / eSpeak formant
 * synthesis, en-us voice bundled).
 *
 * OPTIONAL local engine boundary for `CommandTtsProvider`: deployments that
 * want offline English TTS install the npm package
 * (`npm i mespeak`) next to this script and point DENTORA_VOICE_TTS_CMD at
 * `node tools/voice/tts-local.mjs`.
 *
 * Contract:
 *   stdin  : UTF-8 text
 *   stdout : WAV audio bytes (22.05 kHz PCM16 mono)
 *   stderr : diagnostics
 *   --text "..." : speak this instead of stdin (for smoke tests)
 *
 * Verification status: REAL_INFERENCE_VERIFIED (SANDBOX) — see
 * ai-validation/voice-local/EVIDENCE.json. English only (meSpeak ships no
 * Arabic voice and Arabic voice-data hosts are unreachable from the
 * validation sandbox) — honest limitation, never faked.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

// Resolve mespeak from the CALLER's node_modules (cwd) first — this lets
// deployments install the engine wherever the process runs — falling back
// to this script's own location.
const require = createRequire(path.join(process.cwd(), 'package.json'))

const argTextIdx = process.argv.indexOf('--text')
const text =
  argTextIdx >= 0 ? process.argv[argTextIdx + 1] : await readStdin()

if (!text) {
  process.stderr.write('tts-local: no text provided\n')
  process.exit(2)
}

const mespeak = require('mespeak')
mespeak.loadConfig(require('mespeak/src/mespeak_config.json'))
mespeak.loadVoice(require('mespeak/voices/en/en-us.json'))

// Tuned for command-ack clarity: 3/3 EXACT round-trip with the
// pocketsphinx grammar mode in the Phase 10 audit (see EVIDENCE.json).
const buf = mespeak.speak(text, { rawdata: 'buffer', speed: 130, wordgap: 3, pitch: 50, variant: 'f2' })
if (!buf || buf.length === 0) {
  process.stderr.write('tts-local: synthesis produced no audio\n')
  process.exit(1)
}
process.stdout.write(buf)

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

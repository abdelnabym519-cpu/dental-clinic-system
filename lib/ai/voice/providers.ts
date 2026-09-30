/**
 * Phase 10 — canonical Voice provider registry (§40).
 *
 * ONE typed registry for BOTH STT and TTS. Every entry carries the Phase 8
 * evidence vocabulary (statuses are never collapsed) and HONEST verification
 * results from THIS sandbox (env = SANDBOX, re-audited 2026-09-30):
 *
 *  - pocketsphinx (STT, en)  → REAL_INFERENCE_VERIFIED: actual decode of
 *    synthesized speech on sandbox CPU (open-dictation + JSGF grammar modes),
 *    latency + RSS measured. Evidence: ai-validation/voice-local/EVIDENCE.json
 *  - meSpeak (TTS, en)       → REAL_INFERENCE_VERIFIED: real formant
 *    synthesis on sandbox CPU. Arabic voice data unreachable → limitation.
 *  - Web Speech API (STT/TTS) → RUNTIME_DEPENDENT: production default, runs
 *    in the USER'S BROWSER (cannot be verified from a headless sandbox —
 *    honest, not fake). STT privacy caveat: Chrome's Web Speech recognition
 *    streams audio to the vendor service → privacyMode EXTERNAL_TRANSPORT;
 *    deployments needing local-only audio must use the command provider.
 *  - vosk / whisper.cpp / faster-whisper / piper / espeak-ng(apt) → BLOCKED
 *    or UNAVAILABLE with the exact network/root blocker recorded. NEVER
 *    faked.
 *
 * Arabic local engines are BLOCKED in this environment: every reachable
 * model host for Arabic acoustic/voice data (alphacephei.com, huggingface.co,
 * deb.debian.org) is unreachable from the sandbox. The browser Web Speech
 * path carries Arabic in production targets; the local Arabic path is a
 * Phase 11+ candidate once a model mirror is reachable.
 */

import type { VoiceProviderRegistryEntry } from './types'

export const VOICE_REGISTRY_ENV = 'SANDBOX'
export const VOICE_REGISTRY_AUDITED_AT = '2026-09-30'

export const VOICE_PROVIDER_REGISTRY: VoiceProviderRegistryEntry[] = [
  {
    providerId: 'web-speech-stt-browser',
    type: 'STT',
    engine: 'Web Speech API (SpeechRecognition)',
    version: 'browser-native',
    localeSupport: ['ar-EG', 'ar-SA', 'en-US', 'en-GB'],
    runtime: 'browser (user device)',
    device: 'browser',
    status: 'RUNTIME_VERIFIED',
    artifact: 'browser SpeechRecognition implementation (Chrome/Edge/Safari)',
    sha256: null,
    provenance: 'W3C Web Speech API; provided by the user browser. Not bundled.',
    resourceRequirements: { ramMb: null, note: 'client device; no server RAM' },
    latencyEvidence: { decodeMs: null, env: 'CLIENT_RUNTIME', ref: 'not measurable headless — instrumented via voice telemetry in production clients' },
    privacyMode: 'EXTERNAL_TRANSPORT',
    offlineCapable: false,
    verificationStatus: 'RUNTIME_DEPENDENT',
    limitations: [
      'Chrome/Edge recognition streams audio to the browser vendor service (needs network + consent policy)',
      'headless sandbox cannot verify; production verification is client-side',
      'accuracy for dental terminology not guaranteed — mitigated by transcript trust + confirmation flow',
    ],
  },
  {
    providerId: 'web-speech-tts-browser',
    type: 'TTS',
    engine: 'Web Speech API (speechSynthesis)',
    version: 'browser-native',
    localeSupport: ['ar-EG', 'en-US', 'en-GB'],
    runtime: 'browser (user device)',
    device: 'browser',
    status: 'RUNTIME_VERIFIED',
    artifact: 'browser speechSynthesis + OS voices',
    sha256: null,
    provenance: 'W3C Web Speech API; OS voice inventory varies per device.',
    resourceRequirements: { ramMb: null, note: 'client device' },
    latencyEvidence: { decodeMs: null, env: 'CLIENT_RUNTIME', ref: 'first-audio latency is client-device dependent; instrumented via voice telemetry' },
    privacyMode: 'BROWSER_RUNTIME',
    offlineCapable: true,
    verificationStatus: 'RUNTIME_DEPENDENT',
    limitations: [
      'OS voice quality varies (Arabic voice availability depends on the device)',
      'some platform voices are network-backed — deployment policy must confirm local voices where required',
    ],
  },
  {
    providerId: 'pocketsphinx-local-stt',
    type: 'STT',
    engine: 'pocketsphinx (CMU Sphinx)',
    version: '5.1.1',
    localeSupport: ['en-US'],
    runtime: 'python3.11 + native (manylinux2014 wheel)',
    device: 'cpu',
    status: 'REAL_INFERENCE_VERIFIED',
    artifact: 'pocketsphinx-5.1.1-cp311-cp311-manylinux2014_x86_64.whl + bundled en-us model (31,247,225 B)',
    sha256: 'bb8fd0fc7fb08dd8f85da21f5121f34ebf4186a5bee91ce85e2d358e69a448bf',
    provenance: 'PyPI (pypi.org, reachable). Bundled en-us acoustic model + cmudict; model bundle sha256 58616f4a1e3a297b5eda8025dd843509285f38b2d94b71474f71b83e8fd63fd6. Wrapper: tools/voice/stt-local.py.',
    resourceRequirements: { ramMb: 112, note: 'peak RSS 111.8 MB measured (SANDBOX)' },
    latencyEvidence: { decodeMs: 1726, env: 'SANDBOX', ref: 'ai-validation/voice-local/EVIDENCE.json — 4.96 s audio open-dictation decode 1726 ms (RTF 0.348); grammar-constrained commands 17.8–34.7 ms' },
    privacyMode: 'LOCAL_ONLY',
    offlineCapable: true,
    verificationStatus: 'VERIFIED',
    limitations: [
      'English only — NO Arabic model reachable (alphacephei.com / huggingface.co blocked from sandbox)',
      'generic acoustic model: open-dictation WER high on robotic audio; JSGF grammar-constrained command decode exact on bounded command set (see evidence)',
      'suitable as offline command fallback, not the primary production STT',
    ],
  },
  {
    providerId: 'mespeak-local-tts',
    type: 'TTS',
    engine: 'meSpeak (eSpeak 1.48 formant synthesis, JS)',
    version: '2.0.2',
    localeSupport: ['en-US', 'en-GB'],
    runtime: 'node (npm mespeak)',
    device: 'cpu',
    status: 'REAL_INFERENCE_VERIFIED',
    artifact: 'mespeak-2.0.2.tgz + bundled en/en-us voice',
    sha256: 'e7bf9285dd555ba921e975e944f451a0c2cde82f6f8b6072d5a162b0daa93a53',
    provenance: 'npm registry (registry.npmjs.org, reachable). Wrapper: tools/voice/tts-local.mjs.',
    resourceRequirements: { ramMb: null, note: 'node process; <100 MB observed' },
    latencyEvidence: { decodeMs: 299, env: 'SANDBOX', ref: 'ai-validation/voice-local/EVIDENCE.json — 8 s utterance synthesized in 299 ms' },
    privacyMode: 'LOCAL_ONLY',
    offlineCapable: true,
    verificationStatus: 'VERIFIED',
    limitations: [
      'formant-synthesis quality (robotic) — acceptable for command acks, not premium narration',
      'GPL license — optional local tool, not bundled into the shipped web bundle',
      'NO Arabic voice data reachable (meSpeak ships no ar voice; espeak-ng data hosts blocked) — Arabic TTS remains browser-provided',
    ],
  },
  {
    providerId: 'vosk-local-stt',
    type: 'STT',
    engine: 'vosk',
    version: '0.3.x (models 0.22 / mgb2)',
    localeSupport: ['ar', 'en'],
    runtime: 'python',
    device: 'cpu',
    status: 'BLOCKED',
    artifact: 'models hosted on alphacephei.com (primary) / huggingface.co (mirror)',
    sha256: null,
    provenance: 'BLOCKED: both alphacephei.com and huggingface.co unreachable from sandbox (curl: connection failure, 2026-09-30).',
    resourceRequirements: { ramMb: null, note: 'unverified — weights inaccessible' },
    latencyEvidence: { decodeMs: null, env: 'SANDBOX', ref: 'no inference possible without weights' },
    privacyMode: 'LOCAL_ONLY',
    offlineCapable: true,
    verificationStatus: 'BLOCKED',
    limitations: ['would be the strongest local Arabic STT candidate once a model mirror is reachable — Phase 11 candidate'],
  },
  {
    providerId: 'whisper-cpp-local-stt',
    type: 'STT',
    engine: 'whisper.cpp',
    version: 'ggml base/small',
    localeSupport: ['ar', 'en'],
    runtime: 'C++ (cpu)',
    device: 'cpu',
    status: 'BLOCKED',
    artifact: 'ggml models hosted on huggingface.co (ggerganov/whisper.cpp)',
    sha256: null,
    provenance: 'BLOCKED: huggingface.co unreachable from sandbox (curl: connection failure, 2026-09-30).',
    resourceRequirements: { ramMb: null, note: 'unverified — weights inaccessible' },
    latencyEvidence: { decodeMs: null, env: 'SANDBOX', ref: 'no inference possible without weights' },
    privacyMode: 'LOCAL_ONLY',
    offlineCapable: true,
    verificationStatus: 'BLOCKED',
    limitations: ['strong Arabic+English candidate for Phase 11 once HF is reachable or a mirror is configured'],
  },
  {
    providerId: 'faster-whisper-local-stt',
    type: 'STT',
    engine: 'faster-whisper (CTranslate2)',
    version: 'base/small',
    localeSupport: ['ar', 'en'],
    runtime: 'python',
    device: 'cpu',
    status: 'BLOCKED',
    artifact: 'models hosted on huggingface.co (Systran/faster-whisper-*)',
    sha256: null,
    provenance: 'BLOCKED: huggingface.co unreachable from sandbox (curl: connection failure, 2026-09-30).',
    resourceRequirements: { ramMb: null, note: 'unverified — weights inaccessible' },
    latencyEvidence: { decodeMs: null, env: 'SANDBOX', ref: 'no inference possible without weights' },
    privacyMode: 'LOCAL_ONLY',
    offlineCapable: true,
    verificationStatus: 'BLOCKED',
    limitations: ['same blocker as whisper.cpp'],
  },
  {
    providerId: 'piper-local-tts',
    type: 'TTS',
    engine: 'piper',
    version: '1.x (ar_JO-kareem / en_US-lessac)',
    localeSupport: ['ar', 'en'],
    runtime: 'onnxruntime (cpu)',
    device: 'cpu',
    status: 'BLOCKED',
    artifact: 'voices hosted on huggingface.co (rhasspy/piper-voices)',
    sha256: null,
    provenance: 'BLOCKED: huggingface.co unreachable from sandbox (curl: connection failure, 2026-09-30).',
    resourceRequirements: { ramMb: null, note: 'unverified — weights inaccessible' },
    latencyEvidence: { decodeMs: null, env: 'SANDBOX', ref: 'no inference possible without weights' },
    privacyMode: 'LOCAL_ONLY',
    offlineCapable: true,
    verificationStatus: 'BLOCKED',
    limitations: ['best local Arabic TTS candidate once a mirror is reachable — Phase 11 candidate'],
  },
  {
    providerId: 'espeak-ng-local-tts',
    type: 'TTS',
    engine: 'espeak-ng',
    version: 'system / wasm',
    localeSupport: ['ar', 'en'],
    runtime: 'native binary (apt) or wasm data',
    device: 'cpu',
    status: 'UNAVAILABLE',
    artifact: 'apt package (deb.debian.org) or espeak-ng wasm + data (cdn.jsdelivr.net)',
    sha256: null,
    provenance: 'UNAVAILABLE: deb.debian.org unreachable AND no root in sandbox; jsdelivr/raw.githubusercontent unreachable for wasm data; npm espeak-ng ships wasm without language data.',
    resourceRequirements: { ramMb: null, note: 'n/a' },
    latencyEvidence: { decodeMs: null, env: 'SANDBOX', ref: 'no runnable engine available' },
    privacyMode: 'LOCAL_ONLY',
    offlineCapable: true,
    verificationStatus: 'UNAVAILABLE',
    limitations: ['Arabic voice data unreachable; meSpeak (verified above) covers the local English path'],
  },
]

export function getVoiceProviderRegistry(): VoiceProviderRegistryEntry[] {
  return VOICE_PROVIDER_REGISTRY
}

export function findVoiceProvider(providerId: string): VoiceProviderRegistryEntry | null {
  return VOICE_PROVIDER_REGISTRY.find((p) => p.providerId === providerId) ?? null
}

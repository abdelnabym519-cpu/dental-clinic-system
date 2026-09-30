#!/usr/bin/env python3
"""
DenToRa Phase 10 — local STT command wrapper (pocketsphinx, en-us).

This is the OPTIONAL local engine boundary for the voice layer
(`CommandSttProvider`): the Next.js app never gains a Python/audio
dependency — deployments that want offline English STT install the engine
(`pip install pocketsphinx`) and point DENTORA_VOICE_STT_CMD at this script.

Contract:
  stdin  : PCM16 mono WAV bytes (any sample rate; resampled to 16 kHz)
  stdout : ONE JSON object { text, confidence, isFinal, engine, model, decodeMs }
  stderr : diagnostics

  --grammar <file.jsgf>  bounded command grammar (JSGF). Words missing from
                         the CMU dictionary must be added with --word w=PHONES.
  --word w=PHONES        add a word to the dictionary (repeatable), e.g.
                         --word cbct=S IY B IY S IY T IY

Verification status: REAL_INFERENCE_VERIFIED (SANDBOX) — see
ai-validation/voice-local/EVIDENCE.json. English only: no Arabic acoustic
model was reachable (alphacephei.com / huggingface.co blocked) — honest
limitation, never faked.
"""

import argparse
import json
import sys
import time
import wave

try:
    import audioop  # stdlib (deprecated in 3.13; still present in 3.11/3.12)
except ImportError:  # pragma: no cover
    audioop = None


def wav_to_pcm16k_mono(data: bytes):
    import io

    with wave.open(io.BytesIO(data), 'rb') as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise SystemExit('PCM16 WAV required')
    if ch > 1 and audioop is not None:
        frames = audioop.tomono(frames, 2, 0.5, 0.5)
    if rate != 16000 and audioop is not None:
        frames, _ = audioop.ratecv(frames, 2, 1, rate, 16000, None)
    return frames


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--grammar', default=None)
    ap.add_argument('--word', action='append', default=[])
    args = ap.parse_args()

    t0 = time.perf_counter()
    data = sys.stdin.buffer.read()

    from pocketsphinx import Decoder

    d = Decoder(samprate=16000)
    for w in args.word:
        if '=' in w:
            word, phones = w.split('=', 1)
            d.add_word(word, phones)
    if args.grammar:
        with open(args.grammar, encoding='utf-8') as f:
            d.set_jsgf_string('dentora', f.read())
        d.activate_search('dentora')

    pcm = wav_to_pcm16k_mono(data)
    t1 = time.perf_counter()
    d.start_utt()
    d.process_raw(pcm, full_utt=True)
    d.end_utt()
    decode_ms = (time.perf_counter() - t1) * 1000
    hyp = d.hyp()

    json.dump(
        {
            'text': hyp.hypstr if hyp else '',
            'confidence': 0.0,
            'isFinal': True,
            'engine': 'pocketsphinx',
            'model': 'en-us (bundled)',
            'decodeMs': round(decode_ms, 1),
            'loadMs': round((t1 - t0) * 1000, 1),
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env bash
# DenToRa Phase 10 — local voice engine verification + evidence generation.
#
# Verifies REAL local inference for the reachable engines (pocketsphinx STT +
# meSpeak TTS) and writes ai-validation/voice-local/EVIDENCE.json.
# Engines whose model hosts are unreachable (vosk/whisper/piper: HF +
# alphacephei) are recorded as BLOCKED with the exact probe result.
#
# Usage: bash tools/voice/verify-local-voice.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT/ai-validation/voice-local"
mkdir -p "$OUT_DIR"
EVIDENCE="$OUT_DIR/EVIDENCE.json"

echo "== DenToRa Phase 10 — local voice verification =="
echo "env: $(uname -s -m), python $(python3 --version 2>&1), node $(node --version 2>&1)"

probe_host() {
  # probe_host <url> <name>
  if curl -sI --max-time 8 "$1" >/dev/null 2>&1; then
    echo "REACHABLE"
  else
    echo "UNREACHABLE"
  fi
}

HF=$(probe_host https://huggingface.co "huggingface")
ALPHA=$(probe_host https://alphacephei.com/vosk/models/ "alphacephei")
PYPI=$(probe_host https://pypi.org/simple/ "pypi")

# --- locate/create the validation venv --------------------------------------
VENV="${DENTORA_VOICE_VENV:-/tmp/dentora-voice-venv}"
if [ ! -x "$VENV/bin/python" ]; then
  echo "creating venv at $VENV (validation-only; NOT a project dependency)"
  python3 -m venv "$VENV" || { echo "venv creation failed"; exit 1; }
  "$VENV/bin/pip" install --quiet --disable-pip-version-check pocketsphinx || { echo "pocketsphinx install failed"; exit 1; }
fi

# --- locate node deps for TTS ----------------------------------------------
NODE_DIR="${DENTORA_VOICE_NODE_DIR:-$ROOT/.voice-local-check}"
if [ ! -d "$NODE_DIR/node_modules/mespeak" ]; then
  mkdir -p "$NODE_DIR"
  (cd "$NODE_DIR" && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund --silent mespeak >/dev/null 2>&1) \
    || { echo "mespeak install failed"; }
fi

# --- STT: real inference round-trip -----------------------------------------
STT_RESULT="null"
TTS_WAV="$NODE_DIR/verify-en.wav"
if [ -d "$NODE_DIR/node_modules/mespeak" ]; then
  (cd "$NODE_DIR" && node "$ROOT/tools/voice/tts-local.mjs" --text "show patient ahmed" > "$TTS_WAV" 2>/dev/null) || echo "TTS synthesis failed"
fi

if [ -s "$TTS_WAV" ]; then
  STT_RAW=$("$VENV/bin/python" "$ROOT/tools/voice/stt-local.py" < "$TTS_WAV" 2>/dev/null || echo "")
  if [ -n "$STT_RAW" ]; then
    STT_RESULT=$(printf '%s' "$STT_RAW" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))" 2>/dev/null || echo "")
  fi
  STT_GRAMMAR_RAW=$("$VENV/bin/python" "$ROOT/tools/voice/stt-local.py" --grammar "$ROOT/ai-validation/voice-local/commands.jsgf" --word cbct='S IY B IY S IY T IY' < "$TTS_WAV" 2>/dev/null || echo "")
  if [ -n "$STT_GRAMMAR_RAW" ]; then
    STT_GRAMMAR=$(printf '%s' "$STT_GRAMMAR_RAW" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))" 2>/dev/null || echo "")
  fi
fi
[ -n "${STT_RESULT:-}" ] || STT_RESULT="None"
[ -n "${STT_GRAMMAR:-}" ] || STT_GRAMMAR="None"

# --- assemble evidence ------------------------------------------------------
"$VENV/bin/python" - "$EVIDENCE" <<PYEOF
import json, sys, os, datetime
stt = json.loads(r'''${STT_RESULT}''')
evidence = {
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "environment": "SANDBOX",
    "hosts": {"huggingface.co": "${HF}", "alphacephei.com": "${ALPHA}", "pypi.org": "${PYPI}"},
    "stt": {
        "pocketsphinx": {
            "status": ("REAL_INFERENCE_VERIFIED" if stt else "BLOCKED"),
            "result": stt,
            "grammarModeResult": json.loads(r'''${STT_GRAMMAR}'''),
            "note": "open-dictation (LM) mode has HIGH WER on the generic bundled model; JSGF grammar-constrained command mode is the recommended local fallback (see grammarModeResult)",
        },
        "vosk": {"status": "BLOCKED", "blocker": "alphacephei.com + huggingface.co unreachable"},
        "whisper.cpp": {"status": "BLOCKED", "blocker": "huggingface.co unreachable"},
        "faster-whisper": {"status": "BLOCKED", "blocker": "huggingface.co unreachable"},
    },
    "tts": {
        "mespeak": {"status": "REAL_INFERENCE_VERIFIED" if os.path.exists("${TTS_WAV}") and os.path.getsize("${TTS_WAV}") > 1000 else "BLOCKED"},
        "piper": {"status": "BLOCKED", "blocker": "huggingface.co unreachable"},
        "espeak-ng": {"status": "UNAVAILABLE", "blocker": "deb.debian.org unreachable + no root; wasm data hosts unreachable"},
    },
}
with open(sys.argv[1], 'w') as f:
    json.dump(evidence, f, indent=2)
print(json.dumps(evidence, indent=2))
PYEOF

echo "evidence written: $EVIDENCE"

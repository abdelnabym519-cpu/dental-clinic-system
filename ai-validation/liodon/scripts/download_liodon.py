#!/usr/bin/env python3
"""
download_liodon.py — fetch the published Liodon Dental Panoramic Detector
artifact and verify it against the registry's recorded SHA-256.

This downloads. It does not train, fine-tune, retrain, convert, quantise, or
otherwise touch the weights. If the bytes on disk do not hash to the value the
registry published, the script fails and leaves nothing in model/.

Source of truth (verified against the Hugging Face registry API):
    repo      liodon-ai/dental-panoramic-detector
    revision  8bef2036b099e80e51f93f24de4b0c0edd366256
    file      best.onnx
    size      10,605,711 bytes
    sha256    4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71

Usage
-----
    python scripts/download_liodon.py
    python scripts/download_liodon.py --force     # re-download, ignoring cache
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

REPO_ID = "liodon-ai/dental-panoramic-detector"
REVISION = "8bef2036b099e80e51f93f24de4b0c0edd366256"
FILENAME = "best.onnx"
EXPECTED_SHA256 = "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71"
EXPECTED_SIZE = 10_605_711

# Also published, recorded here for completeness. Not downloaded by default —
# best.pt is the PyTorch sibling of best.onnx and is not needed for this
# CPU/ONNX validation.
OPTIONAL_SIBLINGS = {
    "best.pt": {
        "size": 5_452_442,
        "sha256": "6943ceb0f96109cb1955d0e487a8f20aa8edb8fc9d0186b7ecf682fef9be27aa",
    },
    "last.pt": {
        "size": 5_452_442,
        "sha256": "ddea8bd1282469183870d309d3c82d09455dd549fd9852b7f58c99f8d8ef1268",
    },
}


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Download and verify the published Liodon best.onnx")
    parser.add_argument("--force", action="store_true", help="Delete any existing copy and re-download")
    parser.add_argument("--also-pt", action="store_true", help="Also fetch best.pt (not required)")
    parser.add_argument("--model-dir", default=None, help="Destination directory. Default: <lab>/model")
    args = parser.parse_args()

    lab_root = Path(__file__).resolve().parent.parent
    model_dir = Path(args.model_dir) if args.model_dir else lab_root / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    target = model_dir / FILENAME

    if target.exists() and not args.force:
        size = target.stat().st_size
        if size == EXPECTED_SIZE:
            digest = sha256_of(target)
            if digest.lower() == EXPECTED_SHA256:
                print(f"[OK] Already present and verified: {target}")
                print(f"     size   {size:,} bytes")
                print(f"     sha256 {digest}")
                return 0
        print(f"[!] Existing file fails verification (size={size:,}). Re-downloading.")
        target.unlink()

    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        print("[FATAL] huggingface_hub is not installed.")
        print("        pip install -r requirements.txt")
        return 2

    print("=" * 74)
    print(" Downloading the published Liodon artifact (no training, no conversion)")
    print("=" * 74)
    print(f"repo      : {REPO_ID}")
    print(f"revision  : {REVISION}")
    print(f"file      : {FILENAME}")
    print()

    try:
        cached = hf_hub_download(repo_id=REPO_ID, filename=FILENAME, revision=REVISION)
    except Exception as exc:
        print(f"\n[FATAL] Download failed: {type(exc).__name__}: {exc}")
        print("\nThis is a hard stop. Do not substitute another weight file, and do not")
        print("re-export or convert one. Check the network/proxy and retry.")
        return 3

    shutil.copy2(cached, target)

    size = target.stat().st_size
    digest = sha256_of(target)

    print(f"saved to  : {target}")
    print(f"size      : {size:,} bytes  (expected {EXPECTED_SIZE:,})")
    print(f"sha256    : {digest}")
    print(f"expected  : {EXPECTED_SHA256}")

    ok = True
    if size != EXPECTED_SIZE:
        print("[FAIL] Size mismatch.")
        ok = False
    if digest.lower() != EXPECTED_SHA256:
        print("[FAIL] SHA-256 mismatch — the bytes are not the published artifact.")
        ok = False

    if not ok:
        target.unlink(missing_ok=True)
        print("\n[STOP] Artifact is not identical to the published one. File removed.")
        print("       Per the validation protocol, stop here. Do not work around this by")
        print("       converting, re-exporting, quantising or retraining.")
        return 4

    print("\n[OK] SHA-256 verified against the published registry hash.")

    if args.also_pt:
        for name, meta in OPTIONAL_SIBLINGS.items():
            print(f"\n-- {name} --")
            try:
                path = hf_hub_download(repo_id=REPO_ID, filename=name, revision=REVISION)
                dst = model_dir / name
                shutil.copy2(path, dst)
                d = sha256_of(dst)
                status = "OK" if d.lower() == meta["sha256"] else "MISMATCH"
                print(f"   {dst}  {dst.stat().st_size:,} bytes  sha256 {d}  [{status}]")
            except Exception as exc:
                print(f"   [WARN] {name}: {type(exc).__name__}: {exc}")

    print("\nNext:")
    print("  python scripts/run_liodon.py --input input/sample.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

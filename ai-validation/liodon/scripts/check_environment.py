#!/usr/bin/env python3
"""
check_environment.py — report exactly what this machine can and cannot do for
the Liodon CPU validation, before you spend time on a run.

Checks, and says so plainly rather than guessing:
  - Python version and platform
  - onnxruntime installed? version? which build (CPU vs GPU)?
  - CPUExecutionProvider available? CUDAExecutionProvider present (should be absent)?
  - numpy / Pillow / huggingface_hub / psutil present?
  - model/best.onnx present, and does it hash to the published SHA-256?

Exit code 0 = ready to run, 1 = something must be fixed first.

Usage
-----
    python scripts/check_environment.py
"""

from __future__ import annotations

import hashlib
import importlib
import os
import platform
import sys
from pathlib import Path

EXPECTED_SHA256 = "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71"
EXPECTED_SIZE = 10_605_711
FILENAME = "best.onnx"

OK = "  [ OK ]"
BAD = "  [FAIL]"
WARN = "  [WARN]"
INFO = "  [info]"


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    problems: list[str] = []
    warnings: list[str] = []

    print("=" * 74)
    print(" Liodon validation — environment check")
    print("=" * 74)

    # ---- Platform ---------------------------------------------------------
    print("\nHost")
    print(f"{INFO} platform      : {platform.platform()}")
    print(f"{INFO} machine       : {platform.machine()}")
    print(f"{INFO} processor     : {platform.processor() or '(not reported)'}")
    print(f"{INFO} logical CPUs  : {os.cpu_count()}")
    print(f"{INFO} python        : {sys.version.split()[0]} ({sys.executable})")

    if sys.version_info < (3, 9):
        problems.append("Python 3.9 or newer is required.")
        print(f"{BAD} python version too old (need >= 3.9)")
    else:
        print(f"{OK} python version is supported")

    # ---- Packages ---------------------------------------------------------
    print("\nPackages")

    ort = None
    try:
        ort = importlib.import_module("onnxruntime")
        print(f"{OK} onnxruntime   : {ort.__version__}")
    except ImportError:
        problems.append("onnxruntime is not installed. Run: pip install onnxruntime")
        print(f"{BAD} onnxruntime not installed")

    for name, required, hint in [
        ("numpy", True, "pip install numpy"),
        ("PIL", True, "pip install Pillow"),
        ("huggingface_hub", False, "pip install huggingface_hub  (needed only to download the model)"),
        ("psutil", False, "pip install psutil  (optional: accurate Windows RAM reporting)"),
    ]:
        try:
            mod = importlib.import_module(name)
            version = getattr(mod, "__version__", "")
            print(f"{OK} {name:<13} : {version}")
        except ImportError:
            if required:
                problems.append(f"{name} is not installed. {hint}")
                print(f"{BAD} {name} not installed — required. {hint}")
            else:
                warnings.append(f"{name} not installed (optional). {hint}")
                print(f"{WARN} {name} not installed — optional. {hint}")

    # ---- Execution providers ---------------------------------------------
    if ort is not None:
        print("\nONNX Runtime execution providers")
        available = list(ort.get_available_providers())
        for p in available:
            print(f"{INFO} {p}")

        if "CPUExecutionProvider" in available:
            print(f"{OK} CPUExecutionProvider available — this is what the run will use")
        else:
            problems.append("CPUExecutionProvider is not available.")
            print(f"{BAD} CPUExecutionProvider NOT available")

        if "CUDAExecutionProvider" in available or "TensorrtExecutionProvider" in available:
            warnings.append(
                "A CUDA/TensorRT provider is present (onnxruntime-gpu is installed). "
                "The runner requests CPUExecutionProvider explicitly, so it will still run "
                "on CPU — but on the target machine (Intel Iris Xe, no NVIDIA GPU) the "
                "correct package is plain `onnxruntime`."
            )
            print(f"{WARN} a GPU provider is present; runner will still force CPU")
        else:
            print(f"{OK} no CUDA provider present — consistent with a CPU-only target")

        print(f"{INFO} providers requested by the runner: ['CPUExecutionProvider']")

    # ---- Artifact ---------------------------------------------------------
    print("\nPublished artifact")
    lab_root = Path(__file__).resolve().parent.parent
    model_path = lab_root / "model" / FILENAME

    if not model_path.exists():
        warnings.append(
            f"{FILENAME} not downloaded yet. Run: python scripts/download_liodon.py"
        )
        print(f"{WARN} {model_path} not present yet")
        print(f"{INFO} run: python scripts/download_liodon.py")
    else:
        size = model_path.stat().st_size
        digest = sha256_of(model_path)
        print(f"{INFO} path          : {model_path}")
        print(f"{INFO} size          : {size:,} bytes")
        print(f"{INFO} sha256        : {digest}")
        print(f"{INFO} expected      : {EXPECTED_SHA256}")
        if size == EXPECTED_SIZE and digest.lower() == EXPECTED_SHA256:
            print(f"{OK} artifact matches the published size and SHA-256")
        else:
            problems.append("model/best.onnx does not match the published artifact.")
            print(f"{BAD} artifact does NOT match the published size/hash")

    # ---- Verdict ----------------------------------------------------------
    print("\n" + "=" * 74)
    if problems:
        print(" NOT READY — fix the following first:")
        for p in problems:
            print(f"   - {p}")
        if warnings:
            print("\n Notes:")
            for w in warnings:
                print(f"   - {w}")
        print("=" * 74)
        return 1

    print(" READY")
    if warnings:
        print("\n Notes (non-blocking):")
        for w in warnings:
            print(f"   - {w}")
    print("\n Next: python scripts/run_liodon.py --input input/sample.png")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

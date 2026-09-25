"""
Shared fixtures — build the SYNTHETIC stand-in graph and test image under
/tmp (via the lab's own generator functions, so the repo worktree is never
touched), and point the service at them BEFORE app.main is imported.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ENGINE_ROOT = HERE.parent
REPO_ROOT = ENGINE_ROOT.parent.parent.parent  # ai/engines/liodon -> repo root
LAB_SCRIPTS = REPO_ROOT / "ai-validation" / "liodon" / "scripts"

TMP = Path("/tmp/liodon-engine-tests")
STANDIN = TMP / "STANDIN_NOT_LIODON.onnx"
IMAGE = TMP / "synthetic_panoramic.png"


def _ensure_standin() -> None:
    if STANDIN.exists() and IMAGE.exists():
        return
    TMP.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(LAB_SCRIPTS))
    try:
        import make_standin_onnx as gen
    finally:
        sys.path.remove(str(LAB_SCRIPTS))
    gen.build_standin(STANDIN)
    gen.build_synthetic_panorama(IMAGE)


# Must run before any test imports app.main (module-level build).
_ensure_standin()
os.environ.setdefault("MODEL_PATH", str(STANDIN))
os.environ.setdefault("ALLOW_STANDIN", "1")
os.environ.setdefault("STAY_UP_ON_REJECT", "1")  # keep 503/health paths testable


@pytest.fixture(scope="session")
def standin_path() -> Path:
    return STANDIN


@pytest.fixture(scope="session")
def synthetic_image_bytes() -> bytes:
    return IMAGE.read_bytes()

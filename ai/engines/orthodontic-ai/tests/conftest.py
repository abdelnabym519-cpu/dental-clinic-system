"""
conftest.py — Orthodontic AI engine test harness (Phase 19B, engine 3 of 3).

Builds the synthetic stand-in checkpoint (the REAL audited config built with
fixed-seed random weights, saved in the same {'state_dict', 'meta'}
container as the real checkpoint) in /tmp BEFORE app.main is imported, then
points MODEL_PATH at it with ALLOW_STANDIN=1. Every response the stand-in
produces is flagged is_standin_not_orthodontic=true.

Input image: the audited challenge cephalogram (/tmp/ceph_real.png, the
organisers' Apache-2.0 validation input, sha256 b663ed10... — see
ai-validation/cldetection2023/input/NOTE.md) when present, else a synthetic
X-ray-like image. The stand-in's random weights make coordinates
meaningless by construction (AUDIT.md §8) — the tests assert structure and
finiteness, never accuracy.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
ENGINE_DIR = TESTS_DIR.parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

WORK = Path("/tmp/orthodontic-engine-tests")
STANDIN_SEED = 1909

# The audited repository (pinned revision) — the engine needs its config +
# vendored mmpose metainfo. Sandbox location; the Docker image uses
# /opt/cld2023 (REPO_PATH env).
REPO = Path(os.environ.get("CLD2023_REPO_PATH", "/home/user/cld2023-repo"))

REAL_CEPH = Path("/tmp/ceph_real.png")


def synthetic_ceph() -> bytes:
    """Fallback synthetic lateral-ceph-like image (dark field, bright skull
    arc, grain) — used only when the audited real cephalogram is absent."""
    rng = np.random.default_rng(7)
    h, w = 1024, 1280
    img = np.full((h, w), 30.0, dtype=np.float32)
    yy, xx = np.ogrid[:h, :w]
    # skull-like ellipse
    img += 180.0 * np.exp(-((((xx - w / 2) / (w * 0.42)) ** 2) + ((yy - h * 0.45) / (h * 0.4)) ** 2))
    # jaw band
    for y in range(h):
        t = y / h
        band = 120.0 * np.exp(-(((y - (h * 0.55 + h * 0.3 * np.sin(t * np.pi))) ** 2) / (2 * 40.0**2)))
        img[y, :] += band
    img += rng.normal(0.0, 6.0, size=(h, w)).astype(np.float32)
    img = np.clip(img, 0, 255).astype(np.uint8)
    rgb = np.stack([img] * 3, axis=-1)
    import cv2

    ok, buf = cv2.imencode(".png", rgb)
    assert ok
    return buf.tobytes()


def _standin_path() -> Path:
    path = WORK / "STANDIN_NOT_ORTHODONTIC.pth"
    if not path.exists():
        os.environ.setdefault("REPO_PATH", str(REPO))
        from app import model as model_mod

        model_mod.build_standin(path, seed=STANDIN_SEED)
    return path


STANDIN = _standin_path()

# Environment must be set before app.main (which loads the model at import).
os.environ["MODEL_PATH"] = str(STANDIN)
os.environ["ALLOW_STANDIN"] = "1"
os.environ["REPO_PATH"] = str(REPO)

from fastapi.testclient import TestClient  # noqa: E402

from app import main as main_mod  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(main_mod.app)


@pytest.fixture()
def ceph_bytes():
    if REAL_CEPH.is_file():
        return REAL_CEPH.read_bytes()
    return synthetic_ceph()

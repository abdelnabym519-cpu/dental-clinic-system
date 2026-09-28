"""
conftest.py — Implant AI engine test harness (Phase 19B, engine 2 of 3).

Builds the synthetic stand-in checkpoint (a real ultralytics .pt file,
yolo11n-seg, 8 classes, fixed seed) in /tmp BEFORE app.main is imported,
then points MODEL_PATH at it with ALLOW_STANDIN=1. Every response the
stand-in produces is flagged is_standin_not_implant=true.
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
ENGINE_DIR = TESTS_DIR.parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

WORK = Path("/tmp/implant-engine-tests")

STANDIN_SEED = 1908


def synthetic_xray() -> bytes:
    """Deterministic X-ray-like test image (dark field, bright arc, 14
    tooth-like blobs, grain) — 640x480 RGB PNG."""
    rng = np.random.default_rng(42)
    h, w = 480, 640
    img = np.full((h, w), 40.0, dtype=np.float32)
    for y in range(h):
        t = y / h
        band = 120.0 * np.exp(-(((y - (120.0 + 140.0 * np.sin(t * np.pi))) ** 2) / (2 * 45.0**2)))
        img[y, :] += band
    yy, xx = np.ogrid[:h, :w]
    for i in range(14):
        cx = float(60 + i * 38 + int(rng.integers(-4, 5)))
        cy = float(120 + 140 * np.sin(((i * 38) / w) * np.pi) + int(rng.integers(-6, 7)))
        img += 140.0 * np.exp(-(((xx - cx) ** 2) / (2 * 14.0**2) + ((yy - cy) ** 2) / (2 * 26.0**2)))
    img += rng.normal(0.0, 8.0, size=(h, w)).astype(np.float32)
    img = np.clip(img, 0, 255).astype(np.uint8)
    rgb = np.stack([img] * 3, axis=-1)
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="PNG")
    return buf.getvalue()


def _standin_path() -> Path:
    path = WORK / "STANDIN_NOT_IMPLANT.pt"
    if not path.exists():
        from app import model as model_mod

        model_mod.build_standin(path, seed=STANDIN_SEED)
    return path


STANDIN = _standin_path()

# Environment must be set before app.main (which loads the model at import).
os.environ["MODEL_PATH"] = str(STANDIN)
os.environ["ALLOW_STANDIN"] = "1"
os.environ.setdefault("ULTRALYTICS_SAFE_LOAD", "1")

from fastapi.testclient import TestClient  # noqa: E402

from app import main as main_mod  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(main_mod.app)


@pytest.fixture()
def xray_bytes():
    return synthetic_xray()

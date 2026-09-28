"""Shared fixtures — build the SYNTHETIC stand-in checkpoint and a synthetic
dental-arch-like OBJ mesh under /tmp (the repo worktree is never touched),
and point the service at them BEFORE app.main is imported.

The stand-in is a real MeshSegNet architecture with random weights, saved in
the official torch.save() container shape and declaring itself synthetic
(is_standin=True). It is loadable only because ALLOW_STANDIN=1, and every
response carries is_standin_not_meshsegnet=true (asserted in the tests).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
ENGINE_ROOT = HERE.parent
sys.path.insert(0, str(ENGINE_ROOT))

TMP = Path("/tmp/meshsegnet-man-engine-tests")
STANDIN = TMP / "STANDIN_NOT_MESHSEGNET.pt"
MESH = TMP / "synthetic_arch.obj"


def _write_synthetic_mesh() -> None:
    """A deterministic UV-sphere triangulation at dental-arch scale
    (millimetres, ~30 mm radius) — small enough to skip the official
    decimation step (<= 10,000 cells) so the sandbox needs no VTK."""
    rng = np.random.default_rng(7)
    lat = 12
    lon = 24
    radius = 30.0
    phi = np.linspace(0.15, np.pi - 0.15, lat)
    theta = np.linspace(0, 2 * np.pi, lon, endpoint=False) + rng.uniform(-0.02, 0.02, lon)
    pts = []
    for i, p in enumerate(phi):
        for t in theta:
            pts.append([
                radius * np.sin(p) * np.cos(t),
                radius * np.cos(p),
                radius * np.sin(p) * np.sin(t),
            ])
    pts = np.asarray(pts)
    lines = ["# synthetic dental-arch-like surface (test fixture, mm units)"]
    for x, y, z in pts:
        lines.append(f"v {x:.6f} {y:.6f} {z:.6f}")
    for i in range(lat - 1):
        for j in range(lon):
            a = i * lon + j
            b = i * lon + (j + 1) % lon
            c = (i + 1) * lon + j
            d = (i + 1) * lon + (j + 1) % lon
            lines.append(f"f {a + 1} {b + 1} {c + 1}")
            lines.append(f"f {b + 1} {d + 1} {c + 1}")
    MESH.write_text("\n".join(lines) + "\n", encoding="ascii")


def _ensure_fixtures() -> None:
    if STANDIN.exists() and MESH.exists():
        return
    TMP.mkdir(parents=True, exist_ok=True)
    from app import model as model_mod

    model_mod.build_standin(STANDIN)
    _write_synthetic_mesh()


# Must run before any test imports app.main (module-level build).
_ensure_fixtures()
os.environ.setdefault("MODEL_PATH", str(STANDIN))
os.environ.setdefault("ALLOW_STANDIN", "1")
os.environ.setdefault("STAY_UP_ON_REJECT", "1")  # keep 503/health paths testable


@pytest.fixture(scope="session")
def standin_path() -> Path:
    return STANDIN


@pytest.fixture(scope="session")
def mesh_bytes() -> bytes:
    return MESH.read_bytes()

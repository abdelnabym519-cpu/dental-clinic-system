"""model.py — MeshSegNet artifact registry + model loading (Phase 19B, D2).

Mirrors the Liodon engine's load policy (ai/engines/liodon/app/model.py):
the registry pins the exact validated artifact and the checksum is the
identity of the model. A mismatched checksum means a different model, full
stop.

The registry below is the exact validated artifact, mirrored from
ai-validation/meshsegnet (MODEL_PROVENANCE.md, model/README.md,
scripts/verify_artifacts.py):

    publisher   : Chunfeng Lian & Tai-Hsien Wu (official repository)
    repository  : https://github.com/Tai-Hsien/MeshSegNet (master)
    file        : models/<jaw> archive — a PyTorch torch.save() archive
                  (zip container) despite the .zip suffix
    licence     : MIT
    arch        : MeshSegNet(num_classes=15, num_channels=15)
                  (official architecture, vendored in meshsegnet_arch.py)
    output head : output_conv.weight (15, 128, 1) -> 15 classes
    classes     : 15 = gingiva + 14 teeth. The official repository
                  publishes NO label-to-tooth-name map (provenance §3),
                  so only neutral names are used (Gingiva, Tooth_1..14)
                  and numeric ids are the recorded identity.

Load policy (identical in spirit to Liodon's):
  1. file must exist
  2. SHA-256 computed from the bytes
  3. real artifact: mismatch with the registry hash is a HARD STOP
     (ModelRejectedError) — the service refuses to start. No override.
  4. a synthetic stand-in (STANDIN archive) is accepted ONLY when
     ALLOW_STANDIN=1 AND the archive declares itself synthetic in its own
     saved dict (is_standin=True). Every response it produces is flagged
     is_standin_not_meshsegnet=true. A real weight file with a wrong hash
     can never take this path.
  5. the state_dict must load with strict=True into the official
     architecture — 0 missing / 0 unexpected keys is the proof that the
     artifact is a MeshSegNet checkpoint for this architecture.
  6. CPU only (map_location='cpu', weights_only=False — the official
     checkpoint is a full optimizer-bearing dict, not a bare state_dict).
"""

from __future__ import annotations

import hashlib
import io
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

from .meshsegnet_arch import MeshSegNet

log = logging.getLogger("meshsegnet")

# ---------------------------------------------------------------------------
# Registry — the exact validated artifact (engine side). Mirrors
# ai-validation/meshsegnet/MODEL_PROVENANCE.md §2 and model/README.md — the
# single source of truth for the artifact is the validation lab; this copy
# is cross-checked by tests.
# ---------------------------------------------------------------------------

MESHSEGNET = {
    "name": "meshsegnet-max",
    "version": "1.0.0",
    "publisher": "Chunfeng Lian & Tai-Hsien Wu (official repository)",
    "source": (
        "https://github.com/Tai-Hsien/MeshSegNet@master"
        " (models/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip)"
    ),
    "license": "MIT",
    "architecture": "MeshSegNet (official implementation, vendored)",
    "runtime": "torch (CPU)",
    "device": "cpu",
    "jaw": "maxilla (upper)",
    "filename": "MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip",
    "expected_sha256": "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2",
    "expected_size_bytes": 28_860_102,
    "num_classes": 15,
    # Neutral class names — the official repository publishes no
    # label-to-tooth-name map (provenance §3); ids are the identity.
    "classes": {i: name for i, name in
                zip(range(15), ["Gingiva"] + [f"Tooth_{i}" for i in range(1, 15)])},
    "classes_note": (
        "15 classes = gingiva + 14 teeth (second molar to second molar). "
        "No official label-to-tooth-name mapping exists; numeric ids are "
        "the recorded identity."
    ),
    "input_spec": "triangular surface mesh (obj/stl/vtk/ply), millimetre units",
    "official_max_cells": 10_000,
}


class ModelRejectedError(RuntimeError):
    """Raised when the artifact at MODEL_PATH is not the validated model."""


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


@dataclass
class LoadedModel:
    model: MeshSegNet          # live CPU module in eval() mode
    path: Path
    size_bytes: int
    sha256: str
    sha256_expected: str
    is_standin: bool
    load_time_ms: int
    parameter_count: int


def _instantiate(ckpt: dict) -> MeshSegNet:
    """Strict load into the official architecture.

    strict=True with 0 missing / 0 unexpected keys is the structural proof
    that the archive is a MeshSegNet checkpoint (provenance §2). Any
    substitute, truncated download or wrong-architecture file fails here.
    """
    state = ckpt["model_state_dict"] if isinstance(ckpt, dict) and "model_state_dict" in ckpt else ckpt
    model = MeshSegNet(num_classes=15, num_channels=15, with_dropout=True, dropout_p=0.5)
    model.load_state_dict(state, strict=True)
    model = model.to("cpu", dtype=torch.float)
    model.eval()
    return model


def load_model_bytes(data: bytes, expected_sha256: str, expected_size: int,
                     allow_standin: bool) -> LoadedModel:
    """Load + verify from in-memory bytes (shared by the file loader and
    the sandbox test harness)."""
    if len(data) != expected_size or sha256_of_bytes(data).lower() != expected_sha256.lower():
        is_declared_standin = False
        try:
            ckpt = torch.load(io.BytesIO(data), map_location="cpu", weights_only=False)
            is_declared_standin = isinstance(ckpt, dict) and ckpt.get("is_standin") is True
        except Exception:
            pass
        if allow_standin and is_declared_standin:
            # Accepted synthetic stand-in (sandbox CI plumbing only — the
            # orchestrator refuses to persist stand-in findings).
            model = _instantiate(torch.load(io.BytesIO(data), map_location="cpu", weights_only=False))
            return LoadedModel(
                model=model, path=Path("<standin>"), size_bytes=len(data),
                sha256=sha256_of_bytes(data), sha256_expected=expected_sha256,
                is_standin=True, load_time_ms=0,
                parameter_count=sum(v.numel() for v in model.state_dict().values()),
            )
        raise ModelRejectedError(
            f"artifact does not match the registry (expected SHA-256 "
            f"{expected_sha256}, size {expected_size}); refusing to load"
        )

    t0 = time.perf_counter()
    ckpt = torch.load(io.BytesIO(data), map_location="cpu", weights_only=False)
    if not isinstance(ckpt, dict) or "model_state_dict" not in ckpt:
        raise ModelRejectedError(
            "artifact is not a MeshSegNet checkpoint archive "
            "(missing top-level 'model_state_dict')"
        )
    model = _instantiate(ckpt)
    return LoadedModel(
        model=model, path=Path(""), size_bytes=len(data),
        sha256=sha256_of_bytes(data), sha256_expected=expected_sha256,
        is_standin=False,
        load_time_ms=int((time.perf_counter() - t0) * 1000),
        parameter_count=sum(v.numel() for v in model.state_dict().values()),
    )


def load_model(model_path: str, expected_sha256: str, expected_size: int,
               allow_standin: bool) -> LoadedModel:
    path = Path(model_path)
    if not path.exists():
        raise ModelRejectedError(f"model archive not found: {model_path}")
    return load_model_bytes(path.read_bytes(), expected_sha256, expected_size, allow_standin)


# ---------------------------------------------------------------------------
# Synthetic stand-in — sandbox CI plumbing only.
#
# Builds a real MeshSegNet architecture with RANDOM weights and saves it in
# the same torch.save() container shape as the official artifact, declaring
# itself synthetic via the is_standin key. It is ONLY loadable when
# ALLOW_STANDIN=1, and every /infer response it produces carries
# is_standin_not_meshsegnet=true, which the orchestrator rejects outright
# (synthetic plumbing runs may exercise the pipeline, but their findings
# must never be stored against a patient — same guard as Liodon).
# ---------------------------------------------------------------------------

def build_standin(path: Path, seed: int = 1907) -> str:
    torch.manual_seed(seed)
    model = MeshSegNet(num_classes=15, num_channels=15, with_dropout=True, dropout_p=0.5)
    payload = {
        "model_state_dict": model.state_dict(),
        "is_standin": True,
        "note": "SYNTHETIC STAND-IN — random weights. NOT the official MeshSegNet artifact. "
                "Loadable only with ALLOW_STANDIN=1; every response is flagged "
                "is_standin_not_meshsegnet=true and must never be stored against a patient.",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(payload, str(path))
    return sha256_of(path)

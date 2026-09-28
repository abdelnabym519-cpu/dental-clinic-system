"""
model.py — Orthodontic AI engine: artifact registry + restricted loading.

Phase 19B, engine 3 of 3 (port 8005).

The artifact is the MICCAI CLDetection2023 winning solution (team SUTD-VLG):
38 cephalometric landmarks on lateral cephalometric radiographs, HRNet-W48
backbone + SRPose head, top-down mmpose-1.0 pipeline. The registry below is
the exact audited artifact, mirrored from ai-validation/cldetection2023
(AUDIT.md, 10 steps):

    repository  : 5k5000/CLdetection2023
    revision    : 18d17d1934970016e7610c4849311900b8d1f191 (head of master, 2026-07-28)
    config      : configs/CLdetection2023/srpose_s2.py
    file        : model_pretrained_on_train_and_val.pth
    size        : 268,846,952 bytes
    SHA-256     : fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc
    license     : Apache-2.0 (repository)
    architecture: TopdownPoseEstimator / HRNet / SRPoseHead, 38 joints,
                  66.8 M parameters, 1,969 tensors (audited control run)
    runtime     : 20.4 s inference / 1.82 GB peak RSS on the audited 2-vCPU
                  control run (random weights — mechanism evidence only)

Load policy (AUDIT.md §7 — fail-closed, torch 2.6 kept, guard stays on):
  1. file must exist; size + SHA-256 must match the audited artifact
  2. the checkpoint's pickle globals are scanned WITHOUT executing anything
     (safeload.enumerate_globals) and every one of them must be inside the
     bounded allow-list — an unexpected global is a hard stop
  3. exactly that allow-list is registered with
     torch.serialization.add_safe_globals, and init_model() loads through
     mmengine with torch's strict weights_only default still in force
  4. the loaded model must be the audited architecture:
     TopdownPoseEstimator, head num_joints == 38, dataset metainfo named
     'cephalometric'
  5. a synthetic stand-in (the same config-built model with fixed-seed
     random weights, saved in the same {'state_dict', 'meta'} container,
     self-declared in its own bytes) is accepted ONLY when ALLOW_STANDIN=1
     AND the marker bytes are present. Every response it produces carries
     is_standin_not_orthodontic=true, and the orchestrator refuses to
     persist stand-in results. The marker probe is a plain byte search —
     the file is never unpickled to look for it.

Landmark naming (provenance, like MeshSegNet): the repository's own
metainfo names the 38 keypoints "0".."37" (numeric placeholders). Neither
the repository nor the audited materials publish an anatomical name map,
so this engine reports the model's own vocabulary and never invents
clinical names.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

from . import safeload

log = logging.getLogger("orthodontic-ai")

# ---------------------------------------------------------------------------
# Registry — the exact audited artifact (D10, engine side).
# ---------------------------------------------------------------------------

ORTHODONTIC = {
    "name": "orthodontic-ai",
    "version": "1.0.0",
    "publisher": "Team SUTD-VLG (MICCAI CLDetection2023 winning solution)",
    "source": (
        "https://github.com/5k5000/CLdetection2023"
        "@18d17d1934970016e7610c4849311900b8d1f191 "
        "(model/model_pretrained_on_train_and_val.pth)"
    ),
    "source_repo": "5k5000/CLdetection2023",
    "source_revision": "18d17d1934970016e7610c4849311900b8d1f191",
    "license": "Apache-2.0 (repository)",
    "architecture": (
        "HRNet-W48 + SRPoseHead (TopdownPoseEstimator, mmpose-1.0 vendored fork)"
    ),
    "runtime": "mmpose 1.0.0 fork / mmcv-lite 2.1.0 / mmengine 0.10.7 / torch (CPU)",
    "device": "cpu",
    "filename": "model_pretrained_on_train_and_val.pth",
    "expected_sha256": "fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc",
    "expected_size_bytes": 268_846_952,
    "input_spec": "JPEG/PNG lateral cephalometric X-ray",
    "num_landmarks": 38,
    # The model's own vocabulary (repository metainfo, keypoint names "0".."37").
    # No anatomical name map is published by the audited sources — never
    # invented here.
    "landmarks": {i: str(i) for i in range(38)},
    "landmarks_note": (
        "38 cephalometric landmarks; the repository's metainfo names them "
        "\"0\"..\"37\" and no official anatomical label map is published, so "
        "the model's own vocabulary is what is reported (numeric ids are the "
        "recorded identity)."
    ),
    "num_parameters": 66_800_000,  # 66.8 M (audited control run, rounded)
    "num_tensors": 1_969,
}

# Repo layout (pinned revision): REPO_PATH/configs/CLdetection2023/srpose_s2.py
# and REPO_PATH/mmpose_package/mmpose/configs/_base_/datasets/cephalometric.py
DEFAULT_REPO_PATH = "/opt/cld2023"
CONFIG_RELATIVE = "configs/CLdetection2023/srpose_s2.py"
METAINFO_RELATIVE = "mmpose_package/mmpose/configs/_base_/datasets/cephalometric.py"

# Byte marker of the synthetic stand-in. Plain bytes search — no unpickling.
STANDIN_MARKER = b"is_standin_not_orthodontic"


class ModelRejectedError(RuntimeError):
    """Raised when the artifact at MODEL_PATH is not the audited checkpoint."""


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def _repo_paths() -> tuple[Path, Path, Path]:
    repo = Path(os.environ.get("REPO_PATH", DEFAULT_REPO_PATH))
    return repo, repo / CONFIG_RELATIVE, repo / METAINFO_RELATIVE


@dataclass
class LoadedModel:
    pose_model: object  # live mmpose TopdownPoseEstimator (strict-loaded)
    path: Path
    size_bytes: int
    sha256: str
    sha256_expected: str
    is_standin: bool
    landmark_names: dict
    load_time_ms: int
    parameter_count: int = 0
    globals_found: list = None

    @property
    def registry_entry(self) -> dict:
        """D10 registry view of what is actually loaded."""
        entry = dict(ORTHODONTIC)
        entry["model_version"] = ORTHODONTIC["version"]
        entry["model_path"] = str(self.path)
        entry["model_sha256"] = self.sha256
        entry["model_sha256_expected"] = self.sha256_expected
        entry["model_checksum_verified"] = (
            self.sha256.lower() == self.sha256_expected.lower() or self.is_standin
        )
        entry["model_size_bytes"] = self.size_bytes
        entry["is_standin_not_orthodontic"] = self.is_standin
        entry["parameter_count"] = self.parameter_count
        entry["num_landmarks"] = ORTHODONTIC["num_landmarks"]
        entry["landmarks"] = {str(k): v for k, v in sorted(self.landmark_names.items())}
        return entry


def _init_pose_model(checkpoint: str, cfg_path: Path, meta_file: Path):
    """init_model() with the metainfo fallback (AUDIT.md §8 repair 2).

    Primary path: pass the config as a PATH — init_model() then nulls the
    backbone's pretrained init_cfg (no network) and reads the dataset
    metainfo from the checkpoint's own `meta.dataset_meta` (the mmpose 1.x
    contract the real checkpoint carries).

    Fallback (checkpoint without meta.dataset_meta): the config's metainfo
    resolves CWD-relative inside mmpose, which fails from any other CWD.
    We rebuild the Config with the metainfo pointed at the VENDORED file by
    absolute path. The lab script pre-parsed the metainfo dict here; this
    engine passes the raw {'from_file': ...} reference instead, because
    this fork's parse_pose_metainfo() re-parses whatever the config holds
    and asserts on the RAW keypoint_info structure — a pre-parsed dict
    cannot survive that second parse.
    """
    from mmpose.apis import init_model

    try:
        return init_model(str(cfg_path), checkpoint=checkpoint, device="cpu"), "checkpoint/config"
    except FileNotFoundError:
        from mmengine.config import Config

        cfg = Config.fromfile(str(cfg_path))
        cfg.model.backbone.init_cfg = None  # never download pretrained HRNet
        cfg.train_dataloader.dataset.metainfo = {"from_file": str(meta_file)}
        model = init_model(cfg, checkpoint=checkpoint, device="cpu")
        return model, f"injected from {meta_file}"


def load_model(model_path: str, allow_standin: bool = False) -> LoadedModel:
    path = Path(model_path)
    if not path.exists():
        raise ModelRejectedError(f"checkpoint not found: {model_path}")

    data = path.read_bytes()
    sha = sha256_of_bytes(data)
    is_real = (
        len(data) == ORTHODONTIC["expected_size_bytes"]
        and sha.lower() == ORTHODONTIC["expected_sha256"].lower()
    )

    if not is_real:
        declared = STANDIN_MARKER in data
        if not (allow_standin and declared):
            raise ModelRejectedError(
                f"artifact does not match the audited checkpoint (expected "
                f"SHA-256 {ORTHODONTIC['expected_sha256']}, size "
                f"{ORTHODONTIC['expected_size_bytes']})"
                + (
                    " and is not a declared stand-in"
                    if allow_standin and not declared
                    else "; a stand-in is only accepted with ALLOW_STANDIN=1 "
                    "and a self-declaration in its own bytes"
                )
                + "; refusing to load"
            )

    # Security gate BEFORE any load: the file's pickle globals must all be
    # inside the bounded allow-list (AUDIT.md §7). A file whose pickle
    # cannot even be decoded is refused, not crashed on.
    try:
        globals_found = safeload.enumerate_globals(path)
        registered = safeload.register_safe_globals(globals_found)
    except safeload.CheckpointSecurityError as exc:
        raise ModelRejectedError(f"checkpoint failed the security gate: {exc}")
    except Exception as exc:
        raise ModelRejectedError(
            f"checkpoint could not be security-scanned: {type(exc).__name__}: {exc}"
        )

    cfg_path, meta_file = _repo_paths()[1], _repo_paths()[2]
    if not cfg_path.is_file():
        raise ModelRejectedError(f"repository config not found: {cfg_path} (REPO_PATH misconfigured?)")

    t0 = time.perf_counter()
    try:
        model, meta_source = _init_pose_model(str(path), cfg_path, meta_file)
    except safeload.CheckpointSecurityError:
        raise
    except ModelRejectedError:
        raise
    except Exception as exc:
        raise ModelRejectedError(f"checkpoint could not be loaded: {type(exc).__name__}: {exc}")
    load_time_ms = int((time.perf_counter() - t0) * 1000)

    if type(model).__name__ != "TopdownPoseEstimator":
        raise ModelRejectedError(
            f"loaded model is {type(model).__name__}, not the audited TopdownPoseEstimator"
        )
    num_joints = int(getattr(model.head, "num_joints", 0))
    if num_joints != ORTHODONTIC["num_landmarks"]:
        raise ModelRejectedError(
            f"head has {num_joints} joints, the audited model has "
            f"{ORTHODONTIC['num_landmarks']}"
        )
    if (model.dataset_meta or {}).get("dataset_name") != "cephalometric":
        raise ModelRejectedError(
            "dataset metainfo is not 'cephalometric' — not the audited model "
            "(a different dataset's checkpoint would silently relabel the 38 points)"
        )

    return LoadedModel(
        pose_model=model,
        path=path,
        size_bytes=len(data),
        sha256=sha,
        sha256_expected=ORTHODONTIC["expected_sha256"],
        is_standin=not is_real,
        landmark_names=dict(ORTHODONTIC["landmarks"]),
        load_time_ms=load_time_ms,
        parameter_count=sum(p.numel() for p in model.parameters()),
        globals_found=registered,
    )


# ---------------------------------------------------------------------------
# Synthetic stand-in — sandbox/CI plumbing only.
#
# Builds the REAL model from the audited config (fixed seed, random weights,
# no pretrained download) and saves it in the same {'state_dict', 'meta'}
# container the real checkpoint uses — including meta.dataset_meta, so it
# exercises the exact production load path (strict guard, metainfo from
# checkpoint). Loadable only with ALLOW_STANDIN=1; every response it
# produces is flagged is_standin_not_orthodontic=true, and the orchestrator
# refuses to persist such results. Coordinates from a random-init network
# are meaningless by construction (AUDIT.md §8) — the stand-in proves
# mechanism, never accuracy.
# ---------------------------------------------------------------------------


def build_standin(path: str | Path, seed: int = 1909) -> str:
    import torch
    from mmpose.apis import init_model
    from mmengine.config import Config

    _, cfg_path, meta_file = _repo_paths()
    if not cfg_path.is_file():
        raise ModelRejectedError(f"repository config not found: {cfg_path} (REPO_PATH misconfigured?)")

    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    cfg = Config.fromfile(str(cfg_path))
    cfg.model.backbone.init_cfg = None  # never download pretrained HRNet
    cfg.train_dataloader.dataset.metainfo = {"from_file": str(meta_file)}
    model = init_model(cfg, checkpoint=None, device="cpu")
    model.eval()

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    ckpt = {
        "state_dict": model.state_dict(),
        "meta": {"dataset_meta": model.dataset_meta},
        "is_standin_not_orthodontic": True,
        "standin_note": (
            "Synthetic stand-in: real audited config, random weights. "
            "Loadable only with ALLOW_STANDIN=1; every response is flagged "
            "is_standin_not_orthodontic=true and must never be stored "
            "against a patient."
        ),
    }
    torch.save(ckpt, path)
    return sha256_of(Path(path))

#!/usr/bin/env python3
"""
run_inference.py — real CPU landmark inference for Engine #6 (CLdetection2023).

This runs the repository's own pipeline — `srpose_s2.py` + the supplied pretrained
checkpoint + `mmpose.apis.inference_topdown` — on **one real lateral cephalometric
radiograph**, on the CPU, and records what happened. It does not retrain, convert
or reinterpret the model; it is `inference_single_image.py` with the two things
that script cannot do without the access-gated challenge dataset: a single image
argument, and no ground-truth annotation requirement.

Two repairs carried into this script (both documented in ../AUDIT.md):

1. **torch >= 2.6 vs mmengine 0.10.7.** `torch.load` now defaults to
   `weights_only=True`; mmengine calls it without that argument, so stock
   `init_pose_estimator()` raises `_pickle.UnpicklingError` on an mmpose-1.0
   checkpoint. Instead of downgrading torch, this script reads the checkpoint's
   pickle globals first (`inspect_checkpoint.py`), registers exactly the known
   reconstruction primitives, and keeps the strict default. An unexpected global
   is a hard stop, not a fallback.

2. **Metainfo resolution.** `init_model()` reads the dataset metainfo from the
   config, which points at `configs/_base_/datasets/cephalometric.py` — a path
   relative to the process CWD. A source (editable) install has no `.mim` copy to
   fall back on, so the lookup only succeeds when the checkpoint itself carries
   `meta.dataset_meta` or the CWD happens to be the mmpose package root. Here the
   vendored file is resolved absolutely and injected only if the first attempt
   fails, so the script runs from any directory.

Usage (Windows, inside the engine's venv):

    python scripts\\run_inference.py ^
        --repo  C:\\Users\\abdoo\\dental-clinic-system\\ai-validation\\cldetection2023\\CLdetection2023 ^
        --checkpoint model\\model_pretrained_on_train_and_val.pth ^
        --image input\\ceph_stack1_image1.png ^
        --expect-sha256 FB1A781AC1C83149B379CB15724E3B0FAE06BA2D567978F35C61E9D06B46FDCC ^
        --expect-size 268846952 ^
        --json-out reports\\engine6_run.json --out-image output\\ceph_landmarks.png
"""

from __future__ import annotations

import argparse
import codecs
import json
import platform
import sys
import time
from pathlib import Path

# --------------------------------------------------------------------------
# the allow-list: exactly what may be registered for weights_only=True
# --------------------------------------------------------------------------
# Keys are the pickle global names; values are how to resolve them. Anything the
# checkpoint names that is not here stops the run. Kept in step with
# inspect_checkpoint.SAFE_GLOBALS.
SAFE_GLOBAL_NAMES = (
    "torch._utils._rebuild_tensor_v2",
    "torch._utils._rebuild_parameter",
    "torch._utils._rebuild_parameter_with_state",
    "torch._utils._rebuild_parameter_with_state_dict",
    "torch._tensor._rebuild_from_type_v2",
    "torch.Size",
    "torch.device",
    "torch.FloatStorage",
    "torch.HalfStorage",
    "torch.LongStorage",
    "torch.IntStorage",
    "torch.ByteStorage",
    "torch.DoubleStorage",
    "collections.OrderedDict",
    "collections.Counter",
    "builtins.bytes",
    "builtins.set",
    "builtins.bytearray",
    "__builtin__.bytes",
    "__builtin__.set",
    "__builtin__.bytearray",
    "numpy.core.multiarray._reconstruct",
    "numpy.core.multiarray.scalar",
    "numpy._core.multiarray._reconstruct",
    "numpy._core.multiarray.scalar",
    "numpy.ndarray",
    "numpy.dtype",
    "pathlib.PosixPath",
    "pathlib.WindowsPath",
    "pathlib.PurePath",
)


NUMPY_DTYPE_NAMES = (
    "BoolDType", "Int8DType", "Int16DType", "Int32DType", "Int64DType",
    "UInt8DType", "UInt16DType", "UInt32DType", "UInt64DType",
    "Float16DType", "Float32DType", "Float64DType", "LongDoubleDType",
    "Complex64DType", "Complex128DType", "StrDType", "BytesDType",
    "ObjectDType", "VoidDType", "Datetime64DType", "Timedelta64DType",
    "StringDType", "HalfDType",
)


def allow_list_names() -> set:
    """The policy, as plain strings — usable (and testable) without torch installed."""
    names = set(SAFE_GLOBAL_NAMES)
    names |= {f"numpy.dtypes.{name}" for name in NUMPY_DTYPE_NAMES}
    names.add("_codecs.encode")
    names.add("numpy.dtype")
    return names


def unexplained_globals(globals_found) -> list:
    """The checkpoint's globals that this lab has not allow-listed (must be empty)."""
    allowed = allow_list_names()
    return sorted(g for g in globals_found if g not in allowed)


def build_allow_list():
    """Resolve the allow-list names to objects, skipping what this install lacks."""
    import importlib

    import numpy as np

    resolved = {}
    alias = {"__builtin__": "builtins"}
    for full in SAFE_GLOBAL_NAMES:
        module_name, _, attr = full.rpartition(".")
        module_name = alias.get(module_name, module_name)
        if module_name.startswith("numpy.dtypes"):
            continue                                    # handled generically below
        try:
            resolved[full] = getattr(importlib.import_module(module_name), attr)
        except Exception:
            continue
    # numpy's dtype *classes* (numpy >= 1.25 exposes one per scalar type): the
    # unpickler needs the dtype *instance* types, not just numpy.dtype
    for name in dir(np.dtypes):
        if name.endswith("DType"):
            resolved[f"numpy.dtypes.{name}"] = getattr(np.dtypes, name)
    resolved["_codecs.encode"] = codecs.encode
    resolved["numpy.dtype"] = np.dtype
    return resolved


def register_safe_globals(globals_found):
    """Register exactly the checkpoint's globals; return the list registered.

    Unknown globals stop the run: registering is a security decision, so it stays
    explicit and bounded rather than permissive.
    """
    unknown = unexplained_globals(globals_found)
    if unknown:
        raise SystemExit(
            "STOP — the checkpoint names globals this lab has not allow-listed:\n  "
            + "\n  ".join(unknown)
            + "\nRun scripts/inspect_checkpoint.py and send its JSON before loading this file.")
    import torch

    allow = build_allow_list()
    # Register the whole (bounded) allow-list, not only the names found in the file:
    # torch's unpickler also validates the *types of constructed objects*, and a
    # numpy dtype instance type (e.g. numpy.dtypes.UInt8DType) never appears as a
    # GLOBAL in the stream. Objects are passed rather than (obj, name) pairs so the
    # registry keys are their real module paths.
    torch.serialization.add_safe_globals(list(allow.values()))
    return sorted(set(globals_found))


def enumerate_globals(path: Path):
    """Non-executing scan of the checkpoint's pickle globals (no torch needed)."""
    import pickletools
    import zipfile
    found = set()
    try:
        with zipfile.ZipFile(path) as archive:
            payloads = [archive.read(n) for n in archive.namelist() if n.endswith(".pkl")]
    except zipfile.BadZipFile:
        payloads = [path.read_bytes()]
    for payload in payloads:
        for opcode, arg, _ in pickletools.genops(payload):
            if opcode.name == "GLOBAL":
                module, _, name = str(arg).partition(" ")
                found.add(f"{module}.{name}")
    return sorted(found)


def peak_ram_gb():
    try:
        import psutil
        return psutil.Process().memory_info().rss / 1024 ** 3, "psutil-current-rss"
    except Exception:
        pass
    try:
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 ** 2, "resource.ru_maxrss"
    except Exception:
        return None, "unavailable"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", required=True,
                        help="Path to the CLdetection2023 checkout (contains configs/ and mmpose_package/)")
    parser.add_argument("--config", default="configs/CLdetection2023/srpose_s2.py",
                        help="Config path, relative to --repo unless absolute")
    parser.add_argument("--checkpoint", required=True, help="Path to the .pth checkpoint")
    parser.add_argument("--image", required=True, help="Path to one real lateral cephalometric X-ray")
    parser.add_argument("--expect-sha256", default=None,
                        help="If given, the checkpoint must match or the run stops")
    parser.add_argument("--expect-size", type=int, default=None)
    parser.add_argument("--bbox", default=None,
                        help="Optional 'x1,y1,x2,y2' diagnostic crop; default is the repo's own "
                             "behaviour (whole-image bbox)")
    parser.add_argument("--json-out", default=None)
    parser.add_argument("--out-image", default=None, help="Write an overlay PNG of the landmarks")
    args = parser.parse_args()

    report = {
        "engine": "6 — CLdetection2023",
        "repo": str(Path(args.repo).resolve()),
        "config": args.config,
        "checkpoint": str(args.checkpoint),
        "checkpoint_sha256": None,
        "checkpoint_size": None,
        "device": "cpu",
        "torch_cuda_available": None,
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "globals_found": None,
        "globals_registered": None,
        "inference_seconds": None,
        "total_seconds": None,
        "peak_ram_gb": None,
        "peak_ram_source": None,
        "landmark_count": None,
        "keypoints": None,
        "scores_mean": None,
        "input_path": str(args.image),
        "input_sha256": None,
        "input_dimensions": None,
        "workarounds": [],
        "failure_reasons": [],
        "functional_inference": False,
        "clinical_validation": "NOT VALIDATED",
    }
    t_start = time.time()

    ckpt = Path(args.checkpoint)
    if not ckpt.is_file():
        report["failure_reasons"].append(f"checkpoint not found: {ckpt}")
        return _finish(report, args, 1)

    # ---- 1. identity ------------------------------------------------------
    from inspect_checkpoint import sha256_of          # same directory, no torch import
    report["checkpoint_size"] = ckpt.stat().st_size
    report["checkpoint_sha256"] = sha256_of(ckpt)
    if args.expect_sha256:
        if report["checkpoint_sha256"].lower() != args.expect_sha256.strip().lower():
            report["failure_reasons"].append("checkpoint sha256 does not match the expected value")
            return _finish(report, args, 6)
        report["checkpoint_sha256_verified"] = True
    if args.expect_size and report["checkpoint_size"] != args.expect_size:
        report["failure_reasons"].append("checkpoint size does not match the expected value")
        return _finish(report, args, 6)

    # ---- 2. what the pickle asks for, then register exactly that ----------
    globals_found = enumerate_globals(ckpt)
    report["globals_found"] = globals_found
    registered = register_safe_globals(globals_found)
    report["globals_registered"] = registered
    report["workarounds"].append(
        "torch>=2.6 weights_only=True: registered the checkpoint's own numpy/codecs "
        "reconstruction primitives instead of downgrading torch or disabling the guard")

    import cv2
    import numpy as np
    import torch
    from mmpose.apis import inference_topdown, init_model
    from mmpose.structures import merge_data_samples

    report["torch_version"] = torch.__version__
    report["torch_cuda_available"] = bool(torch.cuda.is_available())
    if report["torch_cuda_available"]:
        report["workarounds"].append("CUDA detected but the run is pinned to cpu")

    sys.path.insert(0, str(Path(args.repo).resolve()))
    from cldetection_utils import remove_zero_padding     # the repo's own preprocessing

    repo = Path(args.repo).resolve()
    cfg_path = Path(args.config)
    if not cfg_path.is_file():
        cfg_path = repo / args.config

    # ---- 3. model + weights ----------------------------------------------
    import mmpose
    from mmengine.config import Config
    from mmpose.datasets.datasets.utils import parse_pose_metainfo
    report["mmpose_version"] = mmpose.__version__
    import mmcv
    report["mmcv_version"] = mmcv.__version__
    import mmengine
    report["mmengine_version"] = mmengine.__version__
    report["numpy_version"] = np.__version__

    t0 = time.time()
    try:
        model = init_model(str(cfg_path), checkpoint=str(ckpt), device="cpu")
        report["metainfo_source"] = "checkpoint/config"
    except FileNotFoundError as exc:                      # metainfo path resolution
        meta_file = repo / "mmpose_package/mmpose/configs/_base_/datasets/cephalometric.py"
        if not meta_file.is_file():
            report["failure_reasons"].append(f"metainfo not resolvable: {exc}")
            return _finish(report, args, 4)
        cfg = Config.fromfile(str(cfg_path))
        cfg.train_dataloader.dataset.metainfo = parse_pose_metainfo({"from_file": str(meta_file)})
        model = init_model(cfg, checkpoint=str(ckpt), device="cpu")
        report["metainfo_source"] = f"injected from {meta_file}"
        report["workarounds"].append(
            "dataset metainfo resolved absolutely (CWD-independent) because the checkpoint "
            "carried no meta.dataset_meta")
    report["model_load_seconds"] = round(time.time() - t0, 2)
    report["architecture"] = {
        "estimator": type(model).__name__,
        "backbone": type(model.backbone).__name__,
        "head": type(model.head).__name__,
        "num_joints": int(getattr(model.head, "num_joints", 0)),
        "parameters_millions": round(sum(p.numel() for p in model.parameters()) / 1e6, 2),
    }
    model.eval()

    # ---- 4. the real image ------------------------------------------------
    img = cv2.imread(str(args.image))
    if img is None:
        report["failure_reasons"].append(f"image could not be read: {args.image}")
        return _finish(report, args, 1)
    import hashlib
    report["input_sha256"] = hashlib.sha256(Path(args.image).read_bytes()).hexdigest()
    report["input_dimensions"] = {"height": int(img.shape[0]), "width": int(img.shape[1]),
                                  "channels": int(img.shape[2]) if img.ndim == 3 else 1}
    img = remove_zero_padding(img)                       # exactly what the repo does
    report["input_dimensions_after_zero_padding"] = {"height": int(img.shape[0]),
                                                     "width": int(img.shape[1])}

    bboxes = None
    if args.bbox:
        bboxes = np.array([[float(v) for v in args.bbox.split(",")]], dtype=np.float32)
        report["workarounds"].append(f"diagnostic bbox override: {args.bbox}")

    # ---- 5. inference -----------------------------------------------------
    t0 = time.time()
    with torch.no_grad():
        preds = inference_topdown(model=model, img=img, bboxes=bboxes, bbox_format="xyxy")
    inference_s = time.time() - t0
    result = merge_data_samples(preds)
    keypoints = result.pred_instances.keypoints[0]
    scores = getattr(result.pred_instances, "keypoint_scores", None)

    report["inference_seconds"] = round(inference_s, 2)
    report["landmark_count"] = int(keypoints.shape[0])
    report["keypoints"] = [[round(float(x), 2), round(float(y), 2)] for x, y in keypoints]
    if scores is not None:
        report["scores_mean"] = round(float(scores[0].mean()), 6)
    report["functional_inference"] = bool(
        keypoints.size == 2 * report["landmark_count"] and np.isfinite(keypoints).all())
    ram, source = peak_ram_gb()
    report["peak_ram_gb"] = round(ram, 2) if ram else None
    report["peak_ram_source"] = source

    # ---- 6. overlay -------------------------------------------------------
    if args.out_image:
        canvas = img.copy()
        for index, (x, y) in enumerate(keypoints):
            if 0 <= x < canvas.shape[1] and 0 <= y < canvas.shape[0]:
                cv2.circle(canvas, (int(round(x)), int(y)), 6, (0, 0, 255), -1)
                cv2.putText(canvas, str(index + 1), (int(x) + 8, int(y) - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        out_img = Path(args.out_image)
        out_img.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_img), canvas)
        report["output_image"] = str(out_img)

    report["total_seconds"] = round(time.time() - t_start, 2)
    report["status"] = ("🟡 OPERATIONAL WITH WORKAROUND" if report["workarounds"]
                        else "🟢 OPERATIONAL") if report["functional_inference"] else "🔴 FAILED"
    print("=" * 78)
    print(f" landmarks : {report['landmark_count']}  finite={report['functional_inference']}")
    print(f" inference : {report['inference_seconds']}s   total {report['total_seconds']}s   "
          f"peak RAM {report['peak_ram_gb']} GB ({report['peak_ram_source']})")
    print(f" device    : cpu   (torch.cuda.is_available() = {report['torch_cuda_available']})")
    print(f" status    : {report['status']}   (clinical validation: NOT VALIDATED)")
    print("=" * 78)
    return _finish(report, args, 0 if report["functional_inference"] else 5)


def _finish(report: dict, args, code: int) -> int:
    report.setdefault("status", "🔴 FAILED" if code else "⚪ BLOCKED")
    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  wrote {out}")
    for reason in report.get("failure_reasons", []):
        print(f"  [FAIL] {reason}")
    return code


if __name__ == "__main__":
    sys.exit(main())

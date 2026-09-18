#!/usr/bin/env python3
"""
check_environment.py — verify the Engine #6 stack against the repository's own rules.

The rules are not invented here; they are read from the fork's source:

    mmpose_package/mmpose/mmpose/__init__.py
        mmcv_minimum_version     = '2.0.0rc4'
        mmcv_maximum_version     = '2.1.0'
        mmengine_minimum_version = '0.6.0'
        mmengine_maximum_version = '1.0.0'

plus the two things that bit this engine and are *not* in that file:

    * torch >= 2.6 defaults `torch.load` to `weights_only=True`, and
      mmengine 0.10.7's `load_from_local` calls `torch.load` without that argument
      — so a checkpoint load fails unless the run allow-lists the checkpoint's own
      numpy/codecs primitives (see inspect_checkpoint.py / run_inference.py).
    * `xtcocotools` (an mmpose dependency) is compiled against NumPy 1.x: on
      NumPy 2.x it raises "numpy.dtype size changed" during import.
    * `mmengine.utils.package_utils.get_installed_path` imports `pkg_resources`,
      which setuptools >= 81 no longer ships.

Usage:
    python scripts\\check_environment.py [--repo C:\\...\\CLdetection2023]
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path

MMCV_MIN, MMCV_MAX = "2.0.0rc4", "2.1.0"
MMENGINE_MIN, MMENGINE_MAX = "0.6.0", "1.0.0"
REQUIRED_TORCH_MIN = (2, 0, 0)


def parse_version(text: str):
    """Lenient version tuple: 2.0.0rc4 -> (2, 0, 0, 0); 2.1.0 -> (2, 1, 0)."""
    import re
    core = re.split(r"[a-zA-Z]", str(text).strip())[0]
    parts = [int(p) for p in core.split(".") if p.isdigit()]
    while len(parts) < 4:          # always compare 4-tuples, so 2.0.0rc4 == 2.0.0
        parts.append(0)
    return tuple(parts[:4])


def in_range(version: str, minimum: str, maximum: str) -> bool:
    return parse_version(minimum) <= parse_version(version) <= parse_version(maximum)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", default=None, help="Path to the CLdetection2023 checkout")
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    report = {"python_version": sys.version.split()[0], "checks": [], "ok": True}

    def check(name, ok, detail):
        report["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            report["ok"] = False

    versions = {}
    optional = {"mmcv.ops": "full mmcv (not needed: the fork uses mmcv.cnn only)"}
    for module in ("torch", "torchvision", "numpy", "cv2", "mmcv", "mmengine", "mmpose",
                   "xtcocotools", "munkres", "json_tricks"):
        try:
            mod = importlib.import_module(module)
            versions[module] = getattr(mod, "__version__", "unknown")
        except Exception as exc:
            versions[module] = f"NOT INSTALLED ({type(exc).__name__})"
    report["versions"] = versions

    check("torch imported", not versions["torch"].startswith("NOT"),
          f"torch {versions['torch']}")
    if not versions["torch"].startswith("NOT"):
        import torch
        report["torch_cuda_available"] = bool(torch.cuda.is_available())
        report["torch_cuda_build"] = torch.version.cuda
        check("torch >= 2.0", parse_version(versions["torch"]) >= REQUIRED_TORCH_MIN,
              f"torch {versions['torch']}")
        if parse_version(versions["torch"]) >= (2, 6, 0):
            try:
                has_api = hasattr(torch.serialization, "add_safe_globals")
            except Exception:
                has_api = False
            check("torch>=2.6 weights_only workaround available", has_api,
                  "torch.serialization.add_safe_globals present — run_inference.py needs it "
                  "because mmengine 0.10.7 calls torch.load without weights_only")

    check("mmcv in [2.0.0rc4, 2.1.0]", in_range(versions["mmcv"], MMCV_MIN, MMCV_MAX),
          f"mmcv {versions['mmcv']}")
    check("mmengine in [0.6.0, 1.0.0]",
          in_range(versions["mmengine"], MMENGINE_MIN, MMENGINE_MAX),
          f"mmengine {versions['mmengine']}")
    check("mmpose == 1.0.0", versions["mmpose"] == "1.0.0", f"mmpose {versions['mmpose']}")

    if not versions["numpy"].startswith("NOT"):
        major = parse_version(versions["numpy"])[0]
        check("numpy 1.x (xtcocotools ABI)", major == 1,
              f"numpy {versions['numpy']} — xtcocotools is built against numpy 1.x")
    try:
        import xtcocotools.mask  # noqa: F401
        check("xtcocotools imports (numpy ABI)", True, "xtcocotools._mask loaded")
    except Exception as exc:
        check("xtcocotools imports (numpy ABI)", False, f"{type(exc).__name__}: {exc}")

    try:
        import pkg_resources  # noqa: F401
        import setuptools
        check("pkg_resources available (setuptools<81)", True,
              f"setuptools {setuptools.__version__}")
    except Exception as exc:
        check("pkg_resources available (setuptools<81)", False,
              f"{type(exc).__name__}: {exc} — mmengine.utils.package_utils.get_installed_path "
              f"needs it (pip install \"setuptools<81\")")

    if versions["mmpose"] == "1.0.0":
        try:
            import mmpose  # noqa: F401
            from mmpose.apis import inference_topdown, init_model  # noqa: F401
            from mmpose.codecs import MSRAHeatmap  # noqa: F401
            from mmpose.models.heads.heatmap_heads.srpose_head import SRPoseHead  # noqa: F401
            check("mmpose inference API + SRPoseHead + MSRAHeatmap", True,
                  "mmpose.apis.inference_topdown / init_model / SRPoseHead / MSRAHeatmap import")
        except Exception as exc:
            check("mmpose inference API + SRPoseHead + MSRAHeatmap", False,
                  f"{type(exc).__name__}: {exc}")

    if args.repo:
        cfg = Path(args.repo) / "configs/CLdetection2023/srpose_s2.py"
        check("repository config present", cfg.is_file(), str(cfg))
        init_py = Path(args.repo) / "mmpose_package/mmpose/mmpose/__init__.py"
        if init_py.is_file():
            text = init_py.read_text(encoding="utf-8", errors="replace")
            check("fork declares the version ranges read here",
                  f"'{MMCV_MIN}'" in text and f"'{MMCV_MAX}'" in text
                  and f"'{MMENGINE_MIN}'" in text and f"'{MMENGINE_MAX}'" in text,
                  "mmpose/__init__.py asserts the same bounds this script enforces")

    print(json.dumps(report, indent=2, ensure_ascii=False))
    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {out}")
    print("ENVIRONMENT OK" if report["ok"] else "ENVIRONMENT PROBLEMS — see the failing checks",
          file=sys.stderr)
    return 0 if report["ok"] else 3


if __name__ == "__main__":
    sys.exit(main())

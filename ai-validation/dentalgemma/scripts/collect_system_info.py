#!/usr/bin/env python3
"""
collect_system_info.py — write a machine-readable snapshot of this machine.

Separate from `check_environment.py` on purpose: this script produces the record
that gets attached to a run, without printing advice. Run it before and after an
inference and keep both files — the difference is what the run actually cost.

Installs nothing, downloads nothing, runs no model.

Usage:
    python scripts/collect_system_info.py
    python scripts/collect_system_info.py --llama-dir .\\llama.cpp --out reports\\system_info.json
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent


def _load(name: str, filename: str):
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


sysinfo = _load("dg_sysinfo", "sysinfo.py")
artifacts = _load("dg_artifacts", "artifacts.py")


def disk_free_bytes(path: Path) -> int | None:
    try:
        return shutil.disk_usage(path).free
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--llama-dir", default=None, help="Searched for llama.cpp binaries")
    ap.add_argument("--llama-bin", default=None, help="Explicit llama.cpp executable")
    ap.add_argument("--out", default=None, help="Default: reports/system_info.json")
    args = ap.parse_args()

    mem = sysinfo.memory_bytes()
    llama = sysinfo.llama_cpp(binary_hint=args.llama_bin,
                              extra_dirs=[args.llama_dir] if args.llama_dir else [])

    record = {
        "schema": "dentalgemma.system_info/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python": sysinfo.python_info(),
        "os": sysinfo.os_info(),
        "cpu": {
            "model": sysinfo.cpu_model() or None,
            "logical_cores": sysinfo.logical_cpu_count(),
        },
        "memory": {
            "total_bytes": mem["total"],
            "available_bytes": mem["available"],
            "source": mem["source"],
        },
        "disk": {
            "lab_path": str(LAB),
            "free_bytes": disk_free_bytes(LAB),
            "model_bytes_required": artifacts.TOTAL_BYTES,
        },
        "gpu": {
            "nvidia": sysinfo.nvidia_gpus(),
            "intel": sysinfo.intel_gpus(),
        },
        "llama_cpp": llama,
        "environment_variables": {
            key: os.environ.get(key)
            for key in ("CUDA_VISIBLE_DEVICES", "GGML_VK_VISIBLE_DEVICES",
                        "LLAMA_CACHE", "OMP_NUM_THREADS")
        },
        "notes": [
            "Read-only snapshot; nothing was installed, downloaded or executed.",
            "Memory 'available' is what a new process can realistically use.",
        ],
    }

    out = Path(args.out) if args.out else LAB / "reports" / "system_info.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"platform : {record['os']['system']} {record['os']['release']} "
          f"({record['os']['machine']})")
    print(f"python   : {record['python']['version']}")
    print(f"cpu      : {record['cpu']['model'] or 'unknown'} "
          f"({record['cpu']['logical_cores']} logical cores)")
    print(f"ram      : {sysinfo.format_bytes(mem['total'])} total, "
          f"{sysinfo.format_bytes(mem['available'])} available")
    print(f"disk free: {sysinfo.format_bytes(record['disk']['free_bytes'])} "
          f"at {record['disk']['lab_path']}")
    print(f"llama.cpp: {'found: ' + str(llama['preferred']) if llama['preferred'] else 'not found'}")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

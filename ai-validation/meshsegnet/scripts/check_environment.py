#!/usr/bin/env python3
"""
check_environment.py — report the environment this lab will run in.

Read-only. Confirms the CPU-only contract before any inference is attempted,
and states plainly whether the required artifacts are present.

Usage:
    python scripts/check_environment.py
"""

from __future__ import annotations

import json
import platform
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent


def section(title: str) -> None:
    print(f"\n{title}")
    print("-" * len(title))


def main() -> int:
    print("=" * 74)
    print(" MeshSegNet validation lab — environment check")
    print("=" * 74)

    section("Interpreter")
    print(f"  python          : {sys.version.split()[0]}")
    print(f"  executable      : {sys.executable}")
    print(f"  platform        : {platform.platform()}")
    print(f"  machine         : {platform.machine()}")

    section("CPU / memory")
    try:
        import os

        cores = os.cpu_count()
        print(f"  logical cores   : {cores}")
    except Exception:
        pass
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal"):
                    kb = int(line.split()[1])
                    print(f"  total RAM       : {kb / 1048576:.2f} GB")
                    break
    except Exception:
        print("  total RAM       : (not readable)")

    section("Deep learning runtime")
    try:
        import torch

        print(f"  torch           : {torch.__version__}")
        print(f"  torch thread    : {torch.get_num_threads()}")
        cuda = torch.cuda.is_available()
        print(f"  CUDA available  : {cuda}")
        if cuda:
            print("  [WARN] a GPU is visible. This lab is CPU-only by contract;")
            print("         the runner pins execution to the CPU regardless.")
        else:
            print("  -> CPU-only machine, as intended.")
    except Exception as exc:
        print(f"  torch           : NOT AVAILABLE ({type(exc).__name__}: {exc})")

    section("Mesh / numeric libraries")
    for name in ("numpy", "scipy", "vedo", "vtk", "pydicom"):
        try:
            mod = __import__(name)
            ver = getattr(mod, "__version__", None)
            if name == "vtk":
                ver = mod.vtkVersion.GetVTKVersion()
            print(f"  {name:<15} : {ver}")
        except Exception:
            print(f"  {name:<15} : not installed")

    section("External tooling")
    for exe in ("nnUNetv2_predict", "git"):
        print(f"  {exe:<15} : {shutil.which(exe) or 'not found'}")

    section("Lab artifacts")
    models = sorted((LAB / "model").glob("MeshSegNet_*.zip"))
    meshes = sorted((LAB / "input" / "meshes").glob("*.*")) if (LAB / "input" / "meshes").exists() else []
    arch = LAB / "model" / "source" / "meshsegnet.py"
    print(f"  model archives  : {len(models)} found")
    for m in models:
        print(f"      {m.stat().st_size:>12,} B  {m.name}")
    print(f"  mesh inputs     : {len(meshes)} found")
    for m in meshes:
        print(f"      {m.stat().st_size:>12,} B  {m.name}")
    print(f"  official source : {'present' if arch.exists() else 'MISSING'} ({arch})")

    section("Verdict")
    ok = len(models) == 2 and len(meshes) >= 1 and arch.exists()
    if ok:
        print("  Environment ready for a real run.")
    else:
        print("  Artifacts missing. Run:")
        print("      python scripts/download_artifacts.py --models --meshes")

    out = LAB / "logs" / "environment.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "schema": "meshsegnet.environment/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "platform": platform.platform(),
        "models_found": [m.name for m in models],
        "meshes_found": [m.name for m in meshes],
        "architecture_source_present": arch.exists(),
    }, indent=2), encoding="utf-8")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
check_environment.py — report the environment this lab will run in.

Read-only. Confirms the CPU-only contract before any inference is attempted,
and states plainly whether the required artifacts are present.

Usage:
    python scripts/check_environment.py
"""

from __future__ import annotations

import ctypes
import importlib.util
import json
import os
import platform
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent


def load_compat():
    """Load the lab's shared compatibility shims (see scripts/compat.py)."""
    path = Path(__file__).resolve().parent / "compat.py"
    spec = importlib.util.spec_from_file_location("meshsegnet_compat", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("meshsegnet_compat", module)
    spec.loader.exec_module(module)
    return module


def section(title: str) -> None:
    print(f"\n{title}")
    print("-" * len(title))


def total_ram_bytes() -> int:
    """Total physical memory, portably, or 0 when it cannot be determined.

    ``/proc/meminfo`` is the obvious source but only exists on Linux; on Windows
    the equivalent is ``GlobalMemoryStatusEx``. psutil is used first when it is
    installed. Never raises.
    """
    try:
        import psutil  # optional

        return int(psutil.virtual_memory().total)
    except Exception:
        pass

    if os.name == "nt":
        try:
            class _MemoryStatusEx(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_uint32),
                    ("dwMemoryLoad", ctypes.c_uint32),
                    ("ullTotalPhys", ctypes.c_uint64),
                    ("ullAvailPhys", ctypes.c_uint64),
                    ("ullTotalPageFile", ctypes.c_uint64),
                    ("ullAvailPageFile", ctypes.c_uint64),
                    ("ullTotalVirtual", ctypes.c_uint64),
                    ("ullAvailVirtual", ctypes.c_uint64),
                    ("ullAvailExtendedVirtual", ctypes.c_uint64),
                ]

            status = _MemoryStatusEx()
            status.dwLength = ctypes.sizeof(_MemoryStatusEx)
            fn = ctypes.windll.kernel32.GlobalMemoryStatusEx
            fn.restype = ctypes.c_int
            fn.argtypes = [ctypes.POINTER(_MemoryStatusEx)]
            if fn(ctypes.byref(status)):
                return int(status.ullTotalPhys)
        except Exception:
            pass

    try:
        with open("/proc/meminfo", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("MemTotal"):
                    return int(line.split()[1]) * 1024
    except Exception:
        pass

    try:
        return int(os.sysconf("SC_PHYS_PAGES")) * int(os.sysconf("SC_PAGE_SIZE"))
    except Exception:
        return 0


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
    print(f"  logical cores   : {os.cpu_count()}")
    ram = total_ram_bytes()
    if ram:
        print(f"  total RAM       : {ram / 2**30:.2f} GB")
    else:
        print("  total RAM       : (could not be determined on this platform)")

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
    try:
        # vedo 2022.4.2 cannot even be imported on numpy >= 1.24 without this,
        # and would otherwise be reported here as "not installed".
        compat = load_compat()
        shim_messages: list[str] = []
        compat.install_numpy_warnings_shim(shim_messages)
        print(f"  np compat      : {shim_messages[-1]}")
    except Exception as exc:
        print(f"  np compat      : unavailable ({type(exc).__name__}: {exc})")
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

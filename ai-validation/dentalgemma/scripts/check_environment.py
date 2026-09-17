#!/usr/bin/env python3
"""
check_environment.py — report the machine this lab will run on.

Read-only. Installs nothing, downloads nothing, runs no model. It answers the
questions that decide whether a local DentalGemma run can succeed at all:

  * Python version and bitness
  * operating system
  * CPU model and logical core count
  * total and available RAM
  * whether an NVIDIA GPU / CUDA runtime is present
  * whether an Intel display adapter is present (Iris Xe territory)
  * whether llama.cpp is available, where, and which version
  * whether the two GGUF artifacts are present, and their sizes

Usage:
    python scripts/check_environment.py
    python scripts/check_environment.py --llama-dir .\\llama.cpp
    python scripts/check_environment.py --llama-bin C:\\tools\\llama\\llama-mtmd-cli.exe
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent


def _load(name: str, filename: str):
    """Load a sibling module by path (works from any working directory)."""
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


sysinfo = _load("dg_sysinfo", "sysinfo.py")
artifacts = _load("dg_artifacts", "artifacts.py")


def section(title: str) -> None:
    print(f"\n{title}")
    print("-" * len(title))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--llama-dir", default=None,
                    help="Folder holding an unpacked llama.cpp release (searched)")
    ap.add_argument("--llama-bin", default=None,
                    help="Explicit path to a llama.cpp executable")
    ap.add_argument("--json-out", default=None,
                    help="Also write the findings as JSON (default: logs/environment.json)")
    args = ap.parse_args()

    print("=" * 78)
    print(" DentalGemma validation lab — environment check")
    print("=" * 78)

    # ---- interpreter ------------------------------------------------------
    section("Interpreter")
    py = sysinfo.python_info()
    print(f"  python          : {py['version']} ({py['bits']}-bit, {py['implementation']})")
    print(f"  executable      : {py['executable']}")

    # ---- OS ---------------------------------------------------------------
    section("Operating system")
    osi = sysinfo.os_info()
    print(f"  system          : {osi['system']} {osi['release']}")
    print(f"  platform        : {osi['platform']}")
    print(f"  machine         : {osi['machine']}")

    # ---- CPU --------------------------------------------------------------
    section("CPU")
    model = sysinfo.cpu_model()
    print(f"  model           : {model or '(could not be determined on this platform)'}")
    print(f"  logical cores   : {sysinfo.logical_cpu_count()}")

    # ---- memory -----------------------------------------------------------
    section("Memory")
    mem = sysinfo.memory_bytes()
    print(f"  total RAM       : {sysinfo.format_bytes(mem['total'])}")
    print(f"  available RAM   : {sysinfo.format_bytes(mem['available'])}")
    print(f"  source          : {mem['source']}")
    if mem["total"]:
        need = artifacts.TOTAL_BYTES
        print(f"  needed by model : {sysinfo.format_bytes(need)} on disk "
              f"(both GGUF files), plus roughly the same again in RAM at run time")

    # ---- GPUs -------------------------------------------------------------
    section("Graphics")
    nv = sysinfo.nvidia_gpus()
    print(f"  NVIDIA present  : {nv['present']}")
    for gpu in nv["gpus"]:
        print(f"      {gpu}")
    for line in nv["evidence"]:
        print(f"      - {line}")
    intel = sysinfo.intel_gpus()
    print(f"  Intel adapter   : {intel['present']}")
    for adapter in intel["adapters"]:
        print(f"      {adapter}")
    for line in intel["evidence"]:
        print(f"      - {line}")
    print("  note            : this lab never requires a GPU. A GPU only changes")
    print("                    speed; every check below is CPU-compatible.")

    # ---- llama.cpp --------------------------------------------------------
    section("llama.cpp")
    dirs = [args.llama_dir] if args.llama_dir else []
    llama = sysinfo.llama_cpp(binary_hint=args.llama_bin, extra_dirs=dirs)
    print(f"  available       : {llama['available']}")
    if llama["binaries"]:
        for name, info in sorted(llama["binaries"].items()):
            print(f"  {name:<16}: {info.get('path')}")
            if info.get("version_line"):
                print(f"      {info['version_line']}")
            elif info.get("first_line"):
                print(f"      {info['first_line']}")
    else:
        print("  none found. Multimodal inference needs a llama.cpp binary.")
        print("  This lab uses llama-mtmd-cli (or llama-cli / llama-server).")
        print("  See LOCAL_EXECUTION.md, step 2, for the official Windows build.")
    if llama["preferred"]:
        print(f"  preferred tool  : {llama['preferred']}")
    if llama["obsolete_found"]:
        print(f"  [WARN] obsolete tool(s) present: {', '.join(llama['obsolete_found'])}")
        print("         llama.cpp replaced the LLaVA CLI with libmtmd; the current")
        print("         multimodal binaries are llama-mtmd-cli / llama-cli / llama-server.")
    if args.llama_dir and not Path(args.llama_dir).exists():
        print(f"  [WARN] --llama-dir does not exist: {args.llama_dir}")

    # ---- artifacts --------------------------------------------------------
    section("Model artifacts")
    present = 0
    artifact_report = {}
    for role, spec in artifacts.ARTIFACTS.items():
        path = LAB / "model" / spec["filename"]
        entry = {"path": str(path), "expected_size_bytes": spec["size_bytes"]}
        if path.is_file():
            size = path.stat().st_size
            entry.update({"present": True, "size_bytes": size,
                          "size_matches": size == spec["size_bytes"]})
            present += 1
            flag = "OK" if size == spec["size_bytes"] else "SIZE MISMATCH"
            print(f"  {role:<7}: {size:>13,} B  {flag}  {spec['filename']}")
        else:
            entry.update({"present": False})
            print(f"  {role:<7}: MISSING                 {spec['filename']}")
        artifact_report[role] = entry

    section("Verdict")
    findings: list[str] = []
    ready = True
    if not llama["usable_multimodal"]:
        findings.append("no usable llama.cpp multimodal binary found")
        ready = False
    if present < 2:
        findings.append(f"{2 - present} of 2 GGUF artifacts missing")
        ready = False
    if mem["total"] and mem["total"] < 8 * 2**30:
        findings.append("less than 8 GiB RAM: a 4B Q4_K_M model plus its f16 "
                        "projector may not fit comfortably")
    if mem["available"] and mem["available"] < 5 * 2**30:
        findings.append("less than 5 GiB RAM currently available")
    if not findings:
        print("  Environment has what a local run needs.")
    else:
        for line in findings:
            print(f"  - {line}")
        if ready:
            print("  Prerequisites are present; the notes above are cautions, not blockers.")
        else:
            print("  Prerequisites are missing. See LOCAL_EXECUTION.md steps 2 and 3.")

    out = Path(args.json_out) if args.json_out else LAB / "logs" / "environment.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "schema": "dentalgemma.environment/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python": py,
        "os": osi,
        "cpu": {"model": model, "logical_cores": sysinfo.logical_cpu_count()},
        "memory_bytes": mem,
        "nvidia": nv,
        "intel": intel,
        "llama_cpp": llama,
        "artifacts": artifact_report,
        "prerequisites_present": ready,
        "cautions": findings,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

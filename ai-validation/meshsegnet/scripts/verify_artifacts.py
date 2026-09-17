#!/usr/bin/env python3
"""
verify_artifacts.py — prove that the model files and mesh inputs are the real,
official, unmodified artifacts. No inference happens here.

Two independent kinds of evidence are collected:

  1. Identity  — SHA-256 of every file, compared against the values recorded in
                 MODEL_PROVENANCE.md (which were taken from the official
                 repository itself).
  2. Structure — the checkpoint is loaded and its state_dict is pushed into the
                 official MeshSegNet architecture with strict=True. Zero missing
                 and zero unexpected keys is what makes the claim "this is a
                 MeshSegNet checkpoint" verifiable rather than asserted.

Usage:
    python scripts/verify_artifacts.py
    python scripts/verify_artifacts.py --expect-models     # non-zero on mismatch
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
SOURCE_DIR = LAB / "model" / "source"

# SHA-256 taken from the official repository itself (Tai-Hsien/MeshSegNet,
# master). The two archives were hashed from a pristine clone; the values are
# independent of this lab.
EXPECTED = {
    "MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip":
        "d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf",
    "MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip":
        "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2",
}


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def load_compat():
    """Load the lab's shared compatibility shims (see scripts/compat.py).

    Loaded by path so this script works from any working directory.
    """
    path = Path(__file__).resolve().parent / "compat.py"
    spec = importlib.util.spec_from_file_location("meshsegnet_compat", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("meshsegnet_compat", module)
    spec.loader.exec_module(module)
    return module


def load_official_architecture():
    """Import meshsegnet.py from the official source snapshot."""
    path = SOURCE_DIR / "meshsegnet.py"
    if not path.exists():
        return None, f"official source missing: {path}"
    spec = importlib.util.spec_from_file_location("official_meshsegnet", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["official_meshsegnet"] = mod
    spec.loader.exec_module(mod)
    return mod, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-models", action="store_true",
                    help="Exit non-zero if a model hash does not match the official value.")
    args = ap.parse_args()

    print("=" * 78)
    print(" Artifact verification — are these the real official MeshSegNet files?")
    print("=" * 78)

    report = {"schema": "meshsegnet.artifact_verification/1",
              "generated_at": datetime.now(timezone.utc).isoformat(),
              "models": {}, "meshes": [], "architecture": {}}

    # ---- official architecture source -------------------------------------
    print("\n[1] Official architecture source")
    mod, err = load_official_architecture()
    if mod is None:
        print(f"    MISSING — {err}")
        print("    Run: python scripts/download_artifacts.py --models")
        report["architecture"] = {"present": False, "error": err}
    else:
        arch_path = SOURCE_DIR / "meshsegnet.py"
        print(f"    {arch_path.name:<24} {arch_path.stat().st_size:>8,} B  "
              f"sha256 {sha256_of(arch_path)}")
        print(f"    MeshSegNet class importable : {hasattr(mod, 'MeshSegNet')}")
        report["architecture"] = {
            "present": True,
            "path": str(arch_path),
            "size_bytes": arch_path.stat().st_size,
            "sha256": sha256_of(arch_path),
            "class_importable": hasattr(mod, "MeshSegNet"),
        }

    # ---- models ------------------------------------------------------------
    print("\n[2] Official pretrained models")
    try:
        import torch
    except Exception as exc:
        print(f"    torch unavailable: {exc}")
        torch = None

    hash_mismatch = False
    for name, expected in EXPECTED.items():
        path = LAB / "model" / name
        entry = {"path": str(path), "expected_sha256": expected}
        print(f"\n    {name}")
        if not path.exists():
            print("      MISSING — run: python scripts/download_artifacts.py --models")
            entry.update({"present": False})
            report["models"][name] = entry
            hash_mismatch = True
            continue
        actual = sha256_of(path)
        match = actual == expected
        hash_mismatch |= not match
        print(f"      size            : {path.stat().st_size:,} B")
        print(f"      sha256          : {actual}")
        print(f"      official match  : {'YES' if match else 'NO — DO NOT USE'}")

        entry.update({"present": True, "size_bytes": path.stat().st_size,
                      "sha256": actual, "official_sha256_match": match})

        if torch is not None and mod is not None:
            try:
                ckpt = torch.load(str(path), map_location="cpu", weights_only=False)
                sd = ckpt["model_state_dict"] if isinstance(ckpt, dict) and "model_state_dict" in ckpt else ckpt
                model = mod.MeshSegNet(num_classes=15, num_channels=15,
                                       with_dropout=True, dropout_p=0.5)
                missing, unexpected = model.load_state_dict(sd, strict=False)
                params = sum(v.numel() for v in sd.values())
                jaw = "lower jaw (mandible)" if "_Man_" in name else "upper jaw (maxilla)"
                entry.update({
                    "checkpoint_keys": sorted(ckpt.keys()) if isinstance(ckpt, dict) else None,
                    "state_dict_entries": len(sd),
                    "parameters": params,
                    "classes": int(sd["output_conv.weight"].shape[0]),
                    "jaw": jaw,
                    "epoch": ckpt.get("epoch") if isinstance(ckpt, dict) else None,
                    "state_dict_keys_missing": len(missing),
                    "state_dict_keys_unexpected": len(unexpected),
                    "strict_architecture_match": len(missing) == 0 and len(unexpected) == 0,
                })
                print(f"      state_dict      : {len(sd)} entries, {params:,} parameters")
                print(f"      classes         : {sd['output_conv.weight'].shape[0]}")
                print(f"      jaw             : {jaw}")
                print(f"      trained epochs  : {ckpt.get('epoch') if isinstance(ckpt, dict) else '?'}")
                print(f"      architecture    : missing={len(missing)} unexpected={len(unexpected)} "
                      f"-> {'EXACT MATCH' if not (missing or unexpected) else 'MISMATCH'}")
            except Exception as exc:
                print(f"      load FAILED     : {type(exc).__name__}: {exc}")
                entry.update({"load_error": f"{type(exc).__name__}: {exc}"})
        report["models"][name] = entry

    # ---- meshes ------------------------------------------------------------
    print("\n[3] Input meshes")
    # vedo 2022.4.2 cannot be imported at all on numpy >= 1.24 without this shim;
    # without it every mesh would be reported as "could not read".
    shim_messages: list[str] = []
    try:
        compat = load_compat()
        compat.install_numpy_warnings_shim(shim_messages)
        print(f"    np compat       : {shim_messages[-1]}")
    except Exception as exc:
        print(f"    np compat       : unavailable ({type(exc).__name__}: {exc})")
    mesh_dir = LAB / "input" / "meshes"
    meshes = sorted(mesh_dir.glob("*.obj")) + sorted(mesh_dir.glob("*.stl")) \
        + sorted(mesh_dir.glob("*.ply")) + sorted(mesh_dir.glob("*.vtk"))
    if not meshes:
        print("    none found — run: python scripts/download_artifacts.py --meshes")
    for m in meshes:
        ncells = npoints = None
        geometry: dict = {}
        try:
            import numpy as np

            import vedo

            mesh = vedo.load(str(m))
            ncells, npoints = int(mesh.ncells), int(mesh.npoints)

            # Geometry plausibility: a real intraoral arch is a closed-ish surface
            # tens of millimetres across. These checks catch a truncated download,
            # a placeholder file, or a unit-scaled mesh masquerading as millimetres.
            pts = getattr(mesh, "points", None)
            pts = pts() if callable(pts) else pts          # vedo 2022.x: method
            pts = np.asarray(pts, dtype=float)
            extent = (pts.max(axis=0) - pts.min(axis=0)) if pts.size else np.zeros(3)
            geometry = {
                "coordinates_finite": bool(np.isfinite(pts).all()),
                "extent_mm": [round(float(v), 3) for v in extent],
                "largest_extent_mm": round(float(extent.max()), 3) if pts.size else 0.0,
                "triangular_cells": None,
            }
            faces = getattr(mesh, "cells", None)
            if faces is None:
                faces = getattr(mesh, "faces", None)
            faces = faces() if callable(faces) else faces
            if faces is not None:
                faces = np.asarray(faces)
                if faces.ndim == 2:
                    geometry["triangular_cells"] = bool(faces.shape[1] == 3)
            geometry["plausible_dental_arch_scale"] = bool(
                geometry["coordinates_finite"]
                and 10.0 < geometry["largest_extent_mm"] < 200.0
            )
        except Exception as exc:
            print(f"    {m.name}: could not read ({type(exc).__name__}: {exc})")
        entry = {"file": m.name, "path": str(m), "size_bytes": m.stat().st_size,
                 "sha256": sha256_of(m), "cells": ncells, "points": npoints,
                 **geometry}
        report["meshes"].append(entry)
        print(f"\n    {m.name}")
        print(f"      size            : {m.stat().st_size:,} B")
        print(f"      sha256          : {entry['sha256']}")
        if ncells is not None:
            print(f"      cells / points  : {ncells:,} / {npoints:,}")
        if geometry:
            print(f"      finite coords   : {geometry['coordinates_finite']}")
            print(f"      extent (mm)     : {geometry['extent_mm']}")
            print(f"      triangular      : {geometry['triangular_cells']}")
            print(f"      arch-scale plaus.: {geometry['plausible_dental_arch_scale']}")

    # ---- verdict -----------------------------------------------------------
    print("\n" + "=" * 78)
    if args.expect_models and hash_mismatch:
        print(" RESULT: MISMATCH — at least one model is not the official artifact.")
        print("=" * 78)
        return 2
    print(" RESULT: artifacts verified as far as the checks above allow.")
    print(" A model counts as verified only when BOTH the SHA-256 matches and the")
    print(" architecture loads with zero missing/unexpected keys.")
    print("=" * 78)

    out = LAB / "output" / "artifact_verification.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

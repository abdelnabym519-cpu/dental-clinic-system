#!/usr/bin/env python3
"""
run_toothfairy2.py — real CPU inference for ToothFairy2, on a real CBCT.

    real CBCT (.mha / .nii.gz)
        -> optional format conversion (MHA -> NIfTI; geometry preserved)
        -> nnU-Net layout + environment
        -> nnUNetv2_predict  (CPU, 3d_fullres, fold 0)
        -> real segmentation
        -> label verification against the official dataset.json
        -> evidence record

    No training. No fine-tuning. No model conversion. No architecture change.
    No synthetic input. No mock output. Nothing is written to the ERP.

STATUS: UNEXECUTED.
    This script has never been run in Arena. It could not be: the official
    dataset requires an account, and no public-access CBCT exists. Every fact it
    relies on was read from official sources, but the script itself is untested.
    Treat the first run as a script test, and read the output rather than
    trusting it.

Official facts this script is built on (see MODEL_PROVENANCE.md for provenance):
    dataset id     119            ("Dataset119_ToothFairy2", from nnUNetPlans.json)
    plans          nnUNetPlans    (same file)
    configuration  3d_fullres     (patch [80,192,192], spacing 0.3mm isotropic)
    file ending    .nii.gz        (dataset.json)
    channel        CBCT -> input case must be <caseID>_0000.nii.gz
    labels         49 entries, 42 anatomical classes (dataset.json)

Assumptions you must confirm, because this lab could not:
    trainer name    default nnUNetTrainer. The checkpoint's own metadata is read
                    first; if it disagrees, the checkpoint wins.
    dataset id      119 is the benchmark's id. Your checkpoint may have been
                    trained under a different id. Override with --dataset-id.

Usage
-----
    python scripts/run_toothfairy2.py --input input/source/P381.mha --dry-run
    python scripts/run_toothfairy2.py --input input/source/P381.mha
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# --- Official label map, fetched verbatim from the official benchmark repo ---
# https://github.com/AImageLab-zip/ToothFairy2-Benchmark/blob/main/dataset.json
OFFICIAL_LABELS = {
    0: "background",
    1: "Lower Jawbone",
    2: "Upper Jawbone",
    3: "Left Inferior Alveolar Canal",
    4: "Right Inferior Alveolar Canal",
    5: "Left Maxillary Sinus",
    6: "Right Maxillary Sinus",
    7: "Pharynx",
    8: "Bridge",
    9: "Crown",
    10: "Implant",
    11: "Upper Right Central Incisor",
    12: "Upper Right Lateral Incisor",
    13: "Upper Right Canine",
    14: "Upper Right First Premolar",
    15: "Upper Right Second Premolar",
    16: "Upper Right First Molar",
    17: "Upper Right Second Molar",
    18: "Upper Right Third Molar (Wisdom Tooth)",
    19: "NA1",
    20: "NA2",
    21: "Upper Left Central Incisor",
    22: "Upper Left Lateral Incisor",
    23: "Upper Left Canine",
    24: "Upper Left First Premolar",
    25: "Upper Left Second Premolar",
    26: "Upper Left First Molar",
    27: "Upper Left Second Molar",
    28: "Upper Left Third Molar (Wisdom Tooth)",
    29: "NA3",
    30: "NA4",
    31: "Lower Left Central Incisor",
    32: "Lower Left Lateral Incisor",
    33: "Lower Left Canine",
    34: "Lower Left First Premolar",
    35: "Lower Left Second Premolar",
    36: "Lower Left First Molar",
    37: "Lower Left Second Molar",
    38: "Lower Left Third Molar (Wisdom Tooth)",
    39: "NA5",
    40: "NA6",
    41: "Lower Right Central Incisor",
    42: "Lower Right Lateral Incisor",
    43: "Lower Right Canine",
    44: "Lower Right First Premolar",
    45: "Lower Right Second Premolar",
    46: "Lower Right First Molar",
    47: "Lower Right Second Molar",
    48: "Lower Right Third Molar (Wisdom Tooth)",
}

# The structures named in the validation brief, mapped to their official ids.
WATCHED = {
    "Lower Jawbone": 1,
    "Upper Jawbone": 2,
    "Inferior Alveolar Canal": [3, 4],
    "Maxillary Sinus": [5, 6],
    "Teeth": list(range(11, 19)) + list(range(21, 29)) + list(range(31, 39)) + list(range(41, 49)),
    "Implant": 10,
    "Crown": 9,
    "Bridge": 8,
}

DEFAULT_DATASET_ID = 119
DEFAULT_PLANS = "nnUNetPlans"
DEFAULT_CONFIG = "3d_fullres"
DEFAULT_FOLD = 0
DEFAULT_TRAINER = "nnUNetTrainer"


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def rss_bytes():
    try:
        import psutil  # type: ignore

        return int(psutil.Process(os.getpid()).memory_info().rss)
    except Exception:
        pass
    if os.name == "nt":
        try:
            import ctypes

            class PMC(ctypes.Structure):
                _fields_ = [
                    ("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                ]
            c = PMC(); c.cb = ctypes.sizeof(PMC)
            if ctypes.windll.psapi.GetProcessMemoryInfo(
                ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb
            ):
                return int(c.WorkingSetSize)
        except Exception:
            pass
    try:
        import resource  # type: ignore

        ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(ru * 1024) if sys.platform != "darwin" else int(ru)
    except Exception:
        return None


def peak_working_set():
    if os.name != "nt":
        return None
    try:
        import ctypes

        class PMC(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]
        c = PMC(); c.cb = ctypes.sizeof(PMC)
        if ctypes.windll.psapi.GetProcessMemoryInfo(
            ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb
        ):
            return int(c.PeakWorkingSetSize)
    except Exception:
        return None
    return None


def convert_mha_to_nifti(src: Path, dst: Path) -> dict:
    """MHA -> NIfTI. This is an INPUT FORMAT change, not a model conversion.

    Geometry (origin, spacing, direction) is carried across and re-asserted
    afterwards, so the converter cannot silently introduce a shift.
    """
    import SimpleITK as sitk

    img = sitk.ReadImage(str(src))
    dst.parent.mkdir(parents=True, exist_ok=True)
    sitk.WriteImage(img, str(dst))

    back = sitk.ReadImage(str(dst))
    same = (
        tuple(img.GetSize()) == tuple(back.GetSize())
        and all(abs(a - b) < 1e-5 for a, b in zip(img.GetSpacing(), back.GetSpacing()))
        and all(abs(a - b) < 1e-4 for a, b in zip(img.GetOrigin(), back.GetOrigin()))
    )
    return {
        "source": str(src),
        "converted": str(dst),
        "source_size": list(img.GetSize()),
        "converted_size": list(back.GetSize()),
        "source_spacing": [float(s) for s in img.GetSpacing()],
        "converted_spacing": [float(s) for s in back.GetSpacing()],
        "geometry_preserved": bool(same),
    }


def read_ckpt_names(ckpt: Path) -> dict:
    """Read trainer/plans names from the checkpoint itself, if torch is present."""
    out = {"read": False}
    try:
        import torch

        d = torch.load(str(ckpt), map_location="cpu", weights_only=False)
        if isinstance(d, dict):
            out["read"] = True
            for k in ("trainer_name", "plans_name", "configuration", "fold", "epoch"):
                if k in d:
                    out[k] = d[k]
        del d
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
    return out


def main() -> int:
    p = argparse.ArgumentParser(
        description="Run real ToothFairy2 inference on CPU (nnU-Net, no training).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--input", required=True, help="Real CBCT: .mha (as published) or .nii.gz")
    p.add_argument("--checkpoint", default=None,
                   help="Default: source/model/fold_0/checkpoint_best.pth")
    p.add_argument("--dataset-id", type=int, default=DEFAULT_DATASET_ID)
    p.add_argument("--trainer", default=None, help=f"Default: checkpoint metadata, else {DEFAULT_TRAINER}")
    p.add_argument("--plans", default=None, help=f"Default: checkpoint metadata, else {DEFAULT_PLANS}")
    p.add_argument("--configuration", default=DEFAULT_CONFIG)
    p.add_argument("--fold", type=int, default=DEFAULT_FOLD)
    p.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"],
                   help="Default cpu. This lab is CPU-only; cuda is not available here.")
    p.add_argument("--case-id", default=None, help="Default: derived from the input filename")
    p.add_argument("--output-dir", default=None, help="Default: <lab>/output")
    p.add_argument("--dry-run", action="store_true", help="Validate everything and print the plan; run nothing")
    args = p.parse_args()

    lab = Path(__file__).resolve().parent.parent
    out_root = Path(args.output_dir) if args.output_dir else lab / "output"
    ckpt = Path(args.checkpoint) if args.checkpoint else lab / "source" / "model" / "fold_0" / "checkpoint_best.pth"
    inp = Path(args.input)

    print("=" * 78)
    print(" ToothFairy2 — real CPU inference")
    print("=" * 78)
    print("\n[STATUS] This runner is UNEXECUTED in Arena. The official dataset requires")
    print("         an account and no public CBCT exists, so it has never been run.")
    print("         Read its output; do not assume it works.")

    # ---- Preflight ------------------------------------------------------
    if not ckpt.exists():
        print(f"\n[STOP] Checkpoint not found: {ckpt}")
        return 3
    if not inp.exists():
        print(f"\n[STOP] Input not found: {inp}")
        print("       A real ToothFairy2 CBCT is required. See README.md — acquisition")
        print("       needs an account, and no synthetic volume may substitute for it.")
        return 3

    ckpt_size = ckpt.stat().st_size
    ckpt_sha = sha256_of(ckpt)
    in_sha = sha256_of(inp)
    print(f"\ncheckpoint : {ckpt}")
    print(f"  size     : {ckpt_size:,} bytes")
    print(f"  sha256   : {ckpt_sha}")
    print(f"\ninput      : {inp}")
    print(f"  size     : {inp.stat().st_size:,} bytes")
    print(f"  sha256   : {in_sha}")

    ckpt_meta = read_ckpt_names(ckpt)
    trainer = args.trainer or ckpt_meta.get("trainer_name") or DEFAULT_TRAINER
    plans = args.plans or ckpt_meta.get("plans_name") or DEFAULT_PLANS
    trainer_src = "cli" if args.trainer else ("checkpoint" if ckpt_meta.get("trainer_name") else "default")
    plans_src = "cli" if args.plans else ("checkpoint" if ckpt_meta.get("plans_name") else "default")
    print(f"\ntrainer    : {trainer}   (source: {trainer_src})")
    print(f"plans      : {plans}   (source: {plans_src})")
    print(f"dataset id : {args.dataset_id}")
    print(f"config/fold: {args.configuration} / {args.fold}")
    print(f"device     : {args.device}")

    if trainer_src == "default":
        print("\n[WARN] Trainer name came from this lab's default, not from your")
        print("       checkpoint. If the checkpoint does not carry `trainer_name`, the")
        print("       nnU-Net result folder name must match, or inference will not find")
        print("       the weights. Confirm and pass --trainer if needed.")

    # ---- nnU-Net presence -----------------------------------------------
    predict_exe = shutil.which("nnUNetv2_predict")
    if predict_exe is None:
        print("\n[STOP] nnUNetv2_predict is not on PATH.")
        print("       pip install nnunetv2   (then re-open the shell, or activate the venv)")
        return 4

    # ---- Layout ----------------------------------------------------------
    results = lab / "source" / "nnUNet_results"
    trainer_folder = f"{trainer}__{plans}__{args.configuration}"
    target_fold = results / f"Dataset{args.dataset_id:03d}_ToothFairy2" / trainer_folder / f"fold_{args.fold}"
    nifti_dir = lab / "input" / "nifti"
    run_dir = out_root / "run"

    case_id = args.case_id or inp.name.replace(".nii.gz", "").replace(".mha", "")
    nifti_in = nifti_dir / f"{case_id}_0000.nii.gz"

    conversion = None
    if inp.name.lower().endswith((".mha", ".mhd")):
        conversion = {"planned": True, "from": str(inp), "to": str(nifti_in)}
        print(f"\nconversion : {inp.name} -> {nifti_in.name}  (MHA -> NIfTI, geometry preserved)")
    else:
        conversion = {"planned": False, "reason": "input is already NIfTI"}
        if inp.name != nifti_in.name:
            print(f"\n[NOTE] nnU-Net requires the name <caseID>_0000.nii.gz.")
            print(f"       Expected {nifti_in.name}, got {inp.name}.")

    if args.dry_run:
        print("\n--- DRY RUN: nothing executed ---")
        print(f"  would create result layout : {target_fold}")
        print(f"  would place checkpoint at  : {target_fold / 'checkpoint_best.pth'}")
        print(f"  would stage input at       : {nifti_in}")
        print(f"  would write segmentation to: {run_dir}")
        print("\n  command that would run:")
        print(f"    {predict_exe} -i {nifti_dir} -o {run_dir} "
              f"-d {args.dataset_id} -c {args.configuration} -f {args.fold} "
              f"-tr {trainer} -p {plans} -device {args.device}")
        return 0

    # ---- Execute ---------------------------------------------------------
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    mem_before = rss_bytes()
    report: dict = {
        "schema": "toothfairy2.run_report/1",
        "started_at": started.isoformat(),
        "runner_status": "script never executed in Arena; first run is a script test",
        "checkpoint": {"path": str(ckpt), "size_bytes": ckpt_size, "sha256": ckpt_sha,
                       "metadata": ckpt_meta},
        "input": {"path": str(inp), "sha256": in_sha, "size_bytes": inp.stat().st_size},
        "configuration": {"dataset_id": args.dataset_id, "trainer": trainer,
                          "trainer_source": trainer_src, "plans": plans, "plans_source": plans_src,
                          "configuration": args.configuration, "fold": args.fold, "device": args.device},
        "conversion": conversion,
    }

    nifti_dir.mkdir(parents=True, exist_ok=True)
    if conversion.get("planned"):
        try:
            conv = convert_mha_to_nifti(inp, nifti_in)
        except Exception as exc:
            print(f"\n[FAIL] Conversion failed: {type(exc).__name__}: {exc}")
            report["success"] = False
            report["failure_stage"] = "conversion"
            report["failure"] = f"{type(exc).__name__}: {exc}"
            _write_report(out_root, report, started, time.perf_counter() - t0, mem_before)
            return 5
        report["conversion"] = conv
        print(f"\nconversion : geometry_preserved = {conv['geometry_preserved']}")
        if not conv["geometry_preserved"]:
            print("[STOP] Geometry was not preserved by the conversion. Refusing to continue.")
            report["success"] = False
            report["failure"] = "geometry not preserved on MHA->NIfTI conversion"
            _write_report(out_root, report, started, time.perf_counter() - t0, mem_before, peak_working_set())
            return 5
    elif inp.resolve() != nifti_in.resolve():
        shutil.copy2(inp, nifti_in)

    target_fold.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ckpt, target_fold / "checkpoint_best.pth")
    print(f"layout     : {target_fold}")

    env = dict(os.environ)
    env["nnUNet_results"] = str(results)
    env["nnUNet_raw"] = str(lab / "source" / "nnUNet_raw")
    env["nnUNet_preprocessed"] = str(lab / "source" / "nnUNet_preprocessed")
    env["nnUNet_compile"] = "false"
    for k in ("nnUNet_raw", "nnUNet_preprocessed", "nnUNet_results"):
        Path(env[k]).mkdir(parents=True, exist_ok=True)

    cmd = [
        predict_exe, "-i", str(nifti_dir), "-o", str(run_dir),
        "-d", str(args.dataset_id), "-c", args.configuration, "-f", str(args.fold),
        "-tr", trainer, "-p", plans, "-device", args.device, "-chk", "checkpoint_best.pth",
    ]
    print(f"\ncommand    : {' '.join(cmd)}\n")
    t_inf = time.perf_counter()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
    inference_s = time.perf_counter() - t_inf
    mem_after = rss_bytes()

    print(proc.stdout[-4000:] if proc.stdout else "(no stdout)")
    if proc.returncode != 0:
        print(proc.stderr[-4000:] if proc.stderr else "(no stderr)")
    report["inference"] = {
        "command": cmd,
        "returncode": proc.returncode,
        "inference_seconds": round(inference_s, 2),
        "stdout_tail": (proc.stdout or "")[-8000:],
        "stderr_tail": (proc.stderr or "")[-8000:],
    }
    report["memory"] = {"rss_before_bytes": mem_before, "rss_after_bytes": mem_after,
                        "peak_working_set_bytes": peak_working_set()}

    if proc.returncode != 0:
        print(f"\n[FAILED] nnUNetv2_predict exited {proc.returncode}")
        report["success"] = False
        report["failure_stage"] = "inference"
        _write_report(out_root, report, started, time.perf_counter() - t0, mem_before, peak_working_set())
        return 6

    # ---- Output verification --------------------------------------------
    seg_files = sorted(run_dir.rglob("*.nii.gz")) if run_dir.exists() else []
    if not seg_files:
        print(f"\n[FAILED] Inference returned 0 but produced no segmentation in {run_dir}")
        report["success"] = False
        report["failure_stage"] = "output_missing"
        _write_report(out_root, report, started, time.perf_counter() - t0, mem_before, peak_working_set())
        return 7

    seg = seg_files[0]
    import numpy as np

    arr, spacing, origin, direction, backend = _load(seg)
    present = sorted(int(v) for v in np.unique(arr))
    unknown = [v for v in present if v not in OFFICIAL_LABELS]

    report["output"] = {
        "path": str(seg),
        "size_bytes": seg.stat().st_size,
        "sha256": sha256_of(seg),
        "dimensions_zyx": list(map(int, arr.shape)),
        "dimensions_xyz": list(map(int, reversed(arr.shape))),
        "spacing_xyz": list(spacing),
        "datatype": str(arr.dtype),
        "unique_labels": present,
        "label_count": len(present),
        "unknown_labels": unknown,
        "labels_named": {str(v): OFFICIAL_LABELS.get(v, f"UNKNOWN({v})") for v in present},
    }

    watched_found = {}
    for name, ids in WATCHED.items():
        ids = ids if isinstance(ids, list) else [ids]
        hit = [i for i in ids if i in present]
        watched_found[name] = {"ids": ids, "present": hit, "found": bool(hit)}

    report["label_verification"] = {
        "official_label_count": len(OFFICIAL_LABELS),
        "labels_present": present,
        "all_present_labels_are_official": not unknown,
        "watched_structures": watched_found,
    }
    report["success"] = True
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    report["total_seconds"] = round(time.perf_counter() - t0, 2)

    print(f"\nsegmentation : {seg}")
    print(f"  size       : {seg.stat().st_size:,} bytes")
    print(f"  sha256     : {report['output']['sha256']}")
    print(f"  dimensions : {report['output']['dimensions_xyz']} (x,y,z)")
    print(f"  labels     : {len(present)} unique -> {present}")
    if unknown:
        print(f"  [WARN] labels not in the official dataset.json: {unknown}")
    print("\nwatched structures:")
    for name, d in watched_found.items():
        mark = "present" if d["found"] else "absent "
        print(f"  [{mark}] {name:26} ids {d['ids']}")

    _write_report(out_root, report, started, report["total_seconds"], mem_before, peak_working_set())
    print("\nReminder: a segmentation being produced does not make it correct. This is")
    print("a detector/segmenter output, not a diagnosis. Clinical review is required.")
    return 0


def _load(path: Path):
    try:
        import SimpleITK as sitk

        img = sitk.ReadImage(str(path))
        return (sitk.GetArrayFromImage(img), tuple(float(s) for s in img.GetSpacing()),
                tuple(float(o) for o in img.GetOrigin()), None, "SimpleITK")
    except ImportError:
        import nibabel as nib
        import numpy as np

        img = nib.load(str(path))
        return (np.asarray(img.dataobj), tuple(float(z) for z in img.header.get_zooms()[:3]),
                tuple(float(o) for o in img.affine[:3, 3]), None, "nibabel")


def _write_report(out_root: Path, report: dict, started, elapsed, mem_before, peak=None):
    out_root.mkdir(parents=True, exist_ok=True)
    report.setdefault("memory", {})
    report["memory"].update({"rss_before_bytes": mem_before,
                             "peak_working_set_bytes": peak})
    report["elapsed_seconds"] = round(elapsed, 2)
    path = out_root / "run_report.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    logs = out_root.parent / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    (logs / f"run_{stamp}.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nRun report: {path}")
    print(f"Run log   : {logs / f'run_{stamp}.json'}")


if __name__ == "__main__":
    raise SystemExit(main())

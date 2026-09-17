#!/usr/bin/env python3
"""
audit_compatibility.py — decide whether a CBCT volume can be fed to the
ToothFairy2 model, and say so with evidence rather than optimism.

A CBCT existing in ToothFairy4 does NOT mean it is valid input for the
ToothFairy2 model. The two datasets are related but were released separately,
the ToothFairy4 page warns that orientation may have changed, and an
orientation mismatch produces output that *looks* like a segmentation while
being anatomically wrong. This script exists to make that failure loud.

It reads one file and compares every property that matters against values taken
from official ToothFairy2 sources. It reports:

    VERIFIED       every checkable property matches official TF2 values
    UNKNOWN        something decisive could not be established from the file
    INCOMPATIBLE   a property positively conflicts with what the model requires

Read-only. It never modifies the input, and never writes a derived copy unless
you explicitly ask for the official RPI->LPS transform.

Usage
-----
    python scripts/audit_compatibility.py --input input/source/P381.nii.gz
    python scripts/audit_compatibility.py --input input/source/P381.nii.gz --case P381
    python scripts/audit_compatibility.py --input input/source/P381.nii.gz --emit-lps
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

# Reuse the reader, hasher and orientation decoder from the inspector so there
# is exactly one implementation of each.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_cbct import decode_orientation, load_volume, sha256_of  # noqa: E402

# ---------------------------------------------------------------------------
# What the official ToothFairy2 sources require.
# Every value below is sourced; see MODEL_PROVENANCE.md for the citations.
# ---------------------------------------------------------------------------

TF2_REQUIREMENTS = {
    "voxel_spacing_mm": {
        "expected": [0.3, 0.3, 0.3],
        "tolerance": 0.01,
        "source": "TF2 dataset page 'voxel spacing of 0.3mm isotropic'; "
                  "nnUNetPlans.json 3d_fullres spacing [0.3, 0.3, 0.3]",
        # nnU-Net resamples to the target spacing itself, so a mismatch is a
        # performance note, not a correctness failure.
        "severity": "note",
    },
    "intensity_scale": {
        "expected": "Hounsfield",
        # Official nnUNetPlans.json foreground_intensity_properties_per_channel,
        # computed by nnU-Net itself from the ToothFairy2 training data. These are
        # the authoritative numbers, so the check is built on them rather than on
        # an invented window.
        "official_foreground": {
            "min": -1000.0,
            "max": 5264.0,
            "mean": 811.6307983398438,
            "median": 940.4091796875,
            "std": 1000.9708251953125,
            "percentile_00_5": -991.9981689453125,
            "percentile_99_5": 3512.9248046875,
        },
        # A CBCT in Hounsfield units must contain air (clearly negative) and must
        # reach well above soft tissue (dense bone/enamel). Those two facts are
        # robust; exact extremes are not.
        "air_threshold": -200.0,
        "bone_threshold": 1000.0,
        "absolute_range": [-3000.0, 20000.0],
        "source": (
            "TF2 dataset page 'Values Scale: Hounsfield'; nnUNetPlans.json "
            "foreground_intensity_properties_per_channel (official percentiles)"
        ),
        "severity": "incompatible",
    },
    "file_ending": {
        "expected": [".nii.gz", ".mha"],
        "source": "dataset.json file_ending '.nii.gz'; TF2 publishes '.mha'",
        "severity": "note",
    },
    "image_reader_writer": {
        "expected": "SimpleITKIO",
        "source": "nnUNetPlans.json image_reader_writer",
        "severity": "note",
    },
    "transpose_forward": {
        "expected": [0, 1, 2],
        "source": "nnUNetPlans.json transpose_forward (identity: no axis permutation)",
        "severity": "note",
    },
    "dataset_id": {
        "expected": 119,
        "source": "nnUNetPlans.json dataset_name Dataset119_ToothFairy2",
        "severity": "note",
    },
}

# Documented TF2 volume shapes (dataset page). Used only as a sanity band.
TF2_DOCUMENTED_SHAPES = {
    "min case P381": (170, 272, 345),
    "median case P460": (170, 357, 371),
    "max case F039": (298, 512, 512),
}
# nnUNetPlans.json reports the median shape after transpose as [169, 347, 371].
TF2_MEDIAN_SHAPE_PLANS = (169, 347, 371)

# Orientation: TF2's public page does not state its orientation. This is the
# crux of the compatibility question and is recorded as UNKNOWN, not guessed.
TF2_ORIENTATION_DOCUMENTED = None
TF3_ORIENTATION_DOCUMENTED = "RPI"
TF4_ORIENTATION_WARNING = (
    "ToothFairy4 states: 'Sets P, F, and S come from ToothFairy3 (be careful about "
    "the volume orientation if you want to reuse the segmentation labels from "
    "ToothFairy3)'. So a ToothFairy4 volume's orientation may differ from "
    "ToothFairy3's documented RPI."
)


def check_spacing(spacing, index: int) -> dict:
    req = TF2_REQUIREMENTS["voxel_spacing_mm"]
    exp = req["expected"]
    tol = req["tolerance"]
    ok = all(abs(a - b) <= tol for a, b in zip(spacing, exp))
    isotropic = max(spacing) - min(spacing) <= tol
    return {
        "check": "voxel spacing",
        "observed": list(spacing),
        "expected": exp,
        "tolerance": tol,
        "isotropic": isotropic,
        "result": "MATCH" if ok else "MISMATCH",
        "severity": req["severity"],
        "source": req["source"],
        "implication": (
            "Matches the training spacing."
            if ok else
            "Differs from the training spacing. nnU-Net resamples to the target "
            "spacing during inference, so this is normally tolerable — but it means "
            "the volume has been through a resampling step somewhere, which is worth "
            "knowing when interpreting the result."
        ),
    }


def check_intensity(intensity, percentiles) -> dict:
    """Decide whether the volume is plausibly in Hounsfield units.

    Built on the official nnU-Net foreground percentiles rather than an invented
    window, and gated on two facts that hold for any CBCT in HU: it must contain
    air (clearly negative) and it must reach above soft tissue (dense bone).
    Exact extremes are noisy by nature and are not used as a hard gate.
    """
    req = TF2_REQUIREMENTS["intensity_scale"]
    official = req["official_foreground"]
    air_t = req["air_threshold"]
    bone_t = req["bone_threshold"]
    abs_lo, abs_hi = req["absolute_range"]

    lo, hi = intensity.get("min"), intensity.get("max")
    p05, p995 = percentiles.get("p0_5"), percentiles.get("p99_5")

    base = {
        "check": "intensity scale",
        "observed": {
            "min": lo, "max": hi, "mean": intensity.get("mean"),
            "percentile_00_5": p05, "percentile_99_5": p995,
        },
        "expected": req["expected"],
        "official_foreground": official,
        "severity": req["severity"],
        "source": req["source"],
    }

    if lo is None or hi is None or p05 is None or p995 is None:
        return {**base, "result": "UNKNOWN",
                "implication": "Intensity statistics could not be read from the volume."}

    # Decisive negative: no negative values at all. A CBCT in HU always has air.
    if lo >= 0:
        return {**base, "result": "MISMATCH",
                "implication": (
                    f"Minimum value is {lo:.0f} — there are no negative values, so there "
                    "is no air in the volume. Hounsfield units are negative for air "
                    "(-1000), so this volume is not in Hounsfield units. It has probably "
                    "been normalised, windowed or rescaled first. Feeding it to the model "
                    "would produce meaningless output."
                )}

    # Decisive negative: outside any physically plausible HU span.
    if lo < abs_lo or hi > abs_hi:
        return {**base, "result": "MISMATCH",
                "implication": (
                    f"Range [{lo:.0f}, {hi:.0f}] lies outside the physically plausible "
                    "Hounsfield span. This volume is not in Hounsfield units."
                )}

    air_ok = p05 < air_t
    bone_ok = p995 > bone_t

    if air_ok and bone_ok:
        return {**base, "result": "MATCH",
                "implication": (
                    f"Consistent with Hounsfield units: 0.5th percentile {p05:.0f} "
                    f"(air, official {official['percentile_00_5']:.0f}) and 99.5th "
                    f"percentile {p995:.0f} (dense tissue, official "
                    f"{official['percentile_99_5']:.0f}). Both the air and the bone "
                    "signatures are present."
                )}

    missing = []
    if not air_ok:
        missing.append(f"no air signature (0.5th percentile {p05:.0f}, expected well below {air_t:.0f})")
    if not bone_ok:
        missing.append(f"no dense-tissue signature (99.5th percentile {p995:.0f}, expected above {bone_t:.0f})")
    return {**base, "result": "UNKNOWN",
            "implication": (
                "Negative values are present, so the volume is not simply normalised to "
                "0-255, but it lacks " + " and ".join(missing) + ". It may be a tightly "
                "cropped field of view (little air), or a masked/derived volume. Inspect "
                "it visually before trusting it as model input."
            )}


def check_shape(shape_xyz, case: str | None) -> dict:
    nearby = []
    for name, s in TF2_DOCUMENTED_SHAPES.items():
        if len(s) == 3 and len(shape_xyz) == 3:
            ratio = [a / b for a, b in zip(shape_xyz, s)]
            if all(0.5 <= r <= 2.0 for r in ratio):
                nearby.append(name)
    return {
        "check": "volume shape",
        "observed_xyz": list(shape_xyz),
        "official_documented": {k: list(v) for k, v in TF2_DOCUMENTED_SHAPES.items()},
        "plans_median_after_transpose": list(TF2_MEDIAN_SHAPE_PLANS),
        "comparable_to": nearby,
        "result": "NOTE",
        "severity": "note",
        "source": "TF2 dataset page min/median/max shapes; nnUNetPlans.json median shape",
        "implication": (
            "Shape is not a compatibility requirement — nnU-Net crops and tiles to its "
            "patch size — but a shape far outside the documented band suggests a "
            "different field of view or a different preprocessing chain than TF2 used."
        ),
    }


def check_orientation(orientation, backend) -> dict:
    if orientation is None:
        return {
            "check": "radiological orientation",
            "observed": None,
            "result": "UNKNOWN",
            "severity": "unknown",
            "source": "direction matrix could not be interpreted",
            "implication": (
                "Could not determine orientation from the header. Do not proceed to "
                "inference without establishing it: an orientation error yields output "
                "that looks plausible and is anatomically wrong."
            ),
        }

    standard = orientation == "LPS"
    return {
        "check": "radiological orientation",
        "observed": orientation,
        "toothfairy3_documented": TF3_ORIENTATION_DOCUMENTED,
        "toothfairy2_documented": TF2_ORIENTATION_DOCUMENTED,
        "result": "UNKNOWN",
        "severity": "unknown",
        "source": (
            "TF3 dataset page documents RPI for TF3; the TF2 page does not state its "
            "orientation; TF4 warns its orientation may differ from TF3."
        ),
        "implication": (
            f"Volume reads as {orientation}. "
            + (
                "This is the standard LPS convention."
                if standard else
                "This is not the standard LPS convention, which is expected for the "
                "ToothFairy family (TF3 documents RPI)."
            )
            + " The decisive question — whether this matches what the TF2 model was "
            "trained on — CANNOT be answered from public documentation, because TF2 "
            "does not publish its orientation. It must be settled empirically before "
            "any result is trusted: run once, then confirm the segmentation lands on "
            "the anatomically correct structures (jaws, canals, sinuses) and is not "
            "mirrored. " + TF4_ORIENTATION_WARNING
        ),
        "official_transform_available": (
            "TF3 publishes an official RPI->LPS script at "
            "https://ditto.ing.unimore.it/static/toothfairy3/fix_orientation.py "
            "(operates on folders containing images*/ and labels*/). Use --emit-lps to "
            "apply it to a derived copy; the original is never modified."
        ),
    }


def emit_lps(src: Path, dst: Path) -> dict:
    """Apply the OFFICIAL ToothFairy orientation transform to a derived copy.

    Mirrors https://ditto.ing.unimore.it/static/toothfairy3/fix_orientation.py:
    flips the array along numpy axes 1 and 2 and carries the original header
    information across. The source file is never touched.
    """
    import numpy as np
    import SimpleITK as sitk

    volume = sitk.ReadImage(str(src))
    array = sitk.GetArrayFromImage(volume)
    rotated = np.flip(array, axis=1)
    rotated = np.flip(rotated, axis=2)
    out = sitk.GetImageFromArray(rotated)
    out.CopyInformation(volume)          # exactly as the official script does

    dst.parent.mkdir(parents=True, exist_ok=True)
    sitk.WriteImage(out, str(dst))

    return {
        "applied": True,
        "official_script": "https://ditto.ing.unimore.it/static/toothfairy3/fix_orientation.py",
        "method": "array flip on numpy axes 1 and 2, then CopyInformation(original)",
        "source": str(src),
        "derived_copy": str(dst),
        "source_orientation": decode_orientation(volume.GetDirection()),
        "derived_orientation": decode_orientation(sitk.ReadImage(str(dst)).GetDirection()),
        "source_sha256": sha256_of(src),
        "derived_sha256": sha256_of(dst),
        "source_unmodified": True,
        "note": (
            "The official script flips voxel data while carrying the original header "
            "across, so the direction matrix does NOT change — which is why the "
            "derived copy reads the same orientation code as the source. The transform "
            "is still a real reordering of the data. Record it and treat the derived "
            "file as a separate artifact."
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Audit a CBCT volume against official ToothFairy2 requirements.")
    ap.add_argument("--input", required=True, help="The volume to audit (.nii.gz or .mha)")
    ap.add_argument("--case", default=None, help="Case id, e.g. P381 (recorded only)")
    ap.add_argument("--emit-lps", action="store_true",
                    help="Also write a derived copy with the official orientation transform")
    ap.add_argument("--output-dir", default=None, help="Default: <lab>/output")
    args = ap.parse_args()

    lab = Path(__file__).resolve().parent.parent
    out_dir = Path(args.output_dir) if args.output_dir else lab / "output"
    src = Path(args.input)

    print("=" * 78)
    print(" Compatibility audit — is this volume usable by the ToothFairy2 model?")
    print("=" * 78)

    if not src.exists():
        print(f"\n[STOP] Not found: {src}")
        print("       This audit needs a real CBCT. No synthetic volume may stand in for one.")
        return 2

    arr, spacing, origin, direction, backend = load_volume(src)
    orientation = decode_orientation(direction)

    import numpy as np

    finite = arr[arr != 0] if arr.size else arr
    intensity, percentiles = {}, {}
    if finite.size:
        intensity = {
            "min": float(np.min(finite)),
            "max": float(np.max(finite)),
            "mean": float(np.mean(finite)),
        }
        # Percentiles over nonzero voxels — the analogue of nnU-Net's foreground
        # statistics, which is what the official numbers were computed from.
        p = np.percentile(finite, [0.5, 99.5])
        percentiles = {"p0_5": float(p[0]), "p99_5": float(p[1])}

    shape_zyx = tuple(int(v) for v in arr.shape)
    shape_xyz = tuple(reversed(shape_zyx))

    print(f"\nfile        : {src}")
    print(f"size        : {src.stat().st_size:,} bytes")
    print(f"sha256      : {sha256_of(src)}")
    print(f"shape x,y,z : {list(shape_xyz)}")
    print(f"spacing     : {[round(float(s), 4) for s in spacing]}")
    print(f"orientation : {orientation or '(not determinable)'}")
    print(f"datatype    : {arr.dtype}")
    if intensity:
        print(f"intensity   : min {intensity['min']:.1f}  max {intensity['max']:.1f}"
              f"  mean {intensity['mean']:.1f}")
    if percentiles:
        print(f"percentiles : p0.5 {percentiles['p0_5']:.1f}   p99.5 {percentiles['p99_5']:.1f}"
              f"   (official foreground p0.5 -992.0 / p99.5 3512.9)")

    checks = [
        check_spacing(spacing, 0),
        check_intensity(intensity, percentiles),
        check_shape(shape_xyz, args.case),
        check_orientation(orientation, backend),
    ]

    print("\n--- checks ---")
    for c in checks:
        mark = {"MATCH": "OK  ", "MISMATCH": "FAIL", "UNKNOWN": "????", "NOTE": "note"}[c["result"]]
        print(f"  [{mark}] {c['check']}: {c['result']}")
        print(f"         {c['implication']}")

    incompatible = [c for c in checks if c["result"] == "MISMATCH"]
    unknown = [c for c in checks if c["result"] == "UNKNOWN"]

    if incompatible:
        verdict = "INCOMPATIBLE"
    elif unknown:
        verdict = "UNKNOWN"
    else:
        verdict = "VERIFIED"

    derived = None
    if args.emit_lps:
        dst = lab / "input" / "nifti" / f"{(args.case or src.stem)}_lps.nii.gz"
        try:
            derived = emit_lps(src, dst)
            print(f"\n[derived copy written] {dst}")
            print(f"  source unchanged : {derived['source_unmodified']}")
        except Exception as exc:
            print(f"\n[WARN] could not write the derived copy: {type(exc).__name__}: {exc}")

    doc = {
        "schema": "toothfairy2.compatibility_audit/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "case": args.case,
        "input": {
            "path": str(src),
            "size_bytes": src.stat().st_size,
            "sha256": sha256_of(src),
            "shape_xyz": list(shape_xyz),
            "shape_zyx": list(shape_zyx),
            "spacing": [float(s) for s in spacing],
            "origin": [float(o) for o in origin] if origin is not None else None,
            "direction": [float(v) for v in direction] if direction is not None else None,
            "orientation": orientation,
            "datatype": str(arr.dtype),
            "intensity": intensity,
            "reader_backend": backend,
        },
        "toothfairy2_requirements": TF2_REQUIREMENTS,
        "checks": checks,
        "verdict": verdict,
        "derived_copy": derived,
        "verdict_meaning": {
            "VERIFIED": "Every checkable property matches official TF2 values.",
            "UNKNOWN": (
                "Some decisive property could not be established. This verdict does NOT "
                "mean the volume is fine. Most likely cause here: the orientation match "
                "against TF2 cannot be confirmed from public documentation, because TF2 "
                "does not publish its orientation."
            ),
            "INCOMPATIBLE": "A property positively conflicts. Do not run inference.",
        }[verdict],
        "next": (
            "Do not run inference until the UNKNOWN(s) are resolved."
            if verdict != "VERIFIED" else
            "Proceed with scripts/run_toothfairy2.py."
        ),
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "compatibility_audit.json"
    out.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\n" + "=" * 78)
    print(f" COMPATIBILITY: {verdict}")
    print("=" * 78)
    print(doc["verdict_meaning"])
    print(f"\nWrote {out}")
    return 0 if verdict == "VERIFIED" else 1


if __name__ == "__main__":
    raise SystemExit(main())

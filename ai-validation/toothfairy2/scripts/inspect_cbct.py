#!/usr/bin/env python3
"""
inspect_cbct.py — identify a CBCT volume and record its provenance.

Reads a real CBCT (.mha as published, or .nii.gz after conversion) and records
exactly what it is, so that a validation run can be tied to an input by hash
rather than by filename.

Records: filename, dimensions, spacing, datatype, size in bytes, SHA-256,
intensity range, and the source you state.

Writes output/input_provenance.json. Reads nothing else, changes nothing.

Usage
-----
    python scripts/inspect_cbct.py --input input/source/P381.mha
    python scripts/inspect_cbct.py --input input/source/P381.mha --source "ToothFairy2 official dataset (ditto.ing.unimore.it)"
    python scripts/inspect_cbct.py --input input/nifti/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

VOLUME_EXTS = {".mha", ".mhd", ".nii", ".nii.gz", ".nrrd", ".dcm"}


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


# SimpleITK works in LPS world space. For each image axis, the dominant world
# axis of the corresponding direction column gives the orientation letter.
# Positive/negative sense flips the letter within each pair.
_LPS_AXIS_LETTERS = (("L", "R"), ("P", "A"), ("S", "I"))


def decode_orientation(direction):
    """Turn a direction matrix into a 3-letter radiological orientation code.

    e.g. identity (LPS)          -> 'LPS'
         flipped X and Z columns -> 'RPI'

    Returns None when there is no usable direction matrix. This is a *reading*
    of the file's own header; it does not change anything.
    """
    if direction is None:
        return None
    try:
        import numpy as np

        d = np.asarray(direction, dtype=float).reshape(3, 3)
    except Exception:
        return None

    code = []
    for axis in range(3):          # image axis 0,1,2
        col = d[:, axis]
        dom = int(np.argmax(np.abs(col)))   # dominant world axis
        if abs(col[dom]) < 0.5:             # not axis-aligned enough to name
            return None
        positive, negative = _LPS_AXIS_LETTERS[dom]
        code.append(positive if col[dom] > 0 else negative)
    return "".join(code)


def load_volume(path: Path):
    """Read a volume with SimpleITK if available, else nibabel.

    Returns (array, spacing, origin, direction, backend) and raises if neither
    reader is installed rather than silently returning nothing.
    """
    try:
        import SimpleITK as sitk

        img = sitk.ReadImage(str(path))
        arr = sitk.GetArrayFromImage(img)  # z, y, x
        return (
            arr,
            tuple(float(s) for s in img.GetSpacing()),
            tuple(float(o) for o in img.GetOrigin()),
            tuple(float(d) for d in img.GetDirection()),
            "SimpleITK",
        )
    except ImportError:
        pass

    try:
        import nibabel as nib
        import numpy as np

        img = nib.load(str(path))
        arr = np.asarray(img.dataobj)
        # nibabel spacing is (x, y, z); report in the same order as SimpleITK
        zooms = tuple(float(z) for z in img.header.get_zooms()[:3])
        return arr, zooms, tuple(float(o) for o in img.affine[:3, 3]), None, "nibabel"
    except ImportError:
        raise SystemExit(
            "[FATAL] Neither SimpleITK nor nibabel is installed.\n"
            "        pip install SimpleITK        (or)  pip install nibabel"
        )


def describe(path: Path, source: str | None) -> dict:
    import numpy as np

    arr, spacing, origin, direction, backend = load_volume(path)
    orientation = decode_orientation(direction)

    # SimpleITK returns (z, y, x); report both so there is no ambiguity about
    # which axis is which when this is compared against the official shapes.
    shape_zyx = tuple(int(v) for v in arr.shape)
    shape_xyz = tuple(reversed(shape_zyx))

    finite = arr[arr != 0] if arr.size else arr
    def stat(fn, default=None):
        try:
            return float(fn(finite)) if finite.size else default
        except Exception:
            return default

    dtype = str(arr.dtype)
    is_hu = dtype.startswith(("int", "uint")) or "float" in dtype

    return {
        "filename": path.name,
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "sha256": sha256_of(path),
        "reader_backend": backend,
        "dimensions_zyx": list(shape_zyx),
        "dimensions_xyz": list(shape_xyz),
        "voxel_count": int(arr.size),
        "spacing_xyz": list(spacing),
        "origin": list(origin) if origin is not None else None,
        "direction": list(direction) if direction is not None else None,
        "orientation": orientation,
        "orientation_note": (
            "3-letter radiological code read from the file's own direction matrix. "
            "'LPS' is the standard; ToothFairy3 documents 'RPI' and ToothFairy4 warns "
            "that orientation may differ from ToothFairy3. This is a reading, not a change."
        ),
        "datatype": dtype,
        "intensity": {
            "min": stat(np.min),
            "max": stat(np.max),
            "mean": stat(np.mean, None),
            "note": (
                "Hounsfield units expected (dataset declares Hounsfield scale). "
                "Non-zero voxels only for the statistics."
            ),
            "all_integer": is_hu,
        },
        "source": source,
        "inspected_at": datetime.now(timezone.utc).isoformat(),
    }


def fmt_size(n: int) -> str:
    return f"{n:,} bytes ({n / 1048576:.2f} MiB)"


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect a CBCT volume and record its provenance")
    parser.add_argument("--input", required=True, help="A volume file, or a folder containing volumes")
    parser.add_argument("--source", default=None, help="Where this file came from (recorded verbatim)")
    parser.add_argument("--output-dir", default=None, help="Default: <lab>/output")
    args = parser.parse_args()

    lab = Path(__file__).resolve().parent.parent
    out_dir = Path(args.output_dir) if args.output_dir else lab / "output"
    in_path = Path(args.input)

    if not in_path.exists():
        print(f"[STOP] Not found: {in_path}")
        return 2

    if in_path.is_dir():
        files = sorted(
            p for p in in_path.rglob("*")
            if p.suffix.lower() in VOLUME_EXTS or p.name.lower().endswith(".nii.gz")
        )
        if not files:
            print(f"[STOP] No volumes ({', '.join(sorted(VOLUME_EXTS))}) in {in_path}")
            return 2
    else:
        files = [in_path]

    print("=" * 78)
    print(" CBCT input inspection")
    print("=" * 78)

    records = []
    for path in files:
        try:
            rec = describe(path, args.source)
        except SystemExit:
            raise
        except Exception as exc:
            print(f"\n[ERROR] {path.name}: {type(exc).__name__}: {exc}")
            return 3

        records.append(rec)
        i = rec["intensity"]
        print(f"\n{rec['filename']}")
        print(f"  size          : {fmt_size(rec['size_bytes'])}")
        print(f"  sha256        : {rec['sha256']}")
        print(f"  dimensions    : {rec['dimensions_xyz']} (x,y,z)  = {rec['dimensions_zyx']} (z,y,x)")
        print(f"  voxels        : {rec['voxel_count']:,}")
        print(f"  spacing       : {rec['spacing_xyz']}")
        print(f"  datatype      : {rec['datatype']}")
        print(f"  orientation   : {rec['orientation'] or '(not determinable)'}")
        print(f"  intensity     : min {i['min']}  max {i['max']}  mean {i['mean']}")
        print(f"  reader        : {rec['reader_backend']}")
        print(f"  source        : {rec['source'] or '(not stated)'}")

    document = {
        "schema": "toothfairy2.input_provenance/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": (
            "Input identity for a ToothFairy2 validation run. The SHA-256 here is what "
            "ties a result to the exact volume that produced it."
        ),
        "volumes": records,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "input_provenance.json"
    out.write_text(json.dumps(document, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}")

    # A useful cross-check against the official dataset statistics.
    print("\nOfficial dataset reference (ditto.ing.unimore.it/toothfairy2):")
    print("  min shape (P381) : (170, 272, 345)")
    print("  median (P460)    : (170, 357, 371)")
    print("  max shape (F039) : (298, 512, 512)")
    print("  voxel spacing    : 0.3 mm isotropic")
    print("Shapes are reported as (x, y, z) above — compare like for like.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

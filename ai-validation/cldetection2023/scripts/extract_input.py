#!/usr/bin/env python3
"""
extract_input.py — turn the official challenge test stack into a real input image.

Provenance (this is the whole point of the script):

    repository : szuboy/CL-Detection2023   (the MICCAI CLDetection2023 organisers'
                 own baseline, Apache-2.0)
    revision   : dc1ce2bd0a3f317de4160cde17e4a6f60371e67c
    path       : step5_docker_and_upload/test/stack1.mha
    content    : MetaImage, uint8, 2880 x 2400 x 2 slices, 3 channels
                 (`ElementType = MET_UCHAR`, `BinaryData = True`, `ElementDataFile = LOCAL`)

Those are the organisers' own validation inputs, published by them for people
running their baseline. No patient-identifying information is added here, no
image is invented, and nothing is downloaded from an unclear source.

The script reads the raw MetaImage bytes with the standard library + numpy:
`SimpleITK` would do it too, but it is not needed for a header this simple, and
avoiding it keeps the input step independent of the ML stack.

Usage:
    python scripts\\extract_input.py --stack C:\\path\\to\\stack1.mha --index 1 \\
        --out input\\ceph_stack1_image1.png --json-out reports\\input_provenance.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

EXPECTED_STACK_SHA256 = None      # recorded, not enforced: the challenge file may be re-fetched
EXPECTED_MHA_SIZE = 41_472_328    # 41,472,000 bytes of pixel data + a 328-byte header


def read_header(path: Path):
    """Return (header_dict, pixel_offset) for a MetaImageFile with LOCAL data."""
    with open(path, "rb") as handle:
        blob = handle.read(4096)
    marker = b"ElementDataFile"
    idx = blob.find(marker)
    if idx < 0:
        raise SystemExit(f"{path} does not look like a MetaImage file (no ElementDataFile)")
    end = blob.find(b"\n", idx)
    header_text = blob[: end + 1].decode("ascii", "replace")
    header = {}
    for line in header_text.splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            header[key.strip()] = value.strip()
    if header.get("ElementDataFile") != "LOCAL":
        raise SystemExit("only LOCAL data blocks are supported (this is what the challenge ships)")
    if header.get("ElementType") != "MET_UCHAR" or header.get("BinaryData") != "True":
        raise SystemExit(f"unexpected element type: {header.get('ElementType')} "
                         f"binary={header.get('BinaryData')}")
    return header, end + 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack", required=True, help="Path to stack1.mha")
    parser.add_argument("--index", type=int, default=1, help="1-based slice index (the file has 2)")
    parser.add_argument("--out", required=True, help="Where to write the PNG")
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    import cv2
    import numpy as np

    path = Path(args.stack)
    if not path.is_file():
        raise SystemExit(f"not found: {path}")
    header, offset = read_header(path)
    dims = [int(v) for v in re.split(r"\s+", header["DimSize"])]
    channels = int(header.get("ElementNumberOfChannels", 1))
    nx, ny, nz = dims[0], dims[1], dims[2]
    if not 1 <= args.index <= nz:
        raise SystemExit(f"--index must be 1..{nz}")

    raw = path.read_bytes()
    pixels = np.frombuffer(raw[offset:], dtype=np.uint8)
    per_slice = nx * ny * channels
    if pixels.size < per_slice * nz:
        raise SystemExit("truncated pixel block")

    slice_index = args.index - 1
    frame = pixels[slice_index * per_slice:(slice_index + 1) * per_slice].reshape(ny, nx, channels)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), frame)
    written = out.read_bytes()

    stamp = frame[:, :, 0]
    report = {
        "source_repository": "szuboy/CL-Detection2023",
        "source_revision": "dc1ce2bd0a3f317de4160cde17e4a6f60371e67c",
        "source_path": "step5_docker_and_upload/test/stack1.mha",
        "source_license": "Apache-2.0",
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "source_size_bytes": len(raw),
        "mha_header": {k: header[k] for k in sorted(header)},
        "slice_index": args.index,
        "slices_available": nz,
        "image_shape": [int(frame.shape[0]), int(frame.shape[1]), int(frame.shape[2])],
        "is_grayscale": bool((frame[:, :, 0] == frame[:, :, 1]).all()
                             and (frame[:, :, 1] == frame[:, :, 2]).all()),
        "pixel_min": int(stamp.min()), "pixel_max": int(stamp.max()),
        "pixel_mean": round(float(stamp.mean()), 2),
        "output_path": str(out),
        "output_sha256": hashlib.sha256(written).hexdigest(),
        "output_bytes": len(written),
        "note": ("a real lateral cephalometric radiograph published by the challenge organisers "
                 "for the same baseline this model came from; no patient-identifying data was "
                 "added and the image is not committed to git"),
    }
    print(json.dumps({k: report[k] for k in ("source_path", "slice_index", "image_shape",
                                             "is_grayscale", "output_sha256", "output_path")},
                     indent=2))
    if args.json_out:
        out_json = Path(args.json_out)
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {out_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

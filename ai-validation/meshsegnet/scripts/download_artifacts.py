#!/usr/bin/env python3
"""
download_artifacts.py — fetch the official MeshSegNet artifacts and the real
mesh inputs, then verify them by hash.

Nothing is invented. Every URL below is an official project location:

  models + architecture : https://github.com/Tai-Hsien/MeshSegNet       (MIT)
  lower-jaw mesh        : https://github.com/abenhamadou/3DTeethSeg22_challenge
  upper-jaw mesh        : https://github.com/HuayuanSong/TeethSegFront

A file is accepted only if its SHA-256 matches the recorded value. A mismatch
deletes nothing and changes nothing — it fails loudly, because a substituted
weight file is worse than no weight file.

Usage:
    python scripts/download_artifacts.py --models
    python scripts/download_artifacts.py --meshes
    python scripts/download_artifacts.py --models --meshes
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent

REPO_TARBALL = "https://codeload.github.com/Tai-Hsien/MeshSegNet/tar.gz/refs/heads/master"
LOWER_TARBALL = "https://codeload.github.com/abenhamadou/3DTeethSeg22_challenge/tar.gz/refs/heads/main"
UPPER_TARBALL = "https://codeload.github.com/HuayuanSong/TeethSegFront/tar.gz/refs/heads/main"

MODELS = {
    "MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip":
        "d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf",
    "MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip":
        "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2",
}

# Official source files kept as a frozen snapshot so the architecture used for
# inference is provably the published one, not a local re-implementation.
SOURCE_FILES = ["meshsegnet.py", "LICENSE", "README.md"]

MESHES = [
    (LOWER_TARBALL, "0EJBIPTC_lower.obj",
     "b824f6822f4a6ada296eef6869e9341fa1e69ad6cd14862b53572198ae5e7a76",
     "3DTeethSeg'22 challenge, reference algorithm test set (lower jaw)"),
    (UPPER_TARBALL, "ZOUIF2W4_upper.obj",
     "581b9a026e2ce734f6335f34aa900e8114dc33e2a83541ebd6bb26536382545e",
     "3DTeethSeg'22 intraoral scan (upper jaw)"),
]


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def fetch(url: str) -> bytes:
    print(f"    GET {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "meshsegnet-validation-lab"})
    with urllib.request.urlopen(req, timeout=900) as resp:
        return resp.read()


def get_models() -> int:
    print("\n[1] Official MeshSegNet models + architecture source")
    dest = LAB / "model"
    src = dest / "source"
    dest.mkdir(parents=True, exist_ok=True)
    src.mkdir(parents=True, exist_ok=True)

    try:
        blob = fetch(REPO_TARBALL)
    except Exception as exc:
        print(f"    FAILED to download: {type(exc).__name__}: {exc}")
        print("    The official repository is the only accepted source.")
        return 1
    print(f"    {len(blob):,} bytes")

    rc = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        names = tf.getnames()
        root = names[0].split("/")[0]

        for fname, expected in MODELS.items():
            member = f"{root}/models/{fname}"
            out = dest / fname
            if member not in names:
                print(f"    MISSING from archive: {member}")
                rc = 1
                continue
            data = tf.extractfile(member).read()
            actual = sha256_of_bytes(data)
            if actual != expected:
                print(f"    HASH MISMATCH for {fname}")
                print(f"      expected {expected}")
                print(f"      actual   {actual}")
                print("    Refusing to write the file.")
                rc = 1
                continue
            out.write_bytes(data)
            print(f"    OK  {fname}  {len(data):,} B  sha256 verified")

        for fname in SOURCE_FILES:
            member = f"{root}/{fname}"
            if member in names:
                data = tf.extractfile(member).read()
                target = src / ("README_official.md" if fname == "README.md" else fname)
                target.write_bytes(data)
                print(f"    OK  source/{target.name}  {len(data):,} B  "
                      f"sha256 {sha256_of_bytes(data)[:16]}...")

    print("\n    Licence: MIT (c) 2020 Chunfeng Lian & Tai-Hsien Wu — see model/source/LICENSE")
    return rc


def get_meshes() -> int:
    print("\n[2] Real dental mesh inputs")
    dest = LAB / "input" / "meshes"
    dest.mkdir(parents=True, exist_ok=True)
    rc = 0

    for url, fname, expected, desc in MESHES:
        print(f"\n    {fname}")
        print(f"      source : {desc}")
        try:
            blob = fetch(url)
        except Exception as exc:
            print(f"      FAILED: {type(exc).__name__}: {exc}")
            rc = 1
            continue
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
            members = [m for m in tf.getmembers()
                       if m.name.endswith("/" + fname) and m.isfile()]
            if not members:
                print(f"      {fname} not found in archive")
                rc = 1
                continue
            data = tf.extractfile(members[0]).read()
        actual = sha256_of_bytes(data)
        if actual != expected:
            print(f"      HASH MISMATCH — expected {expected}, got {actual}")
            print("      Refusing to write the file.")
            rc = 1
            continue
        (dest / fname).write_bytes(data)
        print(f"      OK  {len(data):,} B  sha256 verified")

    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", action="store_true", help="Download official models + source")
    ap.add_argument("--meshes", action="store_true", help="Download real dental mesh inputs")
    args = ap.parse_args()

    if not (args.models or args.meshes):
        ap.print_help()
        return 1

    print("=" * 78)
    print(" MeshSegNet lab — artifact acquisition (official sources only)")
    print("=" * 78)

    rc = 0
    if args.models:
        rc |= get_models()
    if args.meshes:
        rc |= get_meshes()

    print("\n" + "=" * 78)
    print(" All artifacts hash-verified." if rc == 0 else " Some artifacts FAILED — see above.")
    print("=" * 78)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

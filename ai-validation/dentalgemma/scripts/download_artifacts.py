#!/usr/bin/env python3
"""
download_artifacts.py — fetch the two official GGUF files, verify, then keep.

Downloading is the one step this lab cannot do for you: the files total 3.47 GiB
and are git-ignored on purpose. This script makes that step deterministic:

  * the URL is pinned to a repository **revision**, not to ``main``, so a later
    force-push cannot silently change what you get;
  * the download goes to ``<name>.part`` and is renamed only after the SHA-256
    matches the value published in Hugging Face's own file metadata — an
    interrupted or corrupted download therefore never lands as a usable file;
  * an already-correct file is left untouched (re-running is a no-op);
  * nothing is deleted, ever — a mismatch is reported, not repaired by force.

The repository is public and **not gated**, so no Hugging Face token is needed.
If that changes, this script will say so instead of failing obscurely.

Usage:
    python scripts/download_artifacts.py --all
    python scripts/download_artifacts.py --role main
    python scripts/download_artifacts.py --all --check      # verify only, no network
    python scripts/download_artifacts.py --all --urls       # print the URLs and exit
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import sys
import urllib.error
import urllib.request
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
MODEL_DIR = LAB / "model"


def _load(name: str, filename: str):
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


artifacts = _load("dg_artifacts", "artifacts.py")

CHUNK = 1 << 20


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(CHUNK)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def human(n: float) -> str:
    return f"{n / 2**30:.2f} GiB"


def check_one(role: str) -> dict:
    spec = artifacts.ARTIFACTS[role]
    path = MODEL_DIR / spec["filename"]
    if not path.is_file():
        return {"role": role, "present": False, "ok": False}
    size = path.stat().st_size
    if size != spec["size_bytes"]:
        return {"role": role, "present": True, "ok": False,
                "size_bytes": size, "expected_size_bytes": spec["size_bytes"],
                "reason": "size mismatch"}
    digest = sha256_of(path)
    return {"role": role, "present": True, "ok": digest == spec["sha256_expected"],
            "size_bytes": size, "sha256": digest,
            "reason": None if digest == spec["sha256_expected"] else "sha256 mismatch"}


def download_one(role: str) -> int:
    spec = artifacts.ARTIFACTS[role]
    url = artifacts.source_url(role)
    dest = MODEL_DIR / spec["filename"]
    part = dest.with_suffix(dest.suffix + ".part")

    state = check_one(role)
    if state.get("ok"):
        print(f"  OK       {spec['filename']} already present and correct")
        return 0
    if state.get("present") and state.get("reason") == "size mismatch":
        print(f"  [WARN]   {spec['filename']} exists with the wrong size "
              f"({state['size_bytes']:,} B, expected {spec['size_bytes']:,} B)")
        print("           Not touching it. Move or delete it yourself and re-run.")
        return 1

    print(f"  GET      {url}")
    print(f"           -> {dest.name}  ({human(spec['size_bytes'])})")
    request = urllib.request.Request(url, headers={
        "User-Agent": "dentalgemma-validation-lab",
        "Accept": "application/octet-stream",
    })
    try:
        with urllib.request.urlopen(request, timeout=1800) as response:
            total = int(response.headers.get("Content-Length") or spec["size_bytes"])
            done = 0
            with open(part, "wb") as out:
                while True:
                    block = response.read(CHUNK)
                    if not block:
                        break
                    out.write(block)
                    done += len(block)
                    if done % (64 * CHUNK) < CHUNK:
                        pct = 100 * done / total if total else 0
                        print(f"           {human(done)} / {human(total)}  ({pct:5.1f} %)")
    except urllib.error.HTTPError as exc:
        print(f"  [FAIL]   HTTP {exc.code} {exc.reason}")
        if exc.code in (401, 403):
            print("           The repository may have become gated. Sign in with")
            print("           `hf auth login` and retry, or download in a browser.")
        part.unlink(missing_ok=True)
        return 1
    except Exception as exc:
        print(f"  [FAIL]   {type(exc).__name__}: {exc}")
        print(f"           Leaving {part.name} in place; delete it before retrying.")
        return 1

    size = part.stat().st_size
    if size != spec["size_bytes"]:
        print(f"  [FAIL]   size mismatch: {size:,} B, expected {spec['size_bytes']:,} B")
        print(f"           {part.name} kept for inspection; not renamed.")
        return 1

    print("           hashing...")
    digest = sha256_of(part)
    if digest != spec["sha256_expected"]:
        print("  [FAIL]   SHA-256 mismatch")
        print(f"           expected {spec['sha256_expected']}")
        print(f"           got      {digest}")
        print(f"           {part.name} kept for inspection; not renamed.")
        return 1

    part.replace(dest)
    print(f"  OK       {spec['filename']}  {size:,} B  sha256 verified")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="Both artifacts")
    ap.add_argument("--role", choices=sorted(artifacts.ARTIFACTS),
                    help="A single artifact")
    ap.add_argument("--check", action="store_true",
                    help="Verify what is on disk; do not download")
    ap.add_argument("--urls", action="store_true",
                    help="Print the pinned download URLs and exit")
    args = ap.parse_args()

    roles = sorted(artifacts.ARTIFACTS) if args.all else ([args.role] if args.role else [])

    if args.urls:
        print(f"Repository : {artifacts.GGUF_REPO['id']}")
        print(f"Revision   : {artifacts.GGUF_REPO['revision']}")
        print(f"Gated      : {artifacts.GGUF_REPO['gated']}")
        print()
        for role in sorted(artifacts.ARTIFACTS):
            spec = artifacts.ARTIFACTS[role]
            print(f"{role:<7} {spec['filename']}")
            print(f"        {artifacts.source_url(role)}")
            print(f"        {spec['size_bytes']:,} B   sha256 {spec['sha256_expected']}")
        return 0

    if not roles:
        ap.print_help()
        return 2

    print("=" * 78)
    print(" DentalGemma lab — artifact acquisition (official source, hash-verified)")
    print("=" * 78)
    print(f"\n  repository : {artifacts.GGUF_REPO['id']}")
    print(f"  revision   : {artifacts.GGUF_REPO['revision']}")
    print(f"  license    : {artifacts.GGUF_REPO['license_declared']} (as declared by the publisher)")
    print(f"  total      : {human(artifacts.TOTAL_BYTES)} for both files\n")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    if args.check:
        rc = 0
        for role in roles:
            state = check_one(role)
            spec = artifacts.ARTIFACTS[role]
            if state.get("ok"):
                print(f"  OK       {spec['filename']}  {state['size_bytes']:,} B")
            elif not state.get("present"):
                print(f"  MISSING  {spec['filename']}")
                rc = 1
            else:
                print(f"  BAD      {spec['filename']}  {state.get('reason')}")
                rc = 1
        return rc

    rc = 0
    for role in roles:
        rc |= download_one(role)

    print("\n" + "=" * 78)
    if rc == 0:
        print(" Both artifacts are present and hash-verified.")
    else:
        print(" Something did not verify — see above. Nothing was deleted.")
    print("=" * 78)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

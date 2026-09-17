#!/usr/bin/env python3
"""
verify_checkpoint.py — establish what a local checkpoint file actually is.

Hashes and sizes the file, and — when torch is available — reads the
checkpoint's own metadata (epoch, trainer name, plans name, dataset
fingerprint) *without* running the model.

Why this matters: this lab cannot verify the provenance of a checkpoint it did
not download. This script produces the facts needed to compare a local file
against whatever the official download claims to be. It reports; it does not
bless.

Usage
-----
    python scripts/verify_checkpoint.py
    python scripts/verify_checkpoint.py --checkpoint source/model/fold_0/checkpoint_best.pth
    python scripts/verify_checkpoint.py --expect-sha256 <hash> --expect-size <bytes>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# No expected hash is recorded here on purpose. This lab never obtained the
# official artifact, so it has nothing authoritative to compare against, and
# inventing one would be worse than having none. Supply it with --expect-sha256
# if you have a value from the official source.


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def read_torch_metadata(path: Path) -> dict:
    """Read checkpoint metadata. Never calls model.eval() or a forward pass.

    Weights are loaded to CPU only — this machine has no CUDA and this script
    does not run inference.
    """
    try:
        import torch
    except ImportError:
        return {"available": False, "reason": "torch is not installed in this interpreter"}

    meta: dict = {"available": True, "torch_version": torch.__version__}
    try:
        # map_location='cpu' so a GPU-saved checkpoint loads on this machine.
        ckpt = torch.load(str(path), map_location="cpu", weights_only=False)
    except Exception as exc:
        meta["load_error"] = f"{type(exc).__name__}: {exc}"
        return meta

    if not isinstance(ckpt, dict):
        meta["structure"] = f"top-level is {type(ckpt).__name__}, not a dict"
        return meta

    meta["top_level_keys"] = sorted(str(k) for k in ckpt.keys())
    for key in ("epoch", "trainer_name", "plans_name", "configuration", "fold",
                "initial_lr", "current_epoch", "dataset_json", "inference_allowed"):
        if key in ckpt:
            val = ckpt[key]
            if isinstance(val, (str, int, float, bool)) or val is None:
                meta[key] = val
            elif isinstance(val, dict):
                meta[key] = {str(k): (str(v)[:120] if not isinstance(v, (int, float, bool, type(None))) else v)
                             for k, v in list(val.items())[:20]}

    # A state_dict tells us this is a real wrapped nnU-Net checkpoint.
    if "network_weights" in ckpt:
        w = ckpt["network_weights"]
        try:
            meta["parameter_tensors"] = len(w)
            meta["parameter_count"] = int(sum(v.numel() for v in w.values() if hasattr(v, "numel")))
        except Exception:
            pass

    if "trainer_name" in ckpt:
        meta["inferred_trainer"] = ckpt["trainer_name"]
    if "plans_name" in ckpt:
        meta["inferred_plans"] = ckpt["plans_name"]

    del ckpt  # do not hold ~250 MB longer than needed
    return meta


def main() -> int:
    parser = argparse.ArgumentParser(description="Hash and describe a local checkpoint file")
    parser.add_argument("--checkpoint", default=None,
                        help="Default: source/model/fold_0/checkpoint_best.pth")
    parser.add_argument("--expect-sha256", default=None, help="Expected hash, if you have an official value")
    parser.add_argument("--expect-size", type=int, default=None, help="Expected size in bytes")
    parser.add_argument("--output-dir", default=None, help="Default: <lab>/output")
    parser.add_argument("--no-torch", action="store_true", help="Hash only; do not open the checkpoint")
    args = parser.parse_args()

    lab = Path(__file__).resolve().parent.parent
    out_dir = Path(args.output_dir) if args.output_dir else lab / "output"
    ckpt_path = Path(args.checkpoint) if args.checkpoint else lab / "source" / "model" / "fold_0" / "checkpoint_best.pth"

    print("=" * 78)
    print(" Checkpoint verification")
    print("=" * 78)

    if not ckpt_path.exists():
        print(f"\n[STOP] Checkpoint not found: {ckpt_path}")
        print("\nThis lab does not download the checkpoint for you. If you have one, point")
        print("at it explicitly:")
        print("    python scripts/verify_checkpoint.py --checkpoint <path>")
        return 3

    size = ckpt_path.stat().st_size
    digest = sha256_of(ckpt_path)

    print(f"\npath      : {ckpt_path}")
    print(f"size      : {size:,} bytes ({size / 1048576:.2f} MiB)")
    print(f"sha256    : {digest}")

    result = {
        "schema": "toothfairy2.checkpoint_verification/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "path": str(ckpt_path),
        "size_bytes": size,
        "sha256": digest,
        "expected": {"sha256": args.expect_sha256, "size_bytes": args.expect_size},
    }

    ok = True
    if args.expect_size is not None:
        match = size == args.expect_size
        ok &= match
        result["size_match"] = match
        print(f"expected  : {args.expect_size:,} bytes  ->  {'MATCH' if match else 'MISMATCH'}")

    if args.expect_sha256 is not None:
        match = digest.lower() == args.expect_sha256.lower().strip()
        ok &= match
        result["sha256_match"] = match
        print(f"expected  : {args.expect_sha256}  ->  {'MATCH' if match else 'MISMATCH'}")

    if args.expect_sha256 is None and args.expect_size is None:
        print("\n[NOTE] No expected size or hash supplied, so nothing was compared.")
        print("       This is a REPORT about the file, not a verification of it.")
        result["verified"] = False
    else:
        result["verified"] = ok

    if not args.no_torch:
        print("\nReading checkpoint metadata (no inference, no forward pass) ...")
        meta = read_torch_metadata(ckpt_path)
        result["torch_metadata"] = meta
        if not meta.get("available"):
            print(f"  skipped: {meta.get('reason')}")
        elif meta.get("load_error"):
            print(f"  could not open: {meta['load_error']}")
        else:
            for k in ("epoch", "trainer_name", "plans_name", "configuration", "fold",
                      "parameter_count", "load_error"):
                if k in meta:
                    print(f"  {k:18}: {meta[k]}")
            if "top_level_keys" in meta:
                print(f"  top_level_keys    : {meta['top_level_keys']}")
        print("\n  These values are what the FILE says about itself. That is evidence,")
        print("  not authentication: a self-describing file can describe itself wrongly.")

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "checkpoint_verification.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}")

    if (args.expect_sha256 or args.expect_size) and not ok:
        print("\n[STOP] The file does not match the expected values.")
        print("       Do not run inference against it. Report the mismatch.")
        return 4

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

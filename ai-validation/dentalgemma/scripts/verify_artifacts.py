#!/usr/bin/env python3
"""
verify_artifacts.py — are these the real DentalGemma files, and are they a pair?

Five independent checks, in increasing strength:

  1. presence      — both the language model and the multimodal projector exist
  2. exact size    — byte count against the size published for the pinned revision
  3. SHA-256       — against the digest in Hugging Face's own file metadata. A
                     local digest is always printed, labelled LOCAL HASH, so the
                     value is available even when it does not match; nothing here
                     ever invents an expected hash
  4. GGUF validity — magic, version, tensor and metadata counts are read from the
                     container itself (header + metadata only; no tensor is loaded)
  5. pairing       — the language model and the projector must agree about the
                     architecture they form: a mismatch means the two files are
                     not a set, which otherwise shows up as a confusing failure
                     inside llama.cpp much later

No inference, no downloads, nothing installed.

Usage:
    python scripts/verify_artifacts.py
    python scripts/verify_artifacts.py --json-out reports/artifact_verification.json
    python scripts/verify_artifacts.py --skip-metadata     # header only, fast
    python scripts/verify_artifacts.py --model-dir D:\\dentalgemma\\model
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
MODEL_DIR = LAB / "model"
CHUNK = 1 << 20


def _load(name: str, filename: str):
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


artifacts = _load("dg_artifacts", "artifacts.py")
gguf = _load("dg_gguf", "gguf.py")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(CHUNK)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def verify_one(role: str, skip_metadata: bool, model_dir: Path | None = None) -> dict:
    """Check one artifact. `model_dir` overrides where the file is looked for.

    The published digests are checked *against the file on disk*: a file that is
    present, parses as GGUF, but has the wrong size or digest is reported as a
    problem, never as the published artifact. `--model-dir` exists for two reasons
    that both matter on a 16 GiB laptop: the weights may live on another drive, and
    a copy in a different folder should be verifiable without moving 3.47 GiB.
    """
    spec = artifacts.ARTIFACTS[role]
    path = (Path(model_dir) if model_dir else MODEL_DIR) / spec["filename"]
    entry: dict = {
        "role": role,
        "filename": spec["filename"],
        "path": str(path),
        "expected_size_bytes": spec["size_bytes"],
        "expected_sha256": spec["sha256_expected"],
        "sha256_expected_origin": spec["sha256_origin"],
        "present": False,
        "size_matches": None,
        "sha256_local": None,
        "sha256_matches": None,
        "gguf": None,
        "problems": [],
    }

    print(f"\n  {spec['filename']}")
    print(f"    role          : {spec['role']}")

    if not path.is_file():
        print("    [MISSING]     run: python scripts/download_artifacts.py --all")
        entry["problems"].append("missing")
        return entry

    entry["present"] = True
    size = path.stat().st_size
    entry["size_bytes"] = size
    size_ok = size == spec["size_bytes"]
    entry["size_matches"] = size_ok
    print(f"    size          : {size:,} B  "
          f"({'matches' if size_ok else 'EXPECTED ' + format(spec['size_bytes'], ',') + ' B'})")
    if not size_ok:
        entry["problems"].append("size mismatch")

    digest = sha256_of(path)
    entry["sha256_local"] = digest
    digest_ok = digest == spec["sha256_expected"]
    entry["sha256_matches"] = digest_ok
    print(f"    sha256        : {'match' if digest_ok else 'MISMATCH'}")
    print(f"      LOCAL HASH  : {digest}")
    if not digest_ok:
        print(f"      expected    : {spec['sha256_expected']}")
        print(f"      origin      : {spec['sha256_origin']}")
        entry["problems"].append("sha256 mismatch")

    # ---- GGUF container ---------------------------------------------------
    try:
        parsed = gguf.read_metadata(path, max_kv=None if not skip_metadata else 24)
        summary = gguf.summarise(parsed)
        entry["gguf"] = summary
        print(f"    GGUF          : magic={summary['magic']} version={summary['version']} "
              f"(supported={summary['version_supported']})")
        print(f"                    tensors={summary['tensor_count']:,} "
              f"metadata entries={summary['metadata_kv_count']:,}")
        print(f"                    architecture={summary['architecture']} "
              f"context_length={summary['context_length']}")
        if summary.get("name"):
            print(f"                    name={summary['name']}")
        if summary.get("vision"):
            for key, value in summary["vision"].items():
                print(f"                    {key}={value}")
        if not summary["version_supported"]:
            entry["problems"].append(f"unsupported GGUF version {summary['version']}")
        if not summary["metadata_read_completely"] and not skip_metadata:
            print("                    [WARN] metadata section could not be read to the end")
        if summary["tensor_count"] == 0:
            entry["problems"].append("GGUF declares zero tensors")
    except gguf.GgufError as exc:
        entry["problems"].append(f"not a valid GGUF container: {exc}")
        print(f"    [INVALID]     {exc}")
    except Exception as exc:
        entry["problems"].append(f"could not read GGUF header: {type(exc).__name__}: {exc}")
        print(f"    [ERROR]       {type(exc).__name__}: {exc}")

    return entry


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json-out", default=None,
                    help="Default: reports/artifact_verification.json")
    ap.add_argument("--skip-metadata", action="store_true",
                    help="Read only the GGUF header (much faster on a cold cache)")
    ap.add_argument("--model-dir", default=None,
                    help="Folder holding the two GGUF files (default: lab\\model). "
                         "Use this when the weights live on another drive.")
    args = ap.parse_args()

    model_dir = Path(args.model_dir) if args.model_dir else MODEL_DIR

    print("=" * 78)
    print(" DentalGemma lab — artifact verification (no inference)")
    print("=" * 78)
    print(f"\n  repository    : {artifacts.GGUF_REPO['id']}")
    print(f"  pinned rev    : {artifacts.GGUF_REPO['revision']}")
    print(f"  license       : {artifacts.GGUF_REPO['license_declared']} "
          f"(as declared by the publisher — see MODEL_PROVENANCE.md)")
    print("\n  [1] Both files must be present: the language model alone cannot see")
    print("      an image, and the projector alone cannot produce text.")

    report: dict = {
        "schema": "dentalgemma.artifact_verification/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repository": artifacts.GGUF_REPO,
        "model_dir": str(model_dir),
        "base_model": artifacts.BASE_REPO,
        "finetune_model": artifacts.FINETUNE_REPO,
        "artifacts": {},
        "pairing": None,
        "all_checks_passed": False,
    }

    for role in ("main", "mmproj"):
        report["artifacts"][role] = verify_one(role, args.skip_metadata, model_dir)

    # ---- pairing ----------------------------------------------------------
    print("\n  [2] Cross-check: do these two files belong together?")
    main_gguf = report["artifacts"]["main"].get("gguf")
    mm_gguf = report["artifacts"]["mmproj"].get("gguf")
    if main_gguf and mm_gguf:
        pairing = gguf.pairing_check(main_gguf, mm_gguf)
        report["pairing"] = pairing
        for finding in pairing["findings"]:
            mark = "OK  " if finding["ok"] else "FAIL"
            print(f"    {mark} {finding['check']}: {finding['observed']}")
            if not finding["ok"]:
                print(f"         {finding['note']}")
        if not pairing["all_ok"]:
            print("    The two files do not form a matching set. Do not run inference")
            print("    with them until that is resolved.")
    else:
        print("    skipped — a GGUF header could not be read for both files")

    ok = (
        all(not entry["problems"] for entry in report["artifacts"].values())
        and all(entry["present"] for entry in report["artifacts"].values())
        and (report["pairing"] is None or report["pairing"]["all_ok"])
    )
    report["all_checks_passed"] = ok

    print("\n" + "=" * 78)
    if ok:
        print(" RESULT: both artifacts are present, match the published size and")
        print("         digest, are readable GGUF containers, and form a pair.")
    else:
        for role, entry in report["artifacts"].items():
            for problem in entry["problems"]:
                print(f" PROBLEM: {role}: {problem}")
        print(" RESULT: verification did not pass.")
        print("         A file that is present but does not match the published size")
        print("         or digest is NOT the published artifact: do not run it and do")
        print("         not describe the model as ready. Re-run the download step.")
    print("=" * 78)

    out = Path(args.json_out) if args.json_out else LAB / "reports" / "artifact_verification.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

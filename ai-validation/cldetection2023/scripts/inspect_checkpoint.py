#!/usr/bin/env python3
"""
inspect_checkpoint.py — look inside a PyTorch checkpoint **without executing it**.

A `.pth` file is a pickle. Loading it with `torch.load` runs whatever the pickle
says to run. This script reads the same bytes the unpickler would read — the zip
container and every GLOBAL in every pickle member — and **never constructs an
object**. It imports no torch, no numpy, no ultralytics, no mmpose: `pickletools`
only decodes.

Why this engine needs it more than most: from PyTorch 2.6, `torch.load` defaults
to `weights_only=True`, and `mmengine 0.10.7` calls `torch.load(filename,
map_location=...)` *without* that argument. So the stock `init_pose_estimator()`
path cannot load an mmpose-1.0 checkpoint on a modern torch at all. The way out
without downgrading torch is to allow-list exactly the reconstruction primitives
the checkpoint needs — and to know those, you must read the file first. This tool
prints that list; `run_inference.py` registers it and keeps `weights_only=True`.

    exit 0   scanned; identity matches (when expectations are given) and every
             global is a known-bounded reconstruction primitive
    exit 1   the file is missing, unreadable, or not a torch/pickle container
    exit 2   usage error
    exit 3   an unexpected global is present: STOP, do not load
    exit 6   size or sha256 differs from what was expected: STOP

Usage:
    python scripts\\inspect_checkpoint.py \\
        --checkpoint model\\model_pretrained_on_train_and_val.pth \\
        --expect-sha256 FB1A781AC1C83149B379CB15724E3B0FAE06BA2D567978F35C61E9D06B46FDCC \\
        --expect-size 268846952 \\
        --json-out reports\\checkpoint_globals.json
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import pickletools
import sys
import zipfile
from pathlib import Path

# --------------------------------------------------------------------------
# the checkpoint this engine audits
# --------------------------------------------------------------------------
# As supplied by the operator for `model_pretrained_on_train_and_val.pth`.
EXPECTED_SHA256 = "fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc"
EXPECTED_SIZE = 268_846_952

# --------------------------------------------------------------------------
# what a pickle in an mmpose checkpoint is allowed to name
# --------------------------------------------------------------------------
# Not a guess: this is the set of reconstruction primitives a torch.save() of a
# model state_dict plus a metainfo dict can legitimately contain. Anything else
# is a stop, because the point of the allow-list is that it can be read.
SAFE_GLOBALS = {
    # torch
    "torch._utils._rebuild_tensor_v2": "tensor rebuild (torch's own, allowed by default)",
    "torch._utils._rebuild_parameter": "parameter rebuild",
    "torch._utils._rebuild_parameter_with_state": "parameter rebuild",
    "torch.FloatStorage": "storage type, allowed by torch by default",
    "torch.HalfStorage": "storage type, allowed by torch by default",
    "torch.LongStorage": "storage type, allowed by torch by default",
    "torch.IntStorage": "storage type",
    "torch.ByteStorage": "storage type",
    "torch.DoubleStorage": "storage type",
    "torch.Size": "shape tuple, allowed by torch by default",
    "torch.device": "device marker, allowed by torch by default",
    "torch._tensor._rebuild_from_type_v2": "tensor subclass rebuild",
    # numpy — the primitives a pickled ndarray needs (dataset_meta holds arrays)
    "numpy.core.multiarray._reconstruct": "ndarray reconstruction",
    "numpy._core.multiarray._reconstruct": "ndarray reconstruction (numpy 2.x path)",
    "numpy.core.multiarray.scalar": "numpy scalar reconstruction",
    "numpy._core.multiarray.scalar": "numpy scalar reconstruction (numpy 2.x path)",
    "numpy.ndarray": "array type",
    "numpy.dtype": "dtype type",
    # codecs / builtins that appear in protocol-2 pickles
    "_codecs.encode": "byte-string codec helper",
    "__builtin__.bytes": "bytes type",
    "builtins.bytes": "bytes type",
    "__builtin__.set": "set type, allowed by torch by default",
    "builtins.set": "set type, allowed by torch by default",
    "__builtin__.bytearray": "bytearray type, allowed by torch by default",
    "builtins.bytearray": "bytearray type",
    "collections.OrderedDict": "container, allowed by torch by default",
    "collections.Counter": "container, allowed by torch by default",
    # pathlib — mmengine writes path hints on Windows/Linux
    "pathlib.PosixPath": "path object (cross-platform hint)",
    "pathlib.WindowsPath": "path object (cross-platform hint)",
    "pathlib.PurePath": "path object",
    # numpy dtype *classes* (numpy >= 1.25 exposes them under numpy.dtypes)
    **{f"numpy.dtypes.{name}": "numpy scalar type object"
       for name in (
           "BoolDType", "Int8DType", "Int16DType", "Int32DType", "Int64DType",
           "UInt8DType", "UInt16DType", "UInt32DType", "UInt64DType",
           "Float16DType", "Float32DType", "Float64DType", "LongDoubleDType",
           "Complex64DType", "Complex128DType", "StrDType", "BytesDType",
           "ObjectDType", "VoidDType", "Datetime64DType", "Timedelta64DType",
           "StringDType", "HalfDType",
       )},
}

# Hard stops, listed separately so the intent is unmissable.
FORBIDDEN_MODULES = {
    "os", "posix", "nt", "subprocess", "socket", "shutil", "sys", "os.path",
    "pickle", "marshal", "ctypes", "importlib", "runpy", "code", "codeop",
    "pty", "fcntl", "resource", "multiprocessing", "threading", "site", "platform",
}
FORBIDDEN_BUILTINS = {"eval", "exec", "compile", "open", "__import__", "input",
                      "breakpoint", "globals", "locals", "vars", "help", "exit", "quit"}


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def classify(module: str, name: str) -> tuple:
    """(verdict, reason): 'safe' | 'forbidden' | 'unknown'."""
    full = f"{module}.{name}"
    if module in ("builtins", "__builtin__") and name in FORBIDDEN_BUILTINS:
        return "forbidden", f"builtins.{name} can execute code"
    if module in FORBIDDEN_MODULES:
        return "forbidden", f"module {module} is not part of a model checkpoint"
    if full in SAFE_GLOBALS:
        return "safe", SAFE_GLOBALS[full]
    return "unknown", f"{full} is not in this lab's allow-list"


def pickle_members(path: Path):
    """The pickle members of a torch archive (or the file itself if it is a stream)."""
    try:
        with zipfile.ZipFile(path) as archive:
            members = [(name, archive.read(name)) for name in archive.namelist()
                       if name.endswith(".pkl")]
            if members:
                return members, {"kind": "torch-zip",
                                 "members": len(archive.namelist())}
    except zipfile.BadZipFile:
        pass
    with open(path, "rb") as handle:
        head = handle.read(1)
    if head in (b"\x80", b"("):
        return [(str(path.name), path.read_bytes())], {"kind": "pickle-stream", "members": 1}
    return [], {"kind": "not-a-pickle", "members": 0}


def inspect(path: Path, expect_sha256=None, expect_size=None) -> dict:
    report = {
        "checkpoint": str(path),
        "exists": path.is_file(),
        "size_bytes": None,
        "sha256": None,
        "size_matches_expected": None,
        "sha256_matches_expected": None,
        "container": None,
        "globals": [],
        "verdicts": {},
        "not_executed": ("this tool never unpickles: no object is constructed and no code "
                         "from the checkpoint runs"),
    }
    if not path.is_file():
        return report

    report["size_bytes"] = path.stat().st_size
    report["sha256"] = sha256_of(path)
    if expect_sha256:
        report["sha256_matches_expected"] = (
            report["sha256"].lower() == str(expect_sha256).strip().lower())
    if expect_size:
        report["size_matches_expected"] = report["size_bytes"] == int(expect_size)

    members, container = pickle_members(path)
    report["container"] = container
    counts = collections.Counter()
    for member, payload in members:
        try:
            for opcode, arg, _pos in pickletools.genops(payload):
                if opcode.name != "GLOBAL":
                    continue
                module, _, name = str(arg).partition(" ")
                verdict, reason = classify(module, name)
                counts[verdict] += 1
                report["globals"].append({"member": member, "module": module,
                                          "name": name, "verdict": verdict,
                                          "reason": reason})
        except Exception as exc:                       # malformed stream
            report["globals"].append({"member": member, "module": None, "name": None,
                                      "verdict": "unknown",
                                      "reason": f"stream did not parse: {exc}"})
    report["verdicts"] = dict(counts)
    # unique view for readability
    report["unique_globals"] = sorted({f"{g['module']}.{g['name']}"
                                        for g in report["globals"] if g["module"]})
    return report


def exit_code(report: dict) -> int:
    if not report["exists"]:
        return 1
    if (report["container"] or {}).get("kind") in ("not-a-pickle", "unreadable"):
        return 1
    if report["verdicts"].get("forbidden"):
        return 3
    if report["verdicts"].get("unknown"):
        return 3
    if report["size_matches_expected"] is False or report["sha256_matches_expected"] is False:
        return 6
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", required=True, help="Path to the .pth (never modified)")
    parser.add_argument("--expect-sha256", default=EXPECTED_SHA256)
    parser.add_argument("--expect-size", type=int, default=EXPECTED_SIZE)
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    report = inspect(Path(args.checkpoint), args.expect_sha256, args.expect_size)
    print("=" * 78)
    print(" checkpoint inspection — static only, nothing is executed")
    print("=" * 78)
    print(f"  file        : {report['checkpoint']}")
    if not report["exists"]:
        print("  [STOP] file not found")
    else:
        print(f"  size        : {report['size_bytes']:,} B (expected {args.expect_size:,} B → "
              f"{'match' if report['size_matches_expected'] else 'MISMATCH'})")
        print(f"  sha256      : {report['sha256']}")
        print(f"                {'match' if report['sha256_matches_expected'] else 'MISMATCH — STOP'}")
        print(f"  container   : {report['container']['kind']} ({report['container']['members']} members)")
        for entry in report["globals"]:
            marker = {"safe": "  ok", "forbidden": "STOP", "unknown": "????"}[entry["verdict"]]
            print(f"    [{marker}] {entry['module']}.{entry['name']}  — {entry['reason']}")
        print(f"\n  verdicts    : {report['verdicts']}")
        print(f"  unique      : {len(report['unique_globals'])} global name(s)")
    code = exit_code(report)
    print("-" * 78)
    if code == 0:
        print(" RESULT: PASS — identity verified and every global is a known reconstruction")
        print(" primitive. run_inference.py registers exactly this set and loads with")
        print(" torch's strict weights_only=True.")
    elif code == 6:
        print(" RESULT: STOP — size or sha256 differs. Do not load this file.")
    elif code == 3:
        print(" RESULT: STOP — an unexpected global is present. Do not load this file;")
        print(" send the JSON.")
    else:
        print(" RESULT: the file could not be inspected.")
    print("-" * 78)
    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  wrote {out}")
    return code


if __name__ == "__main__":
    sys.exit(main())

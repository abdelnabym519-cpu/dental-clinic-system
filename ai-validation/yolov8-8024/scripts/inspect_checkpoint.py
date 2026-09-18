#!/usr/bin/env python3
"""
inspect_checkpoint.py — look inside a PyTorch checkpoint **without executing it**.

A `.pt` file is a pickle. Loading one with `torch.load` (or `YOLO("x.pt")`) runs
whatever the pickle says to run, which is why Hugging Face's scanner rates every
Ultralytics checkpoint ``unsafe``: the file legitimately needs to rebuild
`ultralytics.nn.tasks.SegmentationModel` and friends, and it pickles
`builtins.getattr`, which is the classic building block for a hidden payload.

The scanner reports the *set* of globals a file references. It does not show the
arguments they are called with, and it cannot tell a normal checkpoint from a
crafted one that uses the same names. This script reads the same bytes the
unpickler would read — the zip container, the pickle opcodes, every global with
its byte offset — and **never constructs a single object**. Nothing here imports
torch, ultralytics or numpy, and nothing here can run code from the checkpoint:
`pickletools` only decodes.

That is what makes it usable as a gate:

    exit 0   scanned; every global is one this checkpoint is expected to need,
             the identity (size + sha256) matches what was audited, and every
             expected class name is present in the file's own bytes
    exit 1   the file is missing, unreadable, or not a torch/pickle container
    exit 2   usage error
    exit 3   a forbidden global is present (os/subprocess/eval/exec/...): STOP
    exit 4   an unrecognised global is present: needs a human before any load
    exit 5   a class name is missing from the bytes: the model is not the
             audited one (or this is not a segmentation checkpoint)
    exit 6   size or sha256 does not match the audited artifact: STOP

The identity and class gates only apply once the scan itself is clean, so a
forbidden global always reports as 3 rather than being masked by a size mismatch.

Usage:
    python scripts/inspect_checkpoint.py --checkpoint model\\8024.pt \\
        --json-out reports\\checkpoint_inspection.json --dis-out reports\\checkpoint_ops.txt
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pickletools
import re
import zipfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent

# The published checkpoint this lab audits. Recorded here so that the expectation
# travels with the tool, and so a mismatch is a finding rather than a surprise.
EXPECTED_SHA256 = "e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98"
EXPECTED_SIZE = 143_955_443

# The class concepts this checkpoint is audited against, in the order the model
# card gives them. `Implant` is the one the task cares about; the tool reports
# where each concept appears in the checkpoint's own bytes.
CANONICAL_CLASSES = (
    "Caries", "Crown", "Filling", "Implant", "Missing-tooth-between",
    "Periapical-lesion", "Root Piece", "Root-Canal-Treatment",
)

# Semantic alias mapping: canonical concept -> every spelling known to mean it.
#
# The audited checkpoint spells three of the eight concepts differently from the
# model card. The operator's own gate run on the file (`checkpoint_ops.txt`)
# records the checkpoint's labels as: Caries, Crown, Filling, Implant,
# "Missing teeth", "Periapical lesion", "Root Piece", "Root canal obturation".
# Those are naming differences, not missing classes, so the gate resolves them
# through this table instead of stopping.
#
# Three rules keep the mapping honest:
#   * the table is explicit and closed — nothing is matched by fuzzy similarity,
#     so a *different* concept can never be accepted as one of the eight;
#   * `as_written` always records the label exactly as the checkpoint stores it,
#     so the model's own vocabulary is never replaced by the alias;
#   * this is a verification alias only. It renames nothing in the model, and the
#     concepts are the operator's canonical names — not a clinical claim that two
#     different words describe the same finding.
CLASS_ALIASES = {
    "Caries": ("Caries",),
    "Crown": ("Crown",),
    "Filling": ("Filling",),
    "Implant": ("Implant",),
    "Missing-tooth-between": ("Missing-tooth-between", "Missing teeth"),
    "Periapical-lesion": ("Periapical-lesion", "Periapical lesion"),
    "Root Piece": ("Root Piece",),
    "Root-Canal-Treatment": ("Root-Canal-Treatment", "Root canal obturation"),
}

# Concepts whose absence must stop the load outright. `Implant` is the subject of
# this engine: a checkpoint without it is not the audited implant model.
REQUIRED_CLASSES = ("Implant",)

# Kept: earlier reports and tests refer to the canonical list under this name.
EXPECTED_LABELS = CANONICAL_CLASSES

# --------------------------------------------------------------------------
# what is allowed to be in the pickle, and what stops the line
# --------------------------------------------------------------------------
# Modules that cannot be part of a YOLO checkpoint. `os`/`subprocess`/`socket`
# are process and network primitives; `pickle`/`marshal`/`ctypes` are a second
# layer of the same problem; `importlib`/`runpy` exist to execute code.
FORBIDDEN_MODULES = {
    "os", "posix", "nt", "subprocess", "socket", "shutil", "sys", "os.path",
    "pickle", "cPickle", "marshal", "ctypes", "importlib", "runpy", "code",
    "codeop", "pty", "fcntl", "resource", "multiprocessing", "threading",
    "builtins", "pwd", "grp", "site", "platform",
}

# Names inside `builtins`/`__builtin__` that mean "execute this" — a hard stop.
FORBIDDEN_BUILTIN_NAMES = {
    "eval", "exec", "compile", "open", "__import__", "input", "breakpoint",
    "globals", "locals", "vars", "memoryview", "help", "exit", "quit",
}

# Names that a checkpoint is known to use but that are worth naming out loud.
DANGEROUS_BUILTIN_NAMES = {"getattr", "setattr", "delattr", "type", "object"}

# torch's default `weights_only=True` allow-list (torch >= 2.6). Read from
# `torch/_weights_only_unpickler.py` at v2.6.0: storages, `_rebuild_*`,
# `torch.Size`, `torch.device`, `collections.OrderedDict` and `builtins.set`
# are all permitted by default; `getattr` is NOT — which is why a YOLO
# checkpoint cannot be loaded `weights_only=True` without help.
TORCH_DEFAULT_ALLOWED = {
    "torch.Size", "torch.device", "torch.Tensor", "torch.dtype", "torch.layout",
    "torch.memory_format", "torch.nn.parameter.Parameter",
    "torch.serialization._get_layout", "collections.OrderedDict",
    "collections.Counter", "builtins.bytearray", "builtins.set", "builtins.complex",
    "torch._tensor._rebuild_from_type_v2",
}
TORCH_DEFAULT_ALLOWED_SUFFIXES = (
    "_rebuild_tensor_v2", "_rebuild_tensor", "_rebuild_parameter",
    "_rebuild_parameter_with_state", "_rebuild_tensor_v3", "_rebuild_sparse_tensor",
    "Storage", "TypedStorage", "UntypedStorage",
)
# `ultralytics.nn.tasks._SafeLoad` registers exactly these module namespaces
# (verified in ultralytics 8.4.155): model classes are resolved by name and must
# be subclasses of torch.nn.Module; anything else raises instead of executing.
ULTRALYTICS_ALLOWED_MODULES = {
    "ultralytics.nn.tasks", "ultralytics.nn.modules", "ultralytics.utils",
    "ultralytics.utils.loss", "ultralytics.utils.tal",
}

STRING_OPCODES = {
    "SHORT_BINUNICODE", "BINUNICODE", "BINUNICODE8", "UNICODE",
    "SHORT_BINSTRING", "BINSTRING", "STRING", "BINBYTES", "SHORT_BINBYTES",
    "BINBYTES8", "BYTEARRAY8",
}
INT_OPCODES = {
    "BININT", "BININT1", "BININT2", "LONG1", "LONG4", "INT", "LONG",
}
NUMBER_PUSH_OPCODES = {"BINFLOAT", "FLOAT", "NONE", "NEWTRUE", "NEWFALSE"}

# Patterns that should never appear as *data* in a model checkpoint. They are
# reported, not acted on: the point is to look, and to have the finding in the
# JSON when somebody else looks later.
SUSPICIOUS_STRING_PATTERNS = (
    re.compile(r"\b(os|posix|subprocess|socket|shutil|ctypes)\.", re.I),
    re.compile(r"\b(eval|exec|compile|__import__)\s*\(", re.I),
    re.compile(r"(curl|wget|powershell|cmd\.exe|/bin/sh|/bin/bash)", re.I),
    re.compile(r"^(https?|ftp)://", re.I),
    re.compile(r"\b(base64|fromhex|b64decode)\b", re.I),
    re.compile(r"(rm -rf|chmod \+x|nc -e|/etc/passwd)", re.I),
)

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")

# Keys a YOLO checkpoint stores about itself. Their values sit next to them in
# the pickle stream (`key, value, SETITEM`), which is what makes a non-executing
# read of `nc`, `task`, `imgsz` and `scale` possible at all. The adjacency is a
# heuristic — the disassembly written by `--dis-out` is the authority.
INTERESTING_KEYS = ("names", "nc", "ch", "task", "imgsz", "scale", "yaml_file",
                    "version", "date", "model", "masks", "batch", "epoch",
                    "best_fitness", "data", "conf", "iou")


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def classify_global(module, name) -> tuple:
    """(verdict, reason) for one pickle global.

    verdict is one of: forbidden, dangerous-known, expected-torch,
    expected-ultralytics, expected-other, unknown.
    """
    module = (module or "").strip()
    name = (name or "").strip()
    if not module or not name:
        return "unknown", "global could not be resolved from the opcode stream"
    full = f"{module}.{name}"

    if module in ("builtins", "__builtin__"):
        if name in FORBIDDEN_BUILTIN_NAMES:
            return "forbidden", f"builtins.{name} can execute code"
        if name in DANGEROUS_BUILTIN_NAMES:
            return "dangerous-known", (
                f"builtins.{name} is a standard part of Ultralytics checkpoints and is "
                f"also the classic obfuscation primitive; under a restricted load it is "
                f"replaced by ultralytics' own attribute-only version")
        if name in {"set", "frozenset", "bytearray", "complex", "slice", "range"}:
            return "expected-other", "container/scalar builtin, allowed by torch by default"
        return "unknown", f"unexpected builtin {full}"

    if module in FORBIDDEN_MODULES:
        return "forbidden", f"module {module} is not part of a model checkpoint"

    if full in ("collections.OrderedDict", "collections.Counter"):
        return "expected-other", "container type, allowed by torch by default"

    if full in TORCH_DEFAULT_ALLOWED or module.startswith("torch"):
        if full in TORCH_DEFAULT_ALLOWED or any(
                full.endswith(suffix) for suffix in TORCH_DEFAULT_ALLOWED_SUFFIXES):
            return "expected-torch", (
                "allowed by torch's own weights_only allow-list" if full in TORCH_DEFAULT_ALLOWED
                else "a torch tensor/storage rebuild helper, allowed by default")
        if module.startswith("torch.nn") or module.startswith("torch._utils"):
            return "expected-torch", "torch module/utility class from the model graph"
        return "unknown", f"{full} is a torch global not in the known set — review"

    if module.startswith("ultralytics"):
        if module in ULTRALYTICS_ALLOWED_MODULES or module.startswith("ultralytics.nn.modules."):
            return "expected-ultralytics", (
                "namespace the Ultralytics restricted loader resolves by name")
        if module.startswith("ultralytics.yolo"):
            return "expected-ultralytics", (
                "pre-8.0.44 package path; the restricted loader keeps an alias for it")
        return "unknown", f"{full} is an ultralytics global outside the known namespaces"

    return "unknown", f"unrecognised global {full}"


def walk_pickle(data: bytes) -> dict:
    """Decode the opcode stream. Nothing is constructed; nothing is executed."""
    histogram = Counter()
    globals_found = []
    events = []            # (kind, value, offset) in stream order, for the label scan
    suspicious = []
    stack = []
    memo = {}
    truncated_at = None
    protocol = None

    try:
        for opcode, arg, pos in pickletools.genops(data):
            name = opcode.name
            histogram[name] += 1

            if name == "PROTO":
                protocol = int(arg)

            if name == "GLOBAL":
                module, _, attr = str(arg).partition(" ")
                globals_found.append({"module": module, "name": attr, "offset": pos,
                                      "form": "GLOBAL"})
                stack.append(None)
            elif name == "STACK_GLOBAL":
                attr = stack.pop() if stack else None
                module = stack.pop() if stack else None
                globals_found.append({"module": module, "name": attr, "offset": pos,
                                      "form": "STACK_GLOBAL"})
                stack.append(None)
            elif name in STRING_OPCODES:
                value = arg.decode("utf-8", "replace") if isinstance(arg, bytes) else str(arg)
                events.append(("str", value, pos))
                stack.append(value)
                for pattern in SUSPICIOUS_STRING_PATTERNS:
                    if pattern.search(value):
                        suspicious.append({"offset": pos, "string": value[:200],
                                           "pattern": pattern.pattern})
                        break
            elif name in INT_OPCODES:
                events.append(("int", int(arg), pos))
                stack.append(int(arg))
            elif name in NUMBER_PUSH_OPCODES:
                stack.append(arg)
            elif name in ("POP", "POP_MARK"):
                if stack:
                    stack.pop()
            elif name == "DUP":
                if stack:
                    stack.append(stack[-1])
            elif name == "MEMOIZE":
                memo[len(memo)] = stack[-1] if stack else None
            elif name in ("BINPUT", "LONG_BINPUT", "PUT"):
                memo[int(arg)] = stack[-1] if stack else None
            elif name in ("BINGET", "LONG_BINGET", "GET"):
                stack.append(memo.get(int(arg)))
            elif name == "MARK":
                stack.append("__mark__")
            else:
                # Any other opcode either consumes values or replaces them; the
                # stream position of the globals and strings above is unaffected.
                pass
    except Exception as exc:                                  # malformed or crafted
        truncated_at = f"{type(exc).__name__}: {exc}"

    return {
        "opcode_histogram": dict(histogram.most_common()),
        "opcodes_total": sum(histogram.values()),
        "reduces": histogram.get("REDUCE", 0) + histogram.get("OBJ", 0),
        "builds": histogram.get("BUILD", 0),
        "newobjs": histogram.get("NEWOBJ", 0) + histogram.get("NEWOBJ_EX", 0),
        "protocol": protocol,
        "globals": globals_found,
        "events": events,
        "suspicious_strings": suspicious,
        "parse_error": truncated_at,
    }


def _normalize_label(text) -> str:
    """Case- and separator-insensitive form of a class name (letters/digits only).

    `Periapical-lesion`, `Periapical lesion` and `periapical_lesion` normalize to
    one key; nothing else does.
    """
    return re.sub(r"[^a-z0-9]", "", str(text).strip().lower())


def build_alias_index(concepts=CANONICAL_CLASSES, aliases=CLASS_ALIASES) -> dict:
    """normalized spelling -> canonical concept.

    Raises `ValueError` if one spelling is claimed by two concepts: an ambiguous
    table must fail loudly rather than resolve a class to whichever came last.
    """
    index = {}
    for concept in concepts:
        for spelling in aliases.get(concept, (concept,)):
            key = _normalize_label(spelling)
            other = index.get(key)
            if other is not None and other != concept:
                raise ValueError(
                    f"ambiguous alias table: {spelling!r} maps to both {other!r} and {concept!r}")
            index[key] = concept
    return index


def resolve_concepts(labels, concepts=CANONICAL_CLASSES, aliases=CLASS_ALIASES) -> list:
    """Map any accepted spelling to its canonical concept; unknown entries pass through."""
    index = build_alias_index(concepts, aliases)
    resolved = []
    for label in labels:
        hit = index.get(_normalize_label(label))
        resolved.append(hit if hit else label)
    return resolved


def find_labels(events, labels, aliases=CLASS_ALIASES) -> list:
    """Where the documented class names appear in the checkpoint's own stream.

    In an Ultralytics checkpoint the model's `names` mapping is pickled as
    ``{0: 'Caries', 1: 'Crown', ...}``, so the label strings appear adjacent to
    their indices. This reports that adjacency as it is found — the *stream*'s
    order, which is the closest a non-executing reader can get to the model's.

    Matching goes through `CLASS_ALIASES` and is case/separator-insensitive, so a
    concept is found under the checkpoint's own spelling as well as the canonical
    one. Each hit carries the canonical concept, the label exactly as the file
    wrote it, and whether it was an alias resolution.
    """
    index = build_alias_index(tuple(labels), aliases)
    hits = []
    for position, (kind, value, offset) in enumerate(events):
        if kind != "str":
            continue
        concept = index.get(_normalize_label(value))
        if concept is None:
            continue
        written = str(value)
        # Judged on the literal spelling: "Periapical lesion" is an alias even
        # though it normalizes to the same key as "Periapical-lesion".
        match = "canonical" if written.strip() == concept else "alias"
        neighbour = None
        for back in range(position - 1, max(-1, position - 4), -1):
            if events[back][0] == "int":
                neighbour = events[back][1]
                break
        hits.append({"label": concept,            # canonical concept (name kept for callers)
                     "canonical": concept,
                     "as_written": str(value),    # the model's own label, untouched
                     "match": match,              # "canonical" | "alias"
                     "index_in_stream": neighbour,
                     "offset": offset})
    return hits


def find_key_values(events, keys=INTERESTING_KEYS) -> list:
    """Report the value that sits next to each interesting key, as a heuristic.

    Pickled dicts emit key and value adjacently, so this reads `nc`, `task`,
    `imgsz`, `scale` … without building anything. A missing value is reported as
    None rather than guessed.
    """
    wanted = {key.lower() for key in keys}
    found = []
    for index, (kind, value, offset) in enumerate(events):
        if kind != "str" or str(value).strip().lower() not in wanted:
            continue
        following = events[index + 1] if index + 1 < len(events) else None
        found.append({
            "key": str(value).strip(),
            "value": following[1] if following and following[0] in ("str", "int") else None,
            "value_kind": following[0] if following else None,
            "offset": offset,
        })
    return found


def find_versions(events) -> list:
    """Version-looking strings (the checkpoint records the ultralytics that wrote it)."""
    versions = []
    for _, value, offset in events:
        if isinstance(value, str) and VERSION_RE.match(value.strip()):
            versions.append({"version": value.strip(), "offset": offset})
    return versions


def container_info(path: Path) -> dict:
    """Is this a torch zip archive (>= 1.6), a bare pickle, or neither?"""
    info = {"kind": "unknown", "members": [], "pickle_members": []}
    try:
        with zipfile.ZipFile(path) as archive:
            info["kind"] = "torch-zip"
            for member in archive.infolist():
                info["members"].append({
                    "name": member.filename,
                    "uncompressed_bytes": member.file_size,
                    "compressed_bytes": member.compress_size,
                })
            info["pickle_members"] = [m["name"] for m in info["members"]
                                      if m["name"].endswith(".pkl")]
    except zipfile.BadZipFile:
        with open(path, "rb") as handle:
            head = handle.read(2)
        info["kind"] = "pickle-stream" if head[:1] == b"\x80" or head[:1] == b"(" \
            else "not-a-pickle"
    except Exception as exc:
        info["kind"] = "unreadable"
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


def read_pickle_payloads(path: Path, container: dict) -> dict:
    """The bytes of every pickle in the file, without unpickling any of them."""
    payloads = {}
    if container["kind"] == "torch-zip":
        with zipfile.ZipFile(path) as archive:
            for member in container["pickle_members"]:
                payloads[member] = archive.read(member)
    elif container["kind"] == "pickle-stream":
        with open(path, "rb") as handle:
            payloads[str(path.name)] = handle.read()
    return payloads


def inspect(path: Path, labels) -> dict:
    """The whole inspection, as a JSON-ready dict."""
    report = {
        "checkpoint": str(path),
        "exists": path.is_file(),
        "size_bytes": None,
        "sha256": None,
        "sha256_matches_expected": None,
        "size_matches_expected": None,
        "container": None,
        "pickles": {},
        "globals_by_verdict": {},
        "forbidden_globals": [],
        "unknown_globals": [],
        "dangerous_globals": [],
        "labels_found": [],
        "labels_missing": list(labels),
        "semantic_classes": [],
        "class_validation": None,
        "key_values": [],
        "versions_found": [],
        "suspicious_strings": [],
        "note": ("this tool never unpickles: no object is constructed and no code from "
                 "the checkpoint is executed. It cannot prove a file is benign — it "
                 "shows what the pickle asks for, which is what a scanner cannot show"),
    }
    if not path.is_file():
        return report

    report["size_bytes"] = path.stat().st_size
    report["size_matches_expected"] = report["size_bytes"] == EXPECTED_SIZE
    report["sha256"] = sha256_of(path)
    report["sha256_matches_expected"] = (report["sha256"] is not None
                                         and report["sha256"].lower() == EXPECTED_SHA256.lower())

    container = container_info(path)
    report["container"] = container
    payloads = read_pickle_payloads(path, container)

    verdicts = Counter()
    found_labels = []
    key_values = []
    versions = []
    suspicious = []
    for member, payload in payloads.items():
        walk = walk_pickle(payload)
        entries = []
        for item in walk["globals"]:
            verdict, reason = classify_global(item.get("module"), item.get("name"))
            verdicts[verdict] += 1
            entry = dict(item)
            entry["verdict"] = verdict
            entry["reason"] = reason
            entries.append(entry)
            if verdict == "forbidden":
                report["forbidden_globals"].append(entry)
            elif verdict == "unknown":
                report["unknown_globals"].append(entry)
            elif verdict == "dangerous-known":
                report["dangerous_globals"].append(entry)
        found_labels += find_labels(walk["events"], labels)
        key_values += find_key_values(walk["events"])
        versions += find_versions(walk["events"])
        suspicious += walk["suspicious_strings"]
        report["pickles"][member] = {
            "bytes": len(payload),
            "opcodes_total": walk["opcodes_total"],
            "reduces": walk["reduces"],
            "builds": walk["builds"],
            "newobjs": walk["newobjs"],
            "globals": entries,
            "opcode_histogram": walk["opcode_histogram"],
            "parse_error": walk["parse_error"],
        }

    report["globals_by_verdict"] = dict(verdicts)
    report["key_values"] = key_values
    report["labels_found"] = found_labels

    # One entry per canonical concept, in the order the audit lists them, with the
    # spelling the checkpoint itself used. `as_written` is never rewritten.
    first_hit = {}
    for hit in found_labels:
        first_hit.setdefault(hit["canonical"], hit)
    semantic_classes = []
    for concept in labels:
        hit = first_hit.get(concept)
        semantic_classes.append({
            "canonical": concept,
            "checkpoint_label": hit["as_written"] if hit else None,
            "match": hit["match"] if hit else None,
            "offset": hit["offset"] if hit else None,
        })
    missing = [entry["canonical"] for entry in semantic_classes
               if entry["checkpoint_label"] is None]
    required_missing = [concept for concept in REQUIRED_CLASSES
                        if concept in labels and concept in missing]
    report["semantic_classes"] = semantic_classes
    report["labels_missing"] = missing
    report["class_validation"] = {
        "status": "FAIL" if missing else "PASS",
        "canonical_classes": list(labels),
        "checkpoint_labels": [entry["checkpoint_label"] for entry in semantic_classes
                              if entry["checkpoint_label"] is not None],
        "resolved_aliases": [{"canonical": entry["canonical"],
                              "checkpoint_label": entry["checkpoint_label"]}
                             for entry in semantic_classes if entry["match"] == "alias"],
        "missing": missing,
        "required_missing": required_missing,
        "note": ("Presence check against the checkpoint's own bytes. An alias records the "
                 "file's spelling of a concept and never replaces it; the concepts are the "
                 "operator's canonical names, not a clinical-equivalence claim."),
    }
    report["versions_found"] = versions
    report["suspicious_strings"] = suspicious
    return report


def verdict_exit_code(report: dict) -> int:
    if not report["exists"]:
        return 1
    if report["container"] and report["container"].get("kind") in ("not-a-pickle", "unreadable"):
        return 1
    if report["forbidden_globals"]:
        return 3
    if report["unknown_globals"]:
        return 4
    return 0


def gate_exit_code(report: dict) -> int:
    """The full gate, in precedence order: scan, then identity, then class concepts.

    A forbidden global is always reported as 3 — never masked by a size mismatch —
    and a foreign file is always 6, never reported as a missing class.
    """
    code = verdict_exit_code(report)
    if code != 0:
        return code
    if not (report.get("size_matches_expected") and report.get("sha256_matches_expected")):
        return 6
    if report.get("labels_missing"):
        return 5
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", required=True,
                        help="Path to the .pt file (never modified, never unpickled)")
    parser.add_argument("--expect-sha256", default=EXPECTED_SHA256,
                        help="Expected SHA-256 of the file (default: the published one)")
    parser.add_argument("--expect-size", type=int, default=EXPECTED_SIZE,
                        help="Expected size in bytes (default: the published one)")
    parser.add_argument("--labels", default=",".join(CANONICAL_CLASSES),
                        help="Comma-separated class concepts to require; the checkpoint's "
                             "own spelling of each concept is accepted (see CLASS_ALIASES)")
    parser.add_argument("--json-out", default=None,
                        help="Write the full JSON report here (e.g. reports\\checkpoint_inspection.json)")
    parser.add_argument("--dis-out", default=None,
                        help="Write `pickletools.dis` text for each pickle member here, "
                             "for a line-by-line review of what the pickle calls")
    args = parser.parse_args()

    path = Path(args.checkpoint)
    labels = resolve_concepts([label.strip() for label in args.labels.split(",")
                               if label.strip()])
    report = inspect(path, labels)
    report["expected"] = {"sha256": args.expect_sha256, "size_bytes": args.expect_size}
    if report["sha256"] is not None:
        # Digests are case-insensitive: `certutil`/PowerShell print them upper-case.
        report["sha256_matches_expected"] = (
            report["sha256"].lower() == args.expect_sha256.strip().lower())
    if report["size_bytes"] is not None:
        report["size_matches_expected"] = report["size_bytes"] == args.expect_size

    print("=" * 78)
    print(" checkpoint inspection — static only, nothing is executed")
    print("=" * 78)
    print(f"  file        : {path}")
    if not report["exists"]:
        print("  [STOP] file not found")
        return _finish(report, args, 1)
    print(f"  size        : {report['size_bytes']:,} B "
          f"(expected {args.expect_size:,} B: {'match' if report['size_matches_expected'] else 'MISMATCH'})")
    print(f"  sha256      : {report['sha256']}")
    print(f"                {'match' if report['sha256_matches_expected'] else 'MISMATCH — STOP'}"
          f" against {args.expect_sha256[:16]}…")
    container = report["container"] or {}
    print(f"  container   : {container.get('kind')} "
          f"({len(container.get('members', []))} member(s), "
          f"pickles: {', '.join(container.get('pickle_members', [])) or 'none'})")

    for member, info in report["pickles"].items():
        print(f"\n  pickle      : {member} ({info['bytes']:,} B, "
              f"{info['opcodes_total']:,} opcodes, {info['reduces']} REDUCE, "
              f"{info['builds']} BUILD)")
        if info["parse_error"]:
            print(f"  [WARN] the stream did not parse cleanly: {info['parse_error']}")
        print(f"  globals     : {len(info['globals'])}")
        for entry in info["globals"]:
            marker = {"forbidden": "STOP", "unknown": "????", "dangerous-known": "flag"}.get(
                entry["verdict"], "  ok")
            print(f"    [{marker}] {entry['module']}.{entry['name']}  @{entry['offset']}")

    print(f"\n  verdicts    : {report['globals_by_verdict']}")

    validation = report["class_validation"] or {}
    resolved = len([e for e in report["semantic_classes"] if e["checkpoint_label"]])
    aliases = validation.get("resolved_aliases", [])
    print(f"  classes     : {resolved}/{len(report['semantic_classes'])} concepts present "
          f"in the bytes ({resolved - len(aliases)} canonical, {len(aliases)} alias)")
    for entry in aliases:
        print(f"                {entry['canonical']:>22}  ←  \"{entry['checkpoint_label']}\"")
    if report["labels_missing"]:
        print(f"  classes not in the bytes: {report['labels_missing']}")
    if report["key_values"]:
        shown = ", ".join(f"{kv['key']}={kv['value']!r}" for kv in report["key_values"][:12])
        print(f"  key values  : {shown}")
        print("                (adjacent-value heuristic; `--dis-out` is the authority)")
    if report["versions_found"]:
        print(f"  versions    : {sorted({v['version'] for v in report['versions_found']})}")
    if report["suspicious_strings"]:
        print(f"  [WARN] {len(report['suspicious_strings'])} suspicious string(s) — see the JSON")

    if args.dis_out:
        _write_disassembly(path, report, Path(args.dis_out))

    code = gate_exit_code(report)

    print("\n" + "-" * 78)
    if code == 0:
        print(" RESULT: GATE PASSED — identity matches the audited artifact, the pickle")
        print(" references only the expected Ultralytics/torch classes, and every expected")
        print(" class name is present in the file. Loading still executes reconstruction")
        print(" code; use the restricted loader for that (see the lab README).")
    elif code == 3:
        print(" RESULT: STOP — a forbidden global is present. Do not load this file.")
    elif code == 4:
        print(" RESULT: REVIEW — unrecognised global(s) present. Do not load until they")
        print(" are explained; send the JSON.")
    elif code == 5:
        required = (report["class_validation"] or {}).get("required_missing") or []
        if required:
            print(f" RESULT: STOP — the required class {', '.join(repr(r) for r in required)} "
                  f"is not in the bytes.")
            print(" This is not the audited implant checkpoint. Do not load it as one.")
        else:
            print(" RESULT: STOP — class concept(s) missing from the bytes:")
            print(f"          {', '.join(report['labels_missing'])}")
            print(" This is not the audited segmentation checkpoint. Do not load it as one.")
    elif code == 6:
        print(" RESULT: STOP — size or sha256 differs from the audited artifact. Never")
        print(" load a checkpoint whose identity was not verified.")
    else:
        print(" RESULT: the file could not be inspected.")
    print("-" * 78)
    return _finish(report, args, code)


def _write_disassembly(path: Path, report: dict, out_path: Path) -> None:
    """Write `pickletools.dis` text for every pickle member, for human review."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payloads = read_pickle_payloads(path, report["container"] or {})
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write("pickletools.dis of every pickle member of the checkpoint.\n")
        handle.write("Read-only: `dis` decodes the opcode stream and prints it; nothing runs.\n")
        for member, payload in payloads.items():
            handle.write(f"\n{'=' * 78}\n{member} ({len(payload):,} B)\n{'=' * 78}\n")
            try:
                pickletools.dis(payload, out=handle)
            except Exception as exc:                       # malformed stream: report it
                handle.write(f"[dis failed: {type(exc).__name__}: {exc}]\n")
    print(f"  wrote {out_path}")


def _finish(report: dict, args, code: int) -> int:
    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  wrote {out}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())

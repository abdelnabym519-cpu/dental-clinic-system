#!/usr/bin/env python3
"""
Tests for the Engine #6 lab tooling — runnable with a bare Python 3.

Nothing here needs torch, numpy, mmcv or mmpose: the point of the checkpoint
inspector is that it works before the ML stack is installed, and the point of the
policy tests is that the allow-list decision can be checked without loading
anything. The full pipeline (model build, checkpoint load, real forward pass) was
exercised in the engine's venv, not here — see ../AUDIT.md for those results.

Run:
    python -m unittest discover -s tests -v
"""

from __future__ import annotations

import ast
import io
import json
import pickletools
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPTS = LAB / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import check_environment as ce      # noqa: E402
import extract_input as ei          # noqa: E402
import inspect_checkpoint as ic     # noqa: E402
import run_inference as ri          # noqa: E402

CHECKPOINT_SHA256 = "fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc"
CHECKPOINT_SIZE = 268_846_952


def _global(module: str, name: str) -> bytes:
    return b"c" + module.encode() + b"\n" + name.encode() + b"\n"


def _pickle(parts) -> bytes:
    return b"\x80\x02" + b"".join(parts) + b"."


def _torch_zip(path: Path, payload: bytes) -> Path:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("archive/data.pkl", payload)
        archive.writestr("archive/version", b"3\n")
    return path


def _short_str(value: str) -> bytes:
    # SHORT_BINUNICODE: \x8c + ONE-byte length + utf-8
    assert len(value) <= 255
    return b"\x8c" + bytes([len(value)]) + value.encode()


def _stack_global(module: str, name: str) -> bytes:
    """Protocol-2+ STACK_GLOBAL: push module, push name, \\x93."""
    return _short_str(module) + _short_str(name) + b"\x93"


class TestScannerProtocolCorrectness(unittest.TestCase):
    """The scan must see protocol-2+ (torch.save) references, and must not
    fabricate phantom globals from memoised objects (AUDIT.md §10)."""

    def test_stack_global_references_are_captured(self):
        payload = (b"\x80\x05"
                   + _stack_global("mmengine.logging.history_buffer", "HistoryBuffer")
                   + b"." )
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "c.pth", payload)
            found = ri.enumerate_globals(target)
        self.assertIn("mmengine.logging.history_buffer.HistoryBuffer", found)
        self.assertEqual(len(found), 1)

    def test_memoised_object_stack_global_is_not_a_global(self):
        # GLOBAL copyreg._reconstructor (memoised), then BINGET 0 + name +
        # STACK_GLOBAL: an attribute read on the constructed object. It must
        # surface as an object-attribute ref — never as a global, never as a
        # phantom "<stale>.<name>" pairing.
        payload = (b"\x80\x05"
                   + b"c" + b"copyreg\n_reconstructor\n"
                   + b"\x94"            # MEMOIZE (slot 0)
                   + b"h\x00"         # BINGET 0 (ASCII h)
                   + _short_str("HistoryBuffer.min")
                   + b"\x93"            # STACK_GLOBAL
                   + b".")
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "c.pth", payload)
            found = ri.enumerate_globals(target)
            from pickle_scan import scan_payload
            globals_found, attr_refs, _ = scan_payload(
                zipfile.ZipFile(target).read("archive/data.pkl"))
        self.assertEqual(found, ["copyreg._reconstructor"])
        self.assertEqual(globals_found, ["copyreg._reconstructor"])
        self.assertEqual(attr_refs, ["HistoryBuffer.min"])

    def test_scan_records_usage_context(self):
        payload = (b"\x80\x05"
                   + b"c" + b"copyreg\n_reconstructor\n"
                   + b"\x94"
                   + b"h\x00"
                   + _short_str("min")
                   + b"\x93"
                   + b"." )
        from pickle_scan import scan_payload
        globals_found, attr_refs, context = scan_payload(payload)
        self.assertEqual(globals_found, ["copyreg._reconstructor"])
        self.assertEqual(attr_refs, ["min"])
        self.assertIn("MEMOIZE", context["copyreg._reconstructor"])

    def test_inspector_json_carries_context_and_attribute_refs(self):
        # collections.OrderedDict is allow-listed, so the run exits 0; the
        # attribute ref (BINGET 0 + 'min' + STACK_GLOBAL) must be reported
        # separately from the globals.
        payload = (b"\x80\x05"
                   + b"c" + b"collections\nOrderedDict\n"
                   + b"\x94"
                   + b"h\x00"
                   + _short_str("min")
                   + b"\x93"
                   + b".")
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "c.pth", payload)
            out = Path(tmp) / "g.json"
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--context",
                    "--expect-sha256", ic.sha256_of(target),
                    "--expect-size", str(target.stat().st_size),
                    "--json-out", str(out)]
            import unittest.mock
            with unittest.mock.patch.object(sys, "argv", argv):
                with redirect_stdout(io.StringIO()):
                    code = ic.main()
            self.assertEqual(code, 0)
            data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["object_attribute_refs"], ["min"])
        self.assertTrue(data["globals"][0]["context"])


class TestCheckpointInspectorPolicy(unittest.TestCase):
    """The inspector never executes, and stops on anything unexpected."""

    def test_a_normal_mmpose_checkpoint_passes(self):
        payload = _pickle([
            _global("collections", "OrderedDict"),
            _global("torch._utils", "_rebuild_tensor_v2"),
            _global("torch", "FloatStorage"),
            _global("numpy.core.multiarray", "_reconstruct"),
            _global("numpy", "ndarray"),
            _global("numpy", "dtype"),
            _global("_codecs", "encode"),
        ])
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "ckpt.pth", payload)
            report = ic.inspect(target)
        self.assertEqual(report["verdicts"].get("unknown"), None)
        self.assertEqual(report["globals"], [g for g in report["globals"]
                                             if g["verdict"] == "safe"])
        self.assertEqual(ic.exit_code(report), 0)

    def test_a_code_executing_global_is_forbidden(self):
        payload = _pickle([_global("os", "system"), _global("posix", "fork")])
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "hostile.pth", payload)
            report = ic.inspect(target)
        self.assertEqual(report["verdicts"].get("forbidden"), 2)
        self.assertEqual(ic.exit_code(report), 3)
        self.assertTrue(all(g["verdict"] == "forbidden" for g in report["globals"]))

    def test_the_executing_builtins_are_forbidden(self):
        for name in ("eval", "exec", "compile", "__import__", "open"):
            verdict, _ = ic.classify("builtins", name)
            self.assertEqual(verdict, "forbidden", f"builtins.{name}")
            self.assertEqual(ic.classify("__builtin__", name)[0], "forbidden")

    def test_an_unlisted_global_is_unknown_and_stops_the_run(self):
        payload = _pickle([_global("my_package.helpers", "MagicLoader")])
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "odd.pth", payload)
            report = ic.inspect(target)
        self.assertEqual(report["verdicts"].get("unknown"), 1)
        self.assertEqual(ic.exit_code(report), 3)

    def test_identity_mismatch_stops_with_six(self):
        payload = _pickle([_global("torch", "Size")])
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "ckpt.pth", payload)
            report = ic.inspect(target, expect_sha256="0" * 64,
                                expect_size=target.stat().st_size + 1)
        self.assertEqual(ic.exit_code(report), 6)
        self.assertFalse(report["sha256_matches_expected"])
        self.assertFalse(report["size_matches_expected"])

    def test_a_missing_file_is_reported_not_crashed(self):
        report = ic.inspect(Path("/nonexistent/model.pth"))
        self.assertFalse(report["exists"])
        self.assertEqual(ic.exit_code(report), 1)

    def test_the_expected_constants_are_the_supplied_ones(self):
        self.assertEqual(ic.EXPECTED_SHA256, CHECKPOINT_SHA256)
        self.assertEqual(ic.EXPECTED_SIZE, CHECKPOINT_SIZE)

    def test_the_inspector_never_imports_or_calls_a_loader(self):
        source = (SCRIPTS / "inspect_checkpoint.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        called = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    called.add(node.func.id)
                elif isinstance(node.func, ast.Attribute):
                    called.add(f"{getattr(node.func.value, 'id', '?')}.{node.func.attr}")
        for forbidden in ("torch.load", "pickle.load", "pickle.loads", "eval", "exec",
                          "__import__", "compile"):
            self.assertNotIn(forbidden, called, f"{forbidden} appears in the inspector")
        for module in ("import torch", "import numpy", "import mmpose", "import mmcv"):
            self.assertNotIn(module, source, f"{module} must not be needed to inspect")
        self.assertIn("import pickletools", source)

    def test_the_cli_writes_json_that_is_serialisable(self):
        payload = _pickle([_global("torch", "Size")])
        with tempfile.TemporaryDirectory() as tmp:
            target = _torch_zip(Path(tmp) / "ckpt.pth", payload)
            out = Path(tmp) / "reports" / "globals.json"
            argv = ["inspect_checkpoint.py", "--checkpoint", str(target),
                    "--expect-sha256", ic.sha256_of(target),
                    "--expect-size", str(target.stat().st_size), "--json-out", str(out)]
            import unittest.mock
            with unittest.mock.patch.object(sys, "argv", argv):
                with redirect_stdout(io.StringIO()):
                    code = ic.main()
            self.assertEqual(code, 0)
            payload_json = json.loads(out.read_text(encoding="utf-8"))
            self.assertIn("unique_globals", payload_json)
            self.assertIn("not_executed", payload_json)


class TestInferenceAllowListPolicy(unittest.TestCase):
    """run_inference's registration decision is a policy, so it is tested as one."""

    def test_the_allow_list_is_bounded_and_named(self):
        names = ri.allow_list_names()
        self.assertGreater(len(names), 30)
        for expected in ("torch._utils._rebuild_tensor_v2", "collections.OrderedDict",
                         "numpy.core.multiarray._reconstruct", "numpy.dtype",
                         "numpy.dtypes.UInt8DType", "numpy.dtypes.Float32DType",
                         "_codecs.encode", "builtins.bytes", "__builtin__.bytes"):
            self.assertIn(expected, names, expected)
        for forbidden in ("os.system", "posix.fork", "subprocess.Popen", "builtins.eval",
                          "__builtin__.exec", "socket.socket", "ctypes.CDLL"):
            self.assertNotIn(forbidden, names, forbidden)

    def test_a_normal_checkpoint_has_no_unexplained_globals(self):
        normal = ["collections.OrderedDict", "torch._utils._rebuild_tensor_v2",
                  "torch.FloatStorage", "torch.LongStorage", "torch.Size", "torch.device",
                  "numpy.core.multiarray._reconstruct", "numpy.ndarray", "numpy.dtype",
                  "_codecs.encode", "__builtin__.bytes", "__builtin__.set"]
        self.assertEqual(ri.unexplained_globals(normal), [])

    def test_the_audited_real_checkpoint_globals_are_allow_listed(self):
        # The operator's scan of the real 268,846,952-byte checkpoint found
        # exactly two unexplained globals beyond this set; the bounded
        # resolution (AUDIT.md §10) added them — plus torch 2.6's storage
        # reader, which the probe run showed torch.save() references.
        names = ri.allow_list_names()
        for expected in ("mmengine.logging.history_buffer.HistoryBuffer",
                         "builtins.getattr", "__builtin__.getattr",
                         "torch.storage._load_from_bytes"):
            self.assertIn(expected, names, expected)
        # still bounded: no code-execution or host module slipped in
        for host in ("os", "posix", "nt", "subprocess", "socket", "shutil",
                     "ctypes", "pickle", "marshal", "importlib"):
            self.assertFalse(any(n.startswith(host + ".") for n in names), host)

    def test_forbidden_builtins_list_is_unchanged_and_getattr_is_not_on_it(self):
        # getattr is an attribute READ, not a code-execution primitive; the
        # hard-stop list must stay exactly the executing builtins.
        self.assertEqual(ic.FORBIDDEN_BUILTINS, {
            "eval", "exec", "compile", "open", "__import__", "input",
            "breakpoint", "globals", "locals", "vars", "help", "exit", "quit"})
        self.assertNotIn("getattr", ic.FORBIDDEN_BUILTINS)

    def test_unknown_globals_are_returned_sorted(self):
        self.assertEqual(ri.unexplained_globals(["os.system", "__builtin__.eval", "torch.Size"]),
                         ["__builtin__.eval", "os.system"])

    def test_registration_refuses_an_unknown_global_before_touching_torch(self):
        # No torch in this environment: if the refusal happened after `import torch`
        # this would raise ModuleNotFoundError instead of SystemExit.
        with self.assertRaises(SystemExit) as ctx:
            ri.register_safe_globals(["os.system"])
        self.assertIn("os.system", str(ctx.exception))
        self.assertIn("allow-list", str(ctx.exception))

    def test_the_runner_keeps_the_strict_load_default(self):
        source = (SCRIPTS / "run_inference.py").read_text(encoding="utf-8")
        self.assertIn("add_safe_globals", source)
        self.assertNotIn("weights_only=False", source.replace(" ", ""),
                         "the runner must keep torch's strict weights_only=True default")
        self.assertNotIn("torch.load(", source)


class TestEnvironmentRangeLogic(unittest.TestCase):
    """The version rules come from the fork's own __init__.py — check the comparator."""

    def test_release_candidate_parsing(self):
        # always 4-tuples, so 2.0.0rc4 and 2.0.0 compare equal to each other
        self.assertEqual(ce.parse_version("2.0.0rc4"), (2, 0, 0, 0))
        self.assertEqual(ce.parse_version("2.1.0"), (2, 1, 0, 0))
        self.assertEqual(ce.parse_version("2.6.0+cu124"), (2, 6, 0, 0))
        self.assertEqual(ce.parse_version("0.10.7"), (0, 10, 7, 0))

    def test_the_mmcv_window_from_the_fork(self):
        self.assertTrue(ce.in_range("2.0.0rc4", ce.MMCV_MIN, ce.MMCV_MAX))
        self.assertTrue(ce.in_range("2.0.1", ce.MMCV_MIN, ce.MMCV_MAX))
        self.assertTrue(ce.in_range("2.1.0", ce.MMCV_MIN, ce.MMCV_MAX))
        self.assertFalse(ce.in_range("2.2.0", ce.MMCV_MIN, ce.MMCV_MAX),
                         "mmcv 2.2.0 is what mim picked and is out of range")

    def test_the_mmengine_window_from_the_fork(self):
        self.assertTrue(ce.in_range("0.6.0", ce.MMENGINE_MIN, ce.MMENGINE_MAX))
        self.assertTrue(ce.in_range("0.10.7", ce.MMENGINE_MIN, ce.MMENGINE_MAX))
        self.assertTrue(ce.in_range("1.0.0", ce.MMENGINE_MIN, ce.MMENGINE_MAX))
        self.assertFalse(ce.in_range("1.0.1", ce.MMENGINE_MIN, ce.MMENGINE_MAX))

    def test_the_ranges_match_the_fork_file_when_it_is_available(self):
        import os
        repo = os.environ.get("CLDETECTION2023_REPO")
        if not repo:
            self.skipTest("set CLDETECTION2023_REPO to cross-check against the checkout")
        init_py = Path(repo) / "mmpose_package/mmpose/mmpose/__init__.py"
        if not init_py.is_file():
            self.skipTest(f"{init_py} not found")
        text = init_py.read_text(encoding="utf-8", errors="replace")
        for bound in (ce.MMCV_MIN, ce.MMCV_MAX, ce.MMENGINE_MIN, ce.MMENGINE_MAX):
            self.assertIn(f"'{bound}'", text, f"{bound} not declared in the fork")


class TestMhaHeaderParser(unittest.TestCase):
    """The input extractor reads the organiser's container; check the parser itself."""

    HEADER = (b"ObjectType = Image\nNDims = 3\nBinaryData = True\n"
              b"BinaryDataByteOrderMSB = False\nCompressedData = False\n"
              b"TransformMatrix = 1 0 0 0 -1 0 0 0 -1\nOffset = 0 0 0\n"
              b"CenterOfRotation = 0 0 0\nAnatomicalOrientation = RPS\n"
              b"ElementSpacing = 1 1 1\nDimSize = 2880 2400 2\n"
              b"ElementNumberOfChannels = 3\nElementType = MET_UCHAR\n"
              b"ElementDataFile = LOCAL\n")

    def test_header_is_parsed_and_the_data_offset_is_correct(self):
        with tempfile.TemporaryDirectory() as tmp:
            stack = Path(tmp) / "stack1.mha"
            pixels = bytes([7]) * (10 * 10 * 3 * 2)
            stack.write_bytes(self.HEADER + pixels)
            header, offset = ei.read_header(stack)
        self.assertEqual(header["ElementType"], "MET_UCHAR")
        self.assertEqual(header["DimSize"], "2880 2400 2")
        self.assertEqual(offset, len(self.HEADER))
        self.assertEqual(header["ElementDataFile"], "LOCAL")

    def test_a_non_mha_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            bogus = Path(tmp) / "stack1.mha"
            bogus.write_bytes(b"this is not a MetaImage file")
            with self.assertRaises(SystemExit):
                ei.read_header(bogus)

    def test_a_non_uchar_container_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            stack = Path(tmp) / "stack.mha"
            stack.write_bytes(self.HEADER.replace(b"MET_UCHAR", b"MET_FLOAT"))
            with self.assertRaises(SystemExit):
                ei.read_header(stack)

    def test_the_expected_source_facts_are_recorded(self):
        source = (SCRIPTS / "extract_input.py").read_text(encoding="utf-8")
        self.assertIn("szuboy/CL-Detection2023", source)
        self.assertIn("dc1ce2bd0a3f317de4160cde17e4a6f60371e67c", source)
        self.assertIn("stack1.mha", source)


class TestLabDocumentation(unittest.TestCase):
    """The audit is the deliverable; make its load-bearing claims testable."""

    def test_audit_records_the_verified_configuration(self):
        text = (LAB / "AUDIT.md").read_text(encoding="utf-8")
        for token in ("TopdownPoseEstimator", "HRNet", "SRPoseHead", "num_joints",
                      "38", "MSRAHeatmap", "1024", "268846952"):
            self.assertIn(token, text, f"AUDIT.md must record {token}")
        # digests are case-insensitive on purpose: the operator's certutil prints upper-case
        self.assertIn(CHECKPOINT_SHA256, text.lower(), "AUDIT.md must record the checkpoint digest")

    def test_audit_records_the_environment_repairs_and_their_reasons(self):
        text = (LAB / "AUDIT.md").read_text(encoding="utf-8")
        for token in ("mmcv-lite", "pkg_resources", "weights_only", "xtcocotools",
                      "2.1.0", "0.10.7", "1.26.4"):
            self.assertIn(token, text, f"AUDIT.md must record {token}")

    def test_no_model_binary_or_patient_image_is_committed(self):
        tracked = [p for p in LAB.rglob("*") if p.is_file()
                   and p.suffix.lower() in (".pth", ".mha", ".png", ".jpg", ".jpeg", ".nii")]
        self.assertEqual(tracked, [], f"files that must not live in the lab: {tracked}")

    def test_gitignore_covers_weights_inputs_and_the_venv(self):
        text = (LAB / ".gitignore").read_text(encoding="utf-8")
        for pattern in (".venv", "*.pth", "*.mha", "model/", "input/"):
            self.assertIn(pattern, text, pattern)


if __name__ == "__main__":
    unittest.main(verbosity=2)

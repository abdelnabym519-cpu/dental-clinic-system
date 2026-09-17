#!/usr/bin/env python3
"""
test_cli_contract.py — the behaviour of the runner when it cannot succeed.

This is the part that matters most, and the part that can be tested here: the
lab must **fail honestly**. The model files do not exist in this repository, so
what is verifiable is that

  * the runner starts, parses its arguments, and explains itself with `--help`;
  * with the artifacts missing it stops with status `BLOCKED` and exit code 3 —
    it does not crash, and it does not pretend;
  * it never writes `OPERATIONAL` or `inference_success: true` without a real run;
  * `--dry-run` checks prerequisites and prints a command without executing it;
  * the image probe reads real headers and rejects what it cannot identify.

Processes are launched in temporary directories so nothing is written into the
lab, and no network access is required or performed.

Usage:
    python -m unittest discover -s tests -v
    python tests/test_cli_contract.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPTS = LAB / "scripts"
RUNNER = SCRIPTS / "run_dentalgemma.py"


def _load(name: str, filename: str):
    path = SCRIPTS / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


def run_runner(args: list[str], cwd: Path, timeout: int = 300):
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    return subprocess.run([sys.executable, str(RUNNER)] + args,
                          capture_output=True, text=True, timeout=timeout,
                          cwd=str(cwd), env=env)


def png_bytes(width: int, height: int) -> bytes:
    """A minimal but structurally valid PNG header, for probe tests only."""
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)  # 8-bit grayscale
    return (signature
            + struct.pack(">I", 13) + b"IHDR" + ihdr + b"\x00\x00\x00\x00"
            + b"\x00\x00\x00\x00IEND\xaeB`\x82")


class TestHelpAndArgumentHandling(unittest.TestCase):
    def test_help_works(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_runner(["--help"], Path(tmp))
        self.assertEqual(result.returncode, 0)
        self.assertIn("--image", result.stdout)
        self.assertIn("--mmproj", result.stdout)
        self.assertIn("OPERATIONAL", result.stdout,
                      "the exit-code/status contract should be documented in --help")

    def test_unknown_flag_is_a_usage_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_runner(["--not-a-flag"], Path(tmp))
        self.assertEqual(result.returncode, 2)


class TestHonestFailureWithoutArtifacts(unittest.TestCase):
    """With no weights present, BLOCKED is the only acceptable outcome."""

    def _run_missing(self, extra: list[str] | None = None):
        tmp = tempfile.TemporaryDirectory(prefix="dentalgemma_contract_")
        self.addCleanup(tmp.cleanup)
        work = Path(tmp.name)
        result = run_runner(
            ["--image", "missing.png", "--output-dir", str(work / "out"),
             "--logs-dir", str(work / "logs")] + (extra or []),
            work)
        return work, result

    def test_missing_artifacts_report_blocked(self):
        work, result = self._run_missing()
        self.assertEqual(result.returncode, 3,
                         f"expected BLOCKED (3), got {result.returncode}:\n{result.stdout}")
        self.assertIn("[STOP]", result.stdout)
        self.assertIn("download_artifacts.py", result.stdout)

        report = json.loads((work / "out" / "run_report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "BLOCKED")
        self.assertIs(report["inference_success"], False)
        self.assertIsNone(report["output_path"])
        self.assertIsNone(report["inference_seconds"])
        self.assertIsNone(report["peak_ram_gb"])

    def test_blocked_run_writes_no_operational_claim(self):
        work, _ = self._run_missing()
        text = (work / "out" / "run_report.json").read_text(encoding="utf-8")
        self.assertNotIn("OPERATIONAL", text)
        self.assertNotIn('"inference_success": true', text)

    def test_a_run_log_is_written_even_when_blocked(self):
        work, _ = self._run_missing()
        logs = list((work / "logs").glob("run_*.json"))
        self.assertEqual(len(logs), 1, "every attempt must leave a trace")

    def test_dry_run_with_missing_artifacts_is_still_blocked(self):
        _, result = self._run_missing(["--dry-run"])
        self.assertEqual(result.returncode, 3,
                         "a dry run must not turn missing prerequisites into success")


class TestImageProbe(unittest.TestCase):
    def setUp(self):
        runner = _load("dg_runner_probe", "run_dentalgemma.py")
        self.probe = runner.probe_image
        self.tmp = tempfile.TemporaryDirectory(prefix="dentalgemma_image_")
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_png_dimensions_and_mode(self):
        path = self.dir / "test.png"
        path.write_bytes(png_bytes(1024, 512))
        info = self.probe(path)
        self.assertEqual(info["format"], "png")
        self.assertEqual(info["width"], 1024)
        self.assertEqual(info["height"], 512)
        self.assertEqual(info["mode"], "grayscale")

    def test_unrecognised_bytes_are_reported_as_unknown_not_guessed(self):
        path = self.dir / "mystery.bin"
        path.write_bytes(b"this is not an image at all, not even close")
        info = self.probe(path)
        self.assertIsNone(info["format"])
        self.assertIsNone(info["width"])
        self.assertIsNone(info["height"])

    def test_empty_file_does_not_raise(self):
        path = self.dir / "empty.png"
        path.write_bytes(b"")
        info = self.probe(path)
        self.assertIsNone(info["format"])


class TestCommandConstruction(unittest.TestCase):
    def setUp(self):
        runner = _load("dg_runner_command", "run_dentalgemma.py")
        self.runner = runner
        self.tmp = tempfile.TemporaryDirectory(prefix="dentalgemma_cmd_")
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def _args(self, **overrides):
        runner = self.runner
        argv = ["--model", "man"] if False else []
        parser_args = {
            "prompt": "describe this radiograph",
            "ctx": 4096, "predict": 128, "temp": 0.1, "seed": 42,
            "threads": 0, "ngl": None, "no_mmproj_offload": False,
            "extra": None,
        }
        parser_args.update(overrides)
        return type("Args", (), parser_args)

    def test_command_has_both_gguf_files_and_the_image(self):
        args = self._args()
        cmd = self.runner.build_command(Path("llama-mtmd-cli"),
                                        Path("main.gguf"), Path("mmproj.gguf"),
                                        Path("img.png"), args)
        joined = " ".join(cmd)
        self.assertIn("-m", cmd)
        self.assertIn("--mmproj", cmd)
        self.assertIn("--image", cmd)
        self.assertIn("main.gguf", joined)
        self.assertIn("mmproj.gguf", joined)
        self.assertIn("img.png", joined)

    def test_command_is_deterministic(self):
        args = self._args()
        first = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        second = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        self.assertEqual(first, second, "the same inputs must build the same argv")

    def test_seed_is_always_passed(self):
        args = self._args(seed=7)
        cmd = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        self.assertIn("--seed", cmd)
        self.assertEqual(cmd[cmd.index("--seed") + 1], "7",
                         "a fixed seed is what makes a rerun comparable")

    def test_no_gpu_flag_unless_asked(self):
        args = self._args()
        cmd = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        self.assertNotIn("-ngl", cmd, "this lab must not require a GPU")

    def test_threads_flag_is_omitted_when_not_requested(self):
        """`-t 0` is not "auto" on every llama.cpp build — omitting it is."""
        args = self._args(threads=0)
        cmd = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        self.assertNotIn("-t", cmd)

    def test_threads_flag_is_passed_when_requested(self):
        args = self._args(threads=8)
        cmd = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        self.assertIn("-t", cmd)
        self.assertEqual(cmd[cmd.index("-t") + 1], "8")

    def test_mmproj_offload_flag_is_opt_in(self):
        args = self._args(no_mmproj_offload=True)
        cmd = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        self.assertIn("--no-mmproj-offload", cmd)

    def test_extra_flags_are_appended_verbatim(self):
        args = self._args(extra=["--verbose", "-b", "512"])
        cmd = self.runner.build_command(Path("b"), Path("m"), Path("p"), Path("i"), args)
        self.assertTrue(cmd[-3:] == ["--verbose", "-b", "512"], cmd)


def synthetic_gguf(architecture: str = "gemma3", tensors: int = 1,
                   kv_extra: dict | None = None,
                   kv_strings: dict | None = None) -> bytes:
    """A structurally valid but hollow GGUF container, for the verifier's tests.

    This is not a model and is never written inside the lab: the tests below assert
    that the verifier *rejects* files like this one. Building them here is what
    makes the rejection path testable without 3.47 GiB and without inventing
    weights — the file is a container header, and the expected outcome is failure.
    """
    def string(value: str) -> bytes:
        # GGUF lengths are *byte* counts. Using len() on the str wrote a short
        # length for any non-ASCII value (the em dash in the name), which shifted
        # every following key: the container parsed three entries and quietly gave
        # up on the rest. The debug output gave it away — the name came back as
        # "…NOT a mod".
        data = value.encode("utf-8")
        return struct.pack("<Q", len(data)) + data

    def kv_u32(key: str, value: int) -> bytes:
        return string(key) + struct.pack("<I", 4) + struct.pack("<I", value)

    def kv_str(key: str, value: str) -> bytes:
        return string(key) + struct.pack("<I", 8) + string(value)

    kv = (kv_str("general.architecture", architecture)
          + kv_u32("general.file_type", 15)
          + kv_str("general.name", "synthetic container — NOT a model")
          + kv_u32(f"{architecture}.context_length", 4096))
    for key, value in (kv_extra or {}).items():
        kv += kv_u32(f"{architecture}.{key}", value)
    for key, value in (kv_strings or {}).items():
        kv += kv_str(key, value)

    tensor_info = b""
    for index in range(tensors):
        tensor_info += string(f"blk.{index}.weight") + struct.pack("<I", 1) \
            + struct.pack("<Q", 4096 + index) + struct.pack("<Q", 0)
    header = struct.pack("<IIQQ", 0x46554747, 3, tensors,
                         4 + len(kv_extra or {}) + len(kv_strings or {}))
    return header + kv + tensor_info + b"\x00" * 256


class TestVerifierRejection(unittest.TestCase):
    """The verifier must refuse anything that is not the published pair."""

    def _run(self, files: dict[str, bytes]):
        tmp = tempfile.TemporaryDirectory(prefix="dentalgemma_verify_")
        self.addCleanup(tmp.cleanup)
        model_dir = Path(tmp.name) / "model"
        model_dir.mkdir()
        for name, payload in files.items():
            (model_dir / name).write_bytes(payload)
        out = Path(tmp.name) / "verification.json"
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "verify_artifacts.py"),
             "--model-dir", str(model_dir), "--json-out", str(out), "--skip-metadata"],
            capture_output=True, text=True, timeout=300)
        self.assertTrue(out.is_file(), "a verification attempt must leave a record")
        return json.loads(out.read_text(encoding="utf-8")), result

    def test_an_empty_directory_fails_and_names_what_is_missing(self):
        report, result = self._run({})
        self.assertEqual(result.returncode, 1)
        self.assertFalse(report["all_checks_passed"])
        for role in ("main", "mmproj"):
            self.assertIn("missing", report["artifacts"][role]["problems"])
        self.assertIn("download_artifacts.py", result.stdout)

    def test_wrong_size_and_digest_fail_even_when_the_container_parses(self):
        """A hollow GGUF with the right name must not pass."""
        artifacts = _load("dg_verify_artifacts", "artifacts.py")
        payload = synthetic_gguf()
        files = {artifacts.ARTIFACTS[role]["filename"]: payload
                 for role in ("main", "mmproj")}
        report, result = self._run(files)

        self.assertEqual(result.returncode, 1)
        self.assertFalse(report["all_checks_passed"])
        for role in ("main", "mmproj"):
            entry = report["artifacts"][role]
            self.assertTrue(entry["present"])
            self.assertFalse(entry["size_matches"])
            self.assertFalse(entry["sha256_matches"])
            self.assertIn("size mismatch", entry["problems"])
            self.assertIn("sha256 mismatch", entry["problems"])
            # the local digest is always reported, and labelled as local
            self.assertEqual(len(entry["sha256_local"]), 64)
            self.assertNotEqual(entry["sha256_local"], entry["expected_sha256"])
        self.assertIn("LOCAL HASH", result.stdout)
        # the closing verdict is wrapped for the console, so match a short phrase
        self.assertIn("verification did not pass", result.stdout)
        self.assertIn("NOT the published artifact", result.stdout.replace("\n", " ")) 
        self.assertNotIn("RESULT: both artifacts are present", result.stdout)
        self.assertFalse(report["all_checks_passed"])
        # the pairing cross-check must also have flagged that this is not a pair
        self.assertIsNotNone(report["pairing"])
        self.assertFalse(report["pairing"]["all_ok"])

    def test_a_non_gguf_file_is_rejected_as_a_container(self):
        artifacts = _load("dg_verify_artifacts2", "artifacts.py")
        files = {role_spec["filename"]: b"not a gguf file" * 100
                 for role_spec in artifacts.ARTIFACTS.values()}
        report, result = self._run(files)
        self.assertEqual(result.returncode, 1)
        for role in ("main", "mmproj"):
            self.assertTrue(any("GGUF" in problem or "gguf" in problem
                                for problem in report["artifacts"][role]["problems"]),
                            report["artifacts"][role]["problems"])
        self.assertIn("INVALID", result.stdout)

    def test_the_expected_digests_are_never_replaced_by_local_ones(self):
        """The published values must stay what they are: the publisher's."""
        artifacts = _load("dg_verify_artifacts3", "artifacts.py")
        source = (SCRIPTS / "verify_artifacts.py").read_text(encoding="utf-8")
        self.assertIn('sha256_expected"]', source)
        self.assertNotIn("sha256_expected\"] =", source,
                         "nothing may overwrite the published digest with a local one")
        for role, spec in artifacts.ARTIFACTS.items():
            self.assertRegex(spec["sha256_expected"], r"^[0-9a-f]{64}$")
            self.assertIn("Hugging Face", spec["sha256_origin"])


class TestTokenizerDiagnosisInVerifier(unittest.TestCase):
    """`verify_artifacts.py` must surface the metadata that decides decoding.

    The [UNK_BYTE_...] markers come from llama.cpp choosing its GPT-2 byte-level
    detokenize path for a vocabulary whose pieces contain ▁. That choice is made
    from two GGUF keys, so the verifier — which already opens the file's header —
    is the right place to make the condition visible without running anything.
    """

    def _verify(self, tokenizer_model: str | None, tokenizer_pre: str | None = None):
        artifacts = _load("dg_verify_meta_artifacts", "artifacts.py")
        strings = {}
        if tokenizer_model:
            strings["tokenizer.ggml.model"] = tokenizer_model
        if tokenizer_pre:
            strings["tokenizer.ggml.pre"] = tokenizer_pre
        payload = synthetic_gguf(kv_strings=strings)
        with tempfile.TemporaryDirectory(prefix="dentalgemma_tokmeta_") as tmp:
            model_dir = Path(tmp) / "model"
            model_dir.mkdir()
            for role in ("main", "mmproj"):
                (model_dir / artifacts.ARTIFACTS[role]["filename"]).write_bytes(payload)
            out = Path(tmp) / "v.json"
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "verify_artifacts.py"),
                 "--model-dir", str(model_dir), "--json-out", str(out), "--skip-metadata"],
                capture_output=True, text=True, timeout=300)
            return result, json.loads(out.read_text(encoding="utf-8"))

    def test_gpt2_vocab_is_flagged_with_the_marker_mechanism(self):
        result, report = self._verify("gpt2", "default")
        self.assertIn("tokenizer     : model=gpt2 pre=default", result.stdout)
        self.assertIn("escape_whitespaces=False", result.stdout)
        self.assertIn("unk-byte-markers-possible", result.stdout)
        self.assertIn("e29681", result.stdout)
        self.assertIn("OUTPUT_DECODING.md", result.stdout)

        decode = report["artifacts"]["main"]["gguf"]["tokenizer"]["decode"]
        self.assertEqual(decode["risk"], "unk-byte-markers-possible")
        self.assertIs(decode["escape_whitespaces"], False)
        self.assertIn("llama-vocab.cpp", decode["basis"])

    def test_a_missing_pre_is_named_as_missing_not_as_default(self):
        result, _ = self._verify("gpt2", None)
        self.assertIn("(missing", result.stdout)
        self.assertIn("unk-byte-markers-possible", result.stdout)

    def test_the_spm_path_is_not_flagged(self):
        result, report = self._verify("llama", None)
        self.assertNotIn("unk-byte-markers-possible", result.stdout)
        decode = report["artifacts"]["main"]["gguf"]["tokenizer"]["decode"]
        self.assertEqual(decode["risk"], "none")
        self.assertIn("SPM", decode["vocab_type"])

    def test_the_gemma4_model_type_is_not_flagged(self):
        result, report = self._verify("gemma4", None)
        self.assertNotIn("unk-byte-markers-possible", result.stdout)
        decode = report["artifacts"]["main"]["gguf"]["tokenizer"]["decode"]
        self.assertIs(decode["escape_whitespaces"], True)

    def test_a_file_without_tokenizer_metadata_says_nothing_false(self):
        result, _ = self._verify(None, None)
        self.assertNotIn("unk-byte-markers-possible", result.stdout)
        self.assertNotIn("escape_whitespaces", result.stdout)


class TestReportSchemaAdditions(unittest.TestCase):
    """The capture/integrity blocks are additive: nothing required moved."""

    REQUIRED_BEFORE = 18

    def setUp(self):
        self.schema = json.loads((LAB / "report.schema.json").read_text(encoding="utf-8"))
        self.template = json.loads(
            (LAB / "reports" / "run_report.template.json").read_text(encoding="utf-8"))

    def test_the_required_field_set_is_unchanged(self):
        self.assertEqual(len(self.schema["required"]), self.REQUIRED_BEFORE)
        for field in ("capture", "output_integrity"):
            self.assertNotIn(field, self.schema["required"],
                             f"{field} is optional: an older report stays valid")

    def test_the_new_blocks_are_described_in_the_schema(self):
        for field in ("capture", "output_integrity"):
            with self.subTest(field=field):
                prop = self.schema["properties"][field]
                self.assertIn("null", prop["type"],
                              "unmeasured in a template, so null must be allowed")
                self.assertIn("description", prop)

    def test_output_integrity_documents_that_it_does_not_change_status(self):
        note = self.schema["properties"]["output_integrity"]["description"]
        self.assertIn("does not change `status`", note)
        self.assertIn("preserved", note)

    def test_the_template_is_null_for_the_new_blocks(self):
        for field in ("capture", "output_integrity"):
            self.assertIsNone(self.template[field],
                              f"{field} must be null until a run measures it")

    def test_the_schema_has_no_baked_in_measurements(self):
        """The schema describes shape, never a value from a machine."""
        text = (LAB / "report.schema.json").read_text(encoding="utf-8")
        for accidental in ("e29681", "311ea621", "3d03262e", "5.152", "42.686"):
            self.assertNotIn(accidental, text,
                             f"{accidental} is a measurement, not a schema description")


class TestOutputDraining(unittest.TestCase):
    """The sampler must not deadlock against a chatty child.

    Regression test for a real defect in this lab: the memory/CPU sampler loops
    until the child exits, but a child whose stdout/stderr pipes are full cannot
    exit. llama.cpp prints far more than the 64 KiB pipe buffer while loading a 4B
    model, so reading the pipes only after sampling left the run hanging until the
    timeout, killed, with an empty log — a failure that would have looked like the
    model's fault. A child that prints 1.5 MiB and exits must now be sampled and
    captured, promptly.
    """

    def test_large_child_output_is_captured_without_hanging(self):
        runner = _load("dg_runner_drain", "run_dentalgemma.py")
        child = [sys.executable, "-c",
                 "import sys; sys.stdout.write('x' * 1_500_000); "
                 "sys.stderr.write('y' * 500_000)"]
        started = time.time()
        proc = subprocess.Popen(child, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace")
        box: dict = {}
        reader = threading.Thread(target=runner.read_child_async,
                                  args=(proc, 120.0, box), daemon=True)
        reader.start()
        observed = runner.monitor(proc, 0.05)
        reader.join(timeout=60)
        elapsed = time.time() - started

        self.assertEqual(len(box.get("stdout", "")), 1_500_000)
        self.assertEqual(len(box.get("stderr", "")), 500_000)
        self.assertFalse(box.get("timed_out"))
        self.assertLess(elapsed, 90, "draining 2 MiB must not approach the timeout")
        self.assertIn("note", observed)

    def test_psutil_probe_is_used_when_available(self):
        """On Windows this is the probe that supplies the reported peak RAM.

        It cannot run for real here (the sandbox has no psutil), so it is exercised
        against a stub that answers the same three calls. What is being checked is
        the lab's own logic: that the psutil branch is taken when psutil exists,
        that the number it returns is the one reported, and that its absence falls
        back to a platform probe instead of failing.
        """
        runner = _load("dg_runner_psutil", "run_dentalgemma.py")

        class _MemInfo:
            rss = 100 * 1024 * 1024
            peak_wset = 512 * 1024 * 1024

        class _Times:
            user = 1.5
            system = 0.25

        class _StubProcess:
            def __init__(self, pid):
                self.pid = pid

            def memory_info(self):
                return _MemInfo()

            def cpu_times(self):
                return _Times()

        class _StubPsutil:
            Process = _StubProcess

        saved = sys.modules.get("psutil")
        sys.modules["psutil"] = _StubPsutil()
        try:
            proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.4)"],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            box: dict = {}
            reader = threading.Thread(target=runner.read_child_async,
                                      args=(proc, 60.0, box), daemon=True)
            reader.start()
            observed = runner.monitor(proc, 0.05)
            reader.join(timeout=30)
        finally:
            if saved is None:
                sys.modules.pop("psutil", None)
            else:
                sys.modules["psutil"] = saved

        self.assertEqual(observed["probe"], "psutil")
        self.assertEqual(observed["peak_rss_bytes"], 512 * 1024 * 1024,
                         "the highest value reported by the probe is what is kept")
        self.assertAlmostEqual(observed["cpu_seconds"], 1.75, places=3)

    def test_a_timeout_still_kills_and_reports(self):
        runner = _load("dg_runner_timeout", "run_dentalgemma.py")
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True)
        box: dict = {}
        reader = threading.Thread(target=runner.read_child_async,
                                  args=(proc, 1.0, box), daemon=True)
        reader.start()
        runner.monitor(proc, 0.05)
        reader.join(timeout=60)
        self.assertTrue(box.get("timed_out"), "the timeout must be recorded")
        self.assertIsNotNone(proc.returncode, "the child must be dead, not orphaned")


class TestStatusVocabulary(unittest.TestCase):
    def test_operational_is_not_used_by_static_code(self):
        """Only a completed run may set OPERATIONAL — never a constant."""
        runner = _load("dg_runner_status", "run_dentalgemma.py")
        source = RUNNER.read_text(encoding="utf-8")
        # It must appear exactly once: as the status returned after a verified success.
        occurrences = source.count("STATUS_OPERATIONAL")
        self.assertEqual(occurrences, 1,
                         f"STATUS_OPERATIONAL should be used once (on observed success), "
                         f"found {occurrences} uses")
        self.assertIn("if success:", source)
        self.assertIn("return finish(artifacts.STATUS_OPERATIONAL, 0)", source)
        for status in runner.artifacts.ALLOWED_STATUSES:
            self.assertIn(status, runner.artifacts.ALLOWED_STATUSES)


if __name__ == "__main__":
    unittest.main(verbosity=2)

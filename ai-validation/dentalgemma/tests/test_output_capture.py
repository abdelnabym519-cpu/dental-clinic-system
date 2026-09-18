#!/usr/bin/env python3
"""
test_output_capture.py — the capture and decoding layer, tested against a
synthetic runtime.

The problem this file exists for: an actual local run of DentalGemma produced
text containing ``[UNK_BYTE_0xe29681...]``. Those markers are written by
llama.cpp's own detokenizer (`llama_decode_text`, src/llama-vocab.cpp) before
this lab sees a single byte — so the lab's obligation is not to *repair* the
text but to (a) not corrupt it, (b) not silently drop the evidence, and (c) say
clearly what the runtime did. These tests pin that down.

The end-to-end tests need a runtime to drive. There is no llama.cpp and no model
here, so they build a **synthetic** one: an executable named ``llama-mtmd-cli``
that emits bytes we choose. It is not a model, it produces no real output, and it
lives in a temporary directory — but it exercises every layer between the child's
pipe and the report: the reader thread, the explicit UTF-8 decode, the raw byte
copies, the marker audit, and the status contract.

They are skipped on Windows, where an executable script is not a thing; the
platform-independent parts (decode_stream, audit_unk_bytes) run everywhere.

Usage:
    python -m unittest discover -s tests -v
    python tests/test_output_capture.py
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import struct
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPTS = LAB / "scripts"
RUNNER = SCRIPTS / "run_dentalgemma.py"

# The exact shape of the incident: llama.cpp replaced the codepoint ▁ (U+2581,
# bytes e2 96 81 — the SentencePiece space) with its marker, and the marker's
# closing bracket comes after a copy of the whole token text, so the piece's
# remaining characters appear a second time after it.
INCIDENT_TEXT = "This[UNK_BYTE_0xe29681\u2581is]is a dental radiograph.\n"
# The same text as it looked when read in a Windows-1252 code page: the bytes
# e2 96 81 rendered as "â–" (0x81 is unmapped in cp1252). This is what the user
# saw, and it is a *reading* artifact of the file, not its content.
MOJIBAKE_VIEW = "This[UNK_BYTE_0xe29681\u00e2\u0096is]is a dental radiograph.\n"


def _load(name: str, filename: str):
    path = SCRIPTS / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


runner = _load("dg_capture_runner", "run_dentalgemma.py")
artifacts = _load("dg_capture_artifacts", "artifacts.py")


def png_bytes(width: int = 128, height: int = 128) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (signature + struct.pack(">I", 13) + b"IHDR" + ihdr + b"\x00\x00\x00\x00"
            + b"\x00\x00\x00\x00IEND\xaeB`\x82")


FAKE_RUNTIME = '''\
#!/usr/bin/env python3
"""A synthetic llama-mtmd-cli. Emits bytes, then exits. Not a model."""
import sys

if "--version" in sys.argv or "--help" in sys.argv:
    sys.stdout.write("version: b11026 (synthetic test runtime, not llama.cpp)\\n")
    raise SystemExit(0)

STDOUT = {stdout!r}
STDERR = {stderr!r}
EXIT = {exit_code!r}

sys.stdout.buffer.write(STDOUT)
sys.stdout.buffer.flush()
sys.stderr.buffer.write(STDERR)
sys.stderr.buffer.flush()
raise SystemExit(EXIT)
'''


class CaptureRig:
    """A temporary lab-shaped sandbox: fake runtime, fake weights, fake image."""

    def __init__(self, stdout: bytes, stderr: bytes = b"", exit_code: int = 0,
                 sleep: float = 0.0):
        self._tmp = tempfile.TemporaryDirectory(prefix="dentalgemma_capture_")
        self.root = Path(self._tmp.name)
        self.binaries = self.root / "llama.cpp"
        self.binaries.mkdir()
        self.model = self.root / "model"
        self.model.mkdir()
        self.out = self.root / "output"
        self.logs = self.root / "logs"
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code
        self.sleep = sleep
        self._write_runtime()
        self.main_gguf, self.mmproj_gguf = self._write_weights()
        # Remembered now, because one test deletes a weight to check the BLOCKED path.
        self._digests = {path: hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in (self.main_gguf, self.mmproj_gguf)}
        self.image = self.root / "panoramic.png"
        self.image.write_bytes(png_bytes())

    def _write_runtime(self) -> None:
        body = FAKE_RUNTIME.format(stdout=self.stdout, stderr=self.stderr,
                                   exit_code=self.exit_code)
        if self.sleep:
            body = body.replace("sys.stdout.buffer.write(STDOUT)",
                                f"import time; time.sleep({self.sleep!r})\n"
                                "sys.stdout.buffer.write(STDOUT)")
        path = self.binaries / "llama-mtmd-cli"
        path.write_text(body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    def _write_weights(self) -> tuple[Path, Path]:
        """Small files with the published names. They are not real GGUF files."""
        main = self.model / artifacts.ARTIFACTS["main"]["filename"]
        mmproj = self.model / artifacts.ARTIFACTS["mmproj"]["filename"]
        main.write_bytes(b"synthetic placeholder, not a model\n" * 40)
        mmproj.write_bytes(b"synthetic placeholder, not a projector\n" * 20)
        return main, mmproj

    def sha256(self, path: Path) -> str:
        return self._digests.get(path) or hashlib.sha256(path.read_bytes()).hexdigest()

    def run(self, extra: list[str] | None = None, timeout: float = 120.0):
        cmd = [
            sys.executable, str(RUNNER),
            "--main", str(self.main_gguf),
            "--mmproj", str(self.mmproj_gguf),
            "--image", str(self.image),
            "--llama-dir", str(self.binaries),
            "--output-dir", str(self.out),
            "--logs-dir", str(self.logs),
            "--sample-interval", "0.05",
            "--expect-main-sha256", self.sha256(self.main_gguf),
            "--expect-mmproj-sha256", self.sha256(self.mmproj_gguf),
            "--timeout", str(timeout),
        ] + (extra or [])
        return subprocess.run(cmd, capture_output=True, text=True, timeout=300,
                              cwd=str(self.root))

    def report(self) -> dict:
        return json.loads((self.out / "run_report.json").read_text(encoding="utf-8"))

    def artifact(self, name: str) -> Path:
        return self.out / f"panoramic_{name}"

    def cleanup(self):
        self._tmp.cleanup()


@unittest.skipIf(os.name == "nt",
                 "an executable script is not a runnable runtime on Windows; the "
                 "synthetic end-to-end rig is POSIX-only, the decode unit tests "
                 "below cover the same logic everywhere")
class TestEndToEndCapture(unittest.TestCase):
    """The whole path: child bytes → reader thread → files → report."""

    def _rig(self, **kwargs) -> CaptureRig:
        rig = CaptureRig(**kwargs)
        self.addCleanup(rig.cleanup)
        return rig

    def test_incident_output_is_preserved_byte_for_byte(self):
        stdout = INCIDENT_TEXT.encode("utf-8")
        rig = self._rig(stdout=stdout, stderr=b"llama_model_loader: loaded\n")
        result = rig.run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        report = rig.report()
        self.assertEqual(report["status"], "OPERATIONAL")
        self.assertIs(report["inference_success"], True)

        # 1. the marker survives, and the ▁ inside it is a real U+2581 — not
        #    mojibake, not a replacement character
        readable = rig.artifact("response.txt").read_bytes()
        self.assertIn("[UNK_BYTE_0xe29681".encode("utf-8"), readable)
        self.assertIn(b"\xe2\x96\x81", readable, "▁ must be intact UTF-8 (e2 96 81)")
        self.assertEqual(readable, stdout.strip())
        self.assertNotIn(b"\xef\xbf\xbd", readable, "nothing here needed replacing")

        # 2. the raw stream is the child's bytes, unmodified
        self.assertEqual(rig.artifact("stdout.raw").read_bytes(), stdout)
        self.assertEqual(rig.artifact("stderr.raw").read_bytes(),
                         b"llama_model_loader: loaded\n")

        # 3. what the user saw was a *reading* artifact, not the file's content.
        #    Read the very same bytes in a Windows-1252 code page and the ▁
        #    (e2 96 81) becomes "â" + "–": that is the "â–" in the report, and it
        #    is a property of the reader, not of the run.
        #    0x81 has no cp1252 mapping at all, which is why three bytes appear
        #    as the two visible characters "â–" in a cp1252 view.
        misread = readable.decode("cp1252", errors="replace")
        self.assertIn("\u00e2", misread)
        self.assertIn("\u2013", misread)
        self.assertNotIn("\u2581", misread)
        self.assertIn("This", misread, "the readable text is the same either way")
        with self.assertRaises(UnicodeDecodeError):
            readable.decode("cp1252")       # strict: the byte is simply undefined

    def test_report_accounts_for_the_markers_without_claiming_success(self):
        rig = self._rig(stdout=INCIDENT_TEXT.encode("utf-8"), stderr=b"log\n")
        rig.run()
        report = rig.report()

        integrity = report["output_integrity"]
        self.assertEqual(integrity["count"], 1)
        self.assertEqual(integrity["codes"], ["e29681"])
        self.assertEqual(integrity["codepoints"], ["U+2581"])
        self.assertEqual(integrity["unresolved_codes"], [])
        self.assertIs(integrity["markers_preserved"], True)
        self.assertIs(integrity["decoding_clean"], False)
        self.assertIn("OUTPUT_DECODING.md", integrity["explanation"])

        capture = report["capture"]
        self.assertEqual(capture["encoding"], "utf-8")
        self.assertEqual(capture["stdout_bytes"], len(INCIDENT_TEXT.encode("utf-8")))
        self.assertEqual(capture["stdout_sha256"],
                         hashlib.sha256(INCIDENT_TEXT.encode("utf-8")).hexdigest())
        self.assertEqual(capture["stdout_decode_replacements"], 0)
        self.assertEqual(capture["stderr_decode_replacements"], 0)
        self.assertIs(capture["ansi_stripped_from_readable_text"], True)
        self.assertTrue(Path(capture["raw_stdout_path"]).is_file())
        self.assertTrue(Path(capture["raw_stderr_path"]).is_file())

    def test_console_says_the_text_is_not_the_models_raw_output(self):
        rig = self._rig(stdout=INCIDENT_TEXT.encode("utf-8"), stderr=b"log\n")
        result = rig.run()
        self.assertIn("[UNK_BYTE_...] marker(s)", result.stdout)
        self.assertIn("NOT the model's raw output", result.stdout)
        self.assertIn("OUTPUT_DECODING.md", result.stdout)

    def test_clean_utf8_output_is_reported_clean(self):
        payload = "No markers here: ▁ panorex, العربية, 🦷 — all valid UTF-8.\n"
        rig = self._rig(stdout=payload.encode("utf-8"), stderr=b"log\n")
        rig.run()
        report = rig.report()

        self.assertIs(report["output_integrity"]["decoding_clean"], True)
        self.assertEqual(report["output_integrity"]["count"], 0)
        self.assertEqual(report["capture"]["stdout_decode_replacements"], 0)
        self.assertEqual(rig.artifact("response.txt").read_bytes(),
                         payload.strip().encode("utf-8"))
        self.assertEqual(rig.artifact("stdout.raw").read_bytes(),
                         payload.encode("utf-8"))

    def test_invalid_bytes_are_counted_and_the_bytes_are_kept(self):
        payload = b"before \xff\xfe after\n"
        rig = self._rig(stdout=payload, stderr=b"log\n")
        rig.run()
        report = rig.report()

        self.assertEqual(report["capture"]["stdout_decode_replacements"], 2)
        sequences = report["capture"]["invalid_utf8_sequences"]
        self.assertEqual([s["bytes"] for s in sequences], ["ff", "fe"])
        self.assertIs(report["output_integrity"]["decoding_clean"], False)
        # readable file: the substitution is visible and does not eat the text
        self.assertIn("\ufffd", rig.artifact("response.txt").read_text(encoding="utf-8"))
        self.assertIn("before", rig.artifact("response.txt").read_text(encoding="utf-8"))
        # raw file: the offending bytes are still there, exactly
        self.assertEqual(rig.artifact("stdout.raw").read_bytes(), payload)

    def test_ansi_escapes_are_stripped_from_the_readable_file_only(self):
        payload = b"\x1b[1mbold\x1b[0m This is a test\n"
        rig = self._rig(stdout=payload, stderr=b"log\n")
        rig.run()
        readable = rig.artifact("response.txt").read_bytes()
        self.assertNotIn(b"\x1b[", readable)
        self.assertTrue(readable.startswith(b"bold This is a test"))
        self.assertEqual(rig.artifact("stdout.raw").read_bytes(), payload)

    def test_stderr_stays_readable_and_complete(self):
        stderr = (b"llama_model_loader: - kv  12: tokenizer.ggml.model str = gpt2\n"
                  b"llama_model_loader: - kv  13: tokenizer.ggml.pre   str = gemma3\n"
                  b"llama_perf_context_print: total time = 42686.20 ms\n")
        rig = self._rig(stdout=INCIDENT_TEXT.encode("utf-8"), stderr=stderr)
        rig.run()
        log = rig.artifact("llama.log").read_text(encoding="utf-8")
        self.assertIn("tokenizer.ggml.model str = gpt2", log)
        self.assertIn("tokenizer.ggml.pre", log)
        self.assertIn("total time = 42686.20 ms", log)
        self.assertEqual(rig.artifact("stderr.raw").read_bytes(), stderr)

    def test_timeout_still_kills_and_reports(self):
        rig = self._rig(stdout=b"never\n", stderr=b"log\n", sleep=60)
        result = rig.run(timeout=2)
        report = rig.report()
        self.assertEqual(result.returncode, 6)
        self.assertEqual(report["status"], "FAILED")
        self.assertIs(report["timed_out"], True)
        self.assertIs(report["inference_success"], False)

    def test_nonzero_exit_is_still_failed(self):
        rig = self._rig(stdout=b"partial text\n", stderr=b"boom\n", exit_code=3)
        result = rig.run()
        report = rig.report()
        self.assertEqual(result.returncode, 6)
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["exit_code"], 3)

    def test_exit_zero_with_empty_stdout_is_still_failed(self):
        rig = self._rig(stdout=b"", stderr=b"nothing produced\n")
        result = rig.run()
        report = rig.report()
        self.assertEqual(result.returncode, 6)
        self.assertEqual(report["status"], "FAILED")
        self.assertIs(report["inference_success"], False)

    def test_missing_artifacts_still_block(self):
        rig = self._rig(stdout=INCIDENT_TEXT.encode("utf-8"))
        rig.main_gguf.unlink()
        result = rig.run()
        self.assertEqual(result.returncode, 3)
        report = rig.report()
        self.assertEqual(report["status"], "BLOCKED")
        # the new blocks exist in every report; a blocked run simply has nothing
        # to put in them
        self.assertIsNone(report["capture"])
        self.assertIsNone(report["output_integrity"])

    def test_dry_run_touches_nothing(self):
        rig = self._rig(stdout=INCIDENT_TEXT.encode("utf-8"))
        result = rig.run(extra=["--dry-run"])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(rig.report()["status"], "UNKNOWN")
        self.assertFalse(rig.artifact("stdout.raw").exists(),
                         "a dry run must not create run artifacts")


@unittest.skipIf(os.name == "nt",
                 "an executable script is not a runnable runtime on Windows; the "
                 "policy itself is covered platform-independently in "
                 "test_execution_policy.py")
class TestCpuOnlyExecutionEndToEnd(unittest.TestCase):
    """The whole CPU-first path: argv → run → report → what the runtime said.

    The runtime is the synthetic one from this file, so what is being tested is
    the lab's own plumbing — that the CPU-only pins reach the child's argv, that
    the decoding workaround is applied and recorded, that the artifacts are
    untouched, and that the report repeats only what the child's log actually
    said about the device.
    """

    # llama.cpp's own wording, from b11026: the loader prints the projector's
    # backend, and a GPU-enabled build always reports the layer count (0 when
    # nothing was offloaded). ggml_vulkan lines appear in an enumeration too.
    CPU_LOG = (
        "ggml_vulkan: Found 1 Vulkan devices:\n"
        "ggml_vulkan: 0 = Intel(R) Iris(R) Xe Graphics (Intel Corporation)\n"
        "llama_model_loader: - kv  12: tokenizer.ggml.model str = gpt2\n"
        "load_tensors: offloading 0 repeating layers to GPU\n"
        "load_tensors: offloaded 0/35 layers to GPU\n"
        "clip_ctx: CLIP using CPU backend\n"
        "llama_perf_context_print: total time = 38687.20 ms\n"
    )
    GPU_LOG = (
        "llama_model_load: using device Vulkan0 (Intel(R) Iris(R) Xe Graphics) - 4096 MiB free\n"
        "load_tensors: offloading 34 repeating layers to GPU\n"
        "load_tensors: offloaded 35/35 layers to GPU\n"
        "clip_ctx: CLIP using Vulkan0 backend\n"
    )
    LOST_LOG = (
        "ggml_vulkan: device lost on Vulkan0\n"
        "clip_ctx: CLIP using Vulkan0 backend\n"
        "mtmd_batch_encode: error\n"
        "Failed to encode mtmd batch, res = -1\n"
    )
    ANSWER = "This is a panoramic dental radiograph. No obvious abnormality is visible.\n"

    def _rig(self, **kwargs) -> CaptureRig:
        rig = CaptureRig(**kwargs)
        self.addCleanup(rig.cleanup)
        return rig

    def test_a_real_cpu_run_reports_every_field_the_handoff_needs(self):
        """The report a real run must produce, exercised end to end."""
        # `sleep`: the sampler has to catch a live child for the memory probe to
        # have anything to read, and a 40 ms script can be gone before the first
        # sample. Real inferences take minutes; this makes the rig representative.
        rig = self._rig(stdout=self.ANSWER.encode("utf-8"),
                        stderr=self.CPU_LOG.encode("utf-8"), sleep=0.3)
        result = rig.run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = rig.report()

        # the ten values the handoff records
        self.assertEqual(report["status"], "OPERATIONAL")
        self.assertIs(report["inference_success"], True)
        self.assertEqual(report["exit_code"], 0)
        self.assertIsInstance(report["inference_seconds"], float)
        self.assertGreater(report["peak_rss_bytes"], 0, "the memory probe must have read")
        self.assertIsNotNone(report["memory_probe"])
        self.assertIsNotNone(report["cpu_seconds"])
        self.assertEqual(report["main_sha256"], rig.sha256(rig.main_gguf))
        self.assertEqual(report["mmproj_sha256"], rig.sha256(rig.mmproj_gguf))
        self.assertEqual(report["output_path"], str(rig.artifact("response.txt")))
        self.assertEqual(report["output_chars"], len(self.ANSWER.strip()))

        # the command, verbatim, with the pins and the workaround in it
        cmd = report["command"]
        self.assertEqual(cmd[cmd.index("-ngl") + 1], "0")
        self.assertEqual(cmd[cmd.index("-dev") + 1], "none")
        self.assertIn("--no-mmproj-offload", cmd)
        self.assertIn("tokenizer.ggml.pre=str:gemma4", cmd)
        self.assertEqual(report["execution"]["workarounds"],
                         ["CPU-only execution (-ngl 0, -dev none, --no-mmproj-offload): "
                          "no GPU layer is offloaded and no GPU device is selected",
                          "tokenizer pre-tokenizer override in memory "
                          "(--override-kv tokenizer.ggml.pre=str:gemma4): the GGUF on "
                          "disk is not modified"])

        # the runtime's own account of the device, recorded next to the request
        evidence = report["execution"]["device_evidence"]
        self.assertEqual(evidence["verdict"], "cpu-only-confirmed-by-log")
        self.assertEqual(evidence["clip_backend"], "CPU")
        self.assertEqual(evidence["layers_offloaded"], "0/35")
        self.assertIs(evidence["gpu_offload_observed"], False)
        self.assertEqual(evidence["devices_used"], [])
        self.assertGreater(evidence["vulkan_mentions"], 0,
                           "enumeration appears in the log even for a CPU-only run")

        # and the scope statement, which must never claim clinical validation
        self.assertIs(report["validation_scope"]["functional_inference"], True)
        self.assertIs(report["validation_scope"]["clinical_validation"], False)
        # the banner wraps, so match the two phrases rather than the sentence
        banner = " ".join(result.stdout.split("SUCCESS")[-1].split())
        self.assertIn("Functional inference only", banner)
        self.assertIn("validated diagnosis", banner)

    def test_a_run_never_modifies_the_artifacts(self):
        rig = self._rig(stdout=self.ANSWER.encode("utf-8"),
                        stderr=self.CPU_LOG.encode("utf-8"))
        before = {path: hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in (rig.main_gguf, rig.mmproj_gguf)}
        rig.run()
        after = {path: hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in (rig.main_gguf, rig.mmproj_gguf)}
        self.assertEqual(before, after, "a run must not touch the weights it runs")
        report = rig.report()
        self.assertEqual(report["main_sha256"], before[rig.main_gguf])
        self.assertEqual(report["mmproj_sha256"], before[rig.mmproj_gguf])

    def test_the_workaround_can_be_switched_off_for_a_run(self):
        rig = self._rig(stdout=self.ANSWER.encode("utf-8"),
                        stderr=self.CPU_LOG.encode("utf-8"))
        result = rig.run(extra=["--no-tokenizer-pre-override"])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = rig.report()
        self.assertIsNone(report["execution"]["tokenizer_pre_override"])
        self.assertNotIn("--override-kv", report["command"])
        self.assertNotIn("tokenizer pre-tokenizer override",
                         " ".join(report["execution"]["workarounds"]))
        self.assertIn("disabled", report["execution"]["tokenizer_pre_override_source"])

    def test_gpu_work_while_cpu_only_was_requested_is_a_warning(self):
        """The protection against "accidental Vulkan" that must not be silent."""
        rig = self._rig(stdout=self.ANSWER.encode("utf-8"),
                        stderr=self.GPU_LOG.encode("utf-8"))
        result = rig.run()
        report = rig.report()

        evidence = report["execution"]["device_evidence"]
        self.assertEqual(evidence["verdict"], "gpu-work-observed")
        self.assertIs(evidence["gpu_offload_observed"], True)
        self.assertEqual(evidence["layers_offloaded"], "35/35")
        self.assertTrue(report["execution"]["notes"],
                        "a GPU observed while CPU-only was requested must be recorded")
        self.assertIn("not the validated CPU path",
                      " ".join(report["execution"]["notes"]))
        self.assertIn("[WARN]", result.stdout)
        self.assertNotIn("on the CPU", result.stdout.split("SUCCESS")[-1].split("=")[0],
                         "the banner must not claim the CPU when the log shows a GPU")

    def test_a_vulkan_device_loss_is_reported_with_its_cause(self):
        rig = self._rig(stdout=b"", stderr=self.LOST_LOG.encode("utf-8"), exit_code=1)
        result = rig.run()
        report = rig.report()

        self.assertEqual(result.returncode, 6)
        self.assertEqual(report["status"], "FAILED")
        self.assertIs(report["inference_success"], False)
        evidence = report["execution"]["device_evidence"]
        self.assertIs(evidence["device_lost"], True)
        self.assertIs(evidence["mtmd_encode_failure"], True)
        causes = [note for note in report["notes"] if "device lost" in note]
        self.assertTrue(causes, report["notes"])
        self.assertTrue(any("mtmd_batch_encode" in note for note in report["notes"]))
        self.assertIn("[cause]", result.stdout)
        # the raw log is kept: the evidence of the failure is not cleaned away
        self.assertIn(b"device lost", rig.artifact("stderr.raw").read_bytes())


class TestDecodeStream(unittest.TestCase):
    """The decode helper, without a subprocess."""

    def test_valid_utf8_round_trips(self):
        text = "▁ العربية 🦷 ASCII"
        audit = runner.decode_stream(text.encode("utf-8"), "stdout")
        self.assertEqual(audit["text"], text)
        self.assertEqual(audit["decode_replacements"], 0)
        self.assertEqual(audit["bytes"], len(text.encode("utf-8")))
        self.assertEqual(audit["sha256"],
                         hashlib.sha256(text.encode("utf-8")).hexdigest())

    def test_invalid_utf8_is_counted_with_offsets(self):
        audit = runner.decode_stream(b"a\xffb\xe2\x96", "stdout")
        self.assertEqual(audit["decode_replacements"], 2)
        self.assertEqual([s["bytes"] for s in audit["invalid_sequences"]],
                         ["ff", "e296"])
        self.assertEqual([s["start"] for s in audit["invalid_sequences"]], [1, 3])
        self.assertIn("\ufffd", audit["text"])

    def test_none_and_empty_are_handled(self):
        for value in (None, b""):
            audit = runner.decode_stream(value, "stdout")
            self.assertEqual(audit["text"], "")
            self.assertEqual(audit["bytes"], 0)

    def test_the_byte_count_is_of_bytes_not_characters(self):
        arabic = "نص عربي"
        audit = runner.decode_stream(arabic.encode("utf-8"), "stdout")
        self.assertEqual(audit["bytes"], len(arabic.encode("utf-8")))
        self.assertGreater(audit["bytes"], len(arabic))


class TestUnkByteAudit(unittest.TestCase):
    """The marker audit: it must count, name, and never touch."""

    def test_the_incident_marker_is_identified_exactly(self):
        result = runner.audit_unk_bytes(INCIDENT_TEXT)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["codes"], ["e29681"])
        self.assertEqual(result["codepoints"], ["U+2581"])
        self.assertIs(result["markers_preserved"], True)

    def test_several_markers_are_all_counted(self):
        text = ("a[UNK_BYTE_0xe29681x] b[UNK_BYTE_0xe29681y] "
                "c[UNK_BYTE_0xf09f9880z]")
        result = runner.audit_unk_bytes(text)
        self.assertEqual(result["count"], 3)
        self.assertEqual(result["codes"], ["e29681", "f09f9880"])
        self.assertEqual(result["codepoints"], ["U+2581", "U+1F600"])

    def test_clean_text_reports_zero_and_no_explanation(self):
        result = runner.audit_unk_bytes("nothing to see here")
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["codes"], [])
        self.assertIsNone(result["explanation"])

    def test_a_truncated_hex_run_is_flagged_not_guessed(self):
        # 0xE2 promises a three-byte sequence but only one byte of hex follows:
        # report the byte, resolve nothing.
        result = runner.audit_unk_bytes("[UNK_BYTE_0xe2x]")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["codes"], [])
        self.assertEqual(result["unresolved_codes"], ["e2"])

    def test_an_ambiguous_run_is_resolved_by_the_lead_byte(self):
        # The piece text here starts with hex digits, so the raw hex run is
        # "e29681abc123". The lead byte (0xE2) says three bytes, which is the
        # correct reading — the tokenizer's marker, not a longer codepoint.
        result = runner.audit_unk_bytes("[UNK_BYTE_0xe29681abc123]")
        self.assertEqual(result["codes"], ["e29681"])
        self.assertEqual(result["codepoints"], ["U+2581"])
        self.assertEqual(result["unresolved_codes"], [])

    def test_a_four_byte_codepoint_marker_resolves(self):
        result = runner.audit_unk_bytes("[UNK_BYTE_0xf09f9880z]")
        self.assertEqual(result["codes"], ["f09f9880"])
        self.assertEqual(result["codepoints"], ["U+1F600"])

    def test_the_function_does_not_modify_the_text(self):
        text = INCIDENT_TEXT
        before = text
        runner.audit_unk_bytes(text)
        self.assertEqual(text, before, "the audit must not rewrite the text")

    def test_no_code_in_the_lab_removes_the_markers(self):
        """A text-cleanup 'fix' would hide the defect. There must be none."""
        for path in sorted(SCRIPTS.glob("*.py")):
            text = path.read_text(encoding="utf-8")
            for pattern in ('replace("[UNK_BYTE', "replace('[UNK_BYTE",
                            "sub(r\"\\[UNK_BYTE", "re.sub", "UNK_BYTE"):
                if pattern != "UNK_BYTE":
                    self.assertNotIn(pattern, text,
                                     f"{path.name} appears to rewrite markers")
            # the marker may be *matched* (the audit regex) but never rewritten
            for line in text.splitlines():
                if "UNK_BYTE" in line and ("replace" in line or ".sub(" in line):
                    self.assertIn("re.compile", line,
                                  f"{path.name} rewrites markers instead of counting them: {line.strip()}")


class TestRuntimeMarkerProvenance(unittest.TestCase):
    """The lab's own record of where the marker comes from, kept checkable."""

    def test_the_documented_hex_matches_the_incident(self):
        gguf = _load("dg_capture_gguf", "gguf.py")
        self.assertEqual(gguf.SPACE_MARKER_UTF8_HEX, "e29681")
        self.assertEqual(gguf.SPACE_MARKER, "\u2581")
        self.assertEqual(gguf.SPACE_MARKER.encode("utf-8").hex(), "e29681")

    def test_the_prediction_flags_the_gpt2_path_and_not_the_spm_path(self):
        gguf = _load("dg_capture_gguf2", "gguf.py")
        risky = gguf.tokenizer_decode_risk("gpt2", "gemma3")
        safe = gguf.tokenizer_decode_risk("gpt2", "gemma4")
        spm = gguf.tokenizer_decode_risk("llama", None)
        self.assertEqual(risky["risk"], "unk-byte-markers-possible")
        self.assertIs(risky["escape_whitespaces"], False)
        self.assertEqual(safe["risk"], "none")
        self.assertIs(safe["escape_whitespaces"], True)
        self.assertEqual(spm["risk"], "none")
        self.assertIn("llama-vocab.cpp", risky["basis"])

    def test_the_prediction_is_marked_as_a_reading_not_a_measurement(self):
        gguf = _load("dg_capture_gguf3", "gguf.py")
        note = gguf.tokenizer_decode_risk("gpt2", "default")["note"]
        self.assertIn("OUTPUT_DECODING.md", note)


if __name__ == "__main__":
    unittest.main(verbosity=2)

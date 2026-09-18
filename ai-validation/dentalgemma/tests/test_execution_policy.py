#!/usr/bin/env python3
"""
test_execution_policy.py — CPU-only mode, the decoding workaround, and what the
runtime's own log is allowed to prove.

Two operational facts about this lab are easy to get wrong in a way that nobody
notices, and both are pinned here:

  1. **llama.cpp does not default to the CPU.** `-ngl` defaults to *auto* and the
     projector goes to the first GPU backend that answers. On the operator's
     machine that means the Intel iGPU through the Vulkan backend, which lost the
     device while encoding the image (`ggml_vulkan: device lost`) and killed the
     process with `0xC0000409`. A run that "looks CPU-only" is therefore not good
     enough: the command has to pin it (`-ngl 0`, `-dev none`,
     `--no-mmproj-offload`), a GPU request has to be an explicit act that is
     *recorded*, and the report has to say what the runtime's own log said.

  2. **The decoding workaround is a runtime setting, not a repair.** The pinned
     GGUF's metadata puts llama.cpp on its GPT-2 byte-level detokenizer, which
     cannot represent ▁ and writes `[UNK_BYTE_0x...]` into the text;
     `--override-kv tokenizer.ggml.pre=str:gemma4` selects the SPM-style path
     instead, in memory, without touching the file. It is a documented default
     with an off-switch, and every report states which of the two happened.

The tests below need no model, no GPU, no runtime and no network: the policy is a
pure function of the parsed arguments, and the evidence reader is a pure function
of captured text. The end-to-end version of the same checks, driving a synthetic
runtime, lives in `test_output_capture.py`.

Usage:
    python -m unittest discover -s tests -v
    python tests/test_execution_policy.py
"""

from __future__ import annotations

import ast
import importlib.util
import sys
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


runner = _load("dg_policy_runner", "run_dentalgemma.py")
artifacts = _load("dg_policy_artifacts", "artifacts.py")

# The published identities, restated here on purpose: if one of these lines has to
# change, that is a deliberate act with a commit behind it, not a side effect.
PUBLISHED = {
    "main": ("dentalgemma-4b-Q4_K_M.gguf", 2_875_676_064,
             "311ea621a01960e2b4b908adbe8a0b5312201bd0025c92e387150acb3a321c03"),
    "mmproj": ("dentalgemma-mmproj-f16.gguf", 851_251_232,
               "3d03262e058316c318c6dd4868c11fdccef68ec4af6d2ebea54bd1865b8c8113"),
}
PUBLISHED_REVISION = "81e65fb2a242aebadaeb78900d79aa5af1fd5ce7"

BINARY = Path("llama-mtmd-cli")
MAIN = Path("model") / PUBLISHED["main"][0]
MMPROJ = Path("model") / PUBLISHED["mmproj"][0]
IMAGE = Path("input") / "panoramic.png"


def make_args(**overrides):
    """The parsed-argument namespace the runner builds, without running argparse."""
    base = {
        "prompt": "describe this radiograph",
        "ctx": 4096, "predict": 128, "temp": 0.1, "seed": 42, "threads": 0,
        "ngl": None, "device": None, "cpu_only": True, "mmproj_offload": None,
        "tokenizer_pre": runner.DEFAULT_TOKENIZER_PRE, "extra": None,
    }
    base.update(overrides)
    return type("Args", (), base)


def build(**overrides):
    """(policy, command) exactly as the runner would produce them."""
    args = make_args(**overrides)
    policy = runner.resolve_execution_policy(args)
    return policy, runner.build_command(BINARY, MAIN, MMPROJ, IMAGE, args, policy=policy)


def value_of(cmd: list[str], flag: str):
    """The value after a flag, or None when the flag is absent."""
    if flag not in cmd:
        return None
    index = cmd.index(flag)
    return cmd[index + 1] if index + 1 < len(cmd) else ""


class TestCpuOnlyIsTheDefault(unittest.TestCase):
    """The validated path must be the one you get by asking for nothing."""

    def test_cpu_only_is_the_default(self):
        policy, _ = build()
        self.assertIs(policy["cpu_only"], True)
        self.assertEqual(policy["ngl"], 0)
        self.assertEqual(policy["device"], "none")
        self.assertIs(policy["mmproj_offload"], False)
        self.assertEqual(policy["gpu_requested_by"], [],
                         "nothing on the command line asked for a GPU")

    def test_the_default_command_pins_the_cpu(self):
        _, cmd = build()
        self.assertEqual(value_of(cmd, "-ngl"), "0",
                         "llama.cpp's default for -ngl is auto, not 0")
        self.assertEqual(value_of(cmd, "-dev"), "none")
        self.assertIn("--no-mmproj-offload", cmd)

    def test_the_cpu_only_command_cannot_select_a_gpu_device(self):
        _, cmd = build()
        self.assertNotIn("--mmproj-offload", cmd)
        self.assertNotEqual(value_of(cmd, "-ngl"), "auto")
        self.assertNotIn("-ngl", [part for part in cmd if part.startswith("auto")])
        # every -ngl/-dev value present must be the CPU-only one
        self.assertEqual([cmd[i + 1] for i, part in enumerate(cmd) if part == "-ngl"], ["0"])
        self.assertEqual([cmd[i + 1] for i, part in enumerate(cmd) if part == "-dev"], ["none"])

    def test_the_policy_is_recorded_not_implied(self):
        policy, _ = build()
        joined = " ".join(policy["workarounds"])
        self.assertIn("CPU-only execution", joined)
        self.assertIn("-ngl 0", joined)
        self.assertIn("--no-mmproj-offload", joined)
        self.assertTrue(policy["reason"])


class TestGpuRequestsAreExplicitAndRecorded(unittest.TestCase):
    """A GPU request is allowed — it just cannot happen by accident or in silence."""

    def test_a_layer_request_leaves_cpu_only_and_says_so(self):
        policy, cmd = build(ngl=35)
        self.assertIs(policy["cpu_only"], False)
        self.assertEqual(value_of(cmd, "-ngl"), "35")
        self.assertNotIn("-dev", cmd, "no device gets pinned unless one was named")
        self.assertNotIn("--no-mmproj-offload", cmd)
        self.assertEqual(policy["gpu_requested_by"], ["--ngl 35"])
        self.assertIn("--ngl 35", policy["reason"])

    def test_a_device_request_leaves_cpu_only(self):
        policy, cmd = build(device="Vulkan0")
        self.assertIs(policy["cpu_only"], False)
        self.assertEqual(value_of(cmd, "-dev"), "Vulkan0")
        self.assertNotIn("--no-mmproj-offload", cmd)
        self.assertEqual(policy["gpu_requested_by"], ["--device Vulkan0"])

    def test_a_projector_offload_request_leaves_cpu_only(self):
        policy, cmd = build(mmproj_offload=True)
        self.assertIs(policy["cpu_only"], False)
        self.assertIn("--mmproj-offload", cmd)
        self.assertNotIn("--no-mmproj-offload", cmd)
        self.assertEqual(policy["gpu_requested_by"], ["--mmproj-offload"])

    def test_device_none_stays_on_the_cpu(self):
        """`-dev none` is llama.cpp's own way of saying 'no GPU device'."""
        policy, cmd = build(device="none")
        self.assertIs(policy["cpu_only"], True)
        self.assertEqual(policy["gpu_requested_by"], [])
        self.assertEqual(value_of(cmd, "-dev"), "none")

    def test_ngl_zero_stays_on_the_cpu(self):
        policy, cmd = build(ngl=0)
        self.assertIs(policy["cpu_only"], True)
        self.assertEqual(value_of(cmd, "-ngl"), "0")

    def test_no_cpu_only_pins_nothing_and_says_that_too(self):
        policy, cmd = build(cpu_only=False)
        self.assertIs(policy["cpu_only"], False)
        self.assertNotIn("-ngl", cmd)
        self.assertNotIn("-dev", cmd)
        self.assertNotIn("--no-mmproj-offload", cmd)
        self.assertNotIn("--mmproj-offload", cmd)
        self.assertIn("--no-cpu-only", policy["reason"])
        self.assertNotIn("CPU-only execution", " ".join(policy["workarounds"]),
                         "this mode is not the CPU path and must not claim its workaround")

    def test_the_command_always_carries_the_recorded_policy(self):
        """Whatever the policy says, the argv must show it — and vice versa."""
        variants = [
            {}, {"ngl": 35}, {"ngl": 0}, {"ngl": -1}, {"device": "Vulkan0"},
            {"device": "none"}, {"mmproj_offload": True}, {"mmproj_offload": False},
            {"cpu_only": False}, {"cpu_only": False, "ngl": 35},
            {"tokenizer_pre": ""}, {"threads": 8},
        ]
        for variant in variants:
            with self.subTest(**variant):
                policy, cmd = build(**variant)
                if policy["cpu_only"]:
                    self.assertEqual(value_of(cmd, "-ngl"), "0")
                    self.assertEqual(value_of(cmd, "-dev"), "none")
                    self.assertIn("--no-mmproj-offload", cmd)
                else:
                    self.assertNotEqual(value_of(cmd, "-dev"), "none",
                                        "a non-CPU run must not pass -dev none: it would "
                                        "silently cancel the GPU flags it was given")
                if policy["ngl"] is not None:
                    self.assertEqual(value_of(cmd, "-ngl"), str(policy["ngl"]))
                else:
                    self.assertNotIn("-ngl", cmd)
                if policy["device"]:
                    self.assertEqual(value_of(cmd, "-dev"), policy["device"])
                else:
                    self.assertNotIn("-dev", cmd)
                self.assertEqual("--no-mmproj-offload" in cmd, not policy["mmproj_offload"])
                override = policy["tokenizer_pre_override"]
                self.assertEqual("--override-kv" in cmd, bool(override))
                if override:
                    self.assertIn(f"tokenizer.ggml.pre=str:{override}", cmd)


class TestTokenizerWorkaround(unittest.TestCase):
    """The decoding workaround: documented, switchable, and never an edit."""

    def test_the_documented_override_is_in_the_command_verbatim(self):
        policy, cmd = build()
        self.assertIn("--override-kv", cmd)
        self.assertIn("tokenizer.ggml.pre=str:gemma4", cmd,
                      "the value the operator confirmed locally must not drift")
        self.assertEqual(policy["tokenizer_pre_override"], "gemma4")

    def test_it_is_recorded_as_a_workaround_with_its_scope(self):
        policy, _ = build()
        joined = " ".join(policy["workarounds"])
        self.assertIn("override-kv", joined)
        self.assertIn("not modified", joined,
                      "the report must say the GGUF on disk is untouched")
        self.assertIn("--tokenizer-pre", policy["tokenizer_pre_override_source"])

    def test_it_can_be_switched_off(self):
        policy, cmd = build(tokenizer_pre="")
        self.assertIsNone(policy["tokenizer_pre_override"])
        self.assertNotIn("--override-kv", cmd)
        self.assertIn("disabled", policy["tokenizer_pre_override_source"])
        self.assertNotIn("tokenizer pre-tokenizer override", " ".join(policy["workarounds"]))

    def test_another_pre_tokenizer_can_be_named(self):
        policy, cmd = build(tokenizer_pre="llama3")
        self.assertEqual(policy["tokenizer_pre_override"], "llama3")
        self.assertIn("tokenizer.ggml.pre=str:llama3", cmd)

    def test_a_passthrough_override_is_flagged_as_overridden(self):
        """llama.cpp's override table is a map: the first key wins, so --extra
        cannot change the value this lab already set. Saying nothing would let a
        passthrough flag look effective when it is not."""
        policy, cmd = build(extra=["--override-kv", "tokenizer.ggml.pre=str:llama3"])
        self.assertEqual(policy["tokenizer_pre_override"], "gemma4")
        self.assertEqual(cmd.count("--override-kv"), 2,
                         "both are in the argv; the runtime takes the first")
        self.assertTrue(any("first occurrence wins" in note for note in policy["notes"]),
                        policy["notes"])

    def test_the_override_never_changes_which_files_are_opened(self):
        """It is an in-memory setting: the argv must point at the same two files."""
        _, with_override = build()
        _, without = build(tokenizer_pre="")
        self.assertEqual(value_of(with_override, "-m"), str(MAIN))
        self.assertEqual(value_of(with_override, "-m"), value_of(without, "-m"))
        self.assertEqual(value_of(with_override, "--mmproj"),
                         value_of(without, "--mmproj"))
        self.assertEqual(value_of(with_override, "--image"), str(IMAGE))


class TestArtifactIdentityIsUntouched(unittest.TestCase):
    """Nothing in this change may reach the artifacts."""

    def test_the_pinned_identities_are_still_the_published_ones(self):
        for role, (filename, size, digest) in PUBLISHED.items():
            with self.subTest(role=role):
                self.assertEqual(artifacts.ARTIFACTS[role]["filename"], filename)
                self.assertEqual(artifacts.ARTIFACTS[role]["size_bytes"], size)
                self.assertEqual(artifacts.ARTIFACTS[role]["sha256_expected"], digest)
        self.assertEqual(artifacts.GGUF_REPO["revision"], PUBLISHED_REVISION)

    def test_the_runner_writes_only_to_its_own_output(self):
        """No code path here may write to a model, a projector or an image."""
        tree = ast.parse(RUNNER.read_text(encoding="utf-8"))
        allowed = {"report_path", "log_path", "text_path", "stdout_raw_path",
                   "stderr_raw_path"}
        found = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                    and node.func.attr in ("write_text", "write_bytes"):
                target = ast.unparse(node.func.value)
                found.append(target)
                self.assertIn(target, allowed,
                              f"the runner writes to {target}; the artifacts are read-only")
        self.assertGreaterEqual(len(found), 5,
                                "the scan must actually see the report and output writes")

        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "open":
                mode = None
                if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                    mode = node.args[1].value
                for keyword in node.keywords:
                    if keyword.arg == "mode" and isinstance(keyword.value, ast.Constant):
                        mode = keyword.value.value
                if mode:
                    self.assertTrue(set(mode) <= set("rb"),
                                    f"open() with mode {mode!r}: this lab only reads")


class TestRuntimeEvidenceIsNotOverclaimed(unittest.TestCase):
    """The log is allowed to prove only what it says."""

    CPU_LOG = (
        "ggml_vulkan: Found 1 Vulkan devices:\n"
        "ggml_vulkan: 0 = Intel(R) Iris(R) Xe Graphics (Intel Corporation)\n"
        "load_tensors: offloading 0 repeating layers to GPU\n"
        "load_tensors: offloaded 0/35 layers to GPU\n"
        "clip_ctx: CLIP using CPU backend\n"
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

    def test_a_cpu_only_log_confirms_cpu_only(self):
        evidence = runner.inspect_runtime_log("text\n", self.CPU_LOG)
        self.assertEqual(evidence["verdict"], "cpu-only-confirmed-by-log")
        self.assertEqual(evidence["layers_offloaded"], "0/35")
        self.assertEqual(evidence["clip_backend"], "CPU")
        self.assertIs(evidence["gpu_offload_observed"], False)
        self.assertEqual(evidence["devices_used"], [])

    def test_vulkan_mentions_alone_are_not_usage(self):
        """The loader enumerates backend DLLs at startup: that is not a submission."""
        evidence = runner.inspect_runtime_log("", self.CPU_LOG)
        self.assertGreater(evidence["vulkan_mentions"], 0)
        self.assertIs(evidence["gpu_offload_observed"], False)
        self.assertIn("not usage", evidence["vulkan_note"])

    def test_gpu_work_in_the_log_is_observed(self):
        evidence = runner.inspect_runtime_log("", self.GPU_LOG)
        self.assertEqual(evidence["verdict"], "gpu-work-observed")
        self.assertIs(evidence["gpu_offload_observed"], True)
        self.assertEqual(evidence["layers_offloaded"], "35/35")
        self.assertEqual(evidence["clip_backend"], "Vulkan0")
        self.assertTrue(any("using device" in line for line in evidence["devices_used"]))

    def test_a_silent_log_claims_nothing(self):
        evidence = runner.inspect_runtime_log("just text", "no device lines here")
        self.assertEqual(evidence["verdict"], "not-stated-in-log")
        self.assertIs(evidence["gpu_offload_observed"], False)
        self.assertIsNone(evidence["layers_offloaded"])
        self.assertIsNone(evidence["clip_backend"])

    def test_a_lost_device_is_recognised(self):
        evidence = runner.inspect_runtime_log("", self.LOST_LOG)
        self.assertIs(evidence["device_lost"], True)
        self.assertIs(evidence["mtmd_encode_failure"], True)

    def test_the_failure_note_names_the_windows_fault_code(self):
        """3221226505 is what the operator's run exited with, mid-Vulkan."""
        evidence = runner.inspect_runtime_log("", self.LOST_LOG)
        notes = " ".join(runner.describe_failure(3221226505, evidence))
        self.assertIn("0xC0000409", notes)
        self.assertIn("device lost", notes)
        self.assertIn("mtmd_batch_encode", notes)
        self.assertIn("CPU-only", notes)

    def test_a_plain_failure_is_not_blamed_on_the_gpu(self):
        evidence = runner.inspect_runtime_log("", "llama_model_load: failed to load model")
        self.assertEqual(runner.describe_failure(1, evidence), [],
                         "no GPU evidence, no GPU story")

    def test_a_build_that_rejects_the_cpu_pins_gets_a_way_forward(self):
        """`-dev none` is not in every historical build; a puzzle is not an answer."""
        policy, _ = build()
        hint = runner.cpu_pin_rejected_hint("error: invalid device: none", policy)
        self.assertTrue(hint)
        self.assertIn("--no-cpu-only --ngl 0 --no-mmproj-offload", hint[0])
        self.assertEqual(runner.cpu_pin_rejected_hint("nothing wrong here", policy), [])
        gpu_policy, _ = build(ngl=35)
        self.assertEqual(runner.cpu_pin_rejected_hint("invalid device: Vulkan0", gpu_policy), [],
                         "a GPU run is not the CPU-only path and gets no CPU hint")


class TestTheWorkaroundIsDocumented(unittest.TestCase):
    """A default nobody can read about is superstition; a document nobody can act
    on is decoration. Both the switches and the reasoning have to be findable."""

    def test_the_runner_explains_both_defaults(self):
        text = RUNNER.read_text(encoding="utf-8")
        self.assertIn("CPU-only is the default", text)
        self.assertIn("One decoding override is applied by default", text)
        self.assertIn("device lost", text)

    def test_the_flags_are_documented_where_the_user_runs_them(self):
        doc = (LAB / "LOCAL_EXECUTION.md").read_text(encoding="utf-8")
        for flag in ("--cpu-only", "--no-cpu-only", "--device", "--tokenizer-pre",
                     "--no-tokenizer-pre-override"):
            self.assertIn(flag, doc, f"LOCAL_EXECUTION.md must document {flag}")
        self.assertIn("-ngl 0", doc)
        self.assertIn("--no-mmproj-offload", doc)


if __name__ == "__main__":
    unittest.main(verbosity=2)

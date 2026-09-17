#!/usr/bin/env python3
"""
test_static.py — checks that can be made without a model, a GPU or a network.

These are the checks this lab can honestly perform in an environment where the
3.47 GiB of weights do not exist and no inference is possible:

  1. every script is syntactically valid and importable;
  2. the committed report template is `UNKNOWN` and its nulls are null — i.e.
     nothing in the repository claims a run that has not happened;
  3. the schema and the template agree on the status vocabulary, and OPERATIONAL
     is not reachable without a real run;
  4. the expected artifact identities match the publisher's recorded values, and
     no hash is a placeholder;
  5. the lab ships no model weights and no images;
  6. `.gitignore` really excludes weights and images;
  7. the scripts are CPU-only in their language and touch no ERP path.

Nothing here validates a model. It validates that this lab tells the truth about
the state it is in.

Usage:
    python -m unittest discover -s tests -v
    python tests/test_static.py
"""

from __future__ import annotations

import ast
import importlib.util
import io
import json
import re
import subprocess
import sys
import tokenize
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPTS = LAB / "scripts"
REPO = LAB.parent.parent


def _load(name: str, filename: str):
    path = SCRIPTS / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


artifacts = _load("dg_artifacts_static", "artifacts.py")


class TestScriptsAreValid(unittest.TestCase):
    def test_all_scripts_parse(self):
        for path in sorted(SCRIPTS.glob("*.py")):
            with self.subTest(script=path.name):
                ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    def test_all_scripts_import_without_side_effects(self):
        """Importing a script must not need a model, a GPU or the network."""
        for path in sorted(SCRIPTS.glob("*.py")):
            with self.subTest(script=path.name):
                spec = importlib.util.spec_from_file_location(
                    f"static_import_{path.stem}", path)
                module = importlib.util.module_from_spec(spec)
                sys.modules[spec.name] = module
                spec.loader.exec_module(module)          # must not raise

    def test_no_module_level_downloads_or_execution(self):
        """Nothing may download or run a process just by being imported."""
        forbidden_calls = {"urlopen", "download", "Popen", "run", "system",
                           "check_output", "call"}
        for path in sorted(SCRIPTS.glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in tree.body:                      # module level only
                if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
                    func = node.value.func
                    name = getattr(func, "attr", getattr(func, "id", ""))
                    self.assertNotIn(
                        name, forbidden_calls,
                        f"{path.name} calls {name}() at import time")


class TestNoModelOrImageIsCommitted(unittest.TestCase):
    def test_no_weight_files_in_lab(self):
        patterns = ("*.gguf", "*.safetensors", "*.bin", "*.pt", "*.pth", "*.ckpt")
        found = [str(p) for pattern in patterns for p in LAB.rglob(pattern)]
        self.assertEqual(found, [], f"model weights must not be committed: {found}")

    def test_no_images_in_lab(self):
        patterns = ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.tif", "*.tiff", "*.dcm")
        found = [str(p) for pattern in patterns for p in LAB.rglob(pattern)]
        self.assertEqual(found, [], f"images must not be committed: {found}")

    def test_gitignore_excludes_weights_and_images(self):
        text = (LAB / ".gitignore").read_text(encoding="utf-8")
        for pattern in ("*.gguf", "*.safetensors", "input/**/*.png", "input/**/*.jpg"):
            self.assertIn(pattern, text,
                          f".gitignore must exclude {pattern} so patient data and "
                          f"weights cannot be committed by accident")

    def test_no_file_larger_than_a_few_hundred_kilobytes(self):
        big = [str(p.relative_to(LAB)) for p in LAB.rglob("*")
               if p.is_file() and p.stat().st_size > 400_000]
        self.assertEqual(big, [], f"unexpectedly large files in the lab: {big}")


class TestReportTemplateIsHonest(unittest.TestCase):
    def setUp(self):
        self.template = json.loads(
            (LAB / "reports" / "run_report.template.json").read_text(encoding="utf-8"))
        self.schema = json.loads(
            (LAB / "report.schema.json").read_text(encoding="utf-8"))

    def test_status_is_unknown(self):
        self.assertEqual(self.template["status"], "UNKNOWN",
                         "the committed template must not claim a run")

    def test_measured_fields_are_null(self):
        # `cuda` belongs in this list for the same reason as the others: it is a
        # fact about a machine, and no machine has been measured. A `false` there
        # would read as "verified absent" rather than "not yet known".
        for field in ("main_size_bytes", "mmproj_size_bytes", "main_sha256",
                      "mmproj_sha256", "runtime", "cpu", "ram_gb", "cuda", "input",
                      "inference_seconds", "peak_ram_gb", "output_path"):
            with self.subTest(field=field):
                self.assertIsNone(self.template[field],
                                  f"{field} must be null: there is no measurement behind it")

    def test_success_flag_is_false(self):
        """False, not null: the field is a boolean and no success has occurred."""
        self.assertIs(self.template["inference_success"], False)

    def test_required_schema_fields_are_all_present_in_the_template(self):
        for field in self.schema["required"]:
            self.assertIn(field, self.template, f"template is missing required field {field}")

    def test_status_enum_matches_the_lab_vocabulary(self):
        enum = self.schema["properties"]["status"]["enum"]
        self.assertEqual(tuple(enum), artifacts.ALLOWED_STATUSES)

    def test_operational_is_documented_as_requiring_a_real_run(self):
        description = self.schema["properties"]["status"]["description"]
        self.assertIn("OPERATIONAL", description)
        self.assertIn("non-empty", description)
        self.assertIn("UNKNOWN", description)


class TestArtifactIdentities(unittest.TestCase):
    def test_filenames_are_exact(self):
        self.assertEqual(sorted(artifacts.ARTIFACTS),
                         ["main", "mmproj"], "both files are required, by publisher statement")
        self.assertEqual(artifacts.ARTIFACTS["main"]["filename"],
                         "dentalgemma-4b-Q4_K_M.gguf")
        self.assertEqual(artifacts.ARTIFACTS["mmproj"]["filename"],
                         "dentalgemma-mmproj-f16.gguf")

    def test_sizes_match_the_published_values(self):
        self.assertEqual(artifacts.ARTIFACTS["main"]["size_bytes"], 2_875_676_064)
        self.assertEqual(artifacts.ARTIFACTS["mmproj"]["size_bytes"], 851_251_232)
        self.assertEqual(artifacts.TOTAL_BYTES, 3_726_927_296)

    def test_hashes_are_real_64_hex_digests_not_placeholders(self):
        placeholders = {"0" * 64, "f" * 64, "TODO", "", None}
        for role, spec in artifacts.ARTIFACTS.items():
            with self.subTest(role=role):
                digest = spec["sha256_expected"]
                self.assertRegex(digest, r"^[0-9a-f]{64}$")
                self.assertNotIn(digest, placeholders)
                self.assertIn("Hugging Face", spec["sha256_origin"],
                              "the origin of an expected digest must be named")

    def test_revision_is_pinned_not_a_branch(self):
        revision = artifacts.GGUF_REPO["revision"]
        self.assertRegex(revision, r"^[0-9a-f]{40}$",
                         "the download must be pinned to a commit, not to 'main'")
        for role in artifacts.ARTIFACTS:
            self.assertIn(revision, artifacts.source_url(role))

    def test_gated_status_is_recorded(self):
        self.assertIs(artifacts.GGUF_REPO["gated"], False)
        self.assertEqual(artifacts.BASE_REPO["gated"], "auto")
        self.assertEqual(artifacts.BASE_REPO["license_name"],
                         "health-ai-developer-foundations")


class TestCpuOnlyAndIsolation(unittest.TestCase):
    def test_no_cuda_device_selection_anywhere(self):
        for path in sorted(SCRIPTS.glob("*.py")):
            with self.subTest(script=path.name):
                tree = ast.parse(path.read_text(encoding="utf-8"))
                for node in ast.walk(tree):
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                        self.assertNotEqual(node.func.attr, "set_device",
                                            "this lab never selects a GPU")

    def test_no_unix_only_imports(self):
        """The lab has to run on the target Windows machine."""
        banned = {"resource", "fcntl", "pwd", "grp", "termios", "posix", "pty"}
        for path in sorted(SCRIPTS.glob("*.py")):
            with self.subTest(script=path.name):
                tree = ast.parse(path.read_text(encoding="utf-8"))
                for node in tree.body:
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            self.assertNotIn(alias.name, banned,
                                             f"{path.name} imports Unix-only {alias.name}")
                    elif isinstance(node, ast.ImportFrom):
                        self.assertNotIn(node.module, banned,
                                         f"{path.name} imports Unix-only {node.module}")

    def test_no_erp_paths_referenced(self):
        """The lab must not reach into the application.

        The pattern anchors at a path boundary that is not itself a separator, so
        that a system path such as ``/usr/lib/x86_64-linux-gnu/libcuda.so`` is not
        mistaken for the repository's ``lib/`` directory — an earlier, looser
        version of this check failed on exactly that false positive.
        """
        banned = re.compile(r"(?<![/\w.\\])(app|lib|components|prisma|docker)[/\\]")
        # sanity: the real thing is still caught, the system path is not
        self.assertIsNotNone(banned.search('import { x } from "lib/storage"'))
        self.assertIsNotNone(banned.search("path = app/api/route.ts"))
        self.assertIsNone(banned.search('"/usr/lib/x86_64-linux-gnu/libcuda.so*"'))

        for path in list(SCRIPTS.glob("*.py")) + [LAB / "README.md"]:
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith(("#", "//")):
                    continue
                self.assertIsNone(
                    banned.search(line),
                    f"{path.name} references an ERP path: {line.strip()[:80]}")

    def test_no_unix_only_paths_in_code(self):
        for path in sorted(SCRIPTS.glob("*.py")):
            text = path.read_text(encoding="utf-8")
            # /proc is legitimate on POSIX but must be guarded, never assumed:
            # the guard is os.name / platform checks, which the import of /proc
            # would otherwise bypass.
            if "/proc" in text:
                self.assertIn("os.name", text,
                              f"{path.name} uses /proc without an os.name guard")

    def test_lab_is_the_only_thing_added_by_this_work(self):
        """Every file this lab owns lives under ai-validation/dentalgemma/."""
        lab = str(LAB.resolve())
        for path in LAB.rglob("*.py"):
            self.assertTrue(str(path.resolve()).startswith(lab))


class TestOutputDecodingIsDocumented(unittest.TestCase):
    """The decoding defect must be documented where it can be acted on.

    This lab cannot repair an artifact-side decoding mismatch, and it must not
    pretend to. What it can do is state the cause with its source, give the two
    local commands that confirm it, and make the difference between a runtime
    workaround and a real fix unmistakable. Each of those is asserted here,
    because a document that quietly loses one of them is how a diagnosis turns
    into a superstition.
    """

    def setUp(self):
        self.path = LAB / "OUTPUT_DECODING.md"
        self.text = self.path.read_text(encoding="utf-8")

    def test_the_document_exists_and_is_pointed_at_from_the_others(self):
        self.assertTrue(self.path.is_file())
        for doc in ("README.md", "LOCAL_EXECUTION.md", "MODEL_PROVENANCE.md"):
            self.assertIn("OUTPUT_DECODING.md",
                          (LAB / doc).read_text(encoding="utf-8"),
                          f"{doc} must point at the decoding analysis")

    def test_it_names_the_runtime_source_of_the_marker(self):
        self.assertIn("llama-vocab.cpp", self.text)
        self.assertIn("llama_decode_text", self.text)
        self.assertIn("U+2581", self.text)
        self.assertIn("e29681", self.text)

    def test_it_states_the_two_metadata_keys_that_decide_the_path(self):
        self.assertIn("tokenizer.ggml.model", self.text)
        self.assertIn("tokenizer.ggml.pre", self.text)
        self.assertIn("escape_whitespaces", self.text)

    def _plain(self) -> str:
        """The document's prose without markdown emphasis, for substring checks.

        "the markers are **not** stripped" would otherwise fail a naive search for
        "not stripped" — which is exactly what happened on the first run of these
        tests.
        """
        lowered = self.text.lower()
        return re.sub(r"[*_`]", "", lowered)

    def test_it_separates_a_runtime_workaround_from_a_fix(self):
        self.assertIn("--override-kv", self.text)
        plain = self._plain()
        self.assertIn("workaround", plain)
        self.assertIn("not a repair", plain)
        # and it must say where the real fix belongs
        self.assertIn("publisher", plain)

    def test_it_says_the_markers_are_not_removed(self):
        self.assertIn("not stripped", self._plain())

    def test_it_gives_the_code_page_check(self):
        self.assertIn("-Encoding UTF8", self.text)


class TestPythonVersionFloor(unittest.TestCase):
    """`requirements.txt` claims 3.9+, so that claim has to be checkable.

    The claim is syntax-level: these scripts are plain standard library and every
    annotation is deferred by `from __future__ import annotations`, so parsing each
    file for the target version is the meaningful test. Parsing under 3.9 catches
    a `match` statement or any other syntax newer than the floor.
    """

    def _files(self):
        return sorted(SCRIPTS.glob("*.py")) + sorted((LAB / "tests").glob("*.py"))

    @staticmethod
    def _code_text(source: str) -> str:
        """The source with comments and string literals blanked out.

        Blanking in place — rather than rebuilding from tokens — keeps the code
        characters in their original positions, so a pattern such as
        ``zip(a, b, strict=True)`` is still visible as written. An earlier version
        joined the tokens with spaces, which silently destroyed every pattern it
        was supposed to find; the negative control below exists because of that.
        """
        chars = list(source)
        line_starts = [0]
        for line in source.splitlines(keepends=True):
            line_starts.append(line_starts[-1] + len(line))

        def blank(start, end):
            for index in range(start, min(end, len(chars))):
                if chars[index] != "\n":
                    chars[index] = " "

        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type in (tokenize.COMMENT, tokenize.STRING):
                blank(line_starts[token.start[0] - 1] + token.start[1],
                      line_starts[token.end[0] - 1] + token.end[1])
        return "".join(chars)

    def test_the_scanner_itself_works(self):
        """Negative control: prove the scan flags real code and ignores prose."""
        flagged = self._code_text("x = list(zip(a, b, strict=True))")
        self.assertIn("strict=", flagged,
                      "the scanner must keep real code patterns intact")
        prose = self._code_text('"""We avoid zip(strict=...) and itertools.pairwise."""\n'
                                "y = 1  # also not used: dataclass(slots=True)")
        self.assertNotIn("strict=", prose,
                         "a mention in prose is not a use in code")
        self.assertNotIn("pairwise", prose)

    def test_every_file_parses_as_python_39(self):
        for path in self._files():
            source = path.read_text(encoding="utf-8")
            try:
                ast.parse(source, filename=str(path), feature_version=(3, 9))
            except SyntaxError as exc:
                self.fail(f"{path.name} needs a newer Python than 3.9: "
                          f"{exc.msg} (line {exc.lineno})")

    def test_no_runtime_feature_newer_than_39(self):
        banned = [("strict=", "zip(strict=...) is 3.10+"),
                  ("itertools." + "pairwise", "itertools.pairwise is 3.10+"),
                  ("dataclass(" + "slots=True", "dataclass slots are 3.10+")]
        for path in self._files():
            code = self._code_text(path.read_text(encoding="utf-8"))
            for needle, why in banned:
                self.assertNotIn(needle, code, f"{path.name}: {why}")


class TestDocumentedCommandsExist(unittest.TestCase):
    """Every command in the docs must be runnable as written.

    The whole value of these documents is that the user copies the commands to a
    Windows machine and they work — including on their first attempt, without the
    ability to ask a question halfway through. A flag that was renamed in a script
    but not in the document is therefore a real defect, not a typo: it fails at the
    far end of a 3.47 GiB download, on a machine this project cannot see. The
    parser itself is the source of truth here, so this test asks each script what
    it accepts rather than trusting a hand-maintained list.
    """

    DOCS = ["README.md", "LOCAL_EXECUTION.md", "MODEL_PROVENANCE.md",
            "OUTPUT_DECODING.md", "input/README.md", "model/README.md"]
    SCRIPTS = ["check_environment", "collect_system_info", "download_artifacts",
               "verify_artifacts", "run_dentalgemma"]

    @classmethod
    def setUpClass(cls):
        cls.accepted: dict[str, set[str]] = {}
        for name in cls.SCRIPTS:
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / f"{name}.py"), "--help"],
                capture_output=True, text=True, timeout=120)
            options = result.stdout.split("options:")[-1]
            cls.accepted[name] = set(
                re.findall(r"(?<![\w-])(--[a-z0-9-]+|-[a-zA-Z])(?=[ ,=])", options))

    def _documented_invocations(self):
        """Yield every `python ...<script>.py <flags>` command found in the docs.

        The documents are written for Windows PowerShell, so the path separator is
        a backslash (`python scripts\\verify_artifacts.py`). An earlier version of
        this test only accepted a forward slash and silently matched nothing —
        which is worse than failing, so the pattern now accepts either separator
        and the count is asserted below.

        A command continued with PowerShell's backtick is joined first, so a flag
        on the second line is checked too instead of being quietly skipped, and
        anything after `--extra` is left alone: that argument is a verbatim
        passthrough to the runtime, whose flags belong to llama.cpp, not to us.
        """
        pattern = re.compile(r"python\s+(?:\.?[\\/])?(?:scripts[\\/])?(\w+)\.py([^\n`]*)")
        for doc in self.DOCS:
            text = (LAB / doc).read_text(encoding="utf-8")
            # join backtick continuations into a single logical command line
            joined = re.sub(r"`\s*\n\s*", " ", text)
            for match in pattern.finditer(joined):
                rest = match.group(2)
                if "--extra" in rest:
                    rest = rest.split("--extra")[0]
                yield doc, match.group(1), rest, match.group(0)

    def test_every_documented_script_exists(self):
        found = 0
        for doc, script, _, invocation in self._documented_invocations():
            found += 1
            self.assertTrue((SCRIPTS / f"{script}.py").is_file(),
                            f"{doc} refers to a missing script: {invocation}")
        # Guard against the pattern silently matching nothing (see the docstring of
        # _documented_invocations): assert on the count, for each script, so a
        # renamed path cannot quietly empty this test.
        self.assertGreaterEqual(found, 10,
                                "the docs should contain the full command set")
        seen = {script for _, script, _, _ in self._documented_invocations()}
        for expected in ("check_environment", "download_artifacts", "verify_artifacts",
                         "run_dentalgemma", "collect_system_info"):
            self.assertIn(expected, seen,
                          f"no documented command was found for {expected}.py")

    def test_every_documented_flag_exists(self):
        checked = 0
        for doc, script, rest, invocation in self._documented_invocations():
            for flag in re.findall(r"(?<![\w-])(--[a-z0-9-]+|-[a-zA-Z])(?=[ ,=\\]|$)", rest):
                if flag == "-h":
                    continue
                checked += 1
                self.assertIn(flag, self.accepted[script],
                              f"{doc}: `{invocation.strip()}` uses {flag}, "
                              f"which {script}.py does not accept")
        self.assertGreater(checked, 5, "the flag check matched nothing — see the regex")

    def test_local_execution_marks_what_must_be_done_locally(self):
        """The document must not read as though Arena already ran any of it.

        The whole premise of the lab is that nothing here has been executed: the
        artifacts are 3.47 GiB, the GPU situation is unknown, and the only machine
        that can produce a real result is the user's. A document that reads as a
        record of accomplished work would be a fabricated result in prose, so the
        claim is asserted rather than left to intent.
        """
        text = (LAB / "LOCAL_EXECUTION.md").read_text(encoding="utf-8")
        upper = text.upper()
        self.assertIn("ON YOUR WINDOWS MACHINE", upper,
                      "LOCAL_EXECUTION.md must state where these commands run")
        self.assertIn("NONE OF IT HAS BEEN RUN", upper,
                      "LOCAL_EXECUTION.md must state that none of it has been run")
        self.assertNotIn("HAS BEEN VERIFIED", upper.replace("NONE OF IT HAS BEEN RUN", ""),
                         "the local steps must not be described as verified")
        # PowerShell is the target shell, and `python` is invoked from the lab root.
        self.assertIn("PowerShell", text)
        self.assertIn("python scripts", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)

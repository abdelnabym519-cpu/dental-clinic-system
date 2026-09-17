#!/usr/bin/env python3
"""
test_runner_import.py — regression tests for the Windows compatibility fix in
``scripts/run_meshsegnet.py``.

Background
----------
The Unix-only ``resource`` module does not exist on Windows, and importing it
raised ``ModuleNotFoundError: No module named 'resource'`` before the runner did
anything at all. The fix moves process-memory measurement (diagnostics only)
into portable probes and imports ``resource`` lazily inside the POSIX probe.

What these tests prove
----------------------
1. the runner imports even when ``resource`` is completely unavailable — the
   exact Windows failure mode;
2. the ``resource`` import is no longer at module level;
3. memory probing never raises on any platform, and degrades to a reportable
   "unavailable" value instead of a crash;
4. the reported number is attributed to the probe that produced it, so a
   Windows working set is never presented as a Linux resident set;
5. **the command from the bug report starts** on a machine without ``resource``;
6. the fix changed no arithmetic: the official cell cap and adjacency
   thresholds are untouched.

The tests use only the standard library — no pytest, no psutil, no torch — so
they can run on a bare Windows Python install where the heavy dependencies are
not yet present. ``pytest`` can run this file too if you prefer it.

Usage::

    python -m unittest discover -s tests -v
    python tests/test_runner_import.py
"""

from __future__ import annotations

import ast
import importlib.util
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPT = LAB / "scripts" / "run_meshsegnet.py"

# Injected into a child interpreter through PYTHONPATH/sitecustomize so that
# ``import resource`` fails exactly as it does on Windows.
BLOCK_RESOURCE_SITECUSTOMIZE = textwrap.dedent(
    '''
    """Simulate a platform without the Unix-only ``resource`` module."""
    import sys


    class _BlockResource:
        def find_spec(self, name, path=None, target=None):
            if name == "resource":
                raise ImportError("No module named 'resource'")
            return None


    sys.meta_path.insert(0, _BlockResource())
    sys.modules.pop("resource", None)
    '''
)


def load_runner():
    """Import ``run_meshsegnet.py`` as a module without executing main()."""
    spec = importlib.util.spec_from_file_location("run_meshsegnet_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestRunnerImportsWithoutResource(unittest.TestCase):
    """The Windows failure mode itself."""

    def test_script_exists(self):
        self.assertTrue(SCRIPT.is_file(), f"runner not found at {SCRIPT}")

    def test_no_module_level_resource_import(self):
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        offenders = []
        for node in tree.body:  # module level only
            if isinstance(node, ast.Import):
                offenders += [a.name for a in node.names if a.name == "resource"]
            elif isinstance(node, ast.ImportFrom) and node.module == "resource":
                offenders.append(f"from resource import {node.names[0].name}")
        self.assertEqual(
            offenders, [],
            "`resource` must not be imported at module level or Windows "
            f"cannot import this file; found: {offenders}",
        )

    def test_resource_import_is_lazy_and_guarded(self):
        """Any remaining ``import resource`` must sit inside a try/except."""
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        lazy = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            and any(a.name == "resource" for a in node.names)
        ]
        self.assertTrue(lazy, "expected the POSIX probe to import resource lazily")
        guarded = {
            id(inner)
            for node in ast.walk(tree) if isinstance(node, ast.Try)
            for inner in ast.walk(node)
        }
        unguarded = [n.lineno for n in lazy if id(n) not in guarded]
        self.assertEqual(
            unguarded, [],
            "every lazy `import resource` must be inside a try/except so a "
            "machine without the module degrades instead of raising",
        )

    def test_runner_imports_with_resource_blocked(self):
        """Importing the runner and probing memory must work with no `resource`."""
        body = (
            "import importlib.util\n"
            f"spec = importlib.util.spec_from_file_location('r', {str(SCRIPT)!r})\n"
            "mod = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(mod)\n"
            "usage = mod.memory_usage()\n"
            "assert isinstance(usage['rss_bytes'], int), usage\n"
            "assert isinstance(usage['peak_bytes'], int), usage\n"
            "assert isinstance(mod.format_gb(0), str)\n"
            "print('IMPORT_OK', usage)\n"
        )
        result = self._run_child(body)
        self.assertEqual(result.returncode, 0,
                         f"runner failed under blocked `resource`:\n{result.stderr}")
        self.assertIn("IMPORT_OK", result.stdout)

    def test_bug_report_command_starts(self):
        """The exact command from the report must get past startup."""
        result = self._run_child(None, extra_args=["--help"])
        combined = result.stdout + result.stderr
        self.assertNotIn("No module named 'resource'", combined,
                         "the reported crash is still reachable")
        self.assertIn("usage:", combined.lower(),
                      f"expected the runner's own --help output, got:\n{combined}")
        self.assertEqual(result.returncode, 0, combined)

    # -- helpers ---------------------------------------------------------
    def _run_child(self, body: str | None, extra_args: list[str] | None = None):
        """Run the runner in a subprocess where ``import resource`` raises.

        ``body`` is a ``-c`` program for import-level tests; when it is None the
        script is executed directly, argv-style, like a user would run it.
        """
        with tempfile.TemporaryDirectory(prefix="meshsegnet_noresource_") as tmp:
            # sitecustomize is imported by `site` at interpreter startup, so a
            # temporary directory on PYTHONPATH is enough to remove `resource`.
            Path(tmp, "sitecustomize.py").write_text(BLOCK_RESOURCE_SITECUSTOMIZE,
                                                     encoding="utf-8")
            env = dict(os.environ)
            env["PYTHONPATH"] = os.pathsep.join(
                [tmp] + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else [])
            )
            argv = ([sys.executable, "-c", body] if body is not None
                    else [sys.executable, str(SCRIPT)])
            return subprocess.run(
                argv + list(extra_args or []),
                capture_output=True, text=True, env=env, timeout=180, cwd=str(LAB),
            )


class TestMemoryProbing(unittest.TestCase):
    """The portable measurement must never raise, on any platform."""

    def setUp(self):
        self.runner = load_runner()

    def test_probes_never_raise(self):
        for probe in ("_psutil_memory", "_windows_memory", "_posix_memory"):
            with self.subTest(probe=probe):
                out = getattr(self.runner, probe)()
                self.assertTrue(out is None or isinstance(out, dict))

    def test_memory_contract_is_consistent(self):
        """Whatever the platform can do, the report must never be silently wrong.

        This used to assert "every platform reports a nonzero footprint", which
        is a contract no implementation can guarantee — it fails on a machine
        where no probe works, and it hid a real bug behind that assumption. What
        can be guaranteed is consistency: a number is always attributed to the
        probe that produced it, and "no reading" is never reported as 0 bytes.
        """
        usage = self.runner.memory_usage()
        self.assertIsInstance(usage["rss_bytes"], int)
        self.assertIsInstance(usage["peak_bytes"], int)
        self.assertGreaterEqual(usage["rss_bytes"], 0)
        self.assertGreaterEqual(usage["peak_bytes"], 0)
        measured = usage["rss_bytes"] or usage["peak_bytes"]
        if measured:
            self.assertNotEqual(usage["method"], self.runner.MEMORY_UNAVAILABLE,
                                "a real reading must name the probe behind it")
        else:
            self.assertEqual(usage["method"], self.runner.MEMORY_UNAVAILABLE,
                             "an unmeasurable footprint must say so, not report 0")

    @unittest.skipIf(os.name == "nt", "POSIX probe chain (resource + /proc)")
    def test_posix_platform_is_measured(self):
        """On POSIX the probes are always available, so a 0 means they broke."""
        usage = self.runner.memory_usage()
        self.assertGreater(usage["rss_bytes"], 0,
                           "a running process must report a nonzero footprint on POSIX")
        self.assertNotEqual(usage["method"], self.runner.MEMORY_UNAVAILABLE)

    def test_degrades_gracefully_when_nothing_works(self):
        runner = self.runner
        saved = {n: getattr(runner, n) for n in
                 ("_psutil_memory", "_windows_memory", "_posix_memory")}
        for name in saved:
            setattr(runner, name, lambda: None)
        try:
            usage = runner.memory_usage()
        finally:
            for name, fn in saved.items():
                setattr(runner, name, fn)
        self.assertEqual(usage["rss_bytes"], 0)
        self.assertEqual(usage["peak_bytes"], 0)
        self.assertEqual(usage["method"], runner.MEMORY_UNAVAILABLE)
        self.assertEqual(runner.format_gb(0), "n/a (probe unavailable)")
        self.assertEqual(runner.format_gb(1610612736), "1.50 GB")

    def test_posix_probe_is_skipped_on_windows(self):
        """The lazy ``import resource`` must be unreachable when os.name == 'nt'."""
        runner = self.runner
        saved_name = os.name
        try:
            os.name = "nt"
            # Force the other probes out of the way so only the POSIX probe is
            # under test; on Windows it must decline without importing resource.
            saved = {n: getattr(runner, n) for n in ("_psutil_memory", "_windows_memory")}
            for name in saved:
                setattr(runner, name, lambda: None)
            try:
                self.assertIsNone(runner._posix_memory())
                self.assertEqual(runner.memory_usage()["method"],
                                 runner.MEMORY_UNAVAILABLE)
            finally:
                for name, fn in saved.items():
                    setattr(runner, name, fn)
        finally:
            os.name = saved_name

    def test_probe_order_prefers_portable_sources_on_windows(self):
        """On Windows, psutil wins; the Windows API is reached if it is absent."""
        runner = self.runner
        calls = []
        saved = {n: getattr(runner, n) for n in
                 ("_psutil_memory", "_windows_memory", "_posix_memory")}
        try:
            runner._psutil_memory = lambda: (calls.append("psutil"), None)[1]
            runner._windows_memory = lambda: (calls.append("windows"),
                                              {"rss": 5, "peak": 7,
                                               "rss_label": "Windows working set",
                                               "peak_label": "Windows peak working set"})[1]
            runner._posix_memory = lambda: (calls.append("posix"), None)[1]
            usage = runner.memory_usage()
            self.assertEqual(usage["rss_bytes"], 5)
            self.assertEqual(usage["peak_bytes"], 7)
            self.assertIn("Windows", usage["method"])
            self.assertIn("windows", calls)
            self.assertLess(calls.index("windows"), calls.index("posix"),
                            "the POSIX probe (which imports `resource`) must be "
                            "consulted only after the Windows probe answers")
        finally:
            for name, fn in saved.items():
                setattr(runner, name, fn)

    def test_windows_counters_struct_layout(self):
        """The ctypes struct must match psapi's PROCESS_MEMORY_COUNTERS."""
        import ctypes
        size = ctypes.sizeof(self.runner._ProcessMemoryCounters)
        expected = 2 * 4 + 8 * ctypes.sizeof(ctypes.c_size_t)
        self.assertEqual(size, expected,
                         "PROCESS_MEMORY_COUNTERS layout drifted; "
                         "GetProcessMemoryInfo would write out of bounds")
        self.assertEqual(self.runner._ProcessMemoryCounters._fields_[0][0], "cb")


class _FakeWinFunction:
    """One entry of a fake Win32 DLL, with settable restype/argtypes like ctypes."""

    def __init__(self, name: str, dll: "_FakeWinDLL"):
        self.name = name
        self.dll = dll
        self.restype = None
        self.argtypes = None

    def __call__(self, *args):
        self.dll.calls.append((self.name, self.restype, self.argtypes, args))
        if self.name == "GetCurrentProcess":
            # A 64-bit pseudo-handle: reading it as c_int truncates it, which is
            # exactly the bug this test exists to prevent.
            return self.dll.PSEUDO_HANDLE
        handle, byref_counters, cb = args
        self.dll.handle_seen = handle
        self.dll.cb_seen = cb
        counters = byref_counters._obj          # the real struct being filled in
        counters.WorkingSetSize = self.dll.working_set
        counters.PeakWorkingSetSize = self.dll.peak_working_set
        return 1


class _FakeWinDLL:
    """Just enough of a Windows DLL to exercise the ctypes probe off-Windows."""

    PSEUDO_HANDLE = 0xFFFFFFFFFFFFFFFF

    def __init__(self, working_set: int, peak_working_set: int):
        self.working_set = working_set
        self.peak_working_set = peak_working_set
        self.calls: list[tuple] = []
        self.handle_seen = None
        self.cb_seen = None
        self._fns: dict[str, _FakeWinFunction] = {}

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        # Memoise, like a real DLL: the same function object every time, so a
        # restype set before the call is still in force when the call happens.
        if name not in self._fns:
            self._fns[name] = _FakeWinFunction(name, self)
        return self._fns[name]


class TestWindowsMemoryProbe(unittest.TestCase):
    """Exercise the Windows ctypes path on any platform.

    The probe returned 0 bytes on real Windows hardware because
    ``GetCurrentProcess`` was called without a declared return type: ctypes then
    reads the 64-bit pseudo-handle as a 32-bit int, the handle becomes invalid,
    and ``GetProcessMemoryInfo`` fails — silently, because the failure was
    swallowed and reported as "no memory". These tests declare the contract.
    """

    def setUp(self):
        import ctypes

        self.ctypes = ctypes
        self.runner = load_runner()
        self._saved_windll = ctypes.__dict__.get("WinDLL", None)
        self._saved_name = os.name

    def tearDown(self):
        if self._saved_windll is None:
            self.ctypes.__dict__.pop("WinDLL", None)
        else:
            self.ctypes.WinDLL = self._saved_windll
        os.name = self._saved_name

    def _install_fake(self, working_set: int, peak: int) -> _FakeWinDLL:
        dll = _FakeWinDLL(working_set, peak)
        self.ctypes.WinDLL = lambda name, use_last_error=False: dll
        os.name = "nt"
        return dll

    def test_handle_is_declared_pointer_sized(self):
        dll = self._install_fake(1, 2)
        self.runner._windows_memory()
        declarations = {name: (restype, argtypes) for name, restype, argtypes, _ in dll.calls}
        self.assertIn("GetCurrentProcess", declarations)
        restype, argtypes = declarations["GetCurrentProcess"]
        self.assertIs(restype, self.ctypes.c_void_p,
                      "GetCurrentProcess must declare restype=c_void_p, otherwise the "
                      "64-bit pseudo-handle is truncated to 32 bits and every call fails")
        self.assertEqual(argtypes, [])

    def test_counter_call_signature_is_declared(self):
        dll = self._install_fake(1, 2)
        self.runner._windows_memory()
        declarations = {name: (restype, argtypes) for name, restype, argtypes, _ in dll.calls}
        self.assertIn("GetProcessMemoryInfo", declarations)
        restype, argtypes = declarations["GetProcessMemoryInfo"]
        self.assertIs(restype, self.ctypes.c_int, "BOOL must be a 4-byte int")
        self.assertEqual(len(argtypes), 3)
        self.assertIs(argtypes[0], self.ctypes.c_void_p, "HANDLE must be pointer-sized")
        self.assertIs(argtypes[2], self.ctypes.c_uint32, "cb is a DWORD")

    def test_counters_are_parsed_and_attributed_to_windows(self):
        dll = self._install_fake(812_345_678, 1_234_567_890)
        got = self.runner._windows_memory()
        self.assertIsNotNone(got, "the fabricated counters must be picked up")
        self.assertEqual(got["rss"], 812_345_678)
        self.assertEqual(got["peak"], 1_234_567_890)
        self.assertEqual(dll.handle_seen, _FakeWinDLL.PSEUDO_HANDLE,
                         "the handle must reach the API untruncated")
        self.assertEqual(dll.cb_seen, self.ctypes.sizeof(self.runner._ProcessMemoryCounters))

        usage = self.runner.memory_usage()
        self.assertEqual(usage["rss_bytes"], 812_345_678)
        self.assertEqual(usage["peak_bytes"], 1_234_567_890)
        self.assertIn("Windows", usage["method"])

    def test_zeroed_counters_are_not_reported_as_zero_bytes(self):
        """A zeroed struct means "no data", not "0 bytes of memory"."""
        self._install_fake(0, 0)
        self.assertIsNone(self.runner._windows_memory())
        usage = self.runner.memory_usage()
        self.assertEqual(usage["method"], self.runner.MEMORY_UNAVAILABLE)
        self.assertEqual(usage["rss_bytes"], 0)

    def test_posix_probe_still_declines_on_windows(self):
        self._install_fake(1, 2)
        self.assertIsNone(self.runner._posix_memory())


class TestPipelineUntouched(unittest.TestCase):
    """The fix must not have moved any inference mathematics."""

    def setUp(self):
        self.runner = load_runner()

    def test_official_constants_unchanged(self):
        self.assertEqual(self.runner.OFFICIAL_MAX_CELLS, 10000)
        self.assertEqual(self.runner.A_S_THRESHOLD, 0.1)
        self.assertEqual(self.runner.A_L_THRESHOLD, 0.2)
        self.assertEqual(len(self.runner.CLASS_NAMES), 15)
        self.assertEqual(self.runner.CLASS_NAMES[0], "Gingiva")

    def test_model_filenames_and_jaws_unchanged(self):
        self.assertEqual(
            self.runner.MODELS["man"]["file"],
            "MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip")
        self.assertEqual(
            self.runner.MODELS["max"]["file"],
            "MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip")
        self.assertIn("lower", self.runner.MODELS["man"]["jaw"])
        self.assertIn("upper", self.runner.MODELS["max"]["jaw"])

    def test_memory_probing_is_not_part_of_the_feature_path(self):
        """No pipeline function may call the memory probes."""
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        probes = {"memory_usage", "rss_bytes", "peak_rss_bytes", "format_gb"}
        pipeline = {"build_features", "build_adjacency", "load_model", "load_mesh"}
        called_from_pipeline = []
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name in pipeline:
                for inner in ast.walk(node):
                    if (isinstance(inner, ast.Call)
                            and isinstance(inner.func, ast.Name)
                            and inner.func.id in probes):
                        called_from_pipeline.append(f"{node.name} -> {inner.func.id}")
        self.assertEqual(
            called_from_pipeline, [],
            f"memory probing leaked into the inference path: {called_from_pipeline}")


if __name__ == "__main__":
    unittest.main(verbosity=2)

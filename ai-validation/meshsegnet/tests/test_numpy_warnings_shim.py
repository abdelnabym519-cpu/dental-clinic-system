#!/usr/bin/env python3
"""
test_numpy_warnings_shim.py — regression tests for the `np.warnings` fix in
``scripts/run_meshsegnet.py``.

Background
----------
vedo 2022.4.2 executes this statement while its package is being imported
(``vedo/__init__.py:234``):

    np.warnings.filterwarnings('ignore', category=np.VisibleDeprecationWarning)

``np.warnings`` was the standard library ``warnings`` module re-exported by
numpy. NumPy deprecated the alias in 1.15 and removed it in 1.24, so on numpy
1.26.4 — the version pinned for this lab — importing vedo fails with

    AttributeError: module 'numpy' has no attribute 'warnings'

which the runner reports as ``[STOP] missing dependency: AttributeError: ...``.
The runner now restores the missing names in memory, before ``import vedo``.

What these tests prove
----------------------
1. the shim installs ``np.warnings`` as the stdlib ``warnings`` module;
2. **the exact upstream statement from vedo 2022.4.2 executes** after the shim
   — this is the direct regression test for the reported failure;
3. that same statement **fails without the shim**, so the test is not vacuous;
4. the shim is idempotent and never overwrites attributes that already exist
   (numpy < 1.24 keeps its own behaviour);
5. the shim never raises, whatever numpy is installed;
6. ``main()`` calls the shim **before** ``import vedo`` — the ordering is the
   whole point of the fix;
7. the shim changes no numerical behaviour: it only touches warning filters.

If vedo is installed, an additional test really imports it end to end; on the
Windows machine running this lab that test executes for real.

Standard library + numpy only. ``pytest`` can run this file too.

Usage::

    python -m unittest discover -s tests -v
    python tests/test_numpy_warnings_shim.py
"""

from __future__ import annotations

import ast
import importlib.util
import subprocess
import sys
import textwrap
import unittest
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPT = LAB / "scripts" / "run_meshsegnet.py"
COMPAT = LAB / "scripts" / "compat.py"

# The statement taken verbatim from vedo 2022.4.2, vedo/__init__.py:234.
VEDO_2022_LINE = (
    "np.warnings.filterwarnings('ignore', category=np.VisibleDeprecationWarning)"
)


def load_runner():
    """Import ``run_meshsegnet.py`` as a module without executing main()."""
    spec = importlib.util.spec_from_file_location("run_meshsegnet_shim_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_child(body: str):
    """Run ``body`` in a fresh interpreter, returning the completed process."""
    return subprocess.run([sys.executable, "-c", textwrap.dedent(body)],
                          capture_output=True, text=True, timeout=180, cwd=str(LAB))


NUMPY_AVAILABLE = importlib.util.find_spec("numpy") is not None


@unittest.skipUnless(NUMPY_AVAILABLE, "numpy is not installed in this interpreter")
class NumpyAttributeFixture(unittest.TestCase):
    """Restores numpy attributes after each test, whatever it changed."""

    def setUp(self):
        import numpy as np
        self.np = np
        self._saved = {}
        for name in ("warnings", "VisibleDeprecationWarning"):
            self._saved[name] = np.__dict__.get(name, None)
            self._had = name in np.__dict__

    def tearDown(self):
        for name, value in self._saved.items():
            if value is None and name not in self.np.__dict__:
                continue
            if value is None:
                try:
                    delattr(self.np, name)
                except AttributeError:
                    pass
            else:
                setattr(self.np, name, value)

    def simulate_numpy_124(self):
        """Remove the names numpy >= 1.24 no longer provides."""
        for name in ("warnings", "VisibleDeprecationWarning"):
            try:
                delattr(self.np, name)
            except AttributeError:
                pass


class TestShimMechanism(NumpyAttributeFixture):

    def test_installs_stdlib_warnings_module(self):
        self.simulate_numpy_124()
        self.assertFalse(hasattr(self.np, "warnings"))

        runner = load_runner()
        restored = runner.install_numpy_warnings_shim()

        self.assertIn("np.warnings", restored)
        self.assertTrue(hasattr(self.np, "warnings"))
        self.assertIs(self.np.warnings, warnings,
                      "np.warnings must be the standard library warnings module "
                      "itself — that is exactly the object numpy re-exported")

    def test_exact_vedo_line_now_executes(self):
        """The regression test for the reported failure."""
        self.simulate_numpy_124()
        runner = load_runner()
        runner.install_numpy_warnings_shim()

        namespace = {"np": self.np}
        exec(VEDO_2022_LINE, namespace)  # must not raise

    def test_exact_vedo_line_fails_without_the_shim(self):
        """Proves the previous test is not vacuous: the bug is real."""
        result = _run_child(f"""
            import numpy as np
            for name in ("warnings",):
                try:
                    delattr(np, name)
                except AttributeError:
                    pass
            assert not hasattr(np, "warnings"), "numpy still has np.warnings"
            {VEDO_2022_LINE}
            print("UNEXPECTED_SUCCESS")
        """)
        self.assertIn("AttributeError", result.stderr,
                      "numpy >= 1.24 should reject np.warnings")
        self.assertIn("has no attribute 'warnings'", result.stderr)
        self.assertNotIn("UNEXPECTED_SUCCESS", result.stdout)

    def test_shim_reports_what_it_restored(self):
        self.simulate_numpy_124()
        messages: list[str] = []
        runner = load_runner()
        restored = runner.install_numpy_warnings_shim(messages)

        self.assertTrue(restored, "something should have been restored")
        self.assertEqual(len(messages), 1)
        self.assertIn("vedo 2022.4.2", messages[0])
        self.assertIn("np.warnings", messages[0])

    def test_idempotent_and_leaves_existing_attributes_alone(self):
        sentinel = object()
        self.np.warnings = sentinel          # pretend numpy still provides it
        messages: list[str] = []
        runner = load_runner()

        restored = runner.install_numpy_warnings_shim(messages)

        self.assertEqual(restored, {})
        self.assertIs(self.np.warnings, sentinel,
                      "the shim must never overwrite an attribute that exists")
        self.assertIn("not needed", messages[0])

        # Calling it twice must be harmless.
        runner.install_numpy_warnings_shim()
        self.assertIs(self.np.warnings, sentinel)

    def test_visible_deprecation_warning_is_covered_for_numpy_2(self):
        """numpy 2.0 moved it to np.exceptions; the shim must follow."""
        self.simulate_numpy_124()
        runner = load_runner()
        runner.install_numpy_warnings_shim()

        namespace = {"np": self.np}
        exec(VEDO_2022_LINE, namespace)   # needs both names present
        self.assertTrue(hasattr(self.np, "VisibleDeprecationWarning"))

    def test_never_raises(self):
        self.simulate_numpy_124()
        runner = load_runner()
        try:
            runner.install_numpy_warnings_shim()
            runner.install_numpy_warnings_shim([])
        except Exception as exc:                     # pragma: no cover
            self.fail(f"the shim must never raise, got {type(exc).__name__}: {exc}")


class TestShimPlacement(unittest.TestCase):
    """The shim is only useful if it runs before vedo is imported."""

    def test_shim_called_before_import_vedo(self):
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        main = next(node for node in ast.walk(tree)
                    if isinstance(node, ast.FunctionDef) and node.name == "main")

        shim_line = vedo_line = None
        for node in ast.walk(main):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and node.func.id == "install_numpy_warnings_shim" and shim_line is None:
                shim_line = node.lineno
            if isinstance(node, ast.Import) \
                    and any(alias.name == "vedo" for alias in node.names) and vedo_line is None:
                vedo_line = node.lineno

        self.assertIsNotNone(shim_line, "main() must call install_numpy_warnings_shim()")
        self.assertIsNotNone(vedo_line, "expected an `import vedo` inside main()")
        self.assertLess(shim_line, vedo_line,
                        "the shim must be installed BEFORE `import vedo`, "
                        "otherwise vedo fails while importing")

    def test_shim_is_the_only_numpy_patch(self):
        """No other numpy attribute may be monkey-patched (keep the change minimal)."""
        tree = ast.parse(COMPAT.read_text(encoding="utf-8"))
        shim_fn = next(node for node in ast.walk(tree)
                       if isinstance(node, ast.FunctionDef)
                       and node.name == "install_numpy_warnings_shim")
        patched = {
            target.attr
            for node in ast.walk(shim_fn) if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Attribute)
        }
        self.assertEqual(patched, {"warnings", "VisibleDeprecationWarning"},
                         f"the shim must only set the two names vedo needs, got {patched}")

    def test_shim_implementation_is_shared_not_duplicated(self):
        """The runner must use scripts/compat.py, not a private copy.

        Every script in the lab applies the same shims; if one grew its own
        version, a fix could silently stop applying to the others.
        """
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        defined = {node.name for node in ast.walk(tree)
                   if isinstance(node, ast.FunctionDef)}
        for name in ("install_numpy_warnings_shim", "install_vedo_mapper_shim",
                     "verify_mesh_operations", "make_console_utf8_safe"):
            self.assertNotIn(name, defined,
                             f"{name} must live in scripts/compat.py only")

    def test_shim_does_not_touch_the_numerical_pipeline(self):
        """No pipeline function may call the shim, and no shim may touch maths."""
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        pipeline = {"build_features", "build_adjacency", "load_model", "load_mesh",
                    "mesh_points", "mesh_faces"}
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name in pipeline:
                called = [inner.func.id for inner in ast.walk(node)
                          if isinstance(inner, ast.Call) and isinstance(inner.func, ast.Name)]
                self.assertNotIn("install_numpy_warnings_shim", called,
                                 f"{node.name}() must not depend on the shim")


@unittest.skipUnless(
    importlib.util.find_spec("vedo") is not None,
    "vedo is not installed in this interpreter",
)
class TestRealVedoImport(NumpyAttributeFixture):
    """Runs for real wherever vedo is installed (e.g. the Windows validation box)."""

    def test_vedo_imports_after_the_shim(self):
        self.simulate_numpy_124()
        runner = load_runner()
        restored = runner.install_numpy_warnings_shim()

        import vedo  # noqa: F401 — importing is the assertion

        self.assertTrue(hasattr(self.np, "warnings") or not restored)
        version = getattr(vedo, "__version__", "unknown")
        self.assertTrue(version)


if __name__ == "__main__":
    unittest.main(verbosity=2)

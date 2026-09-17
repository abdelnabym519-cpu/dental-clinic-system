#!/usr/bin/env python3
"""
test_vedo_vtk_compat.py — regression tests for the vedo/VTK compatibility fix in
``scripts/run_meshsegnet.py``.

Background
----------
The class hierarchy of ``vedo.Mesh`` is

    Mesh -> Points -> vtkFollower -> vtkActor -> ... -> vedo.base.BaseActor

vedo's own code calls ``self.mapper().SetInputData(...)`` — a **method** defined
in ``BaseActor``. Modern VTK added a ``mapper`` **property** to ``vtkActor``,
which sits earlier in the MRO and therefore shadows the method completely. Every
mesh operation that goes through ``PointCloud._update()`` then dies with

    ValueError: No input was provided when one is required.

Reproduced against the real libraries (vedo 2022.4.2 + vtk 9.7.0), where
``clone()``, ``decimate()`` and ``compute_normals()`` all failed — i.e. the
official pipeline could not take its first step, long before any inference.

The runner installs an in-process shim that rebinds ``mapper`` to vedo's own
method, which is the behaviour the library intends, and verifies the repair on a
tiny in-memory mesh before trusting it.

What these tests prove
----------------------
1. the shim detects the shadowing and reports where it came from;
2. after the shim, ``clone()`` + ``decimate()`` really work (real vedo/vtk);
3. the shim is a no-op when the stack is already correct;
4. the shim never raises, even with a broken module;
5. ``verify_mesh_operations()`` is the guard that decides whether the shim may
   stay applied — it must return False rather than raise;
6. the runner calls the shim *before* the mesh stage, and the mesh stage cannot
   crash with a raw traceback (it must STOP cleanly);
7. with the real meshes present, the official decimation target is still hit
   exactly — 178,421 -> 10,000 and 328,581 -> 9,999 cells.

Standard library only for the logic tests; the behavioural ones skip when vedo
is not installed.

Usage::

    python -m unittest discover -s tests -v
    python tests/test_vedo_vtk_compat.py
"""

from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPT = LAB / "scripts" / "run_meshsegnet.py"
MESH_DIR = LAB / "input" / "meshes"

VEDO_AVAILABLE = importlib.util.find_spec("vedo") is not None
LOWER_MESH = MESH_DIR / "0EJBIPTC_lower.obj"
UPPER_MESH = MESH_DIR / "ZOUIF2W4_upper.obj"


def load_runner():
    """Import the runner as a module without executing main()."""
    spec = importlib.util.spec_from_file_location("run_meshsegnet_compat_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _import_vedo():
    """Import vedo the way the runner does, shim included."""
    runner = load_runner()
    try:
        runner.install_numpy_warnings_shim()
    except Exception:
        pass
    import vedo
    return runner, vedo


class TestShimLogic(unittest.TestCase):
    """Runs everywhere: the shim must be safe even with nothing installed."""

    def setUp(self):
        self.runner = load_runner()

    def test_shim_never_raises(self):
        messages: list[str] = []
        try:
            result = self.runner.install_vedo_mapper_shim(messages)
        except Exception as exc:                     # pragma: no cover
            self.fail(f"shim raised {type(exc).__name__}: {exc}")
        self.assertIsInstance(result, dict)
        self.assertIn("note", result)
        if VEDO_AVAILABLE:
            self.assertEqual(len(messages), 1)
        else:
            self.assertTrue(any("skipped" in m for m in messages), messages)

    def test_verify_mesh_operations_returns_bool_and_never_raises(self):
        class Broken:
            Mesh = None                 # construction must fail, not explode

        for candidate in (Broken, object(), None):
            with self.subTest(candidate=candidate):
                self.assertIs(self.runner.verify_mesh_operations(candidate), False)

    def test_runner_calls_the_shim_before_the_mesh_stage(self):
        """The shim is useless if it runs after the mesh has been loaded."""
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        main = next(n for n in ast.walk(tree)
                    if isinstance(n, ast.FunctionDef) and n.name == "main")

        shim_line = mesh_line = None
        for node in ast.walk(main):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id == "install_vedo_mapper_shim" and shim_line is None:
                    shim_line = node.lineno
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "load" and mesh_line is None):
                src = ast.unparse(node)
                if src.startswith("vedo.load"):
                    mesh_line = node.lineno
        self.assertIsNotNone(shim_line, "main() must install the vedo mapper shim")
        self.assertIsNotNone(mesh_line, "expected a `vedo.load(...)` in main()")
        self.assertLess(shim_line, mesh_line,
                        "the shim must be installed before the mesh is touched")

    def test_mesh_stage_cannot_crash_with_a_raw_traceback(self):
        """The load/clone/decimate block must be guarded and STOP cleanly."""
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        main = next(n for n in ast.walk(tree)
                    if isinstance(n, ast.FunctionDef) and n.name == "main")

        calls = [n for n in ast.walk(main) if isinstance(n, ast.Call)]
        mesh_ops = [n for n in calls
                    if isinstance(n.func, ast.Attribute)
                    and n.func.attr in ("clone", "decimate")]
        self.assertTrue(mesh_ops, "expected clone()/decimate() in the mesh stage")
        guarded = set()
        for node in ast.walk(main):
            if isinstance(node, ast.Try):
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Call):
                        guarded.add(id(inner))
        unguarded = [n.lineno for n in mesh_ops if id(n) not in guarded]
        self.assertEqual(unguarded, [],
                         "clone()/decimate() must sit inside try/except so a broken "
                         "library stack produces [STOP], not a traceback")

    def test_no_cuda_device_call_anywhere(self):
        """CPU-only contract: no torch.cuda.set_device, no cuda device string."""
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                self.assertNotEqual(node.func.attr, "set_device",
                                    "the runner must never select a CUDA device")
        literals = {n.value for n in ast.walk(tree)
                    if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        self.assertNotIn("cuda", literals,
                         "no CUDA device string may be used; the runner is CPU-only")
        self.assertIn("cpu", literals, "expected the CPU device to be pinned")


@unittest.skipUnless(VEDO_AVAILABLE, "vedo is not installed in this interpreter")
class TestRealVedoVtkStack(unittest.TestCase):
    """Behavioural tests against the installed vedo/vtk, whatever versions they are."""

    @classmethod
    def setUpClass(cls):
        cls.runner, cls.vedo = _import_vedo()

    def test_shim_reports_what_it_found(self):
        messages: list[str] = []
        result = self.runner.install_vedo_mapper_shim(messages)
        self.assertIn("note", result)
        self.assertEqual(len(messages), 1, messages)
        self.assertTrue(result["patched"] or "not needed" in result["note"],
                        f"unexpected shim state: {result}")

    def test_shim_is_idempotent(self):
        first = self.runner.install_vedo_mapper_shim()
        second = self.runner.install_vedo_mapper_shim()
        # After the first call the shadowing is gone, so the second must either
        # find nothing to do or re-apply the same value harmlessly.
        self.assertEqual(second.get("patched", []), [] if first.get("patched") else
                         second.get("patched", []))
        self.assertTrue("not needed" in second["note"] or second["patched"])

    def test_mesh_operations_work_after_the_shim(self):
        self.runner.install_vedo_mapper_shim()
        self.assertIs(self.runner.verify_mesh_operations(self.vedo), True,
                      "clone()+decimate() must work on a tiny mesh after the shim")

    def test_shim_does_not_patch_when_already_correct(self):
        """If the stack is fine, the shim must leave it alone."""
        from vedo.base import BaseActor

        self.runner.install_vedo_mapper_shim()      # normalise the state first
        result = self.runner.install_vedo_mapper_shim()
        for cls in (self.vedo.Mesh, self.vedo.Points):
            resolved = next(c for c in cls.__mro__ if "mapper" in vars(c))
            self.assertIs(vars(resolved)["mapper"], vars(BaseActor)["mapper"],
                          f"{cls.__name__}.mapper should resolve to vedo's own method")
        self.assertEqual(result["patched"], [])
        self.assertIn("not needed", result["note"])

    @unittest.skipUnless(LOWER_MESH.exists(), "lower mesh not downloaded")
    def test_official_decimation_target_is_hit_exactly_lower(self):
        self._assert_decimation(LOWER_MESH, expected=10000)

    @unittest.skipUnless(UPPER_MESH.exists(), "upper mesh not downloaded")
    def test_official_decimation_target_is_hit_exactly_upper(self):
        self._assert_decimation(UPPER_MESH, expected=9999)

    def _assert_decimation(self, path: Path, expected: int):
        self.runner.install_vedo_mapper_shim()
        mesh = self.vedo.load(str(path))
        mesh_d = mesh.clone()
        if mesh_d.ncells > 10000:
            mesh_d.decimate(fraction=10000 / mesh_d.ncells)
        self.assertEqual(int(mesh_d.ncells), expected,
                         f"{path.name}: official rule is >10000 cells -> 10000 "
                         f"(the filter lands on {expected})")
        # the feature stage must be able to consume it
        points = self.runner.mesh_points(mesh_d)
        faces = self.runner.mesh_faces(mesh_d)
        self.assertEqual(faces.shape, (expected, 3))
        self.assertGreaterEqual(points.shape[0], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)

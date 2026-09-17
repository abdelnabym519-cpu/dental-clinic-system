#!/usr/bin/env python3
"""
compat.py — the in-process compatibility shims this lab needs, in one place.

These exist because the lab pins a library set that is *not* the one the
original MeshSegNet release targeted, and two version drifts in that set break
code that has nothing to do with the model:

  1. ``np.warnings`` — vedo 2022.4.2 executes

         np.warnings.filterwarnings('ignore', category=np.VisibleDeprecationWarning)

     while its package is being imported (``vedo/__init__.py:234``). NumPy
     deprecated that alias in 1.15 and removed it in 1.24, so on the numpy 1.26.4
     pinned here ``import vedo`` raises ``AttributeError`` outright.

  2. ``vedo.BaseActor.mapper`` — modern VTK added a ``mapper`` *property* to
     ``vtkActor``, which appears earlier in ``vedo.Mesh``'s MRO than the
     ``BaseActor`` method of the same name and therefore shadows it. Every mesh
     operation that goes through ``PointCloud._update()`` then dies with
     ``ValueError: No input was provided when one is required.`` — including
     ``clone()``, ``decimate()`` and ``compute_normals()``, i.e. the first steps
     of the official pipeline.

Both shims only restore a library's own intended behaviour on a newer
dependency. Neither changes a model, a weight, a feature, a threshold or a
computation: one controls which warnings are printed, the other restores a
method that returns an object the library then uses exactly as the official code
does. Both are idempotent and neither ever raises.

Every script in this lab applies the same shims by loading this file, so a fix
made here cannot drift between scripts:

    compat = load_compat()          # see the tiny loader in each script
    compat.install_numpy_warnings_shim()      # before `import vedo`
    compat.install_vedo_mapper_shim()         # before any mesh operation

Running this file directly prints what each shim would do on this machine —
a quick way to check a stack before a long run:

    python scripts/compat.py
"""

from __future__ import annotations

import sys


# --------------------------------------------------------------------------
# 1. numpy names that vedo 2022.4.2 expects at import time
# --------------------------------------------------------------------------
def install_numpy_warnings_shim(messages: list[str] | None = None) -> dict:
    """Restore the numpy names that vedo 2022.4.2 expects at import time.

    ``np.warnings`` was the standard library ``warnings`` module re-exported by
    numpy; numpy 1.24 removed it. ``np.VisibleDeprecationWarning`` moved to
    ``np.exceptions`` in numpy 2.0.

    Returns a dict of ``{attribute: where_it_came_from}`` for the names actually
    restored, empty when the installed numpy still provides them. Never raises:
    if the shim cannot be applied the caller simply sees the original error.
    """
    import warnings as stdlib_warnings

    import numpy as np

    restored: dict[str, str] = {}

    if not hasattr(np, "warnings"):
        try:
            # The stdlib module, i.e. exactly what numpy re-exported before 1.24.
            np.warnings = stdlib_warnings
            restored["np.warnings"] = "stdlib warnings module"
        except Exception:
            pass

    if not hasattr(np, "VisibleDeprecationWarning"):
        moved = getattr(getattr(np, "exceptions", None),
                        "VisibleDeprecationWarning", None)
        if moved is not None:
            try:
                np.VisibleDeprecationWarning = moved
                restored["np.VisibleDeprecationWarning"] = \
                    "np.exceptions.VisibleDeprecationWarning"
            except Exception:
                pass

    if messages is not None:
        if restored:
            messages.append(
                "restored for vedo 2022.4.2 on numpy "
                f"{np.__version__}: " + ", ".join(restored))
        else:
            messages.append(f"not needed (numpy {np.__version__} still provides them)")

    return restored


# --------------------------------------------------------------------------
# 2. vedo's mapper() method, shadowed by VTK's property of the same name
# --------------------------------------------------------------------------
def install_vedo_mapper_shim(messages: list[str] | None = None) -> dict:
    """Restore vedo's own ``mapper()`` method where VTK's property shadows it.

    The class hierarchy of ``vedo.Mesh`` is

        Mesh -> Points -> vtkFollower -> vtkActor -> ... -> vedo.base.BaseActor

    ``BaseActor`` defines the method ``mapper()`` that all of vedo's own code
    calls (``self.mapper().SetInputData(polydata)``). Modern VTK added a
    ``mapper`` **property** to ``vtkActor`` — a data descriptor that appears
    earlier in the MRO — so it shadows vedo's method entirely. The result is
    that mesh operations which go through ``PointCloud._update()`` raise

        ValueError: No input was provided when one is required.

    from inside ``clone()``, ``decimate()`` and ``compute_normals()``, i.e. the
    pipeline cannot take a single step. In the VTK version vedo 2022.4.2 was
    written against (9.2.x) ``vtkActor`` had no such property, so this never
    happened.

    The fix rebinds the class attribute back to the library's own method — the
    exact behaviour vedo intends — for the classes this lab uses. It is applied
    only when shadowing is actually detected, so on an era-matched or newer
    stack it does nothing at all. Nothing numeric is touched: the same vedo code
    then runs, calling the same VTK filters with the same parameters.

    Returns ``{"patched": [...], "verified": bool|None, "note": str}``.
    Never raises.
    """
    result: dict = {"patched": [], "verified": None}
    try:
        import vtk

        import vedo
        from vedo.base import BaseActor
        vtk_version = vtk.vtkVersion.GetVTKVersion()
    except Exception as exc:
        result["note"] = f"skipped ({type(exc).__name__}: {exc})"
        if messages is not None:
            messages.append(result["note"])
        return result

    base_mapper = vars(BaseActor).get("mapper")
    if not callable(base_mapper):
        result["note"] = "skipped (this vedo has no BaseActor.mapper method)"
        if messages is not None:
            messages.append(result["note"])
        return result

    rollback: list[tuple[type, object]] = []
    for cls_name in ("Mesh", "Points"):
        cls = getattr(vedo, cls_name, None)
        if cls is None:
            continue
        owner = next((c for c in cls.__mro__ if "mapper" in vars(c)), None)
        if owner is None:
            continue
        found = vars(owner)["mapper"]
        if found is base_mapper:
            continue                       # already correct: nothing to restore
        try:
            rollback.append((cls, found))
            setattr(cls, "mapper", base_mapper)
            result["patched"].append(f"{cls.__name__}.mapper")
            result["shadowed_by"] = f"{owner.__module__}.{owner.__name__}"
        except Exception as exc:
            result.setdefault("errors", []).append(f"{cls.__name__}: {exc}")

    if result["patched"]:
        verified = verify_mesh_operations(vedo)
        result["verified"] = verified
        if not verified:
            # Leave the process exactly as we found it rather than half-patched.
            for cls, previous in rollback:
                try:
                    setattr(cls, "mapper", previous)
                except Exception:
                    pass
            result["patched"] = []
            result["note"] = ("shim did not restore mesh operations; rolled back "
                              "and left the library untouched")
        else:
            result["note"] = (f"vtkActor.mapper shadows vedo's method on vtk "
                              f"{vtk_version}; rebound to vedo.base.BaseActor.mapper")
    else:
        result["note"] = (f"not needed (vedo's mapper() resolves correctly on "
                          f"vtk {vtk_version})")

    if messages is not None:
        messages.append(result["note"])
    return result


def verify_mesh_operations(vedo_module) -> bool:
    """Prove the mesh pipeline can clone + decimate, on a tiny in-memory mesh.

    Runs the same two operations the pipeline depends on (``clone()`` and
    ``decimate()``) on a two-triangle square, so a broken stack is detected in
    microseconds instead of after a 178,000-cell mesh has been loaded. Never
    raises; returns False if anything goes wrong.
    """
    try:
        import vtk

        pts = vtk.vtkPoints()
        for x, y in ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)):
            pts.InsertNextPoint(x, y, 0.0)
        tris = vtk.vtkCellArray()
        for tri in ((0, 1, 2), (0, 2, 3)):
            tris.InsertNextCell(3)
            for idx in tri:
                tris.InsertCellPoint(idx)
        poly = vtk.vtkPolyData()
        poly.SetPoints(pts)
        poly.SetPolys(tris)

        probe = vedo_module.Mesh(poly)
        before = int(probe.ncells)
        cloned = probe.clone()
        cloned.decimate(fraction=0.5)
        return before > 0 and 0 < int(cloned.ncells) < before
    except Exception:
        return False


# --------------------------------------------------------------------------
# 3. console encoding, so non-ASCII output can never abort a run
# --------------------------------------------------------------------------
def make_console_utf8_safe() -> None:
    """Keep non-ASCII console output from ever aborting a run.

    The report prints a few non-ASCII characters (em dashes). A Windows console
    handles them — Python has used the UTF-8 console API since 3.6 — but a
    *redirected* stream falls back to the legacy ANSI/OEM code page, where
    printing such a character raises ``UnicodeEncodeError`` in the middle of a
    run. Reconfiguring to UTF-8 with ``errors="replace"`` removes that failure
    mode. It changes only how text reaches the terminal, never anything computed.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


# --------------------------------------------------------------------------
# convenience
# --------------------------------------------------------------------------
def import_vedo(messages: list[str] | None = None):
    """Import vedo with the numpy shim already applied. For support scripts."""
    install_numpy_warnings_shim(messages)
    import vedo
    return vedo


def _main() -> int:
    """Print what the shims do on this machine — a pre-flight check."""
    print("MeshSegNet lab — compatibility shim report")
    print("=" * 74)
    try:
        import numpy
        print(f"  numpy            : {numpy.__version__}")
    except Exception as exc:
        print(f"  numpy            : not installed ({type(exc).__name__})")
        return 1
    try:
        import vtk
        print(f"  vtk              : {vtk.vtkVersion.GetVTKVersion()}")
    except Exception as exc:
        print(f"  vtk              : not installed ({type(exc).__name__})")

    messages: list[str] = []
    install_numpy_warnings_shim(messages)
    print(f"  numpy shim       : {messages[-1]}")
    try:
        import_vedo(messages)
    except Exception as exc:
        print(f"  vedo             : CANNOT IMPORT ({type(exc).__name__}: {exc})")
        return 2
    import vedo
    print(f"  vedo             : {getattr(vedo, '__version__', 'unknown')}")

    messages = []
    result = install_vedo_mapper_shim(messages)
    print(f"  vedo/vtk shim    : {messages[-1]}")
    print(f"  mesh ops verified: {result.get('verified')}")
    if result.get("patched") and not result.get("verified"):
        print("\n  The mesh pipeline cannot run on this library combination.")
        print("  A working alternative: install the era-matched pair that the")
        print("  official project pins (vedo 2022.4.2 + vtk 9.2.4).")
        return 3
    print("\n  This library stack can perform the pipeline's mesh operations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
